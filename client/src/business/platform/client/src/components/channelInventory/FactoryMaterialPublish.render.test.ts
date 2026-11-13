// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ publish: vi.fn(), hook: vi.fn(), previewHook: vi.fn(), complete: vi.fn(), authorizationError: vi.fn(),
  preview: { data: undefined as unknown, isFetching: false, error: null as unknown } }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { channelInventory: {
  publishFactoryMaterial: { useMutation: () => { runtime.hook(); return { mutateAsync: runtime.publish }; } },
  previewFactoryMaterialReception: { useQuery: (input: unknown, options: unknown) => { runtime.previewHook(input, options); return runtime.preview; } },
} } }));
import { factoryMaterialPublicPrice, useFactoryMaterialPublish, type FactoryMaterialPublishRow, type FactoryMaterialPublishResult } from "./FactoryMaterialPublish";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original = { id: 901, revision: 4, partNumber: "SYNTHETIC-MODEL", brand: "TI", qty: 9, price: "1.230000000001", canPublish: true, publicationStatus: "unpublished" as const,
  channelName: "SECRET-SOURCE", contactName: "SECRET-CONTACT", note: "SECRET-INTERNAL-NOTE" };
const receipt: FactoryMaterialPublishResult = { materialId: 901, publicId: "ocp_0123456789abcdef0123456789abcdef", status: "published", revision: 4 };
let props: { rows: FactoryMaterialPublishRow[]; authorized: boolean; available: boolean; proofReady: boolean; proofVersion?: number; scopeKey: string; context: { expectedEnterpriseId: number; expectedActorUserId: number } };
let root: Root; let container: HTMLDivElement;
function TestPublish() {
  const publishing = useFactoryMaterialPublish({ ...props, isCurrent: () => true, onComplete: runtime.complete, onAuthorizationError: runtime.authorizationError });
  return React.createElement("section", { className: "ci-page ci-host" }, props.rows.map(row => React.createElement("div", { key: row.id }, publishing.action(row))), publishing.dialog);
}
function render() { act(() => root.render(React.createElement(TestPublish))); }
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
beforeEach(() => {
  vi.clearAllMocks(); runtime.publish.mockReset().mockResolvedValue(receipt); runtime.complete.mockResolvedValue(undefined);
  runtime.preview = { data: { reception: { status: "pending", recipientName: null, responsibilityVersion: 4,
    reason: "首次发布尚无当前有效公开接待证据；发布后须重新核验真实员工与接待权限" } }, isFetching: false, error: null };
  props = { rows: [{ ...original }], authorized: true, available: true, proofReady: true, scopeKey: "enterprise-31-actor-7-v1", context: { expectedEnterpriseId: 31, expectedActorUserId: 7 } };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Production publishing network forbidden in synthetic fixtures"); }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("FactoryMaterialPublish synthetic-only confirmation", () => {
  it("mounts no new API hook until the first click and exposes only the allow-listed preview", () => {
    render(); expect(runtime.hook).not.toHaveBeenCalled(); expect(runtime.publish).not.toHaveBeenCalled();
    click(button("发布")); expect(runtime.hook).toHaveBeenCalled(); expect(runtime.publish).not.toHaveBeenCalled();
    const dialog = required(container.querySelector('[role="dialog"]'));
    expect(dialog.textContent).toContain("SYNTHETIC-MODEL"); expect(dialog.textContent).toContain("TI"); expect(dialog.textContent).toContain("9"); expect(dialog.textContent).toContain("¥1.230000000001");
    expect(dialog.textContent).toContain("不会公开渠道来源、联系人或内部备注");
    for (const secret of ["SECRET-SOURCE", "SECRET-CONTACT", "SECRET-INTERNAL-NOTE"]) expect(container.innerHTML).not.toContain(secret);
    expect(dialog.querySelectorAll("dt")).toHaveLength(4); expect(dialog.querySelector("input, textarea")).toBeNull();
    click(button("取消")); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.publish).not.toHaveBeenCalled();
  });
  it("sends exactly the CAS/UUID/authenticated subject input only on final confirmation", async () => {
    render(); click(button("发布")); click(button("确认发布")); await settle();
    expect(runtime.publish).toHaveBeenCalledTimes(1); expect(runtime.publish).toHaveBeenCalledWith({ materialId: 901, expectedRevision: 4, requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(runtime.complete).toHaveBeenCalledTimes(1); expect(button("已发布").disabled).toBe(true); expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it.each(["role", "server", "missing", "status", "unavailable"])("fails closed on %s denial, never substituting canEdit for canPublish", denial => {
    if (denial === "role") props.authorized = false;
    if (denial === "server") props.rows = [{ ...original, canPublish: false }];
    if (denial === "missing") props.rows = [{ ...original, canPublish: undefined }];
    if (denial === "status") props.rows = [{ ...original, publicationStatus: undefined }];
    if (denial === "unavailable") props.available = false;
    render(); expect(button("发布").disabled).toBe(true); click(button("发布")); expect(runtime.hook).not.toHaveBeenCalled(); expect(runtime.publish).not.toHaveBeenCalled();
  });
  it("displays server-published materials as disabled even when permission hints are stale", () => {
    props.rows = [{ ...original, publicationStatus: "published" }]; render(); expect(button("已发布").disabled).toBe(true); expect(runtime.hook).not.toHaveBeenCalled();
  });
  it.each([null, 0, -1, 1.5, NaN, 2_147_483_648])("disables publishing invalid quantity %s", qty => {
    props.rows = [{ ...original, qty }]; render(); expect(button("发布").disabled).toBe(true); expect(runtime.hook).not.toHaveBeenCalled();
  });
  it.each([{ partNumber: "　 " }, { brand: " " }, { revision: 0 }])("disables invalid required material fields %s", invalid => {
    props.rows = [{ ...original, ...invalid }]; render(); expect(button("发布").disabled).toBe(true);
  });
  it.each([null, "0", "0.000", "-1", "1e2", "invalid", " 2.0", "1.0000000000001"])("omits nonpositive/invalid price %s without preventing valid stock publishing", price => {
    props.rows = [{ ...original, price }]; render(); click(button("发布")); expect(container.querySelectorAll("dt")).toHaveLength(3); expect(container.textContent).not.toContain("报价 CNY");
    expect(factoryMaterialPublicPrice(price)).toBeUndefined();
  });
  it("preserves tiny positive prices exactly without numeric coercion", () => { expect(factoryMaterialPublicPrice("0.000000000001")).toBe("0.000000000001"); });
  it.each([{ error: new Error("timeout"), locked: true }, { error: Object.assign(new Error("denied"), { data: { code: "FORBIDDEN" } }), locked: false }])("retains exact UUID and preview; only uncertain attempt stays locked: %s", async ({ error, locked }) => {
    runtime.publish.mockRejectedValueOnce(error).mockResolvedValueOnce(receipt); render(); click(button("发布")); click(button("确认发布")); await settle();
    const first = runtime.publish.mock.calls[0][0]; expect(button("取消").disabled).toBe(locked); expect(required(container.querySelector<HTMLButtonElement>('[aria-label="关闭确认"]')).disabled).toBe(locked);
    expect(runtime.complete).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("已发布"); expect(runtime.authorizationError).toHaveBeenCalledWith(error);
    props.rows = [{ ...original, revision: 12, partNumber: "CHANGED-AFTER-TIMEOUT", price: "99" }]; render();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("SYNTHETIC-MODEL"); expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("CHANGED-AFTER-TIMEOUT");
    click(button(locked ? "按原请求重试" : "确认发布")); await settle(); expect(runtime.publish.mock.calls[1][0]).toEqual(first); expect(runtime.complete).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...receipt, materialId: 902 }, { ...receipt, status: "draft" }, { ...receipt, revision: 3 }, { ...receipt, revision: 5 }, { ...receipt, publicId: "901" }])("never converts malformed receipt %s into fake success", async result => {
    runtime.publish.mockResolvedValue(result); render(); click(button("发布")); click(button("确认发布")); await settle();
    expect(runtime.complete).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("已发布"); expect(button("按原请求重试")).toBeTruthy();
  });
  it("coalesces rapid final confirmation clicks into one mutation", async () => {
    let finish!: (value: FactoryMaterialPublishResult) => void;
    runtime.publish.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(); click(button("发布")); const confirm = button("确认发布");
    act(() => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(runtime.publish).toHaveBeenCalledTimes(1); await act(async () => { finish(receipt); }); expect(runtime.complete).toHaveBeenCalledTimes(1);
  });
  it.each(["actor", "enterprise", "role", "permission", "authority"])("discards old private snapshot on %s change and ignores a late success", async change => {
    let finish!: (value: FactoryMaterialPublishResult) => void;
    runtime.publish.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(); click(button("发布")); click(button("确认发布"));
    if (change === "actor") { props.context = { ...props.context, expectedActorUserId: 8 }; props.scopeKey = "actor-8"; }
    if (change === "enterprise") { props.context = { ...props.context, expectedEnterpriseId: 32 }; props.scopeKey = "enterprise-32"; }
    if (change === "role") props.authorized = false;
    if (change === "permission") props.rows = [{ ...original, canPublish: false }];
    if (change === "authority") props.available = false;
    render(); expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { finish(receipt); }); expect(runtime.complete).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("已发布");
  });
  it("does not treat a same-authority polling load as a permission change", async () => {
    runtime.publish.mockRejectedValueOnce(new Error("timeout")); render(); click(button("发布")); click(button("确认发布")); await settle();
    props.proofReady = false; props.rows = []; render(); expect(container.querySelector('[role="dialog"]')).not.toBeNull(); expect(button("按原请求重试")).toBeTruthy();
  });
});

it.each(["material-version", "new-server-result"])("does not let old publication receipt override %s", async change => {
 props.proofVersion = 1; render(); click(button("发布")); click(button("确认发布")); await settle();
 expect(button("已发布").disabled).toBe(true);
 if (change === "material-version") props.rows = [{ ...original, revision: 5, publicationStatus: "unpublished" }];
 else props.proofVersion = 2;
 render(); expect(button("发布").disabled).toBe(false); expect(container.textContent).not.toContain("已发布");
});

it("allows cancelling a definite CAS conflict and separately confirming the fresh version", async () => {
 const conflict = Object.assign(new Error("库存已变化，请重新确认"), { data: { code: "CONFLICT" } });
 runtime.publish.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ ...receipt, revision: 5 });
 render(); click(button("发布")); click(button("确认发布")); await settle();
 const first = runtime.publish.mock.calls[0][0]; expect(button("取消").disabled).toBe(false);
 click(button("取消")); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.publish).toHaveBeenCalledTimes(1);
 props.rows = [{ ...original, revision: 5 }]; render(); click(button("发布")); click(button("确认发布")); await settle();
 const next = runtime.publish.mock.calls[1][0]; expect(next.expectedRevision).toBe(5); expect(next.requestId).not.toBe(first.requestId);
 expect(runtime.complete).toHaveBeenCalledTimes(1); expect(button("已发布").disabled).toBe(true);
});

