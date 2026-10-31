import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CheckCircle2,
  MessageSquareText,
  Search,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { trpc } from "../../../../api/business-trpc";

export type MemberHandoffMode = "handoff_only" | "handoff_remove";

function createRequestId() {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `member-handoff:${random}`.slice(0, 64);
}

function StepPill({ number, active, done, label }: {
  number: number;
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${active || done ? "text-[#185FA5]" : "text-slate-400"}`}>
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
        active ? "bg-[#185FA5] text-white" : done ? "bg-blue-50 text-[#185FA5]" : "bg-slate-100"
      }`}>
        {done ? "✓" : number}
      </span>
      <span className="truncate text-xs font-medium">{label}</span>
    </div>
  );
}

export default function EnterpriseMemberHandoffSheet({
  open,
  target,
  initialMode,
  selfLeave = false,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  target: { userId: number; displayName: string } | null;
  initialMode: MemberHandoffMode;
  selfLeave?: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => Promise<void> | void;
}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<MemberHandoffMode>(initialMode);
  const [search, setSearch] = useState("");
  const [nextOwnerUserId, setNextOwnerUserId] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState(createRequestId);
  const [isFinalChecking, setIsFinalChecking] = useState(false);
  const submitLockRef = useRef(false);

  const previewQuery = trpc.enterprise.handoffPreview.useQuery(
    { userId: target?.userId ?? 0, mode: initialMode },
    { enabled: open && Boolean(target?.userId), retry: false, refetchOnWindowFocus: false },
  );
  const handoffMutation = trpc.enterprise.handoffMemberBusiness.useMutation({
    onSuccess: async result => {
      toast.success(result.removed ? (selfLeave ? "业务已交接，您已退出企业" : "业务已交接，成员已移除") : "成员业务已完成交接", {
        description: `已交接 ${result.inventoryCount} 条库存、${result.inquiryCount} 条未结询价、${result.customerCount} 个客户`,
      });
      onOpenChange(false);
      await onCompleted();
    },
    onError: error => toast.error("业务交接失败", { description: error.message }),
  });

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMode(initialMode);
    setSearch("");
    setNextOwnerUserId(null);
    setConfirmed(false);
    setRequestId(createRequestId());
    setIsFinalChecking(false);
    submitLockRef.current = false;
    handoffMutation.reset();
  }, [initialMode, open, target?.userId]);

  const preview = previewQuery.data;
  const totalTransferable = (preview?.inventory.total ?? 0) + (preview?.inquiries.total ?? 0) + (preview?.customers.total ?? 0);
  const filteredCandidates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!preview) return [];
    if (!keyword) return preview.candidates;
    return preview.candidates.filter(candidate =>
      candidate.displayName.toLowerCase().includes(keyword)
      || candidate.phone.includes(keyword)
      || String(candidate.userId).includes(keyword),
    );
  }, [preview, search]);
  const selectedCandidate = preview?.candidates.find(candidate => candidate.userId === nextOwnerUserId) ?? null;
  const eligibleCandidateCount = preview?.candidates.filter(candidate => candidate.eligible).length ?? 0;
  const exceedsSafeLimit = preview?.limits.exceeded ?? false;
  const needsAssignee = totalTransferable > 0;
  const canContinueFromAssignee = !needsAssignee || Boolean(selectedCandidate?.eligible);
  const canSubmit = confirmed
    && canContinueFromAssignee
    && !exceedsSafeLimit
    && !(mode === "handoff_only" && totalTransferable === 0)
    && !isFinalChecking
    && !handoffMutation.isPending;

  const changePlan = (next: { mode?: MemberHandoffMode; userId?: number | null }) => {
    if (next.mode) setMode(next.mode);
    if (next.userId !== undefined) setNextOwnerUserId(next.userId);
    handoffMutation.reset();
    setConfirmed(false);
    setRequestId(createRequestId());
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (submitLockRef.current || isFinalChecking || handoffMutation.isPending)) {
      toast.info("业务交接正在执行，请稍候");
      return;
    }
    onOpenChange(nextOpen);
  };
  const continueToNextStep = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }
    const previousRevision = preview?.revision;
    const refreshed = await previewQuery.refetch();
    if (!refreshed.data) {
      toast.error("重新盘点失败", { description: refreshed.error?.message || "请稍后重试" });
      return;
    }
    if (refreshed.data.revision !== previousRevision) {
      setStep(1);
      setConfirmed(false);
      setRequestId(createRequestId());
      toast.info("成员业务集合已变化，请重新核对后继续");
      return;
    }
    const latestCandidate = refreshed.data.candidates.find(candidate => candidate.userId === nextOwnerUserId);
    if (needsAssignee && !latestCandidate?.eligible) {
      setNextOwnerUserId(null);
      setConfirmed(false);
      toast.info("接替人资格已变化，请重新选择");
      return;
    }
    setStep(3);
  };
  const submitHandoff = async () => {
    if (submitLockRef.current || !target || !preview || !canSubmit) return;
    submitLockRef.current = true;
    const submission = {
      targetUserId: target.userId,
      nextOwnerUserId,
      mode,
      requestId,
      confirmedRevision: preview.revision,
    };
    setIsFinalChecking(true);
    try {
      const refreshed = await previewQuery.refetch();
      if (!refreshed.data) {
        toast.error("最终盘点失败", { description: refreshed.error?.message || "请稍后重试" });
        return;
      }
      if (refreshed.data.revision !== submission.confirmedRevision) {
        setStep(1);
        setConfirmed(false);
        setRequestId(createRequestId());
        toast.info("最终提交前发现业务集合已变化，请重新核对");
        return;
      }
      if (refreshed.data.limits.exceeded) {
        setStep(1);
        setConfirmed(false);
        toast.error("当前业务量已超过单次安全上限");
        return;
      }
      const latestTotal = refreshed.data.inventory.total + refreshed.data.inquiries.total + refreshed.data.customers.total;
      const latestCandidate = refreshed.data.candidates.find(candidate => candidate.userId === submission.nextOwnerUserId);
      if (latestTotal > 0 && !latestCandidate?.eligible) {
        setStep(2);
        setNextOwnerUserId(null);
        setConfirmed(false);
        setRequestId(createRequestId());
        toast.info("接替人资格已变化，请重新选择");
        return;
      }
      await handoffMutation.mutateAsync({
        userId: submission.targetUserId,
        nextOwnerUserId: submission.nextOwnerUserId ?? undefined,
        mode: submission.mode,
        requestId: submission.requestId,
        expectedRevision: refreshed.data.revision,
      });
    } catch (error) {
      // mutation 的 onError 会保留抽屉并展示错误；集合变化时主动退回盘点。
      if (error instanceof Error && error.message.includes("业务集合已变化")) {
        setStep(1);
        setConfirmed(false);
        setRequestId(createRequestId());
      }
    } finally {
      submitLockRef.current = false;
      setIsFinalChecking(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full gap-0 border-slate-200 bg-white p-0 sm:max-w-[760px]">
        <SheetHeader className="border-b border-slate-100 px-6 py-5 pr-12">
          <SheetTitle className="text-lg text-slate-900">{selfLeave ? "退出企业业务交接" : "成员业务交接"}</SheetTitle>
          <SheetDescription>
            {target
              ? initialMode === "handoff_remove"
                ? selfLeave
                  ? "盘点并交接当前账号负责的业务后退出企业"
                  : `盘点并交接 ${target.displayName} 当前负责的业务后移出企业`
                : `盘点并交接 ${target.displayName} 当前负责的业务`
              : "选择成员后开始业务交接"}
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-6 py-3">
          <StepPill number={1} active={step === 1} done={step > 1} label="盘点业务" />
          <span className="h-px w-6 bg-slate-200" />
          <StepPill number={2} active={step === 2} done={step > 2} label="指定接替人" />
          <span className="h-px w-6 bg-slate-200" />
          <StepPill number={3} active={step === 3} done={false} label="核对执行" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {previewQuery.isLoading ? (
            <div className="grid min-h-64 place-items-center text-sm text-slate-500">正在盘点成员业务…</div>
          ) : previewQuery.isError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              业务盘点失败：{previewQuery.error.message}
            </div>
          ) : !preview ? null : step === 1 ? (
            <div className="space-y-5" data-member-handoff-step="inventory-preview">
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{preview.target.displayName}</p>
                    <p className="mt-1 text-xs text-slate-500">{preview.target.phone} · 当前状态：{preview.target.status === "active" ? "正常" : "已暂停"}</p>
                  </div>
                  <Badge variant="outline">可自动交接 {totalTransferable} 项</Badge>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Boxes className="size-4 text-[#185FA5]" />库存</div>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{preview.inventory.total}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>待发布 {preview.inventory.draft}</span><span>在售 {preview.inventory.published}</span><span>已下架 {preview.inventory.offshelf}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><MessageSquareText className="size-4 text-[#185FA5]" />未结库存询价</div>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{preview.inquiries.total}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>待回复 {preview.inquiries.open}</span><span>跟进中 {preview.inquiries.replied}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><UserRoundCheck className="size-4 text-[#185FA5]" />客户档案</div>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{preview.customers.total}</p>
                  <p className="mt-3 text-xs text-slate-500">含已归档 {preview.customers.archived} 个；保留历史跟进作者</p>
                </div>
              </div>

              {preview.limits.exceeded ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
                  <p className="font-semibold">本次业务量超过单次安全上限</p>
                  <p className="mt-1">单次最多交接 {preview.limits.inventory} 条库存、{preview.limits.inquiries} 条未结询价和 {preview.limits.customers} 个客户。请联系平台管理员分批处理，系统不会开始不完整的交接。</p>
                </div>
              ) : null}

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">暂不自动转移的业务</p>
                    <div className="mt-2 space-y-2 text-xs leading-5 text-amber-800">
                      {preview.unsupported.map(item => (
                        <p key={item.key}><span className="font-medium">{item.label}：</span>{item.reason}</p>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-amber-800">这些业务不会被改写；后续补齐员工负责人模型后再接入。</p>
                  </div>
                </div>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-5" data-member-handoff-step="assignee">
              {needsAssignee ? (
                <>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">选择统一接替人</h3>
                    <p className="mt-1 text-sm text-slate-500">由同一位正常成员接收本次业务；有库存或询价时需库存权限，有客户时需客户列表 / 客户需求权限。</p>
                  </div>
                  {eligibleCandidateCount === 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                      当前没有可接收全部业务的成员。请按待交接业务核对接替人的库存或客户权限。交接他人客户还需要操作者拥有全部客户管理权限；若候选人是询价采购方，请改选其他成员。
                    </div>
                  ) : null}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="搜索姓名、手机号或用户ID" />
                  </div>
                  <div className="space-y-2">
                    {filteredCandidates.map(candidate => (
                      <button
                        key={candidate.userId}
                        type="button"
                        disabled={!candidate.eligible}
                        onClick={() => changePlan({ userId: candidate.userId })}
                        className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition ${
                          nextOwnerUserId === candidate.userId
                            ? "border-[#185FA5] bg-blue-50/60 ring-1 ring-[#185FA5]"
                            : candidate.eligible
                              ? "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                              : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">{candidate.displayName}</span>
                          <span className="mt-1 block text-xs text-slate-500">{candidate.phone} · 用户ID {candidate.userId}</span>
                          {candidate.unavailableReason ? <span className="mt-1 block text-xs text-red-600">不可选择：{candidate.unavailableReason}</span> : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline">{candidate.role === "super_admin" ? "企业所有者" : "企业成员"}</Badge>
                          {nextOwnerUserId === candidate.userId ? <CheckCircle2 className="size-5 text-[#185FA5]" /> : null}
                        </span>
                      </button>
                    ))}
                    {filteredCandidates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">没有匹配的企业成员</div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
                  {selfLeave ? "当前账号" : "该成员"}没有库存、未结库存询价或客户档案，不需要选择接替人，可直接进入{selfLeave ? "退出" : "移除"}确认。
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5" data-member-handoff-step="confirm">
              <div>
                <h3 className="text-base font-semibold text-slate-900">核对交接计划</h3>
                <p className="mt-1 text-sm text-slate-500">提交后由服务端重新盘点并在一个事务中完成，不会出现交接一半的状态。</p>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">待交接成员</span><span className="font-medium text-slate-900">{preview.target.displayName}</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">接替人</span><span className="font-medium text-slate-900">{selectedCandidate?.displayName ?? (needsAssignee ? "尚未选择" : "无需接替人")}</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">转移库存</span><span className="font-medium text-slate-900">{preview.inventory.total} 条</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">转移未结询价</span><span className="font-medium text-slate-900">{preview.inquiries.total} 条</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">转移客户档案</span><span className="font-medium text-slate-900">{preview.customers.total} 个</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-3 px-4 py-3 text-sm"><span className="text-slate-500">完成后</span><span className="font-medium text-slate-900">{mode === "handoff_remove" ? (selfLeave ? "退出企业并关闭ERP访问" : "移出企业并关闭ERP访问") : "保留企业成员身份"}</span></div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                <p className="font-semibold">以下业务本次不会改写</p>
                {preview.unsupported.map(item => <p key={item.key} className="mt-1">{item.label}：{item.reason}</p>)}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-800">完成交接后</p>
                <label className={`flex items-start gap-3 rounded-xl border border-slate-200 p-4 ${totalTransferable === 0 ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                  <input type="radio" className="mt-1" checked={mode === "handoff_only"} disabled={totalTransferable === 0 || isFinalChecking || handoffMutation.isPending} onChange={() => changePlan({ mode: "handoff_only" })} />
                  <span><span className="block text-sm font-medium text-slate-900">仅交接业务</span><span className="mt-1 block text-xs text-slate-500">{totalTransferable === 0 ? "该成员当前没有可交接业务。" : "保留成员关系，适合岗位调整。"}</span></span>
                </label>
                <label className={`flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/40 p-4 ${selfLeave ? "cursor-default" : "cursor-pointer"}`}>
                  <input type="radio" className="mt-1" checked={mode === "handoff_remove"} disabled={isFinalChecking || handoffMutation.isPending} onChange={() => changePlan({ mode: "handoff_remove" })} />
                  <span><span className="block text-sm font-medium text-red-800">{selfLeave ? "交接并退出企业" : "交接并移除成员"}</span><span className="mt-1 block text-xs text-red-700">交接成功后立即{selfLeave ? "退出" : "移出"}企业并关闭ERP访问。</span></span>
                </label>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <input type="checkbox" className="mt-1" checked={confirmed} disabled={isFinalChecking || handoffMutation.isPending} onChange={event => setConfirmed(event.target.checked)} />
                <span className="text-sm leading-6 text-slate-700">
                  我已核对交接计划。历史订单经办人、库存与客户创建人、跟进作者、旧聊天和已结束询价不会被改写。
                </span>
              </label>
              {handoffMutation.isError ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
                  <p className="font-semibold">交接未完成</p>
                  <p className="mt-1">{handoffMutation.error.message}</p>
                  <p className="mt-1 text-xs">请按提示修正后重试；未确认成功前不会移除成员。</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-slate-100 bg-white px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={isFinalChecking || handoffMutation.isPending}
            onClick={() => step === 1 ? onOpenChange(false) : setStep(current => current - 1)}
          >
            {step === 1 ? "取消" : <><ArrowLeft className="mr-1 size-4" />上一步</>}
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              onClick={continueToNextStep}
              disabled={!preview || previewQuery.isFetching || exceedsSafeLimit || (step === 2 && !canContinueFromAssignee)}
            >
              {previewQuery.isFetching ? "正在重新盘点…" : <>下一步<ArrowRight className="ml-1 size-4" /></>}
            </Button>
          ) : (
            <Button
              type="button"
              className={mode === "handoff_remove" ? "bg-red-600 hover:bg-red-700" : ""}
              disabled={!canSubmit}
              onClick={submitHandoff}
            >
              <UserRoundCheck className="mr-1 size-4" />
              {isFinalChecking ? "正在最终盘点…" : handoffMutation.isPending ? "正在执行…" : mode === "handoff_remove" ? (selfLeave ? "确认交接并退出" : "确认交接并移除") : "确认交接"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
