import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateTime,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  getAdminRolePermissions,
  type AdminPermission,
} from "@shared/adminPermissions";
import { LogOut, Pencil, Plus, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type AdminRole =
  | "super_admin"
  | "operation"
  | "merchant_mgr"
  | "customer_svc"
  | "risk_control"
  | "finance"
  | "auditor";

/**
 * 可选角色（与生产保持一致）。
 *
 * 只保留 super_admin 与 merchant_mgr 两项，原因：
 * shared/adminPermissions.ts 的权限表仅为这两个角色定义了权限集，
 * 其余历史角色（operation / customer_svc / risk_control / finance / auditor）
 * 若可被选中，建出的账号登录后将不具备任何权限（空壳账号），
 * 反而造成误解。生产库实测也只存在这两种角色在用。
 *
 * 注意：AdminRole 类型仍保留全部 7 个取值，以便存量数据（若有）
 * 在列表里仍能正常显示角色名，而不会因查不到映射而显示为原始枚举值。
 */
const roleOptions: { value: AdminRole; label: string; duties: string }[] = [
  { value: "super_admin", label: "超级管理员", duties: "全部菜单、全部商户、全部订单和账号管理权限" },
  { value: "merchant_mgr", label: "普通用户", duties: "仅商户管理、订单中心，并按销售权限限制数据范围" },
];

/** 历史角色显示名（不在下拉中提供，仅用于存量数据展示） */
const legacyRoleLabels: Partial<Record<AdminRole, string>> = {
  operation: "平台运营",
  customer_svc: "客服/售后",
  risk_control: "风控审核",
  finance: "财务结算",
  auditor: "审计人员",
};

/** 角色显示名解析：优先可选项，其次历史角色，最后降级为原始值 */
function resolveRoleLabel(role: AdminRole | string): string {
  return (
    roleOptions.find(r => r.value === role)?.label
    ?? legacyRoleLabels[role as AdminRole]
    ?? role
  );
}

function securityPresentation(risk: string | null | undefined) {
  if (risk === "high") return { label: "高风险", style: "danger" as const, Icon: ShieldAlert };
  if (risk === "attention") return { label: "需关注", style: "warning" as const, Icon: ShieldAlert };
  if (risk === "normal") return { label: "正常", style: "success" as const, Icon: ShieldCheck };
  return { label: "安全基线未建立", style: "gray" as const, Icon: ShieldQuestion };
}

function loginMethodLabel(value: string | null | undefined) {
  if (value === "password") return "密码登录";
  if (value === "oauth") return "第三方授权";
  return value || "未知方式";
}

type SecurityTarget = { id: number; label: string };

const roleStyleMap: Record<AdminRole, "danger" | "info" | "warning" | "success" | "gray"> = {
  super_admin: "danger",
  operation: "info",
  merchant_mgr: "info",
  customer_svc: "info",
  risk_control: "warning",
  finance: "success",
  auditor: "gray",
};

type ModulePermissionOption = {
  label: string;
  value: AdminPermission;
  requires?: AdminPermission;
};

const modulePermissionGroups: { module: string; options: ModulePermissionOption[] }[] = [
  {
    module: "数据物料库",
    options: [
      { label: "查看", value: "materials.read" },
      { label: "维护", value: "materials.write", requires: "materials.read" },
    ],
  },
  {
    module: "商户管理",
    options: [
      { label: "查看", value: "merchants.read" },
      { label: "维护", value: "merchants.write", requires: "merchants.read" },
    ],
  },
  {
    module: "用户管理",
    options: [
      { label: "查看", value: "portalUsers.read" },
      { label: "管理", value: "portalUsers.manage", requires: "portalUsers.read" },
    ],
  },
  {
    module: "消息中心",
    options: [
      { label: "查看", value: "messages.read" },
      { label: "处理", value: "messages.write", requires: "messages.read" },
    ],
  },
  {
    module: "订单管理",
    options: [{ label: "查看", value: "orders.read" }],
  },
  {
    module: "运营数据",
    options: [{ label: "查看", value: "analytics.read" }],
  },
];

const defaultNormalPermissions = getAdminRolePermissions("merchant_mgr")
  .filter(permission => permission !== "profile.manage") as AdminPermission[];

const assignableModulePermissions = new Set<AdminPermission>(
  modulePermissionGroups.flatMap(group => group.options.map(option => option.value)),
);

function normalizeModulePermissions(permissions: readonly AdminPermission[]) {
  // profile.manage 等系统固定权限由服务端自动保留，不能作为可分配模块权限回传。
  const next = new Set(permissions.filter(permission => assignableModulePermissions.has(permission)));
  for (const group of modulePermissionGroups) {
    for (const option of group.options) {
      if (option.requires && next.has(option.value)) next.add(option.requires);
    }
  }
  return Array.from(next);
}

/**
 * 展示销售可见范围。
 * 仅包含本人时显示「仅本人」；含他人时列出工号，超过 3 个折叠。
 */
function renderModulePermissions(role: AdminRole | string, permissions?: string[]) {
  if (role === "super_admin") return <span className="text-muted-foreground">全部模块</span>;
  const effectivePermissions = permissions?.length
    ? permissions
    : getAdminRolePermissions(role as AdminRole);
  const labels = modulePermissionGroups
    .filter(group => group.options.some(option => effectivePermissions.includes(option.value)))
    .map(group => group.module);
  if (labels.length === 0) return <span className="text-muted-foreground">-</span>;
  const full = labels.join("、");
  return (
    <span
      className="inline-block max-w-[170px] truncate align-middle"
      title={full}
      aria-label={`模块权限：${full}`}
    >
      {full}
    </span>
  );
}

function renderSalesScope(codes: string[], ownCode: string | null) {
  if (codes.length === 0) return <span className="text-muted-foreground">-</span>;
  const others = ownCode ? codes.filter(c => c !== ownCode) : codes;
  if (others.length === 0) return <span className="text-muted-foreground">仅本人</span>;
  const shown = others.slice(0, 3).join("、");
  const rest = others.length - 3;
  const full = codes.join("、");
  return (
    <span
      className="inline-block max-w-[150px] truncate align-middle"
      title={full}
      aria-label={`销售权限：${full}`}
    >
      本人 + {shown}{rest > 0 ? ` 等 ${others.length} 人` : ""}
    </span>
  );
}

type FormState = {
  username: string;
  displayName: string;
  email: string;
  phone: string;
  adminRole: AdminRole;
  /** 追加的销售可见范围工号（本人工号由后端自动并入） */
  salesStaffCodes: string[];
  /** 普通用户的业务模块权限；超级管理员忽略 */
  permissions: AdminPermission[];
  password: string;
};

const emptyForm: FormState = {
  username: "",
  displayName: "",
  email: "",
  phone: "",
  adminRole: "merchant_mgr",
  salesStaffCodes: [],
  permissions: defaultNormalPermissions,
  password: "",
};

export default function Admins() {
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();
  const { data, isLoading, isFetching, refetch } = trpc.adminUser.list.useQuery({ page, pageSize: 20 });
  const [securityTarget, setSecurityTarget] = useState<SecurityTarget | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<SecurityTarget | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const loginHistoryQuery = trpc.adminUser.loginHistory.useQuery(
    { id: securityTarget?.id ?? 1, limit: 50 },
    { enabled: Boolean(securityTarget), retry: 1 },
  );

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  // 销售身份名单（含已停用）：历史范围里可能含已停用工号，不拉全量会导致回填时显示不出来
  const { data: salesStaff = [] } = trpc.salesStaff.list.useQuery({ includeInactive: true });

  // 建/改/停用/删除后台用户都会连带变更销售身份，因此两个缓存必须同时失效
  const invalidateAll = () => {
    utils.adminUser.list.invalidate();
    utils.salesStaff.list.invalidate();
  };

  const createMutation = trpc.adminUser.create.useMutation({
    onSuccess: () => {
      invalidateAll();
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success("用户创建成功");
    },
    onError: (e) => toast.error(`创建失败：${e.message}`),
  });

  const updateMutation = trpc.adminUser.update.useMutation({
    onSuccess: () => {
      invalidateAll();
      setDialogOpen(false);
      setEditingId(null);
      toast.success("用户信息已更新");
    },
    onError: (e) => toast.error(`更新失败：${e.message}`),
  });

  const toggleMutation = trpc.adminUser.toggleStatus.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success("状态已更新");
    },
    onError: (e) => toast.error(`操作失败：${e.message}`),
  });

  const removeMutation = trpc.adminUser.remove.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success("用户已删除");
    },
    onError: (e) => toast.error(`删除失败：${e.message}`),
  });

  const revokeSessionsMutation = trpc.adminUser.revokeSessions.useMutation({
    onSuccess: async () => {
      toast.success("该员工的全部既有登录会话已失效");
      setRevokeTarget(null);
      setRevokeReason("");
      await utils.adminUser.list.invalidate();
    },
    onError: (e) => toast.error(`强制退出失败：${e.message}`),
  });

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(a: NonNullable<typeof data>["data"][0]) {
    setEditingId(a.id);
    setForm({
      username: a.username,
      displayName: a.displayName ?? "",
      email: a.email ?? "",
      phone: a.phone ?? "",
      adminRole: a.adminRole as AdminRole,
      salesStaffCodes: a.salesStaffCodes ?? [],
      permissions: a.adminRole === "super_admin"
        ? []
        : normalizeModulePermissions((a.permissions?.length ? a.permissions : defaultNormalPermissions) as AdminPermission[]),
      password: "",
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.username.trim()) {
      toast.error("用户名不能为空");
      return;
    }
    if (editingId === null && form.password.length < 8) {
      toast.error("初始密码至少 8 位");
      return;
    }
    if (editingId !== null && form.password && form.password.length < 8) {
      toast.error("重置密码至少 8 位");
      return;
    }
    const normalizedPermissions = normalizeModulePermissions(form.permissions);
    const hasBusinessPermission = modulePermissionGroups.some(group =>
      group.options.some(option => normalizedPermissions.includes(option.value)),
    );
    if (form.adminRole !== "super_admin" && !hasBusinessPermission) {
      toast.error("普通用户至少需要一个业务模块权限");
      return;
    }
    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      adminRole: form.adminRole,
      // 超级管理员无需销售范围（本来就看得到全部数据）
      salesStaffCodes: form.adminRole === "super_admin" ? [] : form.salesStaffCodes,
      permissions: form.adminRole === "super_admin" ? [] : normalizedPermissions,
    };
    if (editingId !== null) {
      updateMutation.mutate({
        id: editingId,
        ...payload,
        ...(form.password ? { password: form.password } : {}),
      });
    } else {
      createMutation.mutate({ ...payload, password: form.password });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout>
      <PageHeader
        title="用户管理"
        description="普通用户创建后自动生成销售身份并默认绑定本人；可追加其他普通用户形成主管范围"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              新建用户
            </Button>
          </div>
        }
      />

      {/* 用户列表 */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">用户账户列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="暂无用户账户，点击右上角「新建用户」添加第一个用户。" />
          ) : (
            <>
              <div className="admin-user-table min-w-0">
                <table className="admin-table admin-user-responsive-table table-fixed">
                  <colgroup>
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "23%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "8%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>账号</th>
                      <th>权限范围</th>
                      <th>联系方式</th>
                      <th>状态 / 登录安全</th>
                      <th>时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(a => {
                      const target = { id: a.id, label: a.displayName || a.username };
                      const security = securityPresentation(a.securityRiskLevel);
                      const SecurityIcon = security.Icon;
                      return (
                      <tr key={a.id}>
                        <td data-label="账号" className="whitespace-normal align-top">
                          <div className="break-all font-mono text-xs font-medium">{a.username}</div>
                          <div className="mt-1 break-words text-sm">{a.displayName || "未填写名称"}</div>
                          <div className="mt-1"><StatusBadge label={resolveRoleLabel(a.adminRole)} style={roleStyleMap[a.adminRole as AdminRole] ?? "info"} /></div>
                        </td>
                        <td data-label="权限范围" className="whitespace-normal align-top text-xs">
                          <div><span className="text-muted-foreground">模块：</span>{renderModulePermissions(a.adminRole, a.permissions)}</div>
                          <div className="mt-1"><span className="text-muted-foreground">销售：</span>{a.adminRole === "super_admin" ? "全部销售范围" : renderSalesScope(a.salesStaffCodes ?? [], a.ownSalesStaffCode ?? null)}</div>
                        </td>
                        <td data-label="联系方式" className="whitespace-normal align-top text-xs">
                          <div className="break-all">{a.phone || "未填写手机号"}</div>
                          <div className="mt-1 break-all text-muted-foreground">{a.email || "未填写邮箱"}</div>
                        </td>
                        <td data-label="状态 / 登录安全" className="whitespace-normal align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge label={a.status === "active" ? "启用" : a.status === "locked" ? "锁定" : "停用"} style={a.status === "active" ? "success" : a.status === "locked" ? "warning" : "gray"} />
                            <StatusBadge label={security.label} style={security.style} />
                          </div>
                          <button
                            type="button"
                            className="mt-2 flex w-full items-start gap-2 rounded-md border bg-background p-2 text-left text-xs transition-colors hover:border-blue-200 hover:bg-blue-50/40"
                            onClick={() => setSecurityTarget(target)}
                            title="查看登录安全记录"
                          >
                            <SecurityIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#185FA5]" />
                            <span className="min-w-0">
                              <span className="block break-all text-foreground/80">{a.lastLoginIpAddress || "下次登录后记录IP"}</span>
                              <span className="mt-0.5 block break-words text-muted-foreground">{a.lastLoginLocation || "暂无归属地"}{a.lastLoginDevice ? ` · ${a.lastLoginDevice}` : ""}</span>
                            </span>
                          </button>
                        </td>
                        <td data-label="时间" className="whitespace-normal align-top text-xs text-muted-foreground">
                          <div><span className="text-foreground/70">登录</span> {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : "暂无登录"}</div>
                          <div className="mt-1"><span className="text-foreground/70">创建</span> {formatDateTime(a.createdAt)}</div>
                        </td>
                        <td data-label="操作" className="whitespace-normal align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => setSecurityTarget(target)} title="登录安全">
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openEdit(a)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleMutation.mutate({ id: a.id, status: a.status === "active" ? "disabled" : "active" })}
                            >
                              {a.status === "active" ? "停用" : "启用"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(`确认删除用户「${a.username}」？此操作不可撤销。`)) {
                                  removeMutation.mutate({ id: a.id });
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(securityTarget)} onOpenChange={open => !open && setSecurityTarget(null)}>
        <DialogContent className="flex max-h-[88vh] w-[min(94vw,900px)] max-w-none flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" />登录安全</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {securityTarget?.label}（ID {securityTarget?.id}）最近50条登录事件。IP归属地为网络出口的粗略位置，不代表员工实时位置。
            </p>
          </DialogHeader>
          <div className="min-h-40 flex-1 overflow-y-auto pr-1">
            {loginHistoryQuery.isLoading ? (
              <div className="flex min-h-40 items-center justify-center"><Skeleton className="h-24 w-full" /></div>
            ) : loginHistoryQuery.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">加载失败：{loginHistoryQuery.error.message}</div>
            ) : !loginHistoryQuery.data?.length ? (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                暂无登录安全记录。该员工下一次重新登录后，将开始记录准确时间、IP、归属地与设备信息。
              </div>
            ) : (
              <div className="space-y-2">
                {loginHistoryQuery.data.map(item => {
                  const security = securityPresentation(item.riskLevel);
                  const SecurityIcon = security.Icon;
                  return (
                    <div key={item.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge label={item.success ? "登录成功" : "登录失败"} style={item.success ? "success" : "danger"} />
                          <StatusBadge label={security.label} style={security.style} />
                          <span className="text-xs">{loginMethodLabel(item.authMethod)}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDateTime(item.occurredAt)}</span>
                      </div>
                      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        <div className="min-w-0"><span className="text-muted-foreground">网络：</span><span className="break-all">{item.ipAddress}</span> · {item.location || "未知归属地"}</div>
                        <div className="min-w-0"><span className="text-muted-foreground">设备：</span>{item.operatingSystem} · {item.browser} · {item.deviceType}</div>
                      </div>
                      {item.riskReason && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                          <SecurityIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />判断说明：{item.riskReason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setSecurityTarget(null)}>关闭</Button>
            {securityTarget && (
              <Button
                variant="destructive"
                onClick={() => {
                  setRevokeTarget(securityTarget);
                  setSecurityTarget(null);
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />强制退出全部设备
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revokeTarget)} onOpenChange={open => !open && !revokeSessionsMutation.isPending && setRevokeTarget(null)}>
        <DialogContent className="w-[min(92vw,520px)] max-w-none">
          <DialogHeader>
            <DialogTitle>强制退出全部设备</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {revokeTarget?.label} 的全部既有后台会话将立即失效，员工需重新登录。此操作会写入审计日志。
            </p>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">操作原因</Label>
            <Textarea id="revoke-reason" value={revokeReason} onChange={event => setRevokeReason(event.target.value)} maxLength={500} rows={3} placeholder="例如：发现异常登录，要求重新验证账号" />
            <div className="text-right text-xs text-muted-foreground">{revokeReason.length}/500</div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={revokeSessionsMutation.isPending} onClick={() => setRevokeTarget(null)}>取消</Button>
            <Button
              variant="destructive"
              disabled={revokeSessionsMutation.isPending || revokeReason.trim().length < 2}
              onClick={() => revokeTarget && revokeSessionsMutation.mutate({ id: revokeTarget.id, reason: revokeReason.trim() })}
            >
              {revokeSessionsMutation.isPending ? "处理中..." : "确认强制退出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建/编辑用户弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[88vh] w-[min(92vw,560px)] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{editingId !== null ? "编辑用户" : "新建用户"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5">
              <Label>用户名 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="登录用户名（唯一）"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                disabled={editingId !== null}
              />
              {editingId !== null && (
                <p className="text-xs text-muted-foreground">用户名创建后不可修改</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>显示名称</Label>
              <Input
                placeholder="姓名或昵称"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>角色权限 <span className="text-destructive">*</span></Label>
              <Select
                value={form.adminRole}
                onValueChange={v => setForm(f => ({
                  ...f,
                  adminRole: v as AdminRole,
                  // 切到超级管理员时清空已选范围，避免提交无意义的销售权限
                  salesStaffCodes: v === "super_admin" ? [] : f.salesStaffCodes,
                  permissions: v === "super_admin"
                    ? []
                    : (f.permissions.length > 0 ? f.permissions : defaultNormalPermissions),
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className="font-medium">{r.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">— {r.duties.slice(0, 18)}…</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div>
                <Label>模块权限</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  超级管理员默认拥有全部模块；普通用户按业务模块授权，销售权限仍单独控制数据范围。
                </p>
              </div>
              {form.adminRole === "super_admin" ? (
                <div className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
                  全部菜单、全部商户、全部订单和账号管理权限
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {modulePermissionGroups.map(group => (
                    <div key={group.module} className="rounded-md border bg-background p-2">
                      <div className="mb-1 text-xs font-medium">{group.module}</div>
                      <div className="flex flex-wrap gap-2">
                        {group.options.map(option => {
                          const checked = form.permissions.includes(option.value);
                          return (
                            <label key={option.value} className="flex cursor-pointer items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5"
                                checked={checked}
                                onChange={() => setForm(f => {
                                  const next = checked
                                    ? f.permissions.filter(permission => permission !== option.value)
                                    : [...f.permissions, option.value];
                                  return { ...f, permissions: normalizeModulePermissions(next) };
                                })}
                              />
                              <span>{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {form.adminRole !== "super_admin" && (
              <div className="space-y-1.5">
                <Label>销售权限</Label>
                <p className="text-xs text-muted-foreground">
                  默认仅本人；可追加其他普通用户
                </p>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2 pr-3">
                  {salesStaff.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">暂无可分配的销售员工</p>
                  ) : (
                    salesStaff.map(s => {
                      const checked = form.salesStaffCodes.includes(s.staffCode);
                      return (
                        <label
                          key={s.staffCode}
                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/50"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={checked}
                            onChange={() => setForm(f => ({
                              ...f,
                              salesStaffCodes: checked
                                ? f.salesStaffCodes.filter(c => c !== s.staffCode)
                                : [...f.salesStaffCodes, s.staffCode],
                            }))}
                          />
                          <span className="font-medium">{s.displayName}</span>
                          <span className="font-mono text-muted-foreground">{s.staffCode}</span>
                          {s.status !== "active" && (
                            <span className="text-muted-foreground">（已停用）</span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  新用户自动绑定本人；勾选其他用户可形成主管范围
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>手机号</Label>
              <Input
                placeholder="绑定手机号（可选）"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>邮箱</Label>
              <Input
                type="email"
                placeholder="绑定邮箱（可选）"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {editingId !== null ? "重置密码" : <>初始密码 <span className="text-destructive">*</span></>}
              </Label>
              <Input
                type="password"
                placeholder={editingId !== null ? "留空则不修改密码" : "登录密码（至少 8 位）"}
                value={form.password}
                autoComplete="new-password"
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
              {editingId !== null && (
                <p className="text-xs text-muted-foreground">填写后将重置该账号的登录密码</p>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? "保存中..." : editingId !== null ? "保存修改" : "创建用户"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <style>{`
        .admin-user-responsive-table th,
        .admin-user-responsive-table td {
          min-width: 0;
          white-space: normal;
          vertical-align: top;
        }
        .admin-user-responsive-table th {
          padding-left: 12px;
          padding-right: 12px;
        }
        .admin-user-responsive-table td {
          padding-left: 12px;
          padding-right: 12px;
        }
        @media (max-width: 1100px) {
          .admin-user-responsive-table,
          .admin-user-responsive-table tbody {
            display: block;
            width: 100%;
          }
          .admin-user-responsive-table colgroup,
          .admin-user-responsive-table thead {
            display: none;
          }
          .admin-user-responsive-table tbody {
            display: grid;
            gap: 12px;
            padding: 12px;
          }
          .admin-user-responsive-table tbody tr {
            display: grid;
            overflow: hidden;
            border: 1px solid var(--border);
            border-radius: 10px;
          }
          .admin-user-responsive-table tbody td {
            display: grid;
            width: auto !important;
            min-width: 0;
            grid-template-columns: 7rem minmax(0, 1fr);
            gap: 12px;
            white-space: normal;
          }
          .admin-user-responsive-table tbody td::before {
            content: attr(data-label);
            color: var(--muted-foreground);
            font-size: 12px;
            font-weight: 500;
          }
        }
      `}</style>
    </DashboardLayout>
  );
}
