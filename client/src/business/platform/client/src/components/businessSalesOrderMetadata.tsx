import React, {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type FormEvent, type ReactNode,
} from "react";
import { z } from "zod";
import { createBusinessScopeTrpcClient } from "../../../../api/business-trpc";
import { useBusinessScope } from "../../../../BusinessScope";
import {
  BUSINESS_AFTER_SALE_KINDS,
  businessSalesOrderMetadataDtoSchema,
  businessSalesOrderSaveReceiverSchema,
  businessSalesOrderAddAfterSaleSchema,
  businessSalesOrderUpdateAfterSaleSchema,
  type BusinessSalesOrderMetadataDto,
  type BusinessSalesOrderAfterSaleDto,
  type BusinessSalesOrderSaveReceiverInput,
  type BusinessSalesOrderAddAfterSaleInput,
  type BusinessSalesOrderUpdateAfterSaleInput,
  type BusinessAfterSaleKind,
  type BusinessAfterSaleStatus,
} from "@shared/businessSalesOrderMetadata";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import type { BusinessOrderExportMetadata, BusinessOrderExportMetadataReader } from "../lib/businessSalesOrderPresentation";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "./ui/dialog";

/** Never substitute customer contacts, mall history or a financial execution status. */
export const BUSINESS_SALES_ORDER_METADATA_NOTICE = "售后仅登记，不自动退款或退库。退货、退款均为申请，已结案不代表已退款或已退库。";
export const BUSINESS_SALES_ORDER_AFTER_SALE_STATUS_LABELS = {
  open: "登记", processing: "处理中", closed: "已结案",
} satisfies Record<BusinessAfterSaleStatus, string>;
export function businessSalesOrderAfterSaleKindLabel(kind: string) {
  switch (kind) {
    case "consultation": return "咨询";
    case "repair": return "维修";
    case "exchange": return "换货登记";
    case "return":
    case "return_request": return "退货申请";
    case "refund_request": return "退款申请";
    default: return "未知类型";
  }
}

export type BusinessSalesOrderMetadataOrder = {
  id: number;
  orderNumber: string;
  customerId: number;
};
export type BusinessSalesOrderMetadataProviderProps = {
  children: ReactNode;
  rows: readonly BusinessSalesOrderMetadataOrder[];
  /** Both grants are supplied by the verified page, not inferred from an order. */
  ready: boolean;
  canWrite: boolean;
  identityKey: string | number | null;
  merchantId: number | null | undefined;
  customerId?: number;
  onDialogOpenChange?: (open: boolean) => void;
};

const orderProofSchema = z.object({
  id: z.number().int().positive(), orderNumber: z.string().min(1),
  customerId: z.number().int().positive(),
}).passthrough();
function orderKey(order: BusinessSalesOrderMetadataOrder) {
  return JSON.stringify([order.id, order.orderNumber, order.customerId]);
}
function validIdentity(value: unknown) {
  return typeof value === "string" ? Boolean(value.trim()) : typeof value === "number" && Number.isFinite(value);
}
function validOrder(order: BusinessSalesOrderMetadataOrder, customerId?: number) {
  return Number.isSafeInteger(order.id) && order.id > 0 &&
    typeof order.orderNumber === "string" && Boolean(order.orderNumber.trim()) &&
    Number.isSafeInteger(order.customerId) && order.customerId > 0 &&
    (customerId === undefined || customerId === order.customerId);
}
function orderInput(order: BusinessSalesOrderMetadataOrder, customerId?: number) {
  return { id: order.id, ...(customerId === undefined ? {} : { customerId }) };
}
export function assertBusinessSalesOrderMetadataOrder(
  order: BusinessSalesOrderMetadataOrder, result: unknown, customerId?: number,
): void {
  const proof = orderProofSchema.safeParse(result);
  if (!validOrder(order, customerId) || !proof.success ||
      proof.data.id !== order.id || proof.data.orderNumber !== order.orderNumber ||
      proof.data.customerId !== order.customerId) {
    throw new Error("订单身份核验不一致，请刷新订单后重试");
  }
}
function parseMetadata(
  order: BusinessSalesOrderMetadataOrder, result: unknown,
  merchantId: number, customerId?: number,
): BusinessSalesOrderMetadataDto {
  const data = businessSalesOrderMetadataDtoSchema.parse(result);
  if (data.merchantId !== merchantId || data.orderId !== order.id ||
      data.orderNumber !== order.orderNumber || data.customerId !== order.customerId ||
      (customerId !== undefined && data.customerId !== customerId)) {
    throw new Error("元数据订单范围不一致，请刷新核验后重试");
  }
  return data;
}
export function newBusinessSalesOrderMetadataRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("当前环境不支持安全请求标识，请更换安全浏览器后重试");
  }
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
    value => value.toString(16).padStart(2, "0")).join("");
}
function abortError() { return new DOMException("元数据请求已取消", "AbortError"); }
function isAbort(error: unknown) { return error instanceof Error && error.name === "AbortError"; }
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const value = error as { data?: { code?: string }; code?: string };
  return value.data?.code ?? value.code;
}
function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message || "元数据格式不正确，请刷新后重试";
  return error instanceof Error ? error.message : "元数据读取失败，请重试";
}
function isConflict(error: unknown) {
  return errorCode(error) === "CONFLICT" || /版本|冲突/.test(errorMessage(error));
}

