// @vitest-environment jsdom
// UI-only fixtures. Every API and scope dependency is mocked; no production request is made.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  scope: {} as any, status: {} as any, rows: [] as any[], candidates: [] as any[],
  queries: [] as { input: any; options: any }[],
  create: vi.fn(), exact: vi.fn(), link: vi.fn(), save: vi.fn(), publish: vi.fn(), offshelf: vi.fn(), receipt: vi.fn(),
  success: vi.fn(), error: vi.fn(), info: vi.fn(), invalidate: vi.fn(), refetch: vi.fn(), authorizationError: vi.fn(),
}));
vi.mock("../business/BusinessScope", () => ({ useBusinessScope: () => h.scope }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, info: h.info } }));
vi.mock("../business/api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ mallInventory: { list: { invalidate: h.invalidate } }, client: { inventory: { create: { mutate: h.create } }, mallInventory: { list: { query: h.exact }, link: { mutate: h.link }, save: { mutate: h.save }, publish: { mutate: h.publish }, offshelf: { mutate: h.offshelf }, requestStatus: { query: h.receipt } } } }),
  mallInventory: {
    status: { useQuery: () => ({ data: h.status, refetch: h.refetch, isError: false, isLoading: false }) },
    list: { useQuery: (input: any, options: any) => { h.queries.push({ input, options }); const items = input.visibility === "unlinked" ? h.candidates : h.rows; return { data: { items, total: items.length }, isFetching: false, isError: false }; } },
  },
} }));
import MallMaterials, { emptyForm, formData, parseTiers, validQuoteTiers, firstEligibleQuote } from "../business/MallMaterials";
let root: Root | undefined;
let host: HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = (overrides: Record<string, unknown> = {}) => ({ inventoryId: 101, partNumber: "LOCAL-PART-A", brand: "LOCAL-BRAND", pkg: "QFN", dateCode: "2601", qtyStock: 200, qtyOnSale: 100, qtyOrder: null, priceEx: "1", moq: 10, spq: 2, leadTime: "3天", taxIncluded: true, note: "本地测试", category: "本地分类", warehouseAddress: "本地仓库", rohs: false, invoice: false, photos: [{ key: "local-fixture/a.png", url: "/local-fixture/a.png", name: "a", mimeType: "image/png", size: 100 }], ladderPrices: [{ minQty: 10, price: 8 }, { minQty: 100, price: 5 }], publicationStatus: "draft", status: "draft", linked: true, isSelfOperated: false, publicationVersion: 4, inventoryUpdatedAt: "2026-01-01T00:00:00.000Z", ownershipVersion: 3, inventoryFingerprint: "a".repeat(64), ...overrides });
beforeEach(() => {
  vi.resetAllMocks(); h.queries = [];
  h.scope = { storageScope: "local:enterprise:1", contextVerification: { state: "verified", authorizationVersion: "mock-ctx-v1" }, officialInventoryPermissions: { authorizationVersion: "permission-v1" }, staffPrincipal: { enterpriseId: 1 }, onAuthorizationError: h.authorizationError };
  h.status = { eligibility: { eligible: true }, context: { enterpriseId: 1, permissionVersion: 4, authorizationVersion: "mock-ctx-v1" }, permissions: { write: true, publish: true } };
  h.rows = [fixture()]; h.candidates = [fixture({ inventoryId: 202, partNumber: "LOCAL-CANDIDATE", linked: false, publicationStatus: null }), fixture({ inventoryId: 203, partNumber: "LOCAL-PUBLISHED", linked: false, publicationStatus: null, status: "published" })];
  h.create.mockResolvedValue({ success: true, inventoryId: 909 }); h.exact.mockResolvedValue({ total: 1, items: [fixture({ inventoryId: 909, linked: false, publicationStatus: null })] });
  for (const fn of [h.link, h.save, h.publish, h.offshelf]) fn.mockResolvedValue({ success: true });
  h.receipt.mockResolvedValue({ state: "completed" });
});
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = undefined; });
function mount() { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(React.createElement(MallMaterials))); }
function renderAgain() { act(() => root!.render(React.createElement(MallMaterials))); }
function button(text: string, within: Element = host) { const result = [...within.querySelectorAll("button")].find(b => b.textContent === text); expect(result, `button ${text}`).toBeDefined(); return result!; }
async function click(el: Element) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function input(label: string, value: string) { const el = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; expect(el).not.toBeNull(); act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function fillCreate() { await click(button("新增物料")); for (const [label, value] of [["型号", "LOCAL-NEW"], ["品牌", "LOCAL-BRAND"], ["生产周期/DC", "2602"], ["实际库存", "50"], ["现货上架量", "30"], ["真实货期", "2天"]]) input(label, value); }
const validForm = () => ({ ...emptyForm(), partNumber: "LOCAL", brand: "LOCAL", leadTime: "2天", qtyStock: "10", qtyOnSale: "5" });

describe("MallMaterials targeted DOM", () => {
  it("has no title strip, preview or link entry; dedicated brand and exactly one row operation", () => {
    mount(); expect(host.querySelector("header,h1")).toBeNull();
    expect(host.textContent).not.toMatch(/前台自营渠道|前台预览|关联商城|更新时间|实际库存|库存ID/);
    expect([...host.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["型号", "品牌", "封装", "DC", "可售数量", "报价 CNY", "货期", "状态", "操作"]);
    const row = host.querySelector("tbody tr")!; expect(row.children[1].textContent).toBe("LOCAL-BRAND");
    expect(row.children[8].querySelectorAll("button")).toHaveLength(1); expect(row.children[8].textContent).toBe("上架");
    expect(button("新增物料").parentElement?.className).toBe("mall-filter");
  });
  it("shows the first effective tier, not base or cheapest price, and expands all taxed tiers", () => {
    mount(); const quote = host.querySelector(".mall-quote")!;
    expect(quote.querySelector(".mall-quote-main")?.textContent).toBe("10+ · ¥8");
    const details = quote.querySelector("details")!; expect(details.open).toBe(false);
    act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(details.open).toBe(true); expect(details.textContent).toContain("100+　¥5"); expect(details.textContent).toContain("含税报价");
  });
  it("unpriced rows show inquiry, and untaxed tiers retain accurate tax wording", () => {
    h.rows = [fixture({ priceEx: null, ladderPrices: [], taxIncluded: false })]; mount(); expect(host.querySelector(".mall-quote")?.textContent).toBe("询价未税 · 仅支持询价"); expect(host.textContent).not.toContain("¥0");
  });
  it("main list is linked only and unlinked candidates do not appear or query until selection mode", async () => {
    h.rows.push(h.candidates[0]); mount(); expect(host.querySelectorAll(".mall-main-table tbody tr")).toHaveLength(1);
    expect(h.queries.filter(q => q.options.enabled).every(q => q.input.visibility === "linked")).toBe(true);
    await click(button("新增物料")); expect(h.queries.filter(q => q.options.enabled && q.input.visibility === "unlinked")).toHaveLength(0);
    await click(button("选择已有库存")); expect(h.queries.some(q => q.options.enabled && q.input.visibility === "unlinked" && q.input.pageSize === 30)).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="选择 LOCAL-PUBLISHED LOCAL-BRAND"]')?.disabled).toBe(true);
    input("已有库存型号", "CANDIDATE"); input("已有库存品牌", "BRAND"); await click(button("搜索库存"));
    expect(h.queries.at(-1)?.input).toMatchObject({ visibility: "unlinked", partNumber: "CANDIDATE", brand: "BRAND", pageSize: 30 });
  });
  it("model opens editor; tiers can add and delete, and partial input never submits", async () => {
    mount(); await click(button("LOCAL-PART-A")); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(2); await click(button("增加档位"));
    expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(3); await click(host.querySelector('[aria-label="删除第3档"]')!);
    expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(2); input("第1档单价", ""); await click(button("保存草稿"));
    expect(h.save).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("同时填写");
  });
  it("published model cannot edit before offshelf, with one same-position text action", async () => {
    h.rows = [fixture({ publicationStatus: "published", status: "published" })]; mount(); await click(button("LOCAL-PART-A"));
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(h.info).toHaveBeenCalledWith(expect.stringContaining("先下架"));
    const last = host.querySelector("tbody tr")!.lastElementChild!; expect(last.querySelectorAll("button")).toHaveLength(1);
    await click(button("下架", last)); await click(button("确认下架")); expect(h.offshelf).toHaveBeenCalledOnce(); expect(h.save).not.toHaveBeenCalled();
  });
  it("tier form caps at 64 and deleting a tier restores add capability", async () => {
    h.rows = [fixture({ ladderPrices: Array.from({ length: 64 }, (_, i) => ({ minQty: i + 1, price: 1 })) })]; mount(); await click(button("LOCAL-PART-A"));
    expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(64); expect(button("增加档位").disabled).toBe(true);
    await click(host.querySelector('[aria-label="删除第64档"]')!); expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(63); expect(button("增加档位").disabled).toBe(false);
  });
  it("untaxed tier details and editor retain original tax semantics during save", async () => {
    h.rows = [fixture({ taxIncluded: false })]; mount(); expect(host.querySelector(".mall-quote details")?.textContent).toContain("未税报价 · 仅支持询价");
    await click(button("LOCAL-PART-A")); expect(host.querySelector<HTMLSelectElement>('select[aria-label="税口径"]')?.value).toBe("untaxed"); await click(button("保存草稿"));
    expect(h.save).toHaveBeenCalledOnce(); expect(h.save.mock.calls[0][0].data).toMatchObject({ taxIncluded: false, photos: h.rows[0].photos, invoice: false, rohs: false });
  });
  it("missing full fingerprint never sends a publish request", async () => {
    h.rows = [fixture({ inventoryFingerprint: "a".repeat(63) })]; mount(); await click(button("上架")); await click(button("确认上架"));
    expect(h.publish).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("指纹");
  });
  it("selecting existing needs write only, links once to draft and never publishes", async () => {
    h.status.permissions.publish = false; mount(); expect(button("新增物料").disabled).toBe(false); await click(button("新增物料"));
    expect(button("手工录入").disabled).toBe(true); await click(host.querySelector('[aria-label="选择 LOCAL-CANDIDATE LOCAL-BRAND"]')!); await click(button("保存到待上架"));
    expect(h.link).toHaveBeenCalledOnce(); expect(h.link.mock.calls[0][0].inventoryId).toBe(202); expect(h.create).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
    expect(h.success).toHaveBeenCalledWith("已保存到待上架", expect.anything());
  });
  it("publish directly uses publish only with complete concurrency and identity proofs", async () => {
    h.status.permissions.write = false; mount(); expect(button("新增物料").disabled).toBe(true);
    await click(button("上架")); expect(host.querySelector(".mall-confirm-details")?.textContent).toContain("MOQ 10"); await click(button("确认上架"));
    expect(h.publish).toHaveBeenCalledOnce(); expect(h.link).not.toHaveBeenCalled();
    expect(h.publish.mock.calls[0][0]).toMatchObject({ inventoryId: 101, expectedVersion: 4, expectedInventoryUpdatedAt: new Date("2026-01-01T00:00:00.000Z"), expectedOwnershipVersion: 3, expectedPermissionVersion: 4, expectedAuthorizationVersion: "mock-ctx-v1", expectedInventoryFingerprint: "a".repeat(64), requestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  });
  it("publication failure does not toast success or treat linking as publication", async () => {
    h.publish.mockResolvedValue({ success: false }); mount(); await click(button("上架")); await click(button("确认上架"));
    expect(h.success).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledWith(expect.stringContaining("未上架")); expect(h.link).not.toHaveBeenCalled();
  });
  it("unknown publication stops retries and retains original UUID receipt check", async () => {
    h.publish.mockRejectedValue(new Error("LOCAL network uncertain")); mount(); await click(button("上架")); await click(button("确认上架"));
    const id = h.publish.mock.calls[0][0].requestId; expect(button("确认上架").disabled).toBe(true); await click(button("确认上架")); expect(h.publish).toHaveBeenCalledOnce();
    await click(button("核对原请求")); expect(h.receipt).toHaveBeenCalledWith({ requestId: id }); expect(h.success).not.toHaveBeenCalled();
  });
  it("manual create follows real positive returned ID, exact lookup, then one link with no publish", async () => {
    mount(); await fillCreate(); expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(0); await click(button("保存到待上架"));
    expect(h.create).toHaveBeenCalledOnce(); expect(h.create.mock.calls[0][0]).toMatchObject({ saveAs: "draft", data: { priceEx: undefined, ladderPrices: undefined } });
    expect(h.exact).toHaveBeenCalledWith({ inventoryId: 909, visibility: "unlinked", page: 1, pageSize: 1 });
    expect(h.link).toHaveBeenCalledOnce(); expect(h.link.mock.calls[0][0].inventoryId).toBe(909); expect(h.publish).not.toHaveBeenCalled();
  });
  it.each([undefined, "909", 0, -1, 1.2])("missing/invalid real create ID %s stops without fuzzy lookup or create retry", async id => {
    h.create.mockResolvedValue({ success: true, inventoryId: id }); mount(); await fillCreate(); await click(button("保存到待上架"));
    expect(h.exact).not.toHaveBeenCalled(); expect(h.link).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled();
    expect(host.textContent).toContain("未重发创建"); await click(button("保存到待上架")); expect(h.create).toHaveBeenCalledOnce();
  });
  it("ambiguous exact lookup stops without linking any guessed row", async () => {
    h.exact.mockResolvedValue({ total: 2, items: [fixture({ inventoryId: 909 }), fixture({ inventoryId: 910 })] }); mount(); await fillCreate(); await click(button("保存到待上架"));
    expect(h.link).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.create).toHaveBeenCalledOnce();
  });
  it("link failure after a known creation does not report saved-to-draft or publication success", async () => {
    h.link.mockResolvedValue({ success: false }); mount(); await fillCreate(); await click(button("保存到待上架"));
    expect(h.create).toHaveBeenCalledOnce(); expect(h.link).toHaveBeenCalledOnce(); expect(h.publish).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled();
  });
  it("unknown creation never retries automatically or links", async () => {
    h.create.mockRejectedValue(new Error("LOCAL unknown create")); mount(); await fillCreate(); await click(button("保存到待上架"));
    expect(h.create).toHaveBeenCalledOnce(); expect(h.exact).not.toHaveBeenCalled(); expect(h.link).not.toHaveBeenCalled(); expect(button("保存到待上架").disabled).toBe(true);
  });
  it("changed identity clears the form and ignores old creation result instead of linking", async () => {
    let resolve!: (x: any) => void; h.create.mockReturnValue(new Promise(r => { resolve = r; })); mount(); await fillCreate(); await click(button("保存到待上架"));
    h.scope = { ...h.scope, storageScope: "local:enterprise:2", staffPrincipal: { enterpriseId: 2 } }; h.status.context.enterpriseId = 2; renderAgain();
    expect(host.querySelector('[role="dialog"]')).toBeNull(); await act(async () => resolve({ success: true, inventoryId: 909 }));
    expect(h.exact).not.toHaveBeenCalled(); expect(h.link).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); await click(button("新增物料")); expect(host.querySelector<HTMLInputElement>('input[aria-label="型号"]')?.value).toBe("");
  });
  it("authorization version change clears an edited form", async () => {
    mount(); await click(button("LOCAL-PART-A")); input("品牌", "LOCAL CHANGED"); h.scope.contextVerification.authorizationVersion = "ctx-v2"; renderAgain();
    expect(host.querySelector('[role="dialog"]')).toBeNull(); await click(button("LOCAL-PART-A")); expect(host.querySelector<HTMLInputElement>('input[aria-label="品牌"]')?.value).toBe("LOCAL-BRAND");
  });
  it("live verification disables operations and discards a stale publish response", async () => {
    let resolve!: (x: any) => void; h.publish.mockReturnValue(new Promise(r => { resolve = r; })); mount(); await click(button("上架")); await click(button("确认上架"));
    h.scope.contextVerification.state = "verifying"; renderAgain(); expect(host.querySelector<HTMLButtonElement>(".mall-dialog-actions .mall-primary")?.disabled).toBe(true); expect(host.querySelectorAll(".mall-main-table tbody button")).toHaveLength(0);
    await act(async () => resolve({ success: true })); expect(h.success).not.toHaveBeenCalled();
    h.scope.contextVerification.state = "verified"; renderAgain(); expect(button("上架").disabled).toBe(true); expect(button("核对原请求").disabled).toBe(false);
    await click(button("核对原请求")); expect(h.receipt).toHaveBeenCalledOnce(); expect(h.publish).toHaveBeenCalledOnce();
  });
  it("busy blocks double submit within the same render", async () => {
    let resolve!: (x: any) => void; h.publish.mockReturnValue(new Promise(r => { resolve = r; })); mount(); await click(button("上架")); const confirm = button("确认上架");
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); expect(h.publish).toHaveBeenCalledOnce(); await act(async () => resolve({ success: true }));
  });
});

