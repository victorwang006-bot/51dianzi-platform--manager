import React from "react";
import type { ChannelReferenceRow } from "@shared/channelReference";
import { ChannelReferenceCell } from "./ChannelReferenceCell";
import { MANUAL_REFERENCE_FIELDS, type ManualReferenceDraft, type ManualReferenceField } from "./manualReferenceEdit";

export function ChannelInventoryManualReferenceFields({ draft, autoReferences, partNumber, locked, onChange,
  retentionRequired, retentionConfirmed, onConfirm }: {
  draft: ManualReferenceDraft; autoReferences?: ChannelReferenceRow["references"]; partNumber: string; locked: boolean;
  onChange: (field: ManualReferenceField, value: string) => void;
  retentionRequired: boolean; retentionConfirmed: boolean; onConfirm: (confirmed: boolean) => void;
}) {
  return <>
    {MANUAL_REFERENCE_FIELDS.map(({ field, source, label, provider }) => <div className="ci-field ci-manual-reference-field" key={field}>
      <label className="ci-field"><span>{label}（{provider} · CNY）</span>
        <input aria-label={`${label}（CNY）`} inputMode="decimal" disabled={locked} value={draft[field].value}
          placeholder="留空使用自动参考价" onChange={event => { if (!locked) onChange(field, event.target.value); }} />
      </label>
      <small>当前自动参考：<ChannelReferenceCell source={source} quote={autoReferences?.[source]} partNumber={partNumber} /></small>
      <button type="button" className="ci-inline-link ci-manual-reference-reset" aria-label={`${label}恢复自动价`} disabled={locked}
        onClick={() => { if (!locked) onChange(field, ""); }}>恢复自动价</button>
    </div>)}
    {retentionRequired ? <div className="ci-form-wide ci-manual-reference-confirm" role="group" aria-label="手填参考价型号品牌确认">
      <p>型号或品牌已修改，已有手填参考价可能不再适用。请重填或恢复自动价；保留原价须明确确认。</p>
      <label><input type="checkbox" aria-label="确认保留已有手填参考价" disabled={locked} checked={retentionConfirmed}
        onChange={event => { if (!locked) onConfirm(event.target.checked); }} />确认保留已有手填参考价</label>
    </div> : null}
  </>;
}
