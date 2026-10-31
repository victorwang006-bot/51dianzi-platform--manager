export function decimalUnits(value: string, places: 2 | 4): bigint {
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(value)) {
    throw new Error("金额格式无效");
  }
  const [whole, fractional = ""] = value.split(".");
  if (fractional.length > places) throw new Error("金额精度无效");
  return BigInt(whole) * (places === 2 ? BigInt(100) : BigInt(10000)) +
    BigInt(fractional.padEnd(places, "0") || "0");
}

export function centsString(cents: bigint): string {
  const sign = cents < BigInt(0) ? "-" : "";
  const positive = cents < BigInt(0) ? -cents : cents;
  return `${sign}${positive / BigInt(100)}.${String(positive % BigInt(100)).padStart(2, "0")}`;
}

/** 含税单价精确到4位，小计逐行四舍五入至分，再将所有小计相加。 */
export function purchaseOrderTotal(items: readonly { qty: number; unitPrice: string }[]): string {
  if (!items.length) throw new Error("采购明细不能为空");
  let total = BigInt(0);
  for (const item of items) {
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0 || item.qty > 10000000) {
      throw new Error("采购数量无效");
    }
    const price = decimalUnits(item.unitPrice, 4);
    total += (BigInt(item.qty) * price + BigInt(50)) / BigInt(100);
  }
  if (total > BigInt("999999999999999999")) throw new Error("订单金额超出范围");
  return centsString(total);
}

export function progressStatus(done: number, ordered: number, complete: "shipped" | "received") {
  if (done <= 0) return "pending" as const;
  if (done < ordered) return "partial" as const;
  return complete;
}

/** Original inbound can be confirmed above its planned qty after linking; never label it normally received. */
export function receiptProgress(done: number, ordered: number) {
  if (done > ordered) return "over_received" as const;
  return progressStatus(done, ordered, "received");
}

export function invoiceProgress(invoiced: string, total: string) {
  const done = decimalUnits(invoiced, 2);
  if (done <= BigInt(0)) return "pending" as const;
  return done < decimalUnits(total, 2) ? "partial" as const : "received" as const;
}

export function normalizePurchasePartNumber(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

export function normalizePurchaseSupplierName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}