describe("MallMaterials form validation and original attributes", () => {
  it("starts without fixed 10/50/100 tiers or demonstration price", () => { expect(emptyForm().tiers).toEqual([]); expect(emptyForm().priceEx).toBe(""); });
  it("whole-empty tiers are omitted but half-empty tiers error", () => {
    expect(parseTiers([{ minQty: " ", price: "" }])).toBeUndefined();
    expect(() => parseTiers([{ minQty: "10", price: "" }])).toThrow("同时填写"); expect(() => parseTiers([{ minQty: "", price: "8" }])).toThrow("同时填写");
  });
  it.each(["0", "-1", "1.1", "Infinity", "NaN", "1e2"])("rejects invalid tier quantity %s", minQty => { expect(() => parseTiers([{ minQty, price: "1" }])).toThrow("正整数"); });
  it.each(["0", "-1", "Infinity", "NaN"])("rejects invalid tier price %s", price => { expect(() => parseTiers([{ minQty: "1", price }])).toThrow("有限数值"); });
  it("requires ordered unique tiers and caps 64", () => {
    expect(() => parseTiers([{ minQty: "10", price: "3" }, { minQty: "10", price: "2" }])).toThrow("严格递增");
    expect(() => parseTiers([{ minQty: "10", price: "3" }, { minQty: "5", price: "2" }])).toThrow("严格递增");
    const tiers = Array.from({ length: 64 }, (_, i) => ({ minQty: String(i + 1), price: "1" })); expect(parseTiers(tiers)).toHaveLength(64); expect(() => parseTiers([...tiers, { minQty: "65", price: "1" }])).toThrow("最多64");
  });
  it.each(["moq", "spq"] as const)("requires positive integer %s", key => { for (const value of ["0", "1.5", "", "-1"]) expect(() => formData({ ...validForm(), [key]: value })).toThrow("正整数"); });
  it("rejects fractional/negative inventory, sale beyond stock and nonpositive base price", () => {
    expect(() => formData({ ...validForm(), qtyStock: "1.5" })).toThrow("非负整数"); expect(() => formData({ ...validForm(), qtyOnSale: "-1" })).toThrow("非负整数");
    expect(() => formData({ ...validForm(), qtyOnSale: "11" })).toThrow("大于等于"); expect(() => formData({ ...validForm(), priceEx: "0" })).toThrow("大于0");
    expect(() => formData({ ...validForm(), taxIncluded: undefined as any })).toThrow("明确税口径");
  });
  it("preserves photos, category, warehouse, invoice, ROHS and original untaxed semantics", () => {
    const original = fixture({ taxIncluded: false }) as any;
    const result = formData({ ...validForm(), taxIncluded: false, priceEx: "5" }, original);
    expect(result).toMatchObject({ taxIncluded: false, invoice: false, rohs: false, category: original.category, warehouseAddress: original.warehouseAddress, photos: original.photos });
    expect(() => formData(validForm(), fixture({ photos: [{ mimeType: "image/gif" }] }) as any)).toThrow("不会静默删除");
  });
  it("quote selection skips invalid historical tiers without taking the cheapest", () => { expect(validQuoteTiers({ ladderPrices: [{ minQty: 0, price: 0 }, { minQty: 10, price: 8 }, { minQty: 100, price: 5 }] } as any)[0]).toEqual({ minQty: 10, price: 8 }); });
});


