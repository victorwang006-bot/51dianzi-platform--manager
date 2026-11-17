// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  actor: 7,
  account: 19,
  company: 3,
  ready: true,
  server: null as any,
  mode: "ok",
  save: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
}));
vi.mock("../../../../BusinessScope", () => ({
  useBusinessScope: () => ({
    frontUser: { id: runtime.actor },
    staffPrincipal: {
      adminAccountId: runtime.account,
      enterpriseId: runtime.company,
    },
  }),
}));
vi.mock("../components/companyStock/useCompanyStockSession", () => ({
  useCompanyStockScope: () => ({
    ready: runtime.ready,
    storageScope: `scope:${runtime.company}`,
  }),
}));
vi.mock("../../../../api/business-trpc", () => ({
  trpc: {
    useUtils: () => ({
      crmSalesOrder: { orderDraftGet: { fetch: runtime.get } },
    }),
    crmSalesOrder: {
      orderDraftSave: { useMutation: () => ({ mutateAsync: runtime.save }) },
      orderDraftDelete: {
        useMutation: () => ({ mutateAsync: runtime.remove }),
      },
    },
  },
}));
import { useSalesOrderDraft } from "./useSalesOrderDraft";
import {
  chooseSalesOrderDraft,
  draftPayloadEqual,
  loadSalesOrderDraft,
  saveSalesOrderDraft,
  salesOrderDraftKey,
} from "../lib/salesOrderDraftStore";
import {
  parseSalesOrderEntryDraft,
  serializeSalesOrderEntryDraft,
} from "../lib/salesOrderEntryDraft";
import { emptyCompanyStockDraft } from "../lib/companyStockOrderDraft";
import type { SalesOrderDraftPayload } from "../../../shared/crmSalesOrderDrafts";
let root: Root,
  container: HTMLDivElement,
  draft: ReturnType<typeof useSalesOrderDraft>;
