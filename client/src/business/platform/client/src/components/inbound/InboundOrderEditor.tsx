import * as React from "react";
import { trpc as typedTrpc } from "../../../../../api/business-trpc";
import { toast } from "sonner";
import {
  INBOUND_BULK_MAX_ROWS,
  validInboundDate,
} from "../../../../shared/inboundBulk";
import { MAX_INBOUND_QTY } from "../../../../shared/inboundPayment";
import { selectedProcurementBuyer } from "./procurementBuyerSelection";
import { stableInboundDocuments } from "./inboundDocumentDraft";
import { InboundDocuments } from "./InboundDocuments";
import {
  currentYear,
  emptyForm,
  newRequestId,
  todayLocal,
  uppercasePartNumber,
} from "../../lib/inboundOrderEditorModel";
import {
  __i2_scaled,
  __i2_round,
  __i2_decimal,
  __i2_fmt,
  __i2_money,
  __i2_error,
  __i2_feeRows,
  __i2_feeJson,
  __i2_figures,
  __i2_historyDiff,
} from "../../lib/inboundOrderMoney";
import "./InboundOrderEditor.css";
// 与原页面相同：线上扩展接口尚未完整同步到前端 AppRouter 声明。
const trpc = typedTrpc as any;
function __i2_Part(props: any) {
  const [keyword, setKeyword] = React.useState<any>("");
  const [open, setOpen] = React.useState<any>(false);
  const [active, setActive] = React.useState<any>(-1);
  React.useEffect(() => {
    setKeyword("");
    setActive(-1);
    const timer = setTimeout(() => setKeyword(props.value.trim()), 220);
    return () => clearTimeout(timer);
  }, [props.value]);
  const q = trpc.inbound.suggestPartNumbers.useQuery(
    { keyword, limit: 8 },
    {
      enabled: props.enabled && !props.disabled && keyword.length >= 2,
      staleTime: 60000,
      retry: false,
    },
  );
  const options = keyword === props.value.trim() ? q.data || [] : [];
  const choose = (item: any) => {
    props.onSelect(item);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="i2-part">
      <input
        className="crm-input i2-input"
        aria-label={props.label}
        placeholder="输入2个字符自动联想"
        value={props.value}
        disabled={props.disabled}
        maxLength={128}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-autocomplete="list"
        onChange={(ev: any) => {
          props.onChange(uppercasePartNumber(ev.target.value));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(ev: any) => {
          if (ev.key === "Escape") setOpen(false);
          else if (
            options.length &&
            (ev.key === "ArrowDown" || ev.key === "ArrowUp")
          ) {
            ev.preventDefault();
            setOpen(true);
            setActive(
              (k: any) =>
                (k + (ev.key === "ArrowDown" ? 1 : -1) + options.length) %
                options.length,
            );
          } else if (ev.key === "Enter" && open && active >= 0) {
            ev.preventDefault();
            choose(options[active]);
          }
        }}
      />
      {open && !props.disabled && options.length > 0 && (
        <div className="i2-suggestions" role="listbox">
          {options.map((item: any, index: any) => (
            <button
              key={item.partNumber + "-" + index}
              type="button"
              role="option"
              aria-selected={active === index}
              className={active === index ? "active" : ""}
              onMouseDown={(ev: any) => ev.preventDefault()}
              onClick={() => choose(item)}
            >
              <strong>{item.partNumber}</strong>
              <small>
                {item.brand || ""} {item.package || ""}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function InboundOrderEditor(props: any) {
  const { form, setForm, row, draft, buyerScope, buyerError } = props;
  const editing = !!row,
    received = row?.status === "received",
    cancelled = row?.status === "cancelled";
  const visibleMoney =
    !editing ||
    Object.prototype.hasOwnProperty.call(row, "unitCostTaxIncluded") ||
    Object.prototype.hasOwnProperty.call(row, "costTotal");
  const api = trpc.inbound,
    utils = trpc.useUtils();
  const costQuery = api.costs.useQuery(
    { id: row?.id || 0 },
    {
      enabled: editing && visibleMoney && props.enabled,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const histQuery = api.history.useQuery(
    { id: row?.id || 0 },
    {
      enabled: editing && props.enabled,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const create = api.create.useMutation({ retry: false });
  const bulk = api.bulkCreate.useMutation({ retry: false });
  const revise = api.revise.useMutation({ retry: false });
  const details = api.updateDetails.useMutation({ retry: false });
  const update = api.update.useMutation({ retry: false });
  const saveDocs = api.saveDocuments.useMutation({ retry: false });
  const [additional, setAdditional] = React.useState<any>([]);
  const [fees, setFees] = React.useState<any>(
    editing
      ? null
      : [{ title: "运费", payee: "supplier", amount: "", note: "" }],
  );
  const [originalFees, setOriginalFees] = React.useState<any>([]);
  const [more, setMore] = React.useState<any>({});
  const [expanded, setExpanded] = React.useState<any>(false);
  const [historyOpen, setHistoryOpen] = React.useState<any>(false);
  const [importOpen, setImportOpen] = React.useState<any>(false);
  const [confirmOpen, setConfirmOpen] = React.useState<any>(false);
  const [reason, setReason] = React.useState<any>("");
  const [error, setError] = React.useState<any>("");
  const [busy, setBusy] = React.useState<any>(false);
  const [uncertain, setUncertain] = React.useState<any>(null);
  const [partial, setPartial] = React.useState<any>(false);
  const revisionRequest = React.useRef<any>(null);
  const enriched = React.useRef<any>(new Set());
  const original = React.useRef<any>({
    ...form,
    qty: received ? String(row.actualQty ?? row.qty) : form.qty,
  });
  const originalDoc = React.useRef<any>(
    JSON.stringify(stableInboundDocuments(draft.documents)),
  );
  const live = React.useRef<any>(props);
  live.current = props;
  React.useEffect(() => {
    if (received && form.qty !== original.current.qty)
      setForm((f: any) => ({ ...f, qty: original.current.qty }));
  }, []);
  React.useEffect(() => {
    if (costQuery.data && fees === null) {
      const loaded = __i2_feeRows(costQuery.data.costs);
      setFees(loaded);
      setOriginalFees(loaded);
    }
  }, [costQuery.data, fees]);
  const feeList = fees || [];
  const usedFees = feeList.filter(
    (f: any) => f.amount.trim() !== "" || f.note.trim() !== "",
  );
  const items = [form, ...additional];
  const figures = __i2_figures(
    items,
    form.unitCostBasis,
    form.taxRate || "0",
    usedFees,
  );
  const oldQty = received
    ? String(row.actualQty ?? row.qty)
    : String(row?.qty ?? form.qty);
  const oldGoods =
    row?.unitCostTaxIncluded == null
      ? null
      : __i2_round(
          (__i2_scaled(row.unitCostTaxIncluded)! || 0n) * BigInt(oldQty || "0"),
          10000n,
        );
  const oldFeeTotal = originalFees.reduce(
    (sum: any, f: any) => sum + (__i2_scaled(f.amount, 2)! || 0n),
    0n,
  );
  const oldTotal =
    costQuery.data?.order?.costTotal != null
      ? __i2_scaled(costQuery.data.order.costTotal, 2)!
      : row?.costTotal != null
        ? __i2_scaled(row.costTotal, 2)!
        : oldGoods == null
          ? null
          : oldGoods + oldFeeTotal;
  const oldUnit =
    row?.unitCostWithFees != null
      ? __i2_scaled(row.unitCostWithFees)!
      : oldGoods != null && BigInt(oldQty || "0")
        ? __i2_scaled(row.unitCostTaxIncluded)! +
          __i2_round(oldFeeTotal * 10000n, BigInt(oldQty))
        : null;
  const paymentMode = form.paymentMode;
  let paid = editing
    ? row.paidAmount == null
      ? null
      : __i2_scaled(row.paidAmount, 2)!
    : paymentMode === "paid"
      ? figures.goods
      : paymentMode === "partial"
        ? form.paymentPercent === "custom"
          ? __i2_scaled(form.paymentAmount, 2)!
          : __i2_round(figures.goods * BigInt(form.paymentPercent || "0"), 100n)
        : 0n;
  const due = paid == null ? null : figures.payable - paid;
  const payStatus =
    editing && !row.paymentTrackedAt && row.paymentCategory === "untracked"
      ? "未登记"
      : paid == null
        ? "—"
        : due! < 0n
          ? "超付待处理"
          : due === 0n && figures.payable > 0n
            ? "已付全款"
            : paid > 0n
              ? "部分付款"
              : "未付款";
  const stockOut = row?.shippedQty ?? row?.outboundQty ?? row?.totalQtyOut;
  const stockReserved = row?.reservedQty;
  const stockNow = row?.remainingQty ?? row?.currentQty;
  const qtyChanged = editing && form.qty !== original.current.qty;
  const priceChanged =
    editing &&
    String(__i2_scaled(form.unitCost)!) !==
      String(__i2_scaled(original.current.unitCost)!);
  const feeChanged =
    editing &&
    fees !== null &&
    __i2_feeJson(usedFees) !== __i2_feeJson(originalFees);
  const taxChanged =
    editing &&
    (form.unitCostBasis !== original.current.unitCostBasis ||
      form.taxRate !== original.current.taxRate);
  const reviseNeeded = qtyChanged || priceChanged || feeChanged || taxChanged;
  const detailKeys = [
    "supplierName",
    "supplierContact",
    "supplierPhone",
    "packageType",
    "lotNumber",
    "supplierOrderNo",
    "location",
    "note",
    "photos",
    "prodYear",
    "inboundDate",
    "partNumber",
    "brand",
  ];
  const detailsChanged =
    editing &&
    (detailKeys.some(
      (k: any) =>
        JSON.stringify(form[k]) !== JSON.stringify(original.current[k]),
    ) ||
      JSON.stringify(stableInboundDocuments(draft.documents)) !==
        originalDoc.current);
  const set = (key: any, value: any) => {
    if (uncertain || partial) return;
    setError("");
    revisionRequest.current = null;
    setForm((f: any) => ({ ...f, [key]: value }));
  };
  const setItem = (index: any, key: any, value: any) =>
    index === 0
      ? set(key, value)
      : (setError(""),
        setAdditional((rows: any) =>
          rows.map((it: any, k: any) =>
            k === index - 1 ? { ...it, [key]: value } : it,
          ),
        ));
  const setFee = (index: any, patch: any) => {
    setError("");
    revisionRequest.current = null;
    setFees((rows: any) =>
      rows.map((f: any, k: any) => (k === index ? { ...f, ...patch } : f)),
    );
  };
  const switchBasis = (value: any) => {
    if (value === form.unitCostBasis) return;
    const rate = __i2_scaled(form.taxRate, 1)!;
    if (rate == null) return fail("请先填写有效税率。");
    const convert = (item: any) => {
      const price = __i2_scaled(item.unitCost)!;
      return {
        ...item,
        unitCost:
          price == null
            ? item.unitCost
            : __i2_decimal(
                value === "CNY_TAX_EXCLUDED"
                  ? __i2_round(price * 1000n, 1000n + rate)
                  : __i2_round(price * (1000n + rate), 1000n),
                6,
              ),
      };
    };
    setForm((f: any) => ({ ...convert(f), unitCostBasis: value }));
    setAdditional((rows: any) => rows.map(convert));
    setError("");
    revisionRequest.current = null;
  };
  const fail = (message: any) => {
    setError(message);
    toast.error(message);
    return false;
  };
  const validate = () => {
    if (!live.current.enabled || !live.current.isCurrentScope())
      return fail("业务身份尚未核验，请稍后重试。");
    if (draft.isBlocked())
      return fail("请等待附件上传完成，并重试或删除失败附件。");
    if (!form.supplierName.trim()) return fail("请输入供应商名称。");
    if (!validInboundDate(form.inboundDate))
      return fail("请选择有效的入库或预计到货日期。");
    if (!editing && !selectedProcurementBuyer(buyerScope, form.buyerUserId)!)
      return fail(buyerError || "请选择当前可用范围内的采购员。");
    if (items.length > INBOUND_BULK_MAX_ROWS)
      return fail("单批最多 " + INBOUND_BULK_MAX_ROWS + " 行物料。");
    for (let i = 0; i < items.length; i++) {
      const it = items[i],
        tag = "第" + (i + 1) + "行物料：";
      if (!it.partNumber.trim()) return fail(tag + "请输入料号/型号。");
      if (
        !/^\d+$/.test(it.qty) ||
        BigInt(it.qty) < 1n ||
        BigInt(it.qty) > BigInt(MAX_INBOUND_QTY)
      )
        return fail(tag + "数量须为 1–999,999,999 的整数。");
      if (!it.prodYear.trim()) return fail(tag + "请输入年份/DC。");
      if (form.status === "received" && !it.location.trim()) {
        setMore((m: any) => ({ ...m, [i]: true }));
        return fail(tag + "直接入库时必须填写仓位（“更多”中）。");
      }
      if (
        it.unitCost.trim() &&
        (__i2_scaled(it.unitCost)! == null ||
          __i2_scaled(it.unitCost)! > 999999999000000n)
      )
        return fail(tag + "单价必须为非负数，最大999,999,999，最多6位小数。");
      if (editing && original.current.unitCost.trim() && !it.unitCost.trim())
        return fail(tag + "原单已有采购单价，不能留空。");
      if (
        usedFees.length &&
        (!it.unitCost.trim() || __i2_scaled(it.unitCost)! === 0n)
      )
        return fail(tag + "填写采购费用时所有物料单价必须大于0。");
      for (const [key, max, label] of [
        ["partNumber", 128, "料号"],
        ["brand", 64, "品牌"],
        ["prodYear", 16, "年份/DC"],
        ["packageType", 64, "封装"],
        ["lotNumber", 64, "批次"],
        ["location", 64, "仓位"],
      ])
        if (it[key].length > max)
          return fail(tag + label + "不能超过" + max + "个字符。");
    }
    if (feeList.length > 20) return fail("采购费用最多20行。");
    for (let i = 0; i < feeList.length; i++) {
      const f = feeList[i];
      if (!f.amount.trim() && !f.note.trim()) continue;
      if (
        !f.title.trim() ||
        f.title.length > 64 ||
        !/^\d{1,13}(\.\d{1,2})?$/.test(f.amount.trim()) ||
        f.note.length > 255
      )
        return fail(
          "第" +
            (i + 1) +
            "行费用：金额须为最多13位整数、2位小数的非负金额，备注最多255字。",
        );
    }
    if (
      items.some((it: any) => it.unitCost.trim()) &&
      (!/^\d+(\.\d)?$/.test(form.taxRate) ||
        __i2_scaled(form.taxRate, 1)! > 130n)
    )
      return fail("税率须为0%–13%，最多1位小数。");
    for (const [key, max, label] of [
      ["supplierName", 128, "供应商名称"],
      ["supplierContact", 64, "联系人"],
      ["supplierPhone", 32, "联系方式"],
      ["supplierOrderNo", 64, "供应商订单号"],
      ["note", 500, "备注"],
      ["paymentNote", 255, "付款备注"],
    ])
      if (form[key].length > max)
        return fail(label + "不能超过" + max + "字。");
    if (
      editing &&
      stockOut != null &&
      stockReserved != null &&
      BigInt(form.qty) < BigInt(stockOut) + BigInt(stockReserved)
    )
      return fail(
        "数量不能小于已出库 + 已预留（" +
          (BigInt(stockOut) + BigInt(stockReserved)) +
          "件）。",
      );
    if (received && taxChanged)
      return fail(
        "当前改单接口不支持税率或含税口径变更，请等待后端升级；数量、单价和费用可以修改。",
      );
    if (
      editing &&
      received &&
      (form.prodYear !== original.current.prodYear ||
        form.inboundDate !== original.current.inboundDate)
    )
      return fail("当前资料接口尚不支持已入库单日期/DC变更，请等待后端升级。");
    if (!editing && items.length > 1 && paymentMode !== "unpaid")
      return fail(
        "多物料批量接口暂不接收初始付款。请选择未付款，创建后逐单登记；单条录入仍支持初始付款。",
      );
    if (!editing && paymentMode !== "unpaid") {
      if (!figures.valid || paid == null || paid <= 0n || paid > figures.goods)
        return fail("已付款金额须大于0且不超过含税货款，供应商费用另计。");
      if (paymentMode === "partial" && paid === figures.goods)
        return fail("付款金额等于全款时请选择已付全款。");
      if (!form.paymentDate || form.paymentDate > todayLocal())
        return fail("请选择不晚于今天的付款日期。");
    }
    return true;
  };
  const costsPayload = usedFees.map((f: any) => ({
    title: f.title.trim(),
    payee: f.payee,
    amount:
      __i2_scaled(f.amount, 2)! == null
        ? f.amount.trim()
        : __i2_decimal(__i2_scaled(f.amount, 2)!),
    note: f.note.trim() || undefined,
  }));
  const photosPayload = form.photos.map(
    ({ key, name, mimeType, size }: any) => ({ key, name, mimeType, size }),
  );
  const makePayload = (): any => {
    const buyer = selectedProcurementBuyer(buyerScope, form.buyerUserId)!;
    const shared = {
      supplierName: form.supplierName.trim(),
      supplierContact: form.supplierContact.trim(),
      supplierPhone: form.supplierPhone.trim(),
      supplierOrderNo: form.supplierOrderNo.trim(),
      operator: editing ? row.operator || "" : buyer.name,
      ...(editing
        ? row.buyerUserId != null
          ? { buyerUserId: row.buyerUserId }
          : {}
        : { buyerUserId: buyer.userId }),
      note: form.note.trim(),
      photos: photosPayload,
      documents: stableInboundDocuments(draft.documents),
    };
    if (editing)
      return {
        ...shared,
        id: row.id,
        packageType: form.packageType.trim(),
        lotNumber: form.lotNumber.trim(),
        location: form.location.trim(),
      };
    if (items.length === 1)
      return {
        ...shared,
        status: form.status,
        partNumber: uppercasePartNumber(form.partNumber).trim(),
        brand: form.brand.trim() || undefined,
        qty: Number(form.qty),
        unitCost: form.unitCost.trim() ? Number(form.unitCost) : undefined,
        unitCostBasis: form.unitCost.trim() ? form.unitCostBasis : undefined,
        taxRate: form.unitCost.trim() ? Number(form.taxRate) : undefined,
        prodYear: form.prodYear.trim(),
        packageType: form.packageType.trim() || undefined,
        lotNumber: form.lotNumber.trim() || undefined,
        location: form.location.trim() || undefined,
        inboundDate: form.inboundDate,
        clientRequestId: props.requestId,
        costs: costsPayload.length ? costsPayload : undefined,
        payment: {
          mode: paymentMode,
          amount: paymentMode === "partial" ? __i2_decimal(paid!) : undefined,
          paymentDate: paymentMode === "unpaid" ? undefined : form.paymentDate,
          note: form.paymentNote.trim() || undefined,
        },
      };
    return {
      status: form.status,
      inboundDate: form.inboundDate,
      unitCostBasis: form.unitCostBasis,
      taxRate: Number(form.taxRate),
      acceptMissingPrices: items.some((it: any) => !it.unitCost.trim()),
      clientRequestId: props.requestId,
      documents: stableInboundDocuments(draft.documents),
      costs: costsPayload.length ? costsPayload : undefined,
      rows: items.map((it: any, i: any) => ({
        sourceRow: i + 1,
        partNumber: uppercasePartNumber(it.partNumber).trim(),
        brand: it.brand.trim(),
        qty: Number(it.qty),
        unitCost: it.unitCost.trim() ? Number(it.unitCost) : null,
        prodYear: it.prodYear.trim(),
        buyerUserId: buyer.userId,
        operator: buyer.name,
        supplierName: form.supplierName.trim(),
        supplierContact: form.supplierContact.trim(),
        procurementRegion: "",
        location: it.location.trim(),
        note: form.note.trim(),
      })),
    };
  };
  const refresh = async () => {
    await Promise.allSettled([
      utils.inbound.list.invalidate(),
      utils.inbound.overview.invalidate(),
      costQuery.refetch(),
      histQuery.refetch(),
    ]);
  };
  const save = async () => {
    if (busy || partial) return;
    if (!uncertain && !validate()) return;
    if (editing && reviseNeeded && reason.trim().length < 2)
      return fail("请填写至少2个字的修改原因（最多200字）。");
    setBusy(true);
    setError("");
    let revised = false;
    try {
      if (!editing) {
        const request = uncertain || {
          kind: items.length === 1 ? "single" : "bulk",
          payload: makePayload(),
        };
        const result = await (
          request.kind === "single" ? create : bulk
        ).mutateAsync(request.payload);
        if (request.kind === "bulk") {
          const f = form;
          const needsMetadata =
            f.supplierPhone.trim() ||
            f.supplierOrderNo.trim() ||
            f.photos.length ||
            items.some(
              (it: any) => it.packageType.trim() || it.lotNumber.trim(),
            );
          if (needsMetadata) {
            try {
              for (const order of result.items || []) {
                if (enriched.current.has(order.id)) continue;
                const it = items[order.sourceRow - 1];
                const patch = {
                  id: order.id,
                  supplierName: f.supplierName.trim(),
                  supplierContact: f.supplierContact.trim(),
                  supplierPhone: f.supplierPhone.trim(),
                  supplierOrderNo: f.supplierOrderNo.trim(),
                  operator: selectedProcurementBuyer(buyerScope, f.buyerUserId)!
                    .name,
                  buyerUserId: selectedProcurementBuyer(
                    buyerScope,
                    f.buyerUserId,
                  )!.userId,
                  packageType: it.packageType.trim(),
                  lotNumber: it.lotNumber.trim(),
                  location: it.location.trim(),
                  note: f.note.trim(),
                  photos: photosPayload,
                  documents: stableInboundDocuments(draft.documents),
                };
                if (request.payload.status === "received")
                  await details.mutateAsync(patch);
                else {
                  const data = {
                    ...patch,
                    status: "in_transit",
                    partNumber: uppercasePartNumber(it.partNumber).trim(),
                    brand: it.brand.trim() || undefined,
                    qty: Number(it.qty),
                    unitCost: it.unitCost.trim()
                      ? Number(it.unitCost)
                      : undefined,
                    unitCostBasis: it.unitCost.trim()
                      ? f.unitCostBasis
                      : undefined,
                    taxRate: it.unitCost.trim() ? Number(f.taxRate) : undefined,
                    prodYear: it.prodYear.trim(),
                    inboundDate: f.inboundDate,
                  };
                  delete data.id;
                  await update.mutateAsync({ id: order.id, data });
                }
                enriched.current.add(order.id);
              }
            } catch (error: any) {
              throw new Error(
                "批量入库单已创建，但资料未保存：" +
                  __i2_error(error) +
                  "。已保存的资料不会重复提交，请重试原请求。",
              );
            }
          }
        }
        setUncertain(null);
        toast.success(
          request.kind === "single"
            ? (result.status === "received" ? "已确认入库 " : "已保存为在途 ") +
                result.slipNo
            : "已生成 " + result.count + " 张入库单",
        );
      } else {
        if (reviseNeeded && received) {
          if (!costQuery.data)
            throw new Error("费用明细尚未加载完成，请重试。");
          if (!revisionRequest.current)
            revisionRequest.current = {
              id: row.id,
              revision: Number(costQuery.data.order.revision),
              requestId: "rv-" + newRequestId().slice(0, 50),
              reason: reason.trim(),
              ...(qtyChanged ? { qty: Number(form.qty) } : {}),
              ...(priceChanged ? { unitCost: Number(form.unitCost) } : {}),
              ...(feeChanged ? { costs: costsPayload } : {}),
            };
          await revise.mutateAsync(revisionRequest.current);
          revised = true;
        }
        if (!received && !cancelled && (reviseNeeded || detailsChanged)) {
          // In-transit updates are atomic: no separate revision/details transaction.
          const data = {
            ...makePayload(),
            status: "in_transit",
            partNumber: uppercasePartNumber(form.partNumber).trim(),
            brand: form.brand.trim() || undefined,
            qty: Number(form.qty),
            unitCost: form.unitCost.trim() ? Number(form.unitCost) : undefined,
            unitCostBasis: form.unitCost.trim()
              ? form.unitCostBasis
              : undefined,
            taxRate: form.taxRate.trim() ? Number(form.taxRate) : undefined,
            prodYear: form.prodYear.trim(),
            inboundDate: form.inboundDate,
          };
          delete data.id;
          await update.mutateAsync({
            id: row.id,
            data,
            ...(feeChanged ? { costs: costsPayload } : {}),
          });
        } else if (detailsChanged) {
          if (draft.isDocumentsOnly())
            await saveDocs.mutateAsync({
              id: row.id,
              documents: stableInboundDocuments(draft.documents),
            });
          else await details.mutateAsync(makePayload());
        }
        toast.success("修改已保存，库存与成本已同步");
      }
      await refresh();
      if (live.current.isCurrentScope()) props.onDone();
    } catch (err: any) {
      const msg = __i2_error(err);
      if (revised) {
        // Publish the partial-result notice before any query refresh. A denied
        // details call must not silently hide the successful revision notice.
        setPartial(true);
        setConfirmOpen(false);
        fail(
          "数量/单价/采购费用修订已成功，但供应商等资料未保存：" +
            msg +
            " 请关闭并重新打开单据，仅补充未保存的资料。不要再次提交同一修订。",
        );
        refresh().catch(() => {});
      } else {
        if (
          !editing &&
          /网络|尚未确认|结果未确认|已创建，但采购费用未保存|已创建，但资料未保存/.test(
            msg,
          )
        )
          setUncertain(
            uncertain || {
              kind: items.length === 1 ? "single" : "bulk",
              payload: makePayload(),
            },
          );
        fail(msg);
        if (err?.data?.code === "UNAUTHORIZED")
          props.onAuthorizationError?.(err);
      }
    } finally {
      setBusy(false);
    }
  };
  const trySave = () => {
    if (editing && !reviseNeeded && !detailsChanged) return props.onClose();
    if (!validate()) return;
    if (editing && reviseNeeded) {
      if (fees === null) return fail("费用明细尚未加载完成，请稍后重试。");
      setReason("");
      setConfirmOpen(true);
    } else if (
      !editing &&
      items.some((it: any) => !it.unitCost.trim()) &&
      !window.confirm(
        "存在未录价格物料。将保留缺价标记，后续可补录价格，确认继续？",
      )
    )
      return;
    else save();
  };
  const close = () => {
    if (busy || draft.busy || props.photoBusy) return;
    if (
      uncertain &&
      !window.confirm("保存结果尚未确认，建议重试原请求。仍要关闭？")
    )
      return;
    props.onClose();
  };
  React.useEffect(() => {
    const key = (ev: any) => {
      if (ev.key === "Escape") {
        if (confirmOpen) setConfirmOpen(false);
        else if (historyOpen) setHistoryOpen(false);
        else close();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [busy, confirmOpen, historyOpen, uncertain]);
  const h = (key: any, label: any, options: any = {}) => (
    <label className="i2-field">
      <span>
        {label}
        {options.required && <em>*</em>}
      </span>
      <input
        className="crm-input i2-input"
        aria-label={label}
        value={form[key]}
        onChange={(ev: any) => set(key, ev.target.value)}
        {...options}
      />
    </label>
  );
  const segment = (
    value: any,
    options: any,
    onChange: any,
    disabled: any = false,
  ) => (
    <span className="i2-seg">
      {options.map(([val, label]: any) => (
        <button
          key={val}
          type="button"
          className={value === val ? "on" : ""}
          onClick={() => onChange(val)}
          disabled={disabled}
        >
          {label}
        </button>
      ))}
    </span>
  );
  const card = (title: any, body: any, extra?: any) => (
    <section className="inbound-entry-card i2-card">
      <header className="i2-title">
        <span>{title}</span>
        {extra}
      </header>
      <div className="i2-body">{body}</div>
    </section>
  );
  const delta = (after: bigint | null, before: bigint | null, places: number = 2) =>
    after != null && before != null && after !== before ? (
      <small className={"i2-delta " + (after > before ? "up" : "down")}>
        {after > before ? "+" : ""}
        {__i2_fmt(
          __i2_decimal(after - before, places),
          places === 6 ? 4 : places,
        )}
      </small>
    ) : null;
  const locked =
    busy || !!uncertain || partial || cancelled || draft.documentsOnly;
  const costEditable = !locked && !cancelled && (!editing || visibleMoney);
  const rowsDiff = [];
  const oldPayable =
    row?.payableAmount != null
      ? __i2_scaled(row.payableAmount, 2)!
      : oldGoods == null
        ? null
        : oldGoods +
          originalFees
            .filter((f: any) => f.payee === "supplier")
            .reduce(
              (sum: any, f: any) => sum + (__i2_scaled(f.amount, 2)! || 0n),
              0n,
            );
  const oldPayStatus =
    ({
      paid: "已付全款",
      partial: "部分付款",
      unpaid: "未付款",
      untracked: "未登记",
      overpaid: "超付待处理",
    } as Record<string, string>)[row?.paymentCategory] || "—";
  if (qtyChanged) rowsDiff.push(["数量", original.current.qty, form.qty]);
  if (priceChanged)
    rowsDiff.push([
      "单价",
      __i2_fmt(original.current.unitCost, 6),
      __i2_fmt(form.unitCost, 6),
    ]);
  if (feeChanged)
    rowsDiff.push([
      "采购费用",
      __i2_money(oldFeeTotal),
      __i2_money(figures.all),
    ]);
  if (visibleMoney && reviseNeeded)
    rowsDiff.push(
      ["采购总成本", __i2_money(oldTotal), __i2_money(figures.total)],
      [
        "单位成本（含费用）",
        oldUnit == null ? "—" : "¥" + __i2_fmt(__i2_decimal(oldUnit, 6), 4),
        figures.unit == null
          ? "—"
          : "¥" + __i2_fmt(__i2_decimal(figures.unit, 6), 4),
      ],
    );
  if (visibleMoney && reviseNeeded)
    rowsDiff.push(
      ["应付供应商", __i2_money(oldPayable), __i2_money(figures.payable)],
      ["付款状态", oldPayStatus, payStatus],
    );
  const eventLabels: Record<string, string> = {
    created_received: "创建并直接入库",
    created_in_transit: "创建在途单",
    revised: "修改数量 / 单价 / 采购费用",
    created: "创建入库单",
    received: "确认入库",
    updated: "修改在途单",
    updated_received_details: "修改单据资料",
    payment_recorded: "登记付款",
    payment_tracking_started: "确认未付款",
    cancelled: "作废入库单",
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 inb2"
      onClick={close}
    >
      <div
        className="inbound-modal aui-dialog i2-modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "编辑入库单" : "新建采购入库单"}
        onClick={(ev: any) => ev.stopPropagation()}
      >
        <header className="i2-header">
          <div>
            <h3>
              {editing ? "编辑入库单" : "新建采购入库"}
              {editing && (
                <>
                  <span className={"i2-chip " + (received ? "ok" : "blue")}>
                    {cancelled ? "已作废" : received ? "已入库" : "在途"}
                  </span>
                  {visibleMoney && (
                    <span className="i2-chip ok">{payStatus}</span>
                  )}
                </>
              )}
            </h3>
            <p>{editing ? "正在编辑 " + row.slipNo : "登记在途或直接入库"}</p>
          </div>
          <div className="i2-header-right">
            {editing && (
              <button
                className="crm-btn"
                onClick={() => {
                  setHistoryOpen(true);
                  histQuery.refetch();
                }}
              >
                修改记录 {histQuery.data?.events?.length ?? "—"}
              </button>
            )}
            <span className="i2-hint">单号：{row?.slipNo || "保存后生成"}</span>
            <button className="i2-x" aria-label="关闭入库单" onClick={close}>
              ×
            </button>
          </div>
        </header>
        <div className="i2-scroll">
          <div className="i2-grid">
            <main>
              {card(
                "供应商与单据",
                <div className="i2-fields">
                  {h("supplierName", "供应商名称", {
                    required: true,
                    maxLength: 128,
                    disabled: locked,
                  })}
                  {h("supplierContact", "供应商联系人", {
                    maxLength: 64,
                    disabled: locked,
                  })}
                  {h("supplierPhone", "联系方式", {
                    maxLength: 32,
                    placeholder: "手机或微信",
                    disabled: locked,
                  })}
                  <label className="i2-field">
                    <span>
                      采购员<em>*</em>
                    </span>
                    {editing ? (
                      <div className="i2-readonly">
                        {row.operator || "未记录"} · 创建后锁定
                      </div>
                    ) : (
                      <select
                        className="crm-input i2-input"
                        aria-label="采购员"
                        value={form.buyerUserId}
                        disabled={locked || !buyerScope?.canChooseBuyer}
                        onChange={(ev: any) => {
                          const buyer = selectedProcurementBuyer(
                            buyerScope,
                            ev.target.value,
                          )!;
                          if (buyer) {
                            set("buyerUserId", ev.target.value);
                            set("operator", buyer.name);
                          }
                        }}
                      >
                        <option value="">请选择采购员</option>
                        {(buyerScope?.options || []).map((b: any) => (
                          <option key={b.userId} value={b.userId}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                  {h(
                    "inboundDate",
                    form.status === "in_transit" ? "预计到货日期" : "入库日期",
                    {
                      required: true,
                      type: "date",
                      disabled: locked || received,
                    },
                  )}
                  {h("supplierOrderNo", "供应商订单号", {
                    maxLength: 64,
                    placeholder: "选填",
                    disabled: locked,
                  })}
                  {!editing && buyerError && (
                    <p className="i2-error">
                      {buyerError}
                      <button onClick={props.retryBuyers}>重新获取</button>
                    </p>
                  )}
                </div>,
              )}
              {card(
                "采购物料",
                <>
                  <table className="i2-table i2-items">
                    <colgroup>
                      <col style={{ width: "24%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "12%" }} />
                      {visibleMoney && (
                        <>
                          <col style={{ width: "14%" }} />
                          <col style={{ width: "16%" }} />
                        </>
                      )}
                      <col style={{ width: "8%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>
                          料号/型号<em>*</em>
                        </th>
                        <th>品牌</th>
                        <th>
                          年份/DC<em>*</em>
                        </th>
                        <th>
                          数量<em>*</em>
                        </th>
                        {visibleMoney && (
                          <>
                            <th>单价 (¥)</th>
                            <th>小计 (¥)</th>
                          </>
                        )}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it: any, index: any) => (
                        <React.Fragment key={index}>
                          <tr>
                            {[
                              [
                                "partNumber",
                                "料号/型号",
                                "输入2个字符自动联想",
                              ],
                              ["brand", "品牌", "如：ST"],
                              ["prodYear", "年份/DC", String(currentYear)],
                              ["qty", "数量", "0"],
                              ...(visibleMoney
                                ? [["unitCost", "单价", "0.00"]]
                                : []),
                            ].map(([key, label, placeholder]: any) => (
                              <td key={key}>
                                {key === "partNumber" ? (
                                  <__i2_Part
                                    label={"物料" + (index + 1) + " 料号/型号"}
                                    value={it.partNumber}
                                    disabled={locked || received || cancelled}
                                    enabled={props.enabled}
                                    onChange={(value: any) =>
                                      setItem(index, "partNumber", value)
                                    }
                                    onSelect={(item: any) => {
                                      setItem(
                                        index,
                                        "partNumber",
                                        uppercasePartNumber(item.partNumber),
                                      );
                                      if (item.brand)
                                        setItem(index, "brand", item.brand);
                                      if (item.package)
                                        setItem(
                                          index,
                                          "packageType",
                                          item.package,
                                        );
                                    }}
                                  />
                                ) : (
                                  <input
                                    className={
                                      "crm-input i2-input " +
                                      (["qty", "unitCost"].includes(key)
                                        ? "i2-num"
                                        : "")
                                    }
                                    aria-label={
                                      "物料" + (index + 1) + " " + label
                                    }
                                    placeholder={placeholder}
                                    value={it[key]}
                                    disabled={
                                      locked ||
                                      ((received || cancelled) &&
                                        ["partNumber", "brand"].includes(
                                          key,
                                        )) ||
                                      (received && key === "prodYear") ||
                                      (!costEditable && key === "unitCost") ||
                                      (cancelled && key === "qty")
                                    }
                                    inputMode={
                                      key === "qty"
                                        ? "numeric"
                                        : key === "unitCost"
                                          ? "decimal"
                                          : "text"
                                    }
                                    maxLength={
                                      key === "partNumber"
                                        ? 128
                                        : key === "prodYear"
                                          ? 16
                                          : 64
                                    }
                                    onChange={(ev: any) =>
                                      setItem(
                                        index,
                                        key,
                                        key === "partNumber"
                                          ? uppercasePartNumber(ev.target.value)
                                          : ev.target.value,
                                      )
                                    }
                                  />
                                )}
                              </td>
                            ))}
                            {visibleMoney && (
                              <td>
                                <div className="i2-subtotal">
                                  {figures.parts[index].amount == null
                                    ? "—"
                                    : __i2_fmt(
                                        __i2_decimal(
                                          figures.parts[index].amount,
                                        ),
                                      )}
                                </div>
                              </td>
                            )}
                            <td>
                              <button
                                className="i2-more"
                                onClick={() =>
                                  setMore((m: any) => ({
                                    ...m,
                                    [index]: !m[index],
                                  }))
                                }
                              >
                                {more[index] ? "收起" : "更多"}
                              </button>
                              {index > 0 && (
                                <button
                                  className="i2-x i2-delete"
                                  aria-label={"删除物料" + (index + 1)}
                                  disabled={locked}
                                  onClick={() =>
                                    setAdditional((rows: any) =>
                                      rows.filter(
                                        (_: any, k: any) => k !== index - 1,
                                      ),
                                    )
                                  }
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                          {more[index] && (
                            <tr>
                              <td colSpan={visibleMoney ? 7 : 5}>
                                <div className="i2-extra i2-fields">
                                  {[
                                    ["packageType", "封装"],
                                    ["lotNumber", "批次 / Lot No."],
                                    ["location", "仓位"],
                                  ].map(([key, label]: any) => (
                                    <label className="i2-field" key={key}>
                                      <span>
                                        {label}
                                        {key === "location" &&
                                          form.status === "received" && (
                                            <em>*</em>
                                          )}
                                      </span>
                                      <input
                                        className="crm-input i2-input"
                                        aria-label={
                                          "物料" + (index + 1) + " " + label
                                        }
                                        maxLength={64}
                                        value={it[key]}
                                        disabled={locked}
                                        onChange={(ev: any) =>
                                          setItem(index, key, ev.target.value)
                                        }
                                      />
                                    </label>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                  {!editing && (
                    <button
                      className="i2-add"
                      disabled={locked || items.length >= INBOUND_BULK_MAX_ROWS}
                      onClick={() =>
                        setAdditional((rows: any) => [
                          ...rows,
                          { ...emptyForm(), supplierName: form.supplierName },
                        ])
                      }
                    >
                      ＋ 添加物料
                    </button>
                  )}
                  {editing && (
                    <p className="i2-note">
                      {received || cancelled
                        ? "料号、品牌暂由后端锁定；需作废后重录。"
                        : "在途料号/品牌可改，确认入库后锁定。"}
                      {received
                        ? "日期/DC 暂由后端锁定；数量不得小于已出库 + 已预留。"
                        : ""}
                    </p>
                  )}
                  {!editing && (
                    <button
                      className="i2-import"
                      onClick={() => setImportOpen(!importOpen)}
                      disabled={busy}
                    >
                      Excel 导入 / 粘贴批量入库 {importOpen ? "收起" : "›"}
                    </button>
                  )}
                  {importOpen && props.importer}
                </>,
                visibleMoney && (
                  <div className="i2-tax">
                    <span>单价</span>
                    {segment(
                      form.unitCostBasis,
                      [
                        ["CNY_TAX_INCLUDED", "含税"],
                        ["CNY_TAX_EXCLUDED", "未税"],
                      ],
                      switchBasis,
                      locked || received || cancelled,
                    )}
                    <label>
                      <input
                        className="crm-input i2-input i2-num"
                        aria-label="税率"
                        value={form.taxRate}
                        onChange={(ev: any) => set("taxRate", ev.target.value)}
                        disabled={locked || received || cancelled}
                      />
                      <span>%</span>
                    </label>
                  </div>
                ),
              )}
              {visibleMoney &&
                card(
                  "采购费用",
                  <>
                    <table className="i2-table i2-fees">
                      <colgroup>
                        <col style={{ width: "24%" }} />
                        <col style={{ width: "22%" }} />
                        <col style={{ width: "18%" }} />
                        <col style={{ width: "30%" }} />
                        <col style={{ width: "6%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>费用项目</th>
                          <th>收款方</th>
                          <th>金额 (¥)</th>
                          <th>备注</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {feeList.map((f: any, index: any) => (
                          <tr key={index}>
                            <td>
                              <select
                                className="crm-input i2-input"
                                aria-label={"费用" + (index + 1) + " 项目"}
                                value={f.title}
                                disabled={!costEditable}
                                onChange={(ev: any) =>
                                  setFee(index, { title: ev.target.value })
                                }
                              >
                                {![
                                  "运费",
                                  "报关费",
                                  "关税",
                                  "检测费",
                                  "银行手续费",
                                  "其他",
                                ].includes(f.title) && (
                                  <option>{f.title}</option>
                                )}
                                {[
                                  "运费",
                                  "报关费",
                                  "关税",
                                  "检测费",
                                  "银行手续费",
                                  "其他",
                                ].map((t: any) => (
                                  <option key={t}>{t}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              {segment(
                                f.payee,
                                [
                                  ["supplier", "供应商"],
                                  ["third_party", "第三方"],
                                ],
                                (payee: any) => setFee(index, { payee }),
                                !costEditable,
                              )}
                            </td>
                            <td>
                              <input
                                className="crm-input i2-input i2-num"
                                aria-label={"费用" + (index + 1) + " 金额"}
                                placeholder="0.00"
                                inputMode="decimal"
                                value={f.amount}
                                disabled={!costEditable}
                                onChange={(ev: any) =>
                                  setFee(index, { amount: ev.target.value })
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="crm-input i2-input"
                                aria-label={"费用" + (index + 1) + " 备注"}
                                placeholder="选填"
                                value={f.note}
                                maxLength={255}
                                disabled={!costEditable}
                                onChange={(ev: any) =>
                                  setFee(index, { note: ev.target.value })
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="i2-x i2-delete"
                                aria-label={"删除费用" + (index + 1)}
                                disabled={!costEditable}
                                onClick={() =>
                                  setFees((rows: any) =>
                                    rows.filter(
                                      (_: any, k: any) => k !== index,
                                    ),
                                  )
                                }
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                        {fees === null && (
                          <tr>
                            <td colSpan={5}>
                              {costQuery.isError ? (
                                <span className="i2-error">
                                  {__i2_error(costQuery.error)}{" "}
                                  <button onClick={() => costQuery.refetch()}>
                                    重试
                                  </button>
                                </span>
                              ) : (
                                "正在读取费用明细…"
                              )}
                            </td>
                          </tr>
                        )}
                        {fees?.length === 0 && (
                          <tr>
                            <td className="i2-note" colSpan={5}>
                              暂无费用
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <button
                      className="i2-add"
                      disabled={
                        !costEditable || fees === null || feeList.length >= 20
                      }
                      onClick={() =>
                        setFees((rows: any) => [
                          ...rows,
                          {
                            title: "运费",
                            payee: "third_party",
                            amount: "",
                            note: "",
                          },
                        ])
                      }
                    >
                      ＋ 添加费用
                    </button>
                  </>,
                  <span className="i2-note">
                    {items.length > 1
                      ? "按货款金额分摊到各物料"
                      : "计入物料单位成本"}
                  </span>,
                )}
              <button
                className="i2-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                <span>照片与备注 · 单据附件</span>
                <span>{expanded ? "收起 ↑" : "展开 ↓"}</span>
              </button>
              {expanded &&
                card(
                  "照片与备注",
                  <>
                    <div className="i2-field">
                      <span>入库实拍照片</span>
                      <input
                        ref={props.photoRef}
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={(ev: any) =>
                          props.uploadPhotos(ev.target.files)
                        }
                      />
                      <div className="i2-photos">
                        {form.photos.map((photo: any, index: any) => (
                          <div key={photo.key}>
                            <img
                              src={photo.url}
                              alt={"入库照片" + (index + 1)}
                            />
                            <button
                              className="i2-x"
                              disabled={locked}
                              aria-label={"删除照片" + (index + 1)}
                              onClick={() =>
                                set(
                                  "photos",
                                  form.photos.filter(
                                    (toast: any) => toast.key !== photo.key,
                                  ),
                                )
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          className="crm-btn"
                          disabled={
                            locked || props.photoBusy || form.photos.length >= 5
                          }
                          onClick={() => props.photoRef.current?.click()}
                        >
                          {props.photoBusy
                            ? "上传中…"
                            : "＋ 上传照片 (" + form.photos.length + "/5)"}
                        </button>
                      </div>
                      <p className="i2-note">JPG / PNG / WebP，单张不超过5MB</p>
                    </div>
                    <label className="i2-field">
                      <span>备注</span>
                      <textarea
                        className="crm-input i2-input"
                        aria-label="备注"
                        maxLength={500}
                        value={form.note}
                        disabled={locked}
                        onChange={(ev: any) => set("note", ev.target.value)}
                      />
                    </label>
                    <InboundDocuments
                      draft={draft}
                      disabled={busy || !props.enabled}
                      bulk={items.length > 1}
                    />
                  </>,
                )}
            </main>
            <aside className="i2-summary">
              {visibleMoney &&
                card(
                  "成本汇总",
                  <>
                    <div className="i2-srow">
                      <span>货款（含税）</span>
                      <b>{figures.valid ? __i2_money(figures.goods) : "—"}</b>
                    </div>
                    <div className="i2-srow">
                      <span>采购费用</span>
                      <b>
                        {__i2_money(figures.all)}
                        {editing && delta(figures.all, oldFeeTotal)}
                      </b>
                    </div>
                    <div className="i2-srow i2-total">
                      <span>采购总成本</span>
                      <b>{figures.valid ? __i2_money(figures.total) : "—"}</b>
                    </div>
                    {editing && (
                      <div className="i2-total-delta">
                        {figures.valid && delta(figures.total, oldTotal)}
                      </div>
                    )}
                    {figures.unit != null && (
                      <div className="i2-unit">
                        <span>单位成本（含费用）</span>
                        <b>
                          ¥{__i2_fmt(__i2_decimal(figures.unit, 6), 4)}
                          {editing && delta(figures.unit, oldUnit, 6)}
                        </b>
                      </div>
                    )}
                    {items.length > 1 && (
                      <div className="i2-unit">
                        {items.length} 种物料 ·{" "}
                        {__i2_fmt(figures.qty.toString(), 0)} 件<br />
                        费用按货款金额比例分摊
                      </div>
                    )}
                    <div className="i2-pay">
                      <div>
                        <span>应付供应商</span>
                        <strong>
                          {figures.valid ? __i2_money(figures.payable) : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>已付</span>
                        <strong>{__i2_money(paid)}</strong>
                      </div>
                      <div>
                        <span>{due != null && due < 0n ? "超付" : "待付"}</span>
                        <strong>
                          {figures.valid
                            ? __i2_money(due != null && due < 0n ? -due : due)
                            : "—"}
                        </strong>
                      </div>
                    </div>
                    <div className="i2-paystate">
                      <span className="i2-chip ok">{payStatus}</span>
                      {editing && !cancelled && (
                        <button onClick={() => props.openPayment(row)}>
                          登记付款 ›
                        </button>
                      )}
                    </div>
                    {!editing && (
                      <>
                        <label className="i2-field">
                          <span>
                            货物状态<em>*</em>
                          </span>
                          {segment(
                            form.status,
                            [
                              ["in_transit", "在途"],
                              ["received", "已入库"],
                            ],
                            (v: any) => set("status", v),
                            locked,
                          )}
                        </label>
                        <label className="i2-field">
                          <span>
                            货款情况<em>*</em>
                          </span>
                          {segment(
                            paymentMode,
                            [
                              ["unpaid", "未付款"],
                              ["partial", "部分付款"],
                              ["paid", "已付全款"],
                            ],
                            (v: any) => set("paymentMode", v),
                            locked,
                          )}
                        </label>
                        {paymentMode === "partial" && (
                          <>
                            <label className="i2-field">
                              <span>付款比例 / 实际金额</span>
                              <select
                                className="crm-input i2-input"
                                aria-label="付款比例"
                                value={form.paymentPercent}
                                onChange={(ev: any) =>
                                  set("paymentPercent", ev.target.value)
                                }
                              >
                                {["30", "50", "70", "custom"].map((v: any) => (
                                  <option key={v} value={v}>
                                    {v === "custom" ? "自定义金额" : v + "%"}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {form.paymentPercent === "custom" &&
                              h("paymentAmount", "实际付款金额", {
                                inputMode: "decimal",
                                disabled: locked,
                              })}
                          </>
                        )}
                        {paymentMode !== "unpaid" && (
                          <>
                            {h("paymentDate", "付款日期", {
                              type: "date",
                              disabled: locked,
                            })}
                            {h("paymentNote", "付款备注", {
                              maxLength: 255,
                              disabled: locked,
                            })}
                          </>
                        )}
                      </>
                    )}
                    {received && (
                      <div className="i2-stock">
                        <div>
                          <span>已入库</span>
                          <b>{__i2_fmt(oldQty, 0)}</b>
                        </div>
                        {stockOut != null && (
                          <div>
                            <span>已出库</span>
                            <b>{__i2_fmt(String(stockOut), 0)}</b>
                          </div>
                        )}
                        {stockNow != null && (
                          <div>
                            <span>当前库存</span>
                            <b>{__i2_fmt(String(stockNow), 0)}</b>
                          </div>
                        )}
                      </div>
                    )}
                    <p className="i2-note">
                      第三方费用仅计成本；供应商费用计入应付。
                      {!editing && paymentMode !== "unpaid"
                        ? " 全额付款仅含货款，供应商费用另计。"
                        : received
                          ? " 修改税率/口径需后端扩展。"
                          : ""}
                    </p>
                  </>,
                )}
              {!visibleMoney && (
                <p className="i2-note">当前账号无成本查看权限。</p>
              )}
            </aside>
          </div>
          {cancelled && (
            <div className="i2-errorbox" role="alert">
              已作废单当前后端仅允许查看。附件接口不允许读取；资料修改需要后端扩展，请勿作重复入库。
            </div>
          )}
          {error && (
            <div className="i2-errorbox" role="alert">
              {error}
            </div>
          )}
          <footer className="i2-actions">
            <span>
              {editing && reviseNeeded
                ? "成本修改保存前需确认并填写原因"
                : items.length > 1
                  ? "保存后生成 " + items.length + " 张入库单"
                  : ""}
            </span>
            <button className="crm-btn" disabled={busy} onClick={close}>
              {partial ? "关闭并重新打开" : "取消"}
            </button>
            <button
              className="crm-btn crm-btn-primary"
              disabled={
                busy ||
                partial ||
                cancelled ||
                draft.blocked ||
                props.photoBusy ||
                !props.enabled ||
                (!editing &&
                  !selectedProcurementBuyer(buyerScope, form.buyerUserId)!)
              }
              onClick={uncertain ? save : trySave}
            >
              {busy
                ? "保存中…"
                : uncertain
                  ? "重试原请求"
                  : editing
                    ? "保存修改"
                    : form.status === "in_transit"
                      ? "保存为在途"
                      : "确认入库"}
            </button>
          </footer>
        </div>
      </div>
      {confirmOpen && (
        <div
          className="i2-confirm-mask"
          onClick={(ev: any) => ev.stopPropagation()}
        >
          <div className="i2-confirm" role="dialog" aria-label="确认修改">
            <h4>确认修改{received ? "已入库单" : "入库单"}</h4>
            <p className="i2-note">
              {row.slipNo} · {row.partNumber}
            </p>
            <table className="i2-diff">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>原值</th>
                  <th>新值</th>
                </tr>
              </thead>
              <tbody>
                {rowsDiff.map(([title, before, after]: any) => (
                  <tr key={title}>
                    <td>{title}</td>
                    <td className="i2-old">{before}</td>
                    <td>
                      <b>{after}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label className="i2-field">
              <span>
                修改原因<em>*</em>
              </span>
              <input
                className="crm-input i2-input"
                aria-label="修改原因"
                placeholder="如：供应商补开运费发票"
                maxLength={200}
                value={reason}
                onChange={(ev: any) => setReason(ev.target.value)}
                disabled={busy}
              />
            </label>
            {error && <p className="i2-error">{error}</p>}
            <footer className="i2-actions">
              <button
                className="crm-btn"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                返回修改
              </button>
              <button
                className="crm-btn crm-btn-primary"
                disabled={busy || reason.trim().length < 2}
                onClick={save}
              >
                {busy ? "保存中…" : "确认保存"}
              </button>
            </footer>
          </div>
        </div>
      )}
      {historyOpen && (
        <div
          className="i2-history"
          role="dialog"
          aria-label="修改记录"
          onClick={(ev: any) => ev.stopPropagation()}
        >
          <header>
            修改记录 · {row.slipNo}
            <button
              className="i2-x"
              aria-label="关闭修改记录"
              onClick={() => setHistoryOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="i2-timeline">
            {histQuery.isFetching && <p>读取中…</p>}
            {histQuery.isError && (
              <p className="i2-error">
                {__i2_error(histQuery.error)}{" "}
                <button onClick={() => histQuery.refetch()}>重试</button>
              </p>
            )}
            {histQuery.data?.events?.map((event: any) => (
              <article key={event.id}>
                <time>
                  {new Date(event.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {event.actorName || "未知操作人"}
                </time>
                <p>{eventLabels[event.eventType] || event.eventType}</p>
                {__i2_historyDiff(event, visibleMoney) && (
                  <div className="i2-history-detail">
                    {__i2_historyDiff(event, visibleMoney)}
                  </div>
                )}
                {event.reason && (
                  <div className="i2-history-detail">原因：{event.reason}</div>
                )}
              </article>
            ))}
            {histQuery.data?.events?.length === 0 && <p>暂无修改记录</p>}
          </div>
        </div>
      )}
    </div>
  );
}
