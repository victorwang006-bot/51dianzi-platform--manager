// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelReferenceQuote } from "@shared/channelReference";
import { ChannelReferenceCell } from "./ChannelReferenceCell";

// Open only the existing evidence body in jsdom; no browser or new runtime/UI provider.
vi.mock("../components/ui/popover", async () => {
  const { createElement, Fragment } = await import("react");
  const passthrough = ({ children }: { children: React.ReactNode }) => createElement(Fragment, null, children);
  return { Popover: passthrough, PopoverTrigger: passthrough, PopoverContent: passthrough };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = undefined; host = undefined; });
const quote = (change: Partial<ChannelReferenceQuote> = {}): ChannelReferenceQuote => ({
  source: "lcsc", status: "ok", matchedPartNumber: "TEST-1", matchedBrand: "TEST-BRAND", productCode: "C1",
  pageUrl: "https://item.szlcsc.com/123.html", stockQuantity: 2, unitPrice: "213", tierQuantity: 1,
  tiers: [{ minQuantity: 1, unitPrice: "213" }, { minQuantity: 5000, unitPrice: "213.000000001" }],
  currency: "CNY", unit: "个", packaging: "卷带", taxStatus: "included", stockInsufficientForTier: true,
  fetchedAt: "2026-11-14T04:00:00Z", expiresAt: "2026-11-14T04:20:00Z", message: null, ...change,
});
function render(q: ChannelReferenceQuote, manualPrice?: string | null) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote: q, partNumber: "TEST-1", manualPrice })));
  return host;
}
const dates = (h: HTMLElement) => Array.from(h.querySelectorAll("p")).map(p => p.textContent).filter(t => t?.includes("采集："));
const stockLinks = (h: HTMLElement) => Array.from(h.querySelectorAll("a")).filter(a => a.textContent === "库存来源");
describe("ChannelReferenceCell independent stock collection dates (focused DOM)", () => {
  it("keeps original price time and independently newer stock time in Beijing, without another button", () => {
    const h = render(quote({ stockFetchedAt: "2026-11-17T05:00:00.123Z", stockPageUrl: "https://item.szlcsc.com/456.html" }));
    expect(h.querySelector(".ci-reference-text")?.textContent).toBe("213.000000001，库存2");
    expect(dates(h)).toEqual(["价格采集：2026/11/14 12:00:00（北京时间）", "库存采集：2026/11/17 13:00:00（北京时间）"]);
    expect(stockLinks(h)[0]?.href).toBe("https://item.szlcsc.com/456.html");
    expect(h.querySelectorAll("button")).toHaveLength(1);
  });
  it("falls back to old quote time for old stock and never repeats the same product link", () => {
    const h = render(quote({ stockPageUrl: "https://item.szlcsc.com/123.html" }));
    expect(dates(h)).toEqual(["价格采集：2026/11/14 12:00:00（北京时间）", "库存采集：2026/11/14 12:00:00（北京时间）"]);
    expect(stockLinks(h)).toHaveLength(0); expect(h.querySelectorAll("a")).toHaveLength(2);
  });
  it("does not invent a stock date or stock link for null/unknown stock", () => {
    const h = render(quote({ stockQuantity: null, stockFetchedAt: "2026-11-17T05:00:00.123Z", stockPageUrl: "https://item.szlcsc.com/456.html" }));
    expect(h.querySelector(".ci-reference-text")?.textContent).toBe("213.000000001，库存未披露");
    expect(dates(h)).toEqual(["价格采集：2026/11/14 12:00:00（北京时间）"]); expect(stockLinks(h)).toHaveLength(0);
  });
  it("shows actual zero stock and its independent date, not unknown stock", () => {
    const h = render(quote({ stockQuantity: 0, stockFetchedAt: "2026-11-17T05:00:00.123Z" }));
    expect(h.querySelector(".ci-reference-text")?.textContent).toBe("213.000000001，库存0");
    expect(dates(h)[1]).toBe("库存采集：2026/11/17 13:00:00（北京时间）");
  });
  it("rejects malformed/normalized impossible dates without throwing or falling back from explicit bad stock dates", () => {
    const h = render(quote({ fetchedAt: "2026-02-30T04:00:00Z", stockFetchedAt: "not-a-date" }));
    expect(dates(h)).toEqual([]); expect(h.textContent).not.toContain("Invalid Date");
    act(() => root!.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote: quote({ stockFetchedAt: "not-a-date" }) })));
    expect(dates(h)).toEqual(["价格采集：2026/11/14 12:00:00（北京时间）"]);
  });
  it("preserves manual zero/decimal priority and interprets neither manual nor unsafe source strings as HTML", () => {
    const h = render(quote(), "0.000000001234");
    expect(h.textContent).toBe("¥0.000000001234手填"); expect(dates(h)).toEqual([]); expect(h.querySelectorAll("button,a")).toHaveLength(0);
    act(() => root!.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote: quote(), manualPrice: "0" })));
    expect(h.textContent).toBe("¥0手填");
    act(() => root!.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote: quote({ pageUrl: "javascript:alert(1)", stockPageUrl: "https://evil.example/<img src=x onerror=alert(1)>", stockFetchedAt: "2026-11-17T05:00:00.123Z" }), partNumber: "<img src=x onerror=alert(1)>" })));
    expect(h.querySelectorAll("img,script")).toHaveLength(0); expect(stockLinks(h)).toHaveLength(0);
    expect(Array.from(h.querySelectorAll("a")).every(a => a.protocol === "https:" && a.hostname === "so.szlcsc.com")).toBe(true);
  });
  it("does not show fabricated dates for non-ok, missing manufacturer, wrong source, or zero price", () => {
    const h = render(quote({ status: "price_unavailable", unitPrice: null, tiers: [], stockQuantity: null }));
    expect(dates(h)).toEqual([]);
    for (const q of [quote({ matchedBrand: " " }), quote({ source: "ickey" }), quote({ tiers: [], unitPrice: "0" })]) {
      act(() => root!.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote: q })));
      expect(h.querySelector(".ci-reference-text")?.textContent).toBe("暂未匹配"); expect(dates(h)).toEqual([]);
    }
  });
});
