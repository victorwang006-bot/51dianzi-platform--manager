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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type AdminRole =
  | "super_admin"
  | "operation"
  | "merchant_mgr"
  | "customer_svc"
  | "risk_control"
  | "finance"
  | "auditor";

const roleOptions: { value: AdminRole; label: string; duties: string }[] = [
  { value: "super_admin", label: "超级管理员", duties: "全部权限，管理管理员账号与角色分配" },
  { value: "operation", label: "平台运营", duties: "数据看板、商品治理、订单处置、告警处理" },
  { value: "merchant_mgr", label: "商户管理", duties: "商户入驻审核、资质管理、协议与结算账户配置" },
  { value: "customer_svc", label: "客服/售后", duties: "订单查询、退款申请审核、异常标注" },
  { value: "risk_control", label: "风控审核", duties: "智能风控分析、风险处置、可疑行为审查" },
  { value: "finance", label: "财务结算", duties: "支付流水查询、结算单生成与打款、对账" },
  { value: "auditor", label: "审计人员", duties: "操作日志与敏感数据访问记录查阅（只读）" },
];

const roleStyleMap: Record<AdminRole, "danger" | "info" | "warning" | "success" | "gray"> = {
  super_admin: "danger",
  operation: "info",
  merchant_mgr: "info",
  customer_svc: "info",
  risk_control: "warning",
  finance: "success",
  auditor: "gray",
};

type FormState = {
  username: string;
  displayName: string;
  email: string;
  phone: string;
  adminRole: AdminRole;
};

const emptyForm: FormState = {
  username: "",
  displayName: "",
  email: "",
  phone: "",
  adminRole: "operation",
};

export default function Admins() {
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.adminUser.list.useQuery({ page, pageSize: 20 });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const createMutation = trpc.adminUser.create.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success("用户创建成功");
    },
    onError: (e) => toast.error(`创建失败：${e.message}`),
  });

  const updateMutation = trpc.adminUser.update.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
      setDialogOpen(false);
      setEditingId(null);
      toast.success("用户信息已更新");
    },
    onError: (e) => toast.error(`更新失败：${e.message}`),
  });

  const toggleMutation = trpc.adminUser.toggleStatus.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
      toast.success("状态已更新");
    },
    onError: (e) => toast.error(`操作失败：${e.message}`),
  });

  const removeMutation = trpc.adminUser.remove.useMutation({
    onSuccess: () => {
      utils.adminUser.list.invalidate();
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
      adminRole: a.adminRole as AdminRole,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.username.trim()) {
      toast.error("用户名不能为空");
      return;
    }
    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      adminRole: form.adminRole,
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout>
      <PageHeader
        title="用户管理"
        description="管理后台系统用户，支持角色权限分配、手机号与邮箱绑定"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            新建用户
          </Button>
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
                            label={roleOptions.find(r => r.value === a.adminRole)?.label ?? a.adminRole}
                            style={roleStyleMap[a.adminRole as AdminRole] ?? "info"}
                          />
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
                onValueChange={v => setForm(f => ({ ...f, adminRole: v as AdminRole }))}
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
