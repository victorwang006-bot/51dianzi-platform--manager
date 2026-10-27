import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ZHIJIE_CAPABILITIES,
  ZHIJIE_CAPABILITY_LABELS,
  ZHIJIE_MODULES,
  ZHIJIE_ROLE_LABELS,
  isZhijieModule,
  type ZhijieAccessInput,
  type ZhijieCapability,
  type ZhijieContext,
  type ZhijieGrants,
  type ZhijieModuleId,
  type ZhijieRole,
  type ZhijieSetup,
  type ZhijieStaffAccess,
} from "@shared/zhijieBusiness";
import {
  ZhijieApiError,
  getZhijieAudit,
  getZhijieContext,
  getZhijieRecords,
  getZhijieSetup,
  saveZhijieAccess,
} from "@/lib/zhijieApi";
import "./ZhijieBusiness.css";

type AuthIdentity = { id?: number } | null | undefined;
type AccessForm = ZhijieAccessInput;

const initialAccessForm = (): AccessForm => ({
  adminUserId: 0,
  sourceMemberId: 0,
  role: "employee",
  teamIds: [],
  grants: {},
  status: "active",
  expectedRevision: 0,
  reason: "",
});

function safeErrorMessage(error: unknown): string {
  return error instanceof ZhijieApiError
    ? error.message
    : "请求未完成，请刷新后重试。";
}

/**
 * 智捷 REST 运行在同源 sidecar，不共享 tRPC 的 QueryClient。identity 明确包含
 * 当前管理员及授权修订号；identity 变更时绝不复用前一个账号的结果。
 */
function useRemote<T>(
  identity: string,
  enabled: boolean,
  loader: () => Promise<T>
) {
  const loaderRef = useRef(loader);
  const sequenceRef = useRef(0);
  const [state, setState] = useState<{
    identity: string;
    loading: boolean;
    data?: T;
    error?: unknown;
  }>({ identity: "", loading: false });
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    if (!enabled) {
      setState({ identity, loading: false });
      return;
    }
    setState({ identity, loading: true });
    try {
      const data = await loaderRef.current();
      if (sequence === sequenceRef.current)
        setState({ identity, loading: false, data });
    } catch (error) {
      if (sequence === sequenceRef.current)
        setState({ identity, loading: false, error });
    }
  }, [enabled, identity]);

  useEffect(() => {
    void reload();
  }, [reload]);
  const current = state.identity === identity ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    isLoading: enabled && (!current || current.loading),
    isError: Boolean(current?.error),
    reload,
  };
}

function roleLabel(role: ZhijieRole): string {
  return ZHIJIE_ROLE_LABELS[role];
}

function sourceName(setup: ZhijieSetup, access: ZhijieStaffAccess): string {
  return (
    setup.members.find(member => member.memberId === access.sourceMemberId)
      ?.name ||
    access.displayName ||
    `源成员 #${access.sourceMemberId}`
  );
}

function grantsSummary(grants: ZhijieGrants): string {
  const names = Object.entries(grants)
    .filter(([, capabilities]) => capabilities && capabilities.length)
    .map(([moduleId, capabilities]) => {
      const module = ZHIJIE_MODULES.find(item => item.id === moduleId);
      return `${module?.label || moduleId}（${capabilities!.map(capability => ZHIJIE_CAPABILITY_LABELS[capability]).join("、")}）`;
    });
  return names.length ? names.join("；") : "未配置业务授权";
}

