// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcurementBuyerScope } from "./procurementBuyerSelection";

const fixture = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn(), onSuccess: vi.fn(), onDirty: vi.fn(), onBusy: vi.fn() }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ inbound: { list: { invalidate: fixture.invalidate }, overview: { invalidate: fixture.invalidate } } }), inbound: { bulkCreate: { useMutation: () => ({ mutate: fixture.mutate }) } } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { BulkInboundForm } from "./BulkInboundForm";

const team: ProcurementBuyerScope = { actorUserId: 7002, canChooseBuyer: true, teamId: 9, scope: "team", options: [{ userId: 7002, name: "采购甲", username: "buyer-a" }, { userId: 7003, name: "采购乙", username: "Buyer-B" }] };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(scope: ProcurementBuyerScope | null = team, buyerError = "") { await act(async () => root.render(createElement(BulkInboundForm, { buyerScope: scope, buyerError, onSuccess: fixture.onSuccess, onDirtyChange: fixture.onDirty, onBusyChange: fixture.onBusy }))); }
function button(text: string) { const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === text); if (!result) throw new Error(`Missing button ${text}`); return result; }
async function click(text: string) { await act(async () => button(text).click()); }
async function fill(label: string, value: string) { const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; await act(async () => { const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function select(label: string, value: string) { const input = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function importBuyer(buyer: string, price = "2.26") { await click("粘贴表格"); await fill("Excel TSV", `料号\t数量\t年份/DC\t采购单价\t采购员\t供应商\t仓位\nSTM32\t50\t2026\t${price}\t${buyer}\t供应商甲\tA-01`); await click("读取粘贴"); await click("预览"); }
async function manualRow(price = "2.26") { await click("新增行"); await fill("第2行料号", "stm32"); await fill("第2行数量", "50"); await fill("第2行年份/DC", "2026"); await fill("第2行采购单价", price); await fill("第2行供应商", "供应商甲"); }

describe("real bulk procurement buyer entry", () => {
  it("defaults new manual rows to actor, locks ordinary employee and submits number ID with all original fields", async () => {
    await render({ ...team, canChooseBuyer: false, scope: "self" }); await manualRow();
    const buyer = host.querySelector<HTMLSelectElement>('select[aria-label="第2行采购员"]')!;
    expect(buyer.value).toBe("7002"); expect(buyer.disabled).toBe(true); expect(buyer.options).toHaveLength(2);
    await click("确认录入"); expect(fixture.mutate).toHaveBeenCalledOnce();
    expect(fixture.mutate.mock.calls[0][0]).toMatchObject({ status: "in_transit", unitCostBasis: "CNY_TAX_INCLUDED", taxRate: 13, acceptMissingPrices: false, rows: [{ sourceRow: 2, partNumber: "STM32", qty: 50, prodYear: "2026", unitCost: 2.26, supplierName: "供应商甲", buyerUserId: 7002, operator: "采购甲" }] });
    expect(fixture.onDirty).toHaveBeenCalledWith(true);
  });
  it("leader selects actual candidates, same numeric ID reaches submission", async () => {
    await render(); await manualRow(); await select("第2行采购员", "7003"); await click("确认录入");
    expect(fixture.mutate.mock.calls[0][0].rows[0]).toMatchObject({ buyerUserId: 7003, operator: "采购乙" });
    expect(host.querySelector('input[aria-label="第2行采购员"]')).toBeNull();
  });
  it("unique case-insensitive username import becomes a validated selection", async () => {
    await render(); await importBuyer(" bUyEr-B ");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="第2行采购员"]')!.value).toBe("7003");
    await click("确认录入"); expect(fixture.mutate.mock.calls[0][0].rows[0]).toMatchObject({ buyerUserId: 7003, operator: "采购乙" });
  });
  it.each(["外组采购员", "已停用账号", "不存在", ""])("unknown/cross-team/inactive/blank import %s is rejected without first-choice fallback", async buyer => {
    await render(); await importBuyer(buyer); await click("确认录入"); expect(fixture.mutate).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="第2行采购员"]')!.value).toBe("");
    expect(host.textContent).toContain("导入采购员：");
  });
  it("duplicate names require unique username or an explicit leader selection", async () => {
    await render({ ...team, options: [...team.options, { userId: 7004, name: "采购乙", username: "unique-c" }] }); await importBuyer("采购乙"); await click("确认录入");
    expect(host.textContent).toContain("重名"); expect(fixture.mutate).not.toHaveBeenCalled();
    await select("第2行采购员", "7004"); await click("确认录入"); expect(fixture.mutate.mock.calls[0][0].rows[0].buyerUserId).toBe(7004);
  });
  it("ordinary employee importing someone else never gets silently rewritten to self", async () => {
    await render({ ...team, canChooseBuyer: false, scope: "self" }); await importBuyer("采购乙"); await click("确认录入");
    expect(fixture.mutate).not.toHaveBeenCalled(); expect(host.textContent).toContain("导入采购员：采购乙");
    const buyer = host.querySelector<HTMLSelectElement>('select[aria-label="第2行采购员"]')!; expect(buyer.disabled).toBe(true); expect(buyer.value).toBe("");
  });
  it("candidate error has no free text fallback and no writable create", async () => {
    await render(null, "采购员候选读取失败");
    expect(button("新增行").disabled).toBe(true);
    await render(); await manualRow(); await render(null, "采购员候选读取失败");
    expect(button("新增行").disabled).toBe(true); expect(button("确认录入").disabled).toBe(true);
    expect(host.querySelector('input[aria-label="第2行采购员"]')).toBeNull(); expect(host.textContent).toContain("采购员候选读取失败");
  });
  it("changed options or permissions reject prior selection without defaulting it away", async () => {
    await render(); await importBuyer("buyer-b"); await render({ ...team, options: [team.options[0]] }); await click("确认录入");
    expect(fixture.mutate).not.toHaveBeenCalled(); expect(host.textContent).toContain("候选或身份已变化");
    await render({ ...team, canChooseBuyer: false }); await click("确认录入"); expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it("preserves missing-price confirmation but includes buyer scope in the fingerprint", async () => {
    await render(); await importBuyer("buyer-b", ""); await click("确认录入"); expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    await render({ ...team, options: [team.options[0]] }); await click("按 0 元录入"); expect(fixture.mutate).not.toHaveBeenCalled(); expect(host.textContent).toContain("录入内容已变化");
  });
  it("missing-price acceptance retains valid numeric attribution and direct-inbound warehouse", async () => {
    await render(); await importBuyer("buyer-b", ""); await click("直接入库"); await click("确认录入"); await click("按 0 元录入");
    expect(fixture.mutate.mock.calls[0][0]).toMatchObject({ status: "received", acceptMissingPrices: true, rows: [{ buyerUserId: 7003, operator: "采购乙", unitCost: null, location: "A-01" }] });
  });
  it("uncertain result freezes edits and retries the exact original request even if candidates refresh", async () => {
    fixture.mutate.mockImplementation((_payload, callbacks) => callbacks.onError({ message: "network interrupted" }));
    await render(); await manualRow(); await click("确认录入");
    const original = fixture.mutate.mock.calls[0][0]; expect(host.textContent).toContain("结果未确认");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="第2行采购员"]')!.disabled).toBe(true); expect(button("新增行").disabled).toBe(true);
    await render({ ...team, options: [team.options[0]] }); await click("重试原请求");
    expect(fixture.mutate.mock.calls[1][0]).toBe(original); expect(fixture.onBusy).toHaveBeenCalledWith(true);
  });
});
