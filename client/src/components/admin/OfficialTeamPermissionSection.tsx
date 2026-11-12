import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  OFFICIAL_INVENTORY_PERMISSIONS,
  errorMessage,
  normalizeOfficialPermissions,
  officialPermissionLabel,
  officialRequestId,
  readOfficialTeamsOverview,
  readOfficialTeamMemberMutation,
  type OfficialInventoryPermission,
  type OfficialTeamRole,
} from "@/lib/officialChannelInventoryUi";
import {
  sameStringSet,
  type StaffBusinessOrganization,
  type StaffBusinessTeamDraft,
  type StaffBusinessTeamSaveResult,
} from "@/lib/staffPermissionModel";
import { trpc } from "@/lib/trpc";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import "./OfficialTeamPermissionSection.css";

type GrantDraft = {
  teamId: number | null;
  role: OfficialTeamRole | null;
  revision: number;
  accountVersion: number;
  permissions: OfficialInventoryPermission[];
};
export type ChannelPermissionState = {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
};
export type OfficialTeamPermissionHandle = { save: () => Promise<void> };
export type StaffBusinessTeamEditor = {
  overview?: StaffBusinessOrganization;
  frontUserId: number | null;
  canEdit: boolean;
  reason?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry: () => void;
  onSave: (
    draft: StaffBusinessTeamDraft
  ) => Promise<StaffBusinessTeamSaveResult>;
};
function sameTeam(
  a: StaffBusinessTeamDraft | null,
  b: StaffBusinessTeamDraft | null
) {
  return a?.teamId === b?.teamId && a?.teamRole === b?.teamRole;
}
function sameGrant(a: GrantDraft | null, b: GrantDraft | null) {
  return (
    a?.teamId === b?.teamId &&
    a?.role === b?.role &&
    a?.revision === b?.revision &&
    a?.accountVersion === b?.accountVersion &&
    sameStringSet(a?.permissions ?? [], b?.permissions ?? [])
  );
}

/** ERP team assignments never enter officialTeams.setMember. The two services are not atomic. */
const OfficialTeamPermissionSection = forwardRef<
  OfficialTeamPermissionHandle,
  {
    adminUserId: number | null;
    hasRealAdminAccount: boolean;
    targetIsActive?: boolean;
    targetIsSuperAdmin: boolean;
    targetIsSelf?: boolean;
    targetHasProtectedPermissions?: boolean;
    overviewData: unknown;
    overviewLoading: boolean;
    overviewError: string | null;
    onRetryOverview: () => void;
    businessTeam?: StaffBusinessTeamEditor;
    onStateChange?: (state: ChannelPermissionState) => void;
  }
