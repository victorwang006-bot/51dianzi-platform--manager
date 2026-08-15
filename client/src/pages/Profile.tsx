import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { KeyRound, Loader2, Mail, Phone, Save, User } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "超级管理员",
  merchant_mgr: "普通用户",
};

export default function Profile() {
  const utils = trpc.useUtils();
  const { refresh } = useAuth();
  // retry: false —— 无 profile.manage 权限时应立刻显示错误，而非反复重试
  const profileQuery = trpc.auth.profile.useQuery(undefined, { retry: false });

  const [form, setForm] = useState({ displayName: "", phone: "", email: "" });
  const [pwd, setPwd] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" });

  useEffect(() => {
    if (profileQuery.data) {
      setForm({
        displayName: profileQuery.data.displayName,
        phone: profileQuery.data.phone,
        email: profileQuery.data.email,
      });
    }
  }, [profileQuery.data]);

  const updateMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: async next => {
      setForm({ displayName: next.displayName, phone: next.phone, email: next.email });
      // 直接写入缓存，避免保存后表单短暂闪回旧值
      utils.auth.profile.setData(undefined, next);
      // 侧边栏头像名与后台用户列表都展示同一份资料，必须一并刷新
      await Promise.all([
        utils.auth.me.invalidate(),
        utils.adminUser.list.invalidate(),
        refresh(),
      ]);
      toast.success("个人信息已更新，并已同步到后台用户管理");
    },
    onError: e => toast.error(`保存失败：${e.message}`),
  });

  const passwordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setPwd({ oldPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("密码修改成功，下次登录请使用新密码");
    },
    onError: e => toast.error(`密码修改失败：${e.message}`),
  });

  const handleSaveProfile = () => {
    const displayName = form.displayName.trim();
    if (!displayName) {
      toast.error("请输入用户名称");
      return;
    }
    updateMutation.mutate({
      displayName,
      phone: form.phone.trim(),
      email: form.email.trim(),
    });
  };

  const handleChangePassword = () => {
    if (!pwd.oldPassword) {
      toast.error("请输入当前密码");
      return;
    }
    if (pwd.newPassword.length < 8) {
      toast.error("新密码至少8位");
      return;
    }
    if (pwd.newPassword !== pwd.confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    // 与后端同名校验重复，但前端先拦可避免一次无效请求
    if (pwd.oldPassword === pwd.newPassword) {
      toast.error("新密码不能与当前密码相同");
      return;
    }
    passwordMutation.mutate({ oldPassword: pwd.oldPassword, newPassword: pwd.newPassword });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">个人信息</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            维护本人联系方式和登录密码；资料保存后会同步显示在超级管理员的后台用户管理中。
          </p>
        </div>

        {profileQuery.isLoading ? (
          <Card>
            <CardContent className="space-y-3 p-6">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
            </CardContent>
          </Card>
        ) : !profileQuery.data ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              {profileQuery.error?.message || "无法读取个人信息"}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="h-4 w-4 text-primary" />
                  基本信息
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-username">登录用户名</Label>
                    <Input id="profile-username" value={profileQuery.data.username} disabled />
                    <p className="text-xs text-muted-foreground">唯一登录账号，不支持本人修改</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-role">角色权限</Label>
                    <Input
                      id="profile-role"
                      value={ROLE_LABELS[profileQuery.data.adminRole] ?? "普通用户"}
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">由超级管理员统一分配</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="profile-name">
                    用户名称 <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="profile-name"
                      className="pl-9"
                      maxLength={128}
                      value={form.displayName}
                      onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                      placeholder="姓名或昵称"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="profile-phone">绑定手机号</Label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="profile-phone"
                      className="pl-9"
                      inputMode="tel"
                      maxLength={32}
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="手机号（可留空）"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="profile-email">绑定邮箱</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="profile-email"
                      className="pl-9"
                      type="email"
                      maxLength={255}
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="邮箱（可留空）"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} disabled={updateMutation.isPending}>
                    {updateMutation.isPending
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Save className="mr-2 h-4 w-4" />}
                    保存资料
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4 text-primary" />
                  更改密码
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-old-password">
                    当前密码 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="profile-old-password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    value={pwd.oldPassword}
                    onChange={e => setPwd(p => ({ ...p, oldPassword: e.target.value }))}
                    placeholder="请输入当前密码"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-new-password">
                    新密码 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="profile-new-password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={128}
                    value={pwd.newPassword}
                    onChange={e => setPwd(p => ({ ...p, newPassword: e.target.value }))}
                    placeholder="至少8位"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-confirm-password">
                    确认新密码 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="profile-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={128}
                    value={pwd.confirmPassword}
                    onChange={e => setPwd(p => ({ ...p, confirmPassword: e.target.value }))}
                    placeholder="再次输入新密码"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  修改密码必须验证当前密码；新密码至少8位，且不能与当前密码相同。
                </p>
                <div className="flex justify-end">
                  <Button onClick={handleChangePassword} disabled={passwordMutation.isPending}>
                    {passwordMutation.isPending
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <KeyRound className="mr-2 h-4 w-4" />}
                    修改密码
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