function Navigation({
  context,
  active,
  navigate,
}: {
  context: ZhijieContext;
  active: string;
  navigate: (path: string) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, (typeof ZHIJIE_MODULES)[number][]>();
    ZHIJIE_MODULES.filter(module =>
      context.readableModules.includes(module.id)
    ).forEach(module => {
      const current = groups.get(module.group) ?? [];
      current.push(module);
      groups.set(module.group, current);
    });
    return Array.from(groups.entries());
  }, [context.readableModules]);

  return (
    <nav className="zj-nav" aria-label="智捷业务模块">
      {grouped.map(([group, modules]) => (
        <div className="zj-nav-group" key={group}>
          <div className="zj-nav-caption">{group}</div>
          {modules.map(module => (
            <button
              key={module.id}
              className={`zj-nav-item ${active === module.id ? "is-active" : ""}`}
              onClick={() => navigate(`/zhijie/${module.id}`)}
            >
              {module.label}
            </button>
          ))}
        </div>
      ))}
      {(context.canConfigure || context.authorized) && (
        <div className="zj-nav-group">
          <div className="zj-nav-caption">业务设置</div>
          {context.canConfigure && (
            <button
              className={`zj-nav-item ${active === "team-access" ? "is-active" : ""}`}
              onClick={() => navigate("/zhijie/team-access")}
            >
              权限配置
            </button>
          )}
          {context.canConfigure && (
            <button
              className={`zj-nav-item ${active === "audit" ? "is-active" : ""}`}
              onClick={() => navigate("/zhijie/audit")}
            >
              权限审计
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

function AccessDenied({ context }: { context: ZhijieContext }) {
  return (
    <div className="zj-state">
      <strong>
        {context.status === "unconfigured"
          ? "智捷业务尚未完成授权"
          : "当前账号无业务访问权限"}
      </strong>
      <p>{context.message || "请联系智捷业务管理员确认授权范围。"}</p>
    </div>
  );
}

function BusinessModule({
  moduleId,
  context,
  adminUserId,
}: {
  moduleId: ZhijieModuleId;
  context: ZhijieContext;
  adminUserId: number;
}) {
  const module = ZHIJIE_MODULES.find(item => item.id === moduleId)!;
  const records = useRemote(
    `zhijie:records:${adminUserId}:${context.access?.revision ?? "no-grant"}:${moduleId}`,
    context.authorized && context.readableModules.includes(moduleId),
    () => getZhijieRecords(moduleId)
  );

  return (
    <section className="zj-card">
      <div className="zj-card-head">
        <div>
          <h2>{module.label}</h2>
          <p>{module.group} · 数据将从智捷业务事实源读取</p>
        </div>
        <button
          className="zj-button zj-button-primary"
          disabled
          title="业务数据接入后可用"
        >
          新建（数据接入后可用）
        </button>
      </div>
      <p className="zj-note">
        当前页面不提供本地演示数据；筛选、分页与写入操作将在智捷业务数据源接入后启用。
      </p>
      <div className="zj-toolbar">
        <input
          className="zj-control zj-search"
          disabled
          placeholder={`筛选${module.label}（数据接入后可用）`}
        />
        <select
          className="zj-control"
          disabled
          defaultValue="all"
          aria-label="状态筛选"
        >
          <option value="all">全部状态</option>
        </select>
        <span className="zj-toolbar-tip">
          真实业务字段：{module.columns.join("、")}
        </span>
      </div>
      <div className="zj-table-scroll">
        <table className="zj-table">
          <thead>
            <tr>
              {module.columns.map(column => (
                <th key={column}>{column}</th>
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="zj-empty-cell" colSpan={module.columns.length + 1}>
                {records.isLoading ? (
                  <>
                    <strong>正在核验智捷业务数据连接</strong>
                    <p>请稍候。</p>
                  </>
                ) : records.isError ? (
                  <>
                    <strong>业务数据暂不可读取</strong>
                    <p>{safeErrorMessage(records.error)}</p>
                  </>
                ) : (
                  <>
                    <strong>功能入口已建立，智捷业务数据尚未接入</strong>
                    <p>
                      {records.data?.message || "当前状态不代表 0 条业务数据。"}
                    </p>
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="zj-pagination">
        <span>数据接入后将显示真实总数</span>
        <div>
          <button className="zj-button" disabled>
            上一页
          </button>
          <span>— / —</span>
          <button className="zj-button" disabled>
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}

function teamRule(
  form: AccessForm,
  setup: ZhijieSetup
): { error: string | null; allowedTeams: number[] | null } {
  const member = setup.members.find(
    item => item.memberId === form.sourceMemberId
  );
  const activeTeamIds = setup.teams
    .filter(team => team.status === "active")
    .map(team => team.id);
  if (!member)
    return { error: "请选择来自智捷组织的源成员。", allowedTeams: null };
  if (member.status !== "active")
    return { error: "已停用的源成员不能配置业务权限。", allowedTeams: null };
  if (form.role === "employee") {
    // 服务端以 sourceUserId 收窄普通员工到本人负责数据，teamIds 必须为空，
    // 不能从成员归属团队推导范围，否则会无意扩大读取范围。
    return form.teamIds.length === 0
      ? { error: null, allowedTeams: [] }
      : {
          error: "普通员工仅可查看本人负责数据，不得配置团队范围。",
          allowedTeams: [],
        };
  }
  if (form.role === "team_manager") {
    const leaderTeam = setup.teams.find(
      team => team.status === "active" && team.leaderUserId === member.userId
    );
    if (!leaderTeam)
      return {
        error: "团队经理必须与智捷组织中现有的团队负责人一致。",
        allowedTeams: [],
      };
    return { error: null, allowedTeams: [leaderTeam.id] };
  }
  return { error: null, allowedTeams: activeTeamIds };
}

function TeamAccess({
  context,
  adminUserId,
  reloadContext,
}: {
  context: ZhijieContext;
  adminUserId: number;
  reloadContext: () => Promise<void>;
}) {
  const setupRemote = useRemote(
    `zhijie:setup:${adminUserId}:${context.access?.revision ?? "configure"}`,
    context.canConfigure,
    getZhijieSetup
  );
  const [form, setForm] = useState<AccessForm>(initialAccessForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const setup = setupRemote.data;
  const configurationReady = Boolean(
    setup?.schemaReady &&
      setup?.sourceReady &&
      context.status !== "source_unavailable"
  );
  const rule = setup
    ? teamRule(form, setup)
    : { error: null, allowedTeams: null };

  const loadAccess = (access: ZhijieStaffAccess) => {
    setForm({
      adminUserId: access.adminUserId,
      sourceMemberId: access.sourceMemberId,
      role: access.role,
      teamIds: [...access.teamIds],
      grants: Object.fromEntries(
        Object.entries(access.grants).map(([key, values]) => [
          key,
          [...(values ?? [])],
        ])
      ),
      status: access.status,
      expectedRevision: access.revision,
      reason: "",
    });
    setFormError(null);
  };

  const changeAdmin = (adminUserId: number) => {
    const existing = setup?.staff.find(
      staff => staff.adminUserId === adminUserId
    );
    if (existing) return loadAccess(existing);
    setForm(previous => ({ ...previous, adminUserId, expectedRevision: 0 }));
  };

  const changeMember = (sourceMemberId: number) => {
    const member = setup?.members.find(
      item => item.memberId === sourceMemberId
    );
    setForm(previous => {
      const next = {
        ...previous,
        sourceMemberId,
        expectedRevision: previous.expectedRevision,
      };
      if (!member) return next;
      if (next.role === "employee") next.teamIds = [];
      if (next.role === "team_manager") {
        const leader = setup?.teams.find(
          team =>
            team.status === "active" && team.leaderUserId === member.userId
        );
        next.teamIds = leader ? [leader.id] : [];
      }
      return next;
    });
  };

  const changeRole = (role: ZhijieRole) => {
    setForm(previous => {
      const next = { ...previous, role };
      const member = setup?.members.find(
        item => item.memberId === previous.sourceMemberId
      );
      if (role === "employee") next.teamIds = [];
      if (role === "team_manager") {
        const leader = setup?.teams.find(
          team =>
            team.status === "active" && team.leaderUserId === member?.userId
        );
        next.teamIds = leader ? [leader.id] : [];
      }
      return next;
    });
  };

  const toggleTeam = (teamId: number, checked: boolean) => {
    setForm(previous => ({
      ...previous,
      teamIds: checked
        ? Array.from(new Set([...previous.teamIds, teamId]))
        : previous.teamIds.filter(id => id !== teamId),
    }));
  };

  const toggleGrant = (
    moduleId: ZhijieModuleId,
    capability: ZhijieCapability,
    checked: boolean
  ) => {
    setForm(previous => {
      const existing = previous.grants[moduleId] ?? [];
      const values = checked
        ? Array.from(
            new Set([...existing, "read" as ZhijieCapability, capability])
          )
        : capability === "read"
          ? []
          : existing.filter(item => item !== capability);
      const grants = { ...previous.grants };
      if (values.length) grants[moduleId] = values;
      else delete grants[moduleId];
      return { ...previous, grants };
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!setup || !configurationReady) return;
    if (!form.adminUserId) return setFormError("请选择实际后台管理账号。");
    if (form.adminUserId === adminUserId)
      return setFormError(
        "不能为当前登录账号配置自己的智捷业务权限，请由另一位授权管理员处理。"
      );
    if (!form.sourceMemberId) return setFormError("请选择智捷组织源成员。");
    if (!form.reason.trim())
      return setFormError("请填写本次配置或撤销的原因。");
    if (rule.error) return setFormError(rule.error);
    if (
      form.role !== "employee" &&
      rule.allowedTeams &&
      (form.teamIds.length === 0 ||
        form.teamIds.some(id => !rule.allowedTeams!.includes(id)))
    ) {
      return setFormError("所选团队不符合当前岗位与源组织成员的团队约束。");
    }
    const selectedMember = setup.members.find(
      member => member.memberId === form.sourceMemberId
    );
    const unsupportedModule = Object.keys(form.grants).find(moduleId => {
      const module = isZhijieModule(moduleId)
        ? ZHIJIE_MODULES.find(item => item.id === moduleId)
        : undefined;
      return (
        !module ||
        !(
          selectedMember?.isOwner ||
          selectedMember?.sourcePermissions.includes(module.sourcePermission)
        )
      );
    });
    if (unsupportedModule)
      return setFormError(
        "所选源成员未具备该模块对应的 ERP 来源权限，不能保存授权。"
      );
    setFormError(null);
    setIsSaving(true);
    try {
      await saveZhijieAccess({ ...form, reason: form.reason.trim() });
      await Promise.all([reloadContext(), setupRemote.reload()]);
    } catch (error) {
      // 保留当前表单和 expectedRevision，便于操作人修正后重新提交。
      setFormError(safeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (!context.canConfigure) return <AccessDenied context={context} />;
  if (setupRemote.isLoading)
    return (
      <div className="zj-state">
        <strong>正在读取权限配置来源</strong>
        <p>请稍候。</p>
      </div>
    );
  if (setupRemote.isError || !setup)
    return (
      <div className="zj-state">
        <strong>权限配置暂不可用</strong>
        <p>
          {setupRemote.isError
            ? safeErrorMessage(setupRemote.error)
            : context.message}
        </p>
      </div>
    );
  if (!configurationReady)
    return (
      <div className="zj-state">
        <strong>
          {setup.message || context.message || "权限配置来源尚未准备完成"}
        </strong>
        <p>源组织或权限表未准备完成，当前不能配置或撤销任何业务权限。</p>
      </div>
    );

  const activeAdmins = setup.adminAccounts.filter(
    account => account.status === "active"
  );
  const activeMembers = setup.members.filter(
    member => member.status === "active"
  );
  const selectedMember = setup.members.find(
    member => member.memberId === form.sourceMemberId
  );
  return (
    <>
      <section className="zj-card">
        <div className="zj-card-head">
          <div>
            <h2>团队与业务权限配置</h2>
            <p>
              实际后台账号与智捷组织源成员必须一一确认；服务端会再次校验岗位、团队及并发版本。
            </p>
          </div>
        </div>
        <form className="zj-form" onSubmit={submit}>
          <div className="zj-fields">
            <label className="zj-field">
              <span>实际后台管理账号</span>
              <select
                className="zj-control"
                value={form.adminUserId || ""}
                onChange={event => changeAdmin(Number(event.target.value))}
              >
                <option value="">请选择账号</option>
                {activeAdmins.map(account => (
                  <option value={account.id} key={account.id}>
                    {account.name}（#{account.id}）
                  </option>
                ))}
              </select>
              <small>仅列出当前可用的实际后台账号。</small>
            </label>
            <label className="zj-field">
              <span>智捷组织源成员</span>
              <select
                className="zj-control"
                value={form.sourceMemberId || ""}
                onChange={event => changeMember(Number(event.target.value))}
              >
                <option value="">请选择源成员</option>
                {activeMembers.map(member => (
                  <option value={member.memberId} key={member.memberId}>
                    {member.name}（成员 #{member.memberId}）
                  </option>
                ))}
              </select>
              <small>仅列出智捷源组织中的在职成员。</small>
            </label>
            <label className="zj-field">
              <span>业务岗位</span>
              <select
                className="zj-control"
                value={form.role}
                onChange={event => changeRole(event.target.value as ZhijieRole)}
              >
                {Object.entries(ZHIJIE_ROLE_LABELS).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
              <small>
                团队经理须匹配既有团队负责人；部门经理可配置多个团队。
              </small>
            </label>
            <label className="zj-field">
              <span>权限状态</span>
              <select
                className="zj-control"
                value={form.status}
                onChange={event =>
                  setForm(previous => ({
                    ...previous,
                    status: event.target.value as AccessForm["status"],
                  }))
                }
              >
                <option value="active">启用</option>
                <option value="disabled">禁用权限（撤销模式）</option>
              </select>
              <small>
                {form.status === "disabled"
                  ? "撤销会保留审计记录，必须说明原因。"
                  : "保存时使用当前版本号防止覆盖其他管理员的改动。"}
              </small>
            </label>
            <div className="zj-field zj-field-full">
              <span>业务团队</span>
              <div className="zj-team-picks">
                {setup.teams
                  .filter(team => team.status === "active")
                  .map(team => {
                    const permitted =
                      rule.allowedTeams === null ||
                      rule.allowedTeams.includes(team.id);
                    return (
                      <label className="zj-check" key={team.id}>
                        <input
                          type="checkbox"
                          checked={form.teamIds.includes(team.id)}
                          disabled={!permitted}
                          onChange={event =>
                            toggleTeam(team.id, event.target.checked)
                          }
                        />
                        <span>
                          {team.name}
                          <small className="zj-subline">
                            团队负责人后台用户 #{team.leaderUserId}
                          </small>
                        </span>
                      </label>
                    );
                  })}
              </div>
              <small>
                {rule.error ||
                  "普通员工按本人负责范围读取，不配置团队；团队经理须使用来源中的唯一主团队，部门经理可配置多个既有团队。"}
              </small>
            </div>
            <div className="zj-field zj-field-full">
              <span>模块授权</span>
              <div className="zj-grants">
                {ZHIJIE_MODULES.map(module => {
                  const selected = form.grants[module.id] ?? [];
                  const sourceAllowed = Boolean(
                    selectedMember?.isOwner ||
                      selectedMember?.sourcePermissions.includes(
                        module.sourcePermission
                      )
                  );
                  return (
                    <div className="zj-grant-module" key={module.id}>
                      <div className="zj-grant-name">{module.label}</div>
                      <div className="zj-grant-options">
                        {ZHIJIE_CAPABILITIES.map(capability => {
                          const checked = selected.includes(capability);
                          const capabilityAllowed = capability === "assign"
                            ? form.role !== "employee"
                            : capability === "publish"
                              ? Boolean(selectedMember?.isOwner || selectedMember?.sourcePermissions.includes("inventory.publish"))
                              : capability === "template" || capability === "seal"
                                ? module.id === "templates" && Boolean(selectedMember?.isOwner)
                                : true;
                          return (
                            <label className="zj-check" key={capability}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={
                                  !selectedMember ||
                                  ((!sourceAllowed || !capabilityAllowed) && !checked)
                                }
                                onChange={event =>
                                  toggleGrant(
                                    module.id,
                                    capability,
                                    event.target.checked
                                  )
                                }
                              />
                              {ZHIJIE_CAPABILITY_LABELS[capability]}
                            </label>
                          );
                        })}
                      </div>
                      {selectedMember && !sourceAllowed && (
                        <small className="zj-subline">
                          该源成员未获得 {module.sourcePermission}
                          ，不可新增该模块授权。
                        </small>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <label className="zj-field zj-field-full">
              <span>配置原因</span>
              <textarea
                className="zj-control"
                rows={3}
                value={form.reason}
                onChange={event =>
                  setForm(previous => ({
                    ...previous,
                    reason: event.target.value,
                  }))
                }
                placeholder={
                  form.status === "disabled"
                    ? "请说明撤销权限的业务原因（必填）"
                    : "请说明配置或调整的业务原因（必填）"
                }
              />
              <small>此原因会进入权限审计记录。</small>
            </label>
          </div>
          {formError && (
            <div className="zj-inline-error" role="alert">
              {formError}
            </div>
          )}
          <div className="zj-form-footer">
            <button
              type="button"
              className="zj-button"
              onClick={() => {
                setForm(initialAccessForm());
                setFormError(null);
              }}
              disabled={isSaving}
            >
              清空配置
            </button>
            <button
              className="zj-button zj-button-primary"
              type="submit"
              disabled={isSaving}
            >
              {isSaving
                ? "正在提交…"
                : form.status === "disabled"
                  ? "确认撤销权限"
                  : "保存权限配置"}
            </button>
          </div>
        </form>
      </section>
      <h3 className="zj-subhead">当前权限名单</h3>
      <section className="zj-card">
        <div className="zj-table-scroll">
          <table className="zj-table">
            <thead>
              <tr>
                <th>后台账号 / 源成员</th>
                <th>岗位与团队</th>
                <th>模块授权</th>
                <th>状态</th>
                <th>版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {setup.staff.length ? (
                setup.staff.map(staff => (
                  <tr key={staff.adminUserId}>
                    <td>
                      <span className="zj-staff-name">
                        {sourceName(setup, staff)}
                      </span>
                      <span className="zj-subline">
                        后台账号 #{staff.adminUserId} · 源成员 #
                        {staff.sourceMemberId}
                      </span>
                    </td>
                    <td>
                      {roleLabel(staff.role)}
                      <span className="zj-subline">
                        {staff.teamIds.length
                          ? staff.teamIds
                              .map(
                                id =>
                                  setup.teams.find(team => team.id === id)
                                    ?.name || `团队 #${id}`
                              )
                              .join("、")
                          : "未绑定团队"}
                      </span>
                    </td>
                    <td>
                      <span className="zj-subline">
                        {grantsSummary(staff.grants)}
                      </span>
                    </td>
                    <td>
                      <span className="zj-status">
                        <i
                          className={`zj-dot ${staff.status === "disabled" ? "zj-dot-muted" : ""}`}
                        />
                        {staff.status === "active" ? "启用" : "已禁用"}
                      </span>
                    </td>
                    <td>修订 {staff.revision}</td>
                    <td>
                      <button
                        className="zj-link-button"
                        onClick={() => loadAccess(staff)}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="zj-empty-cell" colSpan={6}>
                    <strong>尚无已保存的业务权限配置</strong>
                    <p>请仅根据智捷源组织中真实存在的成员和团队进行配置。</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Audit({
  context,
  adminUserId,
}: {
  context: ZhijieContext;
  adminUserId: number;
}) {
  const auditRemote = useRemote(
    `zhijie:audit:${adminUserId}:${context.access?.revision ?? "audit"}`,
    context.canConfigure,
    getZhijieAudit
  );
  if (!context.canConfigure) return <AccessDenied context={context} />;
  if (auditRemote.isLoading)
    return (
      <div className="zj-state">
        <strong>正在读取权限审计记录</strong>
        <p>请稍候。</p>
      </div>
    );
  if (auditRemote.isError)
    return (
      <div className="zj-state">
        <strong>权限审计暂不可用</strong>
        <p>{safeErrorMessage(auditRemote.error)}</p>
      </div>
    );
  const rows = auditRemote.data ?? [];
  return (
    <section className="zj-card">
      <div className="zj-card-head">
        <div>
          <h2>权限审计</h2>
          <p>以下记录来自智捷业务权限服务，不包含本地模拟操作。</p>
        </div>
      </div>
      <div className="zj-audit">
        {rows.length ? (
          rows.map(row => (
            <div className="zj-audit-row" key={row.id}>
              <i className="zj-audit-dot" />
              <div>
                <b>{row.action}</b>
                <p>
                  操作人后台账号 #{row.actorAdminId} · 目标后台账号 #
                  {row.targetAdminId}
                </p>
                <p>{row.reason || "未提供原因"}</p>
                <small>{row.createdAt}</small>
              </div>
            </div>
          ))
        ) : (
          <div className="zj-state">
            <strong>尚无权限审计记录</strong>
            <p>权限变更提交并由服务端确认后，记录会显示在此处。</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function ZhijieBusiness() {
  const [location, navigate] = useLocation();
  const auth = useAuth();
  const adminUserId = (auth.user as AuthIdentity)?.id ?? null;
  const contextRemote = useRemote(
    `zhijie:context:${adminUserId ?? "anonymous"}`,
    !auth.loading && typeof adminUserId === "number" && adminUserId > 0,
    getZhijieContext
  );
  const context = contextRemote.data;
  const path = location.split("?")[0];
  const selection = path.startsWith("/zhijie/")
    ? path.slice("/zhijie/".length)
    : "";

  useEffect(() => {
    if (path !== "/zhijie" || !context) return;
    const defaultPath = context.readableModules[0]
      ? `/zhijie/${context.readableModules[0]}`
      : context.canConfigure
        ? "/zhijie/team-access"
        : null;
    if (defaultPath) navigate(defaultPath, { replace: true });
  }, [context, navigate, path]);

  let content: React.ReactNode;
  if (auth.loading || contextRemote.isLoading) {
    content = (
      <div className="zj-state">
        <strong>正在确认智捷业务访问范围</strong>
        <p>请稍候。</p>
      </div>
    );
  } else if (!adminUserId || contextRemote.isError || !context) {
    content = (
      <div className="zj-state">
        <strong>无法读取智捷业务访问范围</strong>
        <p>
          {contextRemote.isError
            ? safeErrorMessage(contextRemote.error)
            : "请确认当前登录状态后重试。"}
        </p>
        <div className="zj-state-actions">
          <button
            className="zj-button"
            onClick={() => void contextRemote.reload()}
          >
            重新读取
          </button>
        </div>
      </div>
    );
  } else if (selection === "team-access") {
    content = (
      <TeamAccess
        context={context}
        adminUserId={adminUserId}
        reloadContext={contextRemote.reload}
      />
    );
  } else if (selection === "audit") {
    content = <Audit context={context} adminUserId={adminUserId} />;
  } else if (isZhijieModule(selection)) {
    content = context.readableModules.includes(selection) ? (
      <BusinessModule
        moduleId={selection}
        context={context}
        adminUserId={adminUserId}
      />
    ) : (
      <AccessDenied context={context} />
    );
  } else {
    content = <AccessDenied context={context} />;
  }

  return (
    <DashboardLayout>
      <main className="zj-page">
        <div className="zj-shell">
          <header className="zj-head">
            <div>
              <h1>智捷业务</h1>
              <p>
                {context?.companyName || "智捷业务"}
                {context?.scopeLabel ? ` · ${context.scopeLabel}` : ""}
              </p>
            </div>
            {context && (
              <div className="zj-head-actions">
                <span className="zj-chip zj-chip-blue">
                  {context.status === "ready"
                    ? "业务授权已确认"
                    : "等待业务授权"}
                </span>
                {context.status === "source_unavailable" && (
                  <span className="zj-chip">源组织暂不可用</span>
                )}
              </div>
            )}
          </header>
          {context && !contextRemote.isError ? (
            <div className="zj-layout">
              <Navigation
                context={context}
                active={selection}
                navigate={navigate}
              />
              <div className="zj-main">{content}</div>
            </div>
          ) : (
            content
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}
