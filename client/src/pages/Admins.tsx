import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateTime,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ChevronDown, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type AdminRole = "super_admin" | "merchant_mgr";

const roleOptions: { value: AdminRole; label: string; duties: string }[] = [
  { value: "super_admin", label: "超级管理员", duties: "全部菜单、全部商户、全部订单和账号管理权限" },
  { value: "merchant_mgr", label: "普通用户", duties: "仅商户管理、订单中心，并按销售权限限制数据范围" },
];

const roleStyleMap: Record<AdminRole, "danger" | "info"> = {
  super_admin: "danger",
  merchant_mgr: "info",
};

type FormState = {
  username: string;
  displayName: string;
  email: string;
  phone: string;
  adminRole: AdminRole;
  salesStaffCodes: string[];
  password: string;
};

const emptyForm: FormState = {
  username: "",
  displayName: "",
  email: "",
  phone: "",
  adminRole: "merchant_mgr",
  salesStaffCodes: [],
  password: "",
};

export default function Admins() {
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();
  const { data, isLoading, isFetching, refetch } = trpc.adminUser.list.useQuery({ page, pageSize: 20 });
  const { data: salesStaff = [] } = trpc.salesStaff.list.useQuery({ includeInactive: true });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const createMutation = trpc.adminUser.create.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
      utils.salesStaff.list.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success("用户创建成功");
    },
    onError: (e) => toast.error(`创建失败：${e.message}`),
  });

  const updateMutation = trpc.adminUser.update.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
      utils.salesStaff.list.invalidate();
      setDialogOpen(false);
      setEditingId(null);
      toast.success("用户信息已更新");
    },
    onError: (e) => toast.error(`更新失败：${e.message}`),
  });

  const toggleMutation = trpc.adminUser.toggleStatus.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
      utils.salesStaff.list.invalidate();
      toast.success("状态已更新");
    },
    onError: (e) => toast.error(`操作失败：${e.message}`),
  });

  const removeMutation = trpc.adminUser.remove.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
      utils.salesStaff.list.invalidate();
      toast.success("用户已删除");
    },
    onError: (e) => toast.error(`删除失败：${e.message}`),
  });

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(a: NonNullable<typeof data>["data"][0]) {
    setEditingId(a.id);
    setForm({
      username: a.username,
      displayName: a.displayName ?? "",
      email: a.email ?? "",
      phone: a.phone ?? "",
      adminRole: a.adminRole === "super_admin" ? "super_admin" : "merchant_mgr",
      salesStaffCodes: (a.salesStaffCodes ?? []).filter(code => code !== a.ownSalesStaffCode),
      password: "",
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.username.trim()) {
      toast.error("用户名不能为空");
      return;
    }
    if (editingId === null && form.password.length < 8) {
      toast.error("初始密码至少 8 位");
      return;
    }
    if (editingId !== null && form.password && form.password.length < 8) {
      toast.error("重置密码至少 8 位");
      return;
    }
    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      adminRole: form.adminRole,
      salesStaffCodes: form.adminRole === "super_admin" ? [] : form.salesStaffCodes,
    };
    if (editingId !== null) {
      updateMutation.mutate({
        id: editingId,
        ...payload,
        ...(form.password ? { password: form.password } : {}),
      });
    } else {
      createMutation.mutate({ ...payload, password: form.password });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout>
      <PageHeader
        title="用户管理"
        description="普通用户创建后自动生成销售身份并默认绑定本人；可追加其他普通用户形成主管范围"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              新建用户
            </Button>
          </div>
        }
      />

      {/* 用户列表 */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">用户账户列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="暂无用户账户，点击右上角「新建用户」添加第一个用户。" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>用户名</th>
                      <th>显示名称</th>
                      <th>角色权限</th>
                      <th>销售权限</th>
                      <th>手机号</th>
                      <th>邮箱</th>
                      <th>状态</th>
                      <th>最近登录</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(a => (
                      <tr key={a.id}>
                        <td className="font-mono text-xs font-medium">{a.username}</td>
                        <td>{a.displayName ?? <span className="text-muted-foreground">-</span>}</td>
                        <td>
                          <StatusBadge
                            label={a.adminRole === "super_admin" ? "超级管理员" : "普通用户"}
                            style={a.adminRole === "super_admin" ? "danger" : "info"}
                          />
                        </td>
                        <td className="max-w-[170px] whitespace-nowrap text-xs">
                          {a.adminRole === "super_admin" ? (
                            <span className="font-medium text-primary">全部销售范围</span>
                          ) : a.salesStaffCodes.length > 0 ? (
                            (() => {
                              const salesScopeNames = a.salesStaffCodes.map(code =>
                                salesStaff.find(staff => staff.staffCode === code)?.displayName ?? code,
                              );
                              const fullSalesScope = salesScopeNames.join("、");
                              const summary = salesScopeNames.length === 1
                                ? salesScopeNames[0]
                                : `${salesScopeNames[0]}等${salesScopeNames.length}人`;
                              return (
                                <span
                                  className="inline-block max-w-[150px] truncate align-middle"
                                  title={fullSalesScope}
                                  aria-label={`销售权限：${fullSalesScope}`}
                                >
                                  {summary}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-destructive">未配置</span>
                          )}
                        </td>
                        <td className="text-xs">{a.phone ?? <span className="text-muted-foreground">-</span>}</td>
                        <td className="text-xs">{a.email ?? <span className="text-muted-foreground">-</span>}</td>
                        <td>
                          <StatusBadge
                            label={a.status === "active" ? "启用" : a.status === "locked" ? "锁定" : "停用"}
                            style={a.status === "active" ? "success" : a.status === "locked" ? "warning" : "gray"}
                          />
                        </td>
                        <td className="text-xs text-muted-foreground">{formatDateTime(a.lastLoginAt)}</td>
                        <td className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => openEdit(a)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleMutation.mutate({ id: a.id, status: a.status === "active" ? "disabled" : "active" })}
                            >
                              {a.status === "active" ? "停用" : "启用"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(`确认删除用户「${a.username}」？此操作不可撤销。`)) {
                                  removeMutation.mutate({ id: a.id });
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      {/* 新建/编辑用户弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "编辑用户" : "新建用户"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>用户名 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="登录用户名（唯一）"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                disabled={editingId !== null}
              />
              {editingId !== null && (
                <p className="text-xs text-muted-foreground">用户名创建后不可修改</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>显示名称</Label>
              <Input
                placeholder="姓名或昵称"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>角色权限 <span className="text-destructive">*</span></Label>
              <Select
                value={form.adminRole}
                onValueChange={v => setForm(f => ({
                  ...f,
                  adminRole: v as AdminRole,
                  salesStaffCodes: v === "super_admin" ? [] : f.salesStaffCodes,
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className="font-medium">{r.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">— {r.duties.slice(0, 18)}…</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>销售权限</Label>
              {form.adminRole === "super_admin" ? (
                <Button type="button" variant="outline" className="w-full justify-between" disabled>
                  全部销售范围
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between font-normal">
                      <span className="truncate">
                        {form.salesStaffCodes.length === 0
                          ? "默认仅本人；可追加其他普通用户"
                          : form.salesStaffCodes.map(code =>
                            salesStaff.find(staff => staff.staffCode === code)?.displayName ?? code,
                          ).join("、")}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]" align="start">
                    <DropdownMenuLabel>新用户自动绑定本人；勾选其他用户可形成主管范围</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {salesStaff.filter(staff =>
                      staff.status === "active"
                      && staff.adminUserId !== null
                      && staff.staffCode !== data?.data.find(user => user.id === editingId)?.ownSalesStaffCode,
                    ).map(staff => (
                      <DropdownMenuCheckboxItem
                        key={staff.staffCode}
                        checked={form.salesStaffCodes.includes(staff.staffCode)}
                        onSelect={event => event.preventDefault()}
                        onCheckedChange={checked => setForm(current => ({
                          ...current,
                          salesStaffCodes: checked
                            ? Array.from(new Set([...current.salesStaffCodes, staff.staffCode]))
                            : current.salesStaffCodes.filter(code => code !== staff.staffCode),
                        }))}
                      >
                        {staff.displayName}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <p className="text-xs text-muted-foreground">
                普通用户创建后自动生成销售身份并默认绑定本人；追加其他普通用户后，可查看这些销售范围的商户与关联订单。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>手机号</Label>
              <Input
                placeholder="绑定手机号（可选）"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>邮箱</Label>
              <Input
                type="email"
                placeholder="绑定邮箱（可选）"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {editingId !== null ? "重置密码" : <>初始密码 <span className="text-destructive">*</span></>}
              </Label>
              <Input
                type="password"
                placeholder={editingId !== null ? "留空则不修改密码" : "登录密码（至少 8 位）"}
                value={form.password}
                autoComplete="new-password"
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
              {editingId !== null && (
                <p className="text-xs text-muted-foreground">填写后将重置该账号的登录密码</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? "保存中..." : editingId !== null ? "保存修改" : "创建用户"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
