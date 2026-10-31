import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";

type ConfirmDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
  error?: string;
  children?: ReactNode;
};

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel, busy = false, danger = false, error, children }: ConfirmDialogProps) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle className="text-base text-slate-800">{title}</DialogTitle>
        <DialogDescription className="text-sm leading-6">{description}</DialogDescription>
      </DialogHeader>
      {children && <div className="space-y-3">{children}</div>}
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <DialogFooter>
        <button type="button" className="crm-btn" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className={`crm-btn ${danger ? "crm-btn-danger" : "crm-btn-primary"}`} disabled={busy} onClick={onConfirm}>{busy ? "处理中…" : confirmLabel}</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
