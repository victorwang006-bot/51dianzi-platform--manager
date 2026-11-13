const SCALE = BigInt(10000);

/** Display-only aggregation: no money writes, rounding, or precision loss. */
export function sumMallOrderAmounts(values: readonly string[]): string {
  let total = BigInt(0);
  for (const value of values) {
    if (!/^\d+(?:\.\d{1,4})?$/.test(value)) return "金额数据待核验";
    const [integer, fraction = ""] = value.split(".");
    total += BigInt(integer) * SCALE + BigInt(fraction.padEnd(4, "0"));
  }
  const integer = (total / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (total % SCALE).toString().padStart(4, "0");
  const displayedFraction = fraction.slice(2) === "00" ? fraction.slice(0, 2) : fraction.replace(/0+$/, "");
  return `¥${integer}.${displayedFraction}`;
}