it("missing reception evidence is pending, never defaulting to publishing actor or brand", () => {
  render(); click(button("发布"));
  expect(container.querySelector("[data-factory-reception-preview]")?.textContent).toContain("接待待配置");
  expect(container.textContent).toContain("管理员代操作不会成为接待人");
  expect(runtime.publish).not.toHaveBeenCalled();
});
it("shows trusted real employee behind the platform brand, but sends no recipient identity", async () => {
  runtime.preview.data = { reception: { status: "ready", recipientName: "SYNTHETIC-REAL-STAFF", responsibilityVersion: 9, reason: null } };
  render(); click(button("发布"));
  expect(container.querySelector("[data-factory-reception-preview]")?.textContent).toContain("前台以51电子网工厂渠道接待展示，实际由SYNTHETIC-REAL-STAFF接待");
  expect(runtime.publish).not.toHaveBeenCalled(); click(button("确认发布")); await settle();
  for (const field of ["recipientName", "recipientAdminUserId", "recipientFrontendUserId", "reception"])
    expect(runtime.publish.mock.calls[0][0]).not.toHaveProperty(field);
});
it.each([null, "", "   "])("ready hint without actual employee name %j remains pending", recipientName => {
  props.rows = [{ ...original, reception: { status: "ready", recipientName, responsibilityVersion: 9 } }];
  render(); click(button("发布")); expect(container.querySelector("[data-factory-reception-preview]")?.textContent).toContain("接待待配置");
});

