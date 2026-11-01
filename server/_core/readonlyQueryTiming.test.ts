import { afterEach, describe, expect, it, vi } from "vitest";
import { readonlyQueryCorrelation, traceReadonlyQuery } from "./readonlyQueryTiming";

afterEach(() => vi.restoreAllMocks());

describe("readonly query timing privacy and semantics", () => {
  it("same request shares a random correlation without using its credentials", () => {
    const request = { headers: { cookie: "private-cookie" } };
    expect(readonlyQueryCorrelation(request)).toBe(readonlyQueryCorrelation(request));
    expect(readonlyQueryCorrelation({})).not.toBe(readonlyQueryCorrelation(request));
  });
  it("records only allowlisted phase metadata and keeps successful result untouched", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = { ok: true, data: { token: "private-token", email: "private-email" } };
    expect(await traceReadonlyQuery({ path: "business.navigation", type: "query", request: {}, run: async () => result })).toBe(result);
    expect(log).toHaveBeenCalledWith("[admin] readonly query timing", expect.objectContaining({
      procedure: "business.navigation", resultCode: "SUCCESS", correlationId: expect.any(String), durationMs: expect.any(Number),
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
  });
  it("keeps rejected authentication result and never records original error details", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = { ok: false, error: { code: "UNAUTHORIZED", message: "SQL private-token private-cookie" } };
    expect(await traceReadonlyQuery({ path: "auth.me", type: "query", request: {}, run: async () => result })).toBe(result);
    expect(log).toHaveBeenCalledWith("[admin] readonly query timing", expect.objectContaining({ resultCode: "UNAUTHORIZED" }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|SQL/);
  });
  it("preserves thrown errors, but sanitizes an unknown error code", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = Object.assign(new Error("SQL private-password"), { code: "PRIVATE_SECRET" });
    await expect(traceReadonlyQuery({ path: "material.categories", type: "query", request: {}, run: async () => { throw error; } })).rejects.toBe(error);
    expect(log).toHaveBeenCalledWith("[admin] readonly query timing", expect.objectContaining({ resultCode: "INTERNAL_SERVER_ERROR" }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|PRIVATE_SECRET|SQL/);
  });
  it("does not observe mutations or queries outside the five-method allowlist", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const run = vi.fn().mockResolvedValue({ ok: true });
    await traceReadonlyQuery({ path: "auth.me", type: "mutation", request: {}, run });
    await traceReadonlyQuery({ path: "order.update", type: "query", request: {}, run });
    expect(run).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
  });
  it("an unavailable logging sink cannot alter the query result", async () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("log unavailable"); });
    const result = { ok: true };
    expect(await traceReadonlyQuery({ path: "message.unreadCount", type: "query", request: {}, run: async () => result })).toBe(result);
  });
});

it("internal callers without an HTTP request are still unaffected", async () => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const result = { ok: true };
  expect(await traceReadonlyQuery({ path: "auth.me", type: "query", request: undefined as unknown as object, run: async () => result })).toBe(result);
});