type NativeClient = ReturnType<typeof createBusinessScopeTrpcClient>;
type Entry =
  | { state: "loading"; data?: BusinessSalesOrderMetadataDto }
  | { state: "error"; error: string; data?: BusinessSalesOrderMetadataDto }
  | { state: "ready"; data: BusinessSalesOrderMetadataDto };
type WriteCommand =
  | { method: "saveReceiver"; input: BusinessSalesOrderSaveReceiverInput }
  | { method: "addAfterSale"; input: BusinessSalesOrderAddAfterSaleInput }
  | { method: "updateAfterSale"; input: BusinessSalesOrderUpdateAfterSaleInput };
type MetadataContextValue = {
  ready: boolean;
  canWrite: boolean;
  customerId?: number;
  entry: (order: BusinessSalesOrderMetadataOrder) => Entry | undefined;
  open: (kind: "receiver" | "afterSales", order: BusinessSalesOrderMetadataOrder) => void;
  reload: (order: BusinessSalesOrderMetadataOrder) => Promise<BusinessSalesOrderMetadataDto>;
  write: (order: BusinessSalesOrderMetadataOrder, command: WriteCommand) => Promise<BusinessSalesOrderMetadataDto>;
};
const MetadataContext = createContext<MetadataContextValue | null>(null);
function useMetadata() {
  const context = useContext(MetadataContext);
  if (!context) throw new Error("BusinessSalesOrderMetadataProvider is required");
  return context;
}

/** Reuse the existing BusinessScope proof and native authenticated, bounded transport.
 * A keyed session hides all old data synchronously, then aborts on cleanup. */
export function BusinessSalesOrderMetadataProvider(props: BusinessSalesOrderMetadataProviderProps) {
  const business = useBusinessScope();
  const proof = business.contextVerification;
  const ready = props.ready && proof.state === "verified" &&
    validIdentity(props.identityKey) && validIdentity(proof.identity) &&
    validIdentity(proof.authorizationVersion) && validIdentity(proof.readVersion) &&
    Number.isSafeInteger(props.merchantId) && (props.merchantId ?? 0) > 0 &&
    props.merchantId === business.merchantId &&
    (props.customerId === undefined || (Number.isSafeInteger(props.customerId) && props.customerId > 0));
  // Snapshot tuples, not mutable row objects. Any visible order identity change closes dialogs.
  const tuples = props.rows.map(order => ({
    id: order.id, orderNumber: order.orderNumber, customerId: order.customerId,
  }));
  const key = JSON.stringify([
    props.identityKey, props.merchantId, props.customerId, ready, props.canWrite,
    proof.identity, proof.authorizationVersion, proof.readVersion,
    tuples.map(order => [order.id, order.orderNumber, order.customerId]),
  ]);
  return <MetadataSession key={key} {...props} rows={tuples} ready={ready}
    merchantId={ready ? business.merchantId : null}
    onAuthorizationError={business.onAuthorizationError} />;
}

