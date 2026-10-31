/**
 * 自定义账号 session 不依赖 Manus OAuth。生产环境移除 VITE_APP_ID 后，
 * 仍需写入非空且稳定的 appId，才能通过框架层 session payload 校验。
 */
export const LOCAL_SESSION_APP_ID = "51dianzi-local";

export function resolveSessionAppId(appId: string | null | undefined): string {
  return appId?.trim() || LOCAL_SESSION_APP_ID;
}
