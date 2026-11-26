export function __i2_scaled(v: unknown, places: number = 6): bigint | null {
  const text = String(v ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  if (frac.length > places) return null;
  return (
    BigInt(whole) * 10n ** BigInt(places) +
    BigInt((frac + "0".repeat(places)).slice(0, places) || "0")
  );
}
export function __i2_round(a: bigint, b: bigint): bigint {
  return b > 0n ? (a + b / 2n) / b : 0n;
}
export function __i2_decimal(n: bigint, places: number = 2) {
  const sign = n < 0n ? "-" : "";
  n = n < 0n ? -n : n;
  const scale = 10n ** BigInt(places);
  return (
    sign +
    (n / scale).toString() +
    (places ? "." + (n % scale).toString().padStart(places, "0") : "")
  );
}
export function __i2_fmt(v: unknown, places: number = 2) {
  const text = String(v ?? "");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return "—";
  const scaled = __i2_scaled(
    match[2] + (match[3] ? "." + match[3] : ""),
    Math.max(places, (match[3] || "").length),
  );
  const from = Math.max(places, (match[3] || "").length);
  const result = __i2_decimal(
    __i2_round(scaled!, 10n ** BigInt(from - places)),
    places,
  ).split(".");
  return (
    match[1] +
    result[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (places ? "." + result[1] : "")
  );
}
export function __i2_money(n: any) {
  return n == null ? "—" : "¥" + __i2_fmt(__i2_decimal(n));
}
export function __i2_error(error: any) {
  const message = String(error?.message || "保存失败");
  const code = error?.data?.code || error?.shape?.data?.code;
  if (code === "FORBIDDEN" || /403|无权限|没有权限|权限不足/.test(message))
    return "当前账号没有此操作权限，请联系企业管理员。";
  if (code === "UNAUTHORIZED" || /401/.test(message))
    return "登录状态已失效，请重新登录后再试。";
  if (
    /Failed to fetch|NetworkError|fetch failed|network|timeout|网络/i.test(
      message,
    )
  )
    return "网络连接异常，保存结果尚未确认。请保留当前表单并重试原请求，不要重复新建。";
  if (/NOT_FOUND.*procedure|No procedure|Unknown procedure/i.test(message))
    return "预发布接口尚未就绪，请稍后重试。";
  if (/^[\[{]/.test(message)) {
    try {
      const parsed = JSON.parse(message);
      const issues = Array.isArray(parsed) ? parsed : parsed.issues || [parsed];
      const names: Record<string, string> = {
        qty: "数量",
        unitCost: "单价",
        taxRate: "税率",
        costs: "采购费用",
        amount: "金额",
        supplierName: "供应商",
        location: "仓位",
        prodYear: "年份/DC",
        reason: "修改原因",
      };
      return issues
        .slice(0, 3)
        .map((issue: any) => {
          const path = (issue.path || [])
            .map((k: any) =>
              typeof k === "number" ? "第" + (k + 1) + "行" : names[k] || k,
            )
            .join(" / ");
          const text = /[\u4e00-\u9fff]/.test(issue.message || "")
            ? issue.message
            : "填写格式或范围不正确，请检查后重试";
          return (path ? path + "：" : "") + text;
        })
        .join("；");
    } catch (_: any) {
      return "提交内容有误，请检查数量、单价、税率和费用金额。";
    }
  }
  return message;
}
export function __i2_feeRows(rows: any) {
  return (rows || []).map((f: any) => ({
    title: String(f.title),
    payee: f.payee === "third_party" ? "third_party" : "supplier",
    amount: __i2_fmt(String(f.amount)).replace(/,/g, ""),
    note: String(f.note || ""),
  }));
}
export function __i2_feeJson(rows: any) {
  return JSON.stringify(
    rows.map((f: any) => [
      f.title.trim(),
      f.payee,
      __i2_scaled(f.amount, 2)?.toString() ?? f.amount,
      f.note.trim(),
    ]),
  );
}
export function __i2_figures(items: any, basis: any, rate: any, fees: any) {
  const tax = __i2_scaled(rate, 1);
  let goods = 0n,
    qty = 0n,
    all = 0n,
    supplier = 0n,
    valid = tax != null;
  const parts = items.map((it: any) => {
    const q = /^\d+$/.test(it.qty) ? BigInt(it.qty || "0") : 0n;
    const price = __i2_scaled(it.unitCost);
    const inc =
      price == null || tax == null
        ? null
        : basis === "CNY_TAX_EXCLUDED"
          ? __i2_round(price * (1000n + tax), 1000n)
          : price;
    const amount = inc == null ? null : __i2_round(inc * q, 10000n);
    if (amount == null) valid = false;
    else goods += amount;
    qty += q;
    return { q, inc, amount };
  });
  for (const f of fees) {
    const c = __i2_scaled(f.amount, 2);
    if (c == null) valid = false;
    else {
      all += c;
      if (f.payee === "supplier") supplier += c;
    }
  }
  return {
    parts,
    valid,
    goods,
    qty,
    all,
    supplier,
    total: goods + all,
    payable: goods + supplier,
    unit:
      items.length === 1 && parts[0].inc != null && qty
        ? parts[0].inc + __i2_round(all * 10000n, qty)
        : null,
  };
}
export function __i2_historyDiff(event: any, moneyVisible: any) {
  let snapshot = event.snapshot;
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch (_: any) {
      snapshot = null;
    }
  }
  if (!snapshot?.before || !snapshot?.after) return "";
  const labels: Record<string, string> = {
    qty: "数量",
    supplierName: "供应商",
    supplierContact: "联系人",
    supplierPhone: "联系方式",
    packageType: "封装",
    lotNumber: "批次",
    location: "仓位",
    supplierOrderNo: "供应商订单号",
    inboundDate: "日期",
    prodYear: "年份/DC",
    note: "备注",
    unitCostTaxIncluded: "含税单价",
    costTotal: "采购总成本",
    unitCostWithFees: "单位成本（含费用）",
    supplierFeeTotal: "供应商费用",
  };
  const amounts = [
    "unitCostTaxIncluded",
    "costTotal",
    "unitCostWithFees",
    "supplierFeeTotal",
  ];
  return Object.entries(labels)
    .filter(
      ([key]: any) =>
        (moneyVisible || !amounts.includes(key)) &&
        Object.prototype.hasOwnProperty.call(snapshot.after, key) &&
        String(snapshot.before[key] ?? "") !==
          String(snapshot.after[key] ?? ""),
    )
    .map(
      ([key, label]: any) =>
        label +
        "：" +
        String(snapshot.before[key] ?? "—") +
        " → " +
        String(snapshot.after[key] ?? "—"),
    )
    .join("\n");
}
