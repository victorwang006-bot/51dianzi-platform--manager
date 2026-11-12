import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  STAFF_PERMISSION_TABS,
  staffDraftForPage,
  staffPermissionTab,
  type StaffPermissionTab,
  STAFF_ADMIN_PERMISSION_GROUPS,
  adminPermissionsForUpdate,
  applyStaffAdminPermissionTemplate,
  applyStaffErpPermissionTemplate,
  hasStaffDraftChanges,
  normalizeStaffAdminPermissions,
  protectedStaffAdminKeys,
  protectedStaffErpKeys,
  sameStringSet,
  STAFF_ADMIN_PERMISSION_TEMPLATES,
  STAFF_ERP_PERMISSION_TEMPLATES,
  STAFF_ERP_ADVANCED_KEYS,
  staffErpMutationGuard,
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
import { readOfficialTeamsOverview } from "@/lib/officialChannelInventoryUi";
import { formatDateTime } from "@/components/admin/shared";
import OfficialTeamPermissionSection, {
  type OfficialTeamPermissionHandle,
  type ChannelPermissionState,
  type StaffBusinessTeamEditor,
} from "@/components/admin/OfficialTeamPermissionSection";
import "./StaffPermissionSheet.css";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  businessTeam,
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
  businessTeam?: StaffBusinessTeamEditor;
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
  const [activeSection, setActiveSection] = useState<StaffPermissionTab>(
    staffPermissionTab(initialSection)
  );
  const [adminTemplate, setAdminTemplate] = useState("");
  const [erpTemplate, setErpTemplate] = useState("");
  const previousOpen = useRef(false);
  const previousKey = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const officialRef = useRef<OfficialTeamPermissionHandle>(null);
  const [channelState, setChannelState] = useState<ChannelPermissionState>({
    dirty: false,
    saving: false,
    canSave: false,
  });
  const [localSaving, setLocalSaving] = useState(false);
  const onChannelState = useCallback(
    (state: ChannelPermissionState) => setChannelState(state),
    []
  );
  const identityRef = useRef(row?.key);
  identityRef.current = row?.key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const key = row?.key ?? null;
    if (open && row && (!previousOpen.current || previousKey.current !== key)) {
      const next = staffDraftFromRow(row);
      setDraft(next);
      setBaseline(next);
      setActiveSection(staffPermissionTab(initialSection));
      setAdminTemplate("");
      setErpTemplate("");
    }
    previousOpen.current = open;
    previousKey.current = key;
  }, [open, row, initialSection]);
  const hasChanges = hasStaffDraftChanges(baseline, draft);
  const pageDraft = staffDraftForPage(activeSection, draft, baseline);
  const pageHasChanges =
    activeSection === "official-team"
      ? channelState.dirty
      : hasStaffDraftChanges(baseline, pageDraft);
  const busy = saving || localSaving || channelState.saving;
  const requestClose = (nextOpen: boolean) => {
    if (busy) return;
    if (
      !nextOpen &&
      (hasChanges || channelState.dirty) &&
      !window.confirm("有未保存的修改，关闭将放弃所有页签草稿。确定关闭？")
    )
      return;
    onOpenChange(nextOpen);
  };
  const admin = row?.admin;
  const member = row?.member;
  const nativeActor = readOfficialTeamsOverview(
    officialTeamsOverview
  ).serverScope;
  const targetIsSelf = Boolean(
    (member && enterpriseAccess.currentUserId === member.userId) ||
      (admin && nativeActor.available && nativeActor.adminUserId === admin.id)
  );
  const protectedAdminKeys = protectedStaffAdminKeys(admin?.permissions ?? []);
  const canEditAdmin = Boolean(
    admin &&
      canManageAdmin &&
      admin.status === "active" &&
      admin.adminRole !== "super_admin" &&
      !targetIsSelf &&
      protectedAdminKeys.length === 0
  );
  const erpGuard = staffErpMutationGuard(row, enterpriseAccess);
  const canEditErp = erpGuard.allowed && !targetIsSelf;
  const availableErpKeys = enterpriseAccess.grantableKeys;
  const availableErpSet = new Set(availableErpKeys);
  const lockedErpKeys = protectedStaffErpKeys(
    baseline.erpPermissionKeys,
    availableErpKeys,
    enterpriseAccess.actorIsOwner
  );
  const canEditErpPermissions = canEditErp && lockedErpKeys.length === 0;
  const erpPermissionsChanged = !sameStringSet(
    baseline.erpPermissionKeys,
    draft.erpPermissionKeys
  );
  const pageCanSave =
    activeSection === "official-team"
      ? channelState.canSave
      : activeSection === "admin"
        ? canEditAdmin
        : activeSection === "erp"
          ? canEditErp &&
            (!erpPermissionsChanged || canEditErpPermissions) &&
            (draft.inventoryDataScope === baseline.inventoryDataScope ||
              draft.inventoryDataScope === "own" ||
              enterpriseAccess.actorIsOwner)
          : false;
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
    if (!canEditAdmin || busy) return;
    setDraft(current => ({
      ...current,
      adminPermissions: current.adminPermissions.includes(permission)
        ? current.adminPermissions.filter(
            item =>
              item !== permission &&
              !STAFF_ADMIN_PERMISSION_GROUPS.flatMap(
                group => group.options
              ).some(
                option => option.key === item && option.requires === permission
              )
          )
        : normalizeStaffAdminPermissions([
            ...current.adminPermissions,
            permission,
          ]),
    }));
  };

  const updateErpPermission = (permission: ErpPermissionKey) => {
    if (!canEditErpPermissions || busy) return;
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

  const renderErpPermissions = (keys: readonly ErpPermissionKey[]) => (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {keys
        .filter(
          key =>
            member?.isOwner ||
            availableErpSet.has(key) ||
            draft.erpPermissionKeys.includes(key)
        )
        .map(key => (
          <label
            key={key}
            title={ERP_PERMISSION_DEFINITIONS[key].description}
            className="flex min-h-8 items-center gap-2 rounded-md border px-2 text-sm"
          >
            <Checkbox
              checked={member?.isOwner || draft.erpPermissionKeys.includes(key)}
              disabled={
                !canEditErpPermissions || busy || !availableErpSet.has(key)
              }
              onCheckedChange={() => updateErpPermission(key)}
              aria-label={ERP_PERMISSION_DEFINITIONS[key].label}
            />
            <span className="min-w-0 font-medium">
              {ERP_PERMISSION_DEFINITIONS[key].label}
            </span>
          </label>
        ))}
    </div>
  );

  const handleSave = async () => {
    if (!row || busy || !pageHasChanges || !pageCanSave) return;
    if (activeSection === "official-team") {
      await officialRef.current?.save();
      return;
    }
    if (activeSection !== "admin" && activeSection !== "erp") return;
    if (
      activeSection === "erp" &&
      canEditErp &&
      erpPermissionsChanged &&
      pageDraft.erpPermissionKeys.length === 0
    ) {
      toast.error("请至少保留一项 ERP 权限");
      return;
    }
    const saveKey = row.key;
    setLocalSaving(true);
    try {
      const outcome = await onSave(pageDraft, baseline);
      if (!mounted.current || identityRef.current !== saveKey) return;
      const nextBaseline: StaffSaveBaseline = {
        ...baseline,
        ...(outcome.completed.erpPermissions
          ? { erpPermissionKeys: pageDraft.erpPermissionKeys }
          : {}),
        ...(outcome.completed.erpScope
          ? { inventoryDataScope: pageDraft.inventoryDataScope }
          : {}),
        ...(outcome.completed.admin
          ? {
              adminRole: pageDraft.adminRole,
              adminPermissions: admin
                ? staffDraftFromRow({
                    ...row,
                    admin: {
                      ...admin,
                      adminRole: pageDraft.adminRole,
                      permissions: adminPermissionsForUpdate(
                        admin.permissions,
                        pageDraft.adminPermissions,
                        pageDraft.adminRole
                      ),
                    },
                  }).adminPermissions
                : pageDraft.adminPermissions,
            }
          : {}),
      };
      setBaseline(nextBaseline);
      setDraft(current => ({
        ...current,
        ...(outcome.completed.admin
          ? {
              adminRole: nextBaseline.adminRole,
              adminPermissions: nextBaseline.adminPermissions,
            }
          : {}),
        ...(outcome.completed.erpPermissions
          ? { erpPermissionKeys: nextBaseline.erpPermissionKeys }
          : {}),
        ...(outcome.completed.erpScope
          ? { inventoryDataScope: nextBaseline.inventoryDataScope }
          : {}),
      }));
      if (Object.keys(outcome.errors).length === 0)
        toast.success(errorSummary(outcome));
      else
        toast.error("部分设置未保存", {
          description: errorSummary(outcome),
          duration: 8000,
        });
    } catch (error) {
      if (mounted.current && identityRef.current === saveKey)
        toast.error("本页未保存，草稿已保留", {
          description: error instanceof Error ? error.message : "请稍后重试",
        });
    } finally {
      if (mounted.current && identityRef.current === saveKey)
        setLocalSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={requestClose}>
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
          {row && (
            <SheetDescription className="staff-permission-identity text-muted-foreground">
              {admin?.username || "暂无后台账号"} ·{" "}
              {roleLabel(admin?.adminRole || member?.role || "未关联")} ·{" "}
              {adminStatus?.label ||
                (member?.status === "active" ? "成员正常" : "待核验")}
            </SheetDescription>
          )}
        </SheetHeader>
        {row ? (
          <>
            <nav
              className="staff-permission-tabs flex shrink-0 items-center gap-1 overflow-x-auto border-b px-4"
              role="tablist"
              aria-label="员工配置页签"
              data-staff-permission-tabs
            >
              {STAFF_PERMISSION_TABS.map(tab => (
                <Button
                  key={tab.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  role="tab"
                  id={`staff-tab-${tab.id}`}
                  aria-controls={`staff-panel-${tab.id}`}
                  aria-selected={activeSection === tab.id}
                  className={`h-8 shrink-0 px-2 text-xs ${activeSection === tab.id ? "bg-primary/10 text-primary" : ""}`}
                  data-staff-section-tab={tab.id}
                  disabled={busy}
                  onClick={() => {
                    setActiveSection(tab.id);
                    if (bodyRef.current) bodyRef.current.scrollTop = 0;
                  }}
                >
                  {tab.label}
                </Button>
              ))}
            </nav>
            <div
              ref={bodyRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
              data-staff-permission-body
            >
              <div
                role="tabpanel"
                id="staff-panel-basic"
                aria-labelledby="staff-tab-basic"
                hidden={activeSection !== "basic"}
                className="staff-permission-panel space-y-3"
              >
                <section
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
                      <dt className="text-xs text-muted-foreground">
                        后台账号
                      </dt>
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
                      <Badge variant="outline">
                        后台账号：{admin.username}
                      </Badge>
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
                      员工邀请与业务交接{" "}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </section>
              </div>
              <div
                role="tabpanel"
                id="staff-panel-admin"
                aria-labelledby="staff-tab-admin"
                hidden={activeSection !== "admin"}
                className="staff-permission-panel"
              >
                <section
                  className="space-y-2 rounded-md border p-3"
                  aria-labelledby="staff-admin-permissions-title"
                  data-staff-sheet-section="admin"
                >
                  <h3
                    id="staff-admin-permissions-title"
                    className="text-sm font-medium"
                  >
                    平台操作权限
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
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>账号身份</span>
                        <Badge variant="outline">
                          {roleLabel(admin.adminRole)}（只读）
                        </Badge>
                      </div>
                      {!canEditAdmin && (
                        <p
                          role="status"
                          className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground"
                        >
                          {admin.adminRole === "super_admin"
                            ? "超级管理员由系统管理，本窗口保持只读。"
                            : targetIsSelf
                              ? "不能修改自己的权限。"
                              : protectedAdminKeys.length
                                ? "现有授权含不可授予或当前接口不支持的项目；为避免误删，本页只读。"
                                : "账号已停用或锁定，本页只读。"}
                        </p>
                      )}
                      {admin.adminRole === "super_admin" ? (
                        <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                          超级管理员拥有全部后台模块权限。
                        </div>
                      ) : (
                        <>
                          <div className="staff-permission-template">
                            <label htmlFor="staff-admin-template">
                              配置模板
                            </label>
                            <select
                              id="staff-admin-template"
                              value={adminTemplate}
                              disabled={!canEditAdmin || busy}
                              onChange={event =>
                                setAdminTemplate(event.target.value)
                              }
                            >
                              <option value="">保持现有配置</option>
                              {STAFF_ADMIN_PERMISSION_TEMPLATES.map(
                                template => (
                                  <option key={template.id} value={template.id}>
                                    {template.label}
                                  </option>
                                )
                              )}
                            </select>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!canEditAdmin || busy || !adminTemplate}
                              onClick={() =>
                                setDraft(current =>
                                  applyStaffAdminPermissionTemplate(
                                    current,
                                    adminTemplate
                                  )
                                )
                              }
                            >
                              应用平台模板到草稿
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            模板只替换下方操作草稿，不改账号角色、数据范围或渠道授权；检查后保存当前页才生效。
                          </p>
                          <div
                            className="staff-platform-matrix grid gap-2 sm:grid-cols-2"
                            aria-label="平台日常操作"
                          >
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
                                        disabled={!canEditAdmin || busy}
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
                          <details className="staff-permission-advanced">
                            <summary>服务与受保护授权（保留不变）</summary>
                            <p className="text-xs text-muted-foreground">
                              个人信息、BFF
                              服务键与渠道原生权限不进入日常矩阵，也不会被模板覆盖。
                            </p>
                            <ul className="staff-permission-service-keys">
                              {admin.permissions
                                .filter(
                                  key =>
                                    key === "profile.manage" ||
                                    key.startsWith("business.") ||
                                    key.startsWith("official") ||
                                    protectedAdminKeys.includes(key)
                                )
                                .map(key => (
                                  <li key={key}>
                                    <code>{key}</code>
                                  </li>
                                ))}
                            </ul>
                          </details>
                        </>
                      )}
                    </>
                  )}
                </section>
              </div>
              <div
                role="tabpanel"
                id="staff-panel-official-team"
                aria-labelledby="staff-tab-official-team"
                hidden={activeSection !== "official-team"}
                className="staff-permission-panel"
              >
                <OfficialTeamPermissionSection
                  ref={officialRef}
                  businessTeam={businessTeam}
                  onStateChange={onChannelState}
                  adminUserId={admin?.id ?? null}
                  hasRealAdminAccount={Boolean(admin)}
                  targetIsActive={admin?.status === "active"}
                  targetIsSuperAdmin={admin?.adminRole === "super_admin"}
                  targetIsSelf={targetIsSelf}
                  targetHasProtectedPermissions={protectedAdminKeys.length > 0}
                  overviewData={officialTeamsOverview}
                  overviewLoading={officialTeamsLoading === true}
                  overviewError={officialTeamsError ?? null}
                  onRetryOverview={onRetryOfficialTeams}
                />
              </div>

              <div
                role="tabpanel"
                id="staff-panel-erp"
                aria-labelledby="staff-tab-erp"
                hidden={activeSection !== "erp"}
                className="staff-permission-panel space-y-3"
              >
                <section
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
                      <div className="staff-permission-template">
                        <label htmlFor="staff-erp-template">操作模板</label>
                        <select
                          id="staff-erp-template"
                          value={erpTemplate}
                          disabled={!canEditErpPermissions || busy}
                          onChange={event => setErpTemplate(event.target.value)}
                        >
                          <option value="">保持现有配置</option>
                          {STAFF_ERP_PERMISSION_TEMPLATES.map(template => (
                            <option key={template.id} value={template.id}>
                              {template.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            !canEditErpPermissions || busy || !erpTemplate
                          }
                          onClick={() =>
                            setDraft(current =>
                              applyStaffErpPermissionTemplate(
                                current,
                                erpTemplate,
                                row,
                                enterpriseAccess
                              )
                            )
                          }
                        >
                          添加业务模板到草稿
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        仅添加你可授予的日常操作，保留已有权限；不授予全量客户或成员管理，不改变任何数据范围。
                      </p>
                      <p className="text-xs text-muted-foreground" role="note" aria-label="库存管理授权影响">
                        库存协作模板包含库存管理权限；保存后，在原生读取、业务范围和渠道授权等条件同时满足时，也可能允许渠道导出。当前没有独立的导出或来源开关，来源仍按已授权渠道及关联客户权限校验。
                      </p>
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
                          {erpGuard.allowed
                            ? "不能修改自己的 ERP 权限或业务范围。"
                            : erpGuard.reason}
                        </div>
                      ) : null}
                      <div className="space-y-3">
                        {ERP_PERMISSION_GROUPS.map(group => {
                          const keys = group.keys.filter(
                            key =>
                              !STAFF_ERP_ADVANCED_KEYS.includes(key) &&
                              (member.isOwner ||
                                availableErpSet.has(key) ||
                                draft.erpPermissionKeys.includes(key))
                          );
                          if (!keys.length) return null;
                          return (
                            <div key={group.title}>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">
                                {group.title}
                              </p>
                              {renderErpPermissions(keys)}
                            </div>
                          );
                        })}
                      </div>
                      <details className="staff-permission-advanced">
                        <summary>
                          高风险能力与历史授权（已选{" "}
                          {member.isOwner
                            ? STAFF_ERP_ADVANCED_KEYS.length
                            : draft.erpPermissionKeys.filter(
                                key =>
                                  STAFF_ERP_ADVANCED_KEYS.includes(key) ||
                                  key === "inventory.dashboard"
                              ).length}{" "}
                          项）
                        </summary>
                        <p className="text-xs text-muted-foreground">
                          全量客户管理和成员管理单独控制，不包含在日常模板内。
                        </p>
                        {renderErpPermissions(STAFF_ERP_ADVANCED_KEYS)}
                        {draft.erpPermissionKeys.includes(
                          "inventory.dashboard"
                        ) && (
                          <p className="text-xs text-muted-foreground">
                            库存看板：历史授权保留，已并入入库管理，不在此单独调整。
                          </p>
                        )}
                      </details>
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      完成成员关联后可查看和配置 ERP 权限。
                    </div>
                  )}
                </section>

                <section
                  className="space-y-2 rounded-md border p-3"
                  aria-labelledby="staff-scope-title"
                  data-staff-sheet-section="scope"
                >
                  <h3 id="staff-scope-title" className="text-sm font-medium">
                    ERP 数据范围
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    沿用原有 ERP
                    本人/全企业设置；全企业仅所有者可显式授予。业务模块已有本人/本组/企业范围配置，不由账号角色或模板推导。
                    此处不改变渠道库存的业务团队及显式分享范围。
                  </p>
                  {member ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="flex h-8 items-center rounded-md border px-2 text-sm">
                        <input
                          type="radio"
                          className="mr-2 accent-primary"
                          name="staff-business-scope"
                          checked={
                            draft.inventoryDataScope === "own" &&
                            !member.isOwner
                          }
                          disabled={!canEditErp || busy}
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
                            busy
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
              </div>
              <div
                role="tabpanel"
                id="staff-panel-status"
                aria-labelledby="staff-tab-status"
                hidden={activeSection !== "status"}
                className="staff-permission-panel space-y-3"
              >
                <section
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
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
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
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
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
            </div>
          </>
        ) : null}
        <SheetFooter className="staff-permission-footer shrink-0 flex-row items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button
            variant="outline"
            onClick={() => requestClose(false)}
            disabled={busy}
          >
            关闭
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!row || busy || !pageHasChanges || !pageCanSave}
          >
            {busy ? "保存中…" : "保存当前页"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