const pending = () => ({
  customerId: 1,
  requestId: "originalrequest0000001",
  salesTaxMode: "tax_included",
  dueDate: null,
  confirmationNote: "电话确认",
  customerConfirmed: true,
  items: [
    {
      partNumber: "LM358",
      brand: "TI",
      pkg: "SOIC",
      dc: "24+",
      qty: 2,
      agreedUnitPrice: "12.3456",
      allocations: [{ lotId: 41, qty: 2 }],
      qtyUnit: "个",
      deliveryRequirement: "",
      note: "",
    },
  ],
});
const payload = (
  note = "电话确认",
  frozen = false
): SalesOrderDraftPayload => ({
  source: "company_stock",
  customer: { id: 1, name: "客户甲", archivedAt: null },
  company: {
    lines: [
      {
        lot: {
          lotId: 41,
          inboundOrderId: 51,
          partNumber: "LM358",
          brand: "TI",
          pkg: "SOIC",
          dc: "24+",
          lotNumber: "LOT-41",
          location: "A-1",
          availableQty: 8,
          version: 1,
        },
        qty: "2",
        agreedUnitPrice: "12.3456",
      },
    ],
    salesTaxMode: "tax_included",
    dueDate: "",
    confirmationNote: note,
    customerConfirmed: true,
    uncertain: frozen ? (pending() as any) : null,
  },
  form: { version: 1 },
});
const record = (
  value: SalesOrderDraftPayload,
  revision = 1,
  dirty = false
) => ({ payload: value, revision, savedAt: Date.now(), dirty });
function Harness() {
  draft = useSalesOrderDraft();
  return React.createElement("span", null, draft.notice);
}
async function render(key = "A") {
  await act(async () => {
    root.render(React.createElement(Harness, { key }));
  });
}
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Object.assign(runtime, {
    actor: 7,
    account: 19,
    company: 3,
    ready: true,
    server: null,
    mode: "ok",
  });
  runtime.get.mockImplementation(async () => runtime.server);
  runtime.save.mockImplementation(
    async ({ expectedRevision, payload: value }) => {
      const expected = runtime.server?.revision ?? 0;
      if (runtime.mode === "conflict" || expectedRevision !== expected)
        throw Object.assign(new Error("conflict"), {
          data: { code: "CONFLICT" },
        });
      runtime.server = {
        draftId: 1,
        revision: expected + 1,
        updatedAt: "now",
        payload: value,
      };
      if (runtime.mode === "unknown")
        throw new Error("network timeout after commit");
      return { revision: runtime.server.revision, updatedAt: "now" };
    }
  );
  runtime.remove.mockImplementation(async ({ expectedRevision }) => {
    if (
      !runtime.server?.payload ||
      expectedRevision !== runtime.server.revision
    )
      throw Object.assign(new Error("delete conflict"), {
        data: { code: "CONFLICT" },
      });
    runtime.server = {
      ...runtime.server,
      revision: expectedRevision + 1,
      payload: null,
    };
    return { revision: runtime.server.revision, updatedAt: "now" };
  });
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No production transport allowed");
    })
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("sales order durable drafts with real hook and bounded offline transport", () => {
  it("starts from server authority and does not load any local draft before identity is verified", async () => {
    runtime.server = {
      draftId: 1,
      revision: 4,
      updatedAt: "now",
      payload: payload("server"),
    };
    saveSalesOrderDraft(
      JSON.stringify([7, 19, 3]),
      record(payload("old local"), 2)
    );
    runtime.ready = false;
    await render();
    expect(runtime.get).not.toHaveBeenCalled();
    expect(draft.restored).toBe(false);
    runtime.ready = true;
    await render();
    expect(draft.initialPayload?.company?.confirmationNote).toBe("server");
  });
  it("persists the full original request locally before sending a CAS save, using no stock reservation API", async () => {
    await render();
    const original = payload("电话确认", true);
    runtime.save.mockImplementationOnce(
      async ({ expectedRevision, payload: value }) => {
        expect(expectedRevision).toBe(0);
        expect(loadSalesOrderDraft(draft.identity)?.payload).toEqual(original);
        expect(value.company.uncertain).toEqual(pending());
        runtime.server = {
          draftId: 1,
          revision: 1,
          updatedAt: "now",
          payload: value,
        };
        return { revision: 1, updatedAt: "now" };
      }
    );
    await act(async () => {
      await draft.persist(original, true);
    });
    expect(loadSalesOrderDraft(draft.identity)?.revision).toBe(1);
  });
  it("reconciles a committed but timed-out save via identical get payload, then adopts only its proved revision", async () => {
    await render();
    runtime.mode = "unknown";
    await act(async () => {
      await draft.persist(payload("one", true), true);
    });
    expect(runtime.get).toHaveBeenCalledTimes(2);
    expect(loadSalesOrderDraft(draft.identity)?.revision).toBe(1);
    runtime.mode = "ok";
    await act(async () => {
      await draft.persist(payload("two", true), true);
    });
    expect(runtime.save.mock.calls[1][0].expectedRevision).toBe(1);
  });
  it("never automatically overwrites a different server draft after unknown CAS/CONFLICT", async () => {
    await render();
    runtime.server = {
      draftId: 1,
      revision: 9,
      updatedAt: "now",
      payload: payload("other tab"),
    };
    runtime.mode = "conflict";
    await act(async () => {
      await expect(
        draft.persist(payload("mine", true), true)
      ).rejects.toThrow();
    });
    expect(
      loadSalesOrderDraft(draft.identity)?.payload.company?.confirmationNote
    ).toBe("mine");
    expect(runtime.server.payload.company.confirmationNote).toBe("other tab");
    await act(async () => {
      await expect(
        draft.persist(payload("attempt overwrite"), true)
      ).rejects.toThrow();
    });
    expect(runtime.save).toHaveBeenCalledTimes(1);
  });
  it("refresh/unmount retains incomplete customer-stage edits even before the debounce sync fires", async () => {
    await render();
    const initial = {
      source: "demand",
      customer: null,
      form: { customerSearch: "客户名字填一半" },
    } as SalesOrderDraftPayload;
    await act(async () => {
      await draft.persist(initial);
    });
    expect(loadSalesOrderDraft(draft.identity)?.payload).toEqual(initial);
    await render("reload");
    expect(draft.initialPayload).toEqual(initial);
  });
  it("same account/company relogin restores a frozen full payload and a different account/company cannot see it", async () => {
    await render();
    await act(async () => {
      await draft.persist(payload("original", true), true);
    });
    const original = draft.identity;
    runtime.ready = false;
    await render("logout");
    expect(draft.initialPayload).toBeNull();
    runtime.ready = true;
    await render("relogin");
    expect(draft.identity).toBe(original);
    expect(draft.initialPayload?.company?.uncertain).toEqual(pending());
    runtime.account = 20;
    runtime.company = 4;
    runtime.server = null;
    await render("other");
    expect(draft.initialPayload).toBeNull();
    expect(loadSalesOrderDraft(original)).not.toBeNull();
  });
  it("success clears only the exact completed payload and does not delete another tab's newer local draft", async () => {
    await render();
    const old = payload("old", true);
    await act(async () => {
      await draft.persist(old, true);
    });
    saveSalesOrderDraft(draft.identity, record(payload("other new"), 2, true));
    await act(async () => {
      await draft.clear(old);
    });
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(
      loadSalesOrderDraft(draft.identity)?.payload.company?.confirmationNote
    ).toBe("other new");
  });
  it("successful same-payload cleanup uses its exact revision and removes the local pending request", async () => {
    await render();
    const old = payload("old", true);
    await act(async () => {
      await draft.persist(old, true);
      await draft.clear(old);
    });
    expect(runtime.remove).toHaveBeenCalledWith({ expectedRevision: 1 });
    expect(loadSalesOrderDraft(draft.identity)).toBeNull();
    expect(runtime.server).toMatchObject({ revision: 2, payload: null });
    expect(draft.writable).toBe(true);
    await act(async () => {
      await draft.persist(payload("new order"), true);
    });
    expect(runtime.save.mock.calls[1][0].expectedRevision).toBe(2);
    expect(runtime.server.revision).toBe(3);
  });
  it("resets initialization/revision without a page key and ignores an old restore response", async () => {
    const oldRead = deferred();
    runtime.get.mockImplementationOnce(() => oldRead.promise);
    await render();
    const oldIdentity = draft.identity;
    runtime.account = 20;
    runtime.company = 4;
    await render();
    expect(draft.restored).toBe(true);
    expect(draft.initialPayload).toBeNull();
    await act(async () => {
      oldRead.resolve({ revision: 99, payload: payload("old account") });
    });
    expect(draft.initialPayload).toBeNull();
    expect(loadSalesOrderDraft(oldIdentity)).toBeNull();
    await act(async () => {
      await draft.persist(payload("new account"), true);
    });
    expect(runtime.save.mock.calls[0][0].expectedRevision).toBe(0);
    expect(loadSalesOrderDraft(draft.identity)?.revision).toBe(1);
  });
  it("rejects persistence until the current account's restore has finished", async () => {
    const read = deferred();
    runtime.get.mockImplementationOnce(() => read.promise);
    await render();
    await expect(draft.persist(payload(), true)).rejects.toThrow("核验");
    expect(runtime.save).not.toHaveBeenCalled();
    expect(loadSalesOrderDraft(draft.identity)).toBeNull();
    await act(async () => {
      read.resolve(null);
    });
    expect(draft.restored).toBe(true);
  });
  it.each(["success", "failure"])(
    "does not accept an old account's late save %s or reconcile via the new account",
    async mode => {
      await render();
      const oldIdentity = draft.identity;
      const save = deferred();
      runtime.save.mockImplementationOnce(() => save.promise);
      let settled!: Promise<void>;
      await act(async () => {
        settled = draft
          .persist(payload("old", true), true)
          .catch(() => undefined);
      });
      runtime.account = 20;
      runtime.company = 4;
      runtime.server = null;
      await render();
      const reads = runtime.get.mock.calls.length;
      await act(async () => {
        if (mode === "success") save.resolve({ revision: 99 });
        else save.reject(new Error("timeout"));
        await settled;
      });
      expect(runtime.get).toHaveBeenCalledTimes(reads);
      expect(draft.notice).toBe("");
      expect(loadSalesOrderDraft(oldIdentity)?.dirty).toBe(true);
      expect(loadSalesOrderDraft(draft.identity)).toBeNull();
      await act(async () => {
        await draft.persist(payload("new"), true);
      });
      expect(runtime.save.mock.calls[1][0].expectedRevision).toBe(0);
    }
  );
  it("ignores a late timeout-reconciliation read after account/company replacement", async () => {
    await render();
    const oldIdentity = draft.identity;
    const replay = deferred();
    runtime.save.mockRejectedValueOnce(new Error("timeout"));
    runtime.get.mockImplementationOnce(() => replay.promise);
    let settled!: Promise<void>;
    await act(async () => {
      settled = draft
        .persist(payload("old", true), true)
        .catch(() => undefined);
    });
    runtime.account = 20;
    runtime.company = 4;
    await render();
    await act(async () => {
      replay.resolve({ revision: 99, payload: payload("old", true) });
      await settled;
    });
    expect(loadSalesOrderDraft(oldIdentity)?.revision).toBe(0);
    expect(loadSalesOrderDraft(draft.identity)).toBeNull();
    expect(draft.notice).toBe("");
    await act(async () => {
      await draft.persist(payload("new"), true);
    });
    expect(runtime.save.mock.calls[1][0].expectedRevision).toBe(0);
  });
  it("retries a restore interrupted by identity revalidation without accepting its late response", async () => {
    const read = deferred();
    runtime.get.mockImplementationOnce(() => read.promise);
    await render();
    runtime.ready = false;
    await render();
    runtime.ready = true;
    await render();
    await act(async () => {
      read.resolve({ revision: 99, payload: payload("stale") });
    });
    expect(draft.initialPayload).toBeNull();
    expect(draft.restored).toBe(true);
    expect(runtime.get).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite another tab's new local draft when deletion fails late", async () => {
    await render();
    const original = payload("old", true);
    await act(async () => {
      await draft.persist(original, true);
    });
    const remove = deferred();
    runtime.remove.mockImplementationOnce(() => remove.promise);
    let cleanup!: Promise<void>;
    await act(async () => {
      cleanup = draft.clear(original);
    });
    const newer = record(payload("new tab"), 2, true);
    saveSalesOrderDraft(draft.identity, newer);
    await act(async () => {
      remove.reject(new Error("delete timeout"));
      await cleanup;
    });
    expect(loadSalesOrderDraft(draft.identity)).toEqual(newer);
    expect(draft.notice).toBe("");
  });
  it.each(["success", "failure"])(
    "ignores late delete %s after an account change",
    async mode => {
      await render();
      const original = payload("old", true);
      await act(async () => {
        await draft.persist(original, true);
      });
      const oldIdentity = draft.identity,
        remove = deferred();
      runtime.remove.mockImplementationOnce(() => remove.promise);
      let cleanup!: Promise<void>;
      await act(async () => {
        cleanup = draft.clear(original);
      });
      runtime.account = 20;
      runtime.company = 4;
      runtime.server = null;
      await render();
      await act(async () => {
        if (mode === "success") remove.resolve({ revision: 2 });
        else remove.reject(new Error("timeout"));
        await cleanup;
      });
      expect(loadSalesOrderDraft(oldIdentity)?.payload).toEqual(original);
      expect(loadSalesOrderDraft(draft.identity)).toBeNull();
      expect(draft.notice).toBe("");
    }
  );
  it("does not revive a successful pending request or conflict on a new draft after a failed delete", async () => {
    await render();
    const original = payload("old", true);
    runtime.remove.mockRejectedValueOnce(new Error("timeout"));
    await act(async () => {
      await draft.persist(original, true);
      await draft.clear(original);
    });
    expect(loadSalesOrderDraft(draft.identity)?.payload.form?.completed).toBe(
      true
    );
    await render("reload");
    expect(draft.initialPayload).toBeNull();
    expect(draft.notice).toBe("");
    await act(async () => {
      await draft.persist(payload("new order"), true);
    });
    expect(runtime.save.mock.calls[1][0].expectedRevision).toBe(1);
    expect(
      loadSalesOrderDraft(draft.identity)?.payload.company?.confirmationNote
    ).toBe("new order");
  });
  it("restores another tab's newer server draft rather than a local completed marker", async () => {
    await render();
    const original = payload("old", true);
    runtime.remove.mockRejectedValueOnce(new Error("timeout"));
    await act(async () => {
      await draft.persist(original, true);
      await draft.clear(original);
    });
    runtime.server = { revision: 8, payload: payload("other tab", true) };
    await render("reload");
    expect(draft.initialPayload).toEqual(payload("other tab", true));
    expect(draft.notice).toBe("");
  });
  it("retains the tombstone revision after a committed delete times out, including across reload", async () => {
    await render();
    const original = payload("old", true);
    runtime.remove.mockImplementationOnce(async () => {
      runtime.server = { ...runtime.server, revision: 2, payload: null };
      throw new Error("timeout after delete commit");
    });
    await act(async () => {
      await draft.persist(original, true);
      await draft.clear(original);
    });
    expect(loadSalesOrderDraft(draft.identity)).toBeNull();
    expect(draft.notice).toBe("");
    await act(async () => {
      await draft.persist(payload("new order"), true);
    });
    expect(runtime.save.mock.calls[1][0].expectedRevision).toBe(2);
    await act(async () => {
      await draft.clear(payload("new order"));
    });
    await render("reload tombstone");
    expect(draft.initialPayload).toBeNull();
    expect(draft.writable).toBe(true);
    await act(async () => {
      await draft.persist(payload("another new order"), true);
    });
    expect(runtime.save.mock.calls[2][0].expectedRevision).toBe(4);
  });
  it("starts an empty tombstone draft with its actual CAS token, not wildcard zero", async () => {
    runtime.server = {
      draftId: 1,
      revision: 6,
      updatedAt: "now",
      payload: null,
    };
    await render();
    expect(draft.initialPayload).toBeNull();
    expect(draft.restored).toBe(true);
    expect(draft.writable).toBe(true);
    await act(async () => {
      await draft.persist(payload("new after tombstone"), true);
    });
    expect(runtime.save.mock.calls[0][0].expectedRevision).toBe(6);
    expect(loadSalesOrderDraft(draft.identity)?.revision).toBe(7);
  });
  it("rejects an old delayed save0 after another tab's save/delete ABA without rebasing its editable draft", async () => {
    await render();
    const tombstone = {
      draftId: 1,
      revision: 2,
      updatedAt: "now",
      payload: null,
    };
    runtime.server = tombstone;
    await act(async () => {
      await expect(
        draft.persist(payload("old first save"), true)
      ).rejects.toThrow("conflict");
    });
    expect(runtime.save.mock.calls[0][0].expectedRevision).toBe(0);
    expect(runtime.server).toEqual(tombstone);
    expect(draft.writable).toBe(false);
    await act(async () => {
      draft.retryRestore();
    });
    expect(draft.initialPayload).toBeNull();
    expect(loadSalesOrderDraft(draft.identity)).toBeNull();
    const backup = JSON.parse(localStorage.getItem(`${salesOrderDraftKey(draft.identity)}:conflict-backup`)!);
    expect(backup.payload).toEqual(payload("old first save"));
    expect(backup.revision).toBe(0);
    expect(draft.writable).toBe(true);
    expect(runtime.server).toEqual(tombstone);
    expect(runtime.save).toHaveBeenCalledTimes(1);
    await act(async () => { await draft.persist(payload("new attempt"), true); });
    expect(runtime.save.mock.calls[1][0].expectedRevision).toBe(2);
    expect(runtime.server.revision).toBe(3);
  });
  it("explicitly re-reads a newer ordinary server draft without writing or losing the old editable form", async () => {
    await render();
    const newer = { draftId: 1, revision: 8, updatedAt: "now", payload: payload("other tab") };
    runtime.server = newer;
    await act(async () => { await expect(draft.persist(payload("old edit"), true)).rejects.toThrow("conflict"); });
    await act(async () => { draft.retryRestore(); });
    expect(draft.initialPayload).toEqual(newer.payload);
    expect(draft.writable).toBe(true);
    expect(runtime.server).toEqual(newer);
    expect(runtime.save).toHaveBeenCalledTimes(1);
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(`${salesOrderDraftKey(draft.identity)}:conflict-backup`)!).payload).toEqual(payload("old edit"));
  });
  it("keeps the old editable draft blocked if its conflict backup cannot be preserved", async () => {
    await render();
    runtime.server = { draftId: 1, revision: 2, updatedAt: "now", payload: null };
    await act(async () => { await expect(draft.persist(payload("old edit"), true)).rejects.toThrow("conflict"); });
    const originalSet = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
      if (key.endsWith(":conflict-backup")) throw new Error("quota");
      originalSet.call(this, key, value);
    });
    await act(async () => { draft.retryRestore(); });
    expect(draft.writable).toBe(false);
    expect(draft.notice).toContain("无法备份");
    expect(loadSalesOrderDraft(draft.identity)?.payload).toEqual(payload("old edit"));
    expect(runtime.save).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it.each(["success", "failure"])("preserves the original frozen memory request if another tab replaces the primary key with an ordinary edit during re-read (%s)", async outcome => {
    await render();
    const original = payload("original", true);
    const tombstone = { draftId: 1, revision: 2, updatedAt: "now", payload: null };
    runtime.server = tombstone;
    await act(async () => { await expect(draft.persist(original, true)).rejects.toThrow("conflict"); });
    const read = deferred();
    runtime.get.mockReturnValueOnce(read.promise);
    await act(async () => { draft.retryRestore(); });
    saveSalesOrderDraft(draft.identity, record(payload("other tab ordinary"), 0, true));
    await act(async () => { outcome === "success" ? read.resolve(tombstone) : read.reject(new Error("offline deferred read")); });
    expect(draft.initialPayload).toEqual(original);
    expect(draft.writable).toBe(false);
    expect(draft.canVerifyPending).toBe(true);
    expect(loadSalesOrderDraft(draft.identity)?.payload).toEqual(original);
    expect(JSON.parse(localStorage.getItem(`${salesOrderDraftKey(draft.identity)}:conflict-backup`)!).payload).toEqual(payload("other tab ordinary"));
    await act(async () => { await draft.persist(original, true); });
    expect(runtime.save).toHaveBeenCalledTimes(1);
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(runtime.server).toEqual(tombstone);
  });
  it.each(["tombstone", "newer draft"])(
    "allows only local durable verification of the exact original frozen request after unknown save finds %s",
    async kind => {
      await render();
      const original = payload("original", true);
      runtime.server = {
        draftId: 1,
        revision: 8,
        updatedAt: "now",
        payload: kind === "tombstone" ? null : payload("other tab"),
      };
      runtime.save.mockRejectedValueOnce(new Error("timeout before result"));
      await act(async () => {
        await expect(draft.persist(original, true)).rejects.toThrow("timeout");
      });
      const remote = runtime.server;
      expect(draft.writable).toBe(false);
      expect(draft.canVerifyPending).toBe(true);
      await act(async () => {
        await draft.persist(original, true);
      });
      await expect(draft.persist(original)).rejects.toThrow("版本冲突");
      await expect(
        draft.persist(payload("modified", true), true)
      ).rejects.toThrow("版本冲突");
      expect(runtime.save).toHaveBeenCalledTimes(1);
      expect(runtime.server).toEqual(remote);
      expect(loadSalesOrderDraft(draft.identity)?.revision).toBe(0);
      expect(
        loadSalesOrderDraft(draft.identity)?.payload.company?.uncertain
      ).toEqual(original.company?.uncertain);
      await act(async () => { draft.retryRestore(); });
      expect(draft.initialPayload).toEqual(original);
      expect(draft.writable).toBe(false);
      expect(draft.canVerifyPending).toBe(true);
      expect(localStorage.getItem(`${salesOrderDraftKey(draft.identity)}:conflict-backup`)).toBeNull();
      expect(runtime.save).toHaveBeenCalledTimes(1);
      await render("reload blocked request");
      expect(draft.initialPayload).toEqual(original);
      expect(draft.writable).toBe(false);
      expect(draft.canVerifyPending).toBe(true);
      await act(async () => {
        await draft.persist(original, true);
      });
      expect(runtime.save).toHaveBeenCalledTimes(1);
      saveSalesOrderDraft(
        draft.identity,
        record(
          {
            ...original,
            form: { ...original.form, completed: true },
          },
          0,
          true
        )
      );
      await expect(draft.persist(original, true)).rejects.toThrow("订单已保存");
    }
  );
  it.each([0, 1])(
    "retains stale revision %s local work as blocked on tombstone reload",
    async localRevision => {
      const original = payload("old local", localRevision === 1);
      saveSalesOrderDraft(
        JSON.stringify([7, 19, 3]),
        record(original, localRevision, true)
      );
      runtime.server = {
        draftId: 1,
        revision: 2,
        updatedAt: "now",
        payload: null,
      };
      await render();
      expect(draft.initialPayload).toEqual(original);
      expect(draft.writable).toBe(false);
      expect(loadSalesOrderDraft(draft.identity)?.revision).toBe(localRevision);
      expect(runtime.save).not.toHaveBeenCalled();
    }
  );
  it("restores new unsynced edits at the matching empty-state token without blocking them", async () => {
    const value = payload("new local");
    saveSalesOrderDraft(JSON.stringify([7, 19, 3]), record(value, 2, true));
    runtime.server = {
      draftId: 1,
      revision: 2,
      updatedAt: "now",
      payload: null,
    };
    await render();
    expect(draft.initialPayload).toEqual(value);
    expect(draft.writable).toBe(true);
    await act(async () => {
      await draft.persist(value, true);
    });
    expect(runtime.save.mock.calls[0][0].expectedRevision).toBe(2);
  });
  it("cleans a completed local marker on tombstone reload and starts new work at its revision", async () => {
    const completed = {
      ...payload("saved", true),
      form: { version: 1, completed: true },
    };
    saveSalesOrderDraft(JSON.stringify([7, 19, 3]), record(completed, 1, true));
    runtime.server = {
      draftId: 1,
      revision: 2,
      updatedAt: "now",
      payload: null,
    };
    await render();
    expect(draft.initialPayload).toBeNull();
    expect(draft.writable).toBe(true);
    expect(loadSalesOrderDraft(draft.identity)).toBeNull();
    await act(async () => {
      await draft.persist(payload("new"), true);
    });
    expect(runtime.save.mock.calls[0][0].expectedRevision).toBe(2);
  });
  it("does not delete newer work or open new writes when original-request completion cleanup cannot be verified", async () => {
    const original = payload("original", true);
    saveSalesOrderDraft(JSON.stringify([7, 19, 3]), record(original, 1, true));
    const remote = {
      draftId: 1,
      revision: 8,
      updatedAt: "now",
      payload: payload("newer tab"),
    };
    runtime.server = remote;
    await render();
    expect(draft.canVerifyPending).toBe(true);
    await act(async () => {
      await draft.persist(original, true);
      runtime.get.mockRejectedValueOnce(new Error("offline cleanup read"));
      await draft.clear(original);
    });
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(runtime.server).toEqual(remote);
    expect(draft.writable).toBe(false);
    expect(draft.canVerifyPending).toBe(false);
    await expect(draft.persist(payload("new overwrite"), true)).rejects.toThrow(
      "版本冲突"
    );
    expect(runtime.save).not.toHaveBeenCalled();
    expect(loadSalesOrderDraft(draft.identity)?.payload.form?.completed).toBe(
      true
    );
    await act(async () => {
      draft.retryRestore();
    });
    expect(draft.initialPayload).toEqual(remote.payload);
    expect(draft.writable).toBe(true);
  });
  it("does not resurrect an old pending request over another tab's success marker", async () => {
    await render();
    const original = payload("old", true);
    await act(async () => {
      await draft.persist(original, true);
    });
    const completed = {
      ...original,
      form: { ...original.form, completed: true },
    };
    saveSalesOrderDraft(draft.identity, record(completed, 1, true));
    await expect(draft.persist(original, true)).rejects.toThrow("订单已保存");
    expect(loadSalesOrderDraft(draft.identity)?.payload).toEqual(completed);
    expect(runtime.save).toHaveBeenCalledTimes(1);
  });
  it("does not re-add a local pending request deleted by another tab while its save was in flight", async () => {
    await render();
    const save = deferred();
    runtime.save.mockImplementationOnce(() => save.promise);
    let saving!: Promise<void>;
    await act(async () => {
      saving = draft.persist(payload("old", true), true);
    });
    window.localStorage.clear();
    await act(async () => {
      save.resolve({ revision: 1 });
      await saving;
    });
    expect(loadSalesOrderDraft(draft.identity)).toBeNull();
  });
});

