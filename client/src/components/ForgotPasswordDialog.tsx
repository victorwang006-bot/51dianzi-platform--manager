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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Mail, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Step = "account" | "verify" | "done";

/**
 * 找回密码弹窗：
 * 1. 输入用户名 → 查询绑定的手机/邮箱渠道（脱敏）
 * 2. 选择渠道发送验证码 → 输入验证码 + 新密码
 * 3. 重置成功 → 返回登录
 */
export default function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<Step>("account");
  const [username, setUsername] = useState("");
  const [channel, setChannel] = useState<"sms" | "email" | "">("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [countdown, setCountdown] = useState(0);

  // 关闭时重置状态
  useEffect(() => {
    if (!open) {
      setStep("account");
      setUsername("");
      setChannel("");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setCountdown(0);
    }
  }, [open]);

  // 重发倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const channelsQuery = trpc.auth.resetChannels.useQuery(
    { username: username.trim() },
    { enabled: false, retry: false }
  );

  const requestMutation = trpc.auth.requestReset.useMutation({
    onSuccess: () => {
      setCountdown(60);
      toast.success("验证码已发送，请查收（10 分钟内有效）");
      setStep("verify");
    },
    onError: e => toast.error(e.message),
  });

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => setStep("done"),
    onError: e => toast.error(e.message),
  });

  const channels = channelsQuery.data ?? [];

  async function handleAccountNext() {
    if (!username.trim()) {
      toast.error("请输入用户名");
      return;
    }
    const { data } = await channelsQuery.refetch();
    if (!data || data.length === 0) {
      toast.error("该账号不存在或未绑定手机/邮箱，请联系超级管理员重置");
      return;
    }
    setChannel(data[0].channel);
  }

  function handleSendCode() {
    if (!channel) {
      toast.error("请选择验证方式");
      return;
    }
    requestMutation.mutate({ username: username.trim(), channel });
  }

  function handleReset() {
    if (code.length !== 6) {
      toast.error("请输入 6 位验证码");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    resetMutation.mutate({ username: username.trim(), code, newPassword });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {step === "account" && (
          <>
            <DialogHeader>
              <DialogTitle>找回密码</DialogTitle>
              <DialogDescription>
                输入用户名后，选择绑定的手机号或邮箱接收验证码
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="fp-username">用户名</Label>
                <Input
                  id="fp-username"
                  placeholder="请输入登录用户名"
                  value={username}
                  autoFocus
                  onChange={e => setUsername(e.target.value)}
                />
              </div>
              {channels.length > 0 && (
                <div className="space-y-2">
                  <Label>验证方式</Label>
                  <RadioGroup
                    value={channel}
                    onValueChange={v => setChannel(v as "sms" | "email")}
                    className="space-y-1"
                  >
                    {channels.map(c => (
                      <label
                        key={c.channel}
                        className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                      >
                        <RadioGroupItem value={c.channel} />
                        {c.channel === "sms" ? (
                          <Smartphone className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Mail className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">
                          {c.channel === "sms" ? "短信验证码" : "邮箱验证码"}
                          <span className="text-muted-foreground ml-2">{c.maskedTarget}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              )}
              <Button
                className="w-full"
                disabled={channelsQuery.isFetching || requestMutation.isPending}
                onClick={channels.length === 0 ? handleAccountNext : handleSendCode}
              >
                {channelsQuery.isFetching
                  ? "查询中..."
                  : requestMutation.isPending
                    ? "发送中..."
                    : channels.length === 0
                      ? "下一步"
                      : "发送验证码"}
              </Button>
            </div>
          </>
        )}

        {step === "verify" && (
          <>
            <DialogHeader>
              <DialogTitle>输入验证码</DialogTitle>
              <DialogDescription>
                验证码已发送至{channel === "sms" ? "手机" : "邮箱"}
                {channels.find(c => c.channel === channel)?.maskedTarget}，10 分钟内有效
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="fp-code">验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="fp-code"
                    placeholder="6 位数字验证码"
                    value={code}
                    maxLength={6}
                    autoFocus
                    onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                  <Button
                    variant="outline"
                    className="shrink-0"
                    disabled={countdown > 0 || requestMutation.isPending}
                    onClick={handleSendCode}
                  >
                    {countdown > 0 ? `重发(${countdown}s)` : "重新发送"}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-new-password">新密码</Label>
                <Input
                  id="fp-new-password"
                  type="password"
                  placeholder="至少 8 位"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={e => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-confirm-password">确认新密码</Label>
                <Input
                  id="fp-confirm-password"
                  type="password"
                  placeholder="再次输入新密码"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={e => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                disabled={resetMutation.isPending}
                onClick={handleReset}
              >
                {resetMutation.isPending ? "重置中..." : "重置密码"}
              </Button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <DialogHeader>
              <DialogTitle>密码重置成功</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <p className="text-sm text-muted-foreground text-center">
                新密码已生效，请使用新密码登录。
              </p>
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                返回登录
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