it("queries only selected real material on demand, never list/receiver/owner fields", () => {
  props.rows = [{ ...original }, { ...original, id: 902 }]; render();
  expect(runtime.previewHook).not.toHaveBeenCalled();
  click(button("发布"));
  expect(runtime.previewHook).toHaveBeenCalledWith({ materialId: 901, expectedRevision: 4, expectedEnterpriseId: 31, expectedActorUserId: 7 },
    expect.objectContaining({ staleTime: 0, gcTime: 0, retry: false, trpc: { abortOnUnmount: true } }));
  expect(container.textContent).toContain("发布后须重新核验");
  expect(runtime.publish).not.toHaveBeenCalled();
});
it("never trusts stale ready list metadata while current single-item evidence is pending", () => {
  props.rows = [{ ...original, reception: { status: "ready", recipientName: "STALE-NAME", responsibilityVersion: 9 } }];
  render(); click(button("发布")); expect(container.textContent).not.toContain("STALE-NAME");
  expect(container.querySelector("[data-factory-reception-preview]")?.textContent).toContain("接待待配置");
});
it.each(["loading", "error", "malformed", "identity-leak"])("blocks final publish while preview is %s", state => {
  if (state === "loading") runtime.preview.isFetching = true;
  if (state === "error") runtime.preview.error = new Error("denied");
  if (state === "malformed") runtime.preview.data = { reception: { status: "ready", recipientName: null, responsibilityVersion: 4 } };
  if (state === "identity-leak") runtime.preview.data = { reception: { status: "ready", recipientName: "Staff", responsibilityVersion: 4, recipientUserId: 7 } };
  render(); click(button("发布")); expect(button("确认发布").disabled).toBe(true);
  click(button("确认发布")); expect(runtime.publish).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("实际由Staff接待");
});
it("published-ready material supports authorized read-only actual employee preview without republishing", () => {
  props.rows = [{ ...original, publicationStatus: "published" }];
  runtime.preview.data = { reception: { status: "ready", recipientName: "CURRENT-ACTUAL-STAFF", responsibilityVersion: 11 } };
  render(); expect(button("已发布").disabled).toBe(true); expect(runtime.previewHook).not.toHaveBeenCalled();
  click(button("接待预览")); expect(container.textContent).toContain("实际由CURRENT-ACTUAL-STAFF接待");
  expect(container.textContent).not.toContain("确认发布材料");
  click(button("关闭")); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.publish).not.toHaveBeenCalled();
});
it("discards a reception preview synchronously on enterprise or actor switch", () => {
  runtime.preview.data = { reception: { status: "ready", recipientName: "OLD-SCOPE-STAFF", responsibilityVersion: 9 } };
  render(); click(button("发布")); expect(container.textContent).toContain("OLD-SCOPE-STAFF");
  props.context = { expectedEnterpriseId: 32, expectedActorUserId: 8 }; props.scopeKey = "new-scope";
  render(); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.textContent).not.toContain("OLD-SCOPE-STAFF");
  expect(runtime.publish).not.toHaveBeenCalled();
});
it("an uncertain write still retries its exact original UUID if preview later becomes unavailable", async () => {
  runtime.publish.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(receipt);
  render(); click(button("发布")); click(button("确认发布")); await settle();
  const first = runtime.publish.mock.calls[0][0];
  runtime.preview.error = new Error("preview temporarily unavailable"); render();
  expect(button("按原请求重试").disabled).toBe(false); click(button("按原请求重试")); await settle();
  expect(runtime.publish.mock.calls[1][0]).toEqual(first); expect(runtime.complete).toHaveBeenCalledOnce();
});
