import { useRef } from "react";
import { ADMIN_NEW_INFORMATION_MODULES } from "@shared/adminNewInformation";
import { useAdminNewInformationContext } from "@/lib/adminNewInformation";
import { adminNewInformationModuleLabels } from "./AdminNewInformationMenuBadge";
import "./AdminNewInformationStatus.css";

/** One shared summary status, not one repeated sentence for every menu.
 * Uses the existing observer/retry only; NEVER inspects or acknowledges rows. */
export function AdminNewInformationStatus() {
  const { summary, moduleCanRead, canRead, accountKey } = useAdminNewInformationContext();
  const modules = ADMIN_NEW_INFORMATION_MODULES.filter(module => moduleCanRead?.[module] ?? canRead);
  // Presentation memory only: a failed first read may become query-pending on
  // retry. Keep the exception discoverable until that read actually completes;
  // never remember a count, receipt, permission, or another account's exception.
  const boundary = JSON.stringify([accountKey, canRead, modules]);
  const exception = useRef<{ boundary: string; state?: "failed" | "blocked" }>({ boundary });
  if (exception.current.boundary !== boundary) exception.current = { boundary };
  if (!canRead || accountKey === null || accountKey === undefined || !modules.length) return null;
  const disabled = summary.status === "disabled";
  const states = modules.map(module => summary.presentationState(module));
  const failed = summary.query.isError || states.includes("failed") || modules.some(module =>
    summary.isModuleLastKnown(module) || summary.summary?.modules[module]?.reason === "temporary");
  const blocked = disabled || states.includes("blocked");
  const busy = summary.query.isFetching;
  if (blocked || failed) exception.current.state = blocked ? "blocked" : "failed";
  else if (!busy) exception.current.state = undefined;
  const state = blocked ? "blocked" : failed ? "failed" : busy && exception.current.state
    ? exception.current.state : states.includes("pending") ? "pending" : states.includes("refreshing") ? "refreshing" : "synced";
  const label = state === "failed" ? "更新失败" : state === "blocked" ? "核验受限" : "通知状态";
  const explanation = state === "failed"
    ? "通知更新失败；异常模块与上次成功值见详情，旧数量并非最新数量。可只读重试，不会清除未读。"
    : state === "blocked" ? "通知核验受权限或身份限制；受限模块不会显示旧数量，请核对权限或重新登录。其他模块的更新失败见详情。"
    : "通知数量来自最近成功核验；未知数量不是零，成功零值静默。后台查询期间保留原数量样式，不代表本次实时数量。此面板不确认或清除未读。";
  return <details className="admin-new-information-status" data-admin-new-information-global={state}>
    <summary title={explanation} aria-label={`通知状态：${label}。${explanation}`}>
      {state === "failed" || state === "blocked" ? <span className="admin-new-information-status__icon" aria-hidden="true">{state === "failed" ? "!" : "⊘"}</span> : null}
      <span>{label}</span>
    </summary>
    <section className="admin-new-information-status__panel" aria-label="新信息核验详情">
      <p role="status" aria-live="polite">{explanation}</p>
      <ul>{modules.map(module => {
        const moduleState = summary.presentationState(module);
        const restricted = moduleState === "disabled" || moduleState === "blocked";
        const count = restricted ? undefined : summary.count(module);
        const time = restricted ? undefined : summary.moduleLastSuccessfulAt(module);
        const lastKnown = !restricted && summary.isModuleLastKnown(module);
        const retryingUnknownFailure = busy && exception.current.state === "failed" && summary.summary === undefined;
        const unavailable = moduleState === "failed" || lastKnown || retryingUnknownFailure || summary.summary?.modules[module]?.reason === "temporary";
        const old = lastKnown || moduleState === "pending" || moduleState === "refreshing" || moduleState === "failed";
        const moduleLabel = restricted ? "权限或身份受限"
          : unavailable ? "暂不可用 / 更新失败"
          : moduleState === "pending" ? "等待最新核验" : moduleState === "refreshing" ? "后台刷新中" : "已核验";
        return <li key={module} data-information-module={module} data-update-state={moduleState} data-last-known={lastKnown ? "true" : "false"}>
          <strong>{adminNewInformationModuleLabels[module]}</strong>：{count === undefined ? "数量未知" : `${count} 条${old ? "（上次成功值）" : ""}`} · {moduleLabel}
          {time === undefined ? null : <small>上次成功更新时间：{new Date(time).toLocaleTimeString("zh-CN", { hour12: false })}</small>}
        </li>;
      })}</ul>
      {disabled ? <p>请重新核对当前账号及权限；不会继续以旧权限重试。</p> : <button type="button" disabled={busy} onClick={() => { if (!busy) void summary.retrySummary(); }} aria-label="只读重试新信息核验">{busy ? "核验进行中" : "重新核验 / 重试"}</button>}
      <small>只重新查询通知摘要，不确认、清零或改变列表未读状态。</small>
    </section>
  </details>;
}
