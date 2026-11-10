import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "../../../../api/business-trpc";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import EnterpriseMemberHandoffSheet, {
  type MemberHandoffMode,
} from "./EnterpriseMemberHandoffSheet";
import {
  EnterpriseBusinessHandoffMenu,
  EnterpriseBusinessHandoffStatus,
} from "./EnterpriseBusinessHandoff";
import { formatBeijingDateTime } from "../../../shared/beijingTime";
import {
  ERP_PERMISSION_DEFINITIONS,
  ERP_PERMISSION_GROUPS,
  ERP_VISIBLE_PERMISSION_KEYS,
  type ErpPermissionKey,
} from "../../../shared/erpPermissions";

const statusLabels = { active: "正常", suspended: "已暂停" } as const;
const invitationStatusLabels = {
  pending: "待确认",
  accepted: "已同意",
  rejected: "已拒绝",
  revoked: "已撤销",
  expired: "已过期",
} as const;
const userRecordEventLabels: Record<string, string> = {
  invite_created: "发送邀请",
  invite_resent: "重新发送邀请",
  invite_revoked: "撤销邀请",
  invite_accepted: "接受邀请",
  invite_rejected: "拒绝邀请",
  permissions_updated: "变更权限/业务范围",
  member_suspended: "暂停成员",
  member_activated: "恢复成员",
  member_removed: "移出企业",
  member_left: "主动退出企业",
  owner_transferred: "转让企业所有者",
};

type Member = {
  memberId: number;
  userId: number;
  role: string;
  status: "active" | "suspended";
  inventoryDataScope: "own" | "enterprise";
  joinedAt: Date | string;
  displayName: string;
  phone: string;
  permissionKeys: ErpPermissionKey[];
  isOwner: boolean;
};

