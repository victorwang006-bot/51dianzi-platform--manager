import type { InboundBulkDraftRow, InboundBulkRow } from "../../../../shared/inboundBulk";

export type ProcurementBuyerOption = { userId: number; name: string; username?: string | null };
export type ProcurementBuyerScope = {
  actorUserId: number;
  canChooseBuyer: boolean;
  teamId: number | null;
  scope: "self" | "team" | "enterprise";
  options: ProcurementBuyerOption[];
};
export type ProcurementBuyerDraftRow = Omit<InboundBulkDraftRow, "buyerUserId"> & {
  buyerUserId: string;
  buyerImportError?: string;
};
export type ProcurementBuyerInboundRow = Omit<InboundBulkRow, "buyerUserId"> & { buyerUserId: number };

/** The API owns team/leader rules. An admin ID or local role never grants a choice. */
export function readProcurementBuyerScope(value: unknown, frontUserId: number): ProcurementBuyerScope | null {
  if (!value || typeof value !== "object") return null;
  const scope = value as ProcurementBuyerScope;
  if (scope.actorUserId !== frontUserId || !Number.isSafeInteger(frontUserId) || frontUserId <= 0 ||
    typeof scope.canChooseBuyer !== "boolean" || !["self", "team", "enterprise"].includes(scope.scope) ||
    !(scope.teamId === null || (Number.isSafeInteger(scope.teamId) && scope.teamId > 0)) || !Array.isArray(scope.options)) return null;
  const ids = new Set<number>();
  for (const option of scope.options) {
    if (!option || !Number.isSafeInteger(option.userId) || option.userId <= 0 || ids.has(option.userId) ||
      !(option.username == null || typeof option.username === "string") ||
      typeof option.name !== "string" || (!option.name.trim() && !option.username?.trim())) return null;
    ids.add(option.userId);
  }
  if (!scope.canChooseBuyer && !ids.has(frontUserId)) return null;
  return { ...scope, options: scope.options.map(option => ({ ...option, name: option.name.trim() || option.username!.trim() })) };
}

export function selectedProcurementBuyer(scope: ProcurementBuyerScope | null, userId: string | number | null | undefined): ProcurementBuyerOption | null {
  if (!scope || userId == null || !/^\d+$/.test(String(userId))) return null;
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0 || (!scope.canChooseBuyer && id !== scope.actorUserId)) return null;
  return scope.options.find(option => option.userId === id) ?? null;
}

export function defaultProcurementBuyer(scope: ProcurementBuyerScope | null): ProcurementBuyerOption | null {
  return scope ? selectedProcurementBuyer(scope, scope.actorUserId) : null;
}

export function procurementBuyerOptionLabel(option: ProcurementBuyerOption): string {
  return option.username ? `${option.name}（${option.username}）` : option.name;
}

/** Only exact, case-insensitive matches in this response's selectable set count. */
export function matchImportedProcurementBuyer(text: string, scope: ProcurementBuyerScope | null): { buyer: ProcurementBuyerOption | null; error: string } {
  if (!scope) return { buyer: null, error: "采购员候选尚未核验，请重新获取后预览" };
  const token = text.trim().toLowerCase();
  if (!token) return { buyer: null, error: "请填写本次可选采购员的姓名或账号" };
  const matches = scope.options.filter(option => option.name.trim().toLowerCase() === token || option.username?.trim().toLowerCase() === token);
  if (matches.length !== 1) return { buyer: null, error: matches.length > 1 ? "采购员姓名或账号重名，请用唯一账号明确匹配" : "采购员不在本次可选范围内（可能跨组或已停用）" };
  const buyer = selectedProcurementBuyer(scope, matches[0].userId);
  return buyer ? { buyer, error: "" } : { buyer: null, error: "当前员工仅能归属本人，不能导入其他采购员" };
}

export function attachImportedProcurementBuyer(row: InboundBulkDraftRow, scope: ProcurementBuyerScope | null): ProcurementBuyerDraftRow {
  const { buyer, error } = matchImportedProcurementBuyer(row.operator, scope);
  return { ...row, buyerUserId: buyer ? String(buyer.userId) : "", operator: buyer?.name ?? row.operator, buyerImportError: error || undefined };
}

export function procurementBuyerDraftError(row: ProcurementBuyerDraftRow, scope: ProcurementBuyerScope | null): string {
  return row.buyerImportError || (selectedProcurementBuyer(scope, row.buyerUserId) ? "" : "请选择当前可用范围内的采购员；候选或身份已变化时请重新核验");
}
