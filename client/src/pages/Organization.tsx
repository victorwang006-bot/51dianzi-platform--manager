import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createBusinessScopeTrpcClient } from "@/business/api/business-trpc";
import { trpc } from "@/lib/trpc";
import {
  mergeStaffOperationsTemplate,
  STAFF_OPERATIONS_TEMPLATES,
  type StaffMemberDto,
} from "@shared/staffOrganization";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import "./Organization.css";

const businessModules = ["customers", "demands", "channels", "stocks"] as const;
const moduleLabels = {
  customers: "客户",
  demands: "需求",
  channels: "私有渠道",
  stocks: "库存",
};
const scopeLabels = {
  self: "仅本人",
  team: "所在团队",
  enterprise: "整个企业",
};
const moduleSchema = z.object({
  module: z.enum(businessModules),
  read: z.boolean(),
  write: z.boolean(),
  scope: z.enum(["self", "team", "enterprise"]),
  revision: z.number().int().nonnegative(),
  explicit: z.boolean(),
});
/** BFF deliberately returns unknown; validate every consumed field instead of casting its entire surface. */
export const businessOrganizationOverviewSchema = z.object({
  enterprise: z.object({ id: z.number().int().positive(), name: z.string() }),
  actorUserId: z.number().int().positive(),
  canManage: z.boolean(),
  teams: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      status: z.string(),
      revision: z.number().int().nonnegative(),
    })
  ),
  members: z.array(
    z.object({
      userId: z.number().int().positive(),
      username: z.string().nullable(),
      name: z.string().nullable(),
      status: z.string(),
      enterpriseRole: z.string(),
      teamId: z.number().int().positive().nullable(),
      teamRole: z.enum(["leader", "member"]).nullable(),
      revision: z.number().int().nonnegative(),
      moduleAccess: z
        .array(moduleSchema)
        .length(4)
        .refine(
          rows => new Set(rows.map(row => row.module)).size === 4,
          "业务模块配置重复"
        ),
    })
  ),
  templates: z.array(
    z.object({
      id: z.enum(["sales", "lead"]),
      name: z.string(),
      description: z.string(),
      modules: z
        .array(moduleSchema.omit({ revision: true, explicit: true }))
        .length(4),
    })
  ),
});
const businessAuditSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.number().int().positive(),
      action: z.string(),
      actorUserId: z.number().int().positive(),
      targetUserId: z.number().int().positive().nullable(),
      requestId: z.string(),
      payloadHash: z.string(),
      beforeData: z.unknown(),
      afterData: z.unknown(),
      createdAt: z.union([z.string(), z.date()]),
    })
  ),
});
const businessSuccessSchema = z.object({
  success: z.literal(true),
  idempotent: z.boolean(),
});
export const businessUpdateAccessResultSchema = businessSuccessSchema.extend({
  erpGrantsChanged: z.literal(false),
  modules: z.array(moduleSchema.extend({
    entitled: z.boolean(),
    requested: moduleSchema.omit({ revision: true, explicit: true }),
    notEntitled: z.boolean(),
  })).length(4).refine(rows => new Set(rows.map(row => row.module)).size === 4, "业务模块结果重复"),
});
type BusinessOverview = z.infer<typeof businessOrganizationOverviewSchema>;
type BusinessMember = BusinessOverview["members"][number];
type ModuleDraft = z.infer<typeof moduleSchema>;
type Domain = "business" | "operations";
type TeamDraft = {
  kind: "team";
  id: number | null;
  name: string;
  notes: string;
  status: "active" | "archived";
  expectedRevision: number;
};
type MemberDraft = {
  kind: "member";
  id: number;
  label: string;
  beforeTeamId: number | null;
  beforeRole: "member" | "leader" | null;
  teamId: number | null;
  role: "member" | "leader";
  expectedRevision: number;
};
type NativeAccessDraft = {
  kind: "nativeAccess";
  member: StaffMemberDto;
  templateId: "platform-operations" | "operations-view";
};
type BusinessAccessDraft = {
  kind: "businessAccess";
  member: BusinessMember;
  modules: ModuleDraft[];
  templateId?: "sales" | "lead";
};
type Editor = TeamDraft | MemberDraft | NativeAccessDraft | BusinessAccessDraft;
type BusinessAccessSaveNotice = { notEntitledModules: string[]; effectiveSummary: string };
type Preview = {
  title: string;
  changes: string[];
  requestId: string;
  run: () => Promise<BusinessAccessSaveNotice | void>;
};
function newRequestId() {
  return `org_${crypto.randomUUID().replaceAll("-", "")}`;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请重试";
}
function teamRoleLabel(role: string | null) {
  return role === "leader" ? "组长" : role === "member" ? "成员" : "未分组";
}
function memberName(member: BusinessMember) {
  return member.name || member.username || `前台用户 ${member.userId}`;
}
function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}
function LoadingError({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  if (loading)
    return (
      <p className="org-notice" role="status">
        正在读取服务端组织配置…
      </p>
    );
  if (error)
    return (
      <div className="org-error" role="alert">
        <p>{errorText(error)}</p>
        <Button variant="outline" onClick={retry}>
          重试读取
        </Button>
      </div>
    );
  return null;
}

export default function Organization() {
  const [location] = useLocation();
  const section = location.includes("permission-audit")
    ? "audit"
    : location.includes("role-templates")
      ? "templates"
      : "teams";
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const cache = useQueryClient();
  const accountId = user?.id ?? null;
  const [domain, setDomain] = useState<Domain>("business");
  const [selectedMerchantId, setSelectedMerchantId] = useState<number | null>(
    null
  );
  const [auditPage, setAuditPage] = useState(1);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const merchantsQuery = trpc.business.merchants.useQuery(
    { page: 1, pageSize: 100 },
    {
      enabled: Boolean(accountId) && domain === "business",
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const merchants = merchantsQuery.data?.data ?? [];
  const merchantId = merchants.some(
    merchant => merchant.id === selectedMerchantId
  )
    ? selectedMerchantId
    : merchants.length === 1
      ? merchants[0].id
      : null;
  const scopeClient = useMemo(
    () => (merchantId ? createBusinessScopeTrpcClient(merchantId) : null),
    [merchantId]
  );
  const businessKey = ["organization", accountId, merchantId] as const;
  const businessQuery = useQuery({
    queryKey: [...businessKey, "overview"],
    enabled: domain === "business" && Boolean(scopeClient),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!scopeClient) throw new Error("请选择经过核验的业务商户");
      return businessOrganizationOverviewSchema.parse(
        await scopeClient.organization.overview.query(undefined)
      );
    },
  });
  const nativeQuery = trpc.staffOrganization.overview.useQuery(undefined, {
    enabled: Boolean(accountId) && domain === "operations",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const business = businessQuery.data;
  const native =
    nativeQuery.data?.actorAdminUserId === accountId
      ? nativeQuery.data
      : undefined;
  const canManage =
    domain === "operations"
      ? native?.canManage === true
      : business?.canManage === true;
  const businessAudit = useQuery({
    queryKey: [...businessKey, "audit", auditPage],
    enabled:
      domain === "business" &&
      section === "audit" &&
      Boolean(scopeClient) &&
      business?.canManage === true,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!scopeClient) throw new Error("业务商户未选择");
      return businessAuditSchema.parse(
        await scopeClient.organization.audit.query({
          page: auditPage,
          pageSize: 20,
        })
      );
    },
  });
  const nativeAudit = trpc.staffOrganization.audit.useQuery(
    { page: auditPage, pageSize: 20 },
    {
      enabled:
        Boolean(accountId) && domain === "operations" && section === "audit",
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const nativeAuditData =
    nativeAudit.data?.actorAdminUserId === accountId
      ? nativeAudit.data
      : undefined;
  const createTeam = trpc.staffOrganization.createTeam.useMutation();
  const updateTeam = trpc.staffOrganization.updateTeam.useMutation();
  const setMember = trpc.staffOrganization.setMember.useMutation();
  const applyTemplate = trpc.staffOrganization.applyTemplate.useMutation();
  useEffect(() => {
    setEditor(null);
    setPreview(null);
    setSaveError(null);
    setNotice(null);
    setAuditPage(1);
  }, [domain, merchantId, section, accountId]);
  useEffect(
    () => () => {
      cache.removeQueries({ queryKey: ["organization", accountId] });
    },
    [accountId, cache]
  );
  const teamRows =
    domain === "operations" ? (native?.teams ?? []) : (business?.teams ?? []);
  const nameOfTeam = (id: number | null) =>
    id === null
      ? "未分组"
      : (teamRows.find(team => team.id === id)?.name ?? `团队 ${id}`);
  const dataError =
    domain === "operations" ? nativeQuery.error : businessQuery.error;
  const loading =
    domain === "operations"
      ? nativeQuery.isLoading
      : Boolean(merchantId) && businessQuery.isLoading;
  const ready =
    !dataError &&
    (domain === "operations"
      ? nativeQuery.isSuccess
      : businessQuery.isSuccess && merchantId !== null);
  const isEditable = ready && canManage && !saving;
  function open(value: Editor) {
    setEditor(value);
    setPreview(null);
    setSaveError(null);
    setNotice(null);
  }
  function ensureBusiness() {
    if (!scopeClient || !business?.canManage || !merchantId)
      throw new Error("只有当前真实前台企业所有者可以编辑业务组织");
    return scopeClient;
  }
  function prepare() {
    if (!editor || !isEditable) return;
    setSaveError(null);
    try {
      const requestId = newRequestId();
      const changes: string[] = [];
      let run: Preview["run"];
      if (editor.kind === "team") {
        const name = editor.name.trim();
        const maxName = domain === "operations" ? 128 : 80;
        if (!name || name.length > maxName)
          throw new Error(`团队名称须为 1–${maxName} 个字符`);
        if (editor.notes.length > (domain === "operations" ? 2000 : 500))
          throw new Error("团队备注过长");
        const original = teamRows.find(team => team.id === editor.id);
        changes.push(
          editor.id
            ? `团队名称：${original?.name} → ${name}`
            : `新建${domain === "operations" ? "运营" : "业务"}团队：${name}`
        );
        if (editor.notes.trim()) changes.push(`备注：${editor.notes.trim()}`);
        if (domain === "operations" && editor.id)
          changes.push(`状态：${original?.status} → ${editor.status}`);
        changes.push("不会自动分配模块、系统或 ERP 权限。");
        if (domain === "operations")
          run = async () => {
            if (editor.id)
              await updateTeam.mutateAsync({
                id: editor.id,
                name,
                notes: editor.notes,
                status: editor.status,
                expectedRevision: editor.expectedRevision,
                requestId,
              });
            else
              await createTeam.mutateAsync({
                name,
                notes: editor.notes,
                requestId,
              });
          };
        else {
          const client = ensureBusiness();
          run = async () => {
            const result = editor.id
              ? await client.organization.updateTeam.mutate({
                  id: editor.id,
                  name,
                  expectedRevision: editor.expectedRevision,
                  requestId,
                })
              : await client.organization.createTeam.mutate({
                  name,
                  notes: editor.notes,
                  requestId,
                });
            businessSuccessSchema.parse(result);
          };
        }
      } else if (editor.kind === "member") {
        changes.push(
          `${editor.label}：${nameOfTeam(editor.beforeTeamId)} / ${teamRoleLabel(editor.beforeRole)} → ${nameOfTeam(editor.teamId)} / ${editor.teamId === null ? "未分组" : teamRoleLabel(editor.role)}`
        );
        changes.push(
          "组长是组织岗位，不自动附带模块权或系统管理权；不会迁移官方库存。"
        );
        if (
          editor.beforeTeamId === editor.teamId &&
          editor.beforeRole === (editor.teamId === null ? null : editor.role)
        )
          throw new Error("团队和岗位没有变化");
        if (domain === "operations")
          run = async () => {
            await setMember.mutateAsync({
              adminUserId: editor.id,
              teamId: editor.teamId,
              role: editor.teamId === null ? null : editor.role,
              expectedRevision: editor.expectedRevision,
              requestId,
            });
          };
        else {
          const client = ensureBusiness();
          run = async () => {
            businessSuccessSchema.parse(
              await client.organization.setMember.mutate({
                userId: editor.id,
                teamId: editor.teamId,
                role: editor.teamId === null ? null : editor.role,
                expectedRevision: editor.expectedRevision,
                requestId,
              })
            );
          };
        }
      } else if (editor.kind === "nativeAccess") {
        if (
          editor.member.adminRole === "super_admin" ||
          editor.member.adminUserId === native?.actorAdminUserId
        )
          throw new Error("不可修改超级管理员模块权利或自身系统身份");
        const template = STAFF_OPERATIONS_TEMPLATES.find(
          item => item.id === editor.templateId
        );
        if (!template) throw new Error("运营模板无效");
        const before = editor.member.permissions;
        const after = mergeStaffOperationsTemplate(
          editor.member.adminRole,
          before,
          template.permissions
        );
        const added = after.filter(
          key => !before.includes(key as (typeof before)[number])
        );
        const removed = before.filter(key => !after.includes(key));
        changes.push(`${editor.member.displayName}：应用「${template.name}」`);
        changes.push(
          `新增：${added.join("、") || "无"}`,
          `移除：${removed.join("、") || "无"}`
        );
        changes.push(
          "仅替换可下放的原生运营模块键；业务 ERP、business.*、官方库存及系统权限不变。目标员工原登录会话将失效。"
        );
        run = async () => {
          await applyTemplate.mutateAsync({
            adminUserId: editor.member.adminUserId,
            templateId: editor.templateId,
            expectedRevision: editor.member.revision,
            expectedSessionVersion: editor.member.sessionVersion,
            requestId,
          });
        };
      } else {
        const client = ensureBusiness();
        if (editor.member.enterpriseRole === "super_admin") throw new Error("企业所有者权利固定，不可通过模板修改");
        for (const module of editor.modules) {
          if (module.write && !module.read)
            throw new Error(`${moduleLabels[module.module]}：写入必须包含读取`);
          if (module.module === "channels" && module.scope !== "self")
            throw new Error("渠道始终私有，不允许团队或企业范围");
          if (module.module === "stocks" && module.scope === "enterprise")
            throw new Error("库存仅支持本人或同队共享，不允许全企业范围");
          const before = editor.member.moduleAccess.find(
            item => item.module === module.module
          );
          if (!before) throw new Error("原模块版本缺失，请刷新后重试");
          if (
            before.read !== module.read ||
            before.write !== module.write ||
            before.scope !== module.scope
          )
            changes.push(
              `${moduleLabels[module.module]}：${before.read ? "可读" : "不可读"}/${before.write ? "可写" : "不可写"}/${scopeLabels[before.scope]} → ${module.read ? "可读" : "不可读"}/${module.write ? "可写" : "不可写"}/${scopeLabels[module.scope]}`
            );
        }
        if (!changes.length) throw new Error("模块配置没有变化");
        changes.push(
          "仅保存业务模块范围与意图，不新增 ERP 授权。库存团队范围 + 可写仅允许编辑本人库存；他人显式分享始终只读。渠道始终私有。"
        );
        const input = {
          userId: editor.member.userId,
          modules: editor.modules.map(module => ({
            module: module.module,
            read: module.read,
            write: module.write,
            scope: module.scope,
            expectedRevision: module.revision,
          })),
          templateId: editor.templateId,
          requestId,
        };
        run = async () => {
          const result = businessUpdateAccessResultSchema.parse(
            await client.organization.updateMemberAccess.mutate(input)
          );
          return {
            notEntitledModules: result.modules.filter(module => module.notEntitled).map(module => moduleLabels[module.module]),
            effectiveSummary: result.modules.map(module => `${moduleLabels[module.module]}：${module.read ? "可读" : "不可读"}/${module.write ? "可写本人数据" : "不可写"}/${scopeLabels[module.scope]}`).join("；"),
          };
        };
      }
      setPreview({ title: "确认以下组织配置变化", changes, requestId, run });
    } catch (error) {
      setSaveError(errorText(error));
    }
  }
  async function confirmSave() {
    if (!preview || saving || !canManage) return;
    setSaving(true);
    setSaveError(null);
    try {
      const feedback = await preview.run();
      setEditor(null);
      setPreview(null);
      setNotice("保存已被服务端确认。正在重新读取实际生效配置…");
      await Promise.all([
        utils.staffOrganization.overview.invalidate(),
        utils.staffOrganization.audit.invalidate(),
        cache.invalidateQueries({ queryKey: businessKey }),
      ]);
      setNotice(
        feedback?.notEntitledModules.length
          ? `模块策略已保存，但以下模块的业务基础授权未开通，模板未扩大权限：${feedback.notEntitledModules.join("、")}。实际生效：${feedback.effectiveSummary}。`
          : "保存已确认。列表以重新读取的服务端数据为准；ERP 未授权的模块不会因模板保存而获得授权。"
      );
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  const title =
    section === "audit"
      ? "权限变更审计"
      : section === "templates"
        ? "岗位权限模板"
        : "组织与团队";
  const auditItems =
    domain === "operations"
      ? (nativeAuditData?.data.map(row => ({
          id: row.id,
          action: row.action,
          actor: row.actorAdminUserId,
          target: `${row.targetType} ${row.targetId}`,
          requestId: row.requestId,
          payloadHash: row.payloadHash,
          before: row.beforeData,
          after: row.afterData,
          createdAt: row.createdAt,
        })) ?? [])
      : (businessAudit.data?.items.map(row => ({
          id: row.id,
          action: row.action,
          actor: row.actorUserId,
          target: row.targetUserId
            ? `前台用户 ${row.targetUserId}`
            : "企业团队",
          requestId: row.requestId,
          payloadHash: row.payloadHash,
          before: row.beforeData,
          after: row.afterData,
          createdAt: row.createdAt,
        })) ?? []);
  const auditTotal =
    domain === "operations"
      ? (nativeAuditData?.total ?? 0)
      : (businessAudit.data?.total ?? 0);
  return (
    <DashboardLayout>
      <main data-organization-page>
        <PageHeader
          title={title}
          description="业务团队使用真实前台企业身份；运营团队使用独立后台工作人员身份。两域分别保存、分别审计，不是跨库单事务；岗位与模块授权互不替代。"
          actions={
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                if (domain === "operations") {
                  void nativeQuery.refetch();
                  void nativeAudit.refetch();
                } else {
                  void merchantsQuery.refetch();
                  if (scopeClient) void businessQuery.refetch();
                  if (business?.canManage) void businessAudit.refetch();
                }
              }}
            >
              刷新配置
            </Button>
          }
        />
        <div className="org-domain-tabs" role="tablist" aria-label="组织领域">
          <Button
            role="tab"
            aria-selected={domain === "business"}
            variant={domain === "business" ? "default" : "outline"}
            disabled={saving}
            onClick={() => setDomain("business")}
          >
            业务团队
          </Button>
          <Button
            role="tab"
            aria-selected={domain === "operations"}
            variant={domain === "operations" ? "default" : "outline"}
            disabled={saving}
            onClick={() => setDomain("operations")}
          >
            运营团队
          </Button>
        </div>
        <nav className="org-section-tabs" aria-label="组织页面">
          <Link
            href="/teams"
            aria-current={section === "teams" ? "page" : undefined}
          >
            团队与成员
          </Link>
          <Link
            href="/role-templates"
            aria-current={section === "templates" ? "page" : undefined}
          >
            岗位模板
          </Link>
          <Link
            href="/permission-audit"
            aria-current={section === "audit" ? "page" : undefined}
          >
            变更审计
          </Link>
        </nav>
        {domain === "business" && (
          <section className="org-panel">
            <label className="org-field">
              业务商户
              <select
                aria-label="业务商户"
                value={merchantId ?? ""}
                disabled={saving || merchantsQuery.isLoading}
                onChange={event =>
                  setSelectedMerchantId(
                    event.target.value ? Number(event.target.value) : null
                  )
                }
              >
                <option value="">请选择业务商户</option>
                {merchants.map(merchant => (
                  <option value={merchant.id} key={merchant.id}>
                    {merchant.companyName}（{merchant.merchantNo || merchant.id}
                    ）
                  </option>
                ))}
              </select>
            </label>
            <LoadingError
              loading={merchantsQuery.isLoading}
              error={merchantsQuery.error}
              retry={() => void merchantsQuery.refetch()}
            />
            {!merchantsQuery.isLoading &&
              !merchantsQuery.error &&
              merchants.length === 0 && (
                <p className="org-notice">
                  当前后台账号未绑定有效业务员工，或没有可进入的业务商户。业务编辑已禁用；仍可切换至运营团队。
                </p>
              )}
            {merchantsQuery.data && merchantsQuery.data.sourceTotal > 100 && (
              <p className="org-notice">
                当前显示前 100 个可访问商户。更多商户请从业务工作台选择。
              </p>
            )}
            {business && merchantId && (
              <p className="org-muted">
                企业：{business.enterprise.name} · 企业 ID{" "}
                {business.enterprise.id} · 真实前台操作者 ID{" "}
                {business.actorUserId}
              </p>
            )}
          </section>
        )}
        <LoadingError
          loading={loading}
          error={dataError}
          retry={() =>
            domain === "operations"
              ? void nativeQuery.refetch()
              : void businessQuery.refetch()
          }
        />
        {notice && (
          <p className="org-notice" role="status">
            {notice}
          </p>
        )}
        {ready && (
          <>
            {!canManage && (
              <p className="org-notice">
                {domain === "operations"
                  ? "仅真实后台超级管理员可编辑运营组织；当前只显示本人配置与所属团队，组长身份不附带系统管理权。"
                  : "当前真实前台业务员工不是企业所有者，业务组织编辑与企业审计已禁用。后台超级管理员身份不能替代前台企业所有者。"}
              </p>
            )}
            {section === "teams" && (
              <>
                <section className="org-panel">
                  <div className="org-heading">
                    <h2>{domain === "operations" ? "运营团队" : "业务团队"}</h2>
                    <Button
                      disabled={!isEditable}
                      onClick={() =>
                        open({
                          kind: "team",
                          id: null,
                          name: "",
                          notes: "",
                          status: "active",
                          expectedRevision: 0,
                        })
                      }
                    >
                      创建团队
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>团队</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>版本</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamRows.map(team => (
                        <TableRow key={team.id}>
                          <TableCell>
                            {team.name}
                            <span className="org-muted"> #{team.id}</span>
                          </TableCell>
                          <TableCell>
                            {team.status === "active" ? "启用" : "已归档"}
                          </TableCell>
                          <TableCell>{team.revision}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!isEditable}
                              onClick={() =>
                                open({
                                  kind: "team",
                                  id: team.id,
                                  name: team.name,
                                  notes:
                                    "notes" in team
                                      ? String(team.notes ?? "")
                                      : "",
                                  status:
                                    team.status === "active"
                                      ? "active"
                                      : "archived",
                                  expectedRevision: team.revision,
                                })
                              }
                            >
                              编辑团队
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!teamRows.length && (
                        <TableRow>
                          <TableCell colSpan={4}>
                            暂无团队；不会自动迁入官方库存团队。
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </section>
                <section className="org-panel">
                  <h2>成员与团队岗位</h2>
                  <p className="org-muted">
                    同一团队可设置多位组长。更改岗位不授予模块或系统权限。
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>工作人员</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>所属团队</TableHead>
                        <TableHead>岗位 / 版本</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {domain === "operations"
                        ? native?.members.map(member => (
                            <TableRow key={member.adminUserId}>
                              <TableCell>
                                {member.displayName}
                                <div className="org-muted">
                                  {member.username} · 后台 ID{" "}
                                  {member.adminUserId}
                                </div>
                              </TableCell>
                              <TableCell>{member.status}</TableCell>
                              <TableCell>{nameOfTeam(member.teamId)}</TableCell>
                              <TableCell>
                                {teamRoleLabel(member.teamRole)} /{" "}
                                {member.revision}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !isEditable || member.status !== "active"
                                  }
                                  onClick={() =>
                                    open({
                                      kind: "member",
                                      id: member.adminUserId,
                                      label: member.displayName,
                                      teamId: member.teamId,
                                      beforeTeamId: member.teamId,
                                      beforeRole: member.teamRole,
                                      role: member.teamRole ?? "member",
                                      expectedRevision: member.revision,
                                    })
                                  }
                                >
                                  配置团队
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        : business?.members.map(member => (
                            <TableRow key={member.userId}>
                              <TableCell>
                                {memberName(member)}
                                <div className="org-muted">
                                  {member.username || "—"} · 前台 ID{" "}
                                  {member.userId}
                                </div>
                              </TableCell>
                              <TableCell>{member.status}</TableCell>
                              <TableCell>{nameOfTeam(member.teamId)}</TableCell>
                              <TableCell>
                                {teamRoleLabel(member.teamRole)} /{" "}
                                {member.revision}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !isEditable || member.status !== "active"
                                  }
                                  onClick={() =>
                                    open({
                                      kind: "member",
                                      id: member.userId,
                                      label: memberName(member),
                                      teamId: member.teamId,
                                      beforeTeamId: member.teamId,
                                      beforeRole: member.teamRole,
                                      role: member.teamRole ?? "member",
                                      expectedRevision: member.revision,
                                    })
                                  }
                                >
                                  配置团队
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                    </TableBody>
                  </Table>
                </section>
              </>
            )}
            {section === "templates" && (
              <>
                <section className="org-panel">
                  <h2>
                    {domain === "operations" ? "原生运营模板" : "业务模块模板"}
                  </h2>
                  {domain === "operations"
                    ? native?.templates.map(template => (
                        <div className="org-template" key={template.id}>
                          <h3>{template.name}</h3>
                          <p>{template.description}</p>
                          <p className="org-key-list">
                            {template.permissions.join(" · ")}
                          </p>
                        </div>
                      ))
                    : business?.templates.map(template => (
                        <div className="org-template" key={template.id}>
                          <h3>{template.name}</h3>
                          <p>{template.description}</p>
                          <p>
                            {template.modules
                              .map(
                                module =>
                                  `${moduleLabels[module.module]}：${scopeLabels[module.scope]}`
                              )
                              .join(" · ")}
                          </p>
                        </div>
                      ))}
                </section>
                <section className="org-panel">
                  <h2>成员当前有效配置</h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>成员</TableHead>
                        <TableHead>有效模块权限 / 数据范围</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {domain === "operations"
                        ? native?.members.map(member => (
                            <TableRow key={member.adminUserId}>
                              <TableCell>
                                {member.displayName}
                                <div className="org-muted">
                                  后台 ID {member.adminUserId} ·{" "}
                                  {member.adminRole}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="org-key-list">
                                  {member.operationsPermissions.join(" · ") ||
                                    "无运营模块权限"}
                                </div>
                                <details>
                                  <summary>全部当前有效权限</summary>
                                  <p className="org-key-list">
                                    {member.permissions.join(" · ") || "无"}
                                  </p>
                                </details>
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !isEditable ||
                                    member.status !== "active" ||
                                    member.adminRole === "super_admin" ||
                                    member.adminUserId ===
                                      native.actorAdminUserId
                                  }
                                  onClick={() =>
                                    open({
                                      kind: "nativeAccess",
                                      member,
                                      templateId: "operations-view",
                                    })
                                  }
                                >
                                  应用模板
                                </Button>
                                {member.adminRole === "super_admin" && (
                                  <p className="org-muted">
                                    系统固定权利，不可更改
                                  </p>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        : business?.members.map(member => (
                            <TableRow key={member.userId}>
                              <TableCell>
                                {memberName(member)}
                                <div className="org-muted">
                                  前台 ID {member.userId}
                                </div>
                              </TableCell>
                              <TableCell>
                                {member.moduleAccess.map(module => (
                                  <div key={module.module}>
                                    {moduleLabels[module.module]}：
                                    {module.read ? "可读" : "不可读"} /{" "}
                                    {module.write
                                      ? "可写本人数据"
                                      : "只读或未授权"}{" "}
                                    / {scopeLabels[module.scope]}
                                    {module.explicit ? "" : "（默认生效值）"}
                                  </div>
                                ))}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !isEditable || member.status !== "active" || member.enterpriseRole === "super_admin"
                                  }
                                  onClick={() =>
                                    open({
                                      kind: "businessAccess",
                                      member,
                                      modules: member.moduleAccess.map(
                                        module => ({ ...module })
                                      ),
                                    })
                                  }
                                >
                                  配置模块
                                </Button>
                                {member.enterpriseRole === "super_admin" && <p className="org-muted">企业所有者权利固定，不可更改</p>}
                              </TableCell>
                            </TableRow>
                          ))}
                    </TableBody>
                  </Table>
                </section>
              </>
            )}
            {section === "audit" && (
              <section className="org-panel">
                <h2>服务端审计记录</h2>
                <p className="org-muted">
                  记录请求号、内容摘要与变更前后值。运营与业务审计分域存储。
                </p>
                {(domain === "operations" || business?.canManage) && (
                  <>
                    <LoadingError
                      loading={
                        domain === "operations"
                          ? nativeAudit.isLoading
                          : businessAudit.isLoading
                      }
                      error={
                        domain === "operations"
                          ? nativeAudit.error
                          : businessAudit.error
                      }
                      retry={() =>
                        domain === "operations"
                          ? void nativeAudit.refetch()
                          : void businessAudit.refetch()
                      }
                    />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>时间 / 操作</TableHead>
                          <TableHead>操作者 / 目标</TableHead>
                          <TableHead>变更明细</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditItems.map(row => (
                          <TableRow key={row.id}>
                            <TableCell>
                              {new Date(row.createdAt).toLocaleString("zh-CN")}
                              <div>{row.action}</div>
                            </TableCell>
                            <TableCell>
                              {row.actor === null
                                ? "已授权管理员"
                                : `ID ${row.actor}`}
                              <div>{row.target}</div>
                            </TableCell>
                            <TableCell>
                              <details>
                                <summary>查看前后差异与请求摘要</summary>
                                <p className="org-key-list">
                                  请求号：{row.requestId ?? "仅管理员可见"}
                                  <br />
                                  内容摘要：{row.payloadHash ?? "仅管理员可见"}
                                </p>
                                <h3>变更前</h3>
                                <pre>{jsonText(row.before)}</pre>
                                <h3>变更后</h3>
                                <pre>{jsonText(row.after)}</pre>
                              </details>
                            </TableCell>
                          </TableRow>
                        ))}
                        {!auditItems.length &&
                          !(domain === "operations"
                            ? nativeAudit.isLoading || nativeAudit.error
                            : businessAudit.isLoading ||
                              businessAudit.error) && (
                            <TableRow>
                              <TableCell colSpan={3}>
                                暂无可见审计记录
                              </TableCell>
                            </TableRow>
                          )}
                      </TableBody>
                    </Table>
                    <div className="org-pagination">
                      <Button
                        variant="outline"
                        disabled={auditPage <= 1}
                        onClick={() => setAuditPage(page => page - 1)}
                      >
                        上一页
                      </Button>
                      <span>
                        第 {auditPage} 页 · 共 {auditTotal} 条
                      </span>
                      <Button
                        variant="outline"
                        disabled={auditPage * 20 >= auditTotal}
                        onClick={() => setAuditPage(page => page + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
        <Dialog
          open={editor !== null}
          onOpenChange={openState => {
            if (!openState && !saving) {
              setEditor(null);
              setPreview(null);
              setSaveError(null);
            }
          }}
        >
          <DialogContent
            className="org-dialog"
            onPointerDownOutside={event => {
              if (saving) event.preventDefault();
            }}
            onEscapeKeyDown={event => {
              if (saving) event.preventDefault();
            }}
            showCloseButton={!saving}
          >
            <DialogHeader>
              <DialogTitle>
                {preview
                  ? preview.title
                  : editor?.kind === "team"
                    ? editor.id
                      ? "编辑团队"
                      : "创建团队"
                    : editor?.kind === "member"
                      ? "配置团队岗位"
                      : "配置模块权限"}
              </DialogTitle>
              <DialogDescription>
                {domain === "operations"
                  ? "运营身份来自 admin_users.id，与官方库存团队和业务 ERP 完全分离。"
                  : "仅当前真实前台企业所有者可保存。岗位不等同于模块权限；模板不新增 ERP 授权。"}
              </DialogDescription>
            </DialogHeader>
            {preview ? (
              <div className="org-preview">
                <ul>
                  {preview.changes.map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
                </ul>
                <p className="org-muted">
                  请求号：{preview.requestId}
                  。失败重试复用同一请求号，不会重复应用。
                </p>
              </div>
            ) : editor?.kind === "team" ? (
              <div className="org-fields">
                <label className="org-field">
                  团队名称
                  <Input
                    value={editor.name}
                    maxLength={domain === "operations" ? 128 : 80}
                    onChange={event =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                  />
                </label>
                {(domain === "operations" || editor.id === null) && (
                  <label className="org-field">
                    备注
                    <textarea
                      value={editor.notes}
                      maxLength={domain === "operations" ? 2000 : 500}
                      onChange={event =>
                        setEditor({ ...editor, notes: event.target.value })
                      }
                    />
                  </label>
                )}
                {domain === "operations" && editor.id && (
                  <label className="org-field">
                    状态
                    <select
                      value={editor.status}
                      onChange={event =>
                        setEditor({
                          ...editor,
                          status:
                            event.target.value === "active"
                              ? "active"
                              : "archived",
                        })
                      }
                    >
                      <option value="active">启用</option>
                      <option value="archived">归档（须先移出所有成员）</option>
                    </select>
                  </label>
                )}
              </div>
            ) : editor?.kind === "member" ? (
              <div className="org-fields">
                <p>{editor.label}</p>
                <label className="org-field">
                  所属团队
                  <select
                    value={editor.teamId ?? ""}
                    onChange={event =>
                      setEditor({
                        ...editor,
                        teamId: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">移出团队 / 不分组</option>
                    {teamRows
                      .filter(team => team.status === "active")
                      .map(team => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="org-field">
                  团队岗位
                  <select
                    value={editor.role}
                    disabled={editor.teamId === null}
                    onChange={event =>
                      setEditor({
                        ...editor,
                        role:
                          event.target.value === "leader" ? "leader" : "member",
                      })
                    }
                  >
                    <option value="member">成员</option>
                    <option value="leader">
                      组长（不自动附带模块或系统权限）
                    </option>
                  </select>
                </label>
              </div>
            ) : editor?.kind === "nativeAccess" ? (
              <div className="org-fields">
                <p>
                  {editor.member.displayName} · 后台 ID{" "}
                  {editor.member.adminUserId}
                </p>
                <label className="org-field">
                  运营模板
                  <select
                    value={editor.templateId}
                    onChange={event =>
                      setEditor({
                        ...editor,
                        templateId:
                          event.target.value === "platform-operations"
                            ? "platform-operations"
                            : "operations-view",
                      })
                    }
                  >
                    {STAFF_OPERATIONS_TEMPLATES.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  保存会替换原生运营模块键，保留其他域已有权利；不修改账号级别。
                </p>
              </div>
            ) : editor?.kind === "businessAccess" ? (
              <div className="org-fields">
                <p>
                  {memberName(editor.member)} · 前台 ID {editor.member.userId}
                </p>
                <label className="org-field">
                  填入岗位模板
                  <select
                    value={editor.templateId ?? ""}
                    onChange={event => {
                      const template = business?.templates.find(
                        item => item.id === event.target.value
                      );
                      if (!template) return;
                      setEditor({
                        ...editor,
                        templateId: template.id,
                        modules: editor.modules.map(module => ({
                          ...module,
                          ...template.modules.find(
                            item => item.module === module.module
                          ),
                        })),
                      });
                    }}
                  >
                    <option value="">按模块设置</option>
                    {business?.templates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模块</TableHead>
                      <TableHead>可读</TableHead>
                      <TableHead>可写</TableHead>
                      <TableHead>数据范围</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editor.modules.map(module => (
                      <TableRow key={module.module}>
                        <TableCell>{moduleLabels[module.module]}</TableCell>
                        <TableCell>
                          <input
                            aria-label={`${moduleLabels[module.module]}可读`}
                            type="checkbox"
                            checked={module.read}
                            onChange={event =>
                              setEditor({
                                ...editor,
                                templateId: undefined,
                                modules: editor.modules.map(item =>
                                  item.module === module.module
                                    ? {
                                        ...item,
                                        read: event.target.checked,
                                        write:
                                          event.target.checked && item.write,
                                      }
                                    : item
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            aria-label={`${moduleLabels[module.module]}可写`}
                            type="checkbox"
                            checked={module.write}
                            onChange={event =>
                              setEditor({
                                ...editor,
                                templateId: undefined,
                                modules: editor.modules.map(item =>
                                  item.module === module.module
                                    ? {
                                        ...item,
                                        write: event.target.checked,
                                        read: item.read || event.target.checked,
                                      }
                                    : item
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            aria-label={`${moduleLabels[module.module]}数据范围`}
                            value={module.scope}
                            onChange={event => {
                              const scope = event.target.value;
                              if (
                                scope !== "self" &&
                                scope !== "team" &&
                                scope !== "enterprise"
                              )
                                return;
                              setEditor({
                                ...editor,
                                templateId: undefined,
                                modules: editor.modules.map(item =>
                                  item.module === module.module
                                    ? { ...item, scope }
                                    : item
                                ),
                              });
                            }}
                          >
                            <option value="self">仅本人</option>
                            {module.module !== "channels" && (
                              <option value="team">所在团队</option>
                            )}
                            {module.module !== "channels" &&
                              module.module !== "stocks" && (
                                <option value="enterprise">整个企业</option>
                              )}
                          </select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="org-notice">
                  库存团队范围可保留本人写权限；其他人的显式共享始终只读。渠道不可分享。ERP
                  未授予的模块在保存后仍不可访问。
                </p>
              </div>
            ) : null}
            {saveError && (
              <div className="org-error" role="alert">
                {saveError}
                <p>
                  输入已保留。可重试原请求；若版本冲突，请保留需要的变更，关闭并刷新配置后重新预览。
                </p>
              </div>
            )}
            <DialogFooter>
              {preview ? (
                <>
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => {
                      setPreview(null);
                      setSaveError(null);
                    }}
                  >
                    返回修改
                  </Button>
                  <Button
                    disabled={saving || !canManage}
                    onClick={() => void confirmSave()}
                  >
                    {saving
                      ? "正在保存…"
                      : saveError
                        ? "重试确认保存"
                        : "确认保存"}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setEditor(null)}>
                    取消
                  </Button>
                  <Button disabled={!isEditable} onClick={prepare}>
                    预览变更
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </DashboardLayout>
  );
}
