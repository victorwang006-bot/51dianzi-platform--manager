import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  StaffBusinessOrganization,
  StaffBusinessTeamMember,
} from "@/lib/staffPermissionModel";

export type BusinessAccessModule = "customers" | "demands" | "channels" | "stocks";
export type BusinessAccessScope = "self" | "team" | "enterprise";
export type BusinessAccessRow = {
  module: BusinessAccessModule;
  read: boolean;
  write: boolean;
  scope: BusinessAccessScope;
  expectedRevision: number;
};
export type BusinessAccessSaveInput = { userId: number; modules: BusinessAccessRow[] };

const ROWS: { module: BusinessAccessModule; label: string }[] = [
  { module: "customers", label: "客户列表（含跟进记录）" },
  { module: "demands", label: "客户需求" },
  { module: "stocks", label: "库存列表" },
];
const ALL: BusinessAccessModule[] = ["customers", "demands", "channels", "stocks"];
const SCOPE_LABEL: Record<BusinessAccessScope, string> = {
  self: "本人",
  team: "本团队",
  enterprise: "全公司",
};

export function scopeOptionsFor(
  module: BusinessAccessModule,
  member: Pick<StaffBusinessTeamMember, "teamRole" | "teamId">
): BusinessAccessScope[] {
  if (module === "stocks")
    return member.teamId !== null ? ["self", "team"] : ["self"];
  const options: BusinessAccessScope[] = ["self"];
  if (member.teamRole === "leader") options.push("team");
  options.push("enterprise");
  return options;
}

export function buildAccessDraft(member: StaffBusinessTeamMember): BusinessAccessRow[] | null {
  const access = member.moduleAccess;
  if (!access) return null;
  const rows = ALL.map(module => access.find(item => item.module === module));
  if (rows.some(row => !row)) return null;
  return rows.map(row => ({
    module: row!.module,
    read: row!.read,
    write: row!.write,
    scope: row!.module === "channels" ? "self" : row!.scope,
    expectedRevision: row!.revision,
  }));
}

export default function BusinessModuleAccessTable({
  organization,
  frontUserId,
  canEdit,
  onSave,
}: {
  organization?: StaffBusinessOrganization;
  frontUserId: number | null;
  canEdit: boolean;
  onSave: (input: BusinessAccessSaveInput) => Promise<void>;
}) {
  const member = useMemo(
    () => organization?.members.find(item => item.userId === frontUserId) ?? null,
    [organization, frontUserId]
  );
  const base = useMemo(() => (member ? buildAccessDraft(member) : null), [member]);
  const [draft, setDraft] = useState<BusinessAccessRow[] | null>(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(base);
    setError(null);
  }, [base]);
  if (!member || !base || !draft) return null;
  const disabled = !canEdit || busy;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const patch = (module: BusinessAccessModule, change: Partial<BusinessAccessRow>) =>
    setDraft(current =>
      (current ?? []).map(row => {
        if (row.module !== module) return row;
        const next = { ...row, ...change };
        if (!next.read) next.write = false;
        if (next.write) next.read = true;
        return next;
      })
    );
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ userId: member.userId, modules: draft });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-2 rounded-md border p-3"
      data-staff-sheet-section="business-access"
      aria-label="业务数据权限"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-normal">模块</th>
            <th className="w-12 font-normal">查看</th>
            <th className="w-12 font-normal">编辑</th>
            <th className="w-28 font-normal">数据范围</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(({ module, label }) => {
            const row = draft.find(item => item.module === module)!;
            return (
              <tr key={module} className="border-t">
                <td className="py-1.5">{label}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${label}查看`}
                    checked={row.read}
                    disabled={disabled}
                    onChange={e => patch(module, { read: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${label}编辑`}
                    checked={row.write}
                    disabled={disabled}
                    onChange={e => patch(module, { write: e.target.checked })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`${label}数据范围`}
                    className="h-7 rounded border bg-background px-1 text-sm"
                    value={row.scope}
                    disabled={disabled}
                    onChange={e =>
                      patch(module, { scope: e.target.value as BusinessAccessScope })
                    }
                  >
                    {[...new Set([...scopeOptionsFor(module, member), row.scope])].map(scope => (
                      <option key={scope} value={scope}>
                        {SCOPE_LABEL[scope]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" disabled={disabled || !dirty} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </section>
  );
}