function MetadataSession({
  children, rows, ready, canWrite, merchantId, customerId, onDialogOpenChange,
  onAuthorizationError,
}: BusinessSalesOrderMetadataProviderProps & { onAuthorizationError: (error: unknown) => void }) {
  const client = useMemo(() => ready && merchantId ? createBusinessScopeTrpcClient(merchantId) : null,
    [ready, merchantId]);
  const known = useRef(new Map(rows.filter(order => validOrder(order, customerId)).map(order => [orderKey(order), order])));
  const live = useRef(false);
  const guard = useRef({ ready, canWrite, merchantId, customerId });
  guard.current = { ready, canWrite, merchantId, customerId };
  const controllers = useRef(new Set<AbortController>());
  const reading = useRef(new Map<string, AbortController>());
  const writing = useRef(new Set<string>());
  const writingControllers = useRef(new Map<string, AbortController>());
  const activeDialog = useRef<{ kind: "receiver" | "afterSales"; order: BusinessSalesOrderMetadataOrder } | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(rows.map(order => [orderKey(order), { state: "loading" }])));
  const effectGeneration = useRef(0);
  const [dialog, setDialog] = useState<{ kind: "receiver" | "afterSales"; order: BusinessSalesOrderMetadataOrder } | null>(null);
  const openCallback = useRef(onDialogOpenChange);
  openCallback.current = onDialogOpenChange;
  const assertCurrent = (order: BusinessSalesOrderMetadataOrder, write = false) => {
    if (!live.current || !client || !guard.current.ready ||
        (write && !guard.current.canWrite) || !known.current.has(orderKey(order)) ||
        !validOrder(order, guard.current.customerId)) throw abortError();
  };
  const load = async (order: BusinessSalesOrderMetadataOrder, verifyOrder = true) => {
    assertCurrent(order);
    const key = orderKey(order);
    reading.current.get(key)?.abort();
    const controller = new AbortController();
    controllers.current.add(controller);
    reading.current.set(key, controller);
    setEntries(current => ({ ...current, [key]: { state: "loading", data: current[key]?.data } }));
    try {
      if (verifyOrder) {
        const original = await client!.crmSalesOrder.get.query(orderInput(order, customerId), { signal: controller.signal });
        assertCurrent(order);
        if (controller.signal.aborted) throw abortError();
        assertBusinessSalesOrderMetadataOrder(order, original, customerId);
      }
      const result = await client!.crmSalesOrder.metadataGet.query(orderInput(order, customerId), { signal: controller.signal });
      assertCurrent(order);
      if (controller.signal.aborted) throw abortError();
      const data = parseMetadata(order, result, merchantId!, customerId);
      setEntries(current => ({ ...current, [key]: { state: "ready", data } }));
      return data;
    } catch (error) {
      if (live.current && !controller.signal.aborted && !isAbort(error)) {
        onAuthorizationError(error);
        setEntries(current => ({ ...current, [key]: { state: "error", error: errorMessage(error), data: current[key]?.data } }));
      }
      throw error;
    } finally {
      controllers.current.delete(controller);
      if (reading.current.get(key) === controller) reading.current.delete(key);
    }
  };
  const write = async (order: BusinessSalesOrderMetadataOrder, command: WriteCommand) => {
    assertCurrent(order, true);
    const key = orderKey(order);
    if (writing.current.has(key)) throw new Error("当前订单元数据正在保存，请稍候");
    const expected = orderInput(order, customerId);
    if (command.input.id !== expected.id || command.input.customerId !== expected.customerId)
      throw new Error("保存订单范围不一致，请重新打开记录");
    const controller = new AbortController();
    controllers.current.add(controller);
    writing.current.add(key);
    writingControllers.current.set(key, controller);
    try {
      const original = await client!.crmSalesOrder.get.query(expected, { signal: controller.signal });
      assertCurrent(order, true);
      if (controller.signal.aborted) throw abortError();
      assertBusinessSalesOrderMetadataOrder(order, original, customerId);
      // Check the exact active tuple and write grant again immediately before submission.
      assertCurrent(order, true);
      switch (command.method) {
        case "saveReceiver":
          await client!.crmSalesOrder.saveReceiver.mutate(command.input, { signal: controller.signal }); break;
        case "addAfterSale":
          await client!.crmSalesOrder.addAfterSale.mutate(command.input, { signal: controller.signal }); break;
        case "updateAfterSale":
          await client!.crmSalesOrder.updateAfterSale.mutate(command.input, { signal: controller.signal }); break;
      }
      assertCurrent(order, true);
      if (controller.signal.aborted) throw abortError();
      // No order CRUD invalidation, payment, shipment, refund or stock execution.
      return await load(order, false);
    } catch (error) {
      if (live.current && !controller.signal.aborted && !isAbort(error)) onAuthorizationError(error);
      throw error;
    } finally {
      controllers.current.delete(controller);
      writing.current.delete(key);
      if (writingControllers.current.get(key) === controller) writingControllers.current.delete(key);
    }
  };
  useEffect(() => {
    live.current = true;
    const generation = ++effectGeneration.current;
    if (client && ready) {
      const pending = Array.from(known.current.values());
      let index = 0;
      const worker = async () => {
        while (live.current && effectGeneration.current === generation && index < pending.length) {
          const order = pending[index++];
          try { await load(order); } catch { /* Explicit per-row error; no fabricated missing state. */ }
        }
      };
      for (let i = 0; i < Math.min(3, pending.length); i++) void worker();
    }
    return () => {
      live.current = false;
      effectGeneration.current++;
      controllers.current.forEach(controller => controller.abort());
      controllers.current.clear();
      reading.current.clear();
      if (dialogOpen.current) openCallback.current?.(false);
      dialogOpen.current = false;
    };
    // Session is remounted for any scope/tuple change; no hidden stale cache survives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dialogOpen = useRef(false);
  const close = () => {
    if (activeDialog.current) writingControllers.current.get(orderKey(activeDialog.current.order))?.abort();
    activeDialog.current = null;
    setDialog(null);
    dialogOpen.current = false;
    openCallback.current?.(false);
  };
  const context: MetadataContextValue = {
    ready, canWrite: ready && canWrite, customerId,
    entry: order => ready && known.current.has(orderKey(order)) ? entries[orderKey(order)] : undefined,
    reload: order => load(order), write,
    open: (kind, order) => {
      try { assertCurrent(order); } catch { return; }
      const previous = activeDialog.current;
      if (previous && (orderKey(previous.order) !== orderKey(order) || previous.kind !== kind)) {
        writingControllers.current.get(orderKey(previous.order))?.abort();
      }
      const next = { kind, order: known.current.get(orderKey(order))! };
      activeDialog.current = next;
      setDialog(next);
      dialogOpen.current = true;
      openCallback.current?.(true);
    },
  };
  const current = dialog && context.entry(dialog.order);
  return <MetadataContext.Provider value={context}>
    {children}
    <Dialog open={Boolean(dialog && ready)} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{dialog?.kind === "receiver" ? "订单收货信息" : "订单售后记录"}</DialogTitle>
          <DialogDescription>{dialog?.order.orderNumber} · 独立业务订单记录</DialogDescription>
        </DialogHeader>
        <p role="note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">{BUSINESS_SALES_ORDER_METADATA_NOTICE}</p>
        {current?.data && current.state !== "ready" && <div role="status" className="text-sm text-amber-800">
          {current.state === "error" ? `刷新失败：${current.error}。以下为本次订单先前读取结果，未提交输入仍保留。` : "元数据刷新中，未提交输入仍保留…"}
        </div>}
        {dialog && current?.data ? (
          dialog.kind === "receiver" ?
            <ReceiverEditor key={orderKey(dialog.order)} order={dialog.order} initial={current.data} onClose={close} /> :
            <AfterSaleEditor key={orderKey(dialog.order)} order={dialog.order} data={current.data} onClose={close} />
        ) : dialog && <div className="space-y-3" role="status">
          {current?.state === "error" ? <>
            <p className="text-sm text-red-700">元数据读取失败：{current.error}</p>
            <Button variant="outline" onClick={() => { void context.reload(dialog.order).catch(() => {}); }}>重试读取</Button>
          </> : "元数据读取中…"}
          <Button variant="outline" onClick={close}>关闭</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </MetadataContext.Provider>;
}

function CellState({ context, entry, subject }: { context: MetadataContextValue; entry?: Entry; subject: string }) {
  return <span className={`text-xs ${entry?.state === "error" ? "text-red-700" : "text-muted-foreground"}`}
    title={entry?.state === "error" ? entry.error : undefined} role="status">
    {!context.ready ? "业务范围尚未核验" : entry?.state === "error" ? `${subject}读取失败` : entry ? `${subject}读取中…` : "订单身份尚未核验"}
  </span>;
}
export function BusinessSalesOrderReceiverCell({ order }: { order: BusinessSalesOrderMetadataOrder }) {
  const context = useMetadata();
  const entry = context.entry(order);
  if (entry?.state !== "ready") return <CellState context={context} entry={entry} subject="收货信息" />;
  const receiver = entry.data.receiver;
  if (!receiver) return <span className="text-xs text-muted-foreground">未录入收货信息</span>;
  return <div className="space-y-0.5 text-xs">
    <div className="truncate font-medium text-slate-700" title={[receiver.receiver, receiver.receiverPhone].filter(Boolean).join(" · ")}>
      {receiver.receiver || "收货人未录入"}{receiver.receiverPhone && ` · ${receiver.receiverPhone}`}
    </div>
    <div className="truncate text-[11px] text-muted-foreground" title={receiver.receiverAddress || "地址未录入"}>
      {receiver.receiverAddress || "地址未录入"}
    </div>
  </div>;
}
export function BusinessSalesOrderAfterSaleCell({ order }: { order: BusinessSalesOrderMetadataOrder }) {
  const context = useMetadata();
  const entry = context.entry(order);
  if (entry?.state !== "ready") return <CellState context={context} entry={entry} subject="售后记录" />;
  const afterSales = entry.data.afterSales;
  if (!afterSales.length) return <span className="text-xs text-muted-foreground">未录入售后</span>;
  const latest = [...afterSales].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0];
  return <div className="space-y-0.5 text-xs" title={BUSINESS_SALES_ORDER_METADATA_NOTICE}>
    <div className="font-medium text-slate-700">{afterSales.length} 条售后记录</div>
    <div className="truncate text-[11px] text-muted-foreground">
      {businessSalesOrderAfterSaleKindLabel(latest.kind)} · {BUSINESS_SALES_ORDER_AFTER_SALE_STATUS_LABELS[latest.status]}
    </div>
  </div>;
}
export function BusinessSalesOrderMetadataActionItems({ order, onClose }: {
  order: BusinessSalesOrderMetadataOrder;
  onClose?: () => void;
}) {
  const context = useMetadata();
  const available = context.ready && Boolean(context.entry(order));
  const open = (kind: "receiver" | "afterSales") => { onClose?.(); context.open(kind, order); };
  const className = "rounded px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
  return <>
    <button type="button" className={className} disabled={!available} onClick={() => open("receiver")}>收货信息{!context.canWrite && "（查看）"}</button>
    <button type="button" className={className} disabled={!available} onClick={() => open("afterSales")}>售后记录{!context.canWrite && "（查看）"}</button>
  </>;
}

/** Form state remains mounted through reload/conflict; version refresh is explicit. */
function useSubmission() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const requestId = (payload: unknown) => {
    const key = JSON.stringify(payload);
    let value = requestIds.current.get(key);
    if (!value) { value = newBusinessSalesOrderMetadataRequestId(); requestIds.current.set(key, value); }
    return value;
  };
  const run = async (operation: () => Promise<void>, onSuccess?: () => void) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError("");
    try {
      await operation();
      if (alive.current) { setConflict(false); requestIds.current.clear(); onSuccess?.(); }
    } catch (error) {
      if (alive.current && !isAbort(error)) {
        const conflict = isConflict(error);
        setConflict(conflict);
        setError(conflict ? "记录版本已变化。未提交输入已保留，请点击刷新版本核对后再重试，不会自动覆盖。" : `${errorMessage(error)}。若请求结果未确认，请先核对记录；原样重试会复用请求标识。`);
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { busy, error, conflict, requestId, run, setError, setConflict };
}
function ReceiverEditor({ order, initial, onClose }: {
  order: BusinessSalesOrderMetadataOrder; initial: BusinessSalesOrderMetadataDto; onClose: () => void;
}) {
  const context = useMetadata();
  const [draft, setDraft] = useState(() => ({
    receiver: initial.receiver?.receiver ?? "", receiverPhone: initial.receiver?.receiverPhone ?? "",
    receiverAddress: initial.receiver?.receiverAddress ?? "", note: initial.receiver?.note ?? "",
  }));
  const [version, setVersion] = useState(initial.receiver?.version ?? 0);
  const submission = useSubmission();
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!context.ready || !context.canWrite || submission.conflict) return;
    void submission.run(async () => {
      const payload = { ...orderInput(order, context.customerId), ...draft, version };
      const input = businessSalesOrderSaveReceiverSchema.parse({ ...payload, requestId: submission.requestId(payload) });
      await context.write(order, { method: "saveReceiver", input });
    }, onClose);
  };
  const refresh = () => { void submission.run(async () => {
    const fresh = await context.reload(order);
    setVersion(fresh.receiver?.version ?? 0);
  }, () => submission.setError("最新版本已读取，未提交输入仍保留，请核对后保存。")); };
  const readOnly = !context.canWrite;
  return <form className="space-y-4" onSubmit={save}>
    {readOnly && <p className="text-sm text-muted-foreground">当前为只读，只可查看独立收货信息。</p>}
    <label className="block space-y-1 text-sm">收货人
      <Input aria-label="收货人" maxLength={64} value={draft.receiver} readOnly={readOnly} disabled={submission.busy}
        onChange={event => setDraft(value => ({ ...value, receiver: event.target.value }))} />
    </label>
    <label className="block space-y-1 text-sm">收货电话
      <Input aria-label="收货电话" maxLength={40} value={draft.receiverPhone} readOnly={readOnly} disabled={submission.busy}
        onChange={event => setDraft(value => ({ ...value, receiverPhone: event.target.value }))} />
    </label>
    <label className="block space-y-1 text-sm">收货地址
      <Textarea aria-label="收货地址" maxLength={500} value={draft.receiverAddress} readOnly={readOnly} disabled={submission.busy}
        onChange={event => setDraft(value => ({ ...value, receiverAddress: event.target.value }))} />
    </label>
    <label className="block space-y-1 text-sm">备注
      <Textarea aria-label="收货备注" maxLength={500} value={draft.note} readOnly={readOnly} disabled={submission.busy}
        onChange={event => setDraft(value => ({ ...value, note: event.target.value }))} />
    </label>
    {submission.error && <p role="alert" className="text-sm text-red-700">{submission.error}</p>}
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose} disabled={submission.busy}>关闭</Button>
      {submission.conflict && !readOnly && <Button type="button" variant="outline" disabled={submission.busy} onClick={refresh}>刷新版本（保留输入）</Button>}
      {!readOnly && <Button type="submit" disabled={submission.busy || submission.conflict}>{submission.busy ? "保存中…" : "保存收货信息"}</Button>}
    </DialogFooter>
  </form>;
}
function AfterSaleEditor({ order, data, onClose }: {
  order: BusinessSalesOrderMetadataOrder; data: BusinessSalesOrderMetadataDto; onClose: () => void;
}) {
  const context = useMetadata();
  const [kind, setKind] = useState<BusinessAfterSaleKind>("consultation");
  const [reason, setReason] = useState("");
  const submission = useSubmission();
  const [message, setMessage] = useState("");
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!context.ready || !context.canWrite) return;
    void submission.run(async () => {
      const payload = { ...orderInput(order, context.customerId), kind, reason };
      const input = businessSalesOrderAddAfterSaleSchema.parse({ ...payload, requestId: submission.requestId(payload) });
      await context.write(order, { method: "addAfterSale", input });
    }, () => { setReason(""); setMessage("售后记录已登记，未执行退款或退库。"); });
  };
  return <div className="space-y-4">
    <div className="space-y-3" aria-label="现有售后记录">
      {data.afterSales.length ? [...data.afterSales].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
        .map(record => <AfterSaleRecord key={record.id} order={order} record={record} />) :
        <p className="text-sm text-muted-foreground">未录入售后。没有历史记录时不推测退款状态。</p>}
    </div>
    {context.canWrite ? <form className="space-y-3 border-t border-slate-200 pt-4" onSubmit={add}>
      <h3 className="text-sm font-semibold">登记售后申请/跟进</h3>
      <label className="block space-y-1 text-sm">售后类型
        <select aria-label="售后类型" className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" value={kind} disabled={submission.busy}
          onChange={event => setKind(event.target.value as BusinessAfterSaleKind)}>
          {BUSINESS_AFTER_SALE_KINDS.map(value => <option key={value} value={value}>{businessSalesOrderAfterSaleKindLabel(value)}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">原因/申请说明
        <Textarea aria-label="售后原因" required maxLength={500} value={reason} disabled={submission.busy} onChange={event => setReason(event.target.value)} />
      </label>
      {submission.error && <p role="alert" className="text-sm text-red-700">{submission.error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      <Button type="submit" disabled={submission.busy}>{submission.busy ? "登记中…" : "登记售后记录"}</Button>
    </form> : <p className="text-sm text-muted-foreground">当前为只读，不能登记或更新售后记录。</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={submission.busy} onClick={onClose}>关闭</Button></DialogFooter>
  </div>;
}
function formatMetadataTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
function AfterSaleRecord({ order, record }: { order: BusinessSalesOrderMetadataOrder; record: BusinessSalesOrderAfterSaleDto }) {
  const context = useMetadata();
  const [status, setStatus] = useState<BusinessAfterSaleStatus>(record.status);
  const [resolution, setResolution] = useState(record.resolution);
  const [version, setVersion] = useState(record.version);
  const [message, setMessage] = useState("");
  const submission = useSubmission();
  // Do not derive an unsaved draft/version from newly fetched props.
  const update = (event: FormEvent) => {
    event.preventDefault();
    if (!context.ready || !context.canWrite || submission.conflict) return;
    void submission.run(async () => {
      const payload = { ...orderInput(order, context.customerId), caseId: record.id, version, status, resolution };
      const input = businessSalesOrderUpdateAfterSaleSchema.parse({ ...payload, requestId: submission.requestId(payload) });
      const fresh = await context.write(order, { method: "updateAfterSale", input });
      // A post-save read supplies the new version; no blind version increment.
      const updated = fresh.afterSales.find(item => item.id === record.id);
      if (!updated) throw new Error("售后记录读取不完整，请刷新核对");
      setVersion(updated.version);
    }, () => setMessage("记录已更新，不代表退款或退库完成。"));
  };
  const refresh = () => { void submission.run(async () => {
    const fresh = await context.reload(order);
    const current = fresh.afterSales.find(item => item.id === record.id);
    if (!current) throw new Error("售后记录已不可用，请重新打开订单");
    setVersion(current.version);
  }, () => submission.setError("最新版本已读取，未提交状态和跟进说明已保留，请核对后重试。")); };
  return <form className="space-y-2 rounded-md border border-slate-200 p-3" onSubmit={update} aria-label={`售后记录 ${record.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <strong>{businessSalesOrderAfterSaleKindLabel(record.kind)}</strong>
      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{BUSINESS_SALES_ORDER_AFTER_SALE_STATUS_LABELS[record.status]}</span>
    </div>
    <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{record.reason}</p>
    <p className="text-xs text-muted-foreground">登记 {formatMetadataTime(record.createdAt)} · 更新 {formatMetadataTime(record.updatedAt)}</p>
    {context.canWrite ? <>
      <label className="block space-y-1 text-sm">记录状态
        <select aria-label={`记录 ${record.id} 状态`} value={status} disabled={submission.busy}
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
          onChange={event => setStatus(event.target.value as BusinessAfterSaleStatus)}>
          {(Object.keys(BUSINESS_SALES_ORDER_AFTER_SALE_STATUS_LABELS) as BusinessAfterSaleStatus[]).map(value =>
            <option key={value} value={value}>{BUSINESS_SALES_ORDER_AFTER_SALE_STATUS_LABELS[value]}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">跟进/结案说明
        <Textarea aria-label={`记录 ${record.id} 跟进说明`} maxLength={500} value={resolution} disabled={submission.busy}
          onChange={event => setResolution(event.target.value)} />
      </label>
      {submission.error && <p role="alert" className="text-sm text-red-700">{submission.error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      <div className="flex flex-wrap gap-2">
        {submission.conflict && <Button type="button" variant="outline" disabled={submission.busy} onClick={refresh}>刷新版本（保留输入）</Button>}
        <Button type="submit" variant="outline" disabled={submission.busy || submission.conflict}>{submission.busy ? "更新中…" : "更新售后记录"}</Button>
      </div>
    </> : <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">跟进说明：{record.resolution || "未录入"}</p>}
  </form>;
}

/** Export callers must snapshot the verified scope and abort on any identity change.
 * Caller MUST reject the complete export if any reader fails; never emit partial files. */
export type BusinessSalesOrderMetadataExportScope = {
  ready: boolean;
  identityKey: string | number | null;
  merchantId: number;
  customerId?: number;
  isCurrent: () => boolean;
  onAuthorizationError?: (error: unknown) => void;
};
export async function getMetadataForExport(
  order: BusinessSalesOrderMetadataOrder,
  scope: BusinessSalesOrderMetadataExportScope,
  signal: AbortSignal,
): Promise<BusinessSalesOrderMetadataDto> {
  const snapshot = { ...scope };
  const orderSnapshot = { ...order };
  const assert = () => {
    if (!snapshot.ready || !validIdentity(snapshot.identityKey) ||
        !Number.isSafeInteger(snapshot.merchantId) || snapshot.merchantId <= 0 ||
        !validOrder(orderSnapshot, snapshot.customerId) || signal.aborted || !snapshot.isCurrent()) throw abortError();
  };
  assert();
  const client: NativeClient = createBusinessScopeTrpcClient(snapshot.merchantId);
  try {
    const original = await client.crmSalesOrder.get.query(orderInput(orderSnapshot, snapshot.customerId), { signal });
    assert();
    assertBusinessSalesOrderMetadataOrder(orderSnapshot, original, snapshot.customerId);
    const result = await client.crmSalesOrder.metadataGet.query(orderInput(orderSnapshot, snapshot.customerId), { signal });
    assert();
    return parseMetadata(orderSnapshot, result, snapshot.merchantId, snapshot.customerId);
  } catch (error) {
    if (!signal.aborted && !isAbort(error) && snapshot.isCurrent()) snapshot.onAuthorizationError?.(error);
    throw error;
  }
}

/** Matches BusinessSalesOrderRowSlots.readExportMetadata. No visible-page cache,
 * no partial Map on any failure, no file generation, and sibling reads abort. */
export function createBusinessSalesOrderMetadataExportReader(
  scope: BusinessSalesOrderMetadataExportScope,
): BusinessOrderExportMetadataReader {
  const snapshot = { ...scope };
  return async (rows, guard) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (guard.signal.aborted) onAbort();
    else guard.signal.addEventListener("abort", onAbort, { once: true });
    const current = () => !controller.signal.aborted && guard.isCurrent() && snapshot.isCurrent();
    const scoped = { ...snapshot, isCurrent: current };
    const result = new Map<number, BusinessOrderExportMetadata>();
    let cursor = 0;
    let failed = false;
    const worker = async () => {
      while (!failed && cursor < rows.length) {
        if (!current()) throw abortError();
        const order = rows[cursor++];
        try {
          const data = await getMetadataForExport(order, scoped, controller.signal);
          if (!current()) throw abortError();
          if (result.has(order.id)) throw new Error("导出订单重复，未生成文件");
          result.set(order.id, {
            receiver: data.receiver ? data.receiver.receiver || "收货人未录入" : "未录入收货信息",
            receiverPhone: data.receiver?.receiverPhone || "电话未录入",
            receiverAddress: data.receiver?.receiverAddress || "地址未录入",
            afterSales: data.afterSales.length ? [...data.afterSales]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
              .map(record => `${businessSalesOrderAfterSaleKindLabel(record.kind)} · ${BUSINESS_SALES_ORDER_AFTER_SALE_STATUS_LABELS[record.status]}：${record.reason}${record.resolution ? `（跟进：${record.resolution}）` : ""}`)
              .join("；") : "无售后记录",
          });
        } catch (error) {
          failed = true;
          controller.abort();
          throw error;
        }
      }
    };
    try {
      if (!snapshot.ready || !validIdentity(snapshot.identityKey) || !current()) throw abortError();
      await Promise.all(Array.from({ length: Math.min(3, rows.length) }, worker));
      if (!current() || result.size !== rows.length) throw abortError();
      return result;
    } finally {
      guard.signal.removeEventListener("abort", onAbort);
      controller.abort();
    }
  };
}
