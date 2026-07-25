import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Mail, Smartphone, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * 找回用户名弹层：输入绑定的手机号/邮箱 → 收取验证码 → 显示绑定的用户名。
 */
export default function ForgotUsernameDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [usernames, setUsernames] = useState<
    { username: string; displayName: string | null }[] | null
  >(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 关闭时重置状态
  useEffect(() => {
    if (!open) {
      setChannel("sms");
      setTarget("");
      setCode("");
      setSent(false);
      setCountdown(0);
      setErrorMsg(null);
      setUsernames(null);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = () => {
    setCountdown(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const requestMutation = trpc.auth.requestUsernameRecovery.useMutation({
    onSuccess: () => {
      setErrorMsg(null);
      setSent(true);
      startCountdown();
    },
    onError: e => setErrorMsg(e.message || "发送失败，请稍后重试"),
  });

  const recoverMutation = trpc.auth.recoverUsername.useMutation({
    onSuccess: data => {
      setErrorMsg(null);
      setUsernames(data.usernames);
    },
    onError: e => setErrorMsg(e.message || "验证失败，请稍后重试"),
  });

  const targetValid =
    channel === "sms"
      ? /^1\d{10}$/.test(target.trim())
      : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target.trim());

  const handleSend = () => {
    if (!targetValid) {
      setErrorMsg(channel === "sms" ? "请输入正确的 11 位手机号" : "请输入正确的邮箱地址");
      return;
    }
    setErrorMsg(null);
    requestMutation.mutate({ channel, target: target.trim() });
  };

  const handleVerify = () => {
    if (code.length !== 6) {
      setErrorMsg("请输入 6 位验证码");
      return;
    }
    setErrorMsg(null);
    recoverMutation.mutate({ channel, target: target.trim(), code });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>找回用户名</DialogTitle>
          <DialogDescription>
            通过账号绑定的手机号或邮箱验证身份后，显示对应的用户名
          </DialogDescription>
        </DialogHeader>

        {usernames ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-sm font-medium">验证成功，找到以下账号：</span>
            </div>
            <div className="space-y-2">
              {usernames.map(u => (
                <div
                  key={u.username}
                  className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3"
                >
                  <UserRound className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-semibold">{u.username}</p>
                    {u.displayName && (
                      <p className="text-xs text-muted-foreground">{u.displayName}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              返回登录
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Tabs value={channel} onValueChange={v => { setChannel(v as "sms" | "email"); setSent(false); setCode(""); setErrorMsg(null); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sms" className="gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" /> 手机号
                </TabsTrigger>
                <TabsTrigger value="email" className="gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> 邮箱
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {channel === "email" && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                邮件通道暂未开通，验证码暂时无法送达邮箱，建议优先使用手机号找回
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="fu-target">{channel === "sms" ? "绑定的手机号" : "绑定的邮箱"}</Label>
              <div className="flex gap-2">
                <Input
                  id="fu-target"
                  placeholder={channel === "sms" ? "请输入 11 位手机号" : "请输入邮箱地址"}
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 bg-transparent"
                  disabled={requestMutation.isPending || countdown > 0}
                  onClick={handleSend}
                >
                  {countdown > 0 ? `${countdown}s` : sent ? "重新发送" : "发送验证码"}
                </Button>
              </div>
            </div>

            {sent && (
              <div className="space-y-1.5">
                <Label htmlFor="fu-code">验证码</Label>
                <Input
                  id="fu-code"
                  placeholder="请输入 6 位验证码"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            )}

            {errorMsg && (
              <p role="alert" className="text-sm text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2.5">
                {errorMsg}
              </p>
            )}

            {sent && (
              <Button
                className="w-full"
                disabled={recoverMutation.isPending}
                onClick={handleVerify}
              >
                {recoverMutation.isPending ? "验证中..." : "验证并显示用户名"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