function requestId(prefix: string) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`.slice(0, 64);
}

function permissionText(keys: readonly string[] | null | undefined) {
  if (!keys?.length) return "—";
  const visible = keys.filter(key => key !== "inventory.dashboard");
  return visible.length
    ? visible.map(key => ERP_PERMISSION_DEFINITIONS[key as ErpPermissionKey]?.label || key).join("、")
    : "—";
}

function ScopeChoice({
  value,
  onChange,
  canUseEnterpriseScope,
  inputName,
  disabled = false,
}: {
  value: "own" | "enterprise";
  onChange: (value: "own" | "enterprise") => void;
  canUseEnterpriseScope: boolean;
  inputName: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-[#233548]">业务范围</p>
        <span className="text-[12px] text-[#7a8998]">适用于库存、询价等负责人数据</span>
      </div>
      <div className="grid grid-cols-2 rounded-lg bg-[#f3f6f9] p-1">
        <label className={`flex h-9 items-center justify-center rounded-md px-3 text-[13px] font-medium transition-colors ${
          value === "own" ? "bg-white text-[#185FA5] shadow-sm" : "text-[#526273]"
        } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
          <input
            type="radio"
            name={inputName}
            className="sr-only"
            checked={value === "own"}
            disabled={disabled}
            onChange={() => onChange("own")}
          />
          <span>仅本人业务</span>
        </label>
        <label className={`flex h-9 items-center justify-center rounded-md px-3 text-[13px] font-medium transition-colors ${
          value === "enterprise" ? "bg-white text-[#185FA5] shadow-sm" : "text-[#526273]"
        } ${disabled || !canUseEnterpriseScope ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
          <input
            type="radio"
            name={inputName}
            className="sr-only"
            checked={value === "enterprise"}
            disabled={disabled || !canUseEnterpriseScope}
            onChange={() => onChange("enterprise")}
          />
          <span>全企业业务</span>
        </label>
      </div>
      <p className="mt-1.5 text-[12px] text-[#7a8998]">
        {value === "enterprise" ? "可处理企业全部相关数据" : "仅处理本人负责的数据"}
        {!canUseEnterpriseScope ? "；全企业业务仅所有者可授予" : ""}
      </p>
    </div>
  );
}

function togglePermission(value: ErpPermissionKey[], key: ErpPermissionKey): ErpPermissionKey[] {
  const selected = new Set(value);
  if (selected.has(key)) {
    selected.delete(key);
    if (key === "customers.manage") selected.delete("customers.manage_all");
  } else {
    selected.add(key);
    if (key === "customers.manage_all") selected.add("customers.manage");
  }
  return ERP_VISIBLE_PERMISSION_KEYS.filter(item => selected.has(item));
}

function PermissionSelector({
  value,
  availableKeys,
  onChange,
  disabled = false,
  idPrefix,
}: {
  value: ErpPermissionKey[];
  availableKeys: ErpPermissionKey[];
  onChange: (next: ErpPermissionKey[]) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const selected = new Set(value);
  const available = new Set(availableKeys);
  const groups = ERP_PERMISSION_GROUPS.map(group => ({
    ...group,
    keys: group.keys.filter(key => available.has(key)),
  })).filter(group => group.keys.length > 0);
  return (
    <div className="space-y-4" data-permission-selector>
      {groups.map(group => (
        <section key={group.title} data-permission-group={group.title}>
          <h4 className="mb-2 text-[12px] font-medium text-[#7a8998]">{group.title}</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.keys.map(key => {
              const item = ERP_PERMISSION_DEFINITIONS[key];
              const id = `${idPrefix}-${key.replaceAll(".", "-")}`;
              return (
                <label
                  key={key}
                  htmlFor={id}
                  className={`flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                    selected.has(key) ? "border-[#b3cfe8] bg-[#f5f8fc]" : "border-[#e2e8ef] bg-white hover:border-[#b9cee3]"
                  } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 shrink-0 accent-[#185FA5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#185FA5]"
                    checked={selected.has(key)}
                    disabled={disabled}
                    onChange={() => onChange(togglePermission(value, key))}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-5 text-[#233548]">{item.label}</span>
                    <span className="mt-0.5 block text-xs leading-4 text-[#7a8998]">{item.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PermissionSummary({ member }: { member: Member }) {
  if (member.isOwner) return <Badge variant="outline">全部权限</Badge>;
  const visible = member.permissionKeys.slice(0, 2);
  const remaining = member.permissionKeys.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(key => <Badge key={key} variant="outline" className="max-w-[118px] truncate">{ERP_PERMISSION_DEFINITIONS[key].label}</Badge>)}
      {remaining > 0 ? <Badge variant="outline">+{remaining}</Badge> : null}
      {!visible.length ? <span className="text-xs text-[#7a8998]">未配置模块权限</span> : null}
    </div>
  );
}

function OwnerTransferSteps({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["选择接收人", "验证手机", "风险确认"];
  return (
    <ol className="grid grid-cols-3 gap-2 border-b border-[#edf1f5] bg-[#fafcff] px-5 py-3" aria-label="所有者转让步骤">
      {labels.map((label, index) => {
        const active = index + 1 === step;
        const done = index + 1 < step;
        return <li key={label} className={`flex min-w-0 items-center gap-2 text-xs ${active || done ? "text-[#185FA5]" : "text-[#7a8998]"}`}>
          <span className={`grid size-6 shrink-0 place-items-center rounded-full font-semibold ${active ? "bg-[#185FA5] text-white" : done ? "bg-blue-100 text-[#185FA5]" : "bg-slate-100"}`}>{done ? "✓" : index + 1}</span>
          <span className="truncate font-medium">{label}</span>
        </li>;
      })}
    </ol>
  );
}

export type EnterpriseMembersPanelInitialView = "members" | "records";

export default function EnterpriseMembersPanel({ initialView = "members", pageHeading }: { initialView?: EnterpriseMembersPanelInitialView; pageHeading?: ReactNode }) {
  const utils = trpc.useUtils();
  const [activeView, setActiveView] = useState<EnterpriseMembersPanelInitialView>(initialView);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState("");
  const [invitePermissions, setInvitePermissions] = useState<ErpPermissionKey[]>([
    "inventory.manage", "inventory.publish",
  ]);
  const [inviteBusinessScope, setInviteBusinessScope] = useState<"own" | "enterprise">("own");
  const [managedMember, setManagedMember] = useState<Member | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<ErpPermissionKey[]>([]);
  const [editingBusinessScope, setEditingBusinessScope] = useState<"own" | "enterprise">("own");
  const [savingMember, setSavingMember] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState<{ userId: number; displayName: string } | null>(null);
  const [handoffMode, setHandoffMode] = useState<MemberHandoffMode>("handoff_only");
  const [ownerTransferOpen, setOwnerTransferOpen] = useState(false);
  const [ownerTransferStep, setOwnerTransferStep] = useState<1 | 2 | 3>(1);
  const [ownerTransferTargetUserId, setOwnerTransferTargetUserId] = useState<number | null>(null);
  const [ownerTransferReason, setOwnerTransferReason] = useState("");
  const [ownerTransferRequestId, setOwnerTransferRequestId] = useState(() => requestId("owner-transfer"));
  const [ownerTransferCode, setOwnerTransferCode] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [ownerCodeCooldown, setOwnerCodeCooldown] = useState(0);
  const [verificationTicket, setVerificationTicket] = useState("");
  const [verificationExpiresInSeconds, setVerificationExpiresInSeconds] = useState(0);
  const [ownerVerificationError, setOwnerVerificationError] = useState("");
  const [ownerTransferConfirmed, setOwnerTransferConfirmed] = useState(false);
  const [recordKeyword, setRecordKeyword] = useState("");
  const [debouncedRecordKeyword, setDebouncedRecordKeyword] = useState("");
  const [recordEventType, setRecordEventType] = useState("all");
  const [recordTimeRange, setRecordTimeRange] = useState<"all" | "7d" | "30d">("all");
  const ownerTransferLockRef = useRef(false);

  const enterpriseQuery = trpc.enterprise.me.useQuery();
  const summary = enterpriseQuery.data;
  const canManage = summary?.permissions.manageMembers ?? false;
  const isOwner = summary?.isOwner ?? false;
  const membersQuery = trpc.enterprise.members.useQuery(undefined, { enabled: canManage, retry: false });
  const recordsQuery = trpc.enterprise.userRecords.useQuery({
    keyword: debouncedRecordKeyword || undefined,
    eventType: recordEventType as never,
    timeRange: recordTimeRange,
  }, { enabled: canManage && activeView === "records", retry: false });

  const refresh = async () => {
    await Promise.all([
      utils.enterprise.me.invalidate(),
      utils.enterprise.members.invalidate(),
      utils.enterprise.invitations.invalidate(),
      utils.enterprise.userRecords.invalidate(),
      utils.enterprise.myInvitations.invalidate(),
      utils.enterprise.handoffPreview.invalidate(),
      utils.enterprise.businessHandoffPreview.invalidate(),
      utils.enterprise.businessHandoffState.invalidate(),
      utils.enterprise.inquiryInbox.invalidate(),
      utils.inventory.listPaged.invalidate(),
      utils.auth.me.invalidate(),
    ]);
  };

  const inviteMutation = trpc.enterprise.invite.useMutation({
    onSuccess: async result => {
      toast.success("邀请卡已由51小电发送", { description: `${result.target.displayName}（${result.target.phone}）可在聊一聊中确认` });
      setInvitePhone("");
      setInviteOpen(false);
      await refresh();
    },
    onError: error => toast.error("邀请失败", { description: error.message }),
  });
  const permissionMutation = trpc.enterprise.updatePermissions.useMutation({
    onError: error => toast.error("权限更新失败", { description: error.message }),
  });
  const businessScopeMutation = trpc.enterprise.updateInventoryScope.useMutation({
    onError: error => toast.error("业务范围更新失败", { description: error.message }),
  });
  const statusMutation = trpc.enterprise.setStatus.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(variables.status === "active" ? "成员已恢复" : "成员已暂停");
      setManagedMember(null);
      await refresh();
    },
    onError: error => toast.error("状态更新失败", { description: error.message }),
  });
  const revokeMutation = trpc.enterprise.revokeInvitation.useMutation({
    onSuccess: async () => { toast.success("邀请已撤销"); await refresh(); },
    onError: error => toast.error("撤销失败", { description: error.message }),
  });
  const sendOwnershipCodeMutation = trpc.enterprise.sendOwnershipTransferCode.useMutation();
  const verifyOwnershipCodeMutation = trpc.enterprise.verifyOwnershipTransferCode.useMutation();
  const transferOwnershipMutation = trpc.enterprise.transferOwnership.useMutation();

  useEffect(() => {
    if (!ownerTransferOpen || ownerCodeCooldown <= 0) return;
    const timer = window.setInterval(() => setOwnerCodeCooldown(current => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [ownerCodeCooldown, ownerTransferOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRecordKeyword(recordKeyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [recordKeyword]);

  const enterprise = summary?.enterprise;
  const grantableKeys = useMemo<ErpPermissionKey[]>(() => summary?.isOwner
    ? [...ERP_VISIBLE_PERMISSION_KEYS]
    : (summary?.permissionKeys ?? []).filter(key => key !== "inventory.dashboard"), [summary?.isOwner, summary?.permissionKeys]);
  const members = (membersQuery.data?.members ?? []) as Member[];
  const selfMember = members.find(member => member.userId === summary?.currentUserId) ?? null;
  const selfHandoffTarget = selfMember ?? (
    summary?.member && !summary.isOwner
      ? { userId: summary.currentUserId, displayName: "当前账号" }
      : null
  );
  const owner = members.find(member => member.isOwner) ?? null;
  const ownerTransferCandidates = members.filter(member => !member.isOwner && member.status === "active");
  const selectedOwnerTransferTarget = ownerTransferCandidates.find(member => member.userId === ownerTransferTargetUserId) ?? null;
  const memberCount = canManage ? members.length : summary?.member ? 1 : 0;
  const ownershipBusy = sendOwnershipCodeMutation.isPending || verifyOwnershipCodeMutation.isPending || transferOwnershipMutation.isPending;
  const managedMemberIsSelf = managedMember?.userId === summary?.currentUserId;

  const openHandoff = (member: { userId: number; displayName: string }, mode: MemberHandoffMode) => {
    setManagedMember(null);
    setHandoffMode(mode);
    setHandoffTarget(member);
  };
  const openMemberManager = (member: Member) => {
    setEditingPermissions(member.permissionKeys.filter(key => key !== "inventory.dashboard"));
    setEditingBusinessScope(member.inventoryDataScope);
    setManagedMember(member);
  };
  const resetOwnerTransfer = () => {
    setOwnerTransferStep(1);
    setOwnerTransferTargetUserId(null);
    setOwnerTransferReason("");
    setOwnerTransferRequestId(requestId("owner-transfer"));
    setOwnerTransferCode("");
    setMaskedPhone("");
    setOwnerCodeCooldown(0);
    setVerificationTicket("");
    setVerificationExpiresInSeconds(0);
    setOwnerVerificationError("");
    setOwnerTransferConfirmed(false);
    ownerTransferLockRef.current = false;
  };
  const openOwnerTransfer = () => {
    resetOwnerTransfer();
    setOwnerTransferOpen(true);
  };
  const saveMemberChanges = async () => {
    if (!managedMember || savingMember) return;
    if (!editingPermissions.length) {
      toast.error("请至少保留一项ERP权限");
      return;
    }
    setSavingMember(true);
    try {
      const requests: Promise<unknown>[] = [];
      if (editingPermissions.join("|") !== managedMember.permissionKeys.join("|")) {
        requests.push(permissionMutation.mutateAsync({
          userId: managedMember.userId,
          permissionKeys: editingPermissions,
          requestId: requestId("permissions"),
        }));
      }
      if (editingBusinessScope !== managedMember.inventoryDataScope) {
        requests.push(businessScopeMutation.mutateAsync({
          userId: managedMember.userId,
          inventoryDataScope: editingBusinessScope,
          requestId: requestId("business-scope"),
        }));
      }
      if (!requests.length) {
        setManagedMember(null);
        return;
      }
      await Promise.all(requests);
      toast.success("成员设置已保存");
      setManagedMember(null);
      await refresh();
    } catch {
      // Individual mutation callbacks show the actionable server message.
    } finally {
      setSavingMember(false);
    }
  };
  const sendOwnerTransferCode = async () => {
    if (!ownerTransferTargetUserId || ownerTransferReason.trim().length < 2 || ownershipBusy) return;
    setOwnerVerificationError("");
    setVerificationTicket("");
    setVerificationExpiresInSeconds(0);
    setOwnerTransferConfirmed(false);
    try {
      const result = await sendOwnershipCodeMutation.mutateAsync({
        targetUserId: ownerTransferTargetUserId,
        requestId: ownerTransferRequestId,
      });
      setMaskedPhone(result.maskedPhone);
      setOwnerCodeCooldown(Math.max(0, result.retryAfterSeconds));
      setOwnerTransferCode("");
      setOwnerTransferStep(2);
      toast.success("验证码已发送", { description: `已发送至当前所有者手机 ${result.maskedPhone}` });
    } catch (error) {
      toast.error("验证码发送失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    }
  };
  const verifyOwnerTransferCode = async () => {
    if (!ownerTransferTargetUserId || ownerTransferCode.length !== 6 || ownershipBusy) return;
    setOwnerVerificationError("");
    try {
      const result = await verifyOwnershipCodeMutation.mutateAsync({
        targetUserId: ownerTransferTargetUserId,
        requestId: ownerTransferRequestId,
        code: ownerTransferCode,
      });
      setVerificationTicket(result.verificationTicket);
      setVerificationExpiresInSeconds(result.expiresInSeconds);
      setOwnerTransferStep(3);
    } catch (error) {
      const message = error instanceof Error ? error.message : "验证码错误或已失效，请重新输入";
      setOwnerVerificationError(message);
      toast.error("验证码验证失败", { description: message });
    }
  };
  const submitOwnerTransfer = async () => {
    if (!ownerTransferTargetUserId || !verificationTicket || !ownerTransferConfirmed || ownershipBusy || ownerTransferLockRef.current) return;
    ownerTransferLockRef.current = true;
    try {
      await transferOwnershipMutation.mutateAsync({
        targetUserId: ownerTransferTargetUserId,
        reason: ownerTransferReason.trim(),
        requestId: ownerTransferRequestId,
        verificationTicket,
      });
      toast.success("企业所有者已转让", { description: "原所有者与新所有者都会收到51小电通知。" });
      setOwnerTransferOpen(false);
      resetOwnerTransfer();
      await refresh();
    } catch (error) {
      toast.error("转让失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      ownerTransferLockRef.current = false;
    }
  };

  const inviteButton = canManage ? <button type="button" className="crm-btn crm-btn-primary h-9" onClick={() => setInviteOpen(true)}>+ 邀请成员</button> : null;
  const viewTabs = enterprise && canManage ? (
    <div className="flex h-10 items-end gap-5 border-b border-[#dfe6ee]" role="tablist" aria-label="用户与权限内容">
      <button type="button" role="tab" aria-selected={activeView === "members"} className={`relative h-10 px-1 text-[13px] font-medium transition-colors ${activeView === "members" ? "text-[#185FA5] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-[#185FA5]" : "text-[#667788] hover:text-[#233548]"}`} onClick={() => setActiveView("members")}>成员管理 <span className="ml-1 text-[12px]">{members.length}</span></button>
      <button type="button" role="tab" aria-selected={activeView === "records"} className={`relative h-10 px-1 text-[13px] font-medium transition-colors ${activeView === "records" ? "text-[#185FA5] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-[#185FA5]" : "text-[#667788] hover:text-[#233548]"}`} onClick={() => setActiveView("records")}>操作记录</button>
    </div>
  ) : null;
  const pageHeader = pageHeading ? (
    <header data-admin-header="primary">
      <div data-admin-header-part="heading">{pageHeading}</div>
      {!enterpriseQuery.isLoading && !enterpriseQuery.isError && enterprise && canManage ? (
        <>
          {viewTabs}
          <div data-admin-header-part="actions">{inviteButton}</div>
        </>
      ) : null}
    </header>
  ) : null;
  const withPageHeading = (status: ReactNode) => pageHeading ? (
    <div className="space-y-4" data-enterprise-members-panel>{pageHeader}{status}</div>
  ) : status;

  if (enterpriseQuery.isLoading) return withPageHeading(<div className="rounded-xl border border-[#e7edf4] bg-white p-8 text-center text-sm text-[#667788]">正在加载企业权限…</div>);
  if (enterpriseQuery.isError) return withPageHeading(<div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">企业权限加载失败：{enterpriseQuery.error.message}</div>);

  return (
    <div className="space-y-4" data-enterprise-members-panel>
      {pageHeader}
      <section className="rounded-lg border border-[#e3eaf2] bg-white px-4 py-3.5" aria-labelledby="enterprise-overview-title" data-enterprise-summary>
        {!enterprise ? (
          <div className="text-[13px] leading-6 text-[#667788]">ERP 申请通过后将自动建立企业归属。</div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-[240px] flex-1">
              <h2 id="enterprise-overview-title" className="truncate text-[15px] font-semibold text-[#233548]">{enterprise.companyName}</h2>
              <p className="mt-1 truncate font-mono text-[12px] text-[#7a8998]">统一社会信用代码 {enterprise.creditCode || "—"}</p>
            </div>
            <dl className="flex shrink-0 items-center gap-6 text-[12px]">
              <div><dt className="text-[#7a8998]">成员</dt><dd className="mt-0.5 font-medium text-[#233548]">{memberCount} 人</dd></div>
              <div className="min-w-[90px]"><dt className="text-[#7a8998]">当前所有者</dt><dd className="mt-0.5 max-w-[140px] truncate font-medium text-[#233548]">{owner?.displayName || (isOwner ? "我" : "企业所有者")}</dd></div>
            </dl>
            {!pageHeading ? inviteButton : null}
          </div>
        )}
      </section>

      {!enterprise ? null : !canManage ? (
        <section className="rounded-xl border border-[#e3eaf2] bg-white p-5" aria-labelledby="my-enterprise-permissions-title">
          <h2 id="my-enterprise-permissions-title" className="text-base font-bold text-[#233548]">我的企业权限</h2>
          <p className="mt-1 text-sm text-[#667788]">您可查看自己的模块权限和业务范围；没有成员管理权限。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(summary?.permissionKeys ?? []).map(key => <Badge key={key} variant="outline">{ERP_PERMISSION_DEFINITIONS[key].label}</Badge>)}
            {!summary?.permissionKeys.length ? <span className="text-sm text-[#7a8998]">暂未获授 ERP 模块权限</span> : null}
          </div>
          <div className="mt-4 rounded-lg bg-[#f8fafc] px-4 py-3 text-sm text-[#526273]">业务范围：{summary?.member?.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"}</div>
          {selfHandoffTarget && !summary?.isOwner ? (
            <div className="mt-5 border-t border-[#edf1f5] pt-4">
              <p className="text-sm text-[#667788]">如不再为本企业处理业务，可先完成库存和未结询价交接后退出；退出不会删除您的 51 电子网账号。</p>
              <button type="button" className="crm-btn crm-btn-danger mt-3" onClick={() => openHandoff(selfHandoffTarget, "handoff_remove")}>退出企业</button>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          {!pageHeading ? viewTabs : null}

          {activeView === "members" ? <section className="overflow-hidden rounded-lg border border-[#e3eaf2] bg-white" aria-labelledby="members-management-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf1f5] px-5 py-4">
              <div><h2 id="members-management-title" className="text-[15px] font-semibold text-[#233548]">企业成员</h2><p className="mt-1 text-[12px] text-[#7a8998]">在“管理”中调整权限、业务范围或成员状态。</p></div>
              <span className="text-xs text-[#7a8998]">共 {members.length} 人</span>
            </div>
            {membersQuery.isLoading ? <div className="p-8 text-center text-sm text-[#7a8998]">正在加载企业成员…</div> : (
              <>
                <div className="hidden xl:block">
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-[#fafcff] text-xs text-[#7a8998]"><tr><th className="w-[23%] px-5 py-3 font-medium">用户 / 角色</th><th className="w-[26%] px-4 py-3 font-medium">权限摘要</th><th className="w-[14%] px-4 py-3 font-medium">业务范围</th><th className="w-[11%] px-4 py-3 font-medium">状态</th><th className="w-[15%] px-4 py-3 font-medium">加入时间</th><th className="w-[140px] px-4 py-3 font-medium">操作</th></tr></thead>
                    <tbody className="divide-y divide-[#edf1f5]">{members.map(member => <tr key={member.memberId} className="align-middle"><td className="px-5 py-3"><div className="truncate font-medium text-[#233548]">{member.displayName}</div><div className="mt-0.5 truncate text-xs text-[#7a8998]">{member.isOwner ? "企业所有者" : "企业成员"} · {member.phone}</div></td><td className="px-4 py-3"><PermissionSummary member={member} /></td><td className="px-4 py-3"><Badge variant="outline">{member.isOwner || member.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"}</Badge></td><td className="px-4 py-3"><Badge variant={member.status === "active" ? "default" : "secondary"}>{statusLabels[member.status]}</Badge></td><td className="px-4 py-3 text-xs text-[#667788]">{formatBeijingDateTime(member.joinedAt)}</td><td className="whitespace-nowrap px-4 py-3">{member.isOwner ? <EnterpriseBusinessHandoffMenu isOwner={isOwner} onOwnerTransfer={openOwnerTransfer} /> : <button type="button" className="crm-btn crm-btn-up crm-btn-sm" onClick={() => openMemberManager(member)}>管理</button>}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="space-y-3 p-4 xl:hidden" data-responsive-member-cards>{members.map(member => <article key={member.memberId} className="rounded-lg border border-[#e2e8ef] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-[15px] font-semibold text-[#233548]">{member.displayName}</h3><p className="mt-0.5 text-xs text-[#7a8998]">{member.isOwner ? "企业所有者" : "企业成员"} · {member.phone}</p></div><Badge variant={member.status === "active" ? "default" : "secondary"}>{statusLabels[member.status]}</Badge></div><div className="mt-3 grid gap-3 text-sm"><div><p className="text-xs text-[#7a8998]">权限摘要</p><div className="mt-1"><PermissionSummary member={member} /></div></div><div className="flex items-center justify-between gap-3"><span className="text-xs text-[#7a8998]">业务范围</span><span className="font-medium text-[#526273]">{member.isOwner || member.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"}</span></div><div className="flex items-center justify-between gap-3"><span className="text-xs text-[#7a8998]">加入时间</span><span className="text-xs text-[#526273]">{formatBeijingDateTime(member.joinedAt)}</span></div></div><div className="mt-4 border-t border-[#edf1f5] pt-3">{member.isOwner ? <EnterpriseBusinessHandoffMenu isOwner={isOwner} onOwnerTransfer={openOwnerTransfer} /> : <button type="button" className="crm-btn crm-btn-up crm-btn-sm" onClick={() => openMemberManager(member)}>管理</button>}</div></article>)}</div>
              </>
            )}
          </section> : null}
          {activeView === "members" ? <EnterpriseBusinessHandoffStatus isOwner={isOwner} /> : null}

          {activeView === "records" ? <section className="overflow-hidden rounded-lg border border-[#e3eaf2] bg-white" aria-labelledby="user-records-title">
            <div className="border-b border-[#edf1f5] px-5 py-4"><h2 id="user-records-title" className="text-[15px] font-semibold text-[#233548]">操作记录</h2><p className="mt-1 text-[12px] text-[#7a8998]">保留邀请、授权和成员变更历史；待确认邀请可直接撤销。</p></div>
            <div className="grid gap-2 border-b border-[#edf1f5] bg-[#fafcff] px-4 py-3 sm:grid-cols-[minmax(190px,1fr)_160px_130px]" data-user-record-filters>
              <Input className="crm-input h-9" value={recordKeyword} onChange={event => setRecordKeyword(event.target.value)} placeholder="搜索用户、手机号或 ID" aria-label="用户记录关键词" />
              <select className="crm-input h-9 min-w-0" value={recordEventType} onChange={event => setRecordEventType(event.target.value)} aria-label="用户记录事件类型"><option value="all">全部事件</option>{Object.entries(userRecordEventLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              <select className="crm-input h-9 min-w-0" value={recordTimeRange} onChange={event => setRecordTimeRange(event.target.value as "all" | "7d" | "30d")} aria-label="用户记录时间范围"><option value="all">全部时间</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select>
            </div>
            {recordsQuery.isLoading ? <div className="p-8 text-center text-sm text-[#7a8998]">正在加载用户记录…</div> : (recordsQuery.data?.length ?? 0) === 0 ? <div className="p-8 text-center text-sm text-[#7a8998]">没有符合筛选条件的用户记录。</div> : <>
              <div className="hidden xl:block"><table className="w-full table-fixed text-left text-sm"><thead className="bg-[#fafcff] text-xs text-[#7a8998]"><tr><th className="w-[18%] px-5 py-3 font-medium">用户</th><th className="w-[20%] px-4 py-3 font-medium">事件</th><th className="w-[14%] px-4 py-3 font-medium">操作人</th><th className="w-[15%] px-4 py-3 font-medium">时间</th><th className="w-[18%] px-4 py-3 font-medium">权限变更</th><th className="w-[15%] px-4 py-3 font-medium">邀请状态 / 操作</th></tr></thead><tbody className="divide-y divide-[#edf1f5]">{recordsQuery.data?.map(record => <tr key={record.id} className="align-top"><td className="px-5 py-3"><div className="truncate font-medium text-[#233548]">{record.target.displayName}</div><div className="truncate text-xs text-[#7a8998]">{record.target.phone} · ID {record.target.id}</div></td><td className="px-4 py-3"><div className="font-medium text-[#526273]">{userRecordEventLabels[record.eventType] || record.eventType}</div>{record.note ? <p className="mt-1 line-clamp-2 text-xs text-[#7a8998]">{record.note}</p> : null}</td><td className="px-4 py-3 text-xs text-[#526273]">{record.actor ? <><div className="truncate">{record.actor.displayName}</div><div className="truncate text-[#7a8998]">{record.actor.phone}</div></> : "系统"}</td><td className="px-4 py-3 text-xs text-[#667788]">{formatBeijingDateTime(record.occurredAt)}</td><td className="px-4 py-3 text-xs leading-5 text-[#667788]"><div className="truncate">前：{permissionText(record.beforePermissions)}</div><div className="truncate">后：{permissionText(record.afterPermissions)}</div></td><td className="px-4 py-3">{record.invitation ? <div className="space-y-2"><Badge variant="outline">{invitationStatusLabels[record.invitation.status as keyof typeof invitationStatusLabels] || record.invitation.status}</Badge>{record.invitation.status === "pending" ? <button type="button" className="crm-btn crm-btn-danger crm-btn-sm" onClick={() => revokeMutation.mutate({ invitationId: record.invitation!.id, requestId: requestId("revoke") })} disabled={revokeMutation.isPending}>撤销邀请</button> : null}</div> : "—"}</td></tr>)}</tbody></table></div>
              <div className="space-y-3 p-4 xl:hidden" data-responsive-record-timeline>{recordsQuery.data?.map(record => <article key={record.id} className="relative border-l-2 border-[#d8e6f4] pl-4"><span className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-[#185FA5]" /><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-[#233548]">{record.target.displayName}</h3><p className="mt-0.5 text-xs text-[#7a8998]">{userRecordEventLabels[record.eventType] || record.eventType} · {formatBeijingDateTime(record.occurredAt)}</p></div>{record.invitation ? <Badge variant="outline">{invitationStatusLabels[record.invitation.status as keyof typeof invitationStatusLabels] || record.invitation.status}</Badge> : null}</div>{record.note ? <p className="mt-2 break-words text-sm text-[#526273]">{record.note}</p> : null}<p className="mt-2 break-words text-xs leading-5 text-[#667788]">权限：{permissionText(record.afterPermissions)}</p>{record.invitation?.status === "pending" ? <button type="button" className="crm-btn crm-btn-danger crm-btn-sm mt-3" onClick={() => revokeMutation.mutate({ invitationId: record.invitation!.id, requestId: requestId("revoke") })} disabled={revokeMutation.isPending}>撤销邀请</button> : null}</article>)}</div>
            </>}
          </section> : null}
        </>
      )}

      <Sheet open={inviteOpen} onOpenChange={open => { if (!inviteMutation.isPending) setInviteOpen(open); }}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden border-slate-200 bg-white p-0 sm:max-w-[560px]" data-invite-member-drawer>
          <SheetHeader className="border-b border-[#edf1f5] px-5 py-4 pr-12">
            <SheetTitle className="text-[16px] font-semibold text-[#233548]">邀请成员</SheetTitle>
            <SheetDescription className="text-[12px]">邀请已注册的 51 电子网用户加入企业。邀请自发送起24小时内有效。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div className="space-y-1.5">
              <Label htmlFor="enterprise-invite-phone" className="text-[13px] font-medium text-[#233548]">手机号</Label>
              <input id="enterprise-invite-phone" className="crm-input h-9 w-full" inputMode="numeric" value={invitePhone} onChange={event => setInvitePhone(event.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="请输入 11 位手机号" />
            </div>
            <ScopeChoice value={inviteBusinessScope} onChange={setInviteBusinessScope} canUseEnterpriseScope={isOwner} inputName="invite-business-scope" disabled={inviteMutation.isPending} />
            <section>
              <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[13px] font-medium text-[#233548]">模块权限</h3><span className="text-[12px] text-[#7a8998]">至少选择一项</span></div>
              <PermissionSelector value={invitePermissions} availableKeys={grantableKeys} onChange={setInvitePermissions} disabled={inviteMutation.isPending} idPrefix="invite-permission" />
            </section>
          </div>
          <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-[#edf1f5] px-5 py-4">
            <button type="button" className="crm-btn h-9" onClick={() => setInviteOpen(false)} disabled={inviteMutation.isPending}>取消</button>
            <button type="button" className="crm-btn crm-btn-primary h-9" onClick={() => {
              if (!/^1[3-9]\d{9}$/.test(invitePhone)) return toast.error("请输入正确的 11 位手机号");
              if (!invitePermissions.length) return toast.error("请至少选择一项 ERP 权限");
              inviteMutation.mutate({ phone: invitePhone, permissionKeys: invitePermissions, inventoryDataScope: inviteBusinessScope, requestId: requestId("invite") });
            }} disabled={inviteMutation.isPending}>{inviteMutation.isPending ? "发送中…" : "发送邀请"}</button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(managedMember)} onOpenChange={open => { if (!open && !savingMember) setManagedMember(null); }}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden border-slate-200 bg-white p-0 sm:max-w-[560px]" data-member-management-drawer>
          <SheetHeader className="border-b border-[#edf1f5] px-5 py-4 pr-12"><SheetTitle className="text-[16px] font-semibold text-[#233548]">{managedMember?.userId === summary?.currentUserId ? "我的成员设置" : "管理成员"}</SheetTitle><SheetDescription className="text-[12px]">{managedMember ? `${managedMember.displayName} · ${managedMember.phone}` : "调整成员权限和业务范围"}</SheetDescription></SheetHeader>
          {managedMember ? <div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="space-y-4">{managedMemberIsSelf ? <div className="rounded-lg border border-[#d8e6f4] bg-[#f5f8fc] p-3 text-[13px] text-[#526273]">自己的模块权限和业务范围由其他企业管理员维护，您可以在下方退出企业。</div> : null}<section><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[13px] font-medium text-[#233548]">模块权限</h3><span className="text-[12px] text-[#7a8998]">至少保留一项</span></div><PermissionSelector value={editingPermissions} availableKeys={grantableKeys} onChange={setEditingPermissions} disabled={managedMember.isOwner || managedMemberIsSelf || savingMember} idPrefix="member-permission" /></section><section><ScopeChoice value={editingBusinessScope} onChange={setEditingBusinessScope} canUseEnterpriseScope={isOwner} inputName="member-business-scope" disabled={managedMember.isOwner || managedMemberIsSelf || savingMember} /></section><section className="border-t border-[#edf1f5] pt-4" data-danger-zone><h3 className="text-[13px] font-medium text-[#233548]">其他操作</h3><p className="mt-1 text-[12px] leading-5 text-[#7a8998]">暂停、交接或移出成员前，请确认其业务已妥善安排。</p><div className="mt-3 flex flex-wrap gap-2">{managedMemberIsSelf ? <button type="button" className="crm-btn crm-btn-danger crm-btn-sm" onClick={() => openHandoff(managedMember, "handoff_remove")}>退出企业</button> : <>{<button type="button" className="crm-btn crm-btn-up crm-btn-sm" onClick={() => statusMutation.mutate({ userId: managedMember.userId, status: managedMember.status === "active" ? "suspended" : "active", requestId: requestId("status") })} disabled={statusMutation.isPending}>{managedMember.status === "active" ? "暂停成员" : "恢复成员"}</button>}<button type="button" className="crm-btn crm-btn-up crm-btn-sm" onClick={() => openHandoff(managedMember, "handoff_only")}>转移业务</button><button type="button" className="crm-btn crm-btn-danger crm-btn-sm" onClick={() => openHandoff(managedMember, "handoff_remove")}>移出企业</button></>}</div></section></div></div> : null}
          <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-[#edf1f5] px-5 py-4"><button type="button" className="crm-btn h-9" onClick={() => setManagedMember(null)} disabled={savingMember}>取消</button><button type="button" className="crm-btn crm-btn-primary h-9" onClick={saveMemberChanges} disabled={!managedMember || managedMember.isOwner || managedMemberIsSelf || savingMember}>{savingMember ? "保存中…" : "保存设置"}</button></SheetFooter>
        </SheetContent>
      </Sheet>

      <EnterpriseMemberHandoffSheet open={Boolean(handoffTarget)} target={handoffTarget} initialMode={handoffMode} selfLeave={handoffMode === "handoff_remove" && handoffTarget?.userId === summary?.currentUserId} onOpenChange={nextOpen => { if (!nextOpen) setHandoffTarget(null); }} onCompleted={refresh} />

      <Dialog open={ownerTransferOpen} onOpenChange={open => { if (!ownershipBusy) { setOwnerTransferOpen(open); if (!open) resetOwnerTransfer(); } }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[600px]" showCloseButton={!ownershipBusy} data-owner-transfer-dialog>
          <DialogHeader className="px-5 pb-4 pt-5 pr-12"><DialogTitle>转让企业所有者</DialogTitle><DialogDescription>完成验证后，企业所有者身份会安全转交给指定成员。</DialogDescription></DialogHeader>
          <OwnerTransferSteps step={ownerTransferStep} />
          <div className="max-h-[58vh] overflow-y-auto px-5 py-5">
            {ownerTransferStep === 1 ? <div className="space-y-4" data-owner-transfer-step="selection"><div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><strong>请谨慎操作：</strong>新所有者将拥有全部 ERP 权限、成员管理权和全企业业务范围。</div><div className="space-y-1.5"><Label htmlFor="owner-transfer-target">选择正常成员</Label><select id="owner-transfer-target" className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]" value={ownerTransferTargetUserId ?? ""} onChange={event => setOwnerTransferTargetUserId(event.target.value ? Number(event.target.value) : null)}><option value="">请选择接收人</option>{ownerTransferCandidates.map(member => <option key={member.userId} value={member.userId}>{member.displayName}（{member.phone}）</option>)}</select>{ownerTransferCandidates.length === 0 ? <p className="text-xs text-red-600">暂无可接收转让的正常成员，请先邀请并由对方接受。</p> : null}</div><div className="space-y-1.5"><Label htmlFor="owner-transfer-reason">转让原因</Label><Textarea id="owner-transfer-reason" value={ownerTransferReason} onChange={event => setOwnerTransferReason(event.target.value)} maxLength={500} placeholder="请说明转让原因（至少 2 个字符）" /></div></div> : null}
            {ownerTransferStep === 2 ? <div className="space-y-4" data-owner-transfer-step="verification"><div className="rounded-lg border border-blue-100 bg-blue-50 p-4"><h3 className="text-[15px] font-semibold text-[#233548]">验证当前所有者手机</h3><p className="mt-1 text-sm leading-6 text-[#526273]">验证码已发送至 {maskedPhone || "当前所有者手机"}，10 分钟内有效。</p></div><div className="space-y-1.5"><Label htmlFor="owner-transfer-code">6 位验证码</Label><Input id="owner-transfer-code" inputMode="numeric" autoComplete="one-time-code" value={ownerTransferCode} onChange={event => { setOwnerVerificationError(""); setOwnerTransferCode(event.target.value.replace(/\D/g, "").slice(0, 6)); }} placeholder="请输入验证码" aria-invalid={Boolean(ownerVerificationError)} /></div>{ownerVerificationError ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">验证码错误：{ownerVerificationError}</div> : null}<div className="flex flex-wrap items-center gap-3"><button type="button" className="crm-btn crm-btn-up crm-btn-sm" disabled={ownerCodeCooldown > 0 || ownershipBusy} onClick={sendOwnerTransferCode}>{ownerCodeCooldown > 0 ? `${ownerCodeCooldown} 秒后可重新发送` : "重新发送验证码"}</button><span className="text-xs text-[#7a8998]">为保障安全，每次转让均需当前所有者验证。</span></div></div> : null}
            {ownerTransferStep === 3 ? <div className="space-y-4" data-owner-transfer-step="confirmation"><div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><strong>最终风险确认：</strong>转让后，{selectedOwnerTransferTarget?.displayName || "接收人"} 将立即拥有企业的全部 ERP 权限和成员管理权；您的账号将降为普通成员。</div><dl className="overflow-hidden rounded-lg border border-[#e2e8ef] text-sm"><div className="grid grid-cols-[92px_1fr] gap-3 border-b border-[#edf1f5] px-4 py-3"><dt className="text-[#7a8998]">接收人</dt><dd className="font-medium text-[#233548]">{selectedOwnerTransferTarget?.displayName}</dd></div><div className="grid grid-cols-[92px_1fr] gap-3 border-b border-[#edf1f5] px-4 py-3"><dt className="text-[#7a8998]">转让原因</dt><dd className="break-words text-[#526273]">{ownerTransferReason}</dd></div><div className="grid grid-cols-[92px_1fr] gap-3 px-4 py-3"><dt className="text-[#7a8998]">验证状态</dt><dd className="text-[#526273]">已验证（票据约 {Math.max(1, Math.ceil(verificationExpiresInSeconds / 60))} 分钟内有效）</dd></div></dl><label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#e2e8ef] p-4 text-sm text-[#445566]"><input type="checkbox" className="mt-1 accent-[#185FA5]" checked={ownerTransferConfirmed} onChange={event => setOwnerTransferConfirmed(event.target.checked)} disabled={ownershipBusy} /><span>我已理解以上风险，并确认将企业所有者转让给 {selectedOwnerTransferTarget?.displayName || "所选成员"}。</span></label><p className="text-xs text-[#7a8998]">转让成功后，原所有者与新所有者都会收到 51 小电通知。</p></div> : null}
          </div>
          <DialogFooter className="border-t border-[#edf1f5] bg-white px-5 py-4"><button type="button" className="crm-btn h-9" onClick={() => { if (ownerTransferStep === 1) { setOwnerTransferOpen(false); resetOwnerTransfer(); } else setOwnerTransferStep(current => (current - 1) as 1 | 2); }} disabled={ownershipBusy}>{ownerTransferStep === 1 ? "取消" : "上一步"}</button>{ownerTransferStep === 1 ? <button type="button" className="crm-btn crm-btn-primary h-9" onClick={() => { if (!ownerTransferTargetUserId) return toast.error("请选择正常成员"); if (ownerTransferReason.trim().length < 2) return toast.error("请填写至少 2 个字符的转让原因"); void sendOwnerTransferCode(); }} disabled={!ownerTransferTargetUserId || ownerTransferReason.trim().length < 2 || ownershipBusy}>{sendOwnershipCodeMutation.isPending ? "发送中…" : "发送验证码"}</button> : ownerTransferStep === 2 ? <button type="button" className="crm-btn crm-btn-primary h-9" onClick={() => void verifyOwnerTransferCode()} disabled={ownerTransferCode.length !== 6 || ownershipBusy}>{verifyOwnershipCodeMutation.isPending ? "验证中…" : "验证并继续"}</button> : <button type="button" className="crm-btn crm-btn-primary h-9" onClick={() => void submitOwnerTransfer()} disabled={!ownerTransferConfirmed || !verificationTicket || ownershipBusy}>{transferOwnershipMutation.isPending ? "正在提交…" : "确认转让企业所有者"}</button>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