>(function OfficialTeamPermissionSection(
  {
    adminUserId,
    hasRealAdminAccount,
    targetIsActive = true,
    targetIsSuperAdmin,
    targetIsSelf = false,
    targetHasProtectedPermissions = false,
    overviewData,
    overviewLoading,
    overviewError,
    onRetryOverview,
    businessTeam,
    onStateChange,
  },
  ref
) {
  const overview = useMemo(
    () => readOfficialTeamsOverview(overviewData),
    [overviewData]
  );
  const target = overview.targets.find(
    item => item.adminUserId === adminUserId
  );
  const officialMember = overview.members.find(
    item => item.adminUserId === adminUserId
  );
  const incomingGrant = useMemo<GrantDraft | null>(
    () =>
      target
        ? {
            teamId: officialMember?.teamId ?? null,
            role: officialMember?.role ?? null,
            revision: officialMember?.revision ?? 0,
            accountVersion: target.accountVersion,
            permissions: target.officialPermissions,
          }
        : null,
    [target, officialMember]
  );
  const businessMember = businessTeam?.overview?.members.find(
    item => item.userId === businessTeam.frontUserId
  );
  const incomingTeam = useMemo<StaffBusinessTeamDraft | null>(
    () =>
      businessMember
        ? {
            teamId: businessMember.teamId,
            teamRole: businessMember.teamRole,
            revision: businessMember.revision,
          }
        : null,
    [businessMember]
  );
  const [grantBase, setGrantBase] = useState(incomingGrant);
  const [grantDraft, setGrantDraft] = useState(incomingGrant);
  const [teamBase, setTeamBase] = useState(incomingTeam);
  const [teamDraft, setTeamDraft] = useState(incomingTeam);
  const [grantConflict, setGrantConflict] = useState(false);
  const [teamConflict, setTeamConflict] = useState(false);
  const [teamNeedsRefresh, setTeamNeedsRefresh] = useState(false);
  const [grantNeedsRefresh, setGrantNeedsRefresh] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [feedback, setFeedback] = useState<string[]>([]);
  const identity = `${adminUserId ?? "none"}:${businessTeam?.frontUserId ?? "unlinked"}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setGrantBase(incomingGrant);
    setGrantDraft(incomingGrant);
    setTeamBase(incomingTeam);
    setTeamDraft(incomingTeam);
    setGrantConflict(false);
    setTeamConflict(false);
    setTeamNeedsRefresh(false);
    setGrantNeedsRefresh(false);
    setFeedback([]);
    savingRef.current = false;
    setSaving(false);
    // Identity changes explicitly discard, never transfer, another employee's draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    []
  );
  const grantDirty =
    !targetIsSuperAdmin &&
    !sameStringSet(grantBase?.permissions ?? [], grantDraft?.permissions ?? []);
  const teamDirty = !sameTeam(teamBase, teamDraft);
  useEffect(() => {
    if (savingRef.current || !incomingGrant) return;
    // A refetch started before a successful write cannot roll its receipt back.
    if (grantBase && incomingGrant.accountVersion < grantBase.accountVersion)
      return;
    if (grantDirty && !sameGrant(grantBase, incomingGrant))
      setGrantConflict(true);
    else if (!grantDirty) {
      setGrantBase(incomingGrant);
      setGrantDraft(incomingGrant);
      setGrantConflict(false);
      setGrantNeedsRefresh(false);
    }
  }, [incomingGrant, grantBase, grantDirty, saving]);
  useEffect(() => {
    if (savingRef.current || !incomingTeam) return;
    if (teamBase && incomingTeam.revision < teamBase.revision) return;
    if (
      teamDirty &&
      (!sameTeam(teamBase, incomingTeam) ||
        teamBase?.revision !== incomingTeam.revision)
    )
      setTeamConflict(true);
    else if (
      !teamDirty &&
      (!teamNeedsRefresh || sameTeam(teamBase, incomingTeam))
    ) {
      setTeamBase(incomingTeam);
      setTeamDraft(incomingTeam);
      setTeamConflict(false);
      setTeamNeedsRefresh(false);
    }
  }, [incomingTeam, teamBase, teamDirty, teamNeedsRefresh, saving]);
  const isSelf =
    targetIsSelf ||
    (overview.serverScope.available &&
      overview.serverScope.adminUserId === adminUserId) ||
    (businessTeam?.frontUserId != null &&
      businessTeam.overview?.actorUserId === businessTeam.frontUserId);
  const canGrant =
    overview.available &&
    overview.serverScope.isSuperAdmin &&
    hasRealAdminAccount &&
    targetIsActive &&
    adminUserId !== null &&
    Boolean(target) &&
    !targetIsSuperAdmin &&
    !isSelf &&
    !targetHasProtectedPermissions &&
    !overviewLoading &&
    !overviewError;
  const canTeam =
    hasRealAdminAccount &&
    targetIsActive &&
    !targetIsSuperAdmin &&
    !isSelf &&
    businessTeam?.canEdit === true &&
    Boolean(teamDraft) &&
    !businessTeam.loading &&
    !businessTeam.error;
  const conflicted =
    grantConflict || teamConflict || grantNeedsRefresh || teamNeedsRefresh;
  const canSave =
    !conflicted &&
    (!grantDirty || canGrant) &&
    (!teamDirty || canTeam) &&
    (grantDirty || teamDirty);
  useEffect(() => {
    onStateChange?.({ dirty: grantDirty || teamDirty, saving, canSave });
  }, [grantDirty, teamDirty, saving, canSave, onStateChange]);
  const setMember = trpc.officialTeams.setMember.useMutation();

  async function save() {
    if (savingRef.current || !canSave) return;
    const operationIdentity = identity;
    const operationGeneration = generation.current;
    const current = () =>
      identityRef.current === operationIdentity &&
      generation.current === operationGeneration;
    savingRef.current = true;
    setSaving(true);
    setFeedback([]);
    const messages: string[] = [];
    let failed = false;
    try {
      if (teamDirty && teamDraft && businessTeam) {
        try {
          const result = await businessTeam.onSave(teamDraft);
          if (!current()) return;
          const next = result.member
            ? {
                teamId: result.member.teamId,
                teamRole: result.member.teamRole,
                revision: result.member.revision,
              }
            : teamDraft;
          setTeamBase(next);
          setTeamDraft(next);
          setTeamNeedsRefresh(!result.member);
          messages.push(
            `业务团队已保存${result.warning ? `；${result.warning}` : ""}`
          );
        } catch (error) {
          if (!current()) return;
          failed = true;
          messages.push(
            `业务团队未保存：${errorMessage(error, "请刷新后重试")}`
          );
        }
      }
      // Native membership is preserved, including null. Never substitute the ERP team ID.
      if (grantDirty && grantBase && grantDraft && adminUserId !== null) {
        if (!current()) return;
        try {
          const raw = await setMember.mutateAsync({
            adminUserId,
            teamId: grantBase.teamId,
            role: grantBase.role,
            expectedRevision: grantBase.revision,
            expectedAccountVersion: grantBase.accountVersion,
            officialPermissions: grantDraft.permissions,
            requestId: officialRequestId("official_grants"),
          });
          if (!current()) return;
          const receipt = readOfficialTeamMemberMutation(raw);
          if (
            !receipt ||
            (receipt.member && receipt.member.adminUserId !== adminUserId)
          ) {
            setGrantNeedsRefresh(true);
            messages.push(
              "渠道库存权限请求已返回，但缺少可信版本回执；请刷新核验，草稿保留，勿重复提交。"
            );
          } else {
            const next: GrantDraft = {
              teamId: receipt.member?.teamId ?? null,
              role: receipt.member?.role ?? null,
              revision: receipt.revision,
              accountVersion: receipt.accountVersion,
              permissions: receipt.officialPermissions,
            };
            setGrantBase(next);
            setGrantDraft(next);
            setGrantConflict(false);
            messages.push(
              sameStringSet(grantBase.permissions, receipt.officialPermissions)
                ? "渠道库存权限已核验，与原授权一致。"
                : "渠道库存权限已保存。授权已改变，目标员工需重新登录。"
            );
          }
          onRetryOverview();
        } catch (error) {
          if (!current()) return;
          failed = true;
          messages.push(
            `渠道库存权限未保存：${errorMessage(error, "请刷新后重试")}`
          );
        }
      }
      if (current()) {
        setFeedback(messages);
        if (failed)
          toast.error("部分设置未保存", {
            description: messages.join("；"),
            duration: 8000,
          });
        else toast.info(messages.join("；"), { duration: 8000 });
      }
    } finally {
      if (current()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }
  useImperativeHandle(ref, () => ({ save }));
  const reason = !hasRealAdminAccount
    ? "当前员工没有可核验的后台账号，权限设置不可用。"
    : isSelf
      ? "不能修改自己的渠道授权或团队身份。"
      : !targetIsActive
        ? "目标后台账号已停用或锁定，授权设置保持只读；未保存草稿不会自动写入。"
        : overviewLoading
          ? "正在读取渠道库存授权…"
          : overviewError
            ? `渠道库存授权读取失败：${overviewError}`
            : !overview.available || !overview.serverScope.isSuperAdmin
              ? "只有服务器核验的真实后台超级管理员可配置渠道库存授权。"
              : !target
                ? "概览未返回该账号的可信授权与账号版本，请刷新核验；不会把未分组视为没有权限。"
                : null;
  const selectedTeam = businessTeam?.overview?.teams.find(
    team => team.id === teamDraft?.teamId
  );
  const teams =
    businessTeam?.overview?.teams.filter(
      team => team.status === "active" || team.id === teamDraft?.teamId
    ) ?? [];
  function reloadDraft() {
    if (!window.confirm("放弃渠道库存页未保存的草稿，并重新读取？")) return;
    setGrantBase(incomingGrant);
    setGrantDraft(incomingGrant);
    setGrantConflict(false);
    setGrantNeedsRefresh(false);
    setTeamBase(incomingTeam);
    setTeamDraft(incomingTeam);
    setTeamConflict(false);
    setTeamNeedsRefresh(false);
    onRetryOverview();
    businessTeam?.onRetry();
  }
  const renderGrant = (permission: OfficialInventoryPermission) => (
    <label key={permission} className="official-team-settings__permission">
      <Checkbox
        checked={grantDraft?.permissions.includes(permission) ?? false}
        disabled={!canGrant || saving || grantConflict || grantNeedsRefresh}
        aria-label={officialPermissionLabel(permission)}
        onCheckedChange={() => {
          if (
            !canGrant ||
            savingRef.current ||
            grantConflict ||
            grantNeedsRefresh
          )
            return;
          setGrantDraft(old => {
            if (!old) return old;
            const permissions = old.permissions.includes(permission)
              ? old.permissions.filter(item => item !== permission)
              : [...old.permissions, permission];
            return {
              ...old,
              permissions: normalizeOfficialPermissions(permissions),
            };
          });
        }}
      />
      <span>{officialPermissionLabel(permission)}</span>
    </label>
  );
  return (
    <section
      className="official-team-settings space-y-3 rounded-md border p-3"
      aria-labelledby="staff-official-team-title"
      data-staff-sheet-section="official-team"
    >
      <h3 id="staff-official-team-title" className="text-sm font-medium">
        渠道库存
      </h3>
      <p className="text-xs text-muted-foreground">
        使用现有业务团队和队员/组长身份，不另建渠道角色。团队身份与操作授权分开保存，组长身份不代表全平台数据权限。
      </p>
      <div className="official-team-settings__assignment">
        <div className="official-team-settings__assignment-fields">
          <label>
            <span>渠道库存团队（业务团队）</span>
            <select
              aria-label="渠道库存团队（业务团队）"
              value={teamDraft?.teamId ?? ""}
              disabled={!canTeam || saving || teamConflict || teamNeedsRefresh}
              onChange={event => {
                const teamId = event.target.value
                  ? Number(event.target.value)
                  : null;
                setTeamDraft(old =>
                  old
                    ? {
                        ...old,
                        teamId,
                        teamRole: teamId ? (old.teamRole ?? "member") : null,
                      }
                    : old
                );
              }}
            >
              <option value="">
                {businessMember ? "未分组" : "成员关联未就绪"}
              </option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                  {team.status === "active" ? "" : "（已归档）"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>业务团队身份</span>
            <select
              aria-label="业务团队身份"
              value={teamDraft?.teamRole ?? ""}
              disabled={
                !canTeam ||
                saving ||
                !teamDraft?.teamId ||
                teamConflict ||
                teamNeedsRefresh
              }
              onChange={event =>
                setTeamDraft(old =>
                  old
                    ? {
                        ...old,
                        teamRole:
                          event.target.value === "leader" ? "leader" : "member",
                      }
                    : old
                )
              }
            >
              <option value="">未分组</option>
              <option value="member">队员</option>
              <option value="leader">组长</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          当前业务团队：
          {businessMember
            ? (selectedTeam?.name ??
              (teamDraft?.teamId ? "团队不可见" : "未分组"))
            : "关联未核验"}
          。团队身份不自动授予查看或写入权限。
        </p>
        {!canTeam && (
          <p className="official-team-settings__notice" role="status">
            {businessTeam?.loading
              ? "正在读取业务团队…"
              : businessTeam?.error ||
                businessTeam?.reason ||
                "尚未完成真实业务成员关联，请使用员工资料页的现有邀请／关联流程。"}
          </p>
        )}
        {businessTeam?.error && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={businessTeam.onRetry}
          >
            重试业务团队
          </Button>
        )}
      </div>
      <details className="official-team-settings__advanced">
        <summary>业务模块真实范围（只读）</summary>
        <p className="text-xs text-muted-foreground">
          本人/本组/企业范围沿用现有组织模块配置；这里只展示服务返回值，不按岗位标签或
          ERP 范围推导渠道权限。
        </p>
        {businessMember?.moduleAccess?.length ? (
          <dl className="official-team-settings__scope-list">
            {businessMember.moduleAccess.map(access => (
              <div key={access.module}>
                <dt>
                  {
                    {
                      customers: "客户",
                      demands: "需求",
                      channels: "渠道",
                      stocks: "库存",
                    }[access.module]
                  }
                </dt>
                <dd>
                  {!access.read
                    ? "无查看权限"
                    : `${{ self: "本人", team: "本组", enterprise: "全企业" }[access.scope]} · ${access.write ? "可维护" : "只读"}`}
                  {access.explicit ? "（显式配置）" : "（服务默认）"}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            服务未返回模块范围；不会把缺失信息视为全量授权。
          </p>
        )}
      </details>
      {targetHasProtectedPermissions && !targetIsSuperAdmin && (
        <p className="official-team-settings__notice" role="status">
          账号已有当前接口不可安全保留的受保护授权，渠道操作只读以防整包更新误删；业务团队仍按独立服务
          guard 管理。
        </p>
      )}
      {reason && (
        <div
          className="official-team-settings__notice"
          role={overviewError ? "alert" : "status"}
        >
          <span>{reason}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving || overviewLoading}
            onClick={onRetryOverview}
          >
            刷新授权
          </Button>
        </div>
      )}
      {targetIsSuperAdmin ? (
        <p className="official-team-settings__system-grant">
          该员工是超级管理员，渠道库存权限由系统固定授予，不能在此修改。
        </p>
      ) : (
        <>
          <div
            className="official-team-settings__permissions"
            aria-label="渠道库存日常操作"
          >
            {OFFICIAL_INVENTORY_PERMISSIONS.filter(
              permission => permission !== "officialInventory.note"
            ).map(renderGrant)}
          </div>
          <details className="official-team-settings__advanced">
            <summary>
              内部备注（已选{" "}
              {grantDraft?.permissions.includes("officialInventory.note")
                ? 1
                : 0}{" "}
              项）
            </summary>
            <div
              className="official-team-settings__permissions"
              aria-label="渠道库存原生权限"
            >
              {renderGrant("officialInventory.note")}
            </div>
          </details>
          <div
            className="official-team-settings__export"
            aria-label="导出与来源权限说明"
          >
            <span>导出与敏感来源</span>
            <p>
              当前没有独立的导出或来源开关，沿用现有权限及数据范围。库存管理权限在其他授权条件满足时可允许渠道导出；查看可读取已授权渠道档案和来源，关联客户资料另受客户权限控制。
            </p>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        查看本身不授予录入、编辑、发布或他人的私人备注，也不扩大渠道归属范围。业务团队与原生授权由两个服务分别保存，不保证跨服务原子成功。
      </p>
      {(grantDirty || teamDirty) && (
        <p className="text-xs text-muted-foreground" role="status">
          本页待保存：
          {[teamDirty ? "业务团队" : "", grantDirty ? "渠道库存权限" : ""]
            .filter(Boolean)
            .join("、")}
        </p>
      )}
      {conflicted && (
        <div className="official-team-settings__save-error" role="alert">
          {grantNeedsRefresh || teamNeedsRefresh
            ? "保存后的版本尚未核验，请重新读取。"
            : "服务端版本已变化；未保存草稿已保留，请核对后放弃草稿并重新读取，不能直接覆盖。"}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={reloadDraft}
          >
            放弃本页草稿并重新读取
          </Button>
        </div>
      )}
      {feedback.map((message, index) => (
        <p key={index} className="text-xs" role="status">
          {message}
        </p>
      ))}
    </section>
  );
});
export default OfficialTeamPermissionSection;
