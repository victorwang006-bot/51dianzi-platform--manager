import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  OFFICIAL_INVENTORY_PERMISSIONS,
  errorMessage,
  normalizeOfficialPermissions,
  officialPermissionLabel,
  officialRequestId,
  officialTeamRoleLabel,
  readOfficialTeamsOverview,
  type OfficialInventoryPermission,
  type OfficialTeam,
  type OfficialTeamMember,
  type OfficialTeamRole,
} from "@/lib/officialChannelInventoryUi";
import { trpc } from "@/lib/trpc";
import { Pencil, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import "./OfficialTeamPermissionSection.css";

type TeamDialogState =
  | { mode: "create" }
  | { mode: "edit"; team: OfficialTeam }
  | null;

type TeamDraft = {
  teamId: number | null;
  role: OfficialTeamRole | null;
  permissions: OfficialInventoryPermission[];
  revision: number;
};

function samePermissions(
  left: readonly OfficialInventoryPermission[],
  right: readonly OfficialInventoryPermission[]
) {
  return (
    left.length === right.length &&
    left.every((permission, index) => permission === right[index])
  );
}

function teamDraftFrom(member: OfficialTeamMember | undefined): TeamDraft {
  return {
    teamId: member?.teamId ?? null,
    role: member?.role ?? null,
    permissions: member?.officialPermissions ?? [],
    revision: member?.revision ?? 0,
  };
}

export default function OfficialTeamPermissionSection({
  adminUserId,
  hasRealAdminAccount,
  targetIsSuperAdmin,
  overviewData,
  overviewLoading,
  overviewError,
  onRetryOverview,
}: {
  /** The native admin_users.id from Staff row.admin.id, never a portal/front-user id. */
  adminUserId: number | null;
  hasRealAdminAccount: boolean;
  /** Explicit grants cannot be written for super_admin; its native role owns them. */
  targetIsSuperAdmin: boolean;
  /** Raw tRPC result is decoded fail-closed by the native UI helper. */
  overviewData: unknown;
  overviewLoading: boolean;
  overviewError: string | null;
  onRetryOverview: () => void;
}) {
  const overview = useMemo(
    () => readOfficialTeamsOverview(overviewData),
    [overviewData]
  );
  const member = useMemo(
    () =>
      adminUserId === null
        ? undefined
        : overview.members.find(item => item.adminUserId === adminUserId),
    [adminUserId, overview.members]
  );
  const [baseline, setBaseline] = useState<TeamDraft>(() =>
    teamDraftFrom(member)
  );
  const [draft, setDraft] = useState<TeamDraft>(() => teamDraftFrom(member));
  const [teamDialog, setTeamDialog] = useState<TeamDialogState>(null);
  const [teamName, setTeamName] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const next = teamDraftFrom(member);
    setBaseline(next);
    setDraft(next);
    setSaveError(null);
  }, [member?.adminUserId, member?.revision, overviewData]);

  const setMember = trpc.officialTeams.setMember.useMutation();
  const createTeam = trpc.officialTeams.create.useMutation();
  const updateTeam = trpc.officialTeams.update.useMutation();
  const archiveTeam = trpc.officialTeams.archive.useMutation();

  const canConfigure =
    overview.available &&
    overview.serverScope.isSuperAdmin === true &&
    hasRealAdminAccount &&
    adminUserId !== null;
  const activeTeams = useMemo(
    () => overview.teams.filter(team => team.status === "active"),
    [overview.teams]
  );
  const assignmentTeams = useMemo(() => {
    if (!draft.teamId || activeTeams.some(team => team.id === draft.teamId))
      return activeTeams;
    const current = overview.teams.find(team => team.id === draft.teamId);
    return current ? [...activeTeams, current] : activeTeams;
  }, [activeTeams, draft.teamId, overview.teams]);
  const membershipChanged =
    baseline.teamId !== draft.teamId || baseline.role !== draft.role;
  const permissionsChanged = !samePermissions(
    baseline.permissions,
    draft.permissions
  );
  const hasChanges =
    membershipChanged || (!targetIsSuperAdmin && permissionsChanged);
  const canEditOfficialPermissions = canConfigure && !targetIsSuperAdmin;

  const updatePermission = (permission: OfficialInventoryPermission) => {
    if (!canEditOfficialPermissions || savingTeam) return;
    setDraft(current => {
      const set = new Set(current.permissions);
      if (set.has(permission)) set.delete(permission);
      else set.add(permission);
      return {
        ...current,
        permissions: normalizeOfficialPermissions(Array.from(set)),
      };
    });
  };

  const saveMembership = async () => {
    if (!canConfigure || adminUserId === null || savingTeam || !hasChanges)
      return;
    if (draft.teamId !== null && draft.role === null) {
      setSaveError("请选择队员或组长后再保存团队。");
      return;
    }
    setSavingTeam(true);
    setSaveError(null);
    try {
      await setMember.mutateAsync({
        adminUserId,
        teamId: draft.teamId,
        role: draft.teamId ? draft.role : null,
        expectedRevision: baseline.revision,
        requestId: officialRequestId("official_team_member"),
        ...(targetIsSuperAdmin
          ? {}
          : { officialPermissions: draft.permissions }),
      });
      setBaseline(draft);
      toast.success("团队与官方渠道库存权限已保存");
      onRetryOverview();
    } catch (error) {
      const message = errorMessage(
        error,
        "团队与官方权限保存失败，请刷新后重试。"
      );
      setSaveError(message);
      toast.error("团队与官方权限未保存", { description: message });
    } finally {
      setSavingTeam(false);
    }
  };

  const openTeamDialog = (state: TeamDialogState) => {
    setTeamDialog(state);
    setTeamName(state?.mode === "edit" ? state.team.name : "");
  };

  const saveTeamDefinition = async () => {
    if (!canConfigure || !teamDialog || savingTeam) return;
    const name = teamName.trim();
    if (!name) {
      toast.error("请输入团队名称");
      return;
    }
    setSavingTeam(true);
    try {
      if (teamDialog.mode === "create") {
        await createTeam.mutateAsync({
          name,
          requestId: officialRequestId("official_team_create"),
        });
        toast.success("官方团队已创建");
      } else {
        await updateTeam.mutateAsync({
          id: teamDialog.team.id,
          name,
          expectedRevision: teamDialog.team.revision,
          requestId: officialRequestId("official_team_update"),
        });
        toast.success("官方团队名称已更新");
      }
      setTeamDialog(null);
      onRetryOverview();
    } catch (error) {
      toast.error("团队保存失败", {
        description: errorMessage(error, "请刷新后重试。"),
      });
    } finally {
      setSavingTeam(false);
    }
  };

  const archive = async (team: OfficialTeam) => {
    if (!canConfigure || savingTeam) return;
    if (overview.members.some(item => item.teamId === team.id)) {
      toast.error("请先移出团队成员");
      return;
    }
    if (!window.confirm(`删除团队“${team.name}”？员工和历史资料保留。`)) return;
    setSavingTeam(true);
    try {
      await archiveTeam.mutateAsync({
        id: team.id,
        expectedRevision: team.revision,
        requestId: officialRequestId("official_team_archive"),
      });
      toast.success("团队已删除");
      onRetryOverview();
    } catch (error) {
      toast.error("删除失败", {
        description: errorMessage(error, "请刷新后重试。"),
      });
    } finally {
      setSavingTeam(false);
    }
  };

  const readonlyReason =
    !hasRealAdminAccount || adminUserId === null
      ? "当前员工没有可核验的后台账号，官方团队设置不可用。"
      : overviewLoading
        ? "正在读取官方团队范围…"
        : overviewError
          ? `官方团队读取失败：${overviewError}`
          : !overview.available
            ? "官方团队未返回可核验的服务器范围，设置保持只读。"
            : !overview.serverScope.isSuperAdmin
              ? "只有真实后台超级管理员可以修改官方团队与渠道库存权限。"
              : null;

  return (
    <section
      className="official-team-settings space-y-3 rounded-md border p-3"
      aria-labelledby="staff-official-team-title"
      data-staff-sheet-section="official-team"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="staff-official-team-title" className="text-sm font-medium">
            官方团队与渠道库存
          </h3>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!canConfigure || savingTeam}
          onClick={() => openTeamDialog({ mode: "create" })}
        >
          <Settings2 className="mr-1 h-3.5 w-3.5" />
          管理团队
        </Button>
      </div>

      {readonlyReason ? (
        <div
          className={`official-team-settings__notice ${overviewError ? "is-error" : ""}`}
          role={overviewError ? "alert" : "status"}
        >
          <span>{readonlyReason}</span>
          {overviewError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={overviewLoading}
              onClick={onRetryOverview}
            >
              <RefreshCw
                className={`mr-1 h-3.5 w-3.5 ${overviewLoading ? "animate-spin" : ""}`}
              />
              重试
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="official-team-settings__assignment">
        <div className="official-team-settings__assignment-fields">
          <label>
            <span>所属官方团队</span>
            <select
              value={draft.teamId ?? ""}
              disabled={!canConfigure || savingTeam}
              onChange={event => {
                const teamId = Number(event.target.value) || null;
                setDraft(current => ({
                  ...current,
                  teamId,
                  role: teamId ? (current.role ?? "member") : null,
                }));
              }}
            >
              <option value="">未分组</option>
              {assignmentTeams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.status === "archived"
                    ? `${team.name}（已归档）`
                    : team.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>团队身份</span>
            <select
              value={draft.role ?? ""}
              disabled={!canConfigure || savingTeam || draft.teamId === null}
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  role:
                    event.target.value === "leader" ||
                    event.target.value === "member"
                      ? event.target.value
                      : null,
                }))
              }
            >
              <option value="">请选择</option>
              <option value="member">队员</option>
              <option value="leader">组长</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          当前身份：
          {member?.teamName
            ? `${member.teamName} · ${officialTeamRoleLabel(member.role)}`
            : "未分组"}
        </p>
      </div>

      {targetIsSuperAdmin ? (
        <p className="official-team-settings__system-grant">
          该员工是超级管理员，官方渠道库存权限由系统固定授予，不能在此修改。
        </p>
      ) : (
        <div
          className="official-team-settings__permissions"
          aria-label="官方渠道库存权限"
        >
          {OFFICIAL_INVENTORY_PERMISSIONS.map(permission => (
            <label
              key={permission}
              className="official-team-settings__permission"
            >
              <Checkbox
                checked={draft.permissions.includes(permission)}
                disabled={!canEditOfficialPermissions || savingTeam}
                onCheckedChange={() => updatePermission(permission)}
                aria-label={officialPermissionLabel(permission)}
              />
              <span>{officialPermissionLabel(permission)}</span>
            </label>
          ))}
        </div>
      )}

      {saveError ? (
        <p className="official-team-settings__save-error" role="alert">
          {saveError}
        </p>
      ) : null}
      <div className="flex justify-end border-t pt-2">
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 text-xs"
          disabled={!canConfigure || savingTeam || !hasChanges}
          onClick={() => void saveMembership()}
        >
          {savingTeam && setMember.isPending ? "保存团队中…" : "保存团队"}
        </Button>
      </div>

      <Dialog
        open={teamDialog !== null}
        onOpenChange={open => {
          if (!open && !savingTeam) setTeamDialog(null);
        }}
      >
        <DialogContent
          className="max-w-[520px]"
          onPointerDownOutside={event => {
            if (savingTeam) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {teamDialog?.mode === "edit" ? "编辑团队" : "团队管理"}
            </DialogTitle>
            <DialogDescription>不影响员工账号和历史库存。</DialogDescription>
          </DialogHeader>
          <Input
            value={teamName}
            maxLength={128}
            disabled={savingTeam}
            placeholder="团队名称"
            aria-label="官方团队名称"
            onChange={event => setTeamName(event.target.value)}
          />
          {activeTeams.length > 0 ? (
            <div className="border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">现有团队</p>
              <div className="space-y-1.5">
                {overview.teams
                  .filter(team => team.status === "active")
                  .map(team => (
                    <div
                      key={team.id}
                      className="flex min-h-8 items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate">{team.name}</span>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={savingTeam}
                          onClick={() => openTeamDialog({ mode: "edit", team })}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          改名
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={savingTeam}
                          onClick={() => void archive(team)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={savingTeam}
              onClick={() => setTeamDialog(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={savingTeam}
              onClick={() => void saveTeamDefinition()}
            >
              {savingTeam
                ? "保存中…"
                : teamDialog?.mode === "edit"
                  ? "保存"
                  : "创建团队"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
