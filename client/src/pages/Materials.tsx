import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateTime,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const lifecycleMap: Record<string, { label: string; style: "success" | "warning" | "danger" | "gray" }> = {
  active: { label: "量产", style: "success" },
  nrnd: { label: "不推荐新设计", style: "warning" },
  eol: { label: "停产通知", style: "danger" },
  obsolete: { label: "已停产", style: "gray" },
};

const rohsMap: Record<string, { label: string; style: "success" | "danger" | "gray" }> = {
  compliant: { label: "RoHS", style: "success" },
  non_compliant: { label: "非RoHS", style: "danger" },
  unknown: { label: "未知", style: "gray" },
};

const statusMap: Record<string, { label: string; style: "success" | "gray" }> = {
  enabled: { label: "启用", style: "success" },
  disabled: { label: "停用", style: "gray" },
};

type MaterialForm = {
  id?: number;
  partNumber: string;
  name: string;
  brand: string;
  category: string;
  package: string;
  description: string;
  referencePrice: string;
  unit: string;
  rohs: "compliant" | "non_compliant" | "unknown";
  lifecycle: "active" | "nrnd" | "eol" | "obsolete";
  datasheetUrl: string;
};

const emptyForm: MaterialForm = {
  partNumber: "",
  name: "",
  brand: "",
  category: "",
  package: "",
  description: "",
  referencePrice: "",
  unit: "个",
  rohs: "unknown",
  lifecycle: "active",
  datasheetUrl: "",
};

function MaterialDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: MaterialForm;
}) {
  const [form, setForm] = useState<MaterialForm>(initial);
  const utils = trpc.useUtils();
  const isEdit = !!initial.id;

  // 当 initial 变化时重置表单（依赖 key 重挂载实现，见调用处）
  const createMutation = trpc.material.create.useMutation({
    onSuccess: () => {
      toast.success("物料已创建");
      utils.material.invalidate();
      onOpenChange(false);
    },
    onError: err => toast.error(`创建失败：${err.message}`),
  });
  const updateMutation = trpc.material.update.useMutation({
    onSuccess: () => {
      toast.success("物料已更新");
      utils.material.invalidate();
      onOpenChange(false);
    },
    onError: err => toast.error(`更新失败：${err.message}`),
  });

  const submit = () => {
    if (!form.partNumber.trim() || !form.name.trim()) {
      toast.error("型号与名称为必填项");
      return;
    }
    const payload = {
      partNumber: form.partNumber.trim(),
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      category: form.category.trim() || undefined,
      package: form.package.trim() || undefined,
      description: form.description.trim() || undefined,
      referencePrice: form.referencePrice.trim() || undefined,
      unit: form.unit.trim() || undefined,
      rohs: form.rohs,
      lifecycle: form.lifecycle,
      datasheetUrl: form.datasheetUrl.trim() || undefined,
    };
    if (isEdit && form.id) {
      updateMutation.mutate({ id: form.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑物料" : "新增物料"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>元器件型号 *</Label>
            <Input
              value={form.partNumber}
              onChange={e => setForm(f => ({ ...f, partNumber: e.target.value }))}
              placeholder="如 STM32F103C8T6"
            />
          </div>
          <div className="space-y-1.5">
            <Label>物料名称 *</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="如 32位微控制器"
            />
          </div>
          <div className="space-y-1.5">
            <Label>品牌/制造商</Label>
            <Input
              value={form.brand}
              onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
              placeholder="如 ST / TI / Murata"
            />
          </div>
          <div className="space-y-1.5">
            <Label>分类</Label>
            <Input
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="如 微控制器 / 存储器 / 电容"
            />
          </div>
          <div className="space-y-1.5">
            <Label>封装</Label>
            <Input
              value={form.package}
              onChange={e => setForm(f => ({ ...f, package: e.target.value }))}
              placeholder="如 LQFP48 / SOP8 / 0402"
            />
          </div>
          <div className="space-y-1.5">
            <Label>参考单价（元）</Label>
            <Input
              value={form.referencePrice}
              onChange={e => setForm(f => ({ ...f, referencePrice: e.target.value }))}
              placeholder="如 8.50"
            />
          </div>
          <div className="space-y-1.5">
            <Label>单位</Label>
            <Input
              value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
              placeholder="片 / 颗 / 只 / 个"
            />
          </div>
          <div className="space-y-1.5">
            <Label>RoHS 状态</Label>
            <Select value={form.rohs} onValueChange={v => setForm(f => ({ ...f, rohs: v as MaterialForm["rohs"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="compliant">RoHS 合规</SelectItem>
                <SelectItem value="non_compliant">非 RoHS</SelectItem>
                <SelectItem value="unknown">未知</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>生命周期</Label>
            <Select value={form.lifecycle} onValueChange={v => setForm(f => ({ ...f, lifecycle: v as MaterialForm["lifecycle"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">量产</SelectItem>
                <SelectItem value="nrnd">不推荐新设计</SelectItem>
                <SelectItem value="eol">停产通知</SelectItem>
                <SelectItem value="obsolete">已停产</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>数据手册链接</Label>
            <Input
              value={form.datasheetUrl}
              onChange={e => setForm(f => ({ ...f, datasheetUrl: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>参数描述</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="主要参数、电气特性、应用场景等"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "提交中..." : isEdit ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Materials() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [lifecycle, setLifecycle] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitial, setDialogInitial] = useState<MaterialForm>(emptyForm);
  const [dialogKey, setDialogKey] = useState(0);

  const utils = trpc.useUtils();
  const { data, isLoading, isError, error, refetch } = trpc.material.list.useQuery({
    page,
    pageSize: 20,
    search: search || undefined,
    category: category === "all" ? undefined : category,
    lifecycle: lifecycle === "all" ? undefined : lifecycle,
  });
  const { data: categories } = trpc.material.categories.useQuery();

  const toggleMutation = trpc.material.toggleStatus.useMutation({
    onSuccess: () => {
      toast.success("状态已更新");
      utils.material.invalidate();
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });
  const removeMutation = trpc.material.remove.useMutation({
    onSuccess: () => {
      toast.success("物料已删除");
      utils.material.invalidate();
    },
    onError: err => toast.error(`删除失败：${err.message}`),
  });

  const doSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const openCreate = () => {
    setDialogInitial(emptyForm);
    setDialogKey(k => k + 1);
    setDialogOpen(true);
  };

  const openEdit = (m: NonNullable<typeof data>["data"][number]) => {
    setDialogInitial({
      id: m.id,
      partNumber: m.partNumber,
      name: m.name,
      brand: m.brand ?? "",
      category: m.category ?? "",
      package: m.package ?? "",
      description: m.description ?? "",
      referencePrice: m.referencePrice ?? "",
      unit: m.unit ?? "个",
      rohs: m.rohs,
      lifecycle: m.lifecycle,
      datasheetUrl: m.datasheetUrl ?? "",
    });
    setDialogKey(k => k + 1);
    setDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <PageHeader
        title="物料数据库"
        description="电子元器件物料主数据管理：型号、品牌、封装、参数与生命周期"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> 新增物料
          </Button>
        }
      />

      {/* 筛选栏 */}
      <div className="bg-white rounded-xl border border-border p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <Input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            placeholder="搜索型号 / 名称 / 物料编号 / 品牌"
            className="max-w-sm"
          />
          <Button variant="outline" onClick={doSearch}>
            <Search className="h-4 w-4 mr-1" /> 搜索
          </Button>
        </div>
        <Select value={category} onValueChange={v => { setCategory(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="全部分类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {(categories ?? []).map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={lifecycle} onValueChange={v => { setLifecycle(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="全部生命周期" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部生命周期</SelectItem>
            <SelectItem value="active">量产</SelectItem>
            <SelectItem value="nrnd">不推荐新设计</SelectItem>
            <SelectItem value="eol">停产通知</SelectItem>
            <SelectItem value="obsolete">已停产</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-red-600">数据加载失败：{error?.message ?? "未知错误"}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>
          </div>
        ) : !data || data.data.length === 0 ? (
          <EmptyState message="暂无物料数据，点击右上角新增物料" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>物料编号</TableHead>
                  <TableHead>型号 / 名称</TableHead>
                  <TableHead>品牌</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>封装</TableHead>
                  <TableHead>参考单价</TableHead>
                  <TableHead>RoHS</TableHead>
                  <TableHead>生命周期</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.materialNo}</TableCell>
                    <TableCell>
                      <div className="font-medium flex items-center gap-1.5">
                        {m.partNumber}
                        {m.datasheetUrl && (
                          <a
                            href={m.datasheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:opacity-70"
                            title="查看数据手册"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.name}</div>
                    </TableCell>
                    <TableCell>{m.brand ?? "-"}</TableCell>
                    <TableCell>{m.category ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{m.package ?? "-"}</TableCell>
                    <TableCell>
                      {m.referencePrice ? `¥${m.referencePrice}${m.unit ? ` / ${m.unit}` : ""}` : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={(rohsMap[m.rohs] ?? rohsMap.unknown).label} style={(rohsMap[m.rohs] ?? rohsMap.unknown).style} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={(lifecycleMap[m.lifecycle] ?? lifecycleMap.active).label} style={(lifecycleMap[m.lifecycle] ?? lifecycleMap.active).style} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={(statusMap[m.status] ?? statusMap.enabled).label} style={(statusMap[m.status] ?? statusMap.enabled).style} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(m.updatedAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openEdit(m)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleMutation.mutate({ id: m.id, status: m.status === "enabled" ? "disabled" : "enabled" })}
                        >
                          {m.status === "enabled" ? "停用" : "启用"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (window.confirm(`确认删除物料 ${m.partNumber}（${m.materialNo}）？此操作不可恢复。`)) {
                              removeMutation.mutate({ id: m.id });
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 py-3 border-t border-border">
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>

      <MaterialDialog key={dialogKey} open={dialogOpen} onOpenChange={setDialogOpen} initial={dialogInitial} />
    </DashboardLayout>
  );
}
