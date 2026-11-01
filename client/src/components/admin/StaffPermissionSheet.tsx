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
  ERP_PERMISSION_GROUPS,
  ERP_VISIBLE_PERMISSION_KEYS,
  STAFF_ADMIN_PERMISSION_GROUPS,
  adminPermissionsForUpdate,
  erpPermissionLabel,
  hasStaffDraftChanges,
  protectedStaffErpKeys,
  staffErpMutationGuard,
  staffChangePreview,
  staffDraftFromRow,
  toggleStaffErpPermission,
  type StaffErpEditorAccess,
  type StaffRow,
  type StaffSaveBaseline,
  type StaffSaveDraft,
  type StaffSaveOutcome,
} from "@/lib/staffPermissionModel";
import { ERP_PERMISSION_DEFINITIONS, type ErpPermissionKey } from "@/business/platform/shared/erpPermissions";
import { formatDateTime } from "@/components/admin/shared";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type SecurityLog = {
  id: number;
  success: boolean;
  riskLevel?: string | null;
  authMethod?: string | null;
  occurredAt: Date | string;
  ipAddress?: string | null;
  location?: string | null;
  operatingSystem?: string | null;
  browser?: string | null;
  deviceType?: string | null;
};

export type StaffEnterpriseEditorAccess = StaffErpEditorAccess & {
  inviteHref: string | null;
  unavailableReason?: string | null;
};

function roleLabel(role: string) {
  if (role === "super_admin") return "超级管理员";
  if (role === "merchant_mgr") return "普通用户";
  if (role === "operation") return "平台运营";
  if (role === "customer_svc") return "客服/售后";
  if (role === "risk_control") return "风控审核";
  if (role === "finance") return "财务结算";
  if (role === "auditor") return "审计人员";
  return role;
}

function loginMethodLabel(method: string | null | undefined) {
  if (method === "password") return "密码登录";
  if (method === "oauth") return "第三方授权";
  return method || "未知方式";
}

function toDraftBaseline(row: StaffRow): StaffSaveBaseline {
  return staffDraftFromRow(row);
}

function errorSummary(outcome: StaffSaveOutcome) {
  const completed: string[] = [];
  const failed: string[] = [];
  const steps: Array<[keyof StaffSaveOutcome["completed"], string]> = [
    ["erpPermissions", "业务权限"],
    ["erpScope", "业务范围"],
    ["admin", "后台权限"],
  ];
  for (const [step, label] of steps) {
    if (outcome.completed[step]) completed.push(`${label}已保存`);
    if (outcome.errors[step]) failed.push(`${label}失败：${outcome.errors[step]}`);
  }
  if (!failed.length) return completed.length ? completed.join("，") : "没有可保存的变更";
  return `${completed.length ? `${completed.join("，")}；` : ""}${failed.join("；")}`;
}

