import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  Smartphone,
} from "lucide-react";
import PasswordInput from "./PasswordInput";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { trpc } from "../../../../api/business-trpc";
import { passwordPolicyError } from "../../../shared/passwordPolicy";

const BLUE = "#185FA5";
type RecoveryChannel = "phone" | "email";
type RecoveryStep = "contact" | "code" | "verified" | "password";

interface VerifiedRecovery {
  contact: string;
  channel: RecoveryChannel;
  username: string;
  recoveryTicket: string;
}

interface ForgotPasswordFlowProps {
  /** `username` stops after identity verification; `password` also offers password reset. */
  initialMode?: "username" | "password";
  onBack: () => void;
  /** Returns to the calling login form with the verified username, never a saved contact. */
  onResetSuccess: (username: string | null) => void;
}

function maskContact(contact: string, channel: RecoveryChannel) {
  if (channel === "phone")
    return `${contact.slice(0, 3)}****${contact.slice(-4)}`;
  const [local = "", domain = ""] = contact.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function contactError(contact: string, channel: RecoveryChannel) {
  if (channel === "phone")
    return /^1[3-9]\d{9}$/.test(contact) ? null : "请输入有效的 11 位手机号";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)
    ? null
    : "请输入有效的邮箱地址";
}

/**
 * 登录前联系方式找回。请求验证码的成功响应不代表联系方式绑定账号或验证码已送达；
 * 仅在服务端验证成功并签发 recoveryTicket 后展示用户名或允许设置新密码。
 */
