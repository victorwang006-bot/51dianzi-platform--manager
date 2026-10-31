import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Package,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { formatBeijingDateTime } from "../../../shared/beijingTime";

type HandoffKind = "inquiry" | "inventory";
type HandoffScope = "enterprise" | "selected";

type PreviewInventory = {
  id: number;
  partNumber: string;
  brand: string | null;
  quantity: number;
  ownerUserId: number | null;
  ownerName: string | null;
  inquiryUserId: number | null;
  inquiryName: string | null;
  pendingCount: number;
};

type HandoffCandidate = {
  userId: number;
  displayName: string;
  phone: string | null;
  eligible: boolean;
  unavailableReason: string | null;
  hasInquiryPermission: boolean;
  hasInventoryPermission: boolean;
};

function createRequestId(prefix: string) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id}`.slice(0, 64);
}

function selectionKey(ids: number[]) {
  return [...ids].sort((left, right) => left - right).join(",");
}

/** Exported so behavior that protects confirmation payloads has a small, deterministic unit-test seam. */
export function canConfirmBusinessHandoff({
  scope,
  selectedCount,
  targetEligible,
  transferFuture,
  transferPending,
  revision,
  previewLoading,
  limitsExceeded,
}: {
  scope: HandoffScope;
  selectedCount: number;
  targetEligible: boolean;
  transferFuture: boolean;
  transferPending: boolean;
  revision?: string;
  previewLoading: boolean;
  limitsExceeded: boolean;
}) {
  if (previewLoading || !revision || limitsExceeded || !targetEligible) return false;
  if (selectedCount === 0) return false;
  return transferFuture || transferPending;
}

export function buildBusinessHandoffPayload({
  kind,
  scope,
  inventoryIds,
  nextUserId,
  transferFuture,
  transferPending,
  requestId,
  expectedRevision,
}: {
  kind: HandoffKind;
  scope: HandoffScope;
  inventoryIds: number[];
  nextUserId: number;
  transferFuture: boolean;
  transferPending: boolean;
  requestId: string;
  expectedRevision: string;
}) {
  return {
    kind,
    scope,
    ...(scope === "selected" ? { inventoryIds: [...inventoryIds].sort((left, right) => left - right) } : {}),
    nextUserId,
    transferFuture,
    transferPending,
    requestId,
    expectedRevision,
  };
}

export function requestIdForBusinessHandoff(cache: Map<string, string>, payload: Omit<ReturnType<typeof buildBusinessHandoffPayload>, "requestId">) {
  const payloadKey = JSON.stringify(payload);
  const existing = cache.get(payloadKey);
  if (existing) return existing;
  const next = createRequestId("enterprise-business-handoff");
  cache.set(payloadKey, next);
  return next;
}

function candidateReason(candidate: HandoffCandidate, kind: HandoffKind, transferPending: boolean) {
  if (!candidate.eligible) return candidate.unavailableReason || "该成员当前不可接收业务";
  if (kind === "inquiry" && !candidate.hasInquiryPermission) {
    return "未获授“询价接待”权限，请在成员管理中明确授予";
  }
  if (kind === "inventory" && !candidate.hasInventoryPermission) {
    return "未获授库存管理权限，请在成员管理中明确授予";
  }
  if (kind === "inventory" && transferPending && !candidate.hasInquiryPermission) {
    return "带走未结询价还需“询价接待”权限，请在成员管理中明确授予";
  }
  return null;
}

function HandOffDialog({
  kind,
  open,
  onOpenChange,
}: {
  kind: HandoffKind | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<HandoffScope>("enterprise");
  const [inventoryIds, setInventoryIds] = useState<number[]>([]);
  const [nextUserId, setNextUserId] = useState<number | null>(null);
  const [transferFuture, setTransferFuture] = useState(true);
  const [transferPending, setTransferPending] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(100);
  const [submitLocked, setSubmitLocked] = useState(false);
  const submitLockRef = useRef(false);
  const requestIdsRef = useRef(new Map<string, string>());

  const normalizedInventoryIds = useMemo(() => Array.from(new Set(inventoryIds)).sort((left, right) => left - right), [inventoryIds]);
  const previewInput = useMemo(() => kind ? {
    kind,
    scope,
    ...(scope === "selected" ? { inventoryIds: normalizedInventoryIds } : {}),
  } : null, [kind, normalizedInventoryIds, scope]);
  const previewQuery = trpc.enterprise.businessHandoffPreview.useQuery(previewInput!, {
    enabled: open && Boolean(previewInput),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const handoffMutation = trpc.enterprise.businessHandoff.useMutation();

  useEffect(() => {
    if (!open || !kind) return;
    setScope("enterprise");
    setInventoryIds([]);
    setNextUserId(null);
    setTransferFuture(kind === "inquiry");
    setTransferPending(false);
    setKeyword("");
    setVisibleLimit(100);
    setSubmitLocked(false);
    submitLockRef.current = false;
  }, [kind, open]);

  const preview = previewQuery.data;
  const inventories = (preview?.inventories ?? []) as PreviewInventory[];
  const candidates = (preview?.candidates ?? []) as HandoffCandidate[];
  const limitsExceeded = Boolean(preview?.limits?.exceeded);
  const selectedCandidate = candidates.find(candidate => candidate.userId === nextUserId) ?? null;
  const selectedCandidateReason = selectedCandidate && kind
    ? candidateReason(selectedCandidate, kind, transferPending)
    : "请选择可接收业务的企业成员";
  const targetEligible = Boolean(selectedCandidate && !selectedCandidateReason);
  const previewLoading = previewQuery.isLoading || previewQuery.isFetching;
  const selectedCount = scope === "enterprise" ? (preview?.inventoryCount ?? 0) : normalizedInventoryIds.length;
  const canConfirm = Boolean(kind) && canConfirmBusinessHandoff({
    scope,
    selectedCount,
    targetEligible,
    transferFuture,
    transferPending,
    revision: preview?.revision,
    previewLoading,
    limitsExceeded,
  }) && !submitLocked && !handoffMutation.isPending;

  const filteredInventories = useMemo(() => {
    const needle = keyword.trim().toLocaleLowerCase();
    if (!needle) return inventories;
    return inventories.filter(inventory => [inventory.partNumber, inventory.brand, inventory.ownerName, inventory.inquiryName]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle));
  }, [inventories, keyword]);
  const visibleInventories = filteredInventories.slice(0, visibleLimit);

  const updateScope = (nextScope: HandoffScope) => {
    setScope(nextScope);
    setVisibleLimit(100);
  };
  const toggleInventory = (inventoryId: number, checked: boolean) => {
    setInventoryIds(previous => {
      if (!checked) return previous.filter(id => id !== inventoryId);
      if (previous.includes(inventoryId)) return previous;
      if (previous.length >= 500) {
        toast.error("指定库存最多可选择 500 条");
        return previous;
      }
      return [...previous, inventoryId];
    });
  };
  const selectFiltered = () => {
    const candidatesToAdd = filteredInventories
      .map(inventory => inventory.id)
      .filter(id => !normalizedInventoryIds.includes(id));
    const remaining = Math.max(0, 500 - normalizedInventoryIds.length);
    if (!remaining) {
      toast.error("指定库存最多可选择 500 条");
      return;
    }
    setInventoryIds(previous => [...previous, ...candidatesToAdd.slice(0, remaining)]);
    if (candidatesToAdd.length > remaining) toast.info("已按安全上限选择前 500 条库存");
  };

  const submit = async () => {
    if (!kind || !preview || !canConfirm || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitLocked(true);
    const requestInput = {
      kind,
      scope,
      ...(scope === "selected" ? { inventoryIds: normalizedInventoryIds } : {}),
      nextUserId: nextUserId!,
      transferFuture,
      transferPending,
      expectedRevision: preview.revision,
    };
    const requestId = requestIdForBusinessHandoff(requestIdsRef.current, requestInput);
    const payload = buildBusinessHandoffPayload({
      kind,
      scope,
      inventoryIds: normalizedInventoryIds,
      nextUserId: nextUserId!,
      transferFuture,
      transferPending,
      requestId,
      expectedRevision: preview.revision,
    });
    try {
      const result = await handoffMutation.mutateAsync(payload);
      toast.success(result.idempotent ? "交接已确认" : "业务交接已完成", {
        description: `已更新 ${result.inventoryCount} 条库存、${result.inquiryCount} 条询价及 ${result.routingCount} 条后续分工。`,
      });
      await Promise.allSettled([
        utils.enterprise.me.invalidate(),
        utils.enterprise.members.invalidate(),
        utils.enterprise.businessHandoffPreview.invalidate(),
        utils.enterprise.businessHandoffState.invalidate(),
        utils.enterprise.inquiryInbox.invalidate(),
        utils.inventory.listPaged.invalidate(),
      ]);
      onOpenChange(false);
    } catch (error) {
      toast.error("交接未完成", {
        description: error instanceof Error ? error.message : "网络或数据已变化，请使用原确认按钮重试。",
      });
    } finally {
      submitLockRef.current = false;
      setSubmitLocked(false);
    }
  };

  const title = kind === "inquiry" ? "转交询价" : "转交库存";
  const recipientLabel = kind === "inquiry" ? "询价接待人" : "库存业务负责人";
  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!submitLocked) onOpenChange(nextOpen); }}>
      <DialogContent style={{ width: "calc(100vw - 24px)", maxWidth: 640, maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }} className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[560px] flex-col gap-0 overflow-hidden border-[#e1e7ee] p-0 sm:w-full" aria-describedby="enterprise-business-handoff-description" data-enterprise-business-handoff-dialog>
        <DialogHeader className="shrink-0 border-b border-[#edf1f5] px-5 pb-4 pt-5 pr-12">
          <DialogTitle className="text-[18px] font-semibold text-[#233548]">{title}</DialogTitle>
          <DialogDescription id="enterprise-business-handoff-description" className="mt-1 text-[12px] leading-5 text-[#7a8998]">
            {kind === "inquiry" ? "只变更询价接待分工，不改变库存管理和企业所有权。" : "只变更库存业务负责人，企业所有权和未来询价分工保持不变。"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-5">
            <section>
              <label htmlFor="business-handoff-target" className="mb-2 block text-[13px] font-medium text-[#233548]">{recipientLabel}<span className="text-red-600"> *</span></label>
              <select id="business-handoff-target" className="crm-input h-10 w-full bg-white px-3 text-[13px]" value={nextUserId ?? ""} onChange={event => setNextUserId(event.target.value ? Number(event.target.value) : null)} disabled={previewLoading || !kind}>
                <option value="">请选择企业成员</option>
                {candidates.map(candidate => {
                  const reason = kind ? candidateReason(candidate, kind, transferPending) : null;
                  return <option key={candidate.userId} value={candidate.userId} disabled={Boolean(reason)}>{candidate.displayName}{candidate.phone ? ` · ${candidate.phone}` : ""}{reason ? `（${reason}）` : ""}</option>;
                })}
              </select>
              {nextUserId ? <p className={`mt-2 flex items-start gap-1.5 text-[12px] ${targetEligible ? "text-[#668075]" : "text-[#a35757]"}`}>
                {targetEligible ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
                <span>{targetEligible ? (kind === "inquiry" ? "该成员已具备询价接待权限；本次不会增加库存编辑权限。" : "该成员已具备库存管理权限；本次不会改变企业所有者。") : selectedCandidateReason}</span>
              </p> : null}
              {!previewLoading && candidates.length === 0 ? <p className="mt-2 text-[12px] text-[#a35757]">暂无可接收业务的正常企业成员。请先在原成员管理中邀请、启用并明确授予相应权限。</p> : null}
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-medium text-[#233548]">适用库存</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-3 text-[13px] ${scope === "enterprise" ? "border-[#6993b9] bg-[#f5f9fe] text-[#185fa5]" : "border-[#e1e7ee] text-[#526273]"}`}>
                  <input type="radio" name="enterprise-business-handoff-scope" checked={scope === "enterprise"} onChange={() => updateScope("enterprise")} />
                  <span>全企业库存</span>
                  <span className="ml-auto text-[11px] text-[#7a8998]">{preview?.inventoryCount ?? "—"} 条</span>
                </label>
                <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-3 text-[13px] ${scope === "selected" ? "border-[#6993b9] bg-[#f5f9fe] text-[#185fa5]" : "border-[#e1e7ee] text-[#526273]"}`}>
                  <input type="radio" name="enterprise-business-handoff-scope" checked={scope === "selected"} onChange={() => updateScope("selected")} />
                  <span>指定库存</span>
                  {scope === "selected" ? <span className="ml-auto text-[11px] text-[#7a8998]">已选 {normalizedInventoryIds.length}/500</span> : null}
                </label>
              </div>
              {scope === "selected" ? <div className="mt-3 overflow-hidden rounded-md border border-[#e3eaf2]">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#edf1f5] bg-[#fafcff] px-3 py-2">
                  <label className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#7a8998]" /><input className="crm-input h-8 w-full pl-8 pr-2 text-[12px]" value={keyword} onChange={event => { setKeyword(event.target.value); setVisibleLimit(100); }} placeholder="筛选型号、品牌或负责人" aria-label="筛选库存" /></label>
                  <button type="button" className="text-[12px] text-[#185fa5] hover:underline" onClick={selectFiltered} disabled={!filteredInventories.length}>选择筛选结果（最多500条）</button>
                  <button type="button" className="text-[12px] text-[#667788] hover:text-[#185fa5]" onClick={() => setInventoryIds([])} disabled={!normalizedInventoryIds.length}>清空</button>
                </div>
                <div className="max-h-64 overflow-y-auto px-3">
                  {visibleInventories.map(inventory => <label key={inventory.id} className="flex cursor-pointer items-center gap-2 border-b border-[#edf1f5] py-2.5 last:border-0">
                    <input type="checkbox" checked={normalizedInventoryIds.includes(inventory.id)} onChange={event => toggleInventory(inventory.id, event.target.checked)} disabled={!normalizedInventoryIds.includes(inventory.id) && normalizedInventoryIds.length >= 500} aria-label={`${inventory.partNumber} ${inventory.brand || ""}`} />
                    <span className="min-w-0 flex-1"><strong className="block truncate text-[12px] font-medium text-[#233548]">{inventory.partNumber}</strong><span className="mt-0.5 block truncate text-[11px] text-[#7a8998]">{inventory.brand || "—"} · 库存 {inventory.quantity} · 库存负责人 {inventory.ownerName || "待分配"}</span></span>
                    <small className="shrink-0 text-[11px] text-[#7a8998]">{inventory.pendingCount} 条未结</small>
                  </label>)}
                  {!previewLoading && !visibleInventories.length ? <p className="py-6 text-center text-[12px] text-[#7a8998]">没有匹配的真实库存。</p> : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf1f5] px-3 py-2 text-[11px] text-[#7a8998]">
                  <span>共 {inventories.length} 条库存；当前显示 {visibleInventories.length}/{filteredInventories.length} 条，未显示的库存不会被省略到本次选择中。</span>
                  {visibleLimit < filteredInventories.length ? <button type="button" className="shrink-0 text-[#185fa5] hover:underline" onClick={() => setVisibleLimit(limit => limit + 100)}>显示更多</button> : null}
                </div>
              </div> : <p className="mt-2 text-[12px] leading-5 text-[#7a8998]">本次按全企业范围核对真实库存；如只需部分库存，请切换为“指定库存”。</p>}
              {scope === "selected" && normalizedInventoryIds.length === 0 ? <p className="mt-2 text-[12px] text-[#a35757]">请至少选择一条库存。</p> : null}
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-medium text-[#233548]">{kind === "inquiry" ? "交接范围" : "询价处理"}</h3>
              <div className="space-y-3">
                {kind === "inquiry" ? <label className="flex cursor-pointer items-start gap-2.5"><input className="mt-0.5" type="checkbox" checked={transferFuture} onChange={event => setTransferFuture(event.target.checked)} aria-label="后续新询价交给该同事" /><span><strong className="block text-[13px] font-medium text-[#233548]">后续新询价交给该同事</strong><span className="mt-1 block text-[11px] leading-5 text-[#7a8998]">接收新询价通知并负责回复、报价。</span></span></label> : null}
                <label className="flex cursor-pointer items-start gap-2.5"><input className="mt-0.5" type="checkbox" checked={transferPending} onChange={event => setTransferPending(event.target.checked)} aria-label="同时转交已有未结询价" /><span><strong className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-[#233548]">同时转交已有未结询价{transferPending ? <b className="rounded bg-[#eaf2fc] px-1.5 py-0.5 text-[10px] font-medium text-[#185fa5]">{preview?.pendingInquiryCount ?? 0} 条</b> : null}</strong><span className="mt-1 block text-[11px] leading-5 text-[#7a8998]">{kind === "inquiry" ? "不勾选时，已有询价仍由原负责人处理。" : "不勾选时，库存交接不带走已有询价，后续询价分工也保持不变。"}</span></span></label>
              </div>
              {kind === "inquiry" && !transferFuture && !transferPending ? <p className="mt-2 text-[12px] text-[#a35757]">请至少选择后续新询价或已有未结询价。</p> : null}
              {transferPending ? <p className="mt-3 rounded-md bg-[#f5f8fc] px-3 py-2 text-[11px] leading-5 text-[#687e96]">将转交 {preview?.pendingInquiryCount ?? 0} 条未结询价。客户会收到接待人变更提示；仅提供必要业务摘要，不复制原私人聊天。</p> : null}
            </section>

            {limitsExceeded ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-700">当前库存范围超过安全上限，不能部分执行。请缩小指定库存范围后重新核对。</p> : null}
            {previewQuery.isError ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-700">无法核对最新业务分工：{previewQuery.error.message}。请重试后确认。</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf1f5] pt-3 text-[12px]">
              <span className="text-[#7a8998]">{kind === "inquiry" ? "询价接待" : "库存负责人"}</span>
              <strong className="font-medium text-[#185fa5]">{selectedCandidate?.displayName || "待选择"}</strong>
              <small className="basis-full text-[11px] text-[#7a8998]">企业所有者保持不变。{previewLoading ? "正在重新核对最新库存和权限…" : "确认前会使用本次核对的最新版本。"}</small>
            </div>
          </div>
        </div>
        <DialogFooter className="flex shrink-0 flex-row items-center justify-end gap-2 border-t border-[#edf1f5] bg-white px-5 py-3 sm:justify-between">
          <span className="mr-auto hidden text-[11px] text-[#7a8998] sm:block">变更仅应用于本次确认的业务范围。</span>
          <button type="button" className="crm-btn h-9" onClick={() => onOpenChange(false)} disabled={submitLocked || handoffMutation.isPending}>取消</button>
          <button type="button" className="crm-btn crm-btn-primary h-9 min-w-[92px]" onClick={() => void submit()} disabled={!canConfirm}>{submitLocked || handoffMutation.isPending ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3.5 animate-spin" />提交中…</span> : "确认转交"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EnterpriseBusinessHandoffMenu({
  isOwner,
  onOwnerTransfer,
}: {
  isOwner: boolean;
  onOwnerTransfer: () => void;
}) {
  const [kind, setKind] = useState<HandoffKind | null>(null);
  if (!isOwner) return null;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="crm-btn inline-flex h-8 w-[104px] min-w-[104px] items-center justify-center gap-2 whitespace-nowrap border-[#b9cde0] bg-white px-3 py-0 text-[12px] font-medium text-[#285b89] hover:border-[#7d9fbe] hover:bg-[#f1f6fc] hover:text-[#185fa5]" aria-label="业务交接菜单" data-enterprise-business-handoff-trigger style={{ width: 104, height: 32, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px" }}>
          <span>业务交接</span><ChevronDown className="size-[13px] shrink-0 text-[#6685a3]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={7} className="w-60 border-[#e0e6ee] p-1.5 shadow-lg" data-enterprise-business-handoff-menu>
        <DropdownMenuItem className="gap-3 px-2.5 py-2" onSelect={() => setKind("inquiry")}><MessageSquare className="size-4 text-[#406896]" /><span><strong className="block text-[13px] font-medium text-[#233548]">转交询价</strong><small className="mt-0.5 block text-[11px] text-[#8795a4]">同事接待，库存管理不变</small></span></DropdownMenuItem>
        <DropdownMenuItem className="gap-3 px-2.5 py-2" onSelect={() => setKind("inventory")}><Package className="size-4 text-[#406896]" /><span><strong className="block text-[13px] font-medium text-[#233548]">转交库存</strong><small className="mt-0.5 block text-[11px] text-[#8795a4]">交接库存业务负责人</small></span></DropdownMenuItem>
        <div role="separator" className="my-1 border-t border-slate-200" />
        <DropdownMenuItem className="gap-3 px-2.5 py-2" onSelect={onOwnerTransfer}><ShieldCheck className="size-4 text-[#406896]" /><span><strong className="block text-[13px] font-medium text-[#233548]">转让企业所有权</strong><small className="mt-0.5 block text-[11px] text-[#8795a4]">移交最高管理权限，需验证</small></span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <HandOffDialog kind={kind} open={kind !== null} onOpenChange={nextOpen => { if (!nextOpen) setKind(null); }} />
  </>;
}

export function EnterpriseBusinessHandoffStatus({ isOwner }: { isOwner: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const stateQuery = trpc.enterprise.businessHandoffState.useQuery(undefined, {
    enabled: isOwner,
    retry: false,
  });
  if (!isOwner) return null;
  const state = stateQuery.data;
  return <>
    <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[#e3eaf2] bg-white px-4 py-3 text-[12px] text-[#667788]" aria-label="当前业务分工" data-enterprise-business-handoff-status>
      <span className="text-[#8795a4]">当前分工</span>
      {stateQuery.isLoading ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />正在加载…</span> : stateQuery.isError ? <span className="text-red-700">当前分工加载失败</span> : <><span>库存管理：<strong className="font-medium text-[#233548]">{state?.inventorySummary || "—"}</strong></span><span>询价接待：<strong className="font-medium text-[#233548]">{state?.inquirySummary || "—"}</strong></span><button type="button" className="text-[#185fa5] hover:underline" onClick={() => setDetailsOpen(true)}>查看分工</button><button type="button" className="text-[#185fa5] hover:underline" onClick={() => setRecordsOpen(true)}>交接记录{state?.records?.length ? ` ${state.records.length}` : ""}</button></>}
    </section>
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
      <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[620px] flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="shrink-0 border-b border-[#edf1f5] px-5 py-4 pr-12"><DialogTitle>当前业务分工</DialogTitle><DialogDescription>以下为企业当前真实库存负责人和询价接待分工。</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {stateQuery.isLoading ? <p className="text-sm text-[#7a8998]">正在加载…</p> : (state?.details?.length ?? 0) === 0 ? <p className="py-8 text-center text-sm text-[#7a8998]">暂无可展示的业务分工。</p> : <div className="grid gap-3">{state?.details?.map(detail => <article key={detail.id} className="rounded-md border border-[#e3eaf2] p-3"><strong className="text-[13px] font-medium text-[#233548]">{detail.partNumber}</strong><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#7a8998]"><span>库存负责人 <b className="ml-1 font-medium text-[#233548]">{detail.ownerName || "待分配"}</b></span><span>询价接待 <b className="ml-1 font-medium text-[#233548]">{detail.inquiryName || "待分配"}</b></span></div></article>)}</div>}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={recordsOpen} onOpenChange={setRecordsOpen}>
      <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[620px] flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="shrink-0 border-b border-[#edf1f5] px-5 py-4 pr-12"><DialogTitle>业务交接记录</DialogTitle><DialogDescription>仅展示已实际提交并完成的企业业务交接。</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {(state?.records?.length ?? 0) === 0 ? <p className="py-8 text-center text-sm text-[#7a8998]">暂无业务交接记录。</p> : <div className="space-y-4">{state?.records?.map(record => <article key={record.requestId} className="border-l-2 border-[#7298bb] pl-3"><strong className="text-[13px] font-medium text-[#233548]">{record.kind === "inquiry" ? "询价交接" : "库存交接"}</strong><p className="mt-1 text-[12px] text-[#526273]">{record.actorName || "企业所有者"} → {record.targetName || "—"} · 库存 {record.inventoryCount} 条 · 询价 {record.inquiryCount} 条 · 后续分工 {record.routingCount} 条</p><small className="mt-1 block text-[11px] text-[#8795a4]">{formatBeijingDateTime(record.createdAt)}</small></article>)}</div>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
