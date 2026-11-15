import React from "react";

export type MaterialForm = {
  channelId: string;
  partNumber: string;
  brand: string;
  qty: string;
  dateCode: string;
  price: string;
  taxIncluded: "unknown" | "included" | "excluded";
  leadTime: string;
  note: string;
};

/** The original Host modal's presentation only. Its callers keep the existing
 * backend grants, public detail read, CAS/UUID transaction and lifecycle guards.
 * Context is an identity boundary, not another permission interface. */
export function MaterialEditPanel({ mode, form, setForm, onIdentityChange, busy, retryLocked,
  channels, nativeNote, manualFields, privateEntry, message, dialogRef, onKeyDown,
  context, scopeKey, isCurrent, onClose, onSubmit }: {
  mode: "create" | "edit";
  form: MaterialForm;
  setForm: React.Dispatch<React.SetStateAction<MaterialForm>>;
  onIdentityChange: () => void;
  busy: boolean;
  retryLocked: boolean;
  channels: readonly { id: number; name: string }[];
  nativeNote: boolean;
  manualFields?: React.ReactNode;
  privateEntry?: React.ReactNode;
  message: string;
  dialogRef: React.RefObject<HTMLElement | null>;
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
  context: { expectedEnterpriseId: number; expectedActorUserId: number };
  scopeKey: string;
  isCurrent: () => boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  // No identity is inferred from CRM/row/role. The caller supplies the same
  // server-proven assertions as the public edit read and write.
  const subject = JSON.stringify([scopeKey, context.expectedEnterpriseId, context.expectedActorUserId]);
  const liveSubject = React.useRef(subject); liveSubject.current = subject;
  const current = () => liveSubject.current === subject && isCurrent();
  if (!current()) return null;
  const change = (field: keyof MaterialForm, value: string, identity = false) => {
    if (!current() || busy || retryLocked) return;
    setForm(previous => ({ ...previous, [field]: value }));
    if (identity) onIdentityChange();
  };
  const close = () => { if (current() && !busy && !retryLocked) onClose(); };
  return <div className="ci-modal-backdrop" role="presentation">
    <section ref={dialogRef} className="ci-host-dialog ci-host-material-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-material-editor-title" onKeyDown={onKeyDown}>
      <header><div><h2 id="ci-material-editor-title">{mode === "create" ? "单条上传" : "编辑渠道库存"}</h2></div><button type="button" className="ci-icon-close" aria-label="关闭库存编辑" disabled={busy || retryLocked} onClick={close}>×</button></header>
      <div className="ci-dialog-scroll">
        {mode === "create" && !channels.length ? <p className="ci-error" role="alert">暂无可用渠道。请先创建并启用渠道后再录入库存。</p> : null}
        <fieldset className="ci-form-grid" disabled={busy || retryLocked}>
          <label className="ci-field"><span>型号 *</span><input required value={form.partNumber} maxLength={128} onChange={event => change("partNumber", event.target.value, true)} /></label>
          <label className="ci-field"><span>品牌 *</span><input required value={form.brand} maxLength={64} onChange={event => change("brand", event.target.value, true)} /></label>
          {mode === "create" ? <label className="ci-field"><span>关联渠道 *</span><select required aria-label="关联渠道" value={form.channelId} onChange={event => change("channelId", event.target.value)}><option value="">请选择启用渠道</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label> : <label className="ci-field"><span>关联渠道（不可更换）</span><input aria-label="关联渠道" readOnly disabled value="关联渠道由服务端保留" /></label>}
          <label className="ci-field"><span>可供数量</span><input inputMode="numeric" placeholder="待确认" value={form.qty} onChange={event => change("qty", event.target.value)} /></label>
          <label className="ci-field"><span>Date Code</span><input maxLength={32} value={form.dateCode} onChange={event => change("dateCode", event.target.value)} /></label>
          <label className="ci-field"><span>报价 CNY</span><input inputMode="decimal" placeholder="面议" value={form.price} onChange={event => change("price", event.target.value)} /></label>
          <label className="ci-field"><span>税务口径</span><select value={form.taxIncluded} onChange={event => change("taxIncluded", event.target.value)}><option value="unknown">待确认</option><option value="included">含税</option><option value="excluded">未税</option></select></label>
          <label className="ci-field"><span>交期</span><input maxLength={64} placeholder="待确认" value={form.leadTime} onChange={event => change("leadTime", event.target.value)} /></label>
          {nativeNote && mode === "create" ? <label className="ci-field ci-form-wide"><span>备注（仅本人）</span><textarea placeholder="仅本人可见，不共享" value={form.note} maxLength={2000} rows={2} onChange={event => change("note", event.target.value)} /></label> : null}
          {manualFields}
        </fieldset>
        {privateEntry}
        {message ? <p className="ci-error" role="alert">{message}</p> : null}
      </div>
      <footer><button type="button" className="ci-button" disabled={busy || retryLocked} onClick={close}>取消</button><button type="button" className="ci-button ci-primary" disabled={busy || (mode === "create" && !channels.length)} onClick={() => { if (current()) onSubmit(); }}>{busy ? "保存中…" : retryLocked ? "按原请求重试" : mode === "create" ? "上传库存" : "保存修改"}</button></footer>
    </section>
  </div>;
}
