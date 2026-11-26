export const __sv2_SCALE = 1000000n;
export const __sv2_PRICE = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;
export function __sv2_micro(value: unknown): bigint {
  const s = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(s)) throw Error("金额格式无效");
  const neg = s[0] === "-",
    [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  return (
    (BigInt(w) * __sv2_SCALE + BigInt(f.padEnd(6, "0"))) * (neg ? -1n : 1n)
  );
}
export function __sv2_div(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n,
    v = n < 0n ? -n : n;
  return sign * ((v * 2n + d) / (d * 2n));
}
export function __sv2_text(n: bigint): string {
  const neg = n < 0n,
    v = neg ? -n : n;
  return (
    (neg ? "-" : "") +
    v / __sv2_SCALE +
    "." +
    String(v % __sv2_SCALE).padStart(6, "0")
  );
}
export function __sv2_money(value: unknown, digits: number = 2) {
  if (value === null || value === undefined || value === "") return "—";
  try {
    const n = typeof value === "bigint" ? value : __sv2_micro(value),
      factor = 10n ** BigInt(6 - digits),
      v = __sv2_div(n, factor),
      abs = v < 0n ? -v : v,
      base = 10n ** BigInt(digits);
    return (
      "¥" +
      (v < 0n ? "-" : "") +
      String(abs / base).replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
      (digits ? "." + String(abs % base).padStart(digits, "0") : "")
    );
  } catch {
    return "—";
  }
}
export function __sv2_trim(v: any) {
  return String(v ?? "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
export function __sv2_id() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return (
    "sv2_" +
    Array.from(bytes, (b: any) => b.toString(16).padStart(2, "0")).join("")
  );
}
export function __sv2_date(v: any) {
  return v ? String(v).slice(0, 10) : "";
}
export function __sv2_today() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
export function __sv2_paid(o: any) {
  return (
    __sv2_micro(o?.paidAmount ?? "0") + __sv2_micro(o?.monthlyAmount ?? "0")
  );
}
export function __sv2_due(o: any) {
  const n = __sv2_micro(o.totalAmount) - __sv2_paid(o);
  return n > 0n ? n : 0n;
}
export function __sv2_complete(o: any) {
  return (
    ["completed", "complete"].includes(o.status) ||
    (o.status !== "cancelled" &&
      o.orderedQty > 0 &&
      o.shippedQty >= o.orderedQty &&
      __sv2_paid(o) >= __sv2_micro(o.totalAmount))
  );
}
export function __sv2_status(o: any) {
  return o.status === "cancelled"
    ? "已取消"
    : __sv2_complete(o)
      ? "已完成"
      : "待交付";
}
export function __sv2_known(o: any) {
  return (
    o?.profitBreakdown?.costAmount != null &&
    o?.profitBreakdown?.netProfit != null
  );
}
export function __sv2_error(err: any) {
  const code = err?.data?.code ?? err?.shape?.data?.code ?? "",
    raw = String(err?.message ?? "");
  if (["FORBIDDEN", "UNAUTHORIZED"].includes(code) || /403|401/.test(raw))
    return "登录或操作权限已变化，请重新登录并刷新订单。";
  if (code === "NOT_FOUND") return "订单、客户或批次已不可访问，请刷新后重试。";
  if (code === "CONFLICT")
    return /[\u4e00-\u9fff]/.test(raw) && !/^\s*[\[{]/.test(raw)
      ? raw
      : "订单版本或库存已变化，请重新读取后核对。";
  if (code === "BAD_REQUEST" || /^\s*[\[{]/.test(raw) || /Zod|JSON/.test(raw))
    return "提交内容不符合服务器校验，请检查数量、单价、费用名称、确认说明和日期。";
  return "网络异常或服务暂不可用，结果尚未确认。请重试原请求，不要重复创建订单。";
}
export function __sv2_receiptKey(scope: any) {
  return "sv2-created-receipt:" + scope;
}
export function __sv2_receipt(scope: string, value?: any) {
  try {
    if (value === undefined)
      return JSON.parse(
        sessionStorage.getItem(__sv2_receiptKey(scope)) || "null",
      );
    if (value === null) sessionStorage.removeItem(__sv2_receiptKey(scope));
    else sessionStorage.setItem(__sv2_receiptKey(scope), JSON.stringify(value));
  } catch {}
  return null;
}
export function __sv2_createDraft(scope: string, value?: any) {
  try {
    const key = "sv2-create-request:" + scope;
    if (value === undefined)
      return JSON.parse(sessionStorage.getItem(key) || "null");
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
  return null;
}
export function __sv2_definite(err: any) {
  return [
    "BAD_REQUEST",
    "FORBIDDEN",
    "UNAUTHORIZED",
    "NOT_FOUND",
    "CONFLICT",
  ].includes(err?.data?.code ?? "");
}
export function __sv2_form(o: any) {
  return {
    customerId: o.customerId,
    customerName: o.customerName,
    source: o.sourceType,
    owner: o.createdByName,
    orderDate: __sv2_date(o.createdAt),
    dueDate: __sv2_date(o.dueDate),
    salesTaxMode: o.salesTaxMode ?? "",
    confirmationNote: o.confirmationNote ?? "",
    customerConfirmed: true,
    lines: (o.items ?? []).map((i: any) => ({
      ...i,
      orderItemId: i.id,
      qty: String(i.orderedQty),
      price: __sv2_trim(i.unitPrice),
      allocations: (o.companyStockAllocations ?? [])
        .filter((x: any) => x.orderItemId === i.id)
        .map((x: any) => ({ ...x, qty: String(x.qty - x.releasedQty) })),
    })),
    expenses: o.expenseItems?.length
      ? o.expenseItems.map((e: any) => ({
          title: e.title,
          amount: __sv2_trim(e.amount),
          note: e.note ?? "",
        }))
      : __sv2_micro(o.salesExpenses ?? "0") > 0n
        ? [
            {
              title: "历史销售费用",
              amount: __sv2_trim(o.salesExpenses),
              note: "",
            },
          ]
        : [],
    demand: null,
  };
}
export function __sv2_new(owner: any) {
  return {
    customerId: null,
    customerName: "",
    source: "company_stock",
    owner: owner ?? "当前登录用户",
    orderDate: __sv2_today(),
    dueDate: "",
    salesTaxMode: "tax_included",
    confirmationNote: "",
    customerConfirmed: false,
    lines: [],
    expenses: [],
    demand: null,
  };
}
export function __sv2_totals(f: any) {
  let sales = 0n,
    expense = 0n,
    qty = 0;
  for (const l of f.lines) {
    if (!/^\d+$/.test(String(l.qty)) || !__sv2_PRICE.test(String(l.price)))
      return { sales: null, expense: null, qty };
    sales += __sv2_micro(l.price) * BigInt(l.qty);
    qty += Number(l.qty);
  }
  for (const e of f.expenses) {
    if (!__sv2_PRICE.test(String(e.amount)))
      return { sales, expense: null, qty };
    expense += __sv2_micro(e.amount);
  }
  return { sales, expense, qty };
}
export function __sv2_localFinance(base: any, f: any) {
  const t = __sv2_totals(f);
  if (t.sales === null || t.expense === null || !__sv2_known(base)) return null;
  const cost = __sv2_micro(base.profitBreakdown.costAmount),
    margin = t.sales - cost,
    tax =
      f.salesTaxMode === "tax_included" ? __sv2_div(margin * 13n, 100n) : 0n,
    netNumerator =
      margin * (f.salesTaxMode === "tax_included" ? 87n : 100n) -
      t.expense * 100n,
    net = __sv2_div(netNumerator, 100n),
    rate =
      netNumerator <= 50000n * __sv2_SCALE * 100n
        ? 15
        : netNumerator <= 100000n * __sv2_SCALE * 100n
          ? 18
          : 20,
    com =
      __sv2_div(
        (netNumerator > 0n ? netNumerator : 0n) * BigInt(rate),
        100n * 100n * 10000n,
      ) * 10000n;
  return {
    sales: t.sales,
    cost,
    margin,
    tax,
    expense: t.expense,
    net,
    rate,
    com,
    goods: base.profitBreakdown.goodsAmount,
    procFee: base.profitBreakdown.procurementExpenseAmount,
  };
}
export function __sv2_payload(f: any, requestId: any) {
  const common = {
    requestId,
    dueDate: f.dueDate || null,
    confirmationNote: f.confirmationNote.trim(),
    customerConfirmed: true,
  };
  if (f.source === "demand")
    return {
      ...common,
      demandId: f.demand?.id,
      ...(f.demand?.demandRevision
        ? { demandRevision: f.demand.demandRevision }
        : {}),
      items: f.lines.map((l: any) => ({
        demandItemId: l.sourceDemandItemId,
        qty: Number(l.qty),
        agreedUnitPrice: l.price.trim(),
      })),
    };
  return {
    ...common,
    customerId: f.customerId,
    salesTaxMode: f.salesTaxMode,
    items: f.lines.map((l: any) => ({
      partNumber: l.partNumber,
      brand: l.brand ?? "",
      pkg: l.pkg ?? "",
      dc: l.dc ?? "",
      qtyUnit: l.qtyUnit ?? "个",
      qty: Number(l.qty),
      agreedUnitPrice: l.price.trim(),
      allocations: l.allocations.map((x: any) => ({
        lotId: x.lotId,
        qty: Number(x.qty),
      })),
      deliveryRequirement: l.deliveryRequirement ?? "",
      note: l.note ?? "",
    })),
  };
}
export function __sv2_editPreview(o: any, f: any) {
  if (
    !o ||
    !(o.sourceType === "company_stock" || o.companyStockAllocated) ||
    !f.salesTaxMode
  )
    return null;
  const lines = f.lines.map((l: any) => {
    const original = (o.companyStockAllocations ?? []).filter(
        (x: any) => x.orderItemId === l.orderItemId,
      ),
      delta = Number(l.qty) - Number(l.orderedQty);
    let allocations = original.map((x: any) => ({
      lotId: x.lotId,
      qty: x.qty - x.releasedQty,
    }));
    if (delta > 0 && allocations.length)
      allocations[allocations.length - 1].qty += delta;
    if (delta < 0) {
      let left = -delta;
      for (let k = allocations.length - 1; k >= 0; k--) {
        const take = Math.min(
          left,
          allocations[k].qty - (original[k].consumedQty ?? 0),
        );
        allocations[k].qty -= take;
        left -= take;
      }
    }
    return {
      ...l,
      allocations: allocations
        .filter((x: any) => x.qty > 0)
        .map((x: any) => ({ ...x, qty: String(x.qty) })),
    };
  });
  return __sv2_payload(
    {
      ...f,
      source: "company_stock",
      lines,
      confirmationNote: f.confirmationNote || "预估",
    },
    "sv2_preview_00000000",
  );
}
export function __sv2_validate(f: any, o: any) {
  const errors = [];
  if (!f.customerId) errors.push("请选择客户");
  if (!f.lines.length || f.lines.length > (o ? 200 : 100))
    errors.push("请选择1至" + (o ? 200 : 100) + "行物料");
  if (f.confirmationNote.trim().length < 1 || f.confirmationNote.length > 500)
    errors.push("请填写客户确认说明（最多500字）");
  if (!o && !f.customerConfirmed)
    errors.push("请勾选客户已确认数量、销售价格与交期");
  if (!o && f.source === "demand" && !f.demand) errors.push("请选择关联需求");
  let total = 0n;
  const requested = new Map();
  for (const [idx, l] of f.lines.entries()) {
    const q = Number(l.qty),
      name = l.partNumber || "第" + (idx + 1) + "行";
    if (
      !/^[1-9]\d*$/.test(String(l.qty)) ||
      !Number.isSafeInteger(q) ||
      q > 999999999
    )
      errors.push(name + "：数量须为1至999999999的整数");
    if (o && q < Number(l.shippedQty ?? 0))
      errors.push(name + "：数量不能少于已出货 " + l.shippedQty);
    if (!__sv2_PRICE.test(String(l.price)))
      errors.push(name + "：单价须为非负金额，最多4位小数");
    else if (Number.isSafeInteger(q) && q > 0)
      total += __sv2_micro(l.price) * BigInt(q);
    if (!o && f.source === "company_stock") {
      if (!l.allocations?.length) errors.push(name + "：请选择公司库存批次");
      let sum = 0;
      for (const x of l.allocations ?? []) {
        const n = Number(x.qty);
        if (!/^[1-9]\d*$/.test(String(x.qty)))
          errors.push(name + "：批次分配须为正整数");
        sum += n;
        const used = (requested.get(x.lotId) ?? 0) + n;
        requested.set(x.lotId, used);
        if (x.availableQty != null && used > x.availableQty)
          errors.push(name + "：超过批次可售 " + x.availableQty);
      }
      if (sum !== q) errors.push(name + "：批次分配合计须等于销售数量");
    }
  }
  if (o && total < __sv2_paid(o))
    errors.push(
      "订单金额不能低于已收款（含月结）" + __sv2_money(__sv2_paid(o)),
    );
  if (total > 999999999999999900n) errors.push("订单金额超出允许范围");
  if (f.expenses.length > 30) errors.push("销售费用最多30行");
  for (const [k, e] of f.expenses.entries()) {
    if (!e.title.trim() || e.title.length > 64)
      errors.push("费用第" + (k + 1) + "行：请填写项目，最多64字");
    if (!__sv2_PRICE.test(e.amount))
      errors.push("费用第" + (k + 1) + "行：金额须为非负数，最多4位小数");
    if (e.note.length > 500) errors.push("费用备注最多500字");
  }
  return errors;
}
export function __sv2_diffs(o: any, f: any) {
  if (!o) return [];
  const old = __sv2_form(o),
    d: string[][] = [],
    push = (name: any, x: any, y: any) => {
      if (String(x) !== String(y))
        d.push([name, String(x || "—"), String(y || "—")]);
    };
  if (f.customerId !== o.customerId)
    push("客户", o.customerName, f.customerName);
  push("约定交付日期", old.dueDate, f.dueDate);
  push(
    "销售口径",
    old.salesTaxMode === "tax_included"
      ? "含税"
      : old.salesTaxMode === "tax_excluded"
        ? "未税"
        : "待核",
    f.salesTaxMode === "tax_included"
      ? "含税"
      : f.salesTaxMode === "tax_excluded"
        ? "未税"
        : "待核",
  );
  f.lines.forEach((l: any, k: any) => {
    push(l.partNumber + " 数量", old.lines[k]?.qty, l.qty);
    if (__sv2_trim(old.lines[k]?.price) !== __sv2_trim(l.price))
      push(
        l.partNumber + " 单价",
        __sv2_money(old.lines[k]?.price, 4),
        __sv2_money(l.price, 4),
      );
  });
  if (JSON.stringify(old.expenses) !== JSON.stringify(f.expenses))
    push(
      "销售费用",
      old.expenses
        .map(
          (e: any) =>
            e.title +
            " " +
            __sv2_money(e.amount) +
            (e.note ? "（" + e.note + "）" : ""),
        )
        .join("；") || "无",
      f.expenses
        .map(
          (e: any) =>
            e.title +
            " " +
            __sv2_money(e.amount) +
            (e.note ? "（" + e.note + "）" : ""),
        )
        .join("；") || "无",
    );
  push("客户确认说明", old.confirmationNote, f.confirmationNote);
  return d;
}
