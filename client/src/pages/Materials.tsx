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
import { ExternalLink, FileText, ImagePlus, Loader2, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
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
  specs: Record<string, string>;
  datasheetFileKey: string | null;
  datasheetFileName: string | null;
  datasheetFileSize: number | null;
  coverImageUrl: string | null;
  images: { url: string; key: string; name?: string }[];
};

/** 读取文件为 base64（不含 data: 前缀） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 将 specs JSON 渲染为紧凑的键值标签列表 */
function SpecsPreview({ specs }: { specs?: Record<string, string> | null }) {
  if (!specs || Object.keys(specs).length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  // 优先展示核心参数，最多显示 4 项
  const priority = ["CPU内核", "最大主频", "Flash容量", "RAM容量", "工作电压", "工作温度", "CPU位数"];
  const entries = [
    ...priority.filter(k => specs[k]).map(k => [k, specs[k]] as [string, string]),
    ...Object.entries(specs).filter(([k]) => !priority.includes(k)),
  ].slice(0, 4);
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([k, v]) => (
        <span key={k} className="text-xs">
          <span className="text-muted-foreground">{k}：</span>
          <span className="font-mono">{v}</span>
        </span>
      ))}
    </div>
  );
}

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
  specs: {},
  datasheetFileKey: null,
  datasheetFileName: null,
  datasheetFileSize: null,
  coverImageUrl: null,
  images: [],
};