export default function StaffPermissionSheet({
  open,
  row,
  canManageAdmin,
  enterpriseAccess,
  saving,
  securityLogs,
  securityLoading,
  securityError,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  row: StaffRow | null;
  canManageAdmin: boolean;
  enterpriseAccess: StaffEnterpriseEditorAccess;
  saving: boolean;
  securityLogs?: SecurityLog[];
  securityLoading?: boolean;
  securityError?: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: StaffSaveDraft, baseline: StaffSaveBaseline) => Promise<StaffSaveOutcome>;
}) {
  const [draft, setDraft] = useState<StaffSaveDraft>(() => row ? staffDraftFromRow(row) : {
    adminRole: "merchant_mgr",
    adminPermissions: [],
    erpPermissionKeys: [],
    inventoryDataScope: "own",
  });
  const [baseline, setBaseline] = useState<StaffSaveBaseline>(() => row ? toDraftBaseline(row) : draft);
  const previousOpen = useRef(false);
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    const key = row?.key ?? null;
    if (open && row && (!previousOpen.current || previousKey.current !== key)) {
      const next = staffDraftFromRow(row);
      setDraft(next);
      setBaseline(next);
    }
    previousOpen.current = open;
    previousKey.current = key;
  }, [open, row]);

  const preview = useMemo(() => staffChangePreview(baseline, draft), [baseline, draft]);
  const hasChanges = hasStaffDraftChanges(baseline, draft);
  const admin = row?.admin;
  const member = row?.member;
  const canEditAdmin = Boolean(admin && canManageAdmin);
  const erpGuard = staffErpMutationGuard(row, enterpriseAccess);
  const canEditErp = erpGuard.allowed;
  const availableErpKeys = enterpriseAccess.grantableKeys;
  const availableErpSet = new Set(availableErpKeys);
  const lockedErpKeys = protectedStaffErpKeys(baseline.erpPermissionKeys, availableErpKeys, enterpriseAccess.actorIsOwner);
  const canEditErpPermissions = canEditErp && lockedErpKeys.length === 0;

  const updateAdminPermission = (permission: StaffSaveDraft["adminPermissions"][number]) => {
    setDraft(current => ({
      ...current,
      adminPermissions: current.adminPermissions.includes(permission)
        ? current.adminPermissions.filter(item => item !== permission)
        : [...current.adminPermissions, permission],
    }));
  };

  const updateErpPermission = (permission: ErpPermissionKey) => {
    if (!canEditErpPermissions) return;
    setDraft(current => ({
      ...current,
      erpPermissionKeys: toggleStaffErpPermission(current.erpPermissionKeys, permission, availableErpKeys, enterpriseAccess.actorIsOwner),
    }));
  };

  const handleSave = async () => {
    if (!row || saving) return;
    if (!hasChanges) {
      toast.info("没有需要保存的变更");
      return;
    }
    if (canEditErp && draft.erpPermissionKeys.length === 0) {
      toast.error("请至少保留一项 ERP 权限");
      return;
    }
    const outcome = await onSave(draft, baseline);
    const nextBaseline: StaffSaveBaseline = {
      ...baseline,
      ...(outcome.completed.erpPermissions ? { erpPermissionKeys: draft.erpPermissionKeys } : {}),
      ...(outcome.completed.erpScope ? { inventoryDataScope: draft.inventoryDataScope } : {}),
      ...(outcome.completed.admin ? {
        adminRole: draft.adminRole,
        adminPermissions: admin
          ? adminPermissionsForUpdate(admin.permissions, draft.adminPermissions, draft.adminRole)
            .filter(permission => !permission.startsWith("business.") && permission !== "profile.manage")
          : draft.adminPermissions,
      } : {}),
    };
    setBaseline(nextBaseline);
    if (Object.keys(outcome.errors).length === 0) {
      toast.success(errorSummary(outcome));
      onOpenChange(false);
    } else {
      toast.error("部分设置未保存", { description: errorSummary(outcome), duration: 8000 });
    }
  };

  const erpDescription = !member
    ? row?.bindingState === "bound"
      ? "该后台账号绑定的前台用户不是当前官方企业成员，系统不会按姓名或手机号补配。"
      : "该后台账号尚未关联当前官方企业成员；ERP 设置保持禁用。"
    : !erpGuard.allowed
      ? erpGuard.reason
      : "ERP 权限和业务范围仍由原站企业服务在每次请求中复核。";

  return (
    <Sheet open={open} onOpenChange={nextOpen => { if (!saving) onOpenChange(nextOpen); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-[680px]" data-staff-permission-sheet>
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle>员工与权限</SheetTitle>
          <SheetDescription>
            {row ? `${admin?.displayName || admin?.username || member?.displayName || "员工"} · 运营权限、ERP 权限和业务范围在同一窗口查看` : "选择员工后配置权限"}
          </SheetDescription>
        </SheetHeader>
        {row ? (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <section className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {admin ? <Badge variant="outline">后台账号：{admin.username}</Badge> : <Badge variant="outline">未关联后台账号</Badge>}
                {member ? <Badge variant="outline">企业成员：{member.isOwner ? "所有者" : member.status === "active" ? "正常" : "已暂停"}</Badge> : <Badge variant="outline">未关联企业成员</Badge>}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                员工关联仅以后台账号的 active `frontUserId` binding 与企业成员 `userId` 精确匹配；没有匹配时不会自动迁移、关联或合并登录身份。
              </p>
            </section>

            <section className="rounded-md border p-4" aria-labelledby="staff-bff-status-title">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <h3 id="staff-bff-status-title" className="text-sm font-medium">业务工作台前置状态</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.bff.detail}</p>
                  {row.bff.missingPermissions.length ? (
                    <p className="mt-2 break-words text-xs text-amber-700">缺少 BFF scope：{row.bff.missingPermissions.join("、")}</p>
                  ) : null}
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">已配置 ERP 业务权限不代表 BFF 全部可用；本页不会修改 binding 或商户 scope。</p>
                </div>
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="staff-admin-permissions-title">
              <div>
                <h3 id="staff-admin-permissions-title" className="text-sm font-medium">后台运营权限</h3>
                <p className="mt-1 text-xs text-muted-foreground">后台账户权限与企业 ERP 身份相互独立。保存沿用服务端的本人/最后管理员保护规则。</p>
              </div>
              {!admin ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">该行没有已关联后台账号，不能提交后台用户更新。</div>
              ) : !canManageAdmin ? (
                <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">当前账号没有 `admins.manage`，未读取也不能修改后台账户。</div>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-center">
                    <Label htmlFor="staff-admin-role">后台角色</Label>
                    <Select value={draft.adminRole} onValueChange={value => setDraft(current => ({ ...current, adminRole: value }))} disabled={saving}>
                      <SelectTrigger id="staff-admin-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(draft.adminRole !== "super_admin" && draft.adminRole !== "merchant_mgr") ? <SelectItem value={draft.adminRole} disabled>{roleLabel(draft.adminRole)}（历史角色，仅展示）</SelectItem> : null}
                        <SelectItem value="merchant_mgr">普通用户</SelectItem>
                        <SelectItem value="super_admin">超级管理员</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {draft.adminRole === "super_admin" ? (
                    <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">超级管理员的后台模块权限由服务端授予全部权限。</div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {STAFF_ADMIN_PERMISSION_GROUPS.map(group => (
                        <div key={group.title} className="rounded-md border p-3">
                          <p className="mb-2 text-xs font-medium">{group.title}</p>
                          <div className="space-y-2">
                            {group.options.map(option => (
                              <label key={option.key} className="flex cursor-pointer items-center gap-2 text-sm">
                                <Checkbox
                                  checked={draft.adminPermissions.includes(option.key)}
                                  disabled={saving}
                                  onCheckedChange={() => updateAdminPermission(option.key)}
                                  aria-label={`${group.title}${option.label}`}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="space-y-3 border-t pt-5" aria-labelledby="staff-erp-permissions-title">
              <div>
                <h3 id="staff-erp-permissions-title" className="text-sm font-medium">ERP 业务权限与业务范围</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{erpDescription}</p>
              </div>
              {member ? (
                <>
                  {lockedErpKeys.length && enterpriseAccess.available ? (
                    <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                      已有权限“{lockedErpKeys.map(erpPermissionLabel).join("、")}”超出你的可授予范围。为避免误撤销，ERP 权限在本窗口只读，请由企业所有者调整；现有权限不会被隐藏或删除。
                    </div>
                  ) : null}
                  <div className="space-y-4">
                    {ERP_PERMISSION_GROUPS.map(group => {
                      const keys = group.keys.filter(key => availableErpSet.has(key) || draft.erpPermissionKeys.includes(key));
                      if (!keys.length && !member.isOwner) return null;
                      return (
                        <div key={group.title}>
                          <p className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {(member.isOwner ? group.keys : keys).map(key => (
                              <label key={key} className="flex items-start gap-2 rounded-md border p-2.5">
                                <Checkbox
                                  checked={member.isOwner || draft.erpPermissionKeys.includes(key)}
                                  disabled={!canEditErpPermissions || saving || !availableErpSet.has(key)}
                                  onCheckedChange={() => updateErpPermission(key)}
                                  aria-label={ERP_PERMISSION_DEFINITIONS[key].label}
                                />
                                <span className="min-w-0"><span className="block text-sm font-medium">{ERP_PERMISSION_DEFINITIONS[key].label}</span><span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{ERP_PERMISSION_DEFINITIONS[key].description}</span></span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">业务范围</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="rounded-md border p-3 text-sm">
                        <input type="radio" className="mr-2 accent-primary" name="staff-business-scope" checked={draft.inventoryDataScope === "own" && !member.isOwner} disabled={!canEditErp || saving} onChange={() => setDraft(current => ({ ...current, inventoryDataScope: "own" }))} />
                        仅本人业务
                      </label>
                      <label className="rounded-md border p-3 text-sm">
                        <input type="radio" className="mr-2 accent-primary" name="staff-business-scope" checked={member.isOwner || draft.inventoryDataScope === "enterprise"} disabled={!canEditErp || !enterpriseAccess.actorIsOwner || saving} onChange={() => setDraft(current => ({ ...current, inventoryDataScope: "enterprise" }))} />
                        全企业业务
                      </label>
                    </div>
                    {!enterpriseAccess.actorIsOwner && canEditErp ? <p className="mt-1.5 text-xs text-muted-foreground">全企业业务仅当前企业所有者可授予。</p> : null}
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">没有可验证的企业成员记录，因此不会发起 ERP 读取或写入。</div>
              )}
            </section>

            <section className="space-y-3 border-t pt-5" aria-labelledby="staff-change-preview-title">
              <div><h3 id="staff-change-preview-title" className="text-sm font-medium">变更预览</h3><p className="mt-1 text-xs text-muted-foreground">跨服务保存不是原子操作；成功步骤会立即保留，失败步骤可在本窗口重试。</p></div>
              {!hasChanges ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">尚未修改设置。</p> : (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  {preview.roleChanged ? <p>后台角色：{roleLabel(baseline.adminRole)} → {roleLabel(draft.adminRole)}</p> : null}
                  {preview.adminAdded.length || preview.adminRemoved.length ? <p>后台权限：{preview.adminAdded.length ? `新增 ${preview.adminAdded.join("、")}` : ""}{preview.adminAdded.length && preview.adminRemoved.length ? "；" : ""}{preview.adminRemoved.length ? `撤销 ${preview.adminRemoved.join("、")}` : ""}</p> : null}
                  {preview.erpAdded.length || preview.erpRemoved.length ? <p>ERP 权限：{preview.erpAdded.length ? `新增 ${preview.erpAdded.map(erpPermissionLabel).join("、")}` : ""}{preview.erpAdded.length && preview.erpRemoved.length ? "；" : ""}{preview.erpRemoved.length ? `撤销 ${preview.erpRemoved.map(erpPermissionLabel).join("、")}` : ""}</p> : null}
                  {preview.scopeChanged ? <p>业务范围：{baseline.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"} → {draft.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"}</p> : null}
                  <p className="text-xs text-muted-foreground">BFF binding 与商户 scope 只读展示，永不随本次保存变更。</p>
                </div>
              )}
            </section>

            {admin && canManageAdmin ? (
              <section className="border-t pt-5" aria-labelledby="staff-login-security-title">
                <h3 id="staff-login-security-title" className="text-sm font-medium">登录安全</h3>
                <p className="mt-1 text-xs text-muted-foreground">以下为后台账户日志，不表示当前会话已额外认证。</p>
                {securityLoading ? <p className="mt-3 text-sm text-muted-foreground">正在加载登录记录…</p> : securityError ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">加载失败：{securityError}</p> : !securityLogs?.length ? <p className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">暂无登录安全记录。</p> : <div className="mt-3 space-y-2">{securityLogs.slice(0, 8).map(log => <div key={log.id} className="rounded-md border p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><span>{log.success ? "登录成功" : "登录失败"} · {loginMethodLabel(log.authMethod)}</span><span className="text-muted-foreground">{formatDateTime(log.occurredAt)}</span></div><p className="mt-1 text-muted-foreground">{log.ipAddress || "未知 IP"} · {log.location || "未知归属地"} · {log.operatingSystem || "未知系统"} / {log.browser || log.deviceType || "未知设备"}</p></div>)}</div>}
              </section>
            ) : null}

            <section className="flex flex-wrap gap-2 border-t pt-5 text-sm">
              {enterpriseAccess.inviteHref ? <a href={enterpriseAccess.inviteHref} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">员工邀请与业务交接 <ExternalLink className="h-3.5 w-3.5" /></a> : null}
              {canManageAdmin ? <a href="/admins" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline">新建后台账号与完整账号生命周期仍在旧入口 <ExternalLink className="h-3.5 w-3.5" /></a> : null}
            </section>
          </div>
        ) : null}
        <SheetFooter className="flex-row items-center justify-end gap-2 border-t bg-background px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={!row || saving || !hasChanges}>
            {saving ? "保存中…" : "保存变更"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
