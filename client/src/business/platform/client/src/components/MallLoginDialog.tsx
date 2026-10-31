import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import { useQueryClient } from "@tanstack/react-query";
import { showLoginSuccessToast } from "../lib/loginSuccessToast";
import { notifyLoginScopeChanged } from "../hooks/useLoginScope";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  ArrowRight,
  ChevronRight,
  CircleCheck,
  Eye,
  EyeOff,
  Loader2,
  Smartphone,
  UserRound,
} from "lucide-react";
import ForgotPasswordFlow from "./ForgotPasswordFlow";
import BrandImage from "./BrandImage";
import { logoWordmark } from "../assets/logos";
import {
  normalizeLoginUsername,
  usernameValidationMessage,
} from "../../../shared/usernamePolicy";
import { passwordPolicyError } from "../../../shared/passwordPolicy";

type MallAuthUser = { crmAccess?: boolean | null };
type AuthTab = "password" | "sms" | "register";

interface MallLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 登录/注册成功后回调；在弹窗关闭前执行，可安全读取并消费待跳转目标。 */
  onSuccess?: (user: MallAuthUser) => void | Promise<void>;
}

/**
 * 商城登录弹窗（买家侧）：页面内弹窗完成登录/注册，不离开当前页。
 * 登录调 localAuth.login（scope=mall）；注册调 localAuth.register（短信验证码验证）。
 */
