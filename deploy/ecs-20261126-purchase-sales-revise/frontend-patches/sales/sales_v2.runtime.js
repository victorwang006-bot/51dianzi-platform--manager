/* global p,a,c,J,sr,or,ir,cr,cn,nt,be,cs,ea,tn */
function __sv2_h(type, props, ...children) {
  const { key, ...rest } = props || {};
  return (children.length > 1 ? c : a)(
    type,
    {
      ...rest,
      ...children.length ? { children: children.length === 1 ? children[0] : children } : {}
    },
    key
  );
}
const __sv2_Fragment = p.Fragment;
const __sv2_Dialog = sr, __sv2_Content = or, __sv2_Header = ir, __sv2_Title = cr, __sv2_Customer = cn, __sv2_StockDelivery = tn;
const __sv2_SCALE = 1000000n;
const __sv2_PRICE = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;
function __sv2_micro(value) {
  const s = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(s)) throw Error("\u91D1\u989D\u683C\u5F0F\u65E0\u6548");
  const neg = s[0] === "-", [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  return (BigInt(w) * __sv2_SCALE + BigInt(f.padEnd(6, "0"))) * (neg ? -1n : 1n);
}
function __sv2_div(n, d) {
  const sign = n < 0n ? -1n : 1n, v = n < 0n ? -n : n;
  return sign * ((v * 2n + d) / (d * 2n));
}
function __sv2_text(n) {
  const neg = n < 0n, v = neg ? -n : n;
  return (neg ? "-" : "") + v / __sv2_SCALE + "." + String(v % __sv2_SCALE).padStart(6, "0");
}
function __sv2_money(value, digits = 2) {
  if (value === null || value === void 0 || value === "") return "\u2014";
  try {
    const n = typeof value === "bigint" ? value : __sv2_micro(value), factor = 10n ** BigInt(6 - digits), v = __sv2_div(n, factor), abs = v < 0n ? -v : v, base = 10n ** BigInt(digits);
    return "\xA5" + (v < 0n ? "-" : "") + String(abs / base).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (digits ? "." + String(abs % base).padStart(digits, "0") : "");
  } catch {
    return "\u2014";
  }
}
function __sv2_trim(v) {
  return String(v ?? "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
function __sv2_id() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return "sv2_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function __sv2_date(v) {
  return v ? String(v).slice(0, 10) : "";
}
function __sv2_today() {
  const d = /* @__PURE__ */ new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function __sv2_paid(o) {
  return __sv2_micro(o?.paidAmount ?? "0") + __sv2_micro(o?.monthlyAmount ?? "0");
}
function __sv2_due(o) {
  const n = __sv2_micro(o.totalAmount) - __sv2_paid(o);
  return n > 0n ? n : 0n;
}
function __sv2_complete(o) {
  return ["completed", "complete"].includes(o.status) || o.status !== "cancelled" && o.orderedQty > 0 && o.shippedQty >= o.orderedQty && __sv2_paid(o) >= __sv2_micro(o.totalAmount);
}
function __sv2_status(o) {
  return o.status === "cancelled" ? "\u5DF2\u53D6\u6D88" : __sv2_complete(o) ? "\u5DF2\u5B8C\u6210" : "\u5F85\u4EA4\u4ED8";
}
function __sv2_known(o) {
  return o?.profitBreakdown?.costAmount != null && o?.profitBreakdown?.netProfit != null;
}
function __sv2_error(err) {
  const code = err?.data?.code ?? err?.shape?.data?.code ?? "", raw = String(err?.message ?? "");
  if (["FORBIDDEN", "UNAUTHORIZED"].includes(code) || /403|401/.test(raw))
    return "\u767B\u5F55\u6216\u64CD\u4F5C\u6743\u9650\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u5E76\u5237\u65B0\u8BA2\u5355\u3002";
  if (code === "NOT_FOUND") return "\u8BA2\u5355\u3001\u5BA2\u6237\u6216\u6279\u6B21\u5DF2\u4E0D\u53EF\u8BBF\u95EE\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002";
  if (code === "CONFLICT")
    return /[\u4e00-\u9fff]/.test(raw) && !/^\s*[\[{]/.test(raw) ? raw : "\u8BA2\u5355\u7248\u672C\u6216\u5E93\u5B58\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u6838\u5BF9\u3002";
  if (code === "BAD_REQUEST" || /^\s*[\[{]/.test(raw) || /Zod|JSON/.test(raw))
    return "\u63D0\u4EA4\u5185\u5BB9\u4E0D\u7B26\u5408\u670D\u52A1\u5668\u6821\u9A8C\uFF0C\u8BF7\u68C0\u67E5\u6570\u91CF\u3001\u5355\u4EF7\u3001\u8D39\u7528\u540D\u79F0\u3001\u786E\u8BA4\u8BF4\u660E\u548C\u65E5\u671F\u3002";
  return "\u7F51\u7EDC\u5F02\u5E38\u6216\u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\u3002\u8BF7\u91CD\u8BD5\u539F\u8BF7\u6C42\uFF0C\u4E0D\u8981\u91CD\u590D\u521B\u5EFA\u8BA2\u5355\u3002";
}
function __sv2_receiptKey(scope) {
  return "sv2-created-receipt:" + scope;
}
function __sv2_receipt(scope, value) {
  try {
    if (value === void 0)
      return JSON.parse(
        sessionStorage.getItem(__sv2_receiptKey(scope)) || "null"
      );
    if (value === null) sessionStorage.removeItem(__sv2_receiptKey(scope));
    else sessionStorage.setItem(__sv2_receiptKey(scope), JSON.stringify(value));
  } catch {
  }
  return null;
}
function __sv2_createDraft(scope, value) {
  try {
    const key = "sv2-create-request:" + scope;
    if (value === void 0)
      return JSON.parse(sessionStorage.getItem(key) || "null");
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
  return null;
}
function __sv2_definite(err) {
  return [
    "BAD_REQUEST",
    "FORBIDDEN",
    "UNAUTHORIZED",
    "NOT_FOUND",
    "CONFLICT"
  ].includes(err?.data?.code ?? "");
}
function __sv2_form(o) {
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
    lines: (o.items ?? []).map((i) => ({
      ...i,
      orderItemId: i.id,
      qty: String(i.orderedQty),
      price: __sv2_trim(i.unitPrice),
      allocations: (o.companyStockAllocations ?? []).filter((x) => x.orderItemId === i.id).map((x) => ({ ...x, qty: String(x.qty - x.releasedQty) }))
    })),
    expenses: o.expenseItems?.length ? o.expenseItems.map((e) => ({
      title: e.title,
      amount: __sv2_trim(e.amount),
      note: e.note ?? ""
    })) : __sv2_micro(o.salesExpenses ?? "0") > 0n ? [
      {
        title: "\u5386\u53F2\u9500\u552E\u8D39\u7528",
        amount: __sv2_trim(o.salesExpenses),
        note: ""
      }
    ] : [],
    demand: null
  };
}
function __sv2_new(owner) {
  return {
    customerId: null,
    customerName: "",
    source: "company_stock",
    owner: owner ?? "\u5F53\u524D\u767B\u5F55\u7528\u6237",
    orderDate: __sv2_today(),
    dueDate: "",
    salesTaxMode: "tax_included",
    confirmationNote: "",
    customerConfirmed: false,
    lines: [],
    expenses: [],
    demand: null
  };
}
function __sv2_totals(f) {
  let sales = 0n, expense = 0n, qty = 0;
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
function __sv2_localFinance(base, f) {
  const t = __sv2_totals(f);
  if (t.sales === null || t.expense === null || !__sv2_known(base)) return null;
  const cost = __sv2_micro(base.profitBreakdown.costAmount), margin = t.sales - cost, tax = f.salesTaxMode === "tax_included" ? __sv2_div(margin * 13n, 100n) : 0n, netNumerator = margin * (f.salesTaxMode === "tax_included" ? 87n : 100n) - t.expense * 100n, net = __sv2_div(netNumerator, 100n), rate = netNumerator <= 50000n * __sv2_SCALE * 100n ? 15 : netNumerator <= 100000n * __sv2_SCALE * 100n ? 18 : 20, com = __sv2_div(
    (netNumerator > 0n ? netNumerator : 0n) * BigInt(rate),
    100n * 100n * 10000n
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
    procFee: base.profitBreakdown.procurementExpenseAmount
  };
}
function __sv2_payload(f, requestId) {
  const common = {
    requestId,
    dueDate: f.dueDate || null,
    confirmationNote: f.confirmationNote.trim(),
    customerConfirmed: true
  };
  if (f.source === "demand")
    return {
      ...common,
      demandId: f.demand?.id,
      ...f.demand?.demandRevision ? { demandRevision: f.demand.demandRevision } : {},
      items: f.lines.map((l) => ({
        demandItemId: l.sourceDemandItemId,
        qty: Number(l.qty),
        agreedUnitPrice: l.price.trim()
      }))
    };
  return {
    ...common,
    customerId: f.customerId,
    salesTaxMode: f.salesTaxMode,
    items: f.lines.map((l) => ({
      partNumber: l.partNumber,
      brand: l.brand ?? "",
      pkg: l.pkg ?? "",
      dc: l.dc ?? "",
      qtyUnit: l.qtyUnit ?? "\u4E2A",
      qty: Number(l.qty),
      agreedUnitPrice: l.price.trim(),
      allocations: l.allocations.map((x) => ({
        lotId: x.lotId,
        qty: Number(x.qty)
      })),
      deliveryRequirement: l.deliveryRequirement ?? "",
      note: l.note ?? ""
    }))
  };
}
function __sv2_editPreview(o, f) {
  if (!o || !(o.sourceType === "company_stock" || o.companyStockAllocated) || !f.salesTaxMode)
    return null;
  const lines = f.lines.map((l) => {
    const original = (o.companyStockAllocations ?? []).filter(
      (x) => x.orderItemId === l.orderItemId
    ), delta = Number(l.qty) - Number(l.orderedQty);
    let allocations = original.map((x) => ({
      lotId: x.lotId,
      qty: x.qty - x.releasedQty
    }));
    if (delta > 0 && allocations.length)
      allocations[allocations.length - 1].qty += delta;
    if (delta < 0) {
      let left = -delta;
      for (let k = allocations.length - 1; k >= 0; k--) {
        const take = Math.min(
          left,
          allocations[k].qty - (original[k].consumedQty ?? 0)
        );
        allocations[k].qty -= take;
        left -= take;
      }
    }
    return {
      ...l,
      allocations: allocations.filter((x) => x.qty > 0).map((x) => ({ ...x, qty: String(x.qty) }))
    };
  });
  return __sv2_payload(
    {
      ...f,
      source: "company_stock",
      lines,
      confirmationNote: f.confirmationNote || "\u9884\u4F30"
    },
    "sv2_preview_00000000"
  );
}
function __sv2_validate(f, o) {
  const errors = [];
  if (!f.customerId) errors.push("\u8BF7\u9009\u62E9\u5BA2\u6237");
  if (!f.lines.length || f.lines.length > (o ? 200 : 100))
    errors.push("\u8BF7\u9009\u62E91\u81F3" + (o ? 200 : 100) + "\u884C\u7269\u6599");
  if (f.confirmationNote.trim().length < 1 || f.confirmationNote.length > 500)
    errors.push("\u8BF7\u586B\u5199\u5BA2\u6237\u786E\u8BA4\u8BF4\u660E\uFF08\u6700\u591A500\u5B57\uFF09");
  if (!o && !f.customerConfirmed)
    errors.push("\u8BF7\u52FE\u9009\u5BA2\u6237\u5DF2\u786E\u8BA4\u6570\u91CF\u3001\u9500\u552E\u4EF7\u683C\u4E0E\u4EA4\u671F");
  if (!o && f.source === "demand" && !f.demand) errors.push("\u8BF7\u9009\u62E9\u5173\u8054\u9700\u6C42");
  let total = 0n;
  const requested = /* @__PURE__ */ new Map();
  for (const [idx, l] of f.lines.entries()) {
    const q = Number(l.qty), name = l.partNumber || "\u7B2C" + (idx + 1) + "\u884C";
    if (!/^[1-9]\d*$/.test(String(l.qty)) || !Number.isSafeInteger(q) || q > 999999999)
      errors.push(name + "\uFF1A\u6570\u91CF\u987B\u4E3A1\u81F3999999999\u7684\u6574\u6570");
    if (o && q < Number(l.shippedQty ?? 0))
      errors.push(name + "\uFF1A\u6570\u91CF\u4E0D\u80FD\u5C11\u4E8E\u5DF2\u51FA\u8D27 " + l.shippedQty);
    if (!__sv2_PRICE.test(String(l.price)))
      errors.push(name + "\uFF1A\u5355\u4EF7\u987B\u4E3A\u975E\u8D1F\u91D1\u989D\uFF0C\u6700\u591A4\u4F4D\u5C0F\u6570");
    else if (Number.isSafeInteger(q) && q > 0)
      total += __sv2_micro(l.price) * BigInt(q);
    if (!o && f.source === "company_stock") {
      if (!l.allocations?.length) errors.push(name + "\uFF1A\u8BF7\u9009\u62E9\u516C\u53F8\u5E93\u5B58\u6279\u6B21");
      let sum = 0;
      for (const x of l.allocations ?? []) {
        const n = Number(x.qty);
        if (!/^[1-9]\d*$/.test(String(x.qty)))
          errors.push(name + "\uFF1A\u6279\u6B21\u5206\u914D\u987B\u4E3A\u6B63\u6574\u6570");
        sum += n;
        const used = (requested.get(x.lotId) ?? 0) + n;
        requested.set(x.lotId, used);
        if (x.availableQty != null && used > x.availableQty)
          errors.push(name + "\uFF1A\u8D85\u8FC7\u6279\u6B21\u53EF\u552E " + x.availableQty);
      }
      if (sum !== q) errors.push(name + "\uFF1A\u6279\u6B21\u5206\u914D\u5408\u8BA1\u987B\u7B49\u4E8E\u9500\u552E\u6570\u91CF");
    }
  }
  if (o && total < __sv2_paid(o))
    errors.push(
      "\u8BA2\u5355\u91D1\u989D\u4E0D\u80FD\u4F4E\u4E8E\u5DF2\u6536\u6B3E\uFF08\u542B\u6708\u7ED3\uFF09" + __sv2_money(__sv2_paid(o))
    );
  if (total > 999999999999999900n) errors.push("\u8BA2\u5355\u91D1\u989D\u8D85\u51FA\u5141\u8BB8\u8303\u56F4");
  if (f.expenses.length > 30) errors.push("\u9500\u552E\u8D39\u7528\u6700\u591A30\u884C");
  for (const [k, e] of f.expenses.entries()) {
    if (!e.title.trim() || e.title.length > 64)
      errors.push("\u8D39\u7528\u7B2C" + (k + 1) + "\u884C\uFF1A\u8BF7\u586B\u5199\u9879\u76EE\uFF0C\u6700\u591A64\u5B57");
    if (!__sv2_PRICE.test(e.amount))
      errors.push("\u8D39\u7528\u7B2C" + (k + 1) + "\u884C\uFF1A\u91D1\u989D\u987B\u4E3A\u975E\u8D1F\u6570\uFF0C\u6700\u591A4\u4F4D\u5C0F\u6570");
    if (e.note.length > 500) errors.push("\u8D39\u7528\u5907\u6CE8\u6700\u591A500\u5B57");
  }
  return errors;
}
function __sv2_diffs(o, f) {
  if (!o) return [];
  const old = __sv2_form(o), d = [], push = (name, x, y) => {
    if (String(x) !== String(y))
      d.push([name, String(x || "\u2014"), String(y || "\u2014")]);
  };
  if (f.customerId !== o.customerId)
    push("\u5BA2\u6237", o.customerName, f.customerName);
  push("\u7EA6\u5B9A\u4EA4\u4ED8\u65E5\u671F", old.dueDate, f.dueDate);
  push(
    "\u9500\u552E\u53E3\u5F84",
    old.salesTaxMode === "tax_included" ? "\u542B\u7A0E" : old.salesTaxMode === "tax_excluded" ? "\u672A\u7A0E" : "\u5F85\u6838",
    f.salesTaxMode === "tax_included" ? "\u542B\u7A0E" : f.salesTaxMode === "tax_excluded" ? "\u672A\u7A0E" : "\u5F85\u6838"
  );
  f.lines.forEach((l, k) => {
    push(l.partNumber + " \u6570\u91CF", old.lines[k]?.qty, l.qty);
    if (__sv2_trim(old.lines[k]?.price) !== __sv2_trim(l.price))
      push(
        l.partNumber + " \u5355\u4EF7",
        __sv2_money(old.lines[k]?.price, 4),
        __sv2_money(l.price, 4)
      );
  });
  if (JSON.stringify(old.expenses) !== JSON.stringify(f.expenses))
    push(
      "\u9500\u552E\u8D39\u7528",
      old.expenses.map(
        (e) => e.title + " " + __sv2_money(e.amount) + (e.note ? "\uFF08" + e.note + "\uFF09" : "")
      ).join("\uFF1B") || "\u65E0",
      f.expenses.map(
        (e) => e.title + " " + __sv2_money(e.amount) + (e.note ? "\uFF08" + e.note + "\uFF09" : "")
      ).join("\uFF1B") || "\u65E0"
    );
  push("\u5BA2\u6237\u786E\u8BA4\u8BF4\u660E", old.confirmationNote, f.confirmationNote);
  return d;
}
function __sv2_Input({ label, value, onChange, ...rest }) {
  return /* @__PURE__ */ __sv2_h(
    "input",
    {
      className: "crm-input",
      "aria-label": label,
      value: value ?? "",
      onChange: (e) => onChange(e.target.value),
      ...rest
    }
  );
}
function __sv2_Button({ children, primary = false, danger = false, ...props }) {
  return /* @__PURE__ */ __sv2_h(
    J,
    {
      type: "button",
      variant: "outline",
      className: "__sv2_btn " + (primary ? "__sv2_primary " : "") + (danger ? "__sv2_danger" : ""),
      ...props
    },
    children
  );
}
function __sv2_Finance({ finance, totals, estimated }) {
  return /* @__PURE__ */ __sv2_h("section", { className: "aui-data-panel __sv2_card" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, finance ? "\u5229\u6DA6\u4E0E\u63D0\u6210" : "\u9500\u552E\u6C47\u603B", estimated && finance ? "\uFF08\u9884\u4F30\uFF09" : ""), /* @__PURE__ */ __sv2_h("small", null, finance ? "\u6574\u5355\u8BA1\u6863" : "")), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_kv" }, /* @__PURE__ */ __sv2_h("span", null, "\u9500\u552E\u989D"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(totals.sales))), finance ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_kv" }, /* @__PURE__ */ __sv2_h("span", null, "\u91C7\u8D2D\u6210\u672C"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(finance.cost))), finance.goods != null && finance.procFee != null ? /* @__PURE__ */ __sv2_h("small", { className: "__sv2_sub" }, "\u8D27\u6B3E ", __sv2_money(finance.goods), " + \u91C7\u8D2D\u8D39\u7528", " ", __sv2_money(finance.procFee)) : /* @__PURE__ */ __sv2_h("small", { className: "__sv2_sub" }, "\u542B\u91C7\u8D2D\u8D39\u7528 \xB7 \u8D27\u6B3E/\u8D39\u7528\u62C6\u5206\u5F85\u540E\u7AEF\u63D0\u4F9B"), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_kv" }, /* @__PURE__ */ __sv2_h("span", null, "\u5DEE\u4EF7"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(finance.margin))), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_kv" }, /* @__PURE__ */ __sv2_h("span", null, "\u7A0E\u6263"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(-finance.tax)))) : null, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_kv" }, /* @__PURE__ */ __sv2_h("span", null, "\u9500\u552E\u8D39\u7528"), /* @__PURE__ */ __sv2_h("b", null, totals.expense === null ? "\u2014" : __sv2_money(-totals.expense))), finance ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_net" }, /* @__PURE__ */ __sv2_h("span", null, "\u51C0\u5229\u6DA6"), /* @__PURE__ */ __sv2_h("b", { className: finance.net < 0n ? "__sv2_red" : "" }, __sv2_money(finance.net))), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_com" }, /* @__PURE__ */ __sv2_h("span", null, "\u9884\u8BA1\u63D0\u6210 ", finance.rate, "%"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(finance.com))), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_tiers" }, [
    [15, "\u22645\u4E07 15%"],
    [18, "5\u201310\u4E07 18%"],
    [20, ">10\u4E07 20%"]
  ].map(([r, t]) => /* @__PURE__ */ __sv2_h("div", { key: r, className: finance.rate === r ? "on" : "" }, t))), /* @__PURE__ */ __sv2_h("small", { className: "__sv2_muted" }, "\u56DE\u6B3E\u5B8C\u6210\u540E\u8BA1\u5165\u63D0\u6210", estimated ? "\uFF1B\u6700\u7EC8\u4EE5\u4FDD\u5B58\u540E\u670D\u52A1\u5668\u7ED3\u679C\u4E3A\u51C6" : "")) : null);
}
function __sv2_Expenses({ rows, onChange, disabled }) {
  return /* @__PURE__ */ __sv2_h("section", { className: "crm-order-section" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u9500\u552E\u8D39\u7528"), /* @__PURE__ */ __sv2_h("small", null, "\u4ECE\u8BA2\u5355\u5229\u6DA6\u4E2D\u6263\u9664")), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_tw" }, /* @__PURE__ */ __sv2_h("table", { className: "__sv2_table __sv2_exp" }, /* @__PURE__ */ __sv2_h("thead", null, /* @__PURE__ */ __sv2_h("tr", null, /* @__PURE__ */ __sv2_h("th", null, "\u9879\u76EE"), /* @__PURE__ */ __sv2_h("th", null, "\u91D1\u989D"), /* @__PURE__ */ __sv2_h("th", null, "\u5907\u6CE8"), /* @__PURE__ */ __sv2_h("th", null, "\u64CD\u4F5C"))), /* @__PURE__ */ __sv2_h("tbody", null, rows.length ? rows.map((e, k) => /* @__PURE__ */ __sv2_h("tr", { key: k }, /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h(
    __sv2_Input,
    {
      label: "\u8D39\u7528\u7B2C" + (k + 1) + "\u884C\u9879\u76EE",
      list: "__sv2_exp_names",
      maxLength: 64,
      value: e.title,
      disabled,
      onChange: (v) => onChange(
        rows.map(
          (x, j) => j === k ? { ...x, title: v } : x
        )
      ),
      placeholder: "\u9009\u62E9\u6216\u8F93\u5165"
    }
  )), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h(
    __sv2_Input,
    {
      label: "\u8D39\u7528\u7B2C" + (k + 1) + "\u884C\u91D1\u989D",
      inputMode: "decimal",
      value: e.amount,
      disabled,
      onChange: (v) => onChange(
        rows.map(
          (x, j) => j === k ? { ...x, amount: v } : x
        )
      ),
      placeholder: "0.00"
    }
  )), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h(
    __sv2_Input,
    {
      label: "\u8D39\u7528\u7B2C" + (k + 1) + "\u884C\u5907\u6CE8",
      maxLength: 500,
      value: e.note,
      disabled,
      onChange: (v) => onChange(
        rows.map((x, j) => j === k ? { ...x, note: v } : x)
      ),
      placeholder: "\u4ED8\u6B3E\u5BF9\u8C61\u3001\u53D1\u7968"
    }
  )), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h(
    "button",
    {
      type: "button",
      className: "__sv2_link",
      disabled,
      onClick: () => onChange(rows.filter((_, j) => j !== k))
    },
    "\u5220\u9664"
  )))) : /* @__PURE__ */ __sv2_h("tr", null, /* @__PURE__ */ __sv2_h("td", { colSpan: 4, className: "__sv2_muted" }, "\u6682\u65E0\u9500\u552E\u8D39\u7528"))))), /* @__PURE__ */ __sv2_h("datalist", { id: "__sv2_exp_names" }, ["\u5F00\u7968\u7A0E\u70B9", "\u8FD0\u8D39", "\u5BA2\u6237\u8FD4\u70B9", "\u4E2D\u4ECB\u4F63\u91D1", "\u62DB\u5F85\u8D39", "\u5176\u4ED6"].map(
    (t) => /* @__PURE__ */ __sv2_h("option", { key: t, value: t })
  )), !disabled ? /* @__PURE__ */ __sv2_h(
    __sv2_Button,
    {
      disabled: rows.length >= 30,
      onClick: () => onChange([...rows, { title: "", amount: "", note: "" }])
    },
    "\uFF0B \u6DFB\u52A0\u8D39\u7528"
  ) : null, /* @__PURE__ */ __sv2_h("small", { className: "__sv2_muted" }, "\u6700\u591A30\u884C"));
}
const __sv2_cache = /* @__PURE__ */ new Map();
function __sv2_Page({ ready, state, embedded }) {
  const identity = be(), auth = ea(), utils = nt.useUtils(), [keyword, setKeyword] = p.useState(""), [search, setSearch] = p.useState(""), [tab, setTab] = p.useState("all"), [page, setPage] = p.useState(1), [session, setSession] = p.useState(null), [details, setDetails] = p.useState({}), [notice, setNotice] = p.useState("");
  const enabled = ready && identity.ready, list = nt.crmSalesOrder.list.useQuery(
    {
      keyword: search,
      page,
      pageSize: 20,
      ...embedded ? { customerId: embedded.customer.id } : {}
    },
    { enabled, retry: false, staleTime: 15e3, placeholderData: void 0 }
  ), rows = enabled && !list.isError ? list.data?.items ?? [] : [], epoch = rows.map((x) => x.id + ":" + x.version).join(","), root = p.useRef(null), scope = identity.identityKey;
  const rowsRef = p.useRef(rows);
  rowsRef.current = rows;
  p.useEffect(() => {
    setDetails({});
    setSession(null);
  }, [scope]);
  p.useEffect(() => {
    if (ready && identity.ready) {
      const receipt = __sv2_receipt(identity.storageScope), recovery = __sv2_createDraft(identity.storageScope);
      if (receipt) {
        setNotice(
          receipt.expenses?.length ? "\u8BA2\u5355\u5DF2\u521B\u5EFA\uFF0C\u4F46\u9500\u552E\u8D39\u7528\u672A\u4FDD\u5B58\uFF0C\u8BF7\u6253\u5F00\u8BA2\u5355\u8865\u5F55\u3002" : "\u8BA2\u5355\u5DF2\u521B\u5EFA\uFF0C\u8BF7\u6838\u5BF9\u521B\u5EFA\u7ED3\u679C\u3002"
        );
        setSession({
          id: receipt.id,
          key: scope + ":" + receipt.id,
          initialExpenses: receipt.expenses
        });
      } else if (recovery) {
        setNotice("\u65B0\u5EFA\u4FDD\u5B58\u7ED3\u679C\u5F85\u786E\u8BA4\uFF0C\u8BF7\u91CD\u8BD5\u539F\u8BF7\u6C42\u6838\u9A8C\uFF0C\u4E0D\u80FD\u91CD\u590D\u521B\u5EFA\u3002");
        setSession({ new: true, key: recovery.payload.requestId, recovery });
      }
    }
  }, [ready, identity.ready, identity.storageScope, scope]);
  p.useEffect(() => {
    if (!enabled || !rows.length) return;
    let alive = true, active = 0;
    const queue = [], queued = /* @__PURE__ */ new Set(), observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) enqueue(Number(e.target.dataset.orderId));
        });
      },
      { rootMargin: "0px" }
    );
    const pump = () => {
      while (alive && active < 3 && queue.length) {
        const row = queue.shift(), key = scope + ":" + row.id + ":" + row.version, cached = __sv2_cache.get(key);
        if (cached && Date.now() - cached.at < 6e4) {
          setDetails((v) => ({ ...v, [row.id]: cached.data }));
          continue;
        }
        active++;
        utils.crmSalesOrder.get.fetch(
          { id: row.id, ...embedded ? { customerId: row.customerId } : {} },
          { staleTime: 0 }
        ).then((data) => {
          if (!alive || data.id !== row.id || data.customerId !== row.customerId)
            return;
          __sv2_cache.set(key, { at: Date.now(), data });
          if (__sv2_cache.size > 100)
            __sv2_cache.delete(__sv2_cache.keys().next().value);
          setDetails((v) => ({ ...v, [row.id]: data }));
        }).catch(() => {
        }).finally(() => {
          active--;
          pump();
        });
      }
    };
    function enqueue(id) {
      if (queued.has(id)) return;
      const row = rowsRef.current.find((x) => x.id === id);
      if (!row) return;
      queued.add(id);
      queue.push(row);
      pump();
    }
    root.current?.querySelectorAll("[data-order-id]").forEach((el) => observer.observe(el));
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [scope, enabled, epoch, tab]);
  const completed = (o) => __sv2_complete(o), filtered = rows.filter(
    (o) => tab === "all" || tab === "cancelled" && o.status === "cancelled" || tab === "completed" && completed(o) || tab === "payment" && o.status !== "cancelled" && !completed(o) && __sv2_due(o) > 0n || tab === "shipment" && o.status !== "cancelled" && !completed(o) && o.shippedQty < o.orderedQty
  ), profitRows = filtered.filter((o) => __sv2_known(details[o.id] ?? o)), showProfit = rows.some((o) => __sv2_known(details[o.id] ?? o));
  let sales = 0n, due = 0n, net = 0n;
  filtered.forEach((o) => {
    sales += __sv2_micro(o.totalAmount);
    if (o.status !== "cancelled") due += __sv2_due(o);
    if (o.status !== "cancelled" && __sv2_known(details[o.id] ?? o))
      net += __sv2_micro((details[o.id] ?? o).profitBreakdown.netProfit);
  });
  const refresh = () => {
    __sv2_cache.clear();
    setDetails({});
    list.refetch();
  };
  return /* @__PURE__ */ __sv2_h("div", { className: "__sv2_scope", ref: root }, /* @__PURE__ */ __sv2_h("style", null, __sv2_css), /* @__PURE__ */ __sv2_h("div", { className: "aui-data-panel __sv2_toolbar" }, /* @__PURE__ */ __sv2_h(
    __sv2_Input,
    {
      label: "\u8BA2\u5355\u641C\u7D22",
      value: keyword,
      maxLength: 128,
      onChange: setKeyword,
      placeholder: "\u8BA2\u5355\u53F7\u3001\u9700\u6C42\u53F7\u3001\u9879\u76EE\u3001\u5BA2\u6237\u3001\u578B\u53F7",
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          setSearch(keyword.trim());
          setPage(1);
        }
      }
    }
  ), /* @__PURE__ */ __sv2_h(
    __sv2_Button,
    {
      onClick: () => {
        setSearch(keyword.trim());
        setPage(1);
      }
    },
    "\u7B5B\u9009"
  ), /* @__PURE__ */ __sv2_h(__sv2_Button, { onClick: refresh }, "\u5237\u65B0"), /* @__PURE__ */ __sv2_h(
    __sv2_Button,
    {
      primary: true,
      disabled: !enabled,
      onClick: () => setSession({ new: true, key: __sv2_id() })
    },
    "\u65B0\u5EFA\u4E1A\u52A1\u8BA2\u5355"
  )), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_summary" }, /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u8BA2\u5355\u91D1\u989D"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(sales))), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u5F85\u6536\u6B3E"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(due))), showProfit ? /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u51C0\u5229\u6DA6"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(net)), /* @__PURE__ */ __sv2_h("small", null, "\u5DF2\u6838\u7B97 ", profitRows.length, "/", filtered.length, " \u884C")) : null, /* @__PURE__ */ __sv2_h("small", null, "\u5F53\u524D\u9875 \xB7 \u5F53\u524D\u9875\u7B7E\u6C47\u603B\uFF08\u975E\u5168\u5E93\uFF09")), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_tabs", role: "tablist" }, [
    ["all", "\u5168\u90E8"],
    ["payment", "\u5F85\u6536\u6B3E"],
    ["shipment", "\u5F85\u51FA\u8D27"],
    ["completed", "\u5DF2\u5B8C\u6210"],
    ["cancelled", "\u5DF2\u53D6\u6D88"]
  ].map(([id, title]) => /* @__PURE__ */ __sv2_h(
    "button",
    {
      type: "button",
      role: "tab",
      "aria-selected": tab === id,
      className: tab === id ? "on" : "",
      key: id,
      onClick: () => setTab(id)
    },
    title
  )), /* @__PURE__ */ __sv2_h("small", null, "\u9875\u7B7E\u7B5B\u9009\u5F53\u524D\u9875\u6570\u636E")), list.isError ? /* @__PURE__ */ __sv2_h("div", { role: "alert", className: "__sv2_alert" }, __sv2_error(list.error)) : null, list.isFetching ? /* @__PURE__ */ __sv2_h("p", { role: "status", className: "__sv2_muted" }, "\u6B63\u5728\u8BFB\u53D6\u8BA2\u5355\u2026") : null, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_listwrap" }, /* @__PURE__ */ __sv2_h("table", { className: "crm-sales-orders-table admin-table-readable __sv2_list" }, /* @__PURE__ */ __sv2_h("thead", null, /* @__PURE__ */ __sv2_h("tr", null, [
    "\u8BA2\u5355\u53F7 / \u65E5\u671F",
    "\u5BA2\u6237",
    "\u6599\u53F7 / \u54C1\u724C",
    "\u6570\u91CF / \u5355\u4EF7",
    "\u8BA2\u5355\u91D1\u989D",
    ...showProfit ? ["\u51C0\u5229\u6DA6 / \u63D0\u6210"] : [],
    "\u6536\u6B3E",
    "\u51FA\u8D27",
    "\u8D1F\u8D23\u4EBA",
    "\u64CD\u4F5C"
  ].map((t) => /* @__PURE__ */ __sv2_h("th", { key: t }, t)))), /* @__PURE__ */ __sv2_h("tbody", null, filtered.map((o) => {
    const d = details[o.id] ?? o, i = d.items?.[0], open = (action) => setSession({ id: o.id, key: scope + ":" + o.id, action }), cancel = o.status === "cancelled", ro = cancel || completed(o);
    return /* @__PURE__ */ __sv2_h("tr", { "data-order-id": o.id, key: o.id }, /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h(
      "button",
      {
        type: "button",
        className: "crm-sales-orders-order-link __sv2_order",
        onClick: () => open("edit")
      },
      o.orderNumber
    ), /* @__PURE__ */ __sv2_h("small", null, __sv2_date(o.createdAt).replace(/-/g, "/"), " \xB7", " ", __sv2_status(o))), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h("div", { className: "admin-cell-primary" }, o.customerName), /* @__PURE__ */ __sv2_h("small", null, o.sourceType === "company_stock" ? "\u516C\u53F8\u5E93\u5B58" : o.demandNo || "\u9700\u6C42\u91C7\u8D2D")), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h("div", { className: "admin-cell-primary" }, i?.partNumber ?? "\u6B63\u5728\u8BFB\u53D6\u2026", d.items?.length > 1 ? " +" + (d.items.length - 1) + "\u9879" : ""), /* @__PURE__ */ __sv2_h("small", null, i ? [i.brand, i.dc ? "DC " + i.dc : ""].filter(Boolean).join(" \xB7 ") : "\u2014")), /* @__PURE__ */ __sv2_h("td", { className: "__sv2_n" }, o.orderedQty, " \u4EF6", /* @__PURE__ */ __sv2_h("small", null, d.items?.length === 1 ? __sv2_money(i.price ?? i.unitPrice, 4) + "/\u4EF6" : d.items?.length > 1 ? "\u591A\u4EF7" : "\u2014")), /* @__PURE__ */ __sv2_h("td", { className: "__sv2_n" }, __sv2_money(o.totalAmount), /* @__PURE__ */ __sv2_h("small", null, o.currencyLabel ?? (o.salesTaxMode === "tax_included" ? "\u4EBA\u6C11\u5E01\uFF08\u542B\u7A0E\uFF09" : o.salesTaxMode === "tax_excluded" ? "\u4EBA\u6C11\u5E01\uFF08\u672A\u7A0E\uFF09" : "\u7A0E\u53E3\u5F84\u5F85\u6838")), __sv2_micro(o.salesExpenses ?? "0") > 0n ? /* @__PURE__ */ __sv2_h("small", null, "\u8D39\u7528 ", __sv2_money(o.salesExpenses)) : null), showProfit ? /* @__PURE__ */ __sv2_h("td", { className: "__sv2_n" }, cancel ? "\u2014" : __sv2_known(d) ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h(
      "b",
      {
        className: __sv2_micro(d.profitBreakdown.netProfit) < 0n ? "__sv2_red" : "__sv2_green"
      },
      __sv2_money(d.profitBreakdown.netProfit)
    ), d.commissionPreview?.estimatedAmount != null ? /* @__PURE__ */ __sv2_h("small", null, "\u63D0\u6210 ", d.commissionPreview.rate, "% \xB7", " ", __sv2_money(d.commissionPreview.estimatedAmount)) : null) : /* @__PURE__ */ __sv2_h("small", null, "\u2014")) : null, /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h(
      "span",
      {
        className: __sv2_due(o) === 0n ? "__sv2_green" : __sv2_paid(o) > 0n ? "__sv2_amber" : "__sv2_muted"
      },
      "\u25CF"
    ), " ", o.paymentStatus === "monthly" ? "\u6708\u7ED3\u767B\u8BB0" : __sv2_due(o) === 0n ? "\u5DF2\u6536\u6B3E" : __sv2_paid(o) > 0n ? "\u90E8\u5206\u6536\u6B3E" : "\u672A\u6536\u6B3E"), !cancel ? /* @__PURE__ */ __sv2_h("small", null, "\u5F85\u6536 ", __sv2_money(__sv2_due(o))) : null), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h(
      "span",
      {
        className: o.shippedQty >= o.orderedQty ? "__sv2_green" : o.shippedQty > 0 ? "__sv2_amber" : "__sv2_muted"
      },
      "\u25CF"
    ), " ", o.shipmentStatus === "shipped" ? "\u5DF2\u51FA\u8D27" : o.shippedQty > 0 ? "\u90E8\u5206\u51FA\u8D27" : "\u672A\u51FA\u8D27"), /* @__PURE__ */ __sv2_h("small", null, o.shippedQty, "/", o.orderedQty)), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h("small", null, o.createdByName)), /* @__PURE__ */ __sv2_h("td", { className: "__sv2_actions" }, /* @__PURE__ */ __sv2_h("button", { type: "button", onClick: () => open("edit") }, "\u67E5\u770B"), !ro ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h("button", { type: "button", onClick: () => open("payment") }, "\u6536\u6B3E"), /* @__PURE__ */ __sv2_h("button", { type: "button", onClick: () => open("shipment") }, "\u51FA\u8D27")) : null));
  }), !filtered.length && !list.isFetching ? /* @__PURE__ */ __sv2_h("tr", null, /* @__PURE__ */ __sv2_h("td", { colSpan: showProfit ? 10 : 9, className: "__sv2_empty" }, "\u5F53\u524D\u9875\u6682\u65E0\u7B26\u5408\u6B64\u9875\u7B7E\u7684\u8BA2\u5355")) : null))), /* @__PURE__ */ __sv2_h("div", { className: "aui-pagination __sv2_pagination" }, /* @__PURE__ */ __sv2_h("span", null, "\u5171 ", list.data?.total ?? 0, " \u6761 \xB7 \u5F53\u524D\u9875 ", filtered.length, " \u6761"), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h(
    __sv2_Button,
    {
      disabled: page <= 1 || list.isFetching,
      onClick: () => setPage(page - 1)
    },
    "\u4E0A\u4E00\u9875"
  ), /* @__PURE__ */ __sv2_h("span", null, "\u7B2C ", page, " / ", Math.max(1, Math.ceil((list.data?.total ?? 0) / 20)), " ", "\u9875"), /* @__PURE__ */ __sv2_h(
    __sv2_Button,
    {
      disabled: page * 20 >= (list.data?.total ?? 0) || list.isFetching,
      onClick: () => setPage(page + 1)
    },
    "\u4E0B\u4E00\u9875"
  ))), notice ? /* @__PURE__ */ __sv2_h("p", { role: "status" }, notice) : null, session ? /* @__PURE__ */ __sv2_h(
    __sv2_Editor,
    {
      key: scope + session.key,
      session,
      enabled,
      embedded,
      onClose: () => setSession(null),
      onChanged: (msg) => {
        setNotice(msg);
        refresh();
        embedded?.onOrderChanged?.();
      }
    }
  ) : null);
}
function __sv2_Editor({ session, enabled, embedded, onClose, onChanged }) {
  const identity = be(), auth = ea(), utils = nt.useUtils(), [orderId, setOrderId] = p.useState(session.id ?? null), [order, setOrder] = p.useState(null), [form, setForm] = p.useState(
    () => session.recovery?.frozen ?? __sv2_new(auth.user?.name ?? auth.user?.username)
  ), [error, setError] = p.useState(""), [review, setReview] = p.useState(false), [reason, setReason] = p.useState(""), [history, setHistory] = p.useState(false), [picker, setPicker] = p.useState(null), [customerPicker, setCustomerPicker] = p.useState(false), [lotSearch, setLotSearch] = p.useState(""), [lotKeyword, setLotKeyword] = p.useState(""), [lotPage, setLotPage] = p.useState(1), [pending, setPending] = p.useState(session.recovery ?? null), [busy, setBusy] = p.useState(false), [payOpen, setPayOpen] = p.useState(session.action === "payment"), [shipOpen, setShipOpen] = p.useState(session.action === "shipment"), [pay, setPay] = p.useState({
    method: "bank",
    amount: "",
    date: __sv2_today(),
    note: ""
  }), [ship, setShip] = p.useState({
    method: "pickup",
    company: "",
    number: "",
    qty: {}
  }), [cancelOpen, setCancelOpen] = p.useState(false), [cancelReason, setCancelReason] = p.useState(""), [previewInput, setPreviewInput] = p.useState(null), [demandSearch, setDemandSearch] = p.useState("");
  const [createId] = p.useState(
    () => session.recovery?.payload.requestId ?? __sv2_id()
  ), [expenseId] = p.useState(__sv2_id), reviseId = p.useRef(__sv2_id()), guard = p.useRef({ alive: true, enabled, identity: identity.identityKey }), running = p.useRef(false), startIdentity = p.useRef(identity.identityKey);
  guard.current.enabled = enabled;
  guard.current.identity = identity.identityKey;
  p.useEffect(
    () => () => {
      guard.current.alive = false;
    },
    []
  );
  const writable = () => guard.current.alive && guard.current.enabled && guard.current.identity === startIdentity.current;
  const isNew = !orderId, read = nt.crmSalesOrder.get.useQuery(
    {
      id: orderId ?? 1,
      ...embedded ? { customerId: embedded.customer.id } : {}
    },
    {
      enabled: enabled && !!orderId,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      placeholderData: void 0
    }
  ), create = nt.crmSalesOrder.createCompanyStock.useMutation({ retry: false }), createDemand = nt.crmSalesOrder.create.useMutation({ retry: false }), revise = nt.crmSalesOrder.revise.useMutation({ retry: false }), payment = nt.crmSalesOrder.recordPayment.useMutation({ retry: false }), shipment = nt.crmSalesOrder.shipCompanyStock.useMutation({ retry: false }), cancel = nt.crmSalesOrder.cancel.useMutation({ retry: false }), allocate = nt.crmSalesOrder.allocateCompanyStock.useMutation({
    retry: false
  });
  p.useEffect(() => {
    if (enabled && read.isSuccess && !read.isFetching && read.data?.id === orderId && (!embedded || read.data.customerId === embedded.customer.id) && !order) {
      setOrder(read.data);
      setForm({
        ...__sv2_form(read.data),
        ...session.initialExpenses ? { expenses: session.initialExpenses } : {}
      });
      if (session.initialExpenses?.length)
        setError("\u8BA2\u5355\u5DF2\u521B\u5EFA\uFF0C\u4F46\u9500\u552E\u8D39\u7528\u672A\u4FDD\u5B58\uFF0C\u8BF7\u8865\u5F55\u3002\u4E0D\u4F1A\u518D\u6B21\u521B\u5EFA\u8BA2\u5355\u3002");
      setPay((v) => ({
        ...v,
        amount: __sv2_trim(__sv2_text(__sv2_due(read.data)))
      }));
    }
  }, [read.data, read.isFetching, orderId, enabled, order]);
  const readonly = !isNew && (order?.status === "cancelled" || order && __sv2_complete(order)), locked = busy || !!pending || !enabled || readonly, customerLocked = !isNew && (order?.sourceType !== "company_stock" || __sv2_paid(order) > 0n || order?.shippedQty > 0), totals = __sv2_totals(form), diffs = order ? __sv2_diffs(order, form) : [], errors = __sv2_validate(form, order), change = (patch) => {
    if (!locked) {
      setForm((v) => ({ ...v, ...patch }));
      setError("");
      setReview(false);
    }
  }, changeLine = (k, patch) => change({
    lines: form.lines.map((l, j) => j === k ? { ...l, ...patch } : l)
  });
  const lots = nt.crmSalesOrder.companyStockCandidates.useQuery(
    {
      customerId: form.customerId ?? 1,
      keyword: lotKeyword,
      page: lotPage,
      pageSize: 20,
      ...!isNew && order?.companyStockAllocations?.length ? {
        selectedLotIds: Array.from(
          new Set(order.companyStockAllocations.map((x) => x.lotId))
        )
      } : {}
    },
    {
      enabled: enabled && !!form.customerId && (form.source === "company_stock" || shipOpen) && !readonly,
      retry: false,
      staleTime: 1e4,
      placeholderData: void 0
    }
  );
  const demands = nt.crmSalesOrder.candidates.useQuery(
    {
      customerId: form.customerId ?? 1,
      keyword: demandSearch,
      page: 1,
      pageSize: 10
    },
    {
      enabled: enabled && isNew && form.source === "demand" && !!form.customerId,
      retry: false,
      staleTime: 0,
      placeholderData: void 0
    }
  );
  const signature = JSON.stringify([
    form.lines.map((l) => [l.qty, l.price, l.allocations]),
    form.salesTaxMode,
    form.customerId,
    form.confirmationNote,
    form.dueDate
  ]);
  p.useEffect(() => {
    setPreviewInput(null);
    if (!enabled || form.source !== "company_stock" || !form.customerId || !form.lines.length)
      return;
    const timer = setTimeout(() => {
      try {
        let payload = isNew ? __sv2_payload(
          { ...form, confirmationNote: form.confirmationNote || "\u9884\u4F30" },
          createId
        ) : __sv2_editPreview(order, form);
        if (!payload || form.lines.some(
          (l) => !/^[1-9]\d*$/.test(l.qty) || !__sv2_PRICE.test(l.price)
        ))
          return;
        setPreviewInput(payload);
      } catch {
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [signature, isNew, order, enabled]);
  const preview = nt.crmSalesOrder.previewCompanyStock.useQuery(
    previewInput ?? {
      customerId: form.customerId ?? 1,
      items: [],
      salesTaxMode: "tax_included",
      dueDate: null,
      confirmationNote: "\u9884\u4F30",
      customerConfirmed: true
    },
    {
      enabled: enabled && !!previewInput && !readonly,
      retry: false,
      staleTime: 1e4,
      placeholderData: void 0
    }
  );
  const sameQty = order && form.lines.every((l) => Number(l.qty) === l.orderedQty) && form.salesTaxMode === order.salesTaxMode, financeBase = !isNew && sameQty ? order : previewInput && preview.isSuccess && !preview.isFetching && !preview.isError ? preview.data : null, finance = readonly && order ? __sv2_localFinance(order, form) : __sv2_localFinance(financeBase, form), estimated = isNew || diffs.length > 0;
  const refresh = async () => {
    const data = await utils.crmSalesOrder.get.fetch(
      {
        id: orderId,
        ...embedded ? { customerId: embedded.customer.id } : {}
      },
      { staleTime: 0 }
    );
    if (writable()) {
      setOrder(data);
      setForm(__sv2_form(data));
      reviseId.current = __sv2_id();
      setReason("");
      setReview(false);
      setPending(null);
      setPay((v) => ({
        ...v,
        amount: __sv2_trim(__sv2_text(__sv2_due(data)))
      }));
    }
    return data;
  };
  const finish = async (result, frozen) => {
    if (!writable()) return;
    const id = result.id;
    __sv2_receipt(identity.storageScope, { id, expenses: frozen.expenses });
    __sv2_createDraft(identity.storageScope, null);
    setOrderId(id);
    const data = await utils.crmSalesOrder.get.fetch({ id }, { staleTime: 0 });
    if (!writable()) return;
    setOrder(data);
    setForm(__sv2_form(data));
    if (frozen.expenses.length) {
      try {
        await revise.mutateAsync({
          id,
          version: data.version,
          requestId: expenseId,
          reason: "\u65B0\u5EFA\u8BA2\u5355\u8865\u5F55\u9500\u552E\u8D39\u7528",
          confirmationNote: frozen.confirmationNote.trim(),
          dueDate: frozen.dueDate || null,
          lines: data.items.map((i) => ({
            orderItemId: i.id,
            orderedQty: i.orderedQty,
            unitPrice: i.unitPrice
          })),
          expenses: frozen.expenses.map((e) => ({
            title: e.title.trim(),
            amount: e.amount.trim(),
            note: e.note.trim()
          }))
        });
        const fresh = await utils.crmSalesOrder.get.fetch(
          { id },
          { staleTime: 0 }
        );
        if (writable()) {
          setOrder(fresh);
          setForm(__sv2_form(fresh));
          setError("\u8BA2\u5355\u5DF2\u521B\u5EFA\uFF0C\u9500\u552E\u8D39\u7528\u5DF2\u4FDD\u5B58\u3002");
          __sv2_receipt(identity.storageScope, null);
        }
      } catch (err) {
        if (writable()) {
          setForm({ ...__sv2_form(data), expenses: frozen.expenses });
          setError(
            "\u8BA2\u5355\u5DF2\u521B\u5EFA\uFF0C\u4F46\u9500\u552E\u8D39\u7528\u672A\u4FDD\u5B58\uFF0C\u8BF7\u6253\u5F00\u8BA2\u5355\u8865\u5F55\u3002\u5F53\u524D\u5DF2\u8F6C\u4E3A\u8BE5\u8BA2\u5355\u7F16\u8F91\u6001\uFF1B" + __sv2_error(err)
          );
        }
      }
    } else {
      setError("\u8BA2\u5355\u5DF2\u521B\u5EFA\u3002");
      __sv2_receipt(identity.storageScope, null);
    }
    setPending(null);
    onChanged("\u4E1A\u52A1\u8BA2\u5355\u5DF2\u521B\u5EFA\uFF1A" + result.orderNumber);
  };
  const submit = async () => {
    if (!writable() || running.current || readonly) return;
    if (!pending && errors.length) {
      setError(errors.join("\uFF1B"));
      return;
    }
    if (!isNew && !pending && !reason.trim()) {
      setError("\u8BF7\u586B\u5199\u4FEE\u6539\u539F\u56E0\uFF08\u6700\u591A200\u5B57\uFF09");
      return;
    }
    let operation = pending;
    if (!operation) {
      if (isNew) {
        operation = {
          kind: form.source === "demand" ? "createDemand" : "create",
          payload: __sv2_payload(form, createId),
          frozen: JSON.parse(JSON.stringify(form))
        };
      } else {
        operation = {
          kind: "revise",
          payload: {
            id: order.id,
            version: order.version,
            requestId: reviseId.current,
            reason: reason.trim(),
            dueDate: form.dueDate || null,
            confirmationNote: form.confirmationNote.trim(),
            ...form.salesTaxMode ? { salesTaxMode: form.salesTaxMode } : {},
            ...form.customerId !== order.customerId ? { customerId: form.customerId } : {},
            lines: form.lines.map((l) => ({
              orderItemId: l.orderItemId,
              orderedQty: Number(l.qty),
              unitPrice: l.price.trim()
            })),
            expenses: form.expenses.map((e) => ({
              title: e.title.trim(),
              amount: e.amount.trim(),
              note: e.note.trim()
            }))
          }
        };
      }
    }
    running.current = true;
    setBusy(true);
    setPending(operation);
    if (operation.kind !== "revise")
      __sv2_createDraft(identity.storageScope, operation);
    setError("");
    try {
      const result = await (operation.kind === "create" ? create : operation.kind === "createDemand" ? createDemand : revise).mutateAsync(operation.payload);
      if (!writable()) return;
      if (operation.kind !== "revise") {
        await finish(result, operation.frozen);
      } else {
        setPending(null);
        setReview(false);
        await refresh();
        setError(
          result.replayed ? "\u5DF2\u8FD4\u56DE\u6B64\u524D\u4FDD\u5B58\u7ED3\u679C\u3002" : "\u4FDD\u5B58\u4FEE\u6539\u6210\u529F\uFF0C\u5229\u6DA6\u4E0E\u63D0\u6210\u5DF2\u91CD\u7B97\u3002"
        );
        onChanged("\u8BA2\u5355\u5DF2\u66F4\u65B0");
        __sv2_receipt(identity.storageScope, null);
      }
    } catch (err) {
      if (writable()) {
        setError(__sv2_error(err));
        if (__sv2_definite(err)) {
          setPending(null);
          if (operation.kind !== "revise")
            __sv2_createDraft(identity.storageScope, null);
        }
      }
    } finally {
      running.current = false;
      if (writable()) setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    if (pending) {
      setError("\u4FDD\u5B58\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\uFF0C\u8BF7\u5148\u91CD\u8BD5\u539F\u8BF7\u6C42\u6838\u9A8C\uFF0C\u4E0D\u53EF\u4E22\u5F03\u8BF7\u6C42\u6807\u8BC6\u3002");
      return;
    }
    if ((isNew && (form.lines.length || form.expenses.length || form.confirmationNote) || !isNew && diffs.length) && !globalThis.confirm("\u4FEE\u6539\u5C1A\u672A\u4FDD\u5B58\uFF0C\u786E\u8BA4\u653E\u5F03\u5E76\u5173\u95ED\uFF1F"))
      return;
    onClose();
  };
  const action = async (kind, payload) => {
    if (!writable() || running.current || readonly) return;
    if (diffs.length) {
      setError("\u8BF7\u5148\u4FDD\u5B58\u8BA2\u5355\u4FEE\u6539\uFF0C\u518D\u767B\u8BB0\u6536\u6B3E\u6216\u51FA\u8D27\u3002");
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      await (kind === "payment" ? payment : kind === "cancel" ? cancel : kind === "allocate" ? allocate : shipment).mutateAsync(payload);
      if (writable()) {
        await refresh();
        setPayOpen(false);
        setShipOpen(false);
        setCancelOpen(false);
        setError("\u64CD\u4F5C\u6210\u529F\u3002");
        onChanged("\u8BA2\u5355\u5DF2\u66F4\u65B0");
      }
    } catch (err) {
      if (writable()) setError(__sv2_error(err));
    } finally {
      running.current = false;
      if (writable()) setBusy(false);
    }
  };
  const payRequest = p.useRef(null), shipRequest = p.useRef(null);
  const addLot = (lot) => {
    if (locked) return;
    const lotData = { ...lot, qty: "", consumedQty: 0 };
    if (typeof picker === "number" && form.lines[picker]) {
      const row = form.lines[picker];
      if (row.allocations.length && [row.partNumber, row.brand ?? "", row.pkg ?? "", row.dc ?? ""].join(
        "|"
      ) !== [lot.partNumber, lot.brand ?? "", lot.pkg ?? "", lot.dc ?? ""].join(
        "|"
      )) {
        setError(
          "\u540C\u4E00\u884C\u591A\u6279\u6B21\u5FC5\u987B\u6599\u53F7\u3001\u54C1\u724C\u3001\u5C01\u88C5\u3001DC\u5B8C\u5168\u4E00\u81F4\uFF1B\u4E0D\u540C\u7269\u6599\u8BF7\u6DFB\u52A0\u65B0\u884C\u3002"
        );
        return;
      }
      if (row.allocations.some((x) => x.lotId === lot.lotId)) {
        setError("\u672C\u884C\u4E0D\u80FD\u91CD\u590D\u9009\u62E9\u540C\u4E00\u6279\u6B21\u3002");
        return;
      }
      changeLine(picker, {
        ...!row.allocations.length ? {
          partNumber: lot.partNumber,
          brand: lot.brand,
          pkg: lot.pkg,
          dc: lot.dc
        } : {},
        allocations: [...row.allocations, lotData]
      });
    } else
      change({
        lines: [
          ...form.lines,
          {
            partNumber: lot.partNumber,
            brand: lot.brand,
            pkg: lot.pkg,
            dc: lot.dc,
            qtyUnit: "\u4E2A",
            qty: "",
            price: "",
            shippedQty: 0,
            allocations: [lotData]
          }
        ]
      });
    setPicker(null);
  };
  const availableFor = (l) => {
    if (isNew)
      return (l.allocations ?? []).reduce(
        (n, x) => n + Number(x.availableQty ?? 0),
        0
      );
    const byId = new Map(
      [...lots.data?.items ?? [], ...lots.data?.selectedItems ?? []].map(
        (x) => [x.lotId, x]
      )
    );
    const allocations = (order?.companyStockAllocations ?? []).filter(
      (x) => x.orderItemId === l.orderItemId
    );
    if (allocations.some((x) => !byId.has(x.lotId))) return "\u2014";
    return allocations.reduce(
      (n, x) => n + Number(byId.get(x.lotId).availableQty ?? 0),
      0
    );
  };
  return /* @__PURE__ */ __sv2_h(
    __sv2_Dialog,
    {
      open: true,
      onOpenChange: (v) => {
        if (!v) close();
      }
    },
    /* @__PURE__ */ __sv2_h(
      __sv2_Content,
      {
        className: "crm-sales-orders-dialog __sv2_scope __sv2_dialog",
        showCloseButton: false,
        onPointerDownOutside: (e) => e.preventDefault(),
        onEscapeKeyDown: (e) => {
          if (busy || pending) e.preventDefault();
        },
        "aria-describedby": "__sv2_desc"
      },
      /* @__PURE__ */ __sv2_h("style", null, __sv2_css),
      /* @__PURE__ */ __sv2_h("div", { className: "__sv2_dialoghead" }, /* @__PURE__ */ __sv2_h(__sv2_Header, null, /* @__PURE__ */ __sv2_h(__sv2_Title, null, isNew ? "\u65B0\u5EFA\u4E1A\u52A1\u8BA2\u5355" : "\u9500\u552E\u8BA2\u5355\u8BE6\u60C5")), /* @__PURE__ */ __sv2_h("div", null, order ? /* @__PURE__ */ __sv2_h(__sv2_Button, { onClick: () => setHistory(true) }, "\u4FEE\u6539\u8BB0\u5F55 ", order.audits?.length ?? 0) : null, /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          "aria-label": "\u5173\u95ED\u8BA2\u5355\u5F39\u7A97",
          className: "__sv2_x",
          onClick: close
        },
        "\xD7"
      ))),
      /* @__PURE__ */ __sv2_h("span", { id: "__sv2_desc", className: "sr-only" }, "\u7EDF\u4E00\u4E24\u680F\u67E5\u770B\u4E0E\u7F16\u8F91\u4E1A\u52A1\u8BA2\u5355"),
      /* @__PURE__ */ __sv2_h("div", { className: "__sv2_body" }, read.isError ? /* @__PURE__ */ __sv2_h("div", { className: "__sv2_alert", role: "alert" }, __sv2_error(read.error), /* @__PURE__ */ __sv2_h(__sv2_Button, { onClick: () => read.refetch() }, "\u91CD\u65B0\u8BFB\u53D6")) : null, !isNew && !order ? /* @__PURE__ */ __sv2_h("p", { role: "status" }, "\u6B63\u5728\u8BFB\u53D6\u8BA2\u5355\u2026") : /* @__PURE__ */ __sv2_h("div", { className: "__sv2_grid" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_left" }, /* @__PURE__ */ __sv2_h("section", { className: "aui-data-panel __sv2_card" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u5BA2\u6237\u4E0E\u4EA4\u4ED8"), /* @__PURE__ */ __sv2_h("div", null, isNew ? /* @__PURE__ */ __sv2_h("div", { className: "__sv2_segment" }, /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          className: form.source === "company_stock" ? "on" : "",
          disabled: locked,
          onClick: () => change({
            source: "company_stock",
            salesTaxMode: "tax_included",
            lines: [],
            demand: null
          })
        },
        "\u516C\u53F8\u5E93\u5B58"
      ), /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          className: form.source === "demand" ? "on" : "",
          disabled: locked,
          onClick: () => change({
            source: "demand",
            salesTaxMode: "",
            lines: [],
            demand: null
          })
        },
        "\u9700\u6C42\u91C7\u8D2D"
      )) : /* @__PURE__ */ __sv2_h("small", null, order.sourceType === "company_stock" ? "\u516C\u53F8\u5E93\u5B58" : "\u9700\u6C42\u91C7\u8D2D \xB7 " + (order.demandNo ?? "")))), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_meta" }, /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u8BA2\u5355\u53F7\uFF1A"), order?.orderNumber ?? "\u4FDD\u5B58\u540E\u751F\u6210"), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u72B6\u6001\uFF1A"), order ? __sv2_status(order) : "\u65B0\u5EFA"), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u5BA2\u6237\uFF1A"), form.customerName || "\u8BF7\u9009\u62E9\u5BA2\u6237", customerLocked ? "\uFF08\u9501\u5B9A\uFF09" : !locked ? /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          className: "__sv2_link",
          onClick: () => setCustomerPicker(!customerPicker)
        },
        form.customerId ? " \u66F4\u6362" : " \u9009\u62E9\u5BA2\u6237"
      ) : null), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u8D1F\u8D23\u4EBA\uFF1A"), form.owner, " ", /* @__PURE__ */ __sv2_h("small", null, "\u9501\u5B9A")), /* @__PURE__ */ __sv2_h("label", null, /* @__PURE__ */ __sv2_h("span", null, "\u4E0B\u5355\u65E5\u671F\uFF1A"), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u4E0B\u5355\u65E5\u671F",
          type: "date",
          value: form.orderDate,
          disabled: true,
          title: "\u73B0\u6709\u63A5\u53E3\u4E0D\u652F\u6301\u4FEE\u6539\u4E0B\u5355\u65E5\u671F",
          onChange: () => {
          }
        }
      )), /* @__PURE__ */ __sv2_h("label", null, /* @__PURE__ */ __sv2_h("span", null, "\u7EA6\u5B9A\u4EA4\u4ED8\uFF1A"), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u7EA6\u5B9A\u4EA4\u4ED8\u65E5\u671F",
          type: "date",
          value: form.dueDate,
          disabled: locked,
          onChange: (v) => change({ dueDate: v })
        }
      ))), customerPicker && !customerLocked && !locked ? /* @__PURE__ */ __sv2_h("div", { className: "__sv2_picker" }, /* @__PURE__ */ __sv2_h(
        __sv2_Customer,
        {
          enabled: enabled && !locked,
          onSelect: (customer) => {
            if (writable()) {
              change({
                customerId: customer.id,
                customerName: customer.name,
                lines: isNew ? [] : form.lines
              });
              setCustomerPicker(false);
            }
          }
        }
      )) : null), isNew && form.source === "demand" ? /* @__PURE__ */ __sv2_h("section", { className: "aui-data-panel __sv2_card" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u5173\u8054\u9700\u6C42"), /* @__PURE__ */ __sv2_h("small", null, "\u6CBF\u7528\u5BA2\u6237\u9700\u6C42\u8F6C\u5355")), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u641C\u7D22\u5173\u8054\u9700\u6C42",
          value: demandSearch,
          onChange: setDemandSearch,
          placeholder: "\u9700\u6C42\u53F7\u3001\u578B\u53F7"
        }
      ), demands.isError ? /* @__PURE__ */ __sv2_h("p", { className: "__sv2_red" }, __sv2_error(demands.error)) : null, (demands.data?.items ?? []).map((d) => /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          key: d.id,
          disabled: locked,
          className: "__sv2_demand",
          onClick: () => change({
            demand: d,
            lines: (d.items ?? []).filter(
              (i) => Number(i.remainingQty ?? i.qty) > 0
            ).map((i) => ({
              ...i,
              sourceDemandItemId: i.id,
              qty: String(i.remainingQty ?? i.qty),
              price: __sv2_trim(
                i.agreedUnitPrice ?? i.unitPrice ?? ""
              ),
              shippedQty: 0,
              allocations: []
            }))
          })
        },
        d.demandNo,
        " \xB7 ",
        d.projectName,
        " \xB7 ",
        d.items?.length ?? 0,
        "\u884C"
      )), form.demand ? /* @__PURE__ */ __sv2_h("small", null, "\u5DF2\u9009 ", form.demand.demandNo, " \xB7 \u7248\u672C", " ", form.demand.revision ?? 1) : null) : null, /* @__PURE__ */ __sv2_h("section", { className: "crm-order-section" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u8BA2\u5355\u660E\u7EC6"), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_tax" }, /* @__PURE__ */ __sv2_h("span", null, "\u9500\u552E\u53E3\u5F84"), /* @__PURE__ */ __sv2_h(
        "select",
        {
          className: "crm-input",
          "aria-label": "\u9500\u552E\u542B\u7A0E\u53E3\u5F84",
          disabled: locked || !isNew && !order?.salesTaxMode && !order?.companyStockAllocated || form.source === "demand" && isNew,
          value: form.salesTaxMode,
          onChange: (e) => change({ salesTaxMode: e.target.value })
        },
        !form.salesTaxMode ? /* @__PURE__ */ __sv2_h("option", { value: "" }, "\u5F85\u6838") : null,
        /* @__PURE__ */ __sv2_h("option", { value: "tax_included" }, "\u542B\u7A0E"),
        /* @__PURE__ */ __sv2_h("option", { value: "tax_excluded" }, "\u672A\u7A0E")
      ), /* @__PURE__ */ __sv2_h("span", null, "\u7A0E\u7387"), /* @__PURE__ */ __sv2_h(
        "input",
        {
          className: "crm-input",
          "aria-label": "\u9500\u552E\u7A0E\u7387",
          value: "13",
          disabled: true,
          title: "\u540E\u7AEF\u73B0\u884C\u56FA\u5B9A13%"
        }
      ), /* @__PURE__ */ __sv2_h("span", null, "%"))), isNew && form.source === "company_stock" ? /* @__PURE__ */ __sv2_h("div", { className: "__sv2_lotbar" }, /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u8F93\u5165\u6599\u53F7\u641C\u7D22\u5E93\u5B58",
          value: lotSearch,
          disabled: locked || !form.customerId,
          onChange: (v) => {
            setLotSearch(v);
            setLotKeyword(v);
            setLotPage(1);
            setPicker("new");
          },
          placeholder: "\u8F93\u5165\u6599\u53F7\uFF0C\u9009\u62E9\u6279\u6B21\u81EA\u52A8\u5E26\u51FA\u54C1\u724C / DC"
        }
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          disabled: locked || !form.customerId,
          onClick: () => {
            setPicker("new");
            setLotKeyword(lotSearch);
            setLotPage(1);
          }
        },
        "\uFF0B \u6DFB\u52A0\u7269\u6599"
      )) : null, picker !== null && !locked ? /* @__PURE__ */ __sv2_h("div", { className: "__sv2_picker" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u9009\u62E9\u516C\u53F8\u5E93\u5B58\u6279\u6B21"), /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          className: "__sv2_link",
          onClick: () => setPicker(null)
        },
        "\u6536\u8D77"
      )), typeof picker === "number" ? /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u6279\u6B21\u641C\u7D22\u6599\u53F7",
          value: lotSearch,
          onChange: (v) => {
            setLotSearch(v);
            setLotKeyword(v);
            setLotPage(1);
          },
          placeholder: "\u6599\u53F7 / \u54C1\u724C / DC"
        }
      ) : null, lots.isError ? /* @__PURE__ */ __sv2_h("p", { role: "alert", className: "__sv2_red" }, __sv2_error(lots.error)) : null, lots.isFetching ? /* @__PURE__ */ __sv2_h("p", null, "\u6B63\u5728\u8BFB\u53D6\u53EF\u552E\u6279\u6B21\u2026") : (lots.data?.items ?? []).map((l) => /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          key: l.lotId,
          className: "__sv2_lot",
          onClick: () => addLot(l)
        },
        /* @__PURE__ */ __sv2_h("strong", null, l.partNumber),
        /* @__PURE__ */ __sv2_h("span", null, l.brand, " / DC ", l.dc || "\u2014", " / \u6279\u6B21 #", l.lotId, " / \u5165\u5E93 #", l.inboundOrderId),
        /* @__PURE__ */ __sv2_h("b", null, "\u53EF\u552E ", l.availableQty)
      )), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          disabled: lotPage <= 1,
          onClick: () => setLotPage(lotPage - 1)
        },
        "\u4E0A\u4E00\u9875"
      ), /* @__PURE__ */ __sv2_h("small", null, "\u5171 ", lots.data?.total ?? 0, " \u4E2A\u6279\u6B21"), /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          disabled: lotPage * 20 >= (lots.data?.total ?? 0),
          onClick: () => setLotPage(lotPage + 1)
        },
        "\u4E0B\u4E00\u9875"
      ))) : null, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_tw" }, /* @__PURE__ */ __sv2_h("table", { className: "__sv2_table __sv2_items" }, /* @__PURE__ */ __sv2_h("thead", null, /* @__PURE__ */ __sv2_h("tr", null, /* @__PURE__ */ __sv2_h("th", null, "\u578B\u53F7 / \u54C1\u724C / \u6279\u6B21"), /* @__PURE__ */ __sv2_h("th", null, "\u53EF\u552E"), /* @__PURE__ */ __sv2_h("th", null, "\u5DF2\u51FA"), /* @__PURE__ */ __sv2_h("th", null, "\u9500\u552E\u6570\u91CF"), /* @__PURE__ */ __sv2_h("th", null, "\u9500\u552E\u5355\u4EF7"), /* @__PURE__ */ __sv2_h("th", null, "\u91D1\u989D"), /* @__PURE__ */ __sv2_h("th", null, "\u64CD\u4F5C"))), /* @__PURE__ */ __sv2_h("tbody", null, form.lines.length ? form.lines.map((l, k) => {
        const cost = l.unitCost ?? l.allocations?.[0]?.unitCost, priceValid = __sv2_PRICE.test(String(l.price)), qtyValid = /^\d+$/.test(String(l.qty));
        return /* @__PURE__ */ __sv2_h("tr", { key: l.orderItemId ?? k }, /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h("strong", null, l.partNumber), /* @__PURE__ */ __sv2_h("small", null, [l.brand, l.pkg, l.dc ? "DC " + l.dc : ""].filter(Boolean).join(" / ")), (l.allocations ?? []).map((x, j) => /* @__PURE__ */ __sv2_h(
          "div",
          {
            className: "__sv2_allocation",
            key: x.lotId
          },
          /* @__PURE__ */ __sv2_h("small", null, "\u6279\u6B21 #", x.lotId, isNew ? " \xB7 \u53EF\u552E " + x.availableQty : " \xB7 \u9884\u7559 " + (x.reservedQty ?? 0)),
          isNew ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h(
            __sv2_Input,
            {
              label: "\u7B2C" + (k + 1) + "\u884C\u6279\u6B21" + (j + 1) + "\u5206\u914D\u6570\u91CF",
              inputMode: "numeric",
              value: x.qty,
              disabled: locked,
              onChange: (v) => changeLine(k, {
                allocations: l.allocations.map(
                  (y, n) => n === j ? { ...y, qty: v } : y
                )
              })
            }
          ), /* @__PURE__ */ __sv2_h(
            "button",
            {
              type: "button",
              className: "__sv2_link",
              disabled: locked,
              onClick: () => changeLine(k, {
                allocations: l.allocations.filter(
                  (_, n) => n !== j
                )
              })
            },
            "\u79FB\u9664\u6279\u6B21"
          )) : null
        )), cost != null ? /* @__PURE__ */ __sv2_h("small", { className: "__sv2_blue" }, "\u5355\u4EF6\u6210\u672C\uFF08\u542B\u91C7\u8D2D\u8D39\u7528\uFF09", __sv2_money(cost, 4), priceValid ? " \xB7 \u5355\u4EF6\u5DEE\u4EF7 " + __sv2_money(
          __sv2_micro(l.price) - __sv2_micro(cost),
          4
        ) : "") : null, l.shippedQty > 0 ? /* @__PURE__ */ __sv2_h("small", null, "\u5DF2\u51FA\u8D27\uFF0C\u6599\u53F7/\u54C1\u724C/DC\u9501\u5B9A") : null, isNew && form.source === "company_stock" ? /* @__PURE__ */ __sv2_h(
          "button",
          {
            type: "button",
            className: "__sv2_link",
            disabled: locked,
            onClick: () => {
              setPicker(k);
              setLotSearch(l.partNumber);
              setLotKeyword(l.partNumber);
              setLotPage(1);
            }
          },
          "\uFF0B \u5206\u914D\u66F4\u591A\u540C\u7269\u6599\u6279\u6B21"
        ) : null), /* @__PURE__ */ __sv2_h("td", { className: "__sv2_n" }, form.source === "company_stock" ? availableFor(l) : "\u2014"), /* @__PURE__ */ __sv2_h("td", { className: "__sv2_n" }, l.shippedQty ?? 0), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h(
          __sv2_Input,
          {
            label: "\u7B2C" + (k + 1) + "\u884C\u9500\u552E\u6570\u91CF",
            inputMode: "numeric",
            value: l.qty,
            disabled: locked,
            className: "crm-input " + (Number(l.qty) < Number(l.shippedQty ?? 0) ? "__sv2_invalid" : ""),
            onChange: (v) => changeLine(k, {
              qty: v,
              ...isNew && l.allocations.length === 1 ? {
                allocations: [
                  { ...l.allocations[0], qty: v }
                ]
              } : {}
            })
          }
        ), Number(l.qty) < Number(l.shippedQty ?? 0) ? /* @__PURE__ */ __sv2_h("small", { className: "__sv2_red" }, "\u4E0D\u80FD\u5C11\u4E8E\u5DF2\u51FA\u8D27 ", l.shippedQty) : null), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h(
          __sv2_Input,
          {
            label: "\u7B2C" + (k + 1) + "\u884C\u9500\u552E\u5355\u4EF7",
            inputMode: "decimal",
            value: l.price,
            disabled: locked,
            onChange: (v) => changeLine(k, { price: v })
          }
        )), /* @__PURE__ */ __sv2_h("td", { className: "__sv2_n" }, priceValid && qtyValid ? __sv2_money(
          __sv2_micro(l.price) * BigInt(l.qty)
        ) : "\u2014"), /* @__PURE__ */ __sv2_h("td", null, isNew ? /* @__PURE__ */ __sv2_h(
          "button",
          {
            type: "button",
            className: "__sv2_link",
            disabled: locked,
            onClick: () => change({
              lines: form.lines.filter(
                (_, j) => j !== k
              )
            })
          },
          "\u79FB\u9664"
        ) : /* @__PURE__ */ __sv2_h("small", { title: "\u73B0\u6709\u6539\u5355\u63A5\u53E3\u4E0D\u652F\u6301\u589E\u5220\u7269\u6599" }, "\u2014")));
      }) : /* @__PURE__ */ __sv2_h("tr", null, /* @__PURE__ */ __sv2_h("td", { colSpan: 7, className: "__sv2_muted" }, form.source === "company_stock" ? "\u8BF7\u5148\u9009\u62E9\u516C\u53F8\u5E93\u5B58\u6279\u6B21" : "\u8BF7\u9009\u62E9\u5173\u8054\u9700\u6C42")))), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_total" }, /* @__PURE__ */ __sv2_h("span", null, form.lines.length, " \u884C\u7269\u6599"), /* @__PURE__ */ __sv2_h("span", null, "\u5408\u8BA1 ", /* @__PURE__ */ __sv2_h("b", null, totals.qty), " \u4EF6"), /* @__PURE__ */ __sv2_h("span", null, "\u91D1\u989D ", /* @__PURE__ */ __sv2_h("b", null, __sv2_money(totals.sales))))), !isNew && !readonly ? /* @__PURE__ */ __sv2_h("small", { className: "__sv2_muted" }, "\u73B0\u6709\u63A5\u53E3\u4EC5\u652F\u6301\u6570\u91CF\u3001\u5355\u4EF7\u8C03\u6574\uFF1B\u7269\u6599\u8EAB\u4EFD/\u589E\u5220\u884C/\u6362\u6279\u6B21\u5C1A\u4E0D\u652F\u6301\u3002") : null), /* @__PURE__ */ __sv2_h(
        __sv2_Expenses,
        {
          rows: form.expenses,
          disabled: locked,
          onChange: (expenses) => change({ expenses })
        }
      ), /* @__PURE__ */ __sv2_h(
        "details",
        {
          className: "crm-sales-orders-fold __sv2_note",
          open: isNew ? true : void 0
        },
        /* @__PURE__ */ __sv2_h("summary", null, "\u5BA2\u6237\u786E\u8BA4\u8BF4\u660E", isNew ? "\uFF08\u5FC5\u586B\uFF09" : ""),
        /* @__PURE__ */ __sv2_h(
          "textarea",
          {
            className: "crm-input",
            "aria-label": "\u5BA2\u6237\u786E\u8BA4\u8BF4\u660E",
            maxLength: 500,
            value: form.confirmationNote,
            disabled: locked,
            onChange: (e) => change({ confirmationNote: e.target.value }),
            placeholder: "\u5982\uFF1A\u5BA2\u6237\u5FAE\u4FE1\u786E\u8BA4\u578B\u53F7\u3001\u6570\u91CF\u3001\u9500\u552E\u5355\u4EF7\u53CA\u4EA4\u671F"
          }
        )
      ), shipOpen && !isNew && !readonly && order && order.sourceType !== "company_stock" && !order.companyStockAllocated ? /* @__PURE__ */ __sv2_h("section", { className: "aui-data-panel __sv2_card" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u9700\u6C42\u91C7\u8D2D\u8BA2\u5355\u4EA4\u4ED8"), /* @__PURE__ */ __sv2_h("small", null, "\u6CBF\u7528\u539F\u6279\u6B21\u5206\u914D / \u9884\u7559 / \u51FA\u8D27\u6D41\u7A0B")), /* @__PURE__ */ __sv2_h(
        __sv2_StockDelivery,
        {
          order,
          enabled: enabled && !busy && !diffs.length,
          onSaved: async () => {
            await refresh();
            setShipOpen(false);
            onChanged("\u51FA\u8D27\u5DF2\u767B\u8BB0");
          },
          onAllocated: async () => {
            await refresh();
            onChanged("\u516C\u53F8\u5E93\u5B58\u5DF2\u5206\u914D");
          },
          onDirtyChange: () => {
          },
          onBusyChange: setBusy,
          onCancel: () => setShipOpen(false)
        }
      )) : null, isNew ? /* @__PURE__ */ __sv2_h("label", { className: "__sv2_confirmed" }, /* @__PURE__ */ __sv2_h(
        "input",
        {
          type: "checkbox",
          "aria-label": "\u5BA2\u6237\u5DF2\u786E\u8BA4",
          checked: form.customerConfirmed,
          disabled: locked,
          onChange: (e) => change({ customerConfirmed: e.target.checked })
        }
      ), " ", "\u5BA2\u6237\u5DF2\u786E\u8BA4\u6570\u91CF\u3001\u9500\u552E\u4EF7\u683C\u4E0E\u4EA4\u671F", " ", /* @__PURE__ */ __sv2_h("span", { className: "__sv2_red" }, "*")) : null), /* @__PURE__ */ __sv2_h("aside", { className: "__sv2_side" }, /* @__PURE__ */ __sv2_h(
        __sv2_Finance,
        {
          finance,
          totals,
          estimated
        }
      ), !finance && previewInput && preview.isFetching ? /* @__PURE__ */ __sv2_h("small", { className: "__sv2_muted" }, "\u6B63\u5728\u9884\u4F30\uFF08\u4E0D\u6309\u96F6\u6210\u672C\u8BA1\u7B97\uFF09\u2026") : null, preview.isError ? /* @__PURE__ */ __sv2_h("small", { className: "__sv2_muted" }, "\u5229\u6DA6\u9884\u4F30\u6682\u4E0D\u53EF\u7528\uFF0C\u4FDD\u5B58\u540E\u4EE5\u670D\u52A1\u5668\u7ED3\u679C\u4E3A\u51C6\u3002") : null, /* @__PURE__ */ __sv2_h("section", { className: "aui-data-panel __sv2_card" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u6536\u6B3E"), !isNew && !readonly ? /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          className: "__sv2_link",
          disabled: busy,
          onClick: () => setPayOpen(!payOpen)
        },
        "\u767B\u8BB0\u6536\u6B3E \u203A"
      ) : null), /* @__PURE__ */ __sv2_h("small", null, order?.paymentStatus === "monthly" ? "\u6708\u7ED3\u767B\u8BB0" : order && __sv2_paid(order) > 0n ? "\u5DF2\u6536 " + __sv2_money(__sv2_paid(order)) : "\u672A\u6536\u6B3E"), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_bar" }, /* @__PURE__ */ __sv2_h(
        "i",
        {
          style: {
            width: order && __sv2_micro(order.totalAmount) > 0n ? Number(
              __sv2_div(
                __sv2_paid(order) * 10000n,
                __sv2_micro(order.totalAmount)
              )
            ) / 100 + "%" : "0%"
          }
        }
      )), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_three" }, /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u5E94\u6536"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(totals.sales))), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u5DF2\u6536"), /* @__PURE__ */ __sv2_h("b", null, __sv2_money(order ? __sv2_paid(order) : 0n))), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u5F85\u6536"), /* @__PURE__ */ __sv2_h("b", { className: "__sv2_red" }, __sv2_money(
        totals.sales === null ? null : totals.sales - (order ? __sv2_paid(order) : 0n) > 0n ? totals.sales - (order ? __sv2_paid(order) : 0n) : 0n
      )))), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_records" }, order?.payments?.map((x) => /* @__PURE__ */ __sv2_h("p", { key: x.id }, x.paymentDate, " ", { bank: "\u5BF9\u516C\u8F6C\u8D26", cash: "\u73B0\u91D1", monthly: "\u6708\u7ED3" }[x.method], " ", __sv2_money(x.amount), x.note ? " \xB7 " + x.note : ""))), payOpen && !readonly && order ? /* @__PURE__ */ __sv2_h("div", { className: "__sv2_inline" }, /* @__PURE__ */ __sv2_h(
        "select",
        {
          className: "crm-input",
          "aria-label": "\u6536\u6B3E\u65B9\u5F0F",
          value: pay.method,
          disabled: busy,
          onChange: (e) => setPay({ ...pay, method: e.target.value })
        },
        /* @__PURE__ */ __sv2_h("option", { value: "bank" }, "\u5BF9\u516C\u8F6C\u8D26"),
        /* @__PURE__ */ __sv2_h("option", { value: "cash" }, "\u73B0\u91D1"),
        /* @__PURE__ */ __sv2_h("option", { value: "monthly" }, "\u6708\u7ED3")
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u6536\u6B3E\u91D1\u989D",
          value: pay.amount,
          disabled: busy,
          onChange: (v) => {
            payRequest.current = null;
            setPay({ ...pay, amount: v });
          }
        }
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u6536\u6B3E\u65E5\u671F",
          type: "date",
          value: pay.date,
          disabled: busy,
          onChange: (v) => setPay({ ...pay, date: v })
        }
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u6536\u6B3E\u5907\u6CE8",
          value: pay.note,
          disabled: busy,
          onChange: (v) => setPay({ ...pay, note: v })
        }
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          primary: true,
          disabled: busy,
          onClick: () => {
            if (!__sv2_PRICE.test(pay.amount) || __sv2_micro(pay.amount) <= 0n) {
              setError("\u8BF7\u8F93\u5165\u6709\u6548\u7684\u6B63\u6570\u6536\u6B3E\u91D1\u989D\uFF0C\u6700\u591A4\u4F4D\u5C0F\u6570\u3002");
              return;
            }
            payRequest.current ??= {
              id: order.id,
              version: order.version,
              requestId: __sv2_id(),
              method: pay.method,
              amount: pay.amount,
              paymentDate: pay.date,
              note: pay.note
            };
            action("payment", payRequest.current);
          }
        },
        "\u786E\u8BA4\u6536\u6B3E"
      )) : null), /* @__PURE__ */ __sv2_h("section", { className: "aui-data-panel __sv2_card" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_heading" }, /* @__PURE__ */ __sv2_h("strong", null, "\u51FA\u8D27"), !isNew && !readonly && order?.shippedQty < order?.orderedQty ? /* @__PURE__ */ __sv2_h(
        "button",
        {
          type: "button",
          className: "__sv2_link",
          disabled: busy,
          onClick: () => setShipOpen(!shipOpen)
        },
        "\u767B\u8BB0\u51FA\u8D27 \u203A"
      ) : null), /* @__PURE__ */ __sv2_h("small", null, order?.shippedQty > 0 ? "\u5DF2\u51FA " + order.shippedQty : "\u672A\u51FA\u8D27", " ", "/ ", totals.qty), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_bar" }, /* @__PURE__ */ __sv2_h(
        "i",
        {
          style: {
            width: totals.qty ? Math.min(
              100,
              (order?.shippedQty ?? 0) / totals.qty * 100
            ) + "%" : "0%",
            background: "#059669"
          }
        }
      )), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_three" }, /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u8BA2\u8D2D"), /* @__PURE__ */ __sv2_h("b", null, totals.qty)), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u5DF2\u51FA"), /* @__PURE__ */ __sv2_h("b", null, order?.shippedQty ?? 0)), /* @__PURE__ */ __sv2_h("div", null, /* @__PURE__ */ __sv2_h("span", null, "\u5F85\u51FA"), /* @__PURE__ */ __sv2_h("b", null, Math.max(0, totals.qty - (order?.shippedQty ?? 0))))), /* @__PURE__ */ __sv2_h("div", { className: "__sv2_records" }, order?.shipments?.map((s) => /* @__PURE__ */ __sv2_h("p", { key: s.id }, __sv2_date(s.createdAt), " ", s.deliveryMethod === "pickup" ? "\u81EA\u63D0" : s.expressCo + " " + s.expressNo, " ", "\xB7", " ", s.items.map((x) => x.partNumber + "\xD7" + x.qty).join("\uFF0C")))), shipOpen && !readonly && order ? /* @__PURE__ */ __sv2_h("div", { className: "__sv2_inline" }, order.companyStockAllocated || order.sourceType === "company_stock" ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h(
        "select",
        {
          className: "crm-input",
          "aria-label": "\u51FA\u8D27\u65B9\u5F0F",
          value: ship.method,
          disabled: busy,
          onChange: (e) => setShip({ ...ship, method: e.target.value })
        },
        /* @__PURE__ */ __sv2_h("option", { value: "pickup" }, "\u81EA\u63D0"),
        /* @__PURE__ */ __sv2_h("option", { value: "express" }, "\u5FEB\u9012")
      ), ship.method === "express" ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u5FEB\u9012\u516C\u53F8",
          value: ship.company,
          onChange: (v) => setShip({ ...ship, company: v })
        }
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u5FEB\u9012\u5355\u53F7",
          value: ship.number,
          onChange: (v) => setShip({ ...ship, number: v })
        }
      )) : null, order.companyStockAllocations.filter((x) => x.reservedQty > 0).map((x) => /* @__PURE__ */ __sv2_h("label", { key: x.id }, order.items.find(
        (i) => i.id === x.orderItemId
      )?.partNumber, " ", "\xB7 \u6279\u6B21 #", x.lotId, " \xB7 \u5F85\u51FA ", x.reservedQty, /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u6279\u6B21" + x.lotId + "\u51FA\u8D27\u6570\u91CF",
          value: ship.qty[x.id] ?? "",
          disabled: busy,
          onChange: (v) => {
            shipRequest.current = null;
            setShip({
              ...ship,
              qty: { ...ship.qty, [x.id]: v }
            });
          }
        }
      ))), /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          primary: true,
          disabled: busy,
          onClick: () => {
            const allocations = order.companyStockAllocations.filter(
              (x) => Number(ship.qty[x.id]) > 0
            );
            if (!allocations.length || allocations.some(
              (x) => !/^[1-9]\d*$/.test(ship.qty[x.id]) || Number(ship.qty[x.id]) > x.reservedQty
            )) {
              setError(
                "\u8BF7\u9009\u62E9\u51FA\u8D27\u6570\u91CF\uFF0C\u987B\u4E3A\u6B63\u6574\u6570\u4E14\u4E0D\u8D85\u8FC7\u6279\u6B21\u5F85\u51FA\u6570\u91CF\u3002"
              );
              return;
            }
            if (ship.method === "express" && (!ship.company.trim() || !ship.number.trim())) {
              setError("\u8BF7\u586B\u5199\u5FEB\u9012\u516C\u53F8\u548C\u5FEB\u9012\u5355\u53F7\u3002");
              return;
            }
            shipRequest.current ??= {
              id: order.id,
              version: order.version,
              requestId: __sv2_id(),
              deliveryMethod: ship.method,
              expressCo: ship.company,
              expressNo: ship.number,
              note: "",
              items: allocations.map((x) => ({
                orderItemId: x.orderItemId,
                lotId: x.lotId,
                qty: Number(ship.qty[x.id])
              }))
            };
            action("shipment", shipRequest.current);
          }
        },
        "\u786E\u8BA4\u51FA\u8D27"
      )) : /* @__PURE__ */ __sv2_h("p", { className: "__sv2_muted" }, "\u9700\u6C42\u8BA2\u5355\u5C1A\u672A\u5206\u914D\u516C\u53F8\u5E93\u5B58\uFF0C\u8BF7\u6CBF\u7528\u539F\u5BA2\u6237\u9700\u6C42\u7684\u91C7\u8D2D/\u4EA4\u4ED8\u6D41\u7A0B\u3002\u5F53\u524D\u4E0D\u4F2A\u9020\u6279\u6B21\u6216\u5E93\u5B58\u3002")) : null)))),
      /* @__PURE__ */ __sv2_h("div", { className: "__sv2_footer" }, /* @__PURE__ */ __sv2_h("div", { className: "__sv2_footnote" }, error ? /* @__PURE__ */ __sv2_h("div", { role: "alert", className: "__sv2_red" }, error) : readonly ? "\u8BA2\u5355" + __sv2_status(order) + "\uFF0C\u4EC5\u53EF\u67E5\u770B" : errors.length ? errors[0] : diffs.length ? "\u5DF2\u4FEE\u6539 " + diffs.length + " \u9879" : ""), order && !readonly ? /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          danger: true,
          disabled: locked || __sv2_paid(order) > 0n || order.shippedQty > 0,
          title: __sv2_paid(order) > 0n || order.shippedQty > 0 ? "\u5DF2\u6709\u6536\u6B3E\u6216\u51FA\u8D27\uFF0C\u4E0D\u80FD\u53D6\u6D88\u8BA2\u5355" : "",
          onClick: () => setCancelOpen(true)
        },
        "\u53D6\u6D88\u8BA2\u5355"
      ) : null, /* @__PURE__ */ __sv2_h(__sv2_Button, { disabled: busy || !!pending, onClick: close }, "\u5173\u95ED"), !readonly ? /* @__PURE__ */ __sv2_h(__sv2_Fragment, null, /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          disabled: busy || !!pending || isNew,
          onClick: async () => {
            if (diffs.length && !globalThis.confirm("\u91CD\u65B0\u8BFB\u53D6\u5C06\u66FF\u6362\u672A\u4FDD\u5B58\u5185\u5BB9\uFF0C\u786E\u8BA4\u7EE7\u7EED\uFF1F"))
              return;
            try {
              await refresh();
              setError("\u5DF2\u8BFB\u53D6\u6700\u65B0\u8BA2\u5355\u3002");
            } catch (err) {
              setError(__sv2_error(err));
            }
          }
        },
        "\u91CD\u65B0\u8BFB\u53D6"
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          primary: true,
          disabled: busy || !enabled || !pending && !isNew && !diffs.length,
          onClick: () => {
            if (pending) {
              submit();
              return;
            }
            if (errors.length) {
              setError(errors.join("\uFF1B"));
              return;
            }
            if (isNew) submit();
            else {
              setReason("");
              setReview(true);
            }
          }
        },
        busy ? "\u4FDD\u5B58\u4E2D\u2026" : pending ? "\u91CD\u8BD5\u539F\u8BF7\u6C42" : isNew ? "\u4FDD\u5B58\u8BA2\u5355" : "\u4FDD\u5B58\u4FEE\u6539"
      )) : null),
      review ? /* @__PURE__ */ __sv2_h(
        __sv2_Dialog,
        {
          open: true,
          onOpenChange: (v) => {
            if (!v && !busy) setReview(false);
          }
        },
        /* @__PURE__ */ __sv2_h(
          __sv2_Content,
          {
            className: "__sv2_scope __sv2_review",
            "aria-describedby": "__sv2_review_desc"
          },
          /* @__PURE__ */ __sv2_h(__sv2_Header, null, /* @__PURE__ */ __sv2_h(__sv2_Title, null, "\u786E\u8BA4\u4FEE\u6539\u4E1A\u52A1\u8BA2\u5355")),
          /* @__PURE__ */ __sv2_h("p", { id: "__sv2_review_desc", className: "__sv2_muted" }, order.orderNumber, " \xB7 ", order.customerName),
          /* @__PURE__ */ __sv2_h("div", { className: "__sv2_tw" }, /* @__PURE__ */ __sv2_h("table", { className: "__sv2_table" }, /* @__PURE__ */ __sv2_h("thead", null, /* @__PURE__ */ __sv2_h("tr", null, /* @__PURE__ */ __sv2_h("th", null, "\u9879\u76EE"), /* @__PURE__ */ __sv2_h("th", null, "\u539F\u503C"), /* @__PURE__ */ __sv2_h("th", null, "\u65B0\u503C"))), /* @__PURE__ */ __sv2_h("tbody", null, diffs.map((d, k) => /* @__PURE__ */ __sv2_h("tr", { key: k }, /* @__PURE__ */ __sv2_h("td", null, d[0]), /* @__PURE__ */ __sv2_h("td", { className: "__sv2_old" }, d[1]), /* @__PURE__ */ __sv2_h("td", null, /* @__PURE__ */ __sv2_h("b", null, d[2]))))))),
          /* @__PURE__ */ __sv2_h("div", { className: "__sv2_impact" }, /* @__PURE__ */ __sv2_h("p", null, "\u8BA2\u5355\u91D1\u989D ", __sv2_money(order.totalAmount), " \u2192", " ", __sv2_money(totals.sales), "\uFF1B\u5F85\u6536", " ", __sv2_money(__sv2_due(order)), " \u2192", " ", __sv2_money(totals.sales - (order ? __sv2_paid(order) : 0n))), __sv2_known(order) ? /* @__PURE__ */ __sv2_h("p", null, "\u51C0\u5229\u6DA6 ", __sv2_money(order.profitBreakdown.netProfit), " \u2192", " ", finance ? __sv2_money(finance.net) : "\u7531\u670D\u52A1\u5668\u4FDD\u5B58\u540E\u6838\u7B97", "\uFF1B\u63D0\u6210", " ", __sv2_money(
            order.commissionPreview?.estimatedAmount
          ), " \u2192 ", finance ? __sv2_money(finance.com) : "\u7531\u670D\u52A1\u5668\u6838\u7B97", "\uFF08\u9884\u4F30\uFF09") : null, form.lines.map((l) => {
            const delta = Number(l.qty) - l.orderedQty;
            return delta && order.companyStockAllocated ? /* @__PURE__ */ __sv2_h("p", { key: l.orderItemId }, l.partNumber, "\uFF1A", delta > 0 ? "\u8FFD\u52A0" : "\u91CA\u653E", "\u9884\u7559", " ", Math.abs(delta), " \u4EF6\uFF1B\u5DF2\u51FA\u8D27\u4E0D\u53D8\u3002") : null;
          })),
          /* @__PURE__ */ __sv2_h("label", null, "\u4FEE\u6539\u539F\u56E0 ", /* @__PURE__ */ __sv2_h("span", { className: "__sv2_red" }, "*"), /* @__PURE__ */ __sv2_h(
            __sv2_Input,
            {
              label: "\u4FEE\u6539\u539F\u56E0",
              value: reason,
              maxLength: 200,
              disabled: busy,
              onChange: setReason,
              placeholder: "\u5982\uFF1A\u5BA2\u6237\u8C03\u6574\u6570\u91CF\u3001\u5355\u4EF7\u6216\u8D39\u7528"
            }
          )),
          error ? /* @__PURE__ */ __sv2_h("p", { role: "alert", className: "__sv2_red" }, error) : null,
          /* @__PURE__ */ __sv2_h("div", { className: "__sv2_reviewfoot" }, /* @__PURE__ */ __sv2_h(__sv2_Button, { disabled: busy, onClick: () => setReview(false) }, "\u8FD4\u56DE\u4FEE\u6539"), /* @__PURE__ */ __sv2_h(
            __sv2_Button,
            {
              primary: true,
              disabled: busy || !reason.trim() || errors.length > 0,
              onClick: submit
            },
            busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u786E\u8BA4\u4FDD\u5B58"
          ))
        )
      ) : null,
      cancelOpen ? /* @__PURE__ */ __sv2_h(__sv2_Dialog, { open: true, onOpenChange: setCancelOpen }, /* @__PURE__ */ __sv2_h(__sv2_Content, { className: "__sv2_scope __sv2_review" }, /* @__PURE__ */ __sv2_h(__sv2_Header, null, /* @__PURE__ */ __sv2_h(__sv2_Title, null, "\u786E\u8BA4\u53D6\u6D88\u9500\u552E\u8BA2\u5355\uFF1F")), /* @__PURE__ */ __sv2_h("p", null, "\u53D6\u6D88\u540E\u91CA\u653E\u5E93\u5B58\u9884\u7559\u4E14\u8BA2\u5355\u53EA\u8BFB\u3002\u5DF2\u6709\u6536\u6B3E\u6216\u51FA\u8D27\u4E0D\u5F97\u53D6\u6D88\u3002"), /* @__PURE__ */ __sv2_h(
        __sv2_Input,
        {
          label: "\u53D6\u6D88\u539F\u56E0",
          value: cancelReason,
          maxLength: 500,
          onChange: setCancelReason
        }
      ), /* @__PURE__ */ __sv2_h(
        __sv2_Button,
        {
          danger: true,
          disabled: busy || !cancelReason.trim(),
          onClick: () => action("cancel", {
            id: order.id,
            version: order.version,
            reason: cancelReason.trim()
          })
        },
        "\u786E\u8BA4\u53D6\u6D88\u8BA2\u5355"
      ))) : null,
      history ? /* @__PURE__ */ __sv2_h(
        "div",
        {
          className: "__sv2_sheet",
          role: "dialog",
          "aria-label": "\u4FEE\u6539\u8BB0\u5F55\u65F6\u95F4\u7EBF"
        },
        /* @__PURE__ */ __sv2_h("header", null, /* @__PURE__ */ __sv2_h("strong", null, "\u4FEE\u6539\u8BB0\u5F55 \xB7 ", order.orderNumber), /* @__PURE__ */ __sv2_h(
          "button",
          {
            type: "button",
            "aria-label": "\u5173\u95ED\u4FEE\u6539\u8BB0\u5F55",
            className: "__sv2_x",
            onClick: () => setHistory(false)
          },
          "\xD7"
        )),
        /* @__PURE__ */ __sv2_h("div", null, (order.audits ?? []).map((x) => /* @__PURE__ */ __sv2_h("article", { key: x.id }, /* @__PURE__ */ __sv2_h("small", null, String(x.createdAt).replace("T", " ").slice(0, 19)), /* @__PURE__ */ __sv2_h("strong", null, x.actorName, " \xB7", " ", {
          created: "\u521B\u5EFA\u8BA2\u5355",
          revised: "\u4FEE\u6539\u8BA2\u5355",
          payment: "\u767B\u8BB0\u6536\u6B3E",
          shipment: "\u767B\u8BB0\u51FA\u8D27",
          cancelled: "\u53D6\u6D88\u8BA2\u5355",
          expenses: "\u9500\u552E\u8D39\u7528"
        }[x.action] ?? x.action), /* @__PURE__ */ __sv2_h("p", null, x.note))))
      ) : null
    )
  );
}
const __sv2_css = `
.__sv2_scope{font-size:13px;color:#334155;min-width:0}.__sv2_scope *{box-sizing:border-box}.__sv2_scope .crm-input{border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:0 8px;height:32px;min-width:0;font-size:13px;color:#0f172a}.__sv2_scope .crm-input:disabled{background:#f8fafc;color:#64748b}.__sv2_scope button:disabled{opacity:.45;cursor:not-allowed}.__sv2_scope .__sv2_btn{height:32px;padding:0 12px;font-size:13px;background:#fff;white-space:nowrap;border-radius:6px}.__sv2_scope .__sv2_primary{background:#185fa5;color:white;border-color:#185fa5}.__sv2_scope .__sv2_danger{color:#dc2626;border-color:#fecaca;background:white}.__sv2_scope .__sv2_link{background:none;border:0;color:#185fa5;cursor:pointer;font-size:12px;padding:2px 0}.__sv2_scope .__sv2_x{font-size:22px;color:#64748b;background:none;border:0;padding:0 6px;cursor:pointer}.__sv2_scope small{font-size:12px;color:#64748b}.__sv2_scope .__sv2_muted{color:#94a3b8}.__sv2_scope .__sv2_red{color:#dc2626}.__sv2_scope .__sv2_green{color:#059669}.__sv2_scope .__sv2_amber{color:#b45309}.__sv2_scope .__sv2_blue{color:#185fa5}.__sv2_scope .__sv2_n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.__sv2_scope .__sv2_alert{padding:12px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:6px}.__sv2_scope .__sv2_toolbar{display:flex;gap:8px;padding:8px;margin-bottom:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.__sv2_toolbar>input{width:360px}.__sv2_toolbar>button:last-child{margin-left:auto}.__sv2_scope .__sv2_summary{display:flex;gap:24px;padding:12px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;align-items:center}.__sv2_summary>div{display:flex;align-items:baseline;gap:12px}.__sv2_summary b{font-size:19px;color:#185fa5;font-variant-numeric:tabular-nums}.__sv2_summary>small{margin-left:auto}.__sv2_scope .__sv2_tabs{display:flex;gap:4px;border-bottom:1px solid #e2e8f0;margin-bottom:8px;align-items:center}.__sv2_tabs button{border:0;background:none;color:#64748b;padding:10px 20px;cursor:pointer;border-bottom:2px solid transparent}.__sv2_tabs button.on{border-color:#185fa5;color:#185fa5;font-weight:600}.__sv2_tabs small{margin-left:auto}.__sv2_scope .__sv2_listwrap{overflow:auto;border:1px solid #e2e8f0;border-radius:7px;background:white}.__sv2_scope .__sv2_list{width:100%;min-width:1120px;border-collapse:collapse}.__sv2_list th{font-size:12px;text-align:left;background:#f8fafc;color:#475569;font-weight:500;height:34px;padding:8px}.__sv2_list td{padding:10px 8px;border-top:1px solid #e2e8f0;vertical-align:middle;font-size:13px}.__sv2_list td:first-child{min-width:150px}.__sv2_list td:nth-child(2){max-width:180px}.__sv2_list td:nth-child(3){max-width:190px}.__sv2_list td>small{display:block;margin-top:3px}.__sv2_scope .__sv2_order{color:#185fa5;font-weight:600;text-align:left;border:0;background:none;cursor:pointer}.__sv2_scope .__sv2_actions{white-space:nowrap;text-align:right}.__sv2_actions button{background:none;border:0;border-right:1px solid #e2e8f0;color:#185fa5;padding:0 6px;cursor:pointer}.__sv2_actions button:last-child{border:0}.__sv2_scope .__sv2_empty{text-align:center;padding:40px;color:#94a3b8}.__sv2_scope .__sv2_pagination{display:flex;justify-content:space-between;align-items:center;margin:12px 0 32px;color:#94a3b8}.__sv2_pagination>div{display:flex;align-items:center;gap:12px}.__sv2_scope.__sv2_dialog{width:calc(100vw - 32px)!important;max-width:1100px!important;height:auto;max-height:90vh!important;display:flex!important;flex-direction:column;gap:0;padding:0!important;overflow:hidden!important;border-radius:8px;background:white}.__sv2_dialoghead{display:flex;justify-content:space-between;align-items:center;padding:16px 16px 0;gap:12px}.__sv2_dialoghead h2{font-size:16px;font-weight:600;color:#0f172a}.__sv2_dialoghead>div:last-child{display:flex;gap:8px;align-items:center}.__sv2_body{overflow-y:auto;min-height:0;flex:1;padding:12px 16px 10px}.__sv2_grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:12px;align-items:start}.__sv2_left{min-width:0}.__sv2_side{position:sticky;top:0;display:flex;flex-direction:column;gap:8px}.__sv2_scope .__sv2_card{padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:white;min-width:0;margin-bottom:0}.__sv2_left>.crm-order-section,.__sv2_left>.__sv2_card{margin-bottom:14px}.__sv2_heading{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}.__sv2_heading strong{font-weight:600;color:#0f172a}.__sv2_meta{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 16px;align-items:center}.__sv2_meta>div,.__sv2_meta>label{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-height:30px}.__sv2_meta span{color:#64748b;white-space:nowrap}.__sv2_meta input{width:155px}.__sv2_tax{display:flex;gap:5px;align-items:center;font-size:12px;color:#64748b}.__sv2_tax select{width:65px}.__sv2_tax input{width:44px;text-align:right}.__sv2_scope .__sv2_tw{border:1px solid #e2e8f0;border-radius:7px;overflow:auto;background:white}.__sv2_table{width:100%;border-collapse:collapse;font-size:13px}.__sv2_table th{text-align:left;padding:7px 8px;background:#f8fafc;font-size:12px;color:#475569;font-weight:500;white-space:nowrap;border-bottom:1px solid #e2e8f0}.__sv2_table td{vertical-align:top;padding:8px;border-top:1px solid #f1f5f9}.__sv2_items th:nth-child(1){width:35%}.__sv2_items th:nth-child(4),.__sv2_items th:nth-child(5){width:90px}.__sv2_items th:nth-child(7){width:42px}.__sv2_items td>small,.__sv2_items td:first-child>small{display:block;margin-top:4px;white-space:normal}.__sv2_items input{width:100%;min-width:68px;text-align:right}.__sv2_items td:first-child{min-width:180px}.__sv2_items td:first-child strong{overflow-wrap:anywhere;font-weight:600;color:#0f172a}.__sv2_allocation{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:4px}.__sv2_allocation input{max-width:70px;min-width:0;height:25px!important}.__sv2_total{display:flex;gap:16px;justify-content:flex-end;padding:8px 10px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}.__sv2_total b{color:#0f172a}.__sv2_exp th:nth-child(1){width:26%}.__sv2_exp th:nth-child(2){width:19%}.__sv2_exp th:nth-child(4){width:44px}.__sv2_exp input{width:100%}.__sv2_exp td:nth-child(2) input{text-align:right}.__sv2_scope .__sv2_invalid{border-color:#dc2626;box-shadow:0 0 0 2px #fee2e2}.__sv2_lotbar{display:flex;gap:8px;margin-bottom:8px}.__sv2_lotbar input{flex:1;width:0}.__sv2_picker{padding:8px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;margin-bottom:8px;max-height:330px;overflow:auto}.__sv2_lot{display:flex;flex-wrap:wrap;gap:8px;width:100%;text-align:left;border:0;border-bottom:1px solid #e2e8f0;background:white;padding:9px;cursor:pointer}.__sv2_lot:hover{background:#f1f5f9}.__sv2_lot span{font-size:12px;color:#64748b}.__sv2_lot b{margin-left:auto;white-space:nowrap}.__sv2_kv{display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-variant-numeric:tabular-nums}.__sv2_kv b{color:#0f172a;font-weight:500}.__sv2_sub{display:block;text-align:right;font-size:11px!important;color:#94a3b8!important;margin-bottom:4px}.__sv2_net{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:6px;font-weight:600}.__sv2_net b{font-size:20px;color:#185fa5}.__sv2_com{display:flex;justify-content:space-between;padding:6px 8px;margin:6px 0;background:#f1f6fc;border-radius:6px}.__sv2_tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:6px 0}.__sv2_tiers div{padding:3px;border:1px solid #eef2f6;background:#f8fafc;border-radius:5px;text-align:center;font-size:11px;color:#94a3b8}.__sv2_tiers div.on{background:#e8f0fe;border-color:#c9dbf3;color:#185fa5;font-weight:600}.__sv2_three{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #eef2f6;border-radius:6px;overflow:hidden;margin-top:6px}.__sv2_three div{text-align:center;padding:6px 2px;border-left:1px solid #eef2f6}.__sv2_three div:first-child{border:0}.__sv2_three span{display:block;color:#94a3b8;font-size:11px}.__sv2_three b{font-size:13px;font-variant-numeric:tabular-nums}.__sv2_bar{height:3px;background:#eef2f6;border-radius:2px;margin-top:6px;overflow:hidden}.__sv2_bar i{display:block;height:100%;background:#185fa5;max-width:100%}.__sv2_records{font-size:12px;line-height:18px;color:#64748b;margin-top:6px;overflow-wrap:anywhere}.__sv2_records p{margin:0 0 4px}.__sv2_inline{display:grid;gap:6px;margin-top:8px;border-top:1px dashed #e2e8f0;padding-top:8px}.__sv2_inline input{width:100%}.__sv2_note{margin-top:8px}.__sv2_note summary{cursor:pointer;color:#334155}.__sv2_note textarea{width:100%;height:84px!important;padding:8px!important;margin-top:6px}.__sv2_confirmed{display:flex;align-items:center;gap:6px;margin-top:8px}.__sv2_segment{display:flex;gap:4px}.__sv2_segment button{height:28px;padding:0 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;font-size:12px;cursor:pointer}.__sv2_segment button.on{background:#185fa5;color:#fff;border-color:#185fa5}.__sv2_footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #f1f5f9;background:#fff;flex-shrink:0}.__sv2_footnote{margin-right:auto;font-size:12px;color:#64748b;max-width:480px;overflow-wrap:anywhere}.__sv2_scope.__sv2_review{width:560px;max-width:calc(100vw - 32px);max-height:90vh;overflow:auto;padding:16px;gap:12px}.__sv2_review input{width:100%;margin-top:4px}.__sv2_reviewfoot{display:flex;justify-content:flex-end;gap:8px}.__sv2_review .__sv2_table th:first-child{width:28%}.__sv2_review .__sv2_table td{overflow-wrap:anywhere}.__sv2_old{color:#94a3b8;text-decoration:line-through}.__sv2_impact{border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:8px 10px;color:#92400e;font-size:12px;line-height:20px}.__sv2_impact p{margin:0}.__sv2_sheet{position:fixed;top:0;right:0;bottom:0;width:380px;max-width:90vw;z-index:80;background:white;box-shadow:-10px 0 30px #0f172a26;display:flex;flex-direction:column}.__sv2_sheet header{padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center}.__sv2_sheet>div{overflow:auto;padding:14px 16px}.__sv2_sheet article{position:relative;border-left:2px solid #e2e8f0;margin-left:4px;padding:0 0 14px 16px}.__sv2_sheet article:before{content:'';position:absolute;top:4px;left:-6px;width:10px;height:10px;border-radius:50%;background:#185fa5;border:2px solid white}.__sv2_sheet article small,.__sv2_sheet article strong{display:block}.__sv2_sheet article p{background:#f8fafc;padding:6px 8px;font-size:12px;line-height:19px;margin-top:4px;border-radius:6px}.__sv2_demand{display:block;width:100%;text-align:left;background:#fff;border:1px solid #e2e8f0;padding:8px;border-radius:5px;margin-top:6px;color:#185fa5;cursor:pointer}
@media(max-width:850px){.__sv2_grid{grid-template-columns:minmax(0,1fr)}.__sv2_side{position:static}.__sv2_summary{flex-wrap:wrap;gap:10px!important}.__sv2_summary>small{margin-left:0!important}.__sv2_tabs button{padding:10px}. __sv2_meta{grid-template-columns:1fr}.__sv2_footer{flex-wrap:wrap}.__sv2_footnote{max-width:100%;width:100%}.__sv2_toolbar>input{width:180px}. __sv2_tabs small{display:none}}
`.replace(/\. __sv2_/g, ".__sv2_");