describe("draft parser safety and selection", () => {
  it("rejects malformed lot rows and frozen payloads instead of crashing or unlocking them", () => {
    const bad = payload();
    bad.company!.lines = [null];
    expect(() => parseSalesOrderEntryDraft(bad)).toThrow();
    const badRequest = payload("confirm", true);
    badRequest.company!.uncertain = { requestId: "onlyid" };
    expect(() => parseSalesOrderEntryDraft(badRequest)).toThrow();
  });
  it("retains different real batches, precision and full original request during roundtrip", () => {
    const raw = payload("confirm", true);
    const value = parseSalesOrderEntryDraft(raw);
    value.company.lines.push({
      ...value.company.lines[0],
      lot: { ...value.company.lines[0].lot, lotId: 42, lotNumber: "LOT-42" },
    });
    const result = serializeSalesOrderEntryDraft(value);
    expect(result.company?.lines).toHaveLength(2);
    expect(result.company?.uncertain).toEqual(raw.company?.uncertain);
    expect(value.company.lines[0].agreedUnitPrice).toBe("12.3456");
  });
  it("chooses a dirty same-revision local fallback so an immediate refresh cannot lose edits", () => {
    const local = record(payload("new"), 3, true);
    expect(chooseSalesOrderDraft(record(payload("old"), 3), local)).toEqual({
      draft: local,
      conflict: false,
    });
    expect(
      chooseSalesOrderDraft(
        record(payload("newer server"), 4),
        record(payload("mine"), 3, true)
      ).conflict
    ).toBe(true);
  });
  it("compares entire payloads independently of object key order", () => {
    expect(
      draftPayloadEqual(
        { source: "demand", form: { a: 1, b: 2 } },
        { form: { b: 2, a: 1 }, source: "demand" }
      )
    ).toBe(true);
    expect(emptyCompanyStockDraft().pendingRequest).toBeNull();
  });
});
