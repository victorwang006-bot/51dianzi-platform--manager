import { useId } from "react";
import type { AdminNewInformationModule } from "@shared/adminNewInformation";
import { useAdminNewInformationRowContext } from "@/lib/adminNewInformation";
import "./AdminNewInformationBadge.css";

export function formatAdminNewInformationCount(count: number): string {
  return count >= 100 ? "99+" : String(Math.max(0, Math.floor(count)));
}
export type AdminNewInformationBadgeProps = {
  /** Undefined means unknown/disabled, not a successful zero. */
  count?: number;
  className?: string;
  ariaLabel?: string;
  placement?: "absolute" | "inline" | "nav";
  reserveSpace?: boolean;
  lastKnown?: boolean;
  updateState?: "disabled" | "blocked" | "pending" | "failed" | "synced";
};
/** Same 18px visual language as ChatUnreadBadge; never import its chat queries. */
export function AdminNewInformationBadge({
  count,
  className = "",
  ariaLabel,
  placement = "absolute",
  reserveSpace = false,
  lastKnown = false,
  updateState,
}: AdminNewInformationBadgeProps) {
  const state = updateState ?? (lastKnown ? "failed" : "synced");
  const blocked = state === "disabled" || state === "blocked";
  const total = !blocked && count !== undefined && Number.isSafeInteger(count) && count >= 0
    ? count : undefined;
  const updateLabel = blocked ? "核验阻断"
    : state === "pending" ? (total === undefined ? "核验中" : "待更新")
    : state === "failed" || lastKnown ? "暂不可用" : undefined;
  if (!updateLabel && (total === undefined || total === 0)) {
    return placement === "inline" && reserveSpace ? (
      <span
        className={`relative ml-1 inline-block h-[18px] min-w-[18px] shrink-0 ${className}`}
        aria-hidden="true"
      />
    ) : null;
  }
  const label =
    `${blocked ? "当前新信息核验受权限或身份限制" : ariaLabel ?? (total === undefined ? "新信息数量尚未核验" : `${total} 条新信息${lastKnown ? "（上次成功核验，非本次实时数量）" : ""}`)}${updateLabel ? `（${updateLabel}）` : ""}`;
  const placementClass =
    placement === "absolute"
      ? "absolute -right-[9px] -top-[7px]"
      : placement === "nav"
        ? "absolute right-[2px] -top-[3px] z-[1]"
        : "relative ml-1 shrink-0";
  // An unknown/error state is not a red unread count. Keep any verified last
  // number as neutral context, and never turn an unknown response into zero.
  if (updateLabel) return (
    <span
      className={`${placementClass} inline-flex items-center justify-center whitespace-nowrap ${className}`}
      style={{ background: "#f1f5f9", color: "#475569", boxShadow: "none", borderRadius: 4,
        height: 16, padding: "0 4px", fontSize: 10, lineHeight: "16px", fontWeight: 400 }}
      data-admin-new-information="update-status"
      data-placement={placement}
      data-update-state={state}
      data-known-count={total}
      aria-label={label}
      title={label}
      role="status"
    >
      {total !== undefined && total > 0 ? `${formatAdminNewInformationCount(total)} · ` : ""}{updateLabel}
    </span>
  );
  return (
    <span
      className={`${placementClass} inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#E5484D] px-[5px] text-[11px] font-semibold leading-[18px] text-white tabular-nums ring-2 ring-white ${className}`}
      data-admin-new-information="count"
      data-placement={placement}
      data-update-state={state}
      data-known-count={total}
      aria-label={label}
      title={label}
      role="status"
    >
      {formatAdminNewInformationCount(total!)}
    </span>
  );
}
export type AdminNewInformationRowBadgeProps = {
  /** Pure path: put rows.getRow(id).ref on the actual native tr/card. */
  isNew?: boolean;
  /** Context path: inside RowsProvider pass canonical source ID + original scope.
   * This visible badge itself acts as the DOM witness inside the existing row.
   */
  id?: string;
  module?: AdminNewInformationModule;
  scope?: string;
  presentationKey?: string;
  className?: string;
  ariaLabel?: string;
  /** Native customer list uses explicit 未读; legacy modules keep 新. */
  label?: string;
};
export function AdminNewInformationRowBadge({
  isNew,
  id,
  module,
  scope,
  presentationKey,
  className = "",
  ariaLabel = "新信息，已在当前列表展示后会记录为已展示",
  label = "新",
}: AdminNewInformationRowBadgeProps) {
  const instance = useId();
  const row = useAdminNewInformationRowContext(
    id,
    module,
    scope,
    presentationKey ?? `badge:${instance}`
  );
  if (!(isNew ?? row?.isNew)) return null;
  return (
    <span
      ref={row?.ref}
      className={`ml-1 inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-[#E5484D] px-1 text-[10px] font-semibold leading-[16px] text-white ring-2 ring-white ${className}`}
      data-admin-new-information="row"
      title={ariaLabel}
      aria-label={ariaLabel}
      role="status"
    >
      {label}
    </span>
  );
}
export default AdminNewInformationBadge;
