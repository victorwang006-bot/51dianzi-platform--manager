import { useCallback, useSyncExternalStore } from "react";

/**
 * 读取非 httpOnly 的 login_scope cookie，判断当前登录范围。
 * - mall：商城登录（买家侧）
 * - crm：CRM 工作台登录（供应商侧，天然包含 mall）
 * 注意：该 cookie 仅用于前端路由提示，后端鉴权仍以数据库 crmAccess 为准。
 */
function readScopes(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)login_scope=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

const listeners = new Set<() => void>();

/** 登录/登出后调用，通知所有订阅组件刷新 scope 状态 */
export function notifyLoginScopeChanged() {
  listeners.forEach(fn => fn());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // 页面重新聚焦时也重新读取（跨标签页登录场景）
  window.addEventListener("focus", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("focus", cb);
  };
}

export function useLoginScope() {
  const raw = useSyncExternalStore(subscribe, readScopes, () => "");
  const parse = useCallback((value: string) => {
    const scopes = value.split(",").filter(Boolean);
    return {
      hasMall: scopes.includes("mall"),
      hasCrm: scopes.includes("crm"),
    };
  }, []);
  return parse(raw);
}