export default function MallLoginDialog({
  open,
  onOpenChange,
  onSuccess,
}: MallLoginDialogProps) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  const [authTab, setAuthTab] = useState<AuthTab>("password");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [phoneLoginForm, setPhoneLoginForm] = useState({ phone: "", smsCode: "" });
  const [regForm, setRegForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    phone: "",
    smsCode: "",
  });
  const [countdown, setCountdown] = useState(0);
  const [loginCountdown, setLoginCountdown] = useState(0);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [regUsernameTouched, setRegUsernameTouched] = useState(false);
  const [forgotMode, setForgotMode] = useState<"username" | "password" | null>(null);
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showRegConfirmPwd, setShowRegConfirmPwd] = useState(false);
  const regUsernameError = regUsernameTouched
    ? usernameValidationMessage(regForm.username)
    : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setForgotMode(null);
      setAuthTab("password");
    }
    onOpenChange(nextOpen);
  };

  const finish = async (msg: string, user: MallAuthUser) => {
    notifyLoginScopeChanged();
    await onSuccess?.(user);
    handleOpenChange(false);
    showLoginSuccessToast(msg);
    // 登录已由mutation确认成功；auth.me仅做后台校准，失败不得推翻登录或阻断跳转。
    void utils.auth.me.invalidate();
  };

  const loginMutation = trpc.localAuth.login.useMutation({
    onSuccess: result => {
      queryClient.clear();
      utils.auth.me.setData(undefined, result.user);
      return finish("登录成功", result.user);
    },
    onError: e => toast.error(e.message),
  });

  const phoneLoginMutation = trpc.localAuth.phoneLogin.useMutation({
    onSuccess: result => {
      queryClient.clear();
      utils.auth.me.setData(undefined, result.user);
      return finish("登录成功", result.user);
    },
    onError: e => toast.error(e.message),
  });

  const registerMutation = trpc.localAuth.register.useMutation({
    onSuccess: result => {
      queryClient.clear();
      utils.auth.me.setData(undefined, result.user);
      return finish("注册成功，已自动登录", result.user);
    },
    onError: e => toast.error(e.message),
  });

  const sendLoginSmsMutation = trpc.localAuth.sendSmsCode.useMutation({
    onSuccess: res => {
      toast.success(res.message);
      setLoginCountdown(60);
      const timer = setInterval(() => {
        setLoginCountdown(c => {
          if (c <= 1) {
            clearInterval(timer);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    },
    onError: e => toast.error(e.message),
  });

  const sendSmsMutation = trpc.localAuth.sendSmsCode.useMutation({
    onSuccess: res => {
      toast.success(res.message);
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(timer);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    },
    onError: e => toast.error(e.message),
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.username.trim() || !loginForm.password) {
      toast.error("请输入用户名和密码");
      return;
    }
    loginMutation.mutate({
      username: loginForm.username.trim(),
      password: loginForm.password,
    });
  };

  const handlePhoneLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^1[3-9]\d{9}$/.test(phoneLoginForm.phone)) {
      toast.error("请输入有效的11位手机号");
      return;
    }
    if (!/^\d{6}$/.test(phoneLoginForm.smsCode)) {
      toast.error("请输入6位短信验证码");
      return;
    }
    phoneLoginMutation.mutate({
      phone: phoneLoginForm.phone,
      smsCode: phoneLoginForm.smsCode,
    });
  };

  const handleSendLoginSms = () => {
    if (!/^1[3-9]\d{9}$/.test(phoneLoginForm.phone)) {
      toast.error("请先输入有效的11位手机号");
      return;
    }
    sendLoginSmsMutation.mutate({ phone: phoneLoginForm.phone, scene: "login" });
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    const usernameError = usernameValidationMessage(regForm.username);
    if (usernameError) {
      setRegUsernameTouched(true);
      return void toast.error(usernameError);
    }
    const passwordError = passwordPolicyError(regForm.password);
    if (passwordError) return void toast.error(passwordError);
    if (regForm.password !== regForm.confirmPassword)
      return void toast.error("两次输入的密码不一致");
    if (!/^1[3-9]\d{9}$/.test(regForm.phone))
      return void toast.error("请输入有效的11位手机号");
    if (!regForm.smsCode) return void toast.error("请输入短信验证码");
    if (!agreeChecked)
      return void toast.error("请先阅读并同意《51电子网用户注册服务协议》");
    // 普通买家注册：勾选同意协议即可，无需在线签署（签署流程保留给供应商入驻）
    registerMutation.mutate({
      username: normalizeLoginUsername(regForm.username),
      password: regForm.password,
      phone: regForm.phone,
      smsCode: regForm.smsCode.trim(),
    });
  };

  const handleSendSms = () => {
    if (!/^1[3-9]\d{9}$/.test(regForm.phone)) {
      toast.error("请先输入有效的11位手机号");
      return;
    }
    sendSmsMutation.mutate({ phone: regForm.phone, scene: "register" });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-0 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-w-[500px]">
        <DialogHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/70 px-6 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-7">
          <DialogTitle className="flex min-h-8 items-center gap-2">
            {forgotMode ? (
              <span>{forgotMode === "username" ? "找回登录名" : "找回密码"}</span>
            ) : (
              <BrandImage
                src={logoWordmark}
                alt="51电子网"
                className="h-8 w-auto"
                fallbackText="51电子网"
                fallbackClassName="px-2 text-sm tracking-normal"
              />
            )}
          </DialogTitle>
          <DialogDescription className="mt-1 max-w-[390px] text-[13px] leading-6 text-slate-500 sm:text-sm">
            {forgotMode
              ? forgotMode === "username"
                ? "通过已绑定手机号或已验证邮箱找回登录名"
                : "通过已绑定手机号或已验证邮箱验证身份后设置新密码"
              : authTab === "register"
                ? "创建51电子网账号，使用询价、订单与个人中心等服务"
                : "登录后可使用购物车、询价、个人中心等买家功能"}
          </DialogDescription>
        </DialogHeader>

        {forgotMode ? (
          <div className="min-h-0 overflow-y-auto px-6 pb-6 sm:px-8 sm:pb-8">
            <ForgotPasswordFlow
              initialMode={forgotMode}
              onBack={() => setForgotMode(null)}
              onResetSuccess={username => {
                setForgotMode(null);
                if (username) {
                  setLoginForm({ username, password: "" });
                }
              }}
            />
          </div>
        ) : (
        <Tabs value={authTab} onValueChange={value => setAuthTab(value as AuthTab)} className="w-full">
          {authTab !== "register" && (
            <div className="flex items-center justify-between gap-3 px-6 pt-5 sm:px-8">
              <TabsList aria-label="登录方式" className="grid h-12 flex-1 grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                <TabsTrigger
                  value="password"
                  className="gap-1.5 rounded-lg border border-transparent px-3 py-2.5 text-sm font-semibold text-slate-500 shadow-none transition-[color,background-color,border-color,box-shadow,transform] duration-150 data-[state=active]:border-blue-100 data-[state=active]:bg-white data-[state=active]:text-[#185FA5] data-[state=active]:shadow-[0_2px_10px_rgba(15,23,42,0.08)] active:scale-[0.98]">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  账号登录
                </TabsTrigger>
                <TabsTrigger
                  value="sms"
                  className="gap-1.5 rounded-lg border border-transparent px-3 py-2.5 text-sm font-semibold text-slate-500 shadow-none transition-[color,background-color,border-color,box-shadow,transform] duration-150 data-[state=active]:border-blue-100 data-[state=active]:bg-white data-[state=active]:text-[#185FA5] data-[state=active]:shadow-[0_2px_10px_rgba(15,23,42,0.08)] active:scale-[0.98]">
                  <Smartphone className="h-4 w-4" aria-hidden="true" />
                  手机号登录
                </TabsTrigger>
              </TabsList>
              <button
                type="button"
                className="inline-flex h-10 shrink-0 items-center gap-0.5 rounded-lg px-2.5 text-sm font-semibold text-[#185FA5] transition-[background-color,color,transform] duration-150 hover:bg-blue-50 hover:text-[#124b83] active:scale-[0.98]"
                onClick={() => setAuthTab("register")}>
                前往注册
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* ===== 用户名密码登录 ===== */}
          <TabsContent value="password" className="m-0 px-6 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mall-login-username" className="text-sm font-medium text-slate-700">账号</Label>
                <Input
                  id="mall-login-username"
                  placeholder="请输入用户名"
                  className="h-12 rounded-xl border-slate-200 bg-slate-50/70 px-4 shadow-none transition-colors hover:border-slate-300 focus-visible:border-[#185FA5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#185FA5]/10"
                  value={loginForm.username}
                  onChange={e =>
                    setLoginForm(f => ({ ...f, username: e.target.value }))
                  }
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mall-login-password" className="text-sm font-medium text-slate-700">密码</Label>
                <div className="relative">
                  <Input
                    id="mall-login-password"
                    type={showLoginPwd ? "text" : "password"}
                    placeholder="请输入密码"
                    className="h-12 rounded-xl border-slate-200 bg-slate-50/70 px-4 pr-11 shadow-none transition-colors hover:border-slate-300 focus-visible:border-[#185FA5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#185FA5]/10"
                    value={loginForm.password}
                    onChange={e =>
                      setLoginForm(f => ({ ...f, password: e.target.value }))
                    }
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    tabIndex={0}
                    aria-label={showLoginPwd ? "隐藏密码" : "显示密码"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185FA5]/30"
                    onClick={() => setShowLoginPwd(v => !v)}>
                    {showLoginPwd ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="h-12 w-full rounded-xl bg-[#185FA5] text-base font-semibold text-white shadow-[0_8px_20px_rgba(24,95,165,0.2)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[#124b83] hover:shadow-[0_10px_24px_rgba(24,95,165,0.26)] active:scale-[0.98]"
                disabled={loginMutation.isPending}>
                {loginMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                立即登录
              </Button>
              <div className="flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
                <span className="text-xs text-slate-400">账号与密码将加密传输</span>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-[#185FA5]"
                    onClick={() => setForgotMode("username")}>
                    忘记登录名？
                  </button>
                  <span className="text-slate-300" aria-hidden="true">|</span>
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-[#185FA5]"
                    onClick={() => setForgotMode("password")}>
                    忘记密码？
                  </button>
                </div>
              </div>
            </form>
          </TabsContent>

          {/* ===== 手机验证码登录 ===== */}
          <TabsContent value="sms" className="m-0 px-6 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6">
            <form onSubmit={handlePhoneLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mall-login-phone" className="text-sm font-medium text-slate-700">
                  手机号码
                </Label>
                <div className="flex h-12 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 shadow-none transition-colors hover:border-slate-300 focus-within:border-[#185FA5] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#185FA5]/10">
                  <span className="flex w-16 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50 text-sm font-medium text-slate-600">
                    +86
                  </span>
                  <input
                    id="mall-login-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={11}
                    placeholder="请输入已绑定的11位手机号"
                    className="min-w-0 flex-1 bg-transparent px-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
                    value={phoneLoginForm.phone}
                    onChange={e =>
                      setPhoneLoginForm(form => ({
                        ...form,
                        phone: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mall-login-sms" className="text-sm font-medium text-slate-700">
                  短信验证码
                </Label>
                <div className="flex h-12 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 shadow-none transition-colors hover:border-slate-300 focus-within:border-[#185FA5] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#185FA5]/10">
                  <span className="flex w-20 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50 text-sm text-slate-600">
                    验证码
                  </span>
                  <input
                    id="mall-login-sms"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="请输入"
                    className="min-w-0 flex-1 bg-transparent px-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
                    value={phoneLoginForm.smsCode}
                    onChange={e =>
                      setPhoneLoginForm(form => ({
                        ...form,
                        smsCode: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="flex min-w-[94px] shrink-0 items-center justify-center border-l border-slate-200 px-3 text-sm font-medium text-[#185FA5] transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                    disabled={loginCountdown > 0 || sendLoginSmsMutation.isPending}
                    onClick={handleSendLoginSms}>
                    {sendLoginSmsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : loginCountdown > 0 ? (
                      `${loginCountdown}秒`
                    ) : (
                      "获取验证码"
                    )}
                  </button>
                </div>
                {loginCountdown > 0 && (
                  <p className="flex items-start gap-1.5 text-xs leading-5 text-emerald-700" role="status">
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    短信验证码已发送，可能会有延后，请耐心等待
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="h-12 w-full rounded-xl bg-[#185FA5] text-base font-semibold text-white shadow-[0_8px_20px_rgba(24,95,165,0.2)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[#124b83] hover:shadow-[0_10px_24px_rgba(24,95,165,0.26)] active:scale-[0.98]"
                disabled={phoneLoginMutation.isPending}>
                {phoneLoginMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                立即登录
                {!phoneLoginMutation.isPending && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </Button>
              <p className="text-center text-xs leading-5 text-slate-500">
                仅支持已绑定手机号的账号，未绑定请先
                <button
                  type="button"
                  className="ml-1 font-medium text-[#185FA5] hover:underline"
                  onClick={() => setAuthTab("register")}>
                  前往注册
                </button>
              </p>
            </form>
          </TabsContent>

          {/* ===== 注册新用户 ===== */}
          <TabsContent value="register" className="m-0 max-h-[calc(100dvh-8rem)] overflow-y-auto px-6 pb-6 sm:px-8 sm:pb-8">
            <div className="sticky top-0 z-10 mb-5 flex items-center justify-between border-b border-slate-100 bg-white py-4">
              <div>
                <strong className="block text-base text-slate-900">注册新用户</strong>
                <span className="mt-0.5 block text-xs text-slate-500">填写基本信息后即可使用买家服务</span>
              </div>
              <button
                type="button"
                className="text-sm text-[#185FA5] hover:underline"
                onClick={() => setAuthTab("password")}>
                返回登录
                <ChevronRight className="ml-0.5 inline h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mall-reg-username">
                  用户名 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mall-reg-username"
                  className={`h-11 rounded-xl bg-slate-50/70 shadow-none focus-visible:bg-white focus-visible:ring-4 ${
                    regUsernameError
                      ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/10"
                      : "border-slate-200 focus-visible:border-[#185FA5] focus-visible:ring-[#185FA5]/10"
                  }`}
                  placeholder="3-32位，仅支持字母、数字、下划线、点或短横线"
                  value={regForm.username}
                  maxLength={32}
                  aria-invalid={Boolean(regUsernameError)}
                  aria-describedby="mall-reg-username-help"
                  onBlur={() => setRegUsernameTouched(true)}
                  onChange={e => {
                    setRegForm(f => ({ ...f, username: e.target.value }));
                    if (regUsernameTouched) setRegUsernameTouched(true);
                  }}
                  autoComplete="username"
                />
                <p
                  id="mall-reg-username-help"
                  className={`text-xs ${regUsernameError ? "text-destructive" : "text-muted-foreground"}`}
                  role={regUsernameError ? "alert" : undefined}>
                  {regUsernameError || "3–32位，仅支持字母、数字、下划线、点和短横线"}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mall-reg-password">
                    密码 <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="mall-reg-password"
                      type={showRegPwd ? "text" : "password"}
                      placeholder="8–64 位，建议使用易记的长密码"
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/70 pr-10 shadow-none focus-visible:border-[#185FA5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#185FA5]/10"
                      value={regForm.password}
                      onChange={e =>
                        setRegForm(f => ({ ...f, password: e.target.value }))
                      }
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      tabIndex={0}
                      aria-label={showRegPwd ? "隐藏密码" : "显示密码"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185FA5]/30"
                      onClick={() => setShowRegPwd(v => !v)}>
                      {showRegPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mall-reg-confirm">
                    确认密码 <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="mall-reg-confirm"
                      type={showRegConfirmPwd ? "text" : "password"}
                      placeholder="再次输入"
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/70 pr-10 shadow-none focus-visible:border-[#185FA5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#185FA5]/10"
                      value={regForm.confirmPassword}
                      onChange={e =>
                        setRegForm(f => ({ ...f, confirmPassword: e.target.value }))
                      }
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      tabIndex={0}
                      aria-label={showRegConfirmPwd ? "隐藏密码" : "显示密码"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185FA5]/30"
                      onClick={() => setShowRegConfirmPwd(v => !v)}>
                      {showRegConfirmPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mall-reg-phone">
                  手机号 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mall-reg-phone"
                  className="h-11 rounded-xl border-slate-200 bg-slate-50/70 shadow-none focus-visible:border-[#185FA5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#185FA5]/10"
                  placeholder="11位手机号"
                  value={regForm.phone}
                  maxLength={11}
                  onChange={e =>
                    setRegForm(f => ({
                      ...f,
                      phone: e.target.value.replace(/\D/g, ""),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mall-reg-sms">
                  短信验证码 <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="mall-reg-sms"
                    className="h-11 rounded-xl border-slate-200 bg-slate-50/70 shadow-none focus-visible:border-[#185FA5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#185FA5]/10"
                    placeholder="请输入6位短信验证码"
                    value={regForm.smsCode}
                    maxLength={6}
                    onChange={e =>
                      setRegForm(f => ({
                        ...f,
                        smsCode: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-[110px] shrink-0 rounded-xl border-slate-200 bg-white text-[#185FA5] hover:bg-blue-50"
                    disabled={countdown > 0 || sendSmsMutation.isPending}
                    onClick={handleSendSms}>
                    {countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  验证码短信将发送至您的手机，10 分钟内有效
                </p>
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="mall-reg-agree"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#185FA5]"
                  checked={agreeChecked}
                  onChange={e => setAgreeChecked(e.target.checked)}
                />
                <label
                  htmlFor="mall-reg-agree"
                  className="text-xs text-muted-foreground leading-5 cursor-pointer">
                  我已阅读并同意
                  <a
                    href="/register-agreement"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#185FA5] hover:underline mx-0.5">
                    《51电子网用户注册服务协议》
                  </a>
                </label>
              </div>
              <Button
                type="submit"
                className="h-12 w-full rounded-xl bg-[#185FA5] text-base font-semibold text-white shadow-[0_8px_20px_rgba(24,95,165,0.2)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[#124b83] active:scale-[0.98]"
                disabled={registerMutation.isPending}>
                {registerMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                注 册
              </Button>
            </form>
          </TabsContent>
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
