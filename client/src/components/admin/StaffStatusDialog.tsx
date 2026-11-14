import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { StaffStatusInput, StaffStatusTarget } from "@/lib/staffStatusUi";

export default function StaffStatusDialog(props: {
  open: boolean;
  actorKey: string;
  target: StaffStatusTarget | null;
  allowed: boolean;
  onOpenChange: (open: boolean) => void;
  mutate: (input: StaffStatusInput) => Promise<{ success: boolean }>;
  readBack: (id: number) => Promise<{ id: number; status: string } | null>;
}) {
  const scope = JSON.stringify([props.open, props.actorKey, props.target]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const [visibleScope, setVisibleScope] = useState(scope);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setVisibleScope(scope); setReason(""); setMessage(""); setSaving(false); setSaved(false); busy.current = false;
    return () => { generation.current += 1; };
  }, [scope]);
  const active = visibleScope === scope;
  const canSubmit = active && props.open && props.allowed && Boolean(props.target) && !saving && !saved && reason.trim().length >= 2 && reason.trim().length <= 500;
  const submit = async () => {
    if (!canSubmit || busy.current || !props.target) return;
    const epoch = generation.current;
    const submittedScope = scope;
    const isCurrent = () => generation.current === epoch && currentScope.current === submittedScope;
    const target = props.target;
    busy.current = true; setSaving(true); setMessage("");
    try {
      const result = await props.mutate({ id: target.id, status: target.status, expectedStatus: target.expectedStatus, reason: reason.trim() });
      if (!isCurrent()) return;
      if (result.success !== true) throw new Error("接口未返回可信成功结果，请刷新核验");
      // Never resubmit a confirmed write merely because its readback failed.
      setSaved(true);
      try {
        const latest = await props.readBack(target.id);
        if (!isCurrent()) return;
        if (!latest || latest.id !== target.id || latest.status !== target.status) {
          setMessage("操作已提交，但回读状态已变化或目标不在当前列表。请关闭后刷新核验，勿重复提交。");
          return;
        }
        props.onOpenChange(false);
      } catch (error) {
        if (isCurrent()) setMessage(`操作已提交，状态回读失败。请关闭后刷新核验，勿重复提交。${error instanceof Error ? error.message : ""}`);
      }
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : "启停结果未确认，请刷新核验后再操作");
    } finally {
      if (isCurrent()) { busy.current = false; setSaving(false); }
    }
  };
  const disabling = props.target?.status === "disabled";
  return <Dialog open={props.open} onOpenChange={open => { if (!saving) props.onOpenChange(open); }}>
    <DialogContent className="sm:max-w-md" data-staff-status-dialog>
      <DialogHeader>
        <DialogTitle>{disabling ? "停用" : "启用"}后台账号 · {props.target?.name}</DialogTitle>
        <DialogDescription>目标账号：{props.target?.username}。{disabling ? "仅禁止该账号访问后台，并撤销全部既有后台会话。" : "恢复该账号后台访问，必须重新登录；旧会话不会恢复。"}</DialogDescription>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">不删除历史数据，不重置密码或更改权限，不自动交接客户、库存、订单归属；不连带停用或启用前台／小程序账号或企业成员。</p>
      <div className="space-y-1.5">
        <label htmlFor="staff-status-reason" className="text-xs">操作原因（2—500字，写入审计）</label>
        <Input id="staff-status-reason" value={active ? reason : ""} maxLength={500} disabled={saving || saved || !props.allowed} onChange={event => { if (!busy.current) setReason(event.target.value); }} placeholder="请填写实际启停原因" />
      </div>
      {!props.allowed ? <p role="alert" className="text-xs text-destructive">目标状态或操作者权限已变化，请关闭后刷新核验。</p> : null}
      {active && message ? <p role="status" className="text-xs">{message}</p> : null}
      <DialogFooter>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => props.onOpenChange(false)}>{saved ? "关闭并核验" : "取消"}</Button>
        <Button type="button" size="sm" variant={disabling ? "destructive" : "default"} disabled={!canSubmit} onClick={() => void submit()}>{saving ? "处理中…" : `确认${disabling ? "停用" : "启用"}`}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
