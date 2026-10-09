import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTimeWithSeconds } from "@shared/beijingTime";
import { BadgeCheck, Eye, FileUp, Loader2, Pencil, RotateCcw, ShieldX, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
type AcceptedMimeType = typeof ACCEPTED_MIME_TYPES[number];
type AgencyCertification = {
  id: number;
  brands: string[];
  fileName: string;
  status: "active" | "cancelled";
  revision: number;
  updatedAt: string | Date;
};
type Draft = {
  id: number | null;
  revision: number | null;
  brandsText: string;
  existingFileName: string | null;
  file: File | null;
};

/** 与后端相同的 NFKC、分隔符与大小写去重规则；括号内容不会被拆分。 */
export function normalizeAgencyCertificationBrands(value: string) {
  const brands: string[] = [];
  const seen = new Set<string>();
  for (const part of value.normalize("NFKC").split(/[,;、\n\r]+/)) {
    const brand = part.trim();
    if (!brand) continue;
    const key = brand.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    brands.push(brand);
  }
  return brands;
}

function fileSizeLabel(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MiB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.onerror = () => reject(reader.error || new Error("代理证读取失败"));
    reader.readAsDataURL(file);
  });
}

function isAcceptedFile(file: File): file is File & { type: AcceptedMimeType } {
  return ACCEPTED_MIME_TYPES.includes(file.type as AcceptedMimeType);
}

function requestId() {
  return crypto.randomUUID();
}

