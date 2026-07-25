import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Eye, EyeOff, Lock, User as UserIcon } from "lucide-react";
import { useState } from "react";
import ForgotPasswordDialog from "@/components/ForgotPasswordDialog";
import ForgotUsernameDialog from "@/components/ForgotUsernameDialog";

/**
 * 51电子网后台 · 账号密码登录页
 * 左侧品牌区（品牌蓝渐变 + 产品价值点），右侧登录表单。
 */
export default function Login() {
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotUsernameOpen, setForgotUsernameOpen] = useState(false);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      setErrorMsg(null);
      // 会话 cookie 已由服务端写入，刷新全部查询（含 auth.me 与登录前失败的业务查询）
      await utils.invalidate();
    },
    onError: e => {
      setErrorMsg(e.message || "登录失败，请稍后重试");
    },
  });

  const submitting = loginMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!username.trim()) {
      setErrorMsg("请输入用户名");
      return;
    }
    if (!password) {
      setErrorMsg("请输入密码");
      return;
    }
    setErrorMsg(null);
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* 左侧品牌区（桌面端显示） */}
      <div
        className="hidden lg:flex lg:w-[46%] flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{
          background:
            "linear-gradient(150deg, #0d3f73 0%, #185FA5 55%, #2478c8 100%)",
        }}
      >
        {/* 装饰性点阵纹理 */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative">
          <div
            className="flex items-center gap-3"
            style={{ "--logo-color": "#ffffff" } as React.CSSProperties}
          >
            <Logo className="h-11 w-auto object-contain" />
            <div>
              <p className="text-xl font-bold tracking-wide">51电子网</p>
              <p className="text-xs text-white/70 tracking-widest">后台管理系统</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-snug text-white">
            电子元器件交易平台
            <br />
            一站式运营管理中枢
          </h1>
        </div>

        <p className="relative text-xs text-white/50">
          © {new Date().getFullYear()} 51电子网 · 仅限授权运营人员使用
        </p>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* 移动端顶部品牌 */}
          <div className="lg:hidden flex flex-col items-center gap-3 mb-10">
            <Logo className="h-12 w-auto object-contain" />
            <div className="text-center">
              <p className="text-lg font-bold text-primary">51电子网</p>
              <p className="text-xs text-muted-foreground tracking-widest">后台管理系统</p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">欢迎回来</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              请使用后台账号和密码登录
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="login-username">用户名</Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="login-username"
                  className="pl-9 h-11"
                  placeholder="请输入用户名"
                  value={username}
                  autoComplete="username"
                  autoFocus
                  onChange={e => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="login-password">密码</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="login-password"
                  className="pl-9 pr-10 h-11"
                  type={showPassword ? "text" : "password"}
                  placeholder="请输入密码"
                  value={password}
                  autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="text-sm text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2.5"
              >
                {errorMsg}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full h-11 text-base shadow-md hover:shadow-lg transition-all"
              disabled={submitting}
            >
              {submitting ? "登录中..." : "登 录"}
            </Button>
          </form>

          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              type="button"
              onClick={() => setForgotUsernameOpen(true)}
              className="text-xs text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              忘记用户名？
            </button>
            <span className="text-xs text-muted-foreground/40">|</span>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-xs text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              忘记密码？
            </button>
          </div>
          <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
          <ForgotUsernameDialog open={forgotUsernameOpen} onOpenChange={setForgotUsernameOpen} />
        </div>
      </div>
    </div>
  );
}
