import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelReferenceQuote, ChannelReferenceSource, ChannelReferenceStatus } from "@shared/channelReference";
import { channelReferenceProgress, channelReferenceRefreshMessage, startChannelReferenceRefresh, type ChannelReferenceProgress } from "./ChannelInventoryHost.referenceRefresh";
const rows = [{ id: 1, partNumber: "EXACT-PART-SUFFIX", brand: "TI" }];
function quote(source: ChannelReferenceSource, status: ChannelReferenceStatus = "ok"): ChannelReferenceQuote {
  return { source, status, matchedPartNumber: rows[0].partNumber, matchedBrand: "TI", productCode: "C1", pageUrl: "https://item.szlcsc.com/173890.html", stockQuantity: 0, unitPrice: "1.0901", tierQuantity: 5000,
    tiers: [{ minQuantity: 5000, unitPrice: "1.0901" }], currency: "CNY", unit: null, taxStatus: "unknown", packaging: null, fetchedAt: "2026-11-15T01:00:00Z", expiresAt: null, stockInsufficientForTier: true, message: null };
}
function result(status: ChannelReferenceStatus = "ok"): ChannelReferenceProgress {
  return { items: [{ materialId: 1, partNumber: rows[0].partNumber, brand: "TI", references: { lcsc: quote("lcsc", status), ickey: quote("ickey", status) } }] };
}
function diagnostic() { return { materialId: 1, source: "lcsc" as const, state: "queued" as const, lastAttemptAt: null, lastAttemptStatus: null, nextAllowedAt: null, referenceVersion: null, sourceSha256: null }; }
function callbacks() { return { rows, refresh: true, isCurrent: () => true, onData: vi.fn(), onError: vi.fn(), onBusy: vi.fn(), onStopped: vi.fn() }; }
afterEach(() => vi.useRealTimers());
describe("explicit finite reference refresh", () => {
  it("takes busy synchronously and keeps it across every 4s read-only poll interval", async () => {
    vi.useFakeTimers(); const cb = callbacks(); const lookup = vi.fn().mockResolvedValueOnce(result("pending")).mockResolvedValue(result());
    const cancel = startChannelReferenceRefresh({ ...cb, lookup });
    expect(cb.onBusy.mock.calls).toEqual([[true]]);
    await vi.advanceTimersByTimeAsync(3999); expect(cb.onBusy.mock.calls).toEqual([[true]]); expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(lookup.mock.calls.map(c => c[0])).toEqual([true, false]); expect(cb.onBusy.mock.calls).toEqual([[true], [false]]); expect(vi.getTimerCount()).toBe(0); cancel();
  });
  it("polls loading-only and diagnostic-only queued responses without issuing a second true", async () => {
    vi.useFakeTimers(); const cb = callbacks(); const lookup = vi.fn().mockResolvedValueOnce({ ...result(), loading: true }).mockResolvedValueOnce({ ...result(), refreshDiagnostics: [diagnostic()] }).mockResolvedValue(result());
    const cancel = startChannelReferenceRefresh({ ...cb, lookup }); await vi.advanceTimersByTimeAsync(8000);
    expect(lookup.mock.calls.map(c => c[0])).toEqual([true, false, false]); expect(cb.onStopped).not.toHaveBeenCalled(); cancel();
  });
  it("keeps a current successful price while a failed source is pending", async () => {
    vi.useFakeTimers(); const cb = callbacks(); const previous = result(); previous.items[0].references.ickey.status = "not_found";
    const cancel = startChannelReferenceRefresh({ ...cb, previousItems: previous.items, lookup: vi.fn().mockResolvedValue(result("pending")) });
    await vi.advanceTimersByTimeAsync(0); expect(cb.onData.mock.calls[0][0].items[0].references.lcsc.status).toBe("ok"); expect(cb.onData.mock.calls[0][0].items[0].references.lcsc.unitPrice).toBe("1.0901"); expect(cb.onData.mock.calls[0][0].items[0].references.ickey.status).toBe("pending"); cancel();
  });
  it("aborts at exactly 90s, clears timers and refuses a late same-page response", async () => {
    vi.useFakeTimers(); const cb = callbacks(); let resolve!: (v: unknown) => void; const lookup = vi.fn(() => new Promise(r => { resolve = r; }));
    const cancel = startChannelReferenceRefresh({ ...cb, lookup }); await vi.advanceTimersByTimeAsync(90000);
    expect(lookup.mock.calls[0][1].aborted).toBe(true); expect(cb.onStopped).toHaveBeenCalledOnce(); expect(cb.onBusy).toHaveBeenLastCalledWith(false);
    resolve(result()); await vi.advanceTimersByTimeAsync(0); expect(cb.onData).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); cancel();
  });
  it("cancels a session and refuses late error or success when identity changes", async () => {
    vi.useFakeTimers(); const cb = callbacks(); let current = true; let reject!: (e: Error) => void; const lookup = vi.fn(() => new Promise((_, no) => { reject = no; }));
    const cancel = startChannelReferenceRefresh({ ...cb, isCurrent: () => current, lookup }); current = false; cancel(); reject(new Error("late"));
    await vi.advanceTimersByTimeAsync(0); expect(cb.onError).not.toHaveBeenCalled(); expect(cb.onData).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("false snapshot reads never become collection calls", async () => {
    vi.useFakeTimers(); const cb = callbacks(); const lookup = vi.fn().mockResolvedValue(result("not_found")); const cancel = startChannelReferenceRefresh({ ...cb, refresh: false, lookup });
    await vi.advanceTimersByTimeAsync(120000); expect(lookup.mock.calls.map(c => c[0])).toEqual([false]); cancel();
  });
});
describe("strict public diagnostic binding", () => {
  it("accepts absent or current well-formed optional evidence", () => {
    expect(channelReferenceProgress(result(), rows)).toEqual(result()); const r = { ...result(), refreshDiagnostics: [diagnostic()] }; expect(channelReferenceProgress(r, rows)).toEqual(r);
  });
  it.each(["foreign", "duplicate", "source", "state", "time", "status", "hash", "version", "loading"])("rejects %s diagnostics fail closed", change => {
    const r = { ...result(), refreshDiagnostics: [diagnostic()] } as any;
    if (change === "foreign") r.refreshDiagnostics[0].materialId = 99;
    if (change === "duplicate") r.refreshDiagnostics.push(r.refreshDiagnostics[0]);
    if (change === "source") r.refreshDiagnostics[0].source = "foreign";
    if (change === "state") r.refreshDiagnostics[0].state = "success";
    if (change === "time") r.refreshDiagnostics[0].lastAttemptAt = "bad-date";
    if (change === "status") r.refreshDiagnostics[0].lastAttemptStatus = "success";
    if (change === "hash") r.refreshDiagnostics[0].sourceSha256 = "bad-hash";
    if (change === "version") r.refreshDiagnostics[0].referenceVersion = "";
    if (change === "loading") r.loading = "yes";
    expect(() => channelReferenceProgress(r, rows)).toThrow("当前授权库存页不匹配");
  });
  it.each(["disabled", "cooldown", "blocked", "queue_full", "unavailable"] as const)("reports %s without pretending a refresh completed", state => {
    const r = { ...result(), refreshDiagnostics: [{ ...diagnostic(), state }] }; expect(channelReferenceRefreshMessage(r, true)).not.toContain("已读取本次尝试结果");
  });
  it.each(["2026-02-31T01:00:00Z", "2026-11-15T24:00:00Z", "2026-13-01T01:00:00Z"])("rejects calendar-normalized invalid diagnostic time %s", lastAttemptAt => {
    const r = { ...result(), refreshDiagnostics: [{ ...diagnostic(), lastAttemptAt }] }; expect(() => channelReferenceProgress(r, rows)).toThrow();
  });
  it("does not call old saved data a confirmed refresh", () => { expect(channelReferenceRefreshMessage(result(), true)).toContain("未确认重查完成"); });
});
