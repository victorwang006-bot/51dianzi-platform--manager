// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelReferenceQuote } from "@shared/channelReference";
import { ChannelReferenceCell } from "./ChannelReferenceCell";
import { manualReferenceDraftFrom, manualReferencePatch, manualReferencePriceValid, manualReferenceRetentionKey, manualReferenceValidation } from "./manualReferenceEdit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const quote: ChannelReferenceQuote = { source: "lcsc", status: "ok", matchedPartNumber: "MODEL", matchedBrand: "TI", productCode: "C123", pageUrl: "https://item.szlcsc.com/123.html",
  stockQuantity: 100, unitPrice: "1.230000000001", tierQuantity: 10, tiers: [], currency: "CNY", unit: "个", taxStatus: "included", packaging: null,
  fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };

describe("manual reference exact-decimal overlay", () => {
  it.each(["0", "0.000000000000", "999999999999999.999999999999", "1.230000000001"])("accepts exact decimal %s including zero", value => {
    expect(manualReferencePriceValid(value)).toBe(true);
  });
  it.each(["", "-1", "+1", "01", ".1", "1.", "1e3", "Infinity", "NaN", "1000000000000000", "0.1234567890123", " 1", "1\n", null, undefined, 0])("rejects malformed or out-of-range %s", value => {
    expect(manualReferencePriceValid(value)).toBe(false);
  });
  it("initializes only persisted manual values; unchanged fields are omitted, explicit blank becomes null", () => {
    const original = { manualReferenceLcsc: "0", manualReferenceIckey: "2.300000000001" };
    const draft = manualReferenceDraftFrom(original);
    expect(manualReferencePatch(original, draft)).toEqual({});
    draft.manualReferenceLcsc = { value: "", edited: true };
    draft.manualReferenceIckey = { value: " 2.300000000001 ", edited: true };
    expect(manualReferencePatch(original, draft)).toEqual({ manualReferenceLcsc: null });
    draft.manualReferenceIckey = { value: "999999999999999.999999999999", edited: true };
    expect(manualReferencePatch(original, draft)).toEqual({ manualReferenceLcsc: null, manualReferenceIckey: "999999999999999.999999999999" });
    expect(manualReferenceValidation(draft)).toEqual([]);
  });
  it("explicit restore-auto still submits null even when DTO had no manual value", () => {
    const draft = manualReferenceDraftFrom({});
    draft.manualReferenceLcsc = { value: "", edited: true };
    expect(manualReferencePatch({}, draft)).toEqual({ manualReferenceLcsc: null });
  });
  it("requires confirmation only for identity changes retaining an existing valid manual price", () => {
    const original = { partNumber: "MODEL", brand: "TI", manualReferenceLcsc: "0", manualReferenceIckey: "2" };
    const draft = manualReferenceDraftFrom(original);
    expect(manualReferenceRetentionKey(original, original, draft)).toBe("");
    expect(manualReferenceRetentionKey(original, { ...original, partNumber: " MODEL " }, draft)).toBe("");
    expect(manualReferenceRetentionKey(original, { ...original, brand: "ADI" }, draft)).not.toBe("");
    draft.manualReferenceLcsc = { value: "", edited: true };
    expect(manualReferenceRetentionKey(original, { ...original, brand: "ADI" }, draft)).not.toBe("");
    draft.manualReferenceIckey = { value: "3", edited: true };
    expect(manualReferenceRetentionKey(original, { ...original, brand: "ADI" }, draft)).toBe("");
    expect(manualReferenceRetentionKey({ ...original, manualReferenceLcsc: null, manualReferenceIckey: undefined }, { ...original, brand: "ADI" }, draft)).toBe("");
  });
  it.each(["0", "0.000000000000", "999999999999999.999999999999"])("manual %s takes priority without auto evidence or marketplace links", async manualPrice => {
    await act(async () => root.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote, partNumber: "MODEL", manualPrice })));
    expect(host.querySelector(".ci-reference-text")?.textContent).toBe(`¥${manualPrice}`);
    expect(host.querySelector(".ci-reference-manual-tag")?.textContent).toBe("手填");
    expect(host.querySelector(".ci-reference-text")?.getAttribute("title")).toBe(`¥${manualPrice}`);
    expect(host.querySelector("button, a")).toBeNull(); expect(host.textContent).not.toContain("库存100");
  });
  it.each([undefined, null, "", "-1", "1e3", "1000000000000000", "0.1234567890123"])("invalid/missing manual %s preserves original auto presentation and evidence", async manualPrice => {
    await act(async () => root.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote, partNumber: "MODEL", manualPrice })));
    expect(host.querySelector(".ci-reference-text")?.textContent).toBe("1.230000000001，库存100");
    expect(host.querySelector(".ci-reference-manual-tag")).toBeNull();
    expect(host.querySelector('[aria-label="查看立创商城参考来源"]')).not.toBeNull();
  });
});
