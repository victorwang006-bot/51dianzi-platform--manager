import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import React, { useRef, useState } from "react";
import { toast } from "sonner";
export type CreateStaffTeam = {
  domain: "operations" | "official";
  id: number;
  name: string;
};
const initialForm = {
  username: "",
  displayName: "",
  phone: "",
  password: "",
  adminRole: "merchant_mgr" as "merchant_mgr" | "super_admin",
};

export function staffCreateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "请稍后重试";
  try {
    const issues: unknown = JSON.parse(raw);
    if (Array.isArray(issues)) {
      const issue = issues.find(item => typeof item?.message === "string");
      if (issue) return issue.message;
    }
  } catch {
    /* Plain service errors are already readable. */
  }
  return raw.slice(0, 180);
}

export default function CreateStaffDialog({
  open,
  onOpenChange,
  canManageAdmin,
  teams,
  teamNotice,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManageAdmin: boolean;
  teams: readonly CreateStaffTeam[];
  teamNotice?: string | null;
  onChanged: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(initialForm);
  const [teamKey, setTeamKey] = useState("");
  const [createdId, setCreatedId] = useState<number | null>(null);
  const createdIdRef = useRef<number | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable per assignment: a lost response can safely replay the same request.
  const assignment = useRef<{
    key: string;
    requestId: string;
    team: CreateStaffTeam;
  } | null>(null);
  const create = trpc.adminUser.create.useMutation();
  const operationsMember = trpc.staffOrganization.setMember.useMutation();
  const officialMember = trpc.officialTeams.setMember.useMutation();

  function reset() {
    setForm(initialForm);
    setTeamKey("");
    setCreatedId(null);
    createdIdRef.current = null;
    assignment.current = null;
    setError(null);
  }
  function close() {
    if (busy.current) return;
    // A partial success survives closing/reopening: never recreate that account.
    if (createdIdRef.current === null) reset();
    onOpenChange(false);
  }
  async function refresh() {
    // Cache refresh failure must never turn a successful create into another create.
    try {
      await onChanged();
    } catch {
      /* The page retains its query retry controls. */
    }
  }
  async function submit() {
    if (!canManageAdmin || busy.current) return;
    const selectedTeam = assignment.current?.team ?? teams.find(
      team => `${team.domain}:${team.id}` === teamKey
    );
    if (teamKey && !selectedTeam) {
      setError("团队已不可用，请重新选择");
      return;
    }
    if (createdIdRef.current === null) {
      if (form.username.trim().length < 2) {
        setError("账号至少 2 位");
        return;
      }
      if (form.password.length < 8) {
        setError("初始密码至少 8 位");
        return;
      }
      if (
        form.adminRole === "super_admin" &&
        !window.confirm("超级管理员拥有全部后台权限。确认授予？")
      )
        return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      let id = createdIdRef.current;
      if (id === null) {
        const created = await create.mutateAsync({
          username: form.username.trim(),
          displayName: form.displayName.trim() || null,
          phone: form.phone.trim() || null,
          password: form.password,
          adminRole: form.adminRole,
          // Server requires a business-module key. Explicit minimal native read
          // avoids role defaults; never grant business.*, ERP or official keys.
          permissions: ["materials.read"],
          salesStaffCodes: [],
        });
        id = created.id;
        createdIdRef.current = id;
        setCreatedId(id);
        setForm(current => ({ ...current, password: "" }));
        await refresh();
      }
      if (selectedTeam) {
        if (!assignment.current) {
          assignment.current = {
            key: teamKey,
            requestId: `staff_join_${crypto.randomUUID().replaceAll("-", "")}`,
            team: { ...selectedTeam },
          };
        }
        const payload = {
          adminUserId: id,
          teamId: selectedTeam.id,
          role: "member" as const,
          expectedRevision: 0,
          requestId: assignment.current.requestId,
        };
        if (selectedTeam.domain === "operations")
          await operationsMember.mutateAsync(payload);
        else await officialMember.mutateAsync(payload);
      }
      await refresh();
      reset();
      onOpenChange(false);
      toast.success("员工已创建");
    } catch (cause) {
      const message = staffCreateError(cause);
      setError(
        createdIdRef.current !== null
          ? `员工已创建，分组失败，请重试。${message}`
          : message
      );
      await refresh();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value) close();
      }}
    >
      <DialogContent
        className="max-w-[480px]"
        onPointerDownOutside={event => {
          if (saving) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>新增员工</DialogTitle>
          <DialogDescription>
            创建后台账号；业务身份与 ERP 权限需另行关联配置。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset
            className="space-y-3"
            disabled={!canManageAdmin || saving || createdId !== null}
          >
            <div className="space-y-1.5">
              <Label htmlFor="staff-create-username">账号</Label>
              <Input
                id="staff-create-username"
                required
                minLength={2}
                maxLength={64}
                autoComplete="off"
                value={form.username}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-create-name">姓名</Label>
              <Input
                id="staff-create-name"
                maxLength={128}
                value={form.displayName}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-create-phone">手机号</Label>
              <Input
                id="staff-create-phone"
                type="tel"
                maxLength={20}
                value={form.phone}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-create-password">初始密码</Label>
              <Input
                id="staff-create-password"
                type="password"
                autoComplete="new-password"
                required={createdId === null}
                minLength={8}
                maxLength={128}
                value={form.password}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-create-role">后台角色</Label>
              <select
                id="staff-create-role"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.adminRole}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    adminRole: event.target.value as typeof current.adminRole,
                  }))
                }
              >
                <option value="merchant_mgr">普通用户</option>
                <option value="super_admin">超级管理员</option>
              </select>
            </div>
            {form.adminRole === "merchant_mgr" ? (
              <p className="text-xs text-muted-foreground">
                默认仅物料查看、本人销售范围；不授予 ERP 权限。
              </p>
            ) : (
              <p className="text-xs text-destructive">
                超级管理员拥有全部后台权限。
              </p>
            )}
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="staff-create-team">所属团队（队员）</Label>
            <select
              id="staff-create-team"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={!canManageAdmin || saving || (createdId !== null && assignment.current !== null)}
              value={teamKey}
              onChange={event => {
                if (createdIdRef.current !== null && assignment.current) return;
                setTeamKey(event.target.value);
                assignment.current = null;
              }}
            >
              <option value="">暂不分组</option>
              {teams.map(team => (
                <option
                  key={`${team.domain}:${team.id}`}
                  value={`${team.domain}:${team.id}`}
                >
                  {team.domain === "operations" ? "运营" : "官方渠道"} ·{" "}
                  {team.name}
                </option>
              ))}
            </select>
            {teamNotice ? (
              <p className="text-xs text-muted-foreground">{teamNotice}</p>
            ) : null}
          </div>
          {createdId !== null ? (
            <p className="text-sm" role="status">
              员工 ID {createdId} 已创建；重试仅保存分组。
              {assignment.current ? "分组结果尚未确认，已锁定原团队；请重试确认后再调整。" : ""}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={close}
            >
              {createdId !== null ? "稍后分组" : "取消"}
            </Button>
            <Button type="submit" disabled={!canManageAdmin || saving}>
              {saving
                ? "保存中…"
                : createdId !== null
                  ? teamKey
                    ? "重试分组"
                    : "完成"
                  : "创建员工"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
