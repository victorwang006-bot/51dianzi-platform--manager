// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({
  read: true, write: true, failed: false, identityKey: "AUTH-A", context: null as any, summary: null as any,
  flags: {} as Record<string, any>, inputs: [] as any[], dialog: null as any, inventory: null as any,
  navigate: vi.fn(), retryAuthority: vi.fn(), authorizationError: vi.fn(),
  refetchContext: vi.fn(), refetchSummary: vi.fn(), invalidateContext: vi.fn(), invalidateSummary: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers/801?oldSource=999", state.navigate] }));
vi.mock("./customerSupply", () => ({
  useCustomerSupplyAuthority: (scope: any, ready: boolean) => ({
    identity: ready && scope ? { enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, key: state.identityKey } : null,
    canRead: ready && Boolean(scope) && state.read, canWrite: ready && Boolean(scope) && state.write,
    failed: state.failed, retry: state.retryAuthority, onAuthorizationError: state.authorizationError,
  }),
  supplyLocation: (id: number, tab: string) => `/channel-inventory?supplyChannelId=${id}&supplyTab=${tab}`,
}));
vi.mock("./CustomerSupplyUploadDialog", () => ({ CustomerSupplyUploadDialog: (props: any) => {
  state.dialog = props;
  return React.createElement("div", { role: "dialog", "data-shared-importer": true }, "SHARED-IMPORTER");
} }));
vi.mock("../../../../../api/business-trpc", () => {
  const query = (name: string, data: () => any, refetch: any) => ({ useQuery: (input: any, options: any) => {
    state.inputs.push({ name, input, options });
    return { data: data(), isError: false, isFetching: false, isPlaceholderData: false, isFetchedAfterMount: true,
      ...state.flags[name], refetch };
  } });
  return { trpc: {
    channelInventory: { customerSupplyContext: query("context", () => state.context, state.refetchContext), customerSupplySummary: query("summary", () => state.summary, state.refetchSummary) },
    useUtils: () => ({ channelInventory: { customerSupplyContext: { invalidate: state.invalidateContext }, customerSupplySummary: { invalidate: state.invalidateSummary } } }),
  } };
});
vi.mock("./CustomerChannelInventory", () => ({ CustomerChannelInventory: (props: any) => {
  state.inventory = props;
  return React.createElement("div", { "data-customer-inventory": true }, "CUSTOMER-INVENTORY");
} }));
import { CustomerWorkbenchSupply, type CustomerWorkbenchSupplyProps } from "./CustomerWorkbenchSupply";
const scope = { enterpriseId: 31, actorUserId: 7, canManageAll: false };
const fixture = () => ({ customer: { id: 801, name: "SYNTHETIC", version: 4, industryCode: "electronic_components", archivedAt: null },
  channel: { id: 411, active: true, revision: 2, type: "agent" }, canUpload: true, disabledReason: null });