/** 结构化参数（specs）键值对编辑器 */
function SpecsEditor({
  specs,
  onChange,
}: {
  specs: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const entries = Object.entries(specs);

  const addEntry = () => {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k || !v) { toast.error("参数名与参数值均不能为空"); return; }
    if (specs[k] !== undefined) { toast.error(`参数「${k}」已存在`); return; }
    onChange({ ...specs, [k]: v });
    setNewKey("");
    setNewValue("");
  };

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <Input
                value={k}
                readOnly
                className="w-36 shrink-0 bg-muted/50 text-xs h-8"
              />
              <Input
                value={v}
                onChange={e => onChange({ ...specs, [k]: e.target.value })}
                className="flex-1 text-xs h-8 font-mono"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                onClick={() => {
                  const next = { ...specs };
                  delete next[k];
                  onChange(next);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="参数名，如 工作电压"
          className="w-36 shrink-0 text-xs h-8"
        />
        <Input
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addEntry())}
          placeholder="参数值，如 1.8V~3.6V"
          className="flex-1 text-xs h-8"
        />
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={addEntry}>
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加
        </Button>
      </div>
    </div>
  );
}

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
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const uploadDatasheetMutation = trpc.material.uploadDatasheet.useMutation({
    onSuccess: res => {
      setForm(f => ({
        ...f,
        datasheetFileKey: res.key,
        datasheetFileName: res.fileName,
        datasheetFileSize: res.fileSize,
        datasheetUrl: res.url,
      }));
      toast.success("PDF 规格书已上传");
    },
    onError: err => toast.error(`PDF 上传失败：${err.message}`),
  });
  const uploadImageMutation = trpc.material.uploadImage.useMutation({
    onError: err => toast.error(`图片上传失败：${err.message}`),
  });
  const [galleryUploading, setGalleryUploading] = useState(false);

  const handlePdfSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { toast.error("仅支持 PDF 文件"); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error("PDF 文件不能超过 20MB"); return; }
    const base64 = await fileToBase64(file);
    uploadDatasheetMutation.mutate({ fileName: file.name, base64 });
  };

  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("图片不能超过 5MB"); return; }
    const base64 = await fileToBase64(file);
    uploadImageMutation.mutate(
      { fileName: file.name, mimeType: file.type, base64 },
      {
        onSuccess: res => {
          setForm(f => ({ ...f, coverImageUrl: res.url }));
          toast.success("封面图已上传");
        },
      },
    );
  };

  const handleGallerySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    if (form.images.length + files.length > 9) { toast.error("图集最多 9 张"); return; }
    setGalleryUploading(true);
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name} 超过 5MB，已跳过`); continue; }
        const base64 = await fileToBase64(file);
        const res = await uploadImageMutation.mutateAsync({ fileName: file.name, mimeType: file.type, base64 });
        setForm(f => ({ ...f, images: [...f.images, { url: res.url, key: res.key, name: file.name }] }));
      }
      toast.success("图片已上传");
    } finally {
      setGalleryUploading(false);
    }
  };

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
      specs: form.specs,
      datasheetFileKey: form.datasheetFileKey,
      datasheetFileName: form.datasheetFileName,
      datasheetFileSize: form.datasheetFileSize,
      coverImageUrl: form.coverImageUrl,
      images: form.images,
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

          {/* 结构化参数 */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>规格参数（前台搜索可按参数筛选）</Label>
            <SpecsEditor specs={form.specs} onChange={specs => setForm(f => ({ ...f, specs }))} />
          </div>

          {/* PDF 规格书上传 */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>PDF 规格书（上传至平台存储，前台可直接调用）</Label>
            <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handlePdfSelect} />
            {form.datasheetFileKey ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <FileText className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-sm truncate flex-1">
                  {form.datasheetUrl ? (
                    <a
                      href={form.datasheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                      title="点击在新标签页预览 PDF"
                    >
                      {form.datasheetFileName ?? "规格书.pdf"}
                    </a>
                  ) : (
                    form.datasheetFileName ?? "规格书.pdf"
                  )}
                  {form.datasheetFileSize ? (
                    <span className="text-xs text-muted-foreground ml-2">{formatFileSize(form.datasheetFileSize)}</span>
                  ) : null}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => pdfInputRef.current?.click()} disabled={uploadDatasheetMutation.isPending}>
                  替换
                </Button>
                <Button
                  type="button" size="sm" variant="ghost"
                  className="text-muted-foreground hover:text-red-600"
                  onClick={() => setForm(f => ({ ...f, datasheetFileKey: null, datasheetFileName: null, datasheetFileSize: null, datasheetUrl: "" }))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                type="button" variant="outline" className="w-full border-dashed"
                onClick={() => pdfInputRef.current?.click()}
                disabled={uploadDatasheetMutation.isPending}
              >
                {uploadDatasheetMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> 上传中...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-1.5" /> 点击上传 PDF 规格书（≤20MB）</>
                )}
              </Button>
            )}
          </div>

          {/* 封面图 + 图集 */}
          <div className="space-y-1.5">
            <Label>封面图（列表与前台搜索缩略图）</Label>
            <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleCoverSelect} />
            {form.coverImageUrl ? (
              <div className="relative w-24 h-24 rounded-lg border border-border overflow-hidden group">
                <img src={form.coverImageUrl} alt="封面图" className="w-full h-full object-contain bg-white" />
                <button
                  type="button"
                  className="absolute top-1 right-1 rounded-full bg-black/60 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setForm(f => ({ ...f, coverImageUrl: null }))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button" variant="outline"
                className="w-24 h-24 border-dashed flex-col gap-1 text-xs text-muted-foreground"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadImageMutation.isPending}
              >
                <ImagePlus className="h-5 w-5" />
                上传封面
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>产品图集（前台详情页展示，最多 9 张）</Label>
            <input ref={galleryInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={handleGallerySelect} />
            <div className="flex flex-wrap gap-2">
              {form.images.map((img, idx) => (
                <div key={img.key} className="relative w-16 h-16 rounded-lg border border-border overflow-hidden group">
                  <img src={img.url} alt={img.name ?? `图${idx + 1}`} className="w-full h-full object-contain bg-white" />
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/60 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setForm(f => ({ ...f, images: f.images.filter(i => i.key !== img.key) }))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {form.images.length < 9 && (
                <Button
                  type="button" variant="outline"
                  className="w-16 h-16 border-dashed flex-col gap-0.5 text-[10px] text-muted-foreground"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={galleryUploading}
                >
                  {galleryUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {galleryUploading ? "上传中" : "添加"}
                </Button>
              )}
            </div>
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
      specs: (m.specs as Record<string, string> | null) ?? {},
      datasheetFileKey: m.datasheetFileKey ?? null,
      datasheetFileName: m.datasheetFileName ?? null,
      datasheetFileSize: m.datasheetFileSize ?? null,
      coverImageUrl: m.coverImageUrl ?? null,
      images: (m.images as { url: string; key: string; name?: string }[] | null) ?? [],
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
                  <TableHead>图片</TableHead>
                  <TableHead>型号 / 名称</TableHead>
                  <TableHead>品牌</TableHead>
                  <TableHead>分类 / 封装</TableHead>
                  <TableHead>规格参数</TableHead>
                  <TableHead>规格书</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.materialNo}</TableCell>
                    <TableCell>
                      {m.coverImageUrl ? (
                        <img
                          src={m.coverImageUrl}
                          alt={m.partNumber}
                          className="w-10 h-10 rounded border border-border object-contain bg-white"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground">
                          无图
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{m.partNumber}</div>
                      <div className="text-xs text-muted-foreground">{m.name}</div>
                    </TableCell>
                    <TableCell>{m.brand ?? "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {m.category && <span className="text-xs text-foreground">{m.category}</span>}
                        {m.package && <span className="font-mono text-xs text-muted-foreground">{m.package}</span>}
                        {!m.category && !m.package && <span className="text-xs text-muted-foreground">-</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <SpecsPreview specs={(m as any).specs} />
                    </TableCell>
                    <TableCell>
                      {m.datasheetFileKey && m.datasheetUrl ? (
                        <a
                          href={m.datasheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline hover:opacity-80 font-medium"
                          title={m.datasheetFileName ?? "PDF 规格书"}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-red-600" />
                          PDF
                        </a>
                      ) : m.datasheetUrl ? (
                        <a
                          href={m.datasheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline hover:opacity-80 font-medium"
                          title={m.datasheetUrl}
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          查看
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
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
