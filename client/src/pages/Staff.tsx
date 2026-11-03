import { useAuth } from "@/_core/hooks/useAuth";
import { installAuthSessionClearListener } from "@/business/platform/client/src/lib/authSessionEvents";
import CreateStaffDialog, {
  type CreateStaffTeam,
} from "@/components/admin/CreateStaffDialog";
import StaffTeamSummary, {
  readCachedStaffBusinessTeams,
} from "@/components/admin/StaffTeamSummary";
import StaffPermissionSheet, {
  type StaffEnterpriseEditorAccess,
  type StaffPermissionSheetSection,
} from "@/components/admin/StaffPermissionSheet";
import { EmptyState, Pagination, StatusBadge } from "@/components/admin/shared";
import {
  AdminDataPanel,
  AdminFilterBar,
  AdminPage,
  AdminPageHeader,
} from "@/components/admin/UnifiedAdminPage";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
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
  adminPermissionsForUpdate,
  exactMerchantScope,
  mergeStaffRows,
  parseEnterpriseMembers,
  parseStaffBinding,
  positiveInteger,
  protectedStaffErpKeys,
  readStaffBusinessOrganization,
  staffBusinessTeamGuard,
  type StaffBusinessTeamDraft,
  type StaffBusinessTeamSaveResult,
  readStaffMerchantSelection,
  runGuardedStaffErpMutation,
  sameStringSet,
  selectOfficialStaffMerchant,
  staffErpMutationGuard,
  staffErpPermissionPreview,
  staffDraftFromRow,
  staffQueryKey,
  staffQueryPrefix,
  staffRowNeedsAssociation,
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
import { readOfficialTeamsOverview } from "@/lib/officialChannelInventoryUi";
import { trpc } from "@/lib/trpc";
import { hasAdminPermission } from "@shared/adminPermissions";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";
import "./Staff.css";

const PAGE_SIZE = 20;

type StaffStatusFilter = "all" | "active" | "disabled" | "locked" | "suspended";
type StaffRoleFilter = "all" | string;

function requestId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
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
  if (account.status === "active")
    return { label: "启用", style: "success" as const };
  if (account.status === "locked")
    return { label: "锁定", style: "warning" as const };
  return { label: "停用", style: "gray" as const };
}

function parseEnterpriseAccess(
  value: unknown,
  context: StaffBusinessContext | null,
  fallbackReason: string | null,
  merchantId: number | null
): StaffEnterpriseEditorAccess {
  if (!context) {
    return {
      available: false,
      canManageMembers: false,
      actorIsOwner: false,
      currentUserId: null,
      grantableKeys: [],
      inviteHref: merchantId
        ? `/workbench/add-user?merchantId=${merchantId}`
        : null,
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
      inviteHref: merchantId
        ? `/workbench/add-user?merchantId=${merchantId}`
        : null,
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
      unavailableReason:
        "企业权限摘要与已核验的企业或业务员工不一致，成员查询和业务设置已停止。",
    };
  }
  const source = value as Record<string, unknown>;
  const permissions =
    source.permissions && typeof source.permissions === "object"
      ? (source.permissions as Record<string, unknown>)
      : null;
  const currentUserId = positiveInteger(source.currentUserId);
  const actorIsOwner = source.isOwner === true;
  const canManageMembers = permissions?.manageMembers === true;
  const ownKeys = normalizeErpPermissions(
    Array.isArray(source.permissionKeys)
      ? source.permissionKeys.filter(
          (key): key is string => typeof key === "string"
        )
      : []
  );
  const grantableKeys = actorIsOwner
    ? [...ERP_VISIBLE_PERMISSION_KEYS]
    : ownKeys.filter(key => ERP_VISIBLE_PERMISSION_KEYS.includes(key));
  return {
    available: Boolean(source.enterprise) && currentUserId !== null,
    canManageMembers,
    actorIsOwner,
    currentUserId,
    grantableKeys,
    inviteHref:
      merchantId && canManageMembers
        ? `/workbench/add-user?merchantId=${merchantId}`
        : null,
    unavailableReason: !source.enterprise
      ? "当前已验证的前台员工尚未加入企业。"
      : !canManageMembers
        ? "当前前台业务员工没有企业成员管理权限。"
        : null,
  };
}

