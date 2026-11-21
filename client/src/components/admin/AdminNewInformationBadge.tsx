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
  updateState?: "disabled" | "pending" | "failed" | "synced";
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
  const updateLabel = updateState === "disabled" ? "核验阻断"
    : updateState === "pending" ? "待更新"
    : updateState === "failed" || lastKnown ? "更新失败" : undefined;
  if (!updateLabel && (count === undefined || !Number.isFinite(count) || count <= 0)) {
    return placement === "inline" && reserveSpace ? (
      <span
        className={`relative ml-1 inline-block h-[18px] min-w-[18px] shrink-0 ${className}`}
        aria-hidden="true"
      />
    ) : null;
  }
  const total = count !== undefined && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : undefined;
  const label =
    `${ariaLabel ?? (total === undefined ? "新信息数量尚未核验" : `${total} 条新信息`)}${updateLabel ? `（${updateLabel}）` : ""}`;
  const placementClass =
    placement === "absolute"
      ? "absolute -right-[9px] -top-[7px]"
      : placement === "nav"
        ? "absolute right-[2px] -top-[3px] z-[1]"
        : "relative ml-1 shrink-0";
  return (
    <span
      className={`${placementClass} inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#E5484D] px-[5px] text-[11px] font-semibold leading-[18px] text-white tabular-nums ring-2 ring-white ${className}`}
      data-admin-new-information="count"
      data-placement={placement}
      data-update-state={updateState ?? (lastKnown ? "failed" : "synced")}
      aria-label={label}
      title={label}
      role="status"
    >
      {total === undefined ? "…" : formatAdminNewInformationCount(total)}
      {updateLabel && <span style={{ position: "absolute", top: "100%", right: 0, marginTop: 1, whiteSpace: "nowrap", borderRadius: 3, background: "white", padding: "0 2px", fontSize: 9, lineHeight: "12px", fontWeight: 400, color: "#92400e", boxShadow: "0 0 0 1px #fde68a" }} data-admin-new-information="update-status">{updateLabel}</span>}
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
