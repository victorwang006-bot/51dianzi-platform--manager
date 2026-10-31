import { useCallback } from "react";
import { useBusinessScope } from "../BusinessScope";

type UseBusinessAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

/**
 * Compatibility surface for migrated front pages. The active user is supplied
 * by BusinessScope only after BFF staffPrincipal.status === "ready" and a real
 * frontUser binding are both verified. It never returns admin auth.me.
 */
export function useAuth(_options?: UseBusinessAuthOptions) {
  const { frontUser } = useBusinessScope();
  const logout = useCallback(async () => {
    throw new Error("业务会话由后台工作人员会话管理，不能在迁入业务页退出");
  }, []);

  return {
    user: frontUser,
    loading: false,
    error: null,
    isAuthenticated: true,
    refresh: async () => undefined,
    logout,
  };
}
