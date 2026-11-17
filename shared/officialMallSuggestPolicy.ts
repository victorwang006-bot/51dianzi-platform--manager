import type { OfficialMallAccess } from "./officialMall";

export const OFFICIAL_MALL_SUGGEST_MIN_CHARS = 3;
export const OFFICIAL_MALL_SUGGEST_DEBOUNCE_MS = 500;
export const OFFICIAL_MALL_SUGGEST_RAW_LIMIT = 80;
export const OFFICIAL_MALL_SUGGEST_RESULT_LIMIT = 20;

/** Literal prefix only; never interpret user '%'/'_' as wildcards. */
export function officialMallPrefixPattern(value: string): string {
  return `${value.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

/** Browser convenience only. Server chooses/locks the current active team again. */
export function officialMallCreateTeam(access: OfficialMallAccess | undefined, selected?: number) {
  if (!access?.available) return { teamId: undefined, problem: "请先核验官方商城权限" };
  if (!access.scope.isSuperAdmin) return access.scope.teamId
    ? { teamId: undefined, problem: null }
    : { teamId: undefined, problem: "当前后台账号未配置有效官方团队，请联系超级管理员配置" };
  const teams = access.teams ?? [];
  if (!teams.length) return { teamId: undefined, problem: "没有有效官方团队，请先由超级管理员配置官方团队" };
  if (teams.length === 1) return { teamId: teams[0].id, problem: null };
  if (selected && teams.some(team => team.id === selected)) return { teamId: selected, problem: null };
  return { teamId: undefined, problem: "存在多个官方团队，请明确选择归属官方团队" };
}
