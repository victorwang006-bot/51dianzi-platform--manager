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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ERP_PERMISSION_GROUPS,
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
import {
  ERP_PERMISSION_DEFINITIONS,
  type ErpPermissionKey,
} from "@/business/platform/shared/erpPermissions";
import { formatDateTime } from "@/components/admin/shared";
import OfficialTeamPermissionSection from "@/components/admin/OfficialTeamPermissionSection";
import { ExternalLink } from "lucide-react";
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

export type StaffPermissionSheetSection =
  | "basic"
  | "member"
  | "admin"
  | "official-team"
  | "erp"
  | "scope"
  | "status";

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
    if (outcome.errors[step])
      failed.push(`${label}失败：${outcome.errors[step]}`);
  }
  if (!failed.length)
    return completed.length ? completed.join("，") : "没有可保存的变更";
  return `${completed.length ? `${completed.join("，")}；` : ""}${failed.join("；")}`;
}

export default function StaffPermissionSheet({
  open,
  row,
  initialSection = "erp",
  canManageAdmin,
  enterpriseAccess,
  saving,
  securityLogs,
  securityLoading,
  securityError,
  officialTeamsOverview,
  officialTeamsLoading,
  officialTeamsError,
  onRetryOfficialTeams,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  row: StaffRow | null;
  initialSection?: StaffPermissionSheetSection;
  canManageAdmin: boolean;
  enterpriseAccess: StaffEnterpriseEditorAccess;
  saving: boolean;
  securityLogs?: SecurityLog[];
  securityLoading?: boolean;
  securityError?: string | null;
  /** Native officialTeams.overview response; never a merchant team projection. */
  officialTeamsOverview?: unknown;
  officialTeamsLoading?: boolean;
  officialTeamsError?: string | null;
  onRetryOfficialTeams: () => void;
  onOpenChange: (open: boolean) => void;
  onSave: (
    draft: StaffSaveDraft,
    baseline: StaffSaveBaseline
  ) => Promise<StaffSaveOutcome>;
}) {
  const [draft, setDraft] = useState<StaffSaveDraft>(() =>
    row
      ? staffDraftFromRow(row)
      : {
          adminRole: "merchant_mgr",
          adminPermissions: [],
          erpPermissionKeys: [],
          inventoryDataScope: "own",
        }
  );
  const [baseline, setBaseline] = useState<StaffSaveBaseline>(() =>
    row ? toDraftBaseline(row) : draft
  );
  const [activeSection, setActiveSection] =
    useState<StaffPermissionSheetSection>(initialSection);
  const previousOpen = useRef(false);
  const previousKey = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<
    Partial<Record<StaffPermissionSheetSection, HTMLElement | null>>
  >({});

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

  useEffect(() => {
    if (!open || !row) return;
    setActiveSection(initialSection);
    const frame = window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      const section = sectionRefs.current[initialSection];
      if (!body || !section) return;
      const top =
        section.getBoundingClientRect().top -
        body.getBoundingClientRect().top +
        body.scrollTop -
        12;
      body.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSection, open, row]);

  const preview = useMemo(
    () => staffChangePreview(baseline, draft),
    [baseline, draft]
  );
  const hasChanges = hasStaffDraftChanges(baseline, draft);
  const admin = row?.admin;
  const member = row?.member;
  const erpGuard = staffErpMutationGuard(row, enterpriseAccess);
  const canEditErp = erpGuard.allowed;
  const availableErpKeys = enterpriseAccess.grantableKeys;
  const availableErpSet = new Set(availableErpKeys);
  const lockedErpKeys = protectedStaffErpKeys(
    baseline.erpPermissionKeys,
    availableErpKeys,
    enterpriseAccess.actorIsOwner
  );
  const canEditErpPermissions = canEditErp && lockedErpKeys.length === 0;
  const adminStatus = admin
    ? admin.status === "active"
      ? { label: "启用", style: "success" }
      : admin.status === "locked"
        ? { label: "锁定", style: "warning" }
        : { label: "停用", style: "gray" }
    : null;

  const updateAdminPermission = (
    permission: StaffSaveDraft["adminPermissions"][number]
  ) => {
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
      erpPermissionKeys: toggleStaffErpPermission(
        current.erpPermissionKeys,
        permission,
        availableErpKeys,
        enterpriseAccess.actorIsOwner
      ),
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
      ...(outcome.completed.erpPermissions
        ? { erpPermissionKeys: draft.erpPermissionKeys }
        : {}),
      ...(outcome.completed.erpScope
        ? { inventoryDataScope: draft.inventoryDataScope }
        : {}),
      ...(outcome.completed.admin
        ? {
            adminRole: draft.adminRole,
            adminPermissions: admin
              ? adminPermissionsForUpdate(
                  admin.permissions,
                  draft.adminPermissions,
                  draft.adminRole
                ).filter(
                  permission =>
                    !permission.startsWith("business.") &&
                    permission !== "profile.manage"
                )
              : draft.adminPermissions,
          }
        : {}),
    };
    setBaseline(nextBaseline);
    if (Object.keys(outcome.errors).length === 0) {
      toast.success(errorSummary(outcome));
      onOpenChange(false);
    } else {
      toast.error("部分设置未保存", {
        description: errorSummary(outcome),
        duration: 8000,
      });
    }
  };

  const scrollToSection = (section: StaffPermissionSheetSection) => {
    setActiveSection(section);
    const body = bodyRef.current;
    const target = sectionRefs.current[section];
    if (!body || !target) return;
    const top =
      target.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop -
      12;
    body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={nextOpen => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-[720px]"
        data-staff-permission-sheet
      >
        <SheetHeader
          className="border-b px-4 py-3 pr-12"
          data-staff-permission-sheet-header
        >
          <SheetTitle>
            {row
              ? `${admin?.displayName || admin?.username || member?.displayName || "员工"} · 配置权限`
              : "配置权限"}
          </SheetTitle>
        </SheetHeader>
        {row ? (
          <>
            <nav
              className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b px-4"
              aria-label="员工配置分区"
              data-staff-permission-tabs
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 shrink-0 px-2 text-xs ${activeSection === "basic" ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                aria-current={activeSection === "basic" ? "page" : undefined}
                data-staff-section-tab="basic"
                onClick={() => scrollToSection("basic")}
              >
                基本信息
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 shrink-0 px-2 text-xs ${activeSection === "member" ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                aria-current={activeSection === "member" ? "page" : undefined}
                data-staff-section-tab="member"
                onClick={() => scrollToSection("member")}
              >
                成员关联
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 shrink-0 px-2 text-xs ${activeSection === "admin" ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                aria-current={activeSection === "admin" ? "page" : undefined}
                data-staff-section-tab="admin"
                onClick={() => scrollToSection("admin")}
              >
                后台角色
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 shrink-0 px-2 text-xs ${activeSection === "official-team" ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                aria-current={
                  activeSection === "official-team" ? "page" : undefined
                }
                data-staff-section-tab="official-team"
                onClick={() => scrollToSection("official-team")}
              >
                官方团队
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 shrink-0 px-2 text-xs ${activeSection === "erp" ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                aria-current={activeSection === "erp" ? "page" : undefined}
                data-staff-section-tab="erp"
                onClick={() => scrollToSection("erp")}
              >
                ERP 权限
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 shrink-0 px-2 text-xs ${activeSection === "scope" ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                aria-current={activeSection === "scope" ? "page" : undefined}
                data-staff-section-tab="scope"
                onClick={() => scrollToSection("scope")}
              >
                数据范围
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 shrink-0 px-2 text-xs ${activeSection === "status" ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                aria-current={activeSection === "status" ? "page" : undefined}
                data-staff-section-tab="status"
                onClick={() => scrollToSection("status")}
              >
                账号状态
              </Button>
            </nav>
            <div
              ref={bodyRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
              data-staff-permission-body
            >
              <section
                ref={node => {
                  sectionRefs.current.basic = node;
                }}
                className="rounded-md border p-3"
                aria-labelledby="staff-basic-title"
                data-staff-sheet-section="basic"
              >
                <div className="mb-2">
                  <h3 id="staff-basic-title" className="text-sm font-medium">
                    基本信息
                  </h3>
                </div>
                <dl className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">姓名</dt>
                    <dd className="mt-1 break-words font-medium">
                      {admin?.displayName ||
                        member?.displayName ||
                        admin?.username ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">后台账号</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {admin?.username || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">手机号</dt>
                    <dd className="mt-1 break-words">
                      {admin?.phone || member?.phone || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">邮箱</dt>
                    <dd className="mt-1 break-all">{admin?.email || "—"}</dd>
                  </div>
                </dl>
              </section>

              <section
                ref={node => {
                  sectionRefs.current.member = node;
                }}
                className="rounded-md border p-3"
                aria-labelledby="staff-member-title"
                data-staff-sheet-section="member"
              >
                <div className="mb-2">
                  <h3 id="staff-member-title" className="text-sm font-medium">
                    成员关联
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {admin ? (
                    <Badge variant="outline">后台账号：{admin.username}</Badge>
                  ) : (
                    <Badge variant="outline">暂无后台账号</Badge>
                  )}
                  {member ? (
                    <Badge variant="outline">
                      企业成员：
                      {member.isOwner
                        ? "所有者"
                        : member.status === "active"
                          ? "正常"
                          : "已暂停"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">待关联企业成员</Badge>
                  )}
                </div>
                {!admin || !member ? (
                  <div className="mt-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    该员工尚未完成关联。请使用现有员工邀请与业务交接流程处理。
                  </div>
                ) : null}
                {enterpriseAccess.inviteHref ? (
                  <a
                    href={enterpriseAccess.inviteHref}
                    className="mt-2 inline-flex h-8 items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                  >
                    员工邀请与业务交接 <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </section>

              <section
                ref={node => {
                  sectionRefs.current.admin = node;
                }}
                className="space-y-2 rounded-md border p-3"
                aria-labelledby="staff-admin-permissions-title"
                data-staff-sheet-section="admin"
              >
                <h3
                  id="staff-admin-permissions-title"
                  className="text-sm font-medium"
                >
                  后台角色
                </h3>
                {!admin ? (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    当前没有可配置的后台账号。
                  </div>
                ) : !canManageAdmin ? (
                  <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                    当前账号没有后台账户配置权限。
                  </div>
                ) : (
                  <>
                    <div className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-center">
                      <Label htmlFor="staff-admin-role">后台角色</Label>
                      <Select
                        value={draft.adminRole}
                        onValueChange={value =>
                          setDraft(current => ({
                            ...current,
                            adminRole: value,
                          }))
                        }
                        disabled={saving}
                      >
                        <SelectTrigger id="staff-admin-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {draft.adminRole !== "super_admin" &&
                          draft.adminRole !== "merchant_mgr" ? (
                            <SelectItem value={draft.adminRole} disabled>
                              {roleLabel(draft.adminRole)}（历史角色，仅展示）
                            </SelectItem>
                          ) : null}
                          <SelectItem value="merchant_mgr">普通用户</SelectItem>
                          <SelectItem value="super_admin">
                            超级管理员
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {draft.adminRole === "super_admin" ? (
                      <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                        超级管理员拥有全部后台模块权限。
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {STAFF_ADMIN_PERMISSION_GROUPS.map(group => (
                          <div
                            key={group.title}
                            className="rounded-md border p-2"
                          >
                            <p className="mb-1 text-xs font-medium">
                              {group.title}
                            </p>
                            <div className="space-y-1">
                              {group.options.map(option => (
                                <label
                                  key={option.key}
                                  className="flex h-8 cursor-pointer items-center gap-2 text-sm"
                                >
                                  <Checkbox
                                    checked={draft.adminPermissions.includes(
                                      option.key
                                    )}
                                    disabled={saving}
                                    onCheckedChange={() =>
                                      updateAdminPermission(option.key)
                                    }
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

              <div
                ref={node => {
                  sectionRefs.current["official-team"] = node;
                }}
              >
                <OfficialTeamPermissionSection
                  adminUserId={admin?.id ?? null}
                  hasRealAdminAccount={Boolean(admin)}
                  targetIsSuperAdmin={admin?.adminRole === "super_admin"}
                  overviewData={officialTeamsOverview}
                  overviewLoading={officialTeamsLoading === true}
                  overviewError={officialTeamsError ?? null}
                  onRetryOverview={onRetryOfficialTeams}
                />
              </div>

              <section
                ref={node => {
                  sectionRefs.current.erp = node;
                }}
                className="space-y-2 rounded-md border p-3"
                aria-labelledby="staff-erp-permissions-title"
                data-staff-sheet-section="erp"
              >
                <h3
                  id="staff-erp-permissions-title"
                  className="text-sm font-medium"
                >
                  ERP 权限
                </h3>
                {member ? (
                  <>
                    {lockedErpKeys.length && enterpriseAccess.available ? (
                      <div
                        role="status"
                        className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"
                      >
                        当前权限中包含你不能调整的项目，ERP 权限在本窗口只读。
                      </div>
                    ) : null}
                    {!canEditErp &&
                    !(lockedErpKeys.length && enterpriseAccess.available) ? (
                      <div
                        role="status"
                        className="rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground"
                      >
                        {erpGuard.reason}
                      </div>
                    ) : null}
                    <div className="space-y-3">
                      {ERP_PERMISSION_GROUPS.map(group => {
                        const keys = group.keys.filter(
                          key =>
                            availableErpSet.has(key) ||
                            draft.erpPermissionKeys.includes(key)
                        );
                        if (!keys.length && !member.isOwner) return null;
                        return (
                          <div key={group.title}>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              {group.title}
                            </p>
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              {(member.isOwner ? group.keys : keys).map(key => (
                                <label
                                  key={key}
                                  title={
                                    ERP_PERMISSION_DEFINITIONS[key].description
                                  }
                                  className="flex h-8 items-center gap-2 rounded-md border px-2 text-sm"
                                >
                                  <Checkbox
                                    checked={
                                      member.isOwner ||
                                      draft.erpPermissionKeys.includes(key)
                                    }
                                    disabled={
                                      !canEditErpPermissions ||
                                      saving ||
                                      !availableErpSet.has(key)
                                    }
                                    onCheckedChange={() =>
                                      updateErpPermission(key)
                                    }
                                    aria-label={
                                      ERP_PERMISSION_DEFINITIONS[key].label
                                    }
                                  />
                                  <span className="min-w-0 truncate font-medium">
                                    {ERP_PERMISSION_DEFINITIONS[key].label}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    完成成员关联后可查看和配置 ERP 权限。
                  </div>
                )}
              </section>

              <section
                ref={node => {
                  sectionRefs.current.scope = node;
                }}
                className="space-y-2 rounded-md border p-3"
                aria-labelledby="staff-scope-title"
                data-staff-sheet-section="scope"
              >
                <h3 id="staff-scope-title" className="text-sm font-medium">
                  数据范围
                </h3>
                {member ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="flex h-8 items-center rounded-md border px-2 text-sm">
                      <input
                        type="radio"
                        className="mr-2 accent-primary"
                        name="staff-business-scope"
                        checked={
                          draft.inventoryDataScope === "own" && !member.isOwner
                        }
                        disabled={!canEditErp || saving}
                        onChange={() =>
                          setDraft(current => ({
                            ...current,
                            inventoryDataScope: "own",
                          }))
                        }
                      />
                      仅本人业务
                    </label>
                    <label className="flex h-8 items-center rounded-md border px-2 text-sm">
                      <input
                        type="radio"
                        className="mr-2 accent-primary"
                        name="staff-business-scope"
                        checked={
                          member.isOwner ||
                          draft.inventoryDataScope === "enterprise"
                        }
                        disabled={
                          !canEditErp ||
                          !enterpriseAccess.actorIsOwner ||
                          saving
                        }
                        onChange={() =>
                          setDraft(current => ({
                            ...current,
                            inventoryDataScope: "enterprise",
                          }))
                        }
                      />
                      全企业业务
                    </label>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    完成成员关联后可配置数据范围。
                  </div>
                )}
              </section>

              <section
                ref={node => {
                  sectionRefs.current.status = node;
                }}
                className="space-y-2 rounded-md border p-3"
                aria-labelledby="staff-status-title"
                data-staff-sheet-section="status"
              >
                <h3 id="staff-status-title" className="text-sm font-medium">
                  账号状态
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border bg-muted/20 p-2">
                    <p className="text-xs text-muted-foreground">后台账号</p>
                    <div className="mt-1.5">
                      {adminStatus ? (
                        <Badge variant="outline">{adminStatus.label}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-2">
                    <p className="text-xs text-muted-foreground">企业成员</p>
                    <div className="mt-1.5">
                      {member ? (
                        <Badge variant="outline">
                          {member.status === "active" ? "正常" : "已暂停"}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section
                className="space-y-2 border-t pt-3"
                aria-labelledby="staff-change-preview-title"
              >
                <div>
                  <h3
                    id="staff-change-preview-title"
                    className="text-sm font-medium"
                  >
                    变更预览
                  </h3>
                </div>
                {!hasChanges ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    尚未修改设置。
                  </p>
                ) : (
                  <div className="space-y-2 rounded-md border p-3 text-sm">
                    {preview.roleChanged ? (
                      <p>
                        后台角色：{roleLabel(baseline.adminRole)} →{" "}
                        {roleLabel(draft.adminRole)}
                      </p>
                    ) : null}
                    {preview.adminAdded.length ||
                    preview.adminRemoved.length ? (
                      <p>
                        后台权限：
                        {preview.adminAdded.length
                          ? `新增 ${preview.adminAdded.join("、")}`
                          : ""}
                        {preview.adminAdded.length &&
                        preview.adminRemoved.length
                          ? "；"
                          : ""}
                        {preview.adminRemoved.length
                          ? `撤销 ${preview.adminRemoved.join("、")}`
                          : ""}
                      </p>
                    ) : null}
                    {preview.erpAdded.length || preview.erpRemoved.length ? (
                      <p>
                        ERP 权限：
                        {preview.erpAdded.length
                          ? `新增 ${preview.erpAdded.map(erpPermissionLabel).join("、")}`
                          : ""}
                        {preview.erpAdded.length && preview.erpRemoved.length
                          ? "；"
                          : ""}
                        {preview.erpRemoved.length
                          ? `撤销 ${preview.erpRemoved.map(erpPermissionLabel).join("、")}`
                          : ""}
                      </p>
                    ) : null}
                    {preview.scopeChanged ? (
                      <p>
                        数据范围：
                        {baseline.inventoryDataScope === "enterprise"
                          ? "全企业业务"
                          : "仅本人业务"}{" "}
                        →{" "}
                        {draft.inventoryDataScope === "enterprise"
                          ? "全企业业务"
                          : "仅本人业务"}
                      </p>
                    ) : null}
                  </div>
                )}
              </section>

              {admin && canManageAdmin ? (
                <section
                  className="border-t pt-3"
                  aria-labelledby="staff-login-security-title"
                >
                  <h3
                    id="staff-login-security-title"
                    className="text-sm font-medium"
                  >
                    登录记录
                  </h3>
                  {securityLoading ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      正在加载登录记录…
                    </p>
                  ) : securityError ? (
                    <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      加载失败：{securityError}
                    </p>
                  ) : !securityLogs?.length ? (
                    <p className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      暂无登录记录。
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {securityLogs.slice(0, 8).map(log => (
                        <div
                          key={log.id}
                          className="rounded-md border p-3 text-xs"
                        >
                          <div className="flex flex-wrap justify-between gap-2">
                            <span>
                              {log.success ? "登录成功" : "登录失败"} ·{" "}
                              {loginMethodLabel(log.authMethod)}
                            </span>
                            <span className="text-muted-foreground">
                              {formatDateTime(log.occurredAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            {log.ipAddress || "未知 IP"} ·{" "}
                            {log.location || "未知归属地"} ·{" "}
                            {log.operatingSystem || "未知系统"} /{" "}
                            {log.browser || log.deviceType || "未知设备"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          </>
        ) : null}
        <SheetFooter className="flex-row items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!row || saving || !hasChanges}
          >
            {saving ? "保存中…" : "保存变更"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
