import { ADMIN_NEW_INFORMATION_MODULES } from "@shared/adminNewInformation";
import { useAdminNewInformationContext } from "@/lib/adminNewInformation";
import { adminNewInformationModuleLabels } from "./AdminNewInformationMenuBadge";
import "./AdminNewInformationStatus.css";

/** One shared summary status, not one repeated sentence for every menu.
 * Uses the existing observer/retry only; NEVER inspects or acknowledges rows. */
export function AdminNewInformationStatus() {
  const { summary, moduleCanRead, canRead, accountKey } = useAdminNewInformationContext();
  const modules = ADMIN_NEW_INFORMATION_MODULES.filter(module => moduleCanRead?.[module] ?? canRead);
  if (!canRead || accountKey === null || accountKey === undefined || !modules.length) return null;
  const disabled = summary.status === "disabled";
  const states = modules.map(module => summary.presentationState(module));
  const failed = summary.query.isError || states.includes("failed") || modules.some(module => summary.isModuleLastKnown(module));
  const blocked = disabled || states.includes("blocked");
  const pending = states.includes("pending");
  const refreshing = states.includes("refreshing");
  const state = disabled ? "blocked" : failed ? "failed" : pending ? "pending" : refreshing ? "refreshing" : blocked ? "blocked" : "synced";
  const label = state === "failed" ? "更新失败" : state === "blocked" ? "核验受限" : state === "pending" ? "核验中" : state === "refreshing" ? "更新中" : "新信息";
  const explanation = state === "failed"
    ? "新信息更新失败，旧成功数量仅供参考，并非最新数量。可只读重试，不会清除未读。"
    : state === "blocked" ? "新信息核验受权限或身份限制；受限模块不会显示旧数量，请核对权限或重新登录。"
    : state === "pending" ? "正在核验新信息，尚无本次最新回执；如有旧数量，它是上次成功值，未知数量不是零。"
    : state === "refreshing" ? "正在后台刷新新信息；菜单保留上次成功数量（包括成功零值），并非本次实时数量。"
    : "新信息已成功核验；数量为零的菜单不显示数字。此面板不确认或清除未读。";
  const busy = summary.query.isFetching;
  return <details className="admin-new-information-status" data-admin-new-information-global={state}>
    <summary title={explanation} aria-label={`新信息状态：${label}。${explanation}`}>
      <span className="admin-new-information-status__icon" data-busy={busy ? "true" : "false"} aria-hidden="true">{busy ? "" : state === "failed" ? "!" : state === "blocked" ? "⊘" : "·"}</span>
      <span>{label}</span>
    </summary>
    <section className="admin-new-information-status__panel" aria-label="新信息核验详情">
      <p role="status" aria-live="polite">{explanation}</p>
      <ul>{modules.map(module => {
        const moduleState = summary.presentationState(module);
        const count = summary.count(module);
        const time = summary.moduleLastSuccessfulAt(module);
        const old = summary.isModuleLastKnown(module) || moduleState === "pending" || moduleState === "refreshing";
        const moduleLabel = moduleState === "disabled" || moduleState === "blocked" ? "权限或身份受限"
          : moduleState === "failed" || summary.isModuleLastKnown(module) ? "暂不可用"
          : moduleState === "pending" ? "等待最新核验" : moduleState === "refreshing" ? "后台刷新中" : "已核验";
        return <li key={module} data-information-module={module}>
          <strong>{adminNewInformationModuleLabels[module]}</strong>：{count === undefined ? "数量未知" : `${count} 条${old ? "（上次成功值）" : ""}`} · {moduleLabel}
          {time === undefined ? null : <small>上次成功更新时间：{new Date(time).toLocaleTimeString("zh-CN", { hour12: false })}</small>}
        </li>;
      })}</ul>
      {disabled ? <p>请重新核对当前账号及权限；不会继续以旧权限重试。</p> : <button type="button" disabled={busy} onClick={() => { void summary.retrySummary(); }} aria-label="只读重试新信息核验">{busy ? "核验进行中" : "重新核验 / 重试"}</button>}
      <small>只重新查询通知摘要，不确认、清零或改变列表未读状态。</small>
    </section>
  </details>;
}