describe("quantity-qualified first ladder quote",()=>{
 it("matches the actual MOQ and package-rounded quantity, not first or cheapest arbitrary tier",()=>{expect(firstEligibleQuote({moq:70,spq:12,ladderPrices:[{minQty:10,price:8},{minQty:50,price:7},{minQty:100,price:5}]})).toEqual({quantity:72,price:7});});
 it("packaging can enter a later valid tier without inventing a price",()=>{expect(firstEligibleQuote({moq:1,spq:64,ladderPrices:[{minQty:10,price:8},{minQty:50,price:7},{minQty:100,price:5}]})).toEqual({quantity:64,price:7});});
 it("does not quote malformed or duplicate ladders as valid prices",()=>{expect(firstEligibleQuote({moq:1,spq:1,ladderPrices:[{minQty:10,price:8},{minQty:10,price:7}]})).toBeNull();expect(firstEligibleQuote({moq:0,spq:1,ladderPrices:[{minQty:10,price:8}]})).toBeNull();});
 it("DOM shows purchasable start quantity and keeps original ladder/packaging details",()=>{h.rows=[fixture({moq:70,spq:12,ladderPrices:[{minQty:10,price:8},{minQty:50,price:7},{minQty:100,price:5}]})];mount();expect(host.querySelector('.mall-quote-main')?.textContent).toBe('72+ · ¥7');expect(host.querySelector('details')?.textContent).toContain('MOQ 70 · 包装倍数 12');expect(host.querySelector('details')?.textContent).toContain('100+　¥5');});
});


describe("legacy ladder read safety",()=>{
 it("supports historical qty aliases without guessing or sorting prices",()=>{expect(firstEligibleQuote({moq:10,spq:2,ladderPrices:[{qty:10,price:8},{qty:100,price:5}]} as never)).toEqual({quantity:10,price:8});});
 it("damaged old ladder renders pending verification rather than crashing",()=>{h.rows=[fixture({ladderPrices:[null]})];mount();expect(host.querySelector('.mall-quote-main')?.textContent).toBe('阶梯报价待核对');});
 it("non-array old ladder cannot be silently deleted by editing",async()=>{h.rows=[fixture({ladderPrices:'legacy-opaque-json'})];mount();await click(button('LOCAL-PART-A'));expect(host.querySelector('[role=dialog]')).toBeNull();expect(h.error).toHaveBeenCalledWith(expect.stringContaining('不会静默清空原报价'));expect(h.save).not.toHaveBeenCalled();});
});
