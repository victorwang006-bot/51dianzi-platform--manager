import { toast } from "sonner";

/** 登录完成后的轻提示时长；短消息无需长期占据页面顶部。 */
export const LOGIN_SUCCESS_TOAST_DURATION_MS = 1_800;

/**
 * 展示登录成功提示并确保自动关闭。
 *
 * Sonner 在鼠标悬停时会暂停内建倒计时，因此再加一个很轻的兜底关闭，
 * 避免用户登录后提示长期停留在导航栏上方。
 */
export function showLoginSuccessToast(message = "登录成功") {
  const toastId = toast.success(message, {
    duration: LOGIN_SUCCESS_TOAST_DURATION_MS,
  });

  globalThis.setTimeout(() => {
    toast.dismiss(toastId);
  }, LOGIN_SUCCESS_TOAST_DURATION_MS + 400);
}

export default showLoginSuccessToast;
