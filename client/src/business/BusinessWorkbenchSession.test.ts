// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import {
  BusinessWorkbenchSession,
  classifyBusinessFailure,
  isBusinessAuthorizationError,
  isBusinessSecurityError,
} from "./BusinessWorkbenchSession";
import { CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT } from "./BusinessScope";

const failure = (
  businessFailure?: string,
  code = "FORBIDDEN",
  httpStatus = 403
) => ({
  data: { businessFailure, code, httpStatus },
  message: "arbitrary untrusted description",
});

describe("BusinessWorkbenchSession structured refusal and real cache lifecycle", () => {
  it.each([
    "AUTH_SESSION_INVALID",
    "STAFF_BINDING_INVALID",
    "TENANT_ACCESS_REVOKED",
  ])("recognizes server-owned %s even with a non-403 status", marker => {
    const error = failure(marker, "PRECONDITION_FAILED", 412);
    expect(classifyBusinessFailure(error)).toBe("session-invalid");
    expect(isBusinessAuthorizationError(error)).toBe(true);
    expect(isBusinessSecurityError(error)).toBe(true);
  });

  it.each([
    [failure("BUSINESS_RESOURCE_FORBIDDEN"), "resource-denied"],
    [failure(undefined), "security-unclassified"],
    [failure("FORGED_NEW_CLASS"), "security-unclassified"],
    [failure(undefined, "UNAUTHORIZED", 401), "session-invalid"],
    [
      failure("BUSINESS_RESOURCE_FORBIDDEN", "UNAUTHORIZED", 401),
      "session-invalid",
    ],
    [{ message: "AUTH_SESSION_INVALID: binding revoked forbidden" }, "other"],
    [new TypeError("network timeout FORBIDDEN"), "other"],
    [null, "other"],
  ])(
    "classifies %j only from the closed server contract",
    (error, expected) => {
      expect(classifyBusinessFailure(error)).toBe(expected);
    }
  );

  it("clears only a denied query's retained data, keeps unrelated cache, same domain controller and draft", async () => {
    const notify = vi.fn();
    const session = new BusinessWorkbenchSession(6001, notify);
    session.confirmAuthorization("same-authorization");
    const resources = session.domainResources("same-authorization");
    const deniedKey = [["company", "profilePhotos"], { type: "query" }];
    const otherKey = [["customer", "list"], { type: "query" }];
    resources.client.setQueryData(deniedKey, { photos: ["old private photo"] });
    resources.client.setQueryData(otherKey, { items: ["permitted customer"] });
    const invalidated = vi.fn();
    window.addEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      invalidated
    );
    await expect(
      resources.client.fetchQuery({
        queryKey: deniedKey,
        queryFn: async () => {
          throw failure("BUSINESS_RESOURCE_FORBIDDEN");
        },
      })
    ).rejects.toMatchObject({
      data: { businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" },
    });
    expect(resources.client.getQueryData(deniedKey)).toBeUndefined();
    expect(resources.client.getQueryState(deniedKey)?.status).toBe("error");
    expect(resources.client.getQueryData(otherKey)).toEqual({
      items: ["permitted customer"],
    });
    expect(session.domainResources("same-authorization")).toBe(resources);
    expect(resources.abort.signal.aborted).toBe(false);
    expect(session.denied).toBe(false);
    expect(session.authorization).toBe("same-authorization");
    expect(invalidated).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    window.removeEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      invalidated
    );
    session.dispose();
  });

  it.each(["query", "mutation", "direct"] as const)(
    "destroys all sensitive data and draft provenance on marked binding loss via %s",
    async source => {
      const notify = vi.fn();
      const session = new BusinessWorkbenchSession(6001, notify);
      session.confirmAuthorization("old-bound-actor");
      const domain = session.domainResources("old-bound-actor");
      session.discovery.setQueryData(["merchants"], { secret: "old scope" });
      session.context.setQueryData(["context"], { secret: "old binding" });
      domain.client.setQueryData(["customer"], { secret: "old customer" });
      const invalidated = vi.fn();
      window.addEventListener(
        CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
        invalidated
      );
      const error = failure(
        "STAFF_BINDING_INVALID",
        "PRECONDITION_FAILED",
        412
      );
      if (source === "query") {
        await expect(
          domain.client.fetchQuery({
            queryKey: ["rejected"],
            queryFn: async () => {
              throw error;
            },
          })
        ).rejects.toBe(error);
      } else if (source === "mutation") {
        const mutation = domain.client.getMutationCache().build(domain.client, {
          mutationKey: [["customer", "update"]],
          mutationFn: async () => {
            throw error;
          },
        });
        await expect(mutation.execute(undefined)).rejects.toBe(error);
      } else session.onAuthorizationError(error);
      expect(session.denied).toBe(true);
      expect(session.denialKind).toBe("session-invalid");
      expect(session.authorization).toBeNull();
      expect(domain.abort.signal.aborted).toBe(true);
      expect(domain.client.getQueryCache().getAll()).toHaveLength(0);
      expect(domain.client.getMutationCache().getAll()).toHaveLength(0);
      expect(session.context.getQueryCache().getAll()).toHaveLength(0);
      expect(session.discovery.getQueryCache().getAll()).toHaveLength(0);
      expect(invalidated).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      session.onAuthorizationError(error);
      expect(invalidated).toHaveBeenCalledTimes(1);
      window.removeEventListener(
        CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
        invalidated
      );
      session.dispose();
    }
  );

  it("keeps resource mutation/direct refusals local but closes for an unclassified security refusal with accurate reason", async () => {
    const session = new BusinessWorkbenchSession(6001, vi.fn());
    session.confirmAuthorization("current");
    const domain = session.domainResources("current");
    const error = failure("BUSINESS_RESOURCE_FORBIDDEN");
    const mutation = domain.client.getMutationCache().build(domain.client, {
      mutationFn: async () => {
        throw error;
      },
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    session.onAuthorizationError(error);
    expect(session.denied).toBe(false);
    expect(domain.abort.signal.aborted).toBe(false);
    session.onAuthorizationError(failure());
    expect(session.denied).toBe(true);
    expect(session.denialKind).toBe("security-unclassified");
    expect(domain.abort.signal.aborted).toBe(true);
    session.dispose();
  });

  it("uses one trigger for both active proof queries and joins in-flight checks", async () => {
    const session = new BusinessWorkbenchSession(6001, vi.fn());
    let finish!: () => void;
    let hold = false;
    const discovery = vi.fn(async () => {
      if (hold)
        await new Promise<void>(resolve => {
          finish = resolve;
        });
      return "scope";
    });
    const context = vi.fn(async () => "context");
    const first = new QueryObserver(session.discovery, {
      queryKey: ["merchants"],
      queryFn: discovery,
    });
    const second = new QueryObserver(session.context, {
      queryKey: ["context"],
      queryFn: context,
    });
    const unsubs = [first.subscribe(() => {}), second.subscribe(() => {})];
    await Promise.all([first.refetch(), second.refetch()]);
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(context).toHaveBeenCalledTimes(1);
    hold = true;
    session.revalidate("focus");
    session.revalidate("focus");
    session.revalidate("restore");
    expect(discovery).toHaveBeenCalledTimes(2);
    expect(context).toHaveBeenCalledTimes(2);
    finish();
    await Promise.resolve();
    unsubs.forEach(unsubscribe => unsubscribe());
    session.dispose();
  });
});

describe("BusinessWorkbenchSession direct response identity fence", () => {
  it.each(["changed-version", "same-key-new-domain", "disposed"] as const)(
    "ignores an old direct response after %s but accepts a current server response", change => {
      const session = new BusinessWorkbenchSession(6001, vi.fn());
      session.domainResources("A");
      session.confirmAuthorization("A");
      const oldReport = session.authorizationErrorReporter("A");
      if (change === "changed-version") {
        session.domainResources("B");
        session.confirmAuthorization("B");
      } else if (change === "same-key-new-domain") {
        session.invalidateAuthorization(false);
        session.domainResources("A");
        session.confirmAuthorization("A");
      } else session.dispose();
      oldReport(failure("STAFF_BINDING_INVALID", "PRECONDITION_FAILED", 412));
      expect(session.denied).toBe(false);
      if (change !== "disposed") {
        const current = session.authorizationErrorReporter(change === "changed-version" ? "B" : "A");
        current(failure("BUSINESS_RESOURCE_FORBIDDEN"));
        expect(session.denied).toBe(false);
        current(failure("TENANT_ACCESS_REVOKED"));
        expect(session.denied).toBe(true);
        expect(session.denialKind).toBe("session-invalid");
      }
      session.dispose();
    },
  );
});
