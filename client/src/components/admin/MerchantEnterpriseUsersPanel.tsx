import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  ERP_PERMISSION_DEFINITIONS,
  ERP_PERMISSION_KEYS,
  normalizeErpPermissions,
  type ErpPermissionKey,
} from "@shared/erpPermissions";
import { formatBeijingDateTime } from "@shared/beijingTime";
import { Loader2, ShieldAlert, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type MemberStatus = "active" | "suspended";
type MemberFilter = "all" | MemberStatus;
type InventoryScope = "own" | "enterprise";

type EnterpriseMember = {
  memberId: number;
  userId: number;
  displayName: string;
  username?: string | null;
  phone?: string | null;
  role?: string | null;
  status: MemberStatus;
  permissionKeys: ErpPermissionKey[];
  inventoryDataScope: InventoryScope;
  inventoryCount?: number | null;
  joinedAt?: Date | string | null;
  isOwner: boolean;
  loginDisabled: boolean;
};

type MembersResult = {
  available?: boolean;
  members?: unknown[];
  items?: unknown[];
  total?: number;
};

function createRequestId(prefix: string) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`.slice(0, 64);
}

function toMember(value: unknown): EnterpriseMember {
  const row = (value ?? {}) as Record<string, unknown>;
  const rawPermissions = Array.isArray(row.permissionKeys)
    ? row.permissionKeys.filter((item): item is string => typeof item === "string")
    : [];
  const role = typeof row.role === "string" ? row.role : null;
  return {
    memberId: Number(row.memberId ?? row.id),
    userId: Number(row.userId),
    displayName: String(row.displayName ?? row.name ?? row.username ?? "未命名用户"),
    username: typeof row.username === "string" ? row.username : null,
    phone: typeof row.maskedPhone === "string"
      ? row.maskedPhone
      : typeof row.phone === "string"
        ? row.phone
        : null,
    role,
    status: row.status === "suspended" ? "suspended" : "active",
    permissionKeys: normalizeErpPermissions(rawPermissions),
    inventoryDataScope: row.inventoryDataScope === "enterprise" ? "enterprise" : "own",
    inventoryCount: typeof row.inventoryCount === "number" ? row.inventoryCount : null,
    joinedAt: row.joinedAt instanceof Date || typeof row.joinedAt === "string" ? row.joinedAt : null,
    isOwner: row.isOwner === true || role === "owner",
    loginDisabled: row.loginDisabled === true,
  };
}

function roleLabel(member: EnterpriseMember) {
  if (member.isOwner) return "企业所有者";
  if (member.role === "admin") return "企业管理员";
  return "普通成员";
}

function memberStatusLabel(status: MemberStatus) {
  return status === "active" ? "正常" : "已暂停";
}

function loginStatusLabel(disabled: boolean) {
  return disabled ? "已禁用" : "可登录";
}

function PermissionSummary({ member }: { member: EnterpriseMember }) {
  if (member.isOwner) return <Badge variant="outline">全部权限</Badge>;
  if (!member.permissionKeys.length) return <span className="text-xs text-muted-foreground">未配置</span>;
  return (
    <div className="flex max-w-[260px] flex-wrap gap-1">
      {member.permissionKeys.slice(0, 2).map(key => (
        <Badge key={key} variant="outline" className="max-w-[108px] truncate font-normal">
          {ERP_PERMISSION_DEFINITIONS[key].label}
        </Badge>
      ))}
      {member.permissionKeys.length > 2 ? <Badge variant="outline">+{member.permissionKeys.length - 2}</Badge> : null}
    </div>
  );
}

/**
 * 后台只能通过 merchant scoped API 管理企业成员。canManage 只控制入口体验，
 * 服务端仍必须复核商户范围；登录启停也经同一企业绑定校验，不复用全局 userId 接口。
 */
export default function MerchantEnterpriseUsersPanel({
  merchantId,
  canManage,
}: {
  merchantId: number;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<MemberFilter>("all");
  const [managedMember, setManagedMember] = useState<EnterpriseMember | null>(null);
  const [permissions, setPermissions] = useState<ErpPermissionKey[]>([]);
  const [inventoryScope, setInventoryScope] = useState<InventoryScope>("own");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 这些端点由商户范围契约提供；保留显式 merchantId，禁止绕过到全局用户管理接口。
  const merchantApi = trpc.merchant as unknown as Record<string, any>;
  const membersQuery = merchantApi.enterpriseMembers.useQuery(
    { merchantId },
    { retry: false },
  ) as {
    data?: MembersResult;
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    error?: { message?: string };
  };
  const permissionMutation = merchantApi.setEnterpriseMemberPermissions.useMutation() as {
    mutateAsync: (input: Record<string, unknown>) => Promise<unknown>;
    isPending: boolean;
  };
  const scopeMutation = merchantApi.setEnterpriseMemberScope.useMutation() as {
    mutateAsync: (input: Record<string, unknown>) => Promise<unknown>;
    isPending: boolean;
  };
  const statusMutation = merchantApi.setEnterpriseMemberStatus.useMutation() as {
    mutateAsync: (input: Record<string, unknown>) => Promise<unknown>;
    isPending: boolean;
  };
  const loginMutation = merchantApi.setEnterpriseMemberLoginDisabled.useMutation() as {
    mutateAsync: (input: Record<string, unknown>) => Promise<unknown>;
    isPending: boolean;
  };

  const members = useMemo(
    () => ((membersQuery.data?.members ?? membersQuery.data?.items ?? []) as unknown[])
      .map(toMember)
      .filter(member => status === "all" || member.status === status),
    [membersQuery.data, status],
  );
  const busy = submitting || permissionMutation.isPending || scopeMutation.isPending
    || statusMutation.isPending || loginMutation.isPending;

  const refresh = async () => {
    await (utils.merchant as unknown as Record<string, any>).enterpriseMembers.invalidate();
  };

  const openManager = (member: EnterpriseMember) => {
    setManagedMember(member);
    setPermissions([...member.permissionKeys]);
    setInventoryScope(member.inventoryDataScope);
    setReason("");
  };

  const togglePermission = (key: ErpPermissionKey) => {
    setPermissions(current => current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key]);
  };

  const requireReason = () => {
    const normalized = reason.trim();
    if (!normalized) toast.error("请填写操作原因");
    return normalized;
  };

  const saveAccess = async () => {
    if (!managedMember || managedMember.isOwner || busy) return;
    const normalizedReason = requireReason();
    if (!normalizedReason) return;
    if (!permissions.length) {
      toast.error("请至少保留一项 ERP 权限");
      return;
    }
    setSubmitting(true);
    try {
      const operations: Promise<unknown>[] = [];
      if (permissions.join("|") !== managedMember.permissionKeys.join("|")) {
        operations.push(permissionMutation.mutateAsync({
          merchantId,
          targetUserId: managedMember.userId,
          permissionKeys: permissions,
          reason: normalizedReason,
          requestId: createRequestId("merchant-member-permissions"),
        }));
      }
      if (inventoryScope !== managedMember.inventoryDataScope) {
        operations.push(scopeMutation.mutateAsync({
          merchantId,
          targetUserId: managedMember.userId,
          inventoryDataScope: inventoryScope,
          reason: normalizedReason,
          requestId: createRequestId("merchant-member-scope"),
        }));
      }
      if (!operations.length) {
        toast.info("成员设置没有变化");
        setSubmitting(false);
        return;
      }
      await Promise.all(operations);
      toast.success("成员权限与业务范围已更新");
      setManagedMember(null);
      await refresh();
    } catch (error) {
      toast.error("成员设置更新失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMemberStatus = async () => {
    if (!managedMember || managedMember.isOwner || busy) return;
    const normalizedReason = requireReason();
    if (!normalizedReason) return;
    const nextStatus: MemberStatus = managedMember.status === "active" ? "suspended" : "active";
    setSubmitting(true);
    try {
      await statusMutation.mutateAsync({
        merchantId,
        targetUserId: managedMember.userId,
        status: nextStatus,
        reason: normalizedReason,
        requestId: createRequestId("merchant-member-status"),
      });
      toast.success(nextStatus === "active" ? "成员已恢复" : "成员已暂停");
      setManagedMember(null);
      await refresh();
    } catch (error) {
      toast.error(nextStatus === "active" ? "恢复失败" : "暂停失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleWebsiteLogin = async () => {
    if (!managedMember || managedMember.isOwner || busy) return;
    const normalizedReason = requireReason();
    if (!normalizedReason) return;
    const disabled = !managedMember.loginDisabled;
    setSubmitting(true);
    try {
      await loginMutation.mutateAsync({
        merchantId,
        targetUserId: managedMember.userId,
        disabled,
        reason: normalizedReason,
        requestId: createRequestId("merchant-member-login"),
      });
      toast.success(disabled ? "网站登录已禁用" : "网站登录已恢复");
      setManagedMember(null);
      await refresh();
    } catch (error) {
      toast.error(disabled ? "禁用登录失败" : "恢复登录失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border bg-white text-[13px]" data-merchant-enterprise-users>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold">企业用户</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">成员权限、业务范围及账号状态均按当前商户隔离。</p>
        </div>
        <Select value={status} onValueChange={value => setStatus(value as MemberFilter)}>
          <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="成员状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">正常</SelectItem>
            <SelectItem value="suspended">已暂停</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {membersQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在加载企业用户…
        </div>
      ) : membersQuery.isError ? (
        <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          企业用户加载失败：{membersQuery.error?.message || "请稍后重试"}
        </div>
      ) : membersQuery.data?.available === false ? (
        <div className="py-12 text-center text-muted-foreground">前台企业数据源暂不可用。</div>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Users className="mb-2 h-7 w-7 opacity-40" /> 暂无符合条件的企业用户
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block" data-responsive-member-table>
            <Table className="min-w-[1040px]">
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>用户</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>权限摘要</TableHead>
                  <TableHead>业务范围</TableHead>
                  <TableHead className="text-right">库存数</TableHead>
                  <TableHead>加入时间</TableHead>
                  <TableHead>成员状态</TableHead>
                  <TableHead>登录状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(member => (
                  <TableRow key={member.memberId}>
                    <TableCell>
                      <div className="font-medium">{member.displayName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{member.phone || member.username || "—"}</div>
                    </TableCell>
                    <TableCell>{roleLabel(member)}</TableCell>
                    <TableCell><PermissionSummary member={member} /></TableCell>
                    <TableCell>{member.isOwner || member.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"}</TableCell>
                    <TableCell className="text-right tabular-nums">{typeof member.inventoryCount === "number" ? member.inventoryCount.toLocaleString() : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{member.joinedAt ? formatBeijingDateTime(member.joinedAt) : "—"}</TableCell>
                    <TableCell><Badge variant={member.status === "active" ? "default" : "secondary"}>{memberStatusLabel(member.status)}</Badge></TableCell>
                    <TableCell>{loginStatusLabel(member.loginDisabled)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openManager(member)}>
                        管理
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2 p-3 lg:hidden" data-responsive-member-cards>
            {members.map(member => (
              <article key={member.memberId} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-semibold">{member.displayName}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{roleLabel(member)} · {member.phone || member.username || "—"}</p>
                  </div>
                  <Badge variant={member.status === "active" ? "default" : "secondary"}>{memberStatusLabel(member.status)}</Badge>
                </div>
                <div className="mt-3"><PermissionSummary member={member} /></div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">业务范围</dt><dd className="mt-0.5">{member.isOwner || member.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"}</dd></div>
                  <div><dt className="text-muted-foreground">库存数</dt><dd className="mt-0.5">{typeof member.inventoryCount === "number" ? member.inventoryCount.toLocaleString() : "—"}</dd></div>
                  <div><dt className="text-muted-foreground">登录状态</dt><dd className="mt-0.5">{loginStatusLabel(member.loginDisabled)}</dd></div>
                  <div><dt className="text-muted-foreground">加入时间</dt><dd className="mt-0.5">{member.joinedAt ? formatBeijingDateTime(member.joinedAt) : "—"}</dd></div>
                </dl>
                <Button size="sm" variant="outline" className="mt-3 h-8 w-full text-xs" onClick={() => openManager(member)}>管理</Button>
              </article>
            ))}
          </div>
        </>
      )}

      <Sheet open={Boolean(managedMember)} onOpenChange={open => { if (!open && !busy) setManagedMember(null); }}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-[540px]" data-member-management-sheet>
          <SheetHeader className="border-b px-5 py-4 pr-12">
            <SheetTitle className="text-[16px]">管理企业成员</SheetTitle>
            <SheetDescription className="text-xs">{managedMember ? `${managedMember.displayName} · ${roleLabel(managedMember)}` : "成员设置"}</SheetDescription>
          </SheetHeader>
          {managedMember ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-[13px]">
              {managedMember.isOwner ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900" data-owner-protection>
                  <div className="flex items-center gap-2 font-medium"><ShieldAlert className="h-4 w-4" /> 所有者保护</div>
                  <p className="mt-1 text-xs leading-5">企业所有者拥有全部权限和全企业业务范围，本页仅可查看，不能暂停或修改。</p>
                </div>
              ) : !canManage ? (
                <div className="rounded-md border bg-muted/30 p-3 text-muted-foreground">
                  当前账号仅可查看成员信息；服务端仍会复核商户管理权限。
                </div>
              ) : null}

              <section>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-[13px] font-medium">ERP 模块权限</h3><span className="text-xs text-muted-foreground">至少保留一项</span></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ERP_PERMISSION_KEYS.map(key => (
                    <label key={key} className="flex items-start gap-2 rounded-md border p-2.5">
                      <Checkbox
                        checked={managedMember.isOwner || permissions.includes(key)}
                        disabled={managedMember.isOwner || !canManage || busy}
                        onCheckedChange={() => togglePermission(key)}
                        aria-label={ERP_PERMISSION_DEFINITIONS[key].label}
                      />
                      <span><span className="block font-medium">{ERP_PERMISSION_DEFINITIONS[key].label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{ERP_PERMISSION_DEFINITIONS[key].description}</span></span>
                    </label>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-[13px] font-medium">业务范围</h3>
                <div className="grid grid-cols-2 gap-2">
                  {(["own", "enterprise"] as const).map(scope => (
                    <label key={scope} className={`rounded-md border p-3 ${inventoryScope === scope || managedMember.isOwner && scope === "enterprise" ? "border-primary bg-primary/5" : ""}`}>
                      <input
                        type="radio"
                        className="mr-2 accent-[#185FA5]"
                        name="merchant-member-scope"
                        checked={managedMember.isOwner ? scope === "enterprise" : inventoryScope === scope}
                        disabled={managedMember.isOwner || !canManage || busy}
                        onChange={() => setInventoryScope(scope)}
                      />
                      {scope === "own" ? "仅本人业务" : "全企业业务"}
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="merchant-member-reason" className="text-[13px]">操作原因 <span className="text-red-600">*</span></Label>
                <Textarea id="merchant-member-reason" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={managedMember.isOwner || !canManage || busy} placeholder="请填写本次权限、范围或状态变更原因" />
              </section>

              <section className="rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-medium">网站登录状态：{loginStatusLabel(managedMember.loginDisabled)}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">此操作影响整站登录；企业成员暂停仅影响企业身份，两者相互独立。</p>
                  </div>
                  {!managedMember.isOwner && canManage ? (
                    <Button type="button" variant="outline" className="h-8 text-xs" disabled={busy || !reason.trim()} onClick={() => void toggleWebsiteLogin()}>
                      {loginMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      {managedMember.loginDisabled ? "恢复网站登录" : "禁用网站登录"}
                    </Button>
                  ) : null}
                </div>
              </section>

              {!managedMember.isOwner && canManage ? (
                <section className="border-t pt-4">
                  <Button type="button" variant="outline" className="h-8 text-xs" disabled={busy || !reason.trim()} onClick={() => void toggleMemberStatus()}>
                    {statusMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    {managedMember.status === "active" ? "暂停成员" : "恢复成员"}
                  </Button>
                </section>
              ) : null}
            </div>
          ) : null}
          <SheetFooter className="flex-row items-center justify-end gap-2 border-t px-5 py-4">
            <Button variant="outline" onClick={() => setManagedMember(null)} disabled={busy}>取消</Button>
            <Button onClick={() => void saveAccess()} disabled={!managedMember || managedMember.isOwner || !canManage || busy || !reason.trim()}>
              {permissionMutation.isPending || scopeMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} 保存设置
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