export default function AgencyCertificationTab({
  merchantId,
  canWrite,
}: {
  merchantId: number;
  canWrite: boolean;
}) {
  const utils = trpc.useUtils();
  const certificationsQuery = trpc.merchant.agencyCertifications.useQuery({ merchantId });
  const saveMutation = trpc.merchant.saveAgencyCertification.useMutation();
  const cancelMutation = trpc.merchant.cancelAgencyCertification.useMutation();
  const documentMutation = trpc.merchant.agencyCertificationDocument.useMutation();
  const savingLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const cancelRequestIds = useRef(new Map<number, string>());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = ((certificationsQuery.data as { items?: AgencyCertification[] } | undefined)?.items ?? []);
  const activeItems = items.filter(item => item.status === "active");
  const cancelledItems = items.filter(item => item.status === "cancelled");

  const refresh = async () => {
    await utils.merchant.agencyCertifications.invalidate({ merchantId });
  };

  const beginNew = () => {
    setSaveRequestId(null);
    setDraft({ id: null, revision: null, brandsText: "", existingFileName: null, file: null });
  };

  const beginEdit = (item: AgencyCertification) => {
    setSaveRequestId(null);
    setDraft({
      id: item.id,
      revision: item.revision,
      brandsText: item.brands.join("、"),
      existingFileName: item.fileName,
      file: null,
    });
  };

  const updateBrands = (brandsText: string) => {
    setSaveRequestId(null);
    setDraft(current => current ? { ...current, brandsText } : current);
  };

  const selectFile = (file: File | undefined) => {
    if (!file || !draft) return;
    if (!isAcceptedFile(file)) {
      toast.error("仅支持 JPG、PNG、WebP 图片或 PDF 代理证");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("代理证不能超过 10MiB");
      return;
    }
    setSaveRequestId(null);
    setDraft(current => current ? { ...current, file } : current);
  };

  const save = async () => {
    if (!draft || saving) return;
    const brands = normalizeAgencyCertificationBrands(draft.brandsText);
    if (brands.length === 0) {
      toast.error("请至少填写一个代理品牌");
      return;
    }
    if (brands.length > 30 || brands.some(brand => brand.length > 80)) {
      toast.error("代理品牌最多 30 项且每项不超过 80 个字符");
      return;
    }
    if (!draft.id && !draft.file) {
      toast.error("新建代理认证必须上传代理证");
      return;
    }
    if (savingLock.current) return;
    savingLock.current = true;
    setSaving(true);
    const stableRequestId = saveRequestId ?? requestId();
    if (!saveRequestId) setSaveRequestId(stableRequestId);
    try {
      const file = draft.file
        ? {
            fileName: draft.file.name,
            mimeType: draft.file.type as AcceptedMimeType,
            base64: await readFileAsBase64(draft.file),
          }
        : undefined;
      await saveMutation.mutateAsync({
        merchantId,
        ...(draft.id ? { id: draft.id, expectedRevision: draft.revision ?? undefined } : {}),
        brands,
        file,
        requestId: stableRequestId,
      });
      toast.success(draft.id ? "代理认证已更新并立即生效" : "代理认证已保存并立即生效");
      setDraft(null);
      setSaveRequestId(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "代理认证保存失败，请重试");
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };

  const cancel = async (item: AgencyCertification) => {
    if (cancelMutation.isPending) return;
    const stableRequestId = cancelRequestIds.current.get(item.id) ?? requestId();
    cancelRequestIds.current.set(item.id, stableRequestId);
    try {
      await cancelMutation.mutateAsync({
        merchantId,
        id: item.id,
        expectedRevision: item.revision,
        requestId: stableRequestId,
      });
      cancelRequestIds.current.delete(item.id);
      toast.success("代理认证已取消");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消代理认证失败，请重试");
    }
  };

  const viewDocument = async (item: AgencyCertification) => {
    if (documentMutation.isPending) return;
    const preview = window.open("about:blank", "_blank");
    if (!preview) {
      toast.error("浏览器阻止了证件预览窗口，请允许弹窗后重试");
      return;
    }
    preview.opener = null;
    try {
      const result = await documentMutation.mutateAsync({ merchantId, id: item.id });
      preview.location.replace(result.url);
    } catch (error) {
      preview.close();
      toast.error(error instanceof Error ? error.message : "代理证暂时无法查看");
    }
  };

  return (
    <div className="space-y-3" data-agency-certification-tab>
      <section className="overflow-hidden rounded-lg border bg-white text-[13px]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><BadgeCheck className="h-4 w-4 text-primary" />代理认证</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">保存立即生效，无需审核。原件私有存储，仅可在此按需安全查看。</p>
          </div>
          {canWrite && !draft ? <Button type="button" size="sm" className="h-8 text-xs" onClick={beginNew}>新增代理认证</Button> : null}
        </div>

        {draft ? (
          <div className="space-y-4 p-4" data-agency-certification-editor>
            <div className="space-y-2">
              <Label htmlFor="agency-brands">代理品牌</Label>
              <Textarea
                id="agency-brands"
                value={draft.brandsText}
                disabled={saving}
                maxLength={2_560}
                className="min-h-24 text-sm"
                placeholder="例如：ST(意法半导体)、TI；NXP\n支持逗号、中文逗号、分号或换行分隔"
                onChange={event => updateBrands(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">最多 30 项，每项最多 80 个字符；会自动去除空白与重复项。</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agency-document">代理证{draft.id ? "（可更换）" : ""}</Label>
              <Input
                ref={fileInputRef}
                id="agency-document"
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                disabled={saving}
                onChange={event => selectFile(event.target.files?.[0])}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                  <FileUp className="mr-1 h-3.5 w-3.5" />{draft.file ? "更换已选文件" : draft.id ? "更换代理证" : "上传代理证"}
                </Button>
                {draft.file ? (
                  <span className="inline-flex min-w-0 items-center gap-1 text-xs text-foreground">
                    <span className="max-w-56 truncate">{draft.file.name}</span><span className="text-muted-foreground">{fileSizeLabel(draft.file.size)}</span>
                    <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-destructive" aria-label="移除已选代理证" disabled={saving} onClick={() => { setSaveRequestId(null); setDraft(current => current ? { ...current, file: null } : current); if (fileInputRef.current) fileInputRef.current.value = ""; }}><X className="h-3.5 w-3.5" /></button>
                  </span>
                ) : draft.existingFileName ? <span className="text-xs text-muted-foreground">未选择新文件，将保留原证件：{draft.existingFileName}</span> : null}
              </div>
              <p className="text-[11px] text-muted-foreground">仅支持 JPG、PNG、WebP 或 PDF，单个文件不超过 10MiB。</p>
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button type="button" size="sm" className="h-8 text-xs" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}{saving ? "保存中…" : "保存并生效"}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={saving} onClick={() => { setDraft(null); setSaveRequestId(null); }}>取消</Button>
            </div>
          </div>
        ) : null}

        {certificationsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…</div>
        ) : certificationsQuery.error ? (
          <div className="px-4 py-10 text-center text-muted-foreground"><p>代理认证加载失败</p><Button type="button" variant="link" size="sm" className="mt-1 text-xs" onClick={() => void certificationsQuery.refetch()}>重新加载</Button></div>
        ) : items.length === 0 && !draft ? (
          <div className="py-12 text-center text-muted-foreground">暂无代理认证记录</div>
        ) : (
          <div className="divide-y">
            {activeItems.map(item => (
              <CertificationRow
                key={item.id}
                item={item}
                canWrite={canWrite}
                viewing={documentMutation.isPending}
                cancelling={cancelMutation.isPending}
                onView={() => void viewDocument(item)}
                onEdit={() => beginEdit(item)}
                onCancel={() => void cancel(item)}
              />
            ))}
            {cancelledItems.map(item => (
              <CertificationRow
                key={item.id}
                item={item}
                canWrite={false}
                viewing={documentMutation.isPending}
                cancelling={false}
                onView={() => void viewDocument(item)}
                onEdit={() => undefined}
                onCancel={() => undefined}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CertificationRow({
  item,
  canWrite,
  viewing,
  cancelling,
  onView,
  onEdit,
  onCancel,
}: {
  item: AgencyCertification;
  canWrite: boolean;
  viewing: boolean;
  cancelling: boolean;
  onView: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const active = item.status === "active";
  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3" data-agency-certification-record={item.status}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${active ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{active ? "已认证" : "已取消"}</span>
          <span className="text-xs text-muted-foreground">更新于 {formatBeijingDateTimeWithSeconds(item.updatedAt) || "—"}</span>
        </div>
        <p className="mt-1.5 break-words font-medium">{item.brands.join("、")}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={item.fileName}>证件：{item.fileName}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={viewing} onClick={onView}>
          {viewing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}{viewing ? "获取中…" : "查看"}
        </Button>
        {canWrite && active ? <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={cancelling} onClick={onEdit}><Pencil className="mr-1 h-3.5 w-3.5" />编辑</Button> : null}
        {canWrite && active ? <Button type="button" variant="outline" size="sm" className="h-8 border-amber-200 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800" disabled={cancelling} onClick={onCancel}>{cancelling ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldX className="mr-1 h-3.5 w-3.5" />}{cancelling ? "取消中…" : "取消认证"}</Button> : null}
        {!active ? <span className="inline-flex h-8 items-center px-1 text-[11px] text-muted-foreground"><RotateCcw className="mr-1 h-3.5 w-3.5" />历史记录</span> : null}
      </div>
    </div>
  );
}