function matchesFilter(
  row: StaffRow,
  keyword: string,
  status: StaffStatusFilter,
  role: StaffRoleFilter
) {
  const normalized = keyword.trim().toLocaleLowerCase();
  const haystack = [
    row.admin?.username,
    row.admin?.displayName,
    row.admin?.email,
    row.admin?.phone,
    row.member?.displayName,
    row.member?.phone,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  if (normalized && !haystack.includes(normalized)) return false;
  if (role !== "all" && row.admin?.adminRole !== role) return false;
  if (status === "all") return true;
  return row.admin?.status === status || row.member?.status === status;
}

export default function Staff() {
  const { user } = useAuth();
  const search = useSearch();
  const trpcUtils = trpc.useUtils();
  const queryClient = useQueryClient();
  const accountId = positiveInteger(user?.id);
  const currentAccount = useRef(accountId);
  currentAccount.current = accountId;
  const sessionEpoch = useRef(0);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const adminRole =
    typeof (user as { adminRole?: unknown } | null)?.adminRole === "string"
      ? (user as { adminRole: string }).adminRole
      : "";
  const rawPermissions = Array.isArray(
    (user as { permissions?: readonly unknown[] } | null)?.permissions
  )
    ? (user as { permissions: readonly unknown[] }).permissions.filter(
        (permission): permission is string => typeof permission === "string"
      )
    : undefined;
  const canManageAdmin = hasAdminPermission(
    adminRole,
    "admins.manage",
    rawPermissions
  );
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StaffStatusFilter>("all");
  const [role, setRole] = useState<StaffRoleFilter>("all");
  const [selectedRow, setSelectedRow] = useState<StaffRow | null>(null);
  const [selectedSection, setSelectedSection] =
    useState<StaffPermissionSheetSection>("erp");
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [keyword, role, status]);

  useEffect(() => {
    setSelectedRow(null);
    setCreateOpen(false);
    setSaving(false);
  }, [accountId]);

  useEffect(
    () =>
      installAuthSessionClearListener(() => {
        sessionEpoch.current += 1;
        setSessionGeneration(sessionEpoch.current);
        setSelectedRow(null);
        setCreateOpen(false);
        setSaving(false);
      }),
    []
  );

  useEffect(
    () => () => {
      queryClient.removeQueries({ queryKey: staffQueryPrefix(accountId) });
    },
    [accountId, queryClient]
  );

  const adminUsersQuery = trpc.adminUser.list.useQuery(
    { page, pageSize: PAGE_SIZE },
    { enabled: canManageAdmin, retry: false, refetchOnWindowFocus: false }
  );
  const adminAccounts = (adminUsersQuery.data?.data ??
    []) as unknown as StaffAdminAccount[];
  // Official teams are intentionally native-admin data. They are never merged
  // with the merchant navigation, enterprise members, or staff bindings below.
  const officialTeamsQuery = trpc.officialTeams.overview.useQuery(undefined, {
    enabled: user?.role === "admin",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const officialTeamsOverview = useMemo(
    () => readOfficialTeamsOverview(officialTeamsQuery.data),
    [officialTeamsQuery.data]
  );
  const operationsQuery = trpc.staffOrganization.overview.useQuery(undefined, {
    enabled: user?.role === "admin",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const operations =
    operationsQuery.isSuccess &&
    operationsQuery.data.actorAdminUserId === accountId
      ? operationsQuery.data
      : undefined;
  const createTeams: CreateStaffTeam[] = [
    ...(operations?.canManage
      ? operations.teams
          .filter(team => team.status === "active")
          .map(team => ({
            domain: "operations" as const,
            id: team.id,
            name: team.name,
          }))
      : []),
    ...(officialTeamsOverview.available &&
    officialTeamsOverview.serverScope.isSuperAdmin &&
    officialTeamsOverview.serverScope.adminUserId === accountId &&
    !officialTeamsQuery.isError
      ? officialTeamsOverview.teams
          .filter(team => team.status === "active")
          .map(team => ({
            domain: "official" as const,
            id: team.id,
            name: team.name,
          }))
      : []),
  ];

  const navigationQuery = useQuery({
    queryKey: staffQueryKey(accountId, null, "navigation"),
    queryFn: () => trpcUtils.client.business.navigation.query(),
    enabled: accountId !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const merchantSelection = useMemo(
    () => readStaffMerchantSelection(search),
    [search]
  );
  const officialMerchant = useMemo(
    () =>
      navigationQuery.isSuccess
        ? selectOfficialStaffMerchant(navigationQuery.data, merchantSelection)
        : { merchantId: null, reason: null },
    [merchantSelection, navigationQuery.data, navigationQuery.isSuccess]
  );
  const merchantId = officialMerchant.merchantId;

  const scopeClient = useMemo(
    () => (merchantId ? createBusinessScopeTrpcClient(merchantId) : null),
    [merchantId]
  );
  const domainClient = useMemo(
    () => (merchantId ? createBusinessTrpcClient(merchantId) : null),
    [merchantId]
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
    return validateStaffBusinessContext(
      contextQuery.data,
      accountId,
      merchantId
    );
  }, [accountId, contextQuery.data, contextQuery.isSuccess, merchantId]);
  const contextReady = contextValidation.context !== null;

  const businessTeamsQuery = useQuery({
    queryKey: [
      ...staffQueryKey(accountId, merchantId, "organization-teams"),
      contextValidation.context?.frontendUserId ?? null,
      contextValidation.context?.enterpriseId ?? null,
    ],
    queryFn: async () => {
      if (!scopeClient) throw new Error("业务上下文未就绪");
      return readStaffBusinessOrganization(
        await scopeClient.organization.overview.query(undefined),
        contextValidation.context
      );
    },
    enabled: contextReady,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const businessTeams = useMemo(
    () =>
      businessTeamsQuery.isSuccess
        ? readCachedStaffBusinessTeams(
            businessTeamsQuery.data,
            contextValidation.context
          )
        : undefined,
    [
      businessTeamsQuery.data,
      businessTeamsQuery.isSuccess,
      contextValidation.context,
    ]
  );

  const businessOrganization = useMemo(() => {
    if (!businessTeamsQuery.isSuccess) return undefined;
    try {
      return readStaffBusinessOrganization(
        businessTeamsQuery.data,
        contextValidation.context
      );
    } catch {
      return undefined;
    }
  }, [
    businessTeamsQuery.data,
    businessTeamsQuery.isSuccess,
    contextValidation.context,
  ]);

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
  const enterpriseAccess = useMemo(
    () =>
      parseEnterpriseAccess(
        enterpriseMeQuery.data,
        enterpriseMeQuery.isSuccess ? contextValidation.context : null,
        contextValidation.reason ||
          (enterpriseMeQuery.isError
            ? errorMessage(enterpriseMeQuery.error)
            : null),
        merchantId
      ),
    [
      contextValidation.context,
      contextValidation.reason,
      enterpriseMeQuery.data,
      enterpriseMeQuery.error,
      enterpriseMeQuery.isError,
      enterpriseMeQuery.isSuccess,
      merchantId,
    ]
  );
  const enterpriseMembersQuery = useQuery({
    queryKey: staffQueryKey(accountId, merchantId, "enterprise-members"),
    queryFn: async () => {
      if (!domainClient) throw new Error("业务商户尚未通过上下文核验");
      return domainClient.enterprise.members.query();
    },
    enabled:
      contextReady &&
      enterpriseAccess.available &&
      enterpriseAccess.canManageMembers,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const enterpriseMembers = useMemo(
    () =>
      enterpriseMembersQuery.isSuccess
        ? parseEnterpriseMembers(enterpriseMembersQuery.data)
        : [],
    [enterpriseMembersQuery.data, enterpriseMembersQuery.isSuccess]
  );

  const bindingQueries = useQueries({
    queries: adminAccounts.map(account => ({
      queryKey: staffQueryKey(accountId, merchantId, "binding", account.id),
      queryFn: () =>
        trpcUtils.client.business.staffBindings.current.query({
          adminUserId: account.id,
        }),
      enabled: canManageAdmin,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  const scopeQueries = useQueries({
    queries: adminAccounts.map(account => ({
      queryKey: staffQueryKey(
        accountId,
        merchantId,
        "merchant-scope",
        account.id
      ),
      queryFn: () =>
        trpcUtils.client.business.merchantScopes.current.query({
          adminUserId: account.id,
        }),
      enabled: canManageAdmin,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  const staffRows = useMemo(() => {
    const bindings = new Map<
      number,
      { state: BindingReadState; binding: ReturnType<typeof parseStaffBinding> }
    >();
    const scopes = new Map<
      number,
      { state: ScopeReadState; scope: ReturnType<typeof exactMerchantScope> }
    >();
    adminAccounts.forEach((account, index) => {
      const bindingQuery = bindingQueries[index];
      const binding = bindingQuery?.isSuccess
        ? parseStaffBinding(bindingQuery.data, account.id)
        : null;
      const state: BindingReadState = !canManageAdmin
        ? "not-requested"
        : bindingQuery?.isPending
          ? "loading"
          : bindingQuery?.isError
            ? "error"
            : binding
              ? "bound"
              : "unbound";
      bindings.set(account.id, { state, binding });
      const scopeQuery = scopeQueries[index];
      const scope = scopeQuery?.isSuccess
        ? exactMerchantScope(scopeQuery.data, merchantId)
        : null;
      const scopeState: ScopeReadState = !canManageAdmin
        ? "not-requested"
        : scopeQuery?.isPending
          ? "loading"
          : scopeQuery?.isError
            ? "error"
            : scope
              ? "ready"
              : "missing";
      scopes.set(account.id, { state: scopeState, scope });
    });
    return mergeStaffRows({
      admins: adminAccounts,
      members: enterpriseMembers,
      bindings,
      scopes,
      expectedMerchantId: merchantId,
    });
  }, [
    adminAccounts,
    bindingQueries,
    canManageAdmin,
    enterpriseMembers,
    merchantId,
    scopeQueries,
  ]);
  const roleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          staffRows
            .map(row => row.admin?.adminRole)
            .filter((item): item is string => Boolean(item))
        )
      ).sort((left, right) =>
        roleLabel(left).localeCompare(roleLabel(right), "zh-CN")
      ),
    [staffRows]
  );
  const visibleRows = useMemo(
    () => staffRows.filter(row => matchesFilter(row, keyword, status, role)),
    [keyword, role, staffRows, status]
  );

  const loginHistoryQuery = trpc.adminUser.loginHistory.useQuery(
    { id: selectedRow?.admin?.id ?? 1, limit: 50 },
    {
      enabled: canManageAdmin && Boolean(selectedRow?.admin),
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const adminUpdate = trpc.adminUser.update.useMutation();

  const refreshBusinessMembers = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: staffQueryKey(accountId, merchantId, "enterprise-me"),
      }),
      queryClient.invalidateQueries({
        queryKey: staffQueryKey(accountId, merchantId, "enterprise-members"),
      }),
    ]);
  };

  const saveSelected = async (
    draft: StaffSaveDraft,
    baseline: StaffSaveBaseline
  ): Promise<StaffSaveOutcome> => {
    const row = selectedRow;
    const actorId = accountId;
    const epoch = sessionEpoch.current;
    const actorIsCurrent = () =>
      actorId !== null &&
      currentAccount.current === actorId &&
      sessionEpoch.current === epoch;
    const outcome: StaffSaveOutcome = {
      completed: { erpPermissions: false, erpScope: false, admin: false },
      errors: {},
    };
    if (!row || !actorIsCurrent()) return outcome;
    setSaving(true);
    try {
      // ERP writes use the live merged row rather than the snapshot captured
      // when the sheet opened. Pending/error/mismatched binding or scope reads
      // therefore cannot inherit a previously ready state.
      const currentErpRow = staffRows.find(
        candidate => candidate.key === row.key
      );
      const erpGuard = staffErpMutationGuard(currentErpRow, enterpriseAccess);
      const canEditErp = erpGuard.allowed;
      const lockedPermissionKeys = protectedStaffErpKeys(
        baseline.erpPermissionKeys,
        enterpriseAccess.grantableKeys,
        enterpriseAccess.actorIsOwner
      );
      const canEditErpPermissions =
        canEditErp && lockedPermissionKeys.length === 0;
      const erpPermissionsChanged = !sameStringSet(
        baseline.erpPermissionKeys,
        draft.erpPermissionKeys
      );
      const erpScopeChanged =
        baseline.inventoryDataScope !== draft.inventoryDataScope;
      if (erpPermissionsChanged && !canEditErpPermissions) {
        outcome.errors.erpPermissions = lockedPermissionKeys.length
          ? "该员工已有超出当前操作者可授予范围的权限；为避免误撤销，请由企业所有者调整。"
          : erpGuard.allowed
            ? "当前状态不允许修改该企业成员的 ERP 权限"
            : erpGuard.reason;
      }
      if (erpScopeChanged && !canEditErp) {
        outcome.errors.erpScope = erpGuard.allowed
          ? "当前状态不允许修改该企业成员的业务范围"
          : erpGuard.reason;
      }
      if (
        canEditErpPermissions &&
        currentErpRow?.member &&
        erpPermissionsChanged
      ) {
        try {
          const execution = await runGuardedStaffErpMutation(
            currentErpRow,
            enterpriseAccess,
            async () => {
              if (!domainClient) throw new Error("业务客户端未就绪");
              if (!draft.erpPermissionKeys.length)
                throw new Error("请至少保留一项 ERP 权限");
              if (
                draft.erpPermissionKeys.some(
                  key => !enterpriseAccess.grantableKeys.includes(key)
                )
              ) {
                throw new Error("只能授予当前前台业务员工已拥有的 ERP 权限");
              }
              return domainClient.enterprise.updatePermissions.mutate({
                userId: currentErpRow.member!.userId,
                permissionKeys: draft.erpPermissionKeys,
                requestId: requestId("staff_erp_permissions"),
              });
            }
          );
          if (!execution.allowed) {
            outcome.errors.erpPermissions = execution.reason;
          } else {
            outcome.completed.erpPermissions = true;
            if (!actorIsCurrent()) return outcome;
            await refreshBusinessMembers();
          }
        } catch (error) {
          outcome.errors.erpPermissions = errorMessage(error);
        }
      }
      if (canEditErp && currentErpRow?.member && erpScopeChanged) {
        if (!actorIsCurrent()) return outcome;
        try {
          const execution = await runGuardedStaffErpMutation(
            currentErpRow,
            enterpriseAccess,
            async () => {
              if (!domainClient) throw new Error("业务客户端未就绪");
              if (
                draft.inventoryDataScope === "enterprise" &&
                !enterpriseAccess.actorIsOwner
              ) {
                throw new Error("全企业业务仅当前企业所有者可授予");
              }
              return domainClient.enterprise.updateInventoryScope.mutate({
                userId: currentErpRow.member!.userId,
                inventoryDataScope: draft.inventoryDataScope,
                requestId: requestId("staff_erp_scope"),
              });
            }
          );
          if (!execution.allowed) {
            outcome.errors.erpScope = execution.reason;
          } else {
            outcome.completed.erpScope = true;
            if (!actorIsCurrent()) return outcome;
            await refreshBusinessMembers();
          }
        } catch (error) {
          outcome.errors.erpScope = errorMessage(error);
        }
      }
      const adminChanged =
        Boolean(row.admin) &&
        (baseline.adminRole !== draft.adminRole ||
          !sameStringSet(baseline.adminPermissions, draft.adminPermissions));
      if (row.admin && adminChanged && !canManageAdmin) {
        outcome.errors.admin = "当前账号没有后台账户配置权限，后台角色未保存";
      }
      if (canManageAdmin && row.admin && adminChanged) {
        if (!actorIsCurrent()) return outcome;
        try {
          // adminUser.update is a full replacement. Re-read its own native source
          // so a preceding channel-page save cannot be reverted by a stale list row.
          const latestList = await trpcUtils.client.adminUser.list.query({
            page,
            pageSize: PAGE_SIZE,
          });
          const latest = (
            latestList.data as unknown as StaffAdminAccount[]
          ).find(account => account.id === row.admin!.id);
          if (!latest)
            throw new Error("目标账号已不在当前列表范围，请刷新后核验");
          if (
            latest.adminRole !== baseline.adminRole ||
            !sameStringSet(
              staffDraftFromRow({ ...row, admin: latest }).adminPermissions,
              baseline.adminPermissions
            )
          )
            throw new Error(
              "平台角色或权限已被其他操作修改；草稿保留，请关闭后重新读取核对"
            );
          if (!actorIsCurrent()) return outcome;
          await adminUpdate.mutateAsync({
            id: row.admin.id,
            adminRole: draft.adminRole as never,
            permissions: adminPermissionsForUpdate(
              latest.permissions,
              draft.adminPermissions,
              draft.adminRole
            ),
          });
          outcome.completed.admin = true;
          if (!actorIsCurrent()) return outcome;
          await trpcUtils.adminUser.list.invalidate();
        } catch (error) {
          outcome.errors.admin = errorMessage(error);
        }
      }
      return outcome;
    } finally {
      if (actorIsCurrent()) setSaving(false);
    }
  };

  const selectedCurrentRow = useMemo(
    () =>
      selectedRow
        ? (staffRows.find(candidate => candidate.key === selectedRow.key) ??
          null)
        : null,
    [selectedRow, staffRows]
  );

  const businessTeamGuard = staffBusinessTeamGuard(
    selectedCurrentRow,
    enterpriseAccess,
    businessOrganization
  );
  const saveBusinessTeam = async (
    draft: StaffBusinessTeamDraft
  ): Promise<StaffBusinessTeamSaveResult> => {
    const epoch = sessionEpoch.current;
    // Use the current merged row, not the sheet-opening snapshot or a guessed front identity.
    const target = selectedRow
      ? staffRows.find(candidate => candidate.key === selectedRow.key)
      : null;
    const guard = staffBusinessTeamGuard(
      target,
      enterpriseAccess,
      businessOrganization
    );
    if (!guard.allowed) throw new Error(guard.reason);
    if (
      !scopeClient ||
      !target?.binding ||
      !businessOrganization ||
      businessTeamsQuery.isError
    )
      throw new Error("业务团队上下文不可用，请刷新后重试");
    const userId = target.binding.frontUserId;
    const original = businessOrganization.members.find(
      member => member.userId === userId
    );
    if (!original || original.revision !== draft.revision)
      throw new Error("业务团队成员版本已变化，请重新读取后核对");
    if (
      draft.teamId !== null &&
      !businessOrganization.teams.some(
        team => team.id === draft.teamId && team.status === "active"
      )
    )
      throw new Error("只能选择当前已核验企业中的有效业务团队");
    if (
      draft.teamId !== null &&
      draft.teamRole !== "member" &&
      draft.teamRole !== "leader"
    )
      throw new Error("请选择有效业务团队身份");
    const result = await scopeClient.organization.setMember.mutate({
      userId,
      teamId: draft.teamId,
      role: draft.teamId === null ? null : draft.teamRole,
      expectedRevision: draft.revision,
      requestId: requestId("staff_business_team"),
    });
    if (currentAccount.current !== accountId || sessionEpoch.current !== epoch)
      return {
        saved: true,
        member: null,
        warning: "操作者会话已变化，需在原账号重新核验结果",
      };
    if (
      !result ||
      typeof result !== "object" ||
      !("success" in result) ||
      result.success !== true
    )
      throw new Error("业务团队接口未返回可信成功结果，请刷新核验，勿重复提交");
    try {
      const latest = readStaffBusinessOrganization(
        await scopeClient.organization.overview.query(undefined),
        contextValidation.context
      );
      const member = latest.members.find(item => item.userId === userId);
      queryClient.setQueryData(
        [
          ...staffQueryKey(accountId, merchantId, "organization-teams"),
          contextValidation.context?.frontendUserId ?? null,
          contextValidation.context?.enterpriseId ?? null,
        ],
        latest
      );
      if (
        !member ||
        member.teamId !== draft.teamId ||
        member.teamRole !== (draft.teamId === null ? null : draft.teamRole)
      )
        return {
          saved: true,
          member: null,
          warning: "回读关系已变化，请刷新核验后再修改",
        };
      return { saved: true, member };
    } catch {
      return {
        saved: true,
        member: null,
        warning: "保存成功，但新成员版本回读失败；请刷新核验后再修改",
      };
    }
  };

  const businessNotice = (() => {
    if (
      navigationQuery.isPending ||
      (merchantId && contextQuery.isPending) ||
      (contextReady && enterpriseMeQuery.isPending)
    ) {
      return { tone: "muted", message: "正在加载业务权限信息…" };
    }
    if (
      navigationQuery.isError ||
      (navigationQuery.isSuccess && officialMerchant.reason) ||
      contextQuery.isError ||
      (contextQuery.isSuccess && contextValidation.reason) ||
      enterpriseMeQuery.isError
    ) {
      return { tone: "warn", message: "业务权限信息暂时不可用，请稍后刷新。" };
    }
    if (
      contextReady &&
      enterpriseMeQuery.isSuccess &&
      !enterpriseAccess.canManageMembers
    ) {
      return { tone: "warn", message: "当前账号暂不能管理企业成员。" };
    }
    if (enterpriseMembersQuery.isError)
      return { tone: "warn", message: "企业成员加载失败，请稍后刷新。" };
    return null;
  })();

  const openStaffSheet = (
    row: StaffRow,
    section: StaffPermissionSheetSection
  ) => {
    setSelectedSection(section);
    setSelectedRow(row);
  };

  const refresh = async () => {
    await Promise.all([
      canManageAdmin ? adminUsersQuery.refetch() : Promise.resolve(),
      officialTeamsQuery.refetch(),
      operationsQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: staffQueryPrefix(accountId) }),
    ]);
    toast.success("已刷新");
  };

  return (
    <DashboardLayout>
      <AdminPage data-staff-page className="staff-management-page">
        <AdminPageHeader
          title="员工与权限"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
                disabled={
                  adminUsersQuery.isFetching || navigationQuery.isFetching
                }
              >
                <RefreshCw
                  className={`mr-1 h-4 w-4 ${adminUsersQuery.isFetching || navigationQuery.isFetching ? "animate-spin" : ""}`}
                />
                刷新
              </Button>
              {canManageAdmin ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" />
                  新增员工
                </Button>
              ) : null}
            </div>
          }
        />

        {businessNotice ? (
          <div
            className={`rounded-md border p-3 text-xs ${businessNotice.tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-950" : "bg-muted/30 text-muted-foreground"}`}
          >
            {businessNotice.message}
          </div>
        ) : null}
        {officialTeamsQuery.isError ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
            role="alert"
          >
            <span>
              官方团队读取失败：{errorMessage(officialTeamsQuery.error)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-destructive/30 bg-background text-xs text-destructive hover:text-destructive"
              disabled={officialTeamsQuery.isFetching}
              onClick={() => void officialTeamsQuery.refetch()}
            >
              {officialTeamsQuery.isFetching ? "重试中…" : "重试"}
            </Button>
          </div>
        ) : null}

        <AdminFilterBar role="search" aria-label="员工筛选">
          <Input
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="搜索姓名、账号或手机"
            className="h-8 w-full text-xs sm:w-[220px]"
            aria-label="搜索员工"
          />
          <select
            value={status}
            onChange={event =>
              setStatus(event.target.value as StaffStatusFilter)
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="员工状态筛选"
          >
            <option value="all">全部状态</option>
            <option value="active">正常 / 启用</option>
            <option value="disabled">后台停用</option>
            <option value="locked">后台锁定</option>
            <option value="suspended">企业暂停</option>
          </select>
          <select
            value={role}
            onChange={event => setRole(event.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="后台角色筛选"
          >
            <option value="all">全部后台角色</option>
            {roleOptions.map(option => (
              <option key={option} value={option}>
                {roleLabel(option)}
              </option>
            ))}
          </select>
        </AdminFilterBar>
        <AdminDataPanel aria-label="员工列表">
          {adminUsersQuery.isLoading ||
          (enterpriseMembersQuery.isPending &&
            contextReady &&
            enterpriseAccess.canManageMembers) ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : visibleRows.length === 0 ? (
            <EmptyState
              message={
                canManageAdmin || enterpriseMembersQuery.isSuccess
                  ? "当前筛选没有可显示的员工记录。"
                  : "暂无可显示的员工记录。"
              }
            />
          ) : (
            <div
              className="staff-management-table-scroll"
              data-staff-table-scroll
            >
              <Table className="staff-management-table min-w-[980px] table-fixed">
                <colgroup>
                  <col className="w-[21%]" />
                  <col className="w-[15%]" />
                  <col className="w-[14%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[112px]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="px-3 text-[11px]">员工信息</TableHead>
                    <TableHead className="px-3 text-[11px]">所属团队</TableHead>
                    <TableHead className="px-3 text-[11px]">后台角色</TableHead>
                    <TableHead className="px-3 text-[11px]">ERP 权限</TableHead>
                    <TableHead className="px-3 text-[11px]">数据范围</TableHead>
                    <TableHead className="px-3 text-[11px]">账号状态</TableHead>
                    <TableHead className="staff-action-head px-3 text-right text-[11px]">
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map(row => {
                    const adminStatus = row.admin
                      ? accountStatus(row.admin)
                      : null;
                    const erpPreview = staffErpPermissionPreview(row);
                    const needsAssociation = staffRowNeedsAssociation(row);
                    const displayName =
                      row.admin?.displayName ||
                      row.member?.displayName ||
                      row.admin?.username ||
                      "未命名员工";
                    const showEnterpriseStatus = Boolean(
                      row.member &&
                        (row.member.status === "suspended" || !adminStatus)
                    );
                    return (
                      <TableRow
                        key={row.key}
                        className="h-14 align-middle"
                        data-staff-row={row.key}
                      >
                        <TableCell
                          className="min-w-[190px] py-2.5"
                          data-staff-identity
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="staff-avatar" aria-hidden="true">
                              {displayName.slice(0, 1)}
                            </span>
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">
                                {displayName}
                              </span>
                              {needsAssociation ? (
                                <button
                                  type="button"
                                  className="staff-association-action"
                                  onClick={() => openStaffSheet(row, "member")}
                                >
                                  待关联
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell
                          className="py-2.5 text-xs"
                          data-staff-official-team
                        >
                          <StaffTeamSummary
                            row={row}
                            operations={operations}
                            official={officialTeamsOverview}
                            business={businessTeams}
                            operationsState={
                              operationsQuery.isError
                                ? "不可用"
                                : operationsQuery.isPending
                                  ? "读取中…"
                                  : !operations
                                    ? "不可用"
                                    : ""
                            }
                            officialState={
                              officialTeamsQuery.isError
                                ? "不可用"
                                : officialTeamsQuery.isPending
                                  ? "读取中…"
                                  : ""
                            }
                            businessState={
                              !contextReady
                                ? "未就绪"
                                : businessTeamsQuery.isError
                                  ? "不可用"
                                  : businessTeamsQuery.isPending
                                    ? "读取中…"
                                    : !businessTeams
                                      ? "不可用"
                                      : ""
                            }
                          />
                        </TableCell>
                        <TableCell className="py-2.5 text-xs" data-staff-role>
                          {row.admin ? (
                            <span className="block truncate font-medium">
                              {roleLabel(row.admin.adminRole)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5" data-staff-erp-summary>
                          {erpPreview.total ? (
                            <div className="staff-erp-tags">
                              {erpPreview.labels.map(label => (
                                <span key={label} className="staff-erp-tag">
                                  {label}
                                </span>
                              ))}
                              {erpPreview.remaining ? (
                                <button
                                  type="button"
                                  className="staff-erp-more"
                                  onClick={() => openStaffSheet(row, "erp")}
                                  aria-label={`查看 ${displayName} 的全部 ${erpPreview.total} 项 ERP 权限`}
                                >
                                  +{erpPreview.remaining}
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs" data-staff-scope>
                          {row.member ? (
                            <span className="text-muted-foreground">
                              {row.member.isOwner ||
                              row.member.inventoryDataScope === "enterprise"
                                ? "全企业业务"
                                : "仅本人业务"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5" data-staff-status>
                          <div className="flex flex-nowrap items-center gap-1">
                            {adminStatus ? (
                              <StatusBadge
                                label={adminStatus.label}
                                style={adminStatus.style}
                              />
                            ) : null}
                            {showEnterpriseStatus ? (
                              <StatusBadge
                                label={
                                  row.member?.status === "suspended"
                                    ? "企业暂停"
                                    : "企业正常"
                                }
                                style={
                                  row.member?.status === "suspended"
                                    ? "warning"
                                    : "success"
                                }
                              />
                            ) : null}
                            {!adminStatus && !row.member ? (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell
                          className="staff-action-cell w-[112px] min-w-[112px] py-2.5 pr-3 whitespace-nowrap text-right"
                          data-staff-action-cell
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            onClick={() => openStaffSheet(row, "erp")}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            配置权限
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {canManageAdmin && adminUsersQuery.data ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={adminUsersQuery.data.total}
              onPageChange={setPage}
            />
          ) : null}
        </AdminDataPanel>

        <AdminDataPanel className="flex flex-col gap-3 border-dashed p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <Users className="mt-0.5 h-4 w-4 shrink-0" />
            <p>需要邀请员工或交接业务时，可继续使用现有流程。</p>
          </div>
          {enterpriseAccess.inviteHref ? (
            <a
              href={enterpriseAccess.inviteHref}
              className="shrink-0 text-primary underline-offset-4 hover:underline"
            >
              员工邀请与业务交接
            </a>
          ) : null}
        </AdminDataPanel>

        <CreateStaffDialog
          key={`create-staff:${accountId ?? "signed-out"}`}
          open={createOpen && canManageAdmin}
          onOpenChange={setCreateOpen}
          canManageAdmin={canManageAdmin}
          teams={createTeams}
          teamNotice={
            operationsQuery.isError || officialTeamsQuery.isError
              ? "部分团队不可用，可暂不分组后刷新配置。"
              : "业务团队需先关联真实业务身份。"
          }
          onChanged={async () => {
            await Promise.all([
              trpcUtils.adminUser.list.invalidate(),
              trpcUtils.salesStaff.list.invalidate(),
              trpcUtils.staffOrganization.overview.invalidate(),
              trpcUtils.officialTeams.overview.invalidate(),
              queryClient.invalidateQueries({
                queryKey: staffQueryPrefix(accountId),
              }),
            ]);
          }}
        />

        <StaffPermissionSheet
          key={`${accountId ?? "signed-out"}:${sessionGeneration}:${selectedCurrentRow?.key ?? "none"}`}
          open={Boolean(selectedRow)}
          row={selectedCurrentRow}
          initialSection={selectedSection}
          canManageAdmin={canManageAdmin}
          enterpriseAccess={enterpriseAccess}
          saving={saving}
          securityLogs={loginHistoryQuery.data as never}
          securityLoading={loginHistoryQuery.isLoading}
          securityError={
            loginHistoryQuery.isError
              ? errorMessage(loginHistoryQuery.error)
              : null
          }
          officialTeamsOverview={
            officialTeamsOverview.serverScope.adminUserId === accountId
              ? officialTeamsQuery.data
              : undefined
          }
          officialTeamsLoading={officialTeamsQuery.isPending}
          officialTeamsError={
            officialTeamsQuery.isError
              ? errorMessage(officialTeamsQuery.error)
              : null
          }
          onRetryOfficialTeams={() => {
            void officialTeamsQuery.refetch();
            void trpcUtils.adminUser.list.invalidate();
          }}
          businessTeam={{
            overview: businessOrganization,
            frontUserId:
              selectedCurrentRow?.bindingState === "bound"
                ? (selectedCurrentRow.binding?.frontUserId ?? null)
                : null,
            canEdit: businessTeamGuard.allowed && !businessTeamsQuery.isError,
            reason: businessTeamGuard.allowed ? null : businessTeamGuard.reason,
            loading: businessTeamsQuery.isFetching,
            error: businessTeamsQuery.isError
              ? errorMessage(businessTeamsQuery.error)
              : null,
            onRetry: () => {
              void businessTeamsQuery.refetch();
            },
            onSave: saveBusinessTeam,
          }}
          onOpenChange={open => {
            if (!open && !saving) setSelectedRow(null);
          }}
          onSave={saveSelected}
        />
      </AdminPage>
    </DashboardLayout>
  );
}
