import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource, ChannelReferenceStatus } from "@shared/channelReference";
import { channelReferenceLookupResult, channelReferenceMaximumTier, channelReferencePageUrl, channelReferencePrice, CHANNEL_REFERENCE_STATUS_LABELS, startChannelReferenceLookup } from "./channelReferenceModel";
const rows = [{ id: 1, partNumber: "GRM32EB31C476KE15L", brand: "MURATA" }];
export function fixtureQuote(source: ChannelReferenceSource, status: ChannelReferenceStatus = "ok"): ChannelReferenceQuote {
  return { source, status, matchedPartNumber: rows[0].partNumber, matchedBrand: rows[0].brand, productCode: "C1",
    pageUrl: source === "lcsc" ? "https://item.szlcsc.com/173890.html" : "https://search.ickey.cn/detail/example.html",
    stockQuantity: 2, unitPrice: "0.000004567890", tierQuantity: 5000,
    tiers: [{ minQuantity: 5000, unitPrice: "0.000004567890" }, { minQuantity: 1, unitPrice: "0.090000001234" }],
    currency: "CNY", unit: "个", taxStatus: "included", packaging: "卷带", fetchedAt: "2026-11-14T04:00:00Z", expiresAt: "2026-11-14T04:20:00Z", stockInsufficientForTier: true, message: null };
}
function result(status: ChannelReferenceStatus = "ok"): ChannelReferenceLookupResult {
  return { items: [{ materialId: 1, ...{ partNumber: rows[0].partNumber, brand: rows[0].brand }, references: { lcsc: fixtureQuote("lcsc", status), ickey: fixtureQuote("ickey", status) } }] };
}
afterEach(() => vi.useRealTimers());
describe("public reference strict presentation model", () => {
  it("retains exact decimal strings and selects maximum quantity threshold, not lowest price", () => {
    const quote = fixtureQuote("lcsc");
    quote.tiers[0].unitPrice = "0.099999999999";
    expect(channelReferenceMaximumTier(quote)).toEqual({ minQuantity: 5000, unitPrice: "0.099999999999" });
    expect(channelReferencePrice(quote)).toBe("0.099999999999，库存2");
    quote.stockQuantity = 0; expect(channelReferenceLookupResult({ items: [{ ...result().items[0], references: { lcsc: quote, ickey: fixtureQuote("ickey") } }] }, rows).items[0].references.lcsc.stockQuantity).toBe(0);
  });
  it.each([null, "USD", "HKD"] as const)("does not display or convert a %s quote as CNY", currency => {
    const quote = fixtureQuote("lcsc"); quote.currency = currency;
    expect(channelReferencePrice(quote)).toBe("暂未匹配");
  });
  it("keeps all failure statuses independent without a fabricated zero", () => {
    for (const status of ["pending", "not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"] as const) {
      const quote = fixtureQuote("lcsc", status); quote.stockQuantity = null; quote.unitPrice = null; quote.tiers = [];
      expect(channelReferencePrice(quote)).toBe("暂未匹配");
      expect(CHANNEL_REFERENCE_STATUS_LABELS[status]).toBeTruthy();
      expect(channelReferencePrice(quote)).not.toContain("0");
    }
  });
  it("rejects foreign, duplicate, missing, mismatched and malformed response bindings", () => {
    expect(channelReferenceLookupResult(result(), rows)).toEqual(result());
    for (const change of [(r: ChannelReferenceLookupResult) => { r.items[0].materialId = 9; }, (r: ChannelReferenceLookupResult) => { r.items.push(r.items[0]); }, (r: ChannelReferenceLookupResult) => { r.items[0].partNumber += "-SUFFIX"; }, (r: ChannelReferenceLookupResult) => { r.items[0].brand = "OTHER"; }, (r: ChannelReferenceLookupResult) => { r.items[0].references.lcsc.unitPrice = "NaN"; }, (r: ChannelReferenceLookupResult) => { r.items[0].references.ickey.stockQuantity = -1; }]) {
      const invalid = result(); change(invalid); expect(() => channelReferenceLookupResult(invalid, rows)).toThrow();
    }
    expect(() => channelReferenceLookupResult({ items: [] }, rows)).toThrow();
    expect(() => channelReferenceLookupResult({ items: [{ ...result().items[0], references: { lcsc: {} } }] }, rows)).toThrow();
  });
  it("permits only credential-free HTTPS fixed-provider links", () => {
    expect(channelReferencePageUrl(fixtureQuote("lcsc").pageUrl, "lcsc")).toBe(fixtureQuote("lcsc").pageUrl);
    expect(channelReferencePageUrl(fixtureQuote("ickey").pageUrl, "ickey")).toBe(fixtureQuote("ickey").pageUrl);
    for (const url of ["javascript:alert(1)", "https://search.ickey.cn.evil.test/p", "https://user:pw@search.ickey.cn/p", "http://search.ickey.cn/p", "https://search.ickey.cn:999/p", "https://127.0.0.1/p"]) expect(channelReferencePageUrl(url, "ickey")).toBeNull();
    expect(channelReferencePageUrl(fixtureQuote("lcsc").pageUrl, "ickey")).toBeNull();
  });
});
describe("finite current-task cache polling", () => {
  function callbacks() { return { rows, refresh: false, isCurrent: () => true, onData: vi.fn(), onError: vi.fn(), onBusy: vi.fn(), onStopped: vi.fn() }; }
  it.each(["ok", "not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"] as const)("a %s batch snapshot finishes without polling", async status => {
    vi.useFakeTimers(); const cb = callbacks(); const snapshot = result(status); const lookup = vi.fn().mockResolvedValue(snapshot);
    const cancel = startChannelReferenceLookup({ ...cb, lookup });
    await vi.advanceTimersByTimeAsync(0); expect(cb.onData).toHaveBeenCalledWith(snapshot); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120000); expect(lookup).toHaveBeenCalledTimes(1); expect(lookup.mock.calls[0][0]).toBe(false); cancel();
  });
  it("polls pending at 4 seconds, stops once complete and never keeps timers alive", async () => {
    vi.useFakeTimers(); const cb = callbacks();
    const lookup = vi.fn().mockResolvedValueOnce(result("pending")).mockResolvedValue(result());
    const cancel = startChannelReferenceLookup({ ...cb, lookup });
    await vi.advanceTimersByTimeAsync(0); expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3999); expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(lookup).toHaveBeenCalledTimes(2);
    expect(cb.onData).toHaveBeenLastCalledWith(result()); expect(vi.getTimerCount()).toBe(0); cancel();
  });
  it("stops after 90 seconds, including a request which never resolves", async () => {
    vi.useFakeTimers(); const cb = callbacks(); const lookup = vi.fn().mockResolvedValue(result("pending"));
    const cancel = startChannelReferenceLookup({ ...cb, lookup });
    await vi.advanceTimersByTimeAsync(90000); expect(cb.onStopped).toHaveBeenCalledTimes(1);
    const calls = lookup.mock.calls.length; await vi.advanceTimersByTimeAsync(120000); expect(lookup).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0); cancel();
    const hangingCb = callbacks(); let resolve!: (value: unknown) => void;
    const hanging = vi.fn(() => new Promise<unknown>(r => { resolve = r; }));
    const cancelHanging = startChannelReferenceLookup({ ...hangingCb, lookup: hanging });
    await vi.advanceTimersByTimeAsync(90000); expect(hangingCb.onStopped).toHaveBeenCalledTimes(1);
    resolve(result()); await vi.advanceTimersByTimeAsync(0); expect(hangingCb.onData).not.toHaveBeenCalled(); expect(hangingCb.onBusy).toHaveBeenLastCalledWith(false); cancelHanging();
  });
  it("cancels on page/identity/unmount and rejects late success or failure without writes", async () => {
    vi.useFakeTimers(); let current = true; const cb = callbacks(); let resolve!: (value: unknown) => void;
    const lookup = vi.fn(() => new Promise<unknown>(r => { resolve = r; }));
    const cancel = startChannelReferenceLookup({ ...cb, isCurrent: () => current, lookup });
    current = false; cancel(); expect(lookup.mock.calls[0][1].aborted).toBe(true);
    resolve(result()); await vi.advanceTimersByTimeAsync(0); expect(cb.onData).not.toHaveBeenCalled(); expect(cb.onError).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("uses refresh only on the first manual call and stops on malformed/error independently", async () => {
    vi.useFakeTimers(); const cb = callbacks(); const lookup = vi.fn().mockResolvedValueOnce(result("pending")).mockRejectedValueOnce(new Error("restricted"));
    const cancel = startChannelReferenceLookup({ ...cb, lookup, refresh: true });
    await vi.advanceTimersByTimeAsync(4000); expect(lookup.mock.calls.map(call => call[0])).toEqual([true, false]);
    expect(cb.onError).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); cancel();
  });
});