let root: Root; let host: HTMLDivElement;
const props = (): CustomerWorkbenchSupplyProps => ({ customerId: 801, customerVersion: 4, scope, scopeReady: true });
async function render(overrides: Partial<CustomerWorkbenchSupplyProps> = {}) { await act(async () => root.render(React.createElement(CustomerWorkbenchSupply, { ...props(), ...overrides }))); }
function button(label: string) { const value = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.startsWith(label)); if (!value) throw new Error(`missing ${label}`); return value; }
async function click(label: string) { await act(async () => button(label).click()); }
const input = (name: string) => state.inputs.filter(item => item.name === name).at(-1);
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  state.read = true; state.write = true; state.failed = false; state.identityKey = "AUTH-A";
  state.context = fixture(); state.summary = { items: [{ customerId: 801, channelId: 411, canViewStock: true, materialCount: 9 }] };
  state.flags = {}; state.inputs = []; state.dialog = null; vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("customer supply entry integration without broader API reads", () => {
  it("removes the fixed title description node without adding spacing or replacing controls", async () => {
    await render();
    expect(host.querySelector("h2")?.textContent).toBe("客户渠道库存");
    expect(host.textContent).not.toContain("上传库存自动归属本客户公司；与采购需求、BOM导入分开。");
    expect(host.querySelector("h2")?.nextElementSibling?.tagName).toBe("DIV");
    expect(host.querySelectorAll("p")).toHaveLength(0);
    expect(button("上传库存表").getAttribute("aria-disabled")).toBe("false");
    expect(button("渠道设置").disabled).toBe(false); expect(button("渠道设置").getAttribute("title")).toBeNull();
  });
  it("uses exact scoped context and existing importer, never copies customer fields or invents another upload mode", async () => {
    const onOpenChange = vi.fn(); await render({ onOpenChange });
    expect(input("context").input).toEqual({ customerId: 801, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(input("summary").input).toEqual({ customerIds: [801], expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(input("context").options).toMatchObject({ retry: false, staleTime: 0, placeholderData: undefined, refetchOnMount: "always", refetchOnWindowFocus: false, refetchOnReconnect: false });
    await click("上传库存表");
    expect(host.querySelectorAll("[data-shared-importer]")).toHaveLength(1);
    expect(state.dialog.customerId).toBe(801); expect(state.dialog.identity).toEqual({ enterpriseId: 31, actorUserId: 7, key: "AUTH-A" });
    expect(state.dialog.isCurrent()).toBe(true); expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await act(async () => state.dialog.onComplete());
    expect(state.invalidateContext).toHaveBeenCalledOnce(); expect(state.invalidateSummary).toHaveBeenCalledOnce();
    expect(host.querySelector("[role=dialog]")).not.toBeNull(); // refresh cannot close the portal early
    await act(async () => state.dialog.onClose());
    expect(host.querySelector("[role=dialog]")).toBeNull(); expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
  it("keeps zero-stock bound channel settings and inline inventory reachable despite masked summary channelId", async () => {
    state.summary.items[0] = { customerId: 801, channelId: null, canViewStock: false, materialCount: 0 };
    await render(); expect(button("渠道设置").disabled).toBe(false);
    await click("渠道设置"); expect(state.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=channels");
    expect(state.inventory.customerId).toBe(801); expect(state.inventory.enabled).toBe(true);
    expect(host.querySelector("[data-customer-inventory]")).not.toBeNull(); expect(host.textContent).not.toContain("回收站");
  });
  it("retains read-only channel settings and material navigation without granting upload", async () => {
    state.write = false; state.context.canUpload = false; state.context.disabledReason = "真实只读原因";
    await render(); expect(button("渠道设置").disabled).toBe(false);
    expect(button("上传库存表").getAttribute("aria-disabled")).toBe("true"); await click("上传库存表");
    expect(host.querySelector("[role=dialog]")).toBeNull(); await click("渠道设置");
    expect(state.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=channels");
    expect(host.textContent).toContain("编辑能力仍由原渠道页面核验");
    expect(host.textContent).toContain("真实只读原因");
  });
  it("keeps native source-read independent from material-write, permitting only original context-approved upload", async () => {
    state.read = false; await render();
    expect(input("summary").options.enabled).toBe(false); expect(input("context").options.enabled).toBe(true);
    expect(button("渠道设置").disabled).toBe(true); expect(host.textContent).not.toContain("查看供应库存");
    await click("上传库存表"); expect(state.dialog.isCurrent()).toBe(true);
  });
  it("offers manual existing-channel association only through the existing upload dialog when context proves unbound", async () => {
    state.context.channel = null; state.summary.items[0] = { customerId: 801, channelId: null, canViewStock: false, materialCount: 0 };
    await render(); expect(button("渠道设置").disabled).toBe(true);
    const reason = "当前上传负责人尚未绑定供货渠道，可在上传库存表中人工选择并确认关联现有渠道。";
    expect(button("渠道设置").title).toBe(reason);
    expect(host.textContent).not.toContain(reason); expect(host.textContent).not.toContain("人工选择并确认关联现有渠道");
    expect(host.textContent).not.toContain("上传库存自动归属本客户公司；与采购需求、BOM导入分开。");
    expect(host.querySelectorAll("p")).toHaveLength(0);
    expect(button("上传库存表").getAttribute("aria-disabled")).toBe("false");
    expect(input("context").input.customerId).toBe(801); expect(input("context").options.enabled).toBe(true);
    expect(input("summary").input.customerIds).toEqual([801]); expect(input("summary").options.enabled).toBe(true);
    await click("渠道设置"); expect(state.navigate).not.toHaveBeenCalled();
    await click("上传库存表"); expect(host.querySelector("[data-shared-importer]")).not.toBeNull();
    expect(state.dialog.customerId).toBe(801); expect(state.dialog.isCurrent()).toBe(true);
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it.each(["no-read", "context-error", "pending", "actual-denial"])("retains the visible %s settings reason and original disabled/title behavior", async kind => {
    let reason: string;
    if (kind === "no-read") { state.read = false; reason = "暂无供货设置查看权限。"; }
    else if (kind === "context-error") { state.flags.context = { isError: true, error: new Error("FORBIDDEN") }; reason = "供货设置读取失败，请重试。"; }
    else if (kind === "pending") { state.context = null; reason = "正在核验客户供货关联…"; }
    else { state.context.channel = null; state.context.canUpload = false; state.context.disabledReason = "真实供货关联读取权限不足"; reason = state.context.disabledReason; }
    await render();
    expect(button("渠道设置").disabled).toBe(true); expect(button("渠道设置").title).toBe(reason);
    expect([...host.querySelectorAll("p")].some(node => node.textContent === reason)).toBe(true);
    expect(host.textContent).not.toContain("上传库存自动归属本客户公司；与采购需求、BOM导入分开。");
    await click("渠道设置"); expect(state.navigate).not.toHaveBeenCalled();
  });
  it("does not interpret masked unreadable context as unbound or offer unauthorized association", async () => {
    state.context.channel = null; state.context.canUpload = false; state.context.disabledReason = "暂无权限读取关联库存来源，请联系有权人员确认";
    state.summary.items[0] = { customerId: 801, channelId: null, canViewStock: false, materialCount: 0 };
    await render(); expect(host.textContent).toContain(state.context.disabledReason);
    expect(host.textContent).not.toContain("尚未绑定"); expect(host.textContent).not.toContain("人工选择");
    await click("上传库存表"); expect(host.querySelector("[role=dialog]")).toBeNull();
  });
  it.each(["archived", "industry", "disabled", "inactive", "wrong-customer", "wrong-version"])("fails closed for %s without guessing a channel or widening write rights", async kind => {
    if (kind === "archived") state.context.customer.archivedAt = "2026-11-01";
    if (kind === "industry") state.context.customer.industryCode = "invented-industry";
    if (kind === "disabled") { state.context.canUpload = false; state.context.disabledReason = "负责人已变化"; }
    if (kind === "inactive") state.context.channel.active = false;
    if (kind === "wrong-customer") state.context.customer.id = 802;
    if (kind === "wrong-version") state.context.customer.version = 5;
    await render(); expect(button("上传库存表").getAttribute("aria-disabled")).toBe("true");
    await click("上传库存表"); expect(host.querySelector("[role=dialog]")).toBeNull();
    if (["archived", "inactive", "disabled"].includes(kind)) expect(button("渠道设置").disabled).toBe(false);
    else if (kind.startsWith("wrong")) expect(button("渠道设置").disabled).toBe(true);
  });
  it("rejects retained placeholder/unmounted context proof and keeps errors retryable", async () => {
    for (const flags of [{ isFetching: true }, { isPlaceholderData: true }, { isFetchedAfterMount: false }]) {
      state.flags.context = flags; await render(); await click("上传库存表");
      expect(host.querySelector("[role=dialog]")).toBeNull(); expect(button("渠道设置").disabled).toBe(true);
    }
    const error = new Error("FORBIDDEN"); state.flags.context = { isError: true, error }; await render();
    expect(state.authorizationError).toHaveBeenCalledWith(error); await click("重试供应库存");
    expect(state.refetchContext).toHaveBeenCalledOnce(); expect(state.refetchSummary).toHaveBeenCalledOnce();
  });
  it("keeps the existing importer mounted during ordinary metadata refetch but revokes it on actual denial", async () => {
    const onOpenChange = vi.fn(); await render({ onOpenChange }); await click("上传库存表"); const dialog = state.dialog;
    state.flags.context = { isFetching: true }; await render({ onOpenChange });
    expect(host.querySelector("[role=dialog]")).not.toBeNull(); expect(dialog.isCurrent()).toBe(true);
    state.flags.context = { isError: true, error: new Error("授权已撤销") }; await render({ onOpenChange });
    expect(host.querySelector("[role=dialog]")).toBeNull(); expect(dialog.isCurrent()).toBe(false); expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
  it.each(["identity", "customer-version", "parent", "scope"])("invalidates %s changes and suppresses late completion and close callbacks", async kind => {
    const onOpenChange = vi.fn(); await render({ onOpenChange }); await click("上传库存表"); const old = state.dialog;
    let changes: Partial<CustomerWorkbenchSupplyProps> = {};
    if (kind === "identity") state.identityKey = "AUTH-B";
    if (kind === "customer-version") changes = { customerVersion: 5 };
    if (kind === "parent") changes = { isCurrent: () => false };
    if (kind === "scope") changes = { scopeReady: false, scope: null };
    await render({ ...changes, onOpenChange }); expect(old.isCurrent()).toBe(false); expect(host.querySelector("[role=dialog]")).toBeNull();
    await act(async () => { old.onComplete(); old.onClose(); });
    expect(state.invalidateContext).not.toHaveBeenCalled(); expect(state.invalidateSummary).not.toHaveBeenCalled();
  });
  it("locks delayed parent-approved upload and settings actions to verified identity and binding", async () => {
    let pending!: () => void; const onAction = (action: () => void) => { pending = action; };
    await render({ onAction }); await click("渠道设置"); state.context.channel.id = 412; await render({ onAction });
    await act(async () => pending()); expect(state.navigate).not.toHaveBeenCalled();
    await click("上传库存表"); state.identityKey = "AUTH-B"; await render({ onAction });
    await act(async () => pending()); expect(host.querySelector("[role=dialog]")).toBeNull();
  });
  it("cannot resurrect an AUTH-A importer after AUTH-A→B→A or leak old completion to a new importer", async () => {
    await render(); await click("上传库存表"); const old = state.dialog;
    state.identityKey = "AUTH-B"; await render(); state.identityKey = "AUTH-A"; await render(); await click("上传库存表");
    const current = state.dialog; expect(current.isCurrent()).toBe(true); expect(old.isCurrent()).toBe(false);
    await act(async () => { old.onClose(); old.onComplete(); }); expect(host.querySelector("[role=dialog]")).not.toBeNull();
    expect(state.invalidateContext).not.toHaveBeenCalled();
  });
  it("removes broader reads when neither original grant or scope is available", async () => {
    state.write = false; state.read = false; await render();
    expect(input("context").options.enabled).toBe(false); expect(input("summary").options.enabled).toBe(false);
    expect(state.inputs.every(item => !item.input.keyword && !item.input.channelId)).toBe(true);
  });
});

it("ends an ordinary closed session before reopening, suppressing old completion and close callbacks", async () => {
  await render(); await click("上传库存表"); const old = state.dialog;
  await act(async () => old.onClose()); expect(old.isCurrent()).toBe(false);
  await click("上传库存表"); const current = state.dialog; expect(current.isCurrent()).toBe(true);
  await act(async () => { old.onComplete(); old.onClose(); });
  expect(current.isCurrent()).toBe(true); expect(host.querySelector("[role=dialog]")).not.toBeNull();
  expect(state.invalidateContext).not.toHaveBeenCalled(); expect(state.invalidateSummary).not.toHaveBeenCalled();
});

it("suppresses only the fixed settings paragraph in source while retaining its reason, tooltip and query/action guards", () => {
  const source = readFileSync("client/src/business/platform/client/src/components/customers/CustomerWorkbenchSupply.tsx", "utf8");
  const reason = "当前上传负责人尚未绑定供货渠道，可在上传库存表中人工选择并确认关联现有渠道。";
  expect(source).not.toContain('<p className="customer-detail-meta">上传库存自动归属本客户公司；与采购需求、BOM导入分开。</p>');
  expect(source).toContain(`: !boundChannelId ? context.canUpload ? "${reason}"`);
  expect(source).toContain(`{settingsReason ? settingsReason === "${reason}" ? null : <p className="customer-detail-meta">{settingsReason}</p>`);
  expect(source).toContain('disabled={Boolean(settingsReason)} title={settingsReason || undefined} onClick={viewSettings}>渠道设置');
  expect(source).toContain('aria-disabled={!canUpload} aria-describedby={uploadReason ? descriptionId : undefined}');
  expect(source).toContain("enabled: readEnabled, retry: false, staleTime: 0, placeholderData: undefined");
  expect(source).toContain("enabled: contextEnabled, retry: false, staleTime: 0, placeholderData: undefined");
  expect(source).toContain("withCustomerContactScope(scope, { customerId })");
  expect(source).toContain("withCustomerContactScope(scope, { customerIds: [customerId] })");
  expect(source).toContain("if (!identity || !context || !canUpload || openRef.current) return;");
  expect(source).toContain("if (!identity || !readEnabled || !boundChannelId) return;");
});
