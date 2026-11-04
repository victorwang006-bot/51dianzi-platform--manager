import React, { useEffect, useRef, useState } from "react";
import { useBusinessScope } from "../../../../../BusinessScope";
import { emptyDraft, validateDraft, type Draft } from "../channelInventory/import";
import { Button } from "../channelInventory/bridge";

type Props = { onPreview: (draft: Draft) => void; disabled: boolean };

/** No network writes here: the parent importer owns preview, confirmation and recovery. */
export function CustomerSupplySingleEntry({ onPreview, disabled }: Props) {
  const business = useBusinessScope();
  const canAddNote = business.officialInventoryPermissions.note;
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft });
  const [errors, setErrors] = useState<string[]>([]);
  const partNumber = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!disabled) partNumber.current?.focus(); }, [disabled]);
  const update = (field: keyof Draft, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setErrors([]);
  };
  return <form className="customer-supply-single" onSubmit={event => {
    event.preventDefault();
    if (disabled) return;
    const value = { ...draft, note: canAddNote ? draft.note : "" };
    const issues = validateDraft(value);
    setErrors(issues);
    if (!issues.length) onPreview(value);
  }}>
    <p className="ci-dialog-note">手工录入一条客户供应物料，先预览再确认上传。数量留空为待确认，报价留空为面议；仅支持 CNY，不覆盖已有库存。</p>
    <fieldset className="customer-supply-single-fields" disabled={disabled}>
      <label className="ci-field"><span>型号 *</span><input ref={partNumber} aria-label="单条型号" required maxLength={128} value={draft.partNumber} onChange={event => update("partNumber", event.target.value)} /></label>
      <label className="ci-field"><span>品牌 *</span><input aria-label="单条品牌" required maxLength={64} value={draft.brand} onChange={event => update("brand", event.target.value)} /></label>
      <label className="ci-field"><span>可供数量</span><input aria-label="单条可供数量" inputMode="numeric" placeholder="待确认" value={draft.qty} onChange={event => update("qty", event.target.value)} /></label>
      <label className="ci-field"><span>报价 CNY</span><input aria-label="单条报价 CNY" inputMode="decimal" placeholder="面议" value={draft.price} onChange={event => update("price", event.target.value)} /></label>
      <label className="ci-field"><span>税务口径</span><select aria-label="单条税务口径" value={draft.taxIncluded} onChange={event => update("taxIncluded", event.target.value)}><option value="unknown">待确认</option><option value="true">含税</option><option value="false">未税</option></select></label>
      <label className="ci-field"><span>交期</span><input aria-label="单条交期" maxLength={64} placeholder="待确认" value={draft.leadTime} onChange={event => update("leadTime", event.target.value)} /></label>
      <label className="ci-field"><span>Date Code</span><input aria-label="单条 Date Code" maxLength={32} value={draft.dateCode} onChange={event => update("dateCode", event.target.value)} /></label>
      {canAddNote ? <label className="ci-field customer-supply-single-wide"><span>备注（仅本人）</span><textarea aria-label="单条备注（仅本人）" maxLength={2000} rows={2} placeholder="仅本人可见，不共享" value={draft.note} onChange={event => update("note", event.target.value)} /></label> : null}
    </fieldset>
    {errors.length ? <p className="ci-error" role="alert">{errors.join("；")}</p> : null}
    <Button type="submit" className="ci-button ci-primary" disabled={disabled}>预览单条物料</Button>
  </form>;
}
