import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { archiveStaff, previewStaffArchive } from "../../../../server/staffArchive";
import type { StaffArchiveInput } from "../../../../server/staffArchiveModel";

type Preview = Awaited<ReturnType<typeof previewStaffArchive>>;
type Result = Awaited<ReturnType<typeof archiveStaff>>;
export default function StaffArchiveDialog(props: {
  open: boolean; actorKey: string; id: number | null; merchantId: number | null; name: string;
  onOpenChange: (open: boolean) => void;
  loadPreview: (input: { id: number; merchantId: number | null }) => Promise<Preview>;
  archive: (input: StaffArchiveInput) => Promise<Result>;
  onChanged: () => Promise<void>;
}) {
  const scope = JSON.stringify([props.open, props.id, props.merchantId, props.actorKey]);
  const [visibleScope, setVisibleScope] = useState(scope);
  const [previewValue, setPreview] = useState<Preview | null>(null);
  const preview = visibleScope === scope ? previewValue : null;
  const [nextOwner, setNextOwner] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [retryPayload, setRetryPayload] = useState<StaffArchiveInput | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const load = useRef(props.loadPreview); load.current = props.loadPreview;
  useEffect(() => {
    const epoch = ++generation.current;
    setVisibleScope(scope); busy.current = false;
    setPreview(null); setNextOwner(""); setMessage(""); setRetryPayload(null); setSaving(false);
    if (!props.open || !props.id) { setLoading(false); return; }
    setLoading(true);
    void load.current({ id: props.id, merchantId: props.merchantId }).then(value => {
      if (generation.current === epoch) setPreview(value);
    }).catch(error => { if (generation.current === epoch) setMessage(error instanceof Error ? error.message : "删除预览不可用，请稍后重试"); })
      .finally(() => { if (generation.current === epoch) setLoading(false); });
    return () => { generation.current += 1; };
  }, [props.open, props.id, props.merchantId, props.actorKey]);
  const business = preview?.preview;
  const blocked = business?.unsupported.filter(item => item.blocking) ?? [];
  const hasBusiness = business ? business.inventory.total + business.inquiries.total + business.customers.total > 0 : false;
  const pending = preview?.pending;
  const completed = pending?.state === "completed";
  const eligibleOwner = business?.candidates.some(item => item.eligible && item.userId === Number(nextOwner));
  const canSubmit = Boolean(props.open && preview && !completed && !blocked.length && !business?.limits.exceeded && (!hasBusiness || eligibleOwner) && props.id && (preview.adminOnly || props.merchantId));
  const submit = async () => {
    if (!canSubmit || busy.current || saving || !props.id || !preview) return;
    const epoch = generation.current;
    const payload: StaffArchiveInput = retryPayload ?? { id: props.id, merchantId: preview.adminOnly ? null : props.merchantId,
      expectedSessionVersion: preview.expectedSessionVersion, expectedBindingVersion: preview.expectedBindingVersion,
      expectedRevision: pending?.expectedRevision ?? business?.revision ?? null,
      requestId: pending?.requestId ?? `staff_archive_${crypto.randomUUID().replaceAll("-", "")}`,
      ...(pending?.nextOwnerUserId ? { nextOwnerUserId: pending.nextOwnerUserId } : nextOwner ? { nextOwnerUserId: Number(nextOwner) } : {}) };
    busy.current = true; setRetryPayload(payload); setSaving(true); setMessage("");
    try {
      const result = await props.archive(payload);
      if (generation.current !== epoch) return;
      setMessage(result.message);
      await props.onChanged();
      if (generation.current !== epoch) return;
      if (result.success && (!result.membershipRequired || result.enterpriseRemoved) && result.backendAccessClosed) props.onOpenChange(false);
    } catch (error) {
      if (generation.current === epoch) setMessage(`结果未确认，请使用原请求重试。${error instanceof Error ? error.message : ""}`);
    } finally { if (generation.current === epoch) { busy.current = false; setSaving(false); } }
  };
  return <Dialog open={props.open} onOpenChange={open => { if (!saving) props.onOpenChange(open); }}>
    <DialogContent className="sm:max-w-md" data-staff-archive-dialog>
      <DialogHeader><DialogTitle>删除用户{props.name ? ` · ${props.name}` : ""}</DialogTitle>
        <DialogDescription>删除后无法访问后台，历史数据保留。</DialogDescription></DialogHeader>
      {loading ? <p className="text-xs text-muted-foreground">正在核验当前企业身份与待交接业务…</p> : null}
      {hasBusiness ? <div className="space-y-2 text-xs"><p>请先交接负责业务</p>
        <p>客户 {business!.customers.total} · 库存 {business!.inventory.total} · 未结询价 {business!.inquiries.total}</p>
        <select aria-label="合法业务接替人" className="h-8 w-full rounded-md border px-2" value={nextOwner} disabled={saving || Boolean(retryPayload)} onChange={event => { if (!busy.current && !retryPayload) setNextOwner(event.target.value); }}>
          <option value="">请选择当前企业合法接替人</option>
          {business!.candidates.map(item => <option key={item.userId} value={item.userId} disabled={!item.eligible}>{item.displayName}{!item.eligible ? `（${item.unavailableReason || "不可接替"}）` : ""}</option>)}
        </select></div> : null}
      {blocked.length ? <div role="alert" className="space-y-1 text-xs text-destructive"><p>请先交接负责业务</p>
        {blocked.map(item => <p key={item.key}>{item.label}：{item.reason}，目前不能确认全量离职。</p>)}</div> : null}
      {business?.limits.exceeded ? <p role="alert" className="text-xs text-destructive">业务量超过安全上限，请先分批交接。</p> : null}
      {pending ? <p className="text-xs">{completed ? "已删除，历史数据保留。" : pending.message}</p> : null}
      {preview?.adminOnly ? <p className="text-xs text-muted-foreground">该后台账号从未关联主站员工，仅归档后台账号，不修改主站用户。</p> : null}
      {visibleScope === scope && message ? <p role="status" className="text-xs">{message}</p> : null}
      <DialogFooter><Button variant="outline" size="sm" disabled={saving} onClick={() => props.onOpenChange(false)}>取消</Button>
        <Button variant="destructive" size="sm" disabled={loading || saving || !canSubmit} onClick={() => void submit()}>{saving ? "处理中…" : pending || retryPayload ? "重试原请求" : hasBusiness ? "交接并删除用户" : "删除用户"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
