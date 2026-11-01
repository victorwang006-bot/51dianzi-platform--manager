import { useAuth } from "@/_core/hooks/useAuth";
import StaffPermissionSheet, { type StaffEnterpriseEditorAccess } from "@/components/admin/StaffPermissionSheet";
import { EmptyState, PageHeader, Pagination, StatusBadge } from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createBusinessScopeTrpcClient,
  createBusinessTrpcClient,
} from "@/business/api/business-trpc";
import {
  ERP_PERMISSION_DEFINITIONS,
  ERP_VISIBLE_PERMISSION_KEYS,
  normalizeErpPermissions,
  type ErpPermissionKey,
} from "@/business/platform/shared/erpPermissions";
import {
  OFFICIAL_STAFF_MERCHANT_ID,
  adminPermissionsForUpdate,
  exactMerchantScope,
  mergeStaffRows,
  parseEnterpriseMembers,
  parseStaffBinding,
  positiveInteger,
  protectedStaffErpKeys,
  readStaffMerchantSelection,
  runGuardedStaffErpMutation,
  sameStringSet,
  selectOfficialStaffMerchant,
  staffErpMutationGuard,
  staffQueryKey,
  staffQueryPrefix,
  validateStaffBusinessContext,
  validateStaffEnterpriseSummary,
  type BindingReadState,
  type ScopeReadState,
  type StaffAdminAccount,
  type StaffBusinessContext,
  type StaffRow,
  type StaffSaveBaseline,
  type StaffSaveDraft,
  type StaffSaveOutcome,
} from "@/lib/staffPermissionModel";
import { trpc } from "@/lib/trpc";
import { hasAdminPermission } from "@shared/adminPermissions";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";

const PAGE_SIZE = 20;

type StaffStatusFilter = "all" | "active" | "disabled" | "locked" | "suspended";

