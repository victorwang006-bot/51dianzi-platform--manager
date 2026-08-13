import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { KeyRound, Loader2, Mail, Phone, Save, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const roleLabels: Record<string, string> = {
  super_admin: "超级管理员",
  merchant_mgr: "普通用户",
};

export default function Profile() {
  const utils = trpc.useUtils();
  const { refresh } = useAuth();
  const profileQuery = trpc.auth.profile.useQuery(undefined, { retry: false });
  const [profileForm, setProfileForm] = useState({ displayName: "", phone: "", email: "" });
  const [passwordForm, setPasswordForm] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" });

  useEffect(() => {
    if (!profileQuery.data) return;
    setProfileForm({
      displayName: profileQuery.data.displayName,
      phone: profileQuery.data.phone,
      email: profileQuery.data.email,
    });
  }, [profileQuery.data]);

  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: async data => {
      setProfileForm({ displayName: data.displayName, phone: data.phone, email: data.email });
      utils.auth.profile.setData(undefined, data);
      await Promise.all([
        utils.auth.me.invalidate(),
        utils.adminUser.list.invalidate(),
        refresh(),
      ]);
      toast.success("个人信息已更新，并已同步到后台用户管理");
    },
    onError: error => toast.error(`保存失败：${error.message}`),
  });

  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("密码修改成功，下次登录请使用新密码");
    },
    onError: error => toast.error(`密码修改失败：${error.message}`),
  });

  const submitProfile = () => {
    const displayName = profileForm.displayName.trim();
    if (!displayName) {
      toast.error("请输入用户名称");
      return;
    }
    updateProfile.mutate({
      displayName,
      phone: profileForm.phone.trim(),
      email: profileForm.email.trim(),
    });
  };

  const submitPassword = () => {
    if (!passwordForm.oldPassword) {
      toast.error("请输入当前密码");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error("新密码至少8位");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    if (passwordForm.oldPassword === passwordForm.newPassword) {
      toast.error("新密码不能与当前密码相同");
      return;
    }
    changePassword.mutate({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
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
          <Card className="max-w-5xl">
            <CardContent className="flex min-h-56 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : profileQuery.error || !profileQuery.data ? (
          <Card className="max-w-5xl">
            <CardContent className="p-6 text-sm text-destructive">
              {profileQuery.error?.message || "无法读取个人信息"}
            </CardContent>
          </Card>
        ) : (
          <div className="grid max-w-5xl gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserRound className="h-4 w-4 text-primary" />基本信息
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
                    <Input id="profile-role" value={roleLabels[profileQuery.data.adminRole] ?? "普通用户"} disabled />
                    <p className="text-xs text-muted-foreground">由超级管理员统一分配</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="profile-name">用户名称 <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="profile-name"
                      className="pl-9"
                      maxLength={128}
                      value={profileForm.displayName}
                      onChange={event => setProfileForm(current => ({ ...current, displayName: event.target.value }))}
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
                      value={profileForm.phone}
                      onChange={event => setProfileForm(current => ({ ...current, phone: event.target.value }))}
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
                      value={profileForm.email}
                      onChange={event => setProfileForm(current => ({ ...current, email: event.target.value }))}
                      placeholder="邮箱（可留空）"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={submitProfile} disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    保存资料
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4 text-primary" />更改密码
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-old-password">当前密码 <span className="text-destructive">*</span></Label>
                  <Input
                    id="profile-old-password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    value={passwordForm.oldPassword}
                    onChange={event => setPasswordForm(current => ({ ...current, oldPassword: event.target.value }))}
                    placeholder="请输入当前密码"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-new-password">新密码 <span className="text-destructive">*</span></Label>
                  <Input
                    id="profile-new-password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={128}
                    value={passwordForm.newPassword}
                    onChange={event => setPasswordForm(current => ({ ...current, newPassword: event.target.value }))}
                    placeholder="至少8位"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-confirm-password">确认新密码 <span className="text-destructive">*</span></Label>
                  <Input
                    id="profile-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={128}
                    value={passwordForm.confirmPassword}
                    onChange={event => setPasswordForm(current => ({ ...current, confirmPassword: event.target.value }))}
                    placeholder="再次输入新密码"
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  修改密码必须验证当前密码；新密码至少8位，且不能与当前密码相同。
                </p>
                <div className="flex justify-end">
                  <Button onClick={submitPassword} disabled={changePassword.isPending}>
                    {changePassword.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                    修改密码
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