export default function ForgotPasswordFlow({
  initialMode = "password",
  onBack,
  onResetSuccess,
}: ForgotPasswordFlowProps) {
  const [step, setStep] = useState<RecoveryStep>("contact");
  const [channel, setChannel] = useState<RecoveryChannel>("phone");
  const [contact, setContact] = useState("");
  const [requestedContact, setRequestedContact] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [verifiedRecovery, setVerifiedRecovery] =
    useState<VerifiedRecovery | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const recoveryAttemptRef = useRef(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(
      () => setCountdown(value => value - 1),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const clearRecoveryState = () => {
    recoveryAttemptRef.current += 1;
    setStep("contact");
    setContact("");
    setRequestedContact("");
    setCode("");
    setCountdown(0);
    setVerifiedRecovery(null);
    setNewPassword("");
    setConfirmPassword("");
  };

  const requestCode = trpc.localAuth.requestContactRecoveryCode.useMutation({
    onMutate: () => recoveryAttemptRef.current,
    onSuccess: (_result, _variables, attempt) => {
      if (attempt !== recoveryAttemptRef.current) return;
      setRequestedContact(contact.trim());
      setCode("");
      setCountdown(60);
      setStep("code");
    },
    onError: error =>
      toast.error(error.message || "暂时无法请求验证码，请稍后重试"),
  });

  const verifyCode = trpc.localAuth.verifyContactRecoveryCode.useMutation({
    onMutate: () => recoveryAttemptRef.current,
    onSuccess: (result, _variables, attempt) => {
      if (attempt !== recoveryAttemptRef.current) return;
      if (!result.success) {
        toast.error("验证码错误或已过期，请重新输入或获取验证码");
        return;
      }
      setVerifiedRecovery({
        contact: requestedContact,
        channel,
        username: result.username?.trim() || "",
        recoveryTicket: result.recoveryTicket,
      });
      setCode("");
      setStep("verified");
    },
    onError: error => toast.error(error.message || "验证码验证失败，请重试"),
  });

  const completeRecovery = trpc.localAuth.completeContactRecovery.useMutation({
    onMutate: () => recoveryAttemptRef.current,
    onSuccess: (_result, _variables, attempt) => {
      if (attempt !== recoveryAttemptRef.current) return;
      toast.success("新密码已设置，请使用新密码重新登录");
      onResetSuccess(verifiedRecovery?.username ?? null);
    },
    onError: error => toast.error(error.message || "密码设置失败，请重试"),
  });

  const submitContact = () => {
    const normalized = contact.trim();
    const error = contactError(normalized, channel);
    if (error) return void toast.error(error);
    requestCode.mutate({ contact: normalized, channel });
  };

  const resendCode = () => {
    if (!requestedContact) return;
    requestCode.mutate({ contact: requestedContact, channel });
  };

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return void toast.error("请输入 6 位验证码");
    if (!requestedContact) return clearRecoveryState();
    verifyCode.mutate({ contact: requestedContact, channel, code });
  };

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (!verifiedRecovery) return clearRecoveryState();
    const policyError = passwordPolicyError(newPassword);
    if (policyError) return void toast.error(policyError);
    if (newPassword !== confirmPassword)
      return void toast.error("两次输入的新密码不一致");
    completeRecovery.mutate({
      contact: verifiedRecovery.contact,
      channel: verifiedRecovery.channel,
      recoveryTicket: verifiedRecovery.recoveryTicket,
      newPassword,
    });
  };

  const identityVerified = step === "verified" || step === "password";
  const verificationCodeComplete = identityVerified;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={
          step === "contact"
            ? onBack
            : clearRecoveryState
        }
        className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {step === "contact"
          ? "返回登录"
          : step === "password"
            ? "重新验证身份"
            : "更换联系方式"}
      </button>

      <div
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        aria-label="找回进度"
      >
        <span
          className={
            identityVerified
              ? "text-green-600"
              : step === "contact"
                ? "font-semibold text-foreground"
                : ""
          }
        >
          {identityVerified && (
            <CheckCircle2 className="mr-0.5 inline h-3.5 w-3.5 -mt-0.5" />
          )}
          1. 验证身份
        </span>
        <span className="h-px w-4 bg-border" />
        <span
          className={
            verificationCodeComplete
              ? "text-green-600"
              : step === "code"
                ? "font-semibold text-foreground"
                : ""
          }
        >
          {verificationCodeComplete && (
            <CheckCircle2 className="mr-0.5 inline h-3.5 w-3.5 -mt-0.5" />
          )}
          2. 输入验证码
        </span>
        <span className="h-px w-4 bg-border" />
        <span
          className={
            step === "verified"
              ? "font-semibold text-foreground"
              : step === "password"
                ? "text-green-600"
                : ""
          }
        >
          {step === "password" && (
            <CheckCircle2 className="mr-0.5 inline h-3.5 w-3.5 -mt-0.5" />
          )}
          3. 确认登录名
        </span>
        {step === "password" && (
          <>
            <span className="h-px w-4 bg-border" />
            <span className="font-semibold text-foreground">4. 设置新密码</span>
          </>
        )}
      </div>

      {step === "contact" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>验证方式</Label>
            <RadioGroup
              value={channel}
              onValueChange={value => {
                setChannel(value as RecoveryChannel);
                clearRecoveryState();
              }}
            >
              <label
                htmlFor="fp-phone"
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <RadioGroupItem id="fp-phone" value="phone" />
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">本人已绑定手机号</span>
              </label>
              <label
                htmlFor="fp-email"
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <RadioGroupItem id="fp-email" value="email" />
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">本人已验证邮箱</span>
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-contact">
              {channel === "phone" ? "已绑定手机号" : "已验证邮箱"}
            </Label>
            <Input
              id="fp-contact"
              type={channel === "phone" ? "tel" : "email"}
              inputMode={channel === "phone" ? "numeric" : "email"}
              placeholder={
                channel === "phone"
                  ? "请输入本人已绑定的11位手机号"
                  : "请输入本人已验证的邮箱"
              }
              value={contact}
              maxLength={channel === "phone" ? 11 : undefined}
              onChange={event => {
                recoveryAttemptRef.current += 1;
                setContact(
                  channel === "phone"
                    ? event.target.value.replace(/\D/g, "")
                    : event.target.value
                );
                setRequestedContact("");
                setCode("");
                setCountdown(0);
                setVerifiedRecovery(null);
                setNewPassword("");
                setConfirmPassword("");
              }}
              autoComplete={channel === "phone" ? "tel" : "email"}
            />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            为保护账号隐私，下一步不会确认该联系方式是否绑定账号或验证码是否已送达。
          </p>
          <Button
            type="button"
            className="w-full"
            style={{ background: BLUE }}
            disabled={requestCode.isPending}
            onClick={submitContact}
          >
            {requestCode.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            获取验证码
          </Button>
        </div>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} className="space-y-4">
          <p className="rounded-md border border-blue-100 bg-blue-50/50 p-2.5 text-xs leading-5 text-muted-foreground">
            如该联系方式绑定账号，验证码将发往你填写的
            {maskContact(requestedContact, channel)}。
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="fp-code">验证码</Label>
            <div className="flex gap-2">
              <Input
                id="fp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="请输入 6 位验证码"
                value={code}
                maxLength={6}
                onChange={event =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
              <Button
                type="button"
                variant="outline"
                className="w-[118px] shrink-0"
                disabled={countdown > 0 || requestCode.isPending}
                onClick={resendCode}
              >
                {requestCode.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : countdown > 0 ? (
                  `${countdown}s 后重发`
                ) : (
                  "重新获取"
                )}
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              60 秒倒计时仅为重发等待，并不表示验证码已送达。
            </p>
          </div>
          <Button
            type="submit"
            className="w-full"
            style={{ background: BLUE }}
            disabled={verifyCode.isPending}
          >
            {verifyCode.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            验证验证码
          </Button>
        </form>
      )}

      {step === "verified" && verifiedRecovery && (
        <div className="space-y-4">
          <div className="rounded-md border border-green-200 bg-green-50 p-4 text-center">
            <CheckCircle2
              className="mx-auto mb-2 h-6 w-6 text-green-600"
              aria-hidden="true"
            />
            {verifiedRecovery.username ? (
              <>
                <p className="text-sm text-muted-foreground">
                  身份已验证，当前登录名为
                </p>
                <p className="mt-1 break-all text-xl font-bold text-[#185FA5]">
                  {verifiedRecovery.username}
                </p>
              </>
            ) : (
              <p className="text-sm font-medium text-green-800">
                该账号暂无登录名，可使用手机号登录
              </p>
            )}
          </div>
          <Button
            type="button"
            variant={initialMode === "password" ? "outline" : "default"}
            className="w-full"
            style={
              initialMode === "username" ? { background: BLUE } : undefined
            }
            onClick={() => onResetSuccess(verifiedRecovery.username)}
          >
            返回登录
          </Button>
          <Button
            type="button"
            className="w-full"
            style={{ background: BLUE }}
            onClick={() => setStep("password")}
          >
            设置新密码
          </Button>
        </div>
      )}

      {step === "password" && verifiedRecovery && (
        <form onSubmit={submitPassword} className="space-y-3">
          <div className="rounded-md border border-green-200 bg-green-50 p-2.5 text-xs text-green-800">
            {verifiedRecovery.username ? (
              <>
                已验证登录名：
                <span className="font-semibold">{verifiedRecovery.username}</span>
              </>
            ) : (
              "该账号暂无登录名，可使用手机号登录"
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-new-pass">新密码</Label>
            <PasswordInput
              id="fp-new-pass"
              placeholder="8–64 位，建议使用易记的长密码"
              value={newPassword}
              maxLength={64}
              onChange={event => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-confirm-pass">确认新密码</Label>
            <PasswordInput
              id="fp-confirm-pass"
              placeholder="再次输入新密码"
              value={confirmPassword}
              maxLength={64}
              onChange={event => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            style={{ background: BLUE }}
            disabled={completeRecovery.isPending}
          >
            {completeRecovery.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            确认设置新密码
          </Button>
        </form>
      )}
    </div>
  );
}
