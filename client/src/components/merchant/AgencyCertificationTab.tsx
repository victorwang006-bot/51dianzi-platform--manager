import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatBeijingDate, formatBeijingDateTimeWithSeconds } from "@shared/beijingTime";
import { isValidCalendarDate } from "@shared/merchantCreatedAtFilter";
import type { PlatformAgencyCertification as AgencyCertification } from "../../../../server/platformAgencyCertificationApi";
import { BadgeCheck, Eye, FileUp, Loader2, Pencil, ShieldX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
type AcceptedMimeType = typeof ACCEPTED_MIME_TYPES[number];
type Draft = {
  id: number | null;
  revision: number | null;
  brandsText: string;
  existingFileName: string | null;
  file: File | null;
  authorizationIssuer: string;
  validFrom: string;
  validUntil: string;
  supplementalNote: string;
};
type ReviewDraft = { item: AgencyCertification; decision: "approve" | "reject"; reason: string; requestId: string };

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

/** 兼容未返回 effectiveBrands 的旧内部列表，最新已通过/撤销品牌版本阻止回退旧证。 */
export function effectiveAgencyCertificationItems(items: AgencyCertification[], today = formatBeijingDate(new Date())) {
  const latest = new Map<string, number>();
  const brandKey = (brand: string) => brand.normalize("NFKC").trim().toLocaleLowerCase();
  for (const item of [...items].sort((a, b) => b.id - a.id)) {
    if (item.status !== "active" && item.status !== "cancelled") continue;
    for (const brand of item.brands) if (!latest.has(brandKey(brand))) latest.set(brandKey(brand), item.id);
  }
  return items.map(item => ({ ...item, effectiveBrands: item.effectiveBrands ?? (item.status === "active"
    && (!item.validFrom || item.validFrom <= today) && (!item.validUntil || item.validUntil >= today)
    ? item.brands.filter(brand => latest.get(brandKey(brand)) === item.id) : []) }));
}

/** 日期按北京时间自然日判断；active 历史不等于当前仍有效。 */
export function agencyCertificationStatusLabel(item: AgencyCertification, today = formatBeijingDate(new Date())) {
  if (item.status === "pending") return "待审核";
  if (item.status === "rejected") return "已驳回";
  if (item.status === "cancelled") return "已撤销";
  if (item.validUntil && item.validUntil < today) return "已过期";
  if (item.validFrom && item.validFrom > today) return "尚未生效";
  if (item.effectiveBrands?.length === 0) return "已替代";
  return "已通过";
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
function requestId() { return crypto.randomUUID(); }

export default function AgencyCertificationTab({ merchantId, canWrite, identityKey = String(merchantId) }: {
  merchantId: number;
  canWrite: boolean;
  identityKey?: string;
}) {
  const utils = trpc.useUtils();
  const certificationsQuery = trpc.merchant.agencyCertifications.useQuery({ merchantId }, { placeholderData: undefined, staleTime: 0, refetchOnMount: "always" });
  const saveMutation = trpc.merchant.saveAgencyCertification.useMutation();
  const cancelMutation = trpc.merchant.cancelAgencyCertification.useMutation();
  const reviewMutation = trpc.merchant.reviewAgencyCertification.useMutation();
  const documentMutation = trpc.merchant.agencyCertificationDocument.useMutation();
  const savingLock = useRef(false);
  const documentLock = useRef(false);
  const alive = useRef(true);
  const liveIdentity = useRef(identityKey);
  const liveWrite = useRef(canWrite);
  liveIdentity.current = identityKey;
  liveWrite.current = canWrite;
  const previews = useRef(new Set<Window>());
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<ReviewDraft | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AgencyCertification | null>(null);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const cancelRequestIds = useRef(new Map<number, string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    setDraft(null); setReview(null); setCancelTarget(null); setSaveRequestId(null);
    cancelRequestIds.current.clear();
    return () => {
      alive.current = false;
      previews.current.forEach(preview => { try { preview.close(); } catch { /* 已导航窗口可能跨域 */ } });
      previews.current.clear();
    };
  }, [identityKey, canWrite]);
  const current = (identity: string) => alive.current && liveIdentity.current === identity && liveWrite.current;
  const items: AgencyCertification[] = effectiveAgencyCertificationItems(certificationsQuery.data?.items ?? []);
  const busy = saving || saveMutation.isPending || cancelMutation.isPending || reviewMutation.isPending || certificationsQuery.isFetching;
  const refresh = () => utils.merchant.agencyCertifications.invalidate({ merchantId });
  const beginNew = () => {
    if (!canWrite || busy) return;
    setSaveRequestId(null);
    setDraft({ id: null, revision: null, brandsText: "", existingFileName: null, file: null, authorizationIssuer: "", validFrom: "", validUntil: "", supplementalNote: "" });
  };
  const beginEdit = (item: AgencyCertification) => {
    if (!canWrite || busy || item.status !== "active") return;
    setSaveRequestId(null);
    setDraft({ id: item.id, revision: item.revision, brandsText: item.brands.join("、"), existingFileName: item.fileName, file: null,
      authorizationIssuer: item.authorizationIssuer ?? "", validFrom: item.validFrom ?? "", validUntil: item.validUntil ?? "", supplementalNote: item.supplementalNote ?? "" });
  };
  const updateDraft = (patch: Partial<Draft>) => {
    setSaveRequestId(null);
    setDraft(value => value ? { ...value, ...patch } : value);
  };
  const selectFile = (file: File | undefined) => {
    if (!file || !draft || !canWrite || busy) return;
    if (!isAcceptedFile(file)) { toast.error("仅支持 JPG、PNG、WebP 图片或 PDF 代理证"); return; }
    if (file.size > MAX_FILE_BYTES) { toast.error("代理证不能超过 10MiB"); return; }
    updateDraft({ file });
  };
  const save = async () => {
    if (!canWrite || !draft || busy || savingLock.current) return;
    const brands = normalizeAgencyCertificationBrands(draft.brandsText);
    if (!brands.length) { toast.error("请至少填写一个代理品牌"); return; }
    if (brands.length > 30 || brands.some(brand => brand.length > 80)) { toast.error("代理品牌最多 30 项且每项不超过 80 个字符"); return; }
    if (!draft.id && !draft.file) { toast.error("新建代理认证必须上传代理证"); return; }
    if ((draft.validFrom && !isValidCalendarDate(draft.validFrom)) || (draft.validUntil && !isValidCalendarDate(draft.validUntil))
      || (draft.validFrom && draft.validUntil && draft.validFrom > draft.validUntil)) { toast.error("请核对证书有效期"); return; }
    savingLock.current = true; setSaving(true);
    const identity = identityKey;
    const stableRequestId = saveRequestId ?? requestId();
    setSaveRequestId(stableRequestId);
    try {
      const file = draft.file ? { fileName: draft.file.name, mimeType: draft.file.type as AcceptedMimeType, base64: await readFileAsBase64(draft.file) } : undefined;
      if (!current(identity)) return;
      const result = await saveMutation.mutateAsync({ merchantId, ...(draft.id ? { id: draft.id, expectedRevision: draft.revision ?? undefined } : {}),
        brands, file, authorizationIssuer: draft.authorizationIssuer || null, validFrom: draft.validFrom || null, validUntil: draft.validUntil || null,
        supplementalNote: draft.supplementalNote || null, requestId: stableRequestId });
      if (!current(identity)) return;
      toast.success(draft.id && result.id !== draft.id ? "人工认定新版本已生效，旧记录保留" : "后台人工认定已保存并生效");
      setDraft(null); setSaveRequestId(null); await refresh();
    } catch (error) {
      if (current(identity)) toast.error(error instanceof Error ? error.message : "代理认证保存失败，请重试");
    } finally {
      savingLock.current = false;
      if (current(identity)) setSaving(false);
    }
  };
  const reviewStale = Boolean(review && !items.some(item => item.id === review.item.id && item.revision === review.item.revision && item.status === "pending"));
  const cancelStale = Boolean(cancelTarget && !items.some(item => item.id === cancelTarget.id && item.revision === cancelTarget.revision && item.status === "active"));
  const submitReview = async () => {
    if (!canWrite || !review || reviewStale || busy || savingLock.current) return;
    if (review.decision === "reject" && !review.reason.trim()) { toast.error("驳回原因不能为空"); return; }
    const identity = identityKey;
    savingLock.current = true; setSaving(true);
    try {
      await reviewMutation.mutateAsync({ merchantId, id: review.item.id, expectedRevision: review.item.revision, decision: review.decision, reviewReason: review.reason.trim(), requestId: review.requestId });
      if (!current(identity)) return;
      toast.success(review.decision === "approve" ? "申请已通过人工审核" : "申请已驳回");
      setReview(null); await refresh();
    } catch (error) {
      if (current(identity)) toast.error(error instanceof Error ? error.message : "审核失败，请重试");
    } finally { savingLock.current = false; if (current(identity)) setSaving(false); }
  };
  const cancel = async () => {
    if (!canWrite || !cancelTarget || cancelStale || busy || savingLock.current) return;
    const item = cancelTarget;
    const identity = identityKey;
    const stableRequestId = cancelRequestIds.current.get(item.id) ?? requestId();
    cancelRequestIds.current.set(item.id, stableRequestId);
    savingLock.current = true; setSaving(true);
    try {
      await cancelMutation.mutateAsync({ merchantId, id: item.id, expectedRevision: item.revision, requestId: stableRequestId });
      if (!current(identity)) return;
      cancelRequestIds.current.delete(item.id); setCancelTarget(null);
      toast.success("代理认证已撤销，原件与历史保留"); await refresh();
    } catch (error) {
      if (current(identity)) toast.error(error instanceof Error ? error.message : "撤销失败，请重试");
    } finally { savingLock.current = false; if (current(identity)) setSaving(false); }
  };
  const viewDocument = async (item: AgencyCertification) => {
    if (!canWrite || documentMutation.isPending || documentLock.current) return;
    const identity = identityKey;
    const preview = window.open("about:blank", "_blank");
    if (!preview) { toast.error("浏览器阻止了证件预览窗口，请允许弹窗后重试"); return; }
    preview.opener = null; previews.current.add(preview); documentLock.current = true;
    try {
      const result = await documentMutation.mutateAsync({ merchantId, id: item.id });
      if (!current(identity) || preview.closed) { preview.close(); return; }
      preview.location.replace(result.url);
    } catch (error) {
      preview.close();
      if (current(identity)) toast.error(error instanceof Error ? error.message : "代理证暂时无法查看");
    } finally { documentLock.current = false; }
  };

  return <div className="space-y-3" data-agency-certification-tab>
    <section className="overflow-hidden rounded-lg border bg-white text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><BadgeCheck className="h-4 w-4 text-primary" />代理认证</h2>
        {canWrite && !draft ? <Button type="button" size="sm" className="h-8 text-xs" disabled={busy} onClick={beginNew}>后台人工认定</Button> : null}
      </div>
      {canWrite && draft ? <div className="space-y-4 p-4" data-agency-certification-editor>
        <p className="text-xs text-muted-foreground">仅后台人工认定保存后生效；用户申请请使用记录上的“审核申请”。{draft.id ? "修改将创建新版本，旧审核结果与原件保留。" : ""}</p>
        <div className="space-y-2"><Label htmlFor="agency-brands">代理品牌</Label>
          <Textarea id="agency-brands" value={draft.brandsText} disabled={busy} maxLength={2560} className="min-h-24 text-sm" placeholder="例如：ST(意法半导体)、TI；NXP" onChange={event => updateDraft({ brandsText: event.target.value })} />
          <p className="text-[11px] text-muted-foreground">最多 30 项，每项最多 80 个字符；逗号、分号、顿号或换行分隔。</p>
        </div>
        <div className="space-y-2"><Label htmlFor="agency-issuer">授权主体</Label><Input id="agency-issuer" value={draft.authorizationIssuer} maxLength={200} disabled={busy} onChange={event => updateDraft({ authorizationIssuer: event.target.value })} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="agency-from">有效起始日期</Label><Input id="agency-from" type="date" value={draft.validFrom} disabled={busy} onChange={event => updateDraft({ validFrom: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="agency-until">有效截止日期（空为无明确期限）</Label><Input id="agency-until" type="date" value={draft.validUntil} disabled={busy} onChange={event => updateDraft({ validUntil: event.target.value })} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="agency-note">补充说明</Label><Textarea id="agency-note" value={draft.supplementalNote} maxLength={2000} disabled={busy} onChange={event => updateDraft({ supplementalNote: event.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="agency-document">代理证{draft.id ? "（可更换）" : ""}</Label>
          <Input ref={fileInputRef} id="agency-document" type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" disabled={busy} onChange={event => selectFile(event.target.files?.[0])} />
          <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}><FileUp className="mr-1 h-3.5 w-3.5" />{draft.file ? "更换已选文件" : "上传代理证"}</Button>
            {draft.file ? <span className="inline-flex items-center gap-1 text-xs"><span className="max-w-56 truncate">{draft.file.name}</span><button type="button" aria-label="移除已选代理证" disabled={busy} onClick={() => { updateDraft({ file: null }); if (fileInputRef.current) fileInputRef.current.value = ""; }}><X className="h-3.5 w-3.5" /></button></span>
              : draft.existingFileName ? <span className="text-xs text-muted-foreground">保留原证件：{draft.existingFileName}</span> : null}
          </div><p className="text-[11px] text-muted-foreground">JPG、PNG、WebP 或 PDF，单个文件不超过 10MiB。</p>
        </div>
        <div className="flex gap-2 border-t pt-3"><Button type="button" size="sm" disabled={busy} onClick={() => void save()}>{saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}人工认定并生效</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(null); setSaveRequestId(null); }}>取消</Button></div>
      </div> : null}
      {certificationsQuery.isLoading || certificationsQuery.isFetching ? <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…</div>
        : certificationsQuery.error ? <div className="px-4 py-10 text-center text-muted-foreground"><p>代理认证加载失败</p><Button type="button" variant="link" size="sm" onClick={() => void certificationsQuery.refetch()}>重新加载</Button></div>
        : items.length === 0 ? <div className="py-12 text-center text-muted-foreground">暂无代理认证记录</div>
        : <div className="divide-y">{[...items].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.id - a.id).map(item => {
          const label = agencyCertificationStatusLabel(item);
          const partial = item.status === "active" && item.effectiveBrands && item.effectiveBrands.length > 0 && item.effectiveBrands.length < item.brands.length;
          return <div key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3" data-agency-certification-record={item.status}>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2"><span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${label === "已通过" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{label}</span><span className="text-xs text-muted-foreground">#{item.id} · 版本 {item.revision}</span></div>
              <p className="break-words font-medium">{item.brands.join("、")}</p>
              <p className="text-xs text-muted-foreground">有效期：{item.validFrom || "未注明起始日期"} 至 {item.validUntil || "无明确期限"}</p>
              {partial ? <p className="text-xs text-amber-700">当前有效品牌：{item.effectiveBrands?.join("、")}；其他品牌已替代</p> : null}
              {item.authorizationIssuer ? <p className="break-words text-xs">授权主体：{item.authorizationIssuer}</p> : null}
              {item.supplementalNote ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">补充说明：{item.supplementalNote}</p> : null}
              {item.reviewReason ? <p className="whitespace-pre-wrap break-words text-xs text-amber-700">{item.status === "rejected" ? "驳回原因" : "审核意见"}：{item.reviewReason}</p> : null}
              <p className="text-[11px] text-muted-foreground">提交 {formatBeijingDateTimeWithSeconds(item.submittedAt ?? item.createdAt ?? item.updatedAt) || "—"}{item.reviewedAt ? ` · 审核 ${formatBeijingDateTimeWithSeconds(item.reviewedAt)}` : ""} · 更新 {formatBeijingDateTimeWithSeconds(item.updatedAt) || "—"}</p>
              {item.supersedesCertificationId ? <p className="text-[11px] text-muted-foreground">承接历史记录 #{item.supersedesCertificationId}</p> : null}
              {canWrite ? <p className="truncate text-xs text-muted-foreground" title={item.fileName}>证件：{item.fileName}</p> : null}
            </div>
            {canWrite ? <div className="flex shrink-0 flex-wrap gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={documentMutation.isPending} onClick={() => void viewDocument(item)}><Eye className="mr-1 h-3.5 w-3.5" />查看原件</Button>
              {item.status === "pending" ? <Button type="button" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => setReview({ item: { ...item }, decision: "approve", reason: "", requestId: requestId() })}>审核申请</Button> : null}
              {item.status === "active" ? <><Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => beginEdit(item)}><Pencil className="mr-1 h-3.5 w-3.5" />编辑认定</Button><Button type="button" variant="outline" size="sm" className="h-8 text-xs text-amber-700" disabled={busy} onClick={() => setCancelTarget({ ...item })}><ShieldX className="mr-1 h-3.5 w-3.5" />撤销认证</Button></> : null}
            </div> : null}
          </div>;
        })}</div>}
    </section>
    <Dialog open={canWrite && Boolean(review)} onOpenChange={open => { if (!open && !busy) setReview(null); }}>
      <DialogContent><DialogHeader><DialogTitle>审核代理认证申请</DialogTitle><DialogDescription>记录 #{review?.item.id} · {review?.item.brands.join("、")}。请核对授权材料与有效期。</DialogDescription></DialogHeader>
        <div className="flex gap-2"><Button type="button" variant={review?.decision === "approve" ? "default" : "outline"} disabled={busy} onClick={() => setReview(value => value ? { ...value, decision: "approve", requestId: requestId() } : value)}>通过</Button><Button type="button" variant={review?.decision === "reject" ? "destructive" : "outline"} disabled={busy} onClick={() => setReview(value => value ? { ...value, decision: "reject", requestId: requestId() } : value)}>驳回</Button></div>
        <Label htmlFor="agency-review-reason">{review?.decision === "reject" ? "驳回原因（必填）" : "审核意见（选填）"}</Label><Textarea id="agency-review-reason" value={review?.reason ?? ""} maxLength={2000} disabled={busy} onChange={event => setReview(value => value ? { ...value, reason: event.target.value, requestId: requestId() } : value)} />
        {reviewStale ? <p className="text-xs text-destructive">记录已变化，请关闭后重新加载并审核。</p> : null}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setReview(null)}>取消</Button><Button type="button" disabled={busy || reviewStale || (review?.decision === "reject" && !review.reason.trim())} onClick={() => void submitReview()}>确认{review?.decision === "reject" ? "驳回" : "通过"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={canWrite && Boolean(cancelTarget)} onOpenChange={open => { if (!open && !busy) setCancelTarget(null); }}>
      <DialogContent><DialogHeader><DialogTitle>撤销代理认证</DialogTitle><DialogDescription>撤销记录 #{cancelTarget?.id}（{cancelTarget?.brands.join("、")}）后不再展示相应认证。审核历史和原件不会删除。</DialogDescription></DialogHeader>
        {cancelStale ? <p className="text-xs text-destructive">记录已变化，请重新加载。</p> : null}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setCancelTarget(null)}>保留认证</Button><Button type="button" variant="destructive" disabled={busy || cancelStale} onClick={() => void cancel()}>确认撤销</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