function requestId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${suffix}`.slice(0, 64);
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "请稍后重试";
}

function roleLabel(role: string | null | undefined) {
  const labels: Record<string, string> = {
    super_admin: "超级管理员",
    merchant_mgr: "普通用户",
    operation: "平台运营",
    customer_svc: "客服/售后",
    risk_control: "风控审核",
    finance: "财务结算",
    auditor: "审计人员",
  };
  return labels[role ?? ""] ?? role ?? "—";
}

function accountStatus(account: StaffAdminAccount) {
  if (account.status === "active") return { label: "启用", style: "success" as const };
  if (account.status === "locked") return { label: "锁定", style: "warning" as const };
  return { label: "停用", style: "gray" as const };
}

function bffBadge(row: StaffRow) {
  const labels = {
    "not-applicable": { label: "待关联", style: "gray" as const },
    checking: { label: "核验中", style: "warning" as const },
    unlinked: { label: "未关联", style: "warning" as const },
    "scope-unavailable": { label: "缺少 BFF scope", style: "danger" as const },
    "scope-incomplete": { label: "BFF 范围不完整", style: "warning" as const },
    ready: { label: "BFF 前置已匹配", style: "success" as const },
  };
  return labels[row.bff.state];
}

function adminPermissionSummary(account?: StaffAdminAccount) {
  if (!account) return "未关联后台账号";
  if (account.adminRole === "super_admin") return "全部后台模块";
  const labels: Array<[string, string]> = [
    ["materials.read", "物料"],
    ["merchants.read", "商户"],
    ["portalUsers.read", "用户"],
    ["messages.read", "消息"],
    ["orders.read", "订单"],
    ["analytics.read", "数据"],
  ];
  const selected = labels.filter(([permission]) => account.permissions.includes(permission)).map(([, label]) => label);
  return selected.length ? selected.join("、") : "未配置可见运营模块";
}

function erpPermissionSummary(row: StaffRow) {
  const member = row.member;
  if (!member) return "未关联企业成员";
  if (member.isOwner) return "企业所有者（全部 ERP 权限）";
  if (!member.permissionKeys.length) return "未配置 ERP 模块权限";
  return member.permissionKeys.map(key => ERP_PERMISSION_DEFINITIONS[key].label).join("、");
}

function parseEnterpriseAccess(
  value: unknown,
  context: StaffBusinessContext | null,
  fallbackReason: string | null,
  merchantId: number | null,
): StaffEnterpriseEditorAccess {
  if (!context) {
    return {
      available: false,
      canManageMembers: false,
      actorIsOwner: false,
      currentUserId: null,
      grantableKeys: [],
      inviteHref: merchantId ? `/workbench/add-user?merchantId=${merchantId}` : null,
      unavailableReason: fallbackReason || "业务上下文未安全就绪。",
    };
  }
  if (!value || typeof value !== "object") {
    return {
      available: false,
      canManageMembers: false,
      actorIsOwner: false,
      currentUserId: null,
      grantableKeys: [],
      inviteHref: merchantId ? `/workbench/add-user?merchantId=${merchantId}` : null,
      unavailableReason: "企业权限摘要未返回。",
    };
  }
  if (!validateStaffEnterpriseSummary(value, context)) {
    return {
      available: false,
      canManageMembers: false,
      actorIsOwner: false,
      currentUserId: null,
      grantableKeys: [],
      inviteHref: null,
      unavailableReason: "企业权限摘要与已核验的企业或业务员工不一致，成员查询和业务设置已停止。",
    };
  }
  const source = value as Record<string, unknown>;
  const permissions = source.permissions && typeof source.permissions === "object"
    ? source.permissions as Record<string, unknown>
    : null;
  const currentUserId = positiveInteger(source.currentUserId);
  const actorIsOwner = source.isOwner === true;
  const canManageMembers = permissions?.manageMembers === true;
  const ownKeys = normalizeErpPermissions(Array.isArray(source.permissionKeys)
    ? source.permissionKeys.filter((key): key is string => typeof key === "string")
    : []);
  const grantableKeys = actorIsOwner
    ? [...ERP_VISIBLE_PERMISSION_KEYS]
    : ownKeys.filter(key => ERP_VISIBLE_PERMISSION_KEYS.includes(key));
  return {
    available: Boolean(source.enterprise) && currentUserId !== null,
    canManageMembers,
    actorIsOwner,
    currentUserId,
    grantableKeys,
    inviteHref: merchantId && canManageMembers ? `/workbench/add-user?merchantId=${merchantId}` : null,
    unavailableReason: !source.enterprise
      ? "当前已验证的前台员工尚未加入企业。"
      : !canManageMembers
        ? "当前前台业务员工没有企业成员管理权限。"
        : null,
  };
}

function matchesFilter(row: StaffRow, keyword: string, status: StaffStatusFilter) {
  const normalized = keyword.trim().toLocaleLowerCase();
  const haystack = [
    row.admin?.username,
    row.admin?.displayName,
    row.admin?.email,
    row.admin?.phone,
    row.member?.displayName,
    row.member?.phone,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  if (normalized && !haystack.includes(normalized)) return false;
  if (status === "all") return true;
  return row.admin?.status === status || row.member?.status === status;
}

export default function Staff() {
  const { user } = useAuth();
  const search = useSearch();
  const trpcUtils = trpc.useUtils();
  const queryClient = useQueryClient();
  const accountId = positiveInteger(user?.id);
  const adminRole = typeof (user as { adminRole?: unknown } | null)?.adminRole === "string"
    ? (user as { adminRole: string }).adminRole
    : "";
  const rawPermissions = Array.isArray((user as { permissions?: readonly unknown[] } | null)?.permissions)
    ? (user as { permissions: readonly unknown[] }).permissions.filter((permission): permission is string => typeof permission === "string")
    : undefined;
  const canManageAdmin = hasAdminPermission(adminRole, "admins.manage", rawPermissions);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StaffStatusFilter>("all");
  const [selectedRow, setSelectedRow] = useState<StaffRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [keyword, status]);

  useEffect(() => () => {
    queryClient.removeQueries({ queryKey: staffQueryPrefix(accountId) });
  }, [accountId, queryClient]);

  const adminUsersQuery = trpc.adminUser.list.useQuery(
    { page, pageSize: PAGE_SIZE },
    { enabled: canManageAdmin, retry: false, refetchOnWindowFocus: false },
  );
  const adminAccounts = (adminUsersQuery.data?.data ?? []) as unknown as StaffAdminAccount[];

  const navigationQuery = useQuery({
    queryKey: staffQueryKey(accountId, null, "navigation"),
    queryFn: () => trpcUtils.client.business.navigation.query(),
    enabled: accountId !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const merchantSelection = useMemo(() => readStaffMerchantSelection(search), [search]);
  const officialMerchant = useMemo(() => navigationQuery.isSuccess
    ? selectOfficialStaffMerchant(navigationQuery.data, merchantSelection)
    : { merchantId: null, reason: null }, [merchantSelection, navigationQuery.data, navigationQuery.isSuccess]);
  const merchantId = officialMerchant.merchantId;

  const scopeClient = useMemo(
    () => merchantId ? createBusinessScopeTrpcClient(merchantId) : null,
    [merchantId],
  );
  const domainClient = useMemo(
    () => merchantId ? createBusinessTrpcClient(merchantId) : null,
    [merchantId],
  );
  const contextQuery = useQuery({
    queryKey: staffQueryKey(accountId, merchantId, "context"),
    queryFn: async () => {
      if (!scopeClient) throw new Error("业务商户尚未通过导航核验");
      return scopeClient.context.query();
    },
    enabled: merchantId !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const contextValidation = useMemo(() => {
    if (!contextQuery.isSuccess) return { context: null, reason: null };
    // The model performs the same ready/user/admin/enterprise/exact-merchant proof as the workbench.
    return validateStaffBusinessContext(contextQuery.data, accountId, merchantId);
  }, [accountId, contextQuery.data, contextQuery.isSuccess, merchantId]);
  const contextReady = contextValidation.context !== null;

  const enterpriseMeQuery = useQuery({
    queryKey: staffQueryKey(accountId, merchantId, "enterprise-me"),
    queryFn: async () => {
      if (!domainClient) throw new Error("业务商户尚未通过上下文核验");
      return domainClient.enterprise.me.query();
    },
    enabled: contextReady,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const enterpriseAccess = useMemo(() => parseEnterpriseAccess(
    enterpriseMeQuery.data,
    enterpriseMeQuery.isSuccess ? contextValidation.context : null,
    contextValidation.reason || (enterpriseMeQuery.isError ? errorMessage(enterpriseMeQuery.error) : null),
    merchantId,
  ), [contextValidation.context, contextValidation.reason, enterpriseMeQuery.data, enterpriseMeQuery.error, enterpriseMeQuery.isError, enterpriseMeQuery.isSuccess, merchantId]);
  const enterpriseMembersQuery = useQuery({
    queryKey: staffQueryKey(accountId, merchantId, "enterprise-members"),
    queryFn: async () => {
      if (!domainClient) throw new Error("业务商户尚未通过上下文核验");
      return domainClient.enterprise.members.query();
    },
    enabled: contextReady && enterpriseAccess.available && enterpriseAccess.canManageMembers,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const enterpriseMembers = useMemo(
    () => enterpriseMembersQuery.isSuccess ? parseEnterpriseMembers(enterpriseMembersQuery.data) : [],
    [enterpriseMembersQuery.data, enterpriseMembersQuery.isSuccess],
  );

  const bindingQueries = useQueries({
    queries: adminAccounts.map(account => ({
      queryKey: staffQueryKey(accountId, merchantId, "binding", account.id),
      queryFn: () => trpcUtils.client.business.staffBindings.current.query({ adminUserId: account.id }),
      enabled: canManageAdmin,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  const scopeQueries = useQueries({
    queries: adminAccounts.map(account => ({
      queryKey: staffQueryKey(accountId, merchantId, "merchant-scope", account.id),
      queryFn: () => trpcUtils.client.business.merchantScopes.current.query({ adminUserId: account.id }),
      enabled: canManageAdmin,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  const staffRows = useMemo(() => {
    const bindings = new Map<number, { state: BindingReadState; binding: ReturnType<typeof parseStaffBinding> }>();
    const scopes = new Map<number, { state: ScopeReadState; scope: ReturnType<typeof exactMerchantScope> }>();
    adminAccounts.forEach((account, index) => {
      const bindingQuery = bindingQueries[index];
      const binding = bindingQuery?.isSuccess ? parseStaffBinding(bindingQuery.data, account.id) : null;
      const state: BindingReadState = !canManageAdmin
        ? "not-requested"
        : bindingQuery?.isPending
          ? "loading"
          : bindingQuery?.isError
            ? "error"
            : binding ? "bound" : "unbound";
      bindings.set(account.id, { state, binding });
      const scopeQuery = scopeQueries[index];
      const scope = scopeQuery?.isSuccess ? exactMerchantScope(scopeQuery.data, merchantId) : null;
      const scopeState: ScopeReadState = !canManageAdmin
        ? "not-requested"
        : scopeQuery?.isPending
          ? "loading"
          : scopeQuery?.isError
            ? "error"
            : scope ? "ready" : "missing";
      scopes.set(account.id, { state: scopeState, scope });
    });
    return mergeStaffRows({ admins: adminAccounts, members: enterpriseMembers, bindings, scopes, expectedMerchantId: merchantId });
  }, [adminAccounts, bindingQueries, canManageAdmin, enterpriseMembers, merchantId, scopeQueries]);
  const visibleRows = useMemo(
    () => staffRows.filter(row => matchesFilter(row, keyword, status)),
    [keyword, staffRows, status],
  );

  const loginHistoryQuery = trpc.adminUser.loginHistory.useQuery(
    { id: selectedRow?.admin?.id ?? 1, limit: 50 },
    { enabled: canManageAdmin && Boolean(selectedRow?.admin), retry: false, refetchOnWindowFocus: false },
  );

  const adminUpdate = trpc.adminUser.update.useMutation();

  const refreshBusinessMembers = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: staffQueryKey(accountId, merchantId, "enterprise-me") }),
      queryClient.invalidateQueries({ queryKey: staffQueryKey(accountId, merchantId, "enterprise-members") }),
    ]);
  };

  const saveSelected = async (draft: StaffSaveDraft, baseline: StaffSaveBaseline): Promise<StaffSaveOutcome> => {
    const row = selectedRow;
    const outcome: StaffSaveOutcome = {
      completed: { erpPermissions: false, erpScope: false, admin: false },
      errors: {},
    };
    if (!row) return outcome;
    setSaving(true);
    try {
      // ERP writes use the live merged row rather than the snapshot captured
      // when the sheet opened. Pending/error/mismatched binding or scope reads
      // therefore cannot inherit a previously ready state.
      const currentErpRow = staffRows.find(candidate => candidate.key === row.key);
      const erpGuard = staffErpMutationGuard(currentErpRow, enterpriseAccess);
      const canEditErp = erpGuard.allowed;
      const lockedPermissionKeys = protectedStaffErpKeys(baseline.erpPermissionKeys, enterpriseAccess.grantableKeys, enterpriseAccess.actorIsOwner);
      const canEditErpPermissions = canEditErp && lockedPermissionKeys.length === 0;
      const erpPermissionsChanged = !sameStringSet(baseline.erpPermissionKeys, draft.erpPermissionKeys);
      const erpScopeChanged = baseline.inventoryDataScope !== draft.inventoryDataScope;
      if (erpPermissionsChanged && !canEditErpPermissions) {
        outcome.errors.erpPermissions = lockedPermissionKeys.length
          ? "该员工已有超出当前操作者可授予范围的权限；为避免误撤销，请由企业所有者调整。"
          : erpGuard.allowed ? "当前状态不允许修改该企业成员的 ERP 权限" : erpGuard.reason;
      }
      if (erpScopeChanged && !canEditErp) {
        outcome.errors.erpScope = erpGuard.allowed ? "当前状态不允许修改该企业成员的业务范围" : erpGuard.reason;
      }
      if (canEditErpPermissions && currentErpRow?.member && erpPermissionsChanged) {
        try {
          const execution = await runGuardedStaffErpMutation(currentErpRow, enterpriseAccess, async () => {
            if (!domainClient) throw new Error("业务客户端未就绪");
            if (!draft.erpPermissionKeys.length) throw new Error("请至少保留一项 ERP 权限");
            if (draft.erpPermissionKeys.some(key => !enterpriseAccess.grantableKeys.includes(key))) {
              throw new Error("只能授予当前前台业务员工已拥有的 ERP 权限");
            }
            return domainClient.enterprise.updatePermissions.mutate({
              userId: currentErpRow.member!.userId,
              permissionKeys: draft.erpPermissionKeys,
              requestId: requestId("staff_erp_permissions"),
            });
          });
          if (!execution.allowed) {
            outcome.errors.erpPermissions = execution.reason;
          } else {
            outcome.completed.erpPermissions = true;
            await refreshBusinessMembers();
          }
        } catch (error) {
          outcome.errors.erpPermissions = errorMessage(error);
        }
      }
      if (canEditErp && currentErpRow?.member && erpScopeChanged) {
        try {
          const execution = await runGuardedStaffErpMutation(currentErpRow, enterpriseAccess, async () => {
            if (!domainClient) throw new Error("业务客户端未就绪");
            if (draft.inventoryDataScope === "enterprise" && !enterpriseAccess.actorIsOwner) {
              throw new Error("全企业业务仅当前企业所有者可授予");
            }
            return domainClient.enterprise.updateInventoryScope.mutate({
              userId: currentErpRow.member!.userId,
              inventoryDataScope: draft.inventoryDataScope,
              requestId: requestId("staff_erp_scope"),
            });
          });
          if (!execution.allowed) {
            outcome.errors.erpScope = execution.reason;
          } else {
            outcome.completed.erpScope = true;
            await refreshBusinessMembers();
          }
        } catch (error) {
          outcome.errors.erpScope = errorMessage(error);
        }
      }
      const adminChanged = Boolean(row.admin) && (
        baseline.adminRole !== draft.adminRole
        || !sameStringSet(baseline.adminPermissions, draft.adminPermissions)
      );
      if (row.admin && adminChanged && !canManageAdmin) {
        outcome.errors.admin = "当前账号没有 admins.manage，后台权限未保存";
      }
      if (canManageAdmin && row.admin && adminChanged) {
        try {
          await adminUpdate.mutateAsync({
            id: row.admin.id,
            adminRole: draft.adminRole as never,
            permissions: adminPermissionsForUpdate(row.admin.permissions, draft.adminPermissions, draft.adminRole),
          });
          outcome.completed.admin = true;
          await trpcUtils.adminUser.list.invalidate();
        } catch (error) {
          outcome.errors.admin = errorMessage(error);
        }
      }
      return outcome;
    } finally {
      setSaving(false);
    }
  };

  const selectedCurrentRow = useMemo(
    () => selectedRow ? staffRows.find(candidate => candidate.key === selectedRow.key) ?? null : null,
    [selectedRow, staffRows],
  );

  const businessNotice = (() => {
    if (navigationQuery.isPending) return { tone: "muted", message: "正在读取当前账号可见的业务商户；后台账户列表不受此读取影响。" };
    if (navigationQuery.isError) return { tone: "warn", message: `业务商户授权暂不可读：${errorMessage(navigationQuery.error)}。后台运营员工仍可查看。` };
    if (navigationQuery.isSuccess && officialMerchant.reason) return { tone: "warn", message: officialMerchant.reason };
    if (merchantId && contextQuery.isPending) return { tone: "muted", message: "正在核验官方商户的后台账号、前台员工与企业上下文…" };
    if (contextQuery.isError) return { tone: "warn", message: `业务上下文不可用：${errorMessage(contextQuery.error)}。系统未把错误当成空成员数据。` };
    if (merchantId && contextQuery.isSuccess && contextValidation.reason) return { tone: "warn", message: contextValidation.reason };
    if (contextReady && enterpriseMeQuery.isPending) return { tone: "muted", message: "正在读取当前前台业务员工的企业权限摘要…" };
    if (enterpriseMeQuery.isError) return { tone: "warn", message: `企业权限摘要不可用：${errorMessage(enterpriseMeQuery.error)}` };
    if (contextReady && enterpriseMeQuery.isSuccess && !enterpriseAccess.canManageMembers) return { tone: "warn", message: enterpriseAccess.unavailableReason || "当前前台业务员工不能管理企业成员。" };
    if (enterpriseMembersQuery.isError) return { tone: "warn", message: `企业成员加载失败：${errorMessage(enterpriseMembersQuery.error)}。未将失败显示为无成员。` };
    if (enterpriseMembersQuery.isSuccess) return { tone: "ready", message: `官方商户 ${OFFICIAL_STAFF_MERCHANT_ID} 的企业成员已按当前前台身份核验；保存仍由原站服务复核。` };
    return null;
  })();

  const refresh = async () => {
    await Promise.all([
      canManageAdmin ? adminUsersQuery.refetch() : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: staffQueryPrefix(accountId) }),
    ]);
    toast.success("已请求刷新当前账号的员工与业务权限数据");
  };

  return (
    <DashboardLayout>
      <PageHeader
        title="员工与权限"
        description="在一个入口核对后台运营权限、原站 ERP 权限、业务范围与 BFF 前置条件；不同身份只在存在受信任关联时同窗保存。"
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={adminUsersQuery.isFetching || navigationQuery.isFetching}><RefreshCw className={`mr-1 h-4 w-4 ${adminUsersQuery.isFetching || navigationQuery.isFetching ? "animate-spin" : ""}`} />刷新</Button>{canManageAdmin ? <Button asChild variant="outline" size="sm"><a href="/admins">新建后台账号 <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button> : null}</div>}
      />

      {businessNotice ? <div className={`mb-4 rounded-md border p-3 text-sm ${businessNotice.tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-950" : businessNotice.tone === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "bg-muted/30 text-muted-foreground"}`}>{businessNotice.message}</div> : null}
      {!canManageAdmin && !enterpriseAccess.canManageMembers && !navigationQuery.isPending ? <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">当前账号既没有 `admins.manage`，也未通过企业成员管理核验。本页不会请求后台员工列表或越权的企业成员接口。</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle className="text-base">员工列表</CardTitle><p className="mt-1 text-xs text-muted-foreground">后台账户仅在拥有 `admins.manage` 时读取；企业成员仅在已核验的原站成员管理能力下读取。</p></div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索账号、姓名、邮箱或手机号" className="sm:w-[240px]" aria-label="搜索员工" />
            <select value={status} onChange={event => setStatus(event.target.value as StaffStatusFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="员工状态筛选"><option value="all">全部状态</option><option value="active">正常 / 启用</option><option value="disabled">后台停用</option><option value="locked">后台锁定</option><option value="suspended">企业暂停</option></select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {adminUsersQuery.isLoading || (enterpriseMembersQuery.isPending && contextReady && enterpriseAccess.canManageMembers) ? <div className="space-y-3 p-6"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : visibleRows.length === 0 ? (
            <EmptyState message={canManageAdmin || enterpriseMembersQuery.isSuccess ? "当前筛选没有可显示的真实员工记录。" : "没有可读取的员工数据；请先完成相应后台或企业授权。"} />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1050px]">
                <TableHeader><TableRow className="bg-muted/30"><TableHead>员工 / 身份</TableHead><TableHead>后台运营权限</TableHead><TableHead>ERP 权限与范围</TableHead><TableHead>BFF 前置状态</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
                <TableBody>{visibleRows.map(row => {
                  const adminStatus = row.admin ? accountStatus(row.admin) : null;
                  const bff = bffBadge(row);
                  return <TableRow key={row.key} className="align-top">
                    <TableCell className="min-w-[200px]"><div className="font-medium">{row.admin?.displayName || row.member?.displayName || row.admin?.username || "未命名员工"}</div>{row.admin ? <p className="mt-1 font-mono text-xs text-muted-foreground">{row.admin.username}</p> : null}{row.member?.phone ? <p className="mt-1 text-xs text-muted-foreground">{row.member.phone}</p> : null}<div className="mt-2 flex flex-wrap gap-1">{row.admin ? <Badge variant="outline">后台账号</Badge> : null}{row.member ? <Badge variant="outline">企业成员{row.member.isOwner ? " · 所有者" : ""}</Badge> : null}{!row.admin || !row.member ? <Badge variant="outline">权限待关联</Badge> : null}</div></TableCell>
                    <TableCell className="max-w-[210px] text-sm"><p title={adminPermissionSummary(row.admin)} className="line-clamp-2">{adminPermissionSummary(row.admin)}</p>{row.admin ? <p className="mt-1 text-xs text-muted-foreground">{roleLabel(row.admin.adminRole)}</p> : null}</TableCell>
                    <TableCell className="max-w-[270px] text-sm"><p title={erpPermissionSummary(row)} className="line-clamp-2">{erpPermissionSummary(row)}</p>{row.member ? <p className="mt-1 text-xs text-muted-foreground">范围：{row.member.isOwner || row.member.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务"}</p> : null}</TableCell>
                    <TableCell className="max-w-[230px]"><StatusBadge label={bff.label} style={bff.style} /><p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{row.bff.detail}</p>{row.bff.missingPermissions.length ? <p className="mt-1 break-words text-xs text-amber-700">缺：{row.bff.missingPermissions.join("、")}</p> : null}</TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{adminStatus ? <StatusBadge label={adminStatus.label} style={adminStatus.style} /> : null}{row.member ? <StatusBadge label={row.member.status === "active" ? "企业正常" : "企业暂停"} style={row.member.status === "active" ? "success" : "warning"} /> : null}</div></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setSelectedRow(row)}><Pencil className="mr-1 h-3.5 w-3.5" />查看 / 配置</Button></TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </div>
          )}
          {canManageAdmin && adminUsersQuery.data ? <Pagination page={page} pageSize={PAGE_SIZE} total={adminUsersQuery.data.total} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      <Card className="mt-4 border-dashed">
        <CardContent className="flex flex-col gap-3 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0" /><p>企业所有者转让、成员邀请和业务交接保留在原站流程，未在此页创建另一套人员管理或自动账号关联。</p></div>{enterpriseAccess.inviteHref ? <a href={enterpriseAccess.inviteHref} className="shrink-0 text-primary underline-offset-4 hover:underline">员工邀请与业务交接</a> : null}</CardContent>
      </Card>

      <StaffPermissionSheet
        key={`${accountId ?? "signed-out"}:${selectedCurrentRow?.key ?? "none"}`}
        open={Boolean(selectedRow)}
        row={selectedCurrentRow}
        canManageAdmin={canManageAdmin}
        enterpriseAccess={enterpriseAccess}
        saving={saving}
        securityLogs={loginHistoryQuery.data as never}
        securityLoading={loginHistoryQuery.isLoading}
        securityError={loginHistoryQuery.isError ? errorMessage(loginHistoryQuery.error) : null}
        onOpenChange={open => { if (!open && !saving) setSelectedRow(null); }}
        onSave={saveSelected}
      />
    </DashboardLayout>
  );
}
