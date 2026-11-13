import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { ConfirmDialog } from "../customers/ConfirmDialog";
import { CUSTOMER_DEMAND_UNITS, type CustomerDemandItem } from "../../../../shared/customerDemands";
import {
  DEMAND_BOM_FIELDS, DEMAND_BOM_MAX_ROWS,
  assertDemandBomFile, demandBomDuplicateParts, demandBomMappingError,
  mapDemandBomRows, readDemandBomSheet, readDemandBomSheetNames,
  suggestDemandBomHeader, suggestDemandBomMapping, validateDemandBomDraft,
  type DemandBomDraft, type DemandBomField, type DemandBomMapping, type DemandBomSheet,
} from "./customerDemandBom";

type Props = {
  existingItems: CustomerDemandItem[];
  remainingCapacity: number;
  disabled: boolean;
  /** Captured by the owning demand session; stale receipts never reach the form. */
  isCurrent: () => boolean;
  onConfirm: (items: CustomerDemandItem[]) => void;
  onClose: () => void;
};
const inputClass = "h-8 w-full min-w-0 rounded border border-slate-300 bg-white px-2 text-xs outline-none focus:border-[#185FA5] disabled:bg-slate-50";
const PAGE_SIZE = 25;

export function CustomerDemandBomDialog({ existingItems, remainingCapacity, disabled, isCurrent, onConfirm, onClose }: Props) {
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState<DemandBomSheet | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<DemandBomMapping>(() => suggestDemandBomMapping([]));
  const [drafts, setDrafts] = useState<DemandBomDraft[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allowIncomplete, setAllowIncomplete] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [resetAction, setResetAction] = useState<(() => void) | null>(null);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; generationRef.current += 1; bytesRef.current = null; };
  }, []);
  useEffect(() => { if (disabled) { generationRef.current += 1; setReading(false); } }, [disabled]);
  const current = (generation = generationRef.current) => mountedRef.current && isCurrent() && !disabledRef.current && generationRef.current === generation;
  const locked = disabled || reading;
  const headers = sheet?.rows[headerIndex]?.map((cell, index) => cell.text || `第${index + 1}列（空表头）`) ?? [];
  const mappingError = demandBomMappingError(mapping);
  const validations = useMemo(() => drafts.map(draft => validateDemandBomDraft(draft, allowIncomplete)), [drafts, allowIncomplete]);
  const validCount = validations.filter(validation => validation.item).length;
  const chosen = drafts.flatMap((draft, index) => selected.has(draft.sourceRow) ? [{ draft, validation: validations[index] }] : []);
  const invalidChosen = chosen.some(({ validation }) => !validation.item);
  const duplicateParts = demandBomDuplicateParts(chosen.map(({ draft }) => ({ partNumber: draft.values.partNumber })), existingItems);
  const pages = Math.max(1, Math.ceil(drafts.length / PAGE_SIZE));

  const clearPreview = () => { setDrafts([]); setSelected(new Set()); setPage(1); setError(""); };
  const resetOrRun = (action: () => void) => {
    if (!current() || reading) return;
    if (drafts.length) setResetAction(() => action);
    else action();
  };
  const close = () => {
    if (drafts.length || reading || sheet) setResetAction(() => () => { generationRef.current += 1; onClose(); });
    else { generationRef.current += 1; onClose(); }
  };
  const applySheet = (next: DemandBomSheet) => {
    const index = suggestDemandBomHeader(next);
    setSheet(next); setHeaderIndex(index); setMapping(suggestDemandBomMapping(next.rows[index].map(cell => cell.text))); clearPreview();
  };
  const selectFile = async (file: File) => {
    if (!current()) return;
    setError("");
    try { assertDemandBomFile(file); } catch (error) { setError(error instanceof Error ? error.message : "文件无效"); return; }
    const generation = ++generationRef.current;
    setReading(true);
    clearPreview(); setSheet(null); setSheetNames([]); bytesRef.current = null;
    try {
      const xlsx = await import("xlsx");
      if (!current(generation)) return;
      const bytes = await file.arrayBuffer();
      if (!current(generation)) return;
      const names = readDemandBomSheetNames(xlsx, bytes);
      const next = readDemandBomSheet(xlsx, bytes, names[0]);
      if (!current(generation)) return;
      bytesRef.current = bytes; setFileName(file.name); setSheetNames(names); applySheet(next);
    } catch (error) {
      if (current(generation)) setError(error instanceof Error ? `读取失败：${error.message}` : "文件无法解析，请检查是否为有效 Excel 文件");
    } finally { if (current(generation)) setReading(false); }
  };
  const changeSheet = async (name: string) => {
    if (!current() || !bytesRef.current) return;
    const bytes = bytesRef.current;
    const generation = ++generationRef.current;
    setReading(true); setError(""); setSheet(null); clearPreview();
    try {
      const xlsx = await import("xlsx");
      if (!current(generation)) return;
      const next = readDemandBomSheet(xlsx, bytes, name);
      if (current(generation)) applySheet(next);
    } catch (error) { if (current(generation)) setError(error instanceof Error ? error.message : "工作表读取失败"); }
    finally { if (current(generation)) setReading(false); }
  };
  const preview = () => {
    if (!current() || !sheet || reading) return;
    try {
      const next = mapDemandBomRows(sheet, headerIndex, mapping);
      if (!next.length) throw new Error("映射列中没有物料数据，请检查表头行及列映射");
      setDrafts(next); setSelected(new Set(next.map(row => row.sourceRow))); setPage(1); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "预览失败"); }
  };
  const editCell = (sourceRow: number, field: DemandBomField, value: string) => {
    if (!current() || reading) return;
    setDrafts(rows => rows.map(row => row.sourceRow === sourceRow ? {
      ...row, values: { ...row.values, [field]: value }, formulaFields: row.formulaFields.filter(key => key !== field),
    } : row));
    setError("");
  };
  const confirm = () => {
    if (!current() || reading) return;
    if (!chosen.length || invalidChosen || chosen.length > remainingCapacity) { setError("请修正勾选行的错误，并确保未超过需求单剩余行数"); return; }
    // Revalidate immediately before handing plain whitelisted material fields to the owner.
    const items = chosen.map(({ draft }) => validateDemandBomDraft(draft, allowIncomplete).item);
    if (items.some(item => !item)) return;
    onConfirm(items as CustomerDemandItem[]);
  };

  return <>
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent showCloseButton={false} className="customer-bom-dialog flex max-h-[90dvh] w-[calc(100vw-32px)] max-w-[1120px] sm:max-w-[1120px] flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={event => { event.preventDefault(); close(); }} onInteractOutside={event => { event.preventDefault(); }}>
        <div className="shrink-0 border-b border-slate-200 px-4 py-3">
          <DialogTitle className="text-base font-semibold text-slate-800">导入客户需求 BOM</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-slate-500">仅在本地解析 Excel，追加物料，不覆盖现有明细，不合并重复型号；确认后仍需另行保存草稿或提交采购。</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className={`inline-flex h-8 items-center gap-1 rounded border border-[#185FA5]/40 px-3 text-xs text-[#185FA5] ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-50"}`}>
              {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}选择 BOM 文件
              <input aria-label="选择客户需求BOM文件" type="file" accept=".xlsx,.xls" disabled={locked} className="sr-only" onChange={event => {
                const file = event.target.files?.[0]; event.currentTarget.value = "";
                if (file) resetOrRun(() => { void selectFile(file); });
              }} />
            </label>
            <span className="text-[11px] text-slate-500">.xlsx / .xls · ≤5MB · 最多解析 {DEMAND_BOM_MAX_ROWS} 行 · 本单可追加 {remainingCapacity} 行</span>
          </div>
          {reading && <p role="status" className="text-xs text-slate-500">正在解析 BOM…</p>}
          {sheetNames.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="max-w-[320px] truncate text-slate-500" title={fileName}>{fileName}</span>
            <label className="flex items-center gap-1">工作表<select aria-label="BOM工作表" className={`${inputClass} w-auto max-w-[240px]`} value={sheet?.name ?? ""} disabled={locked} onChange={event => { const name = event.target.value; resetOrRun(() => { void changeSheet(name); }); }}>
              {!sheet && <option value="">请选择工作表</option>}{sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select></label>
            {sheet && <label className="flex items-center gap-1">表头行<select aria-label="BOM表头行" className={`${inputClass} w-auto`} disabled={locked} value={headerIndex} onChange={event => {
              const index = Number(event.target.value); resetOrRun(() => { setHeaderIndex(index); setMapping(suggestDemandBomMapping(sheet.rows[index].map(cell => cell.text))); clearPreview(); });
            }}>{sheet.rows.slice(0, Math.min(20, sheet.rows.length - 1)).map((row, index) => <option key={index} value={index}>第 {index + 1} 行：{row.map(cell => cell.text).filter(Boolean).join(" / ").slice(0, 70)}</option>)}</select></label>}
          </div>}
          {sheet && <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{DEMAND_BOM_FIELDS.map(field => <label key={field.key} className="text-[11px] text-slate-600">{field.label}{(field.key === "partNumber" || field.key === "qty") && " *"}
              <select aria-label={`BOM映射${field.label}`} className={`${inputClass} mt-1`} value={mapping[field.key] ?? ""} disabled={locked} onChange={event => {
                const column = event.target.value === "" ? null : Number(event.target.value);
                resetOrRun(() => { setMapping(value => ({ ...value, [field.key]: column })); clearPreview(); });
              }}><option value="">{field.key === "qtyUnit" ? "不导入（默认片）" : "不导入"}</option>{headers.map((header, index) => <option key={index} value={index}>第 {index + 1} 列：{header}</option>)}</select>
            </label>)}</div>
            <p className="text-[11px] text-slate-500">仅映射以上七个物料字段，联系人、电话等额外列不会自动导入。型号应使用文本以保留前导零；公式须改为明确值。未识别表头可手动选择。</p>
            {mappingError && <p role="alert" className="text-xs text-amber-700">{mappingError}</p>}
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={locked || Boolean(mappingError)} onClick={() => resetOrRun(preview)}>{drafts.length ? "重新生成预览" : "生成预览"}</Button>
          </>}
          {drafts.length > 0 && <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <p role="status">共 {drafts.length} 行 · 有效行 {validCount} · 错误行 {drafts.length - validCount} · 已选 {chosen.length} 行</p>
              <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={locked} className="h-7 text-xs" onClick={() => setSelected(new Set(drafts.map(row => row.sourceRow)))}>全选</Button><Button type="button" size="sm" variant="outline" disabled={locked} className="h-7 text-xs" onClick={() => setSelected(new Set(drafts.filter((_, index) => validations[index].item).map(row => row.sourceRow)))}>仅选择有效行</Button></div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600"><input aria-label="允许导入不完整草稿行" type="checkbox" disabled={locked} checked={allowIncomplete} onChange={event => setAllowIncomplete(event.target.checked)} />允许型号或数量空白，作为草稿行导入（其他错误仍须修正）</label>
            {allowIncomplete && <p className="text-[11px] text-amber-700">不完整行仅可保存草稿，提交采购前须补齐型号、数量。填写的数量仍须为正整数。</p>}
            {duplicateParts.length > 0 && <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">重复型号提示：{duplicateParts.slice(0, 8).join("、")}{duplicateParts.length > 8 ? " 等" : ""}。这些行将保留为独立明细，不自动合并。</p>}
            {chosen.length > remainingCapacity && <p role="alert" className="text-xs text-red-600">已选 {chosen.length} 行，超过剩余 {remainingCapacity} 行，请取消部分勾选或另建需求单。</p>}
            <div className="overflow-x-auto rounded border border-slate-200"><table className="w-full min-w-[1070px] table-fixed text-xs">
              <colgroup><col className="w-[70px]" />{DEMAND_BOM_FIELDS.map(field => <col key={field.key} className={field.key === "qtyUnit" ? "w-[100px]" : field.key === "note" ? "w-[190px]" : "w-[145px]"} />)}</colgroup>
              <thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-2 py-2">选择 / 行</th>{DEMAND_BOM_FIELDS.map(field => <th key={field.key} className="px-2 py-2">{field.label}</th>)}</tr></thead>
              <tbody>{drafts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((draft, offset) => {
                const validation = validations[(page - 1) * PAGE_SIZE + offset];
                return <tr key={draft.sourceRow} className={`border-t border-slate-100 align-top ${validation.item ? "" : "bg-red-50/40"}`}>
                  <td className="p-2"><label className="flex items-center gap-1"><input aria-label={`选择BOM第${draft.sourceRow}行`} type="checkbox" checked={selected.has(draft.sourceRow)} disabled={locked} onChange={event => {
                    const checked = event.target.checked; setSelected(rows => { const next = new Set(rows); if (checked) next.add(draft.sourceRow); else next.delete(draft.sourceRow); return next; });
                  }} />{draft.sourceRow}</label><span className={`mt-1 block text-[10px] ${validation.item ? "text-emerald-700" : "text-red-600"}`}>{validation.item ? "有效" : "错误"}</span></td>
                  {DEMAND_BOM_FIELDS.map(field => <td key={field.key} className="p-1.5">
                    {field.key === "qtyUnit" ? <select aria-label={`BOM第${draft.sourceRow}行${field.label}`} value={draft.values[field.key]} disabled={locked} className={inputClass} onChange={event => editCell(draft.sourceRow, field.key, event.target.value)}>
                      {!CUSTOMER_DEMAND_UNITS.includes(draft.values.qtyUnit as CustomerDemandItem["qtyUnit"]) && <option value={draft.values.qtyUnit}>{draft.values.qtyUnit || "片"}</option>}{CUSTOMER_DEMAND_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                    </select> : <input aria-label={`BOM第${draft.sourceRow}行${field.label}`} value={draft.values[field.key]} disabled={locked} aria-invalid={Boolean(validation.errors[field.key])} inputMode={field.key === "qty" ? "numeric" : undefined} className={inputClass} onChange={event => editCell(draft.sourceRow, field.key, event.target.value)} />}
                    {validation.errors[field.key] && <p className="mt-1 text-[11px] text-red-600">{validation.errors[field.key]}</p>}
                  </td>)}
                </tr>;
              })}</tbody>
            </table></div>
            <div className="flex items-center justify-end gap-2 text-xs text-slate-500"><Button type="button" size="sm" variant="outline" disabled={locked || page <= 1} className="h-7 text-xs" onClick={() => setPage(value => value - 1)}>上一页</Button>第 {page} / {pages} 页<Button type="button" size="sm" variant="outline" disabled={locked || page >= pages} className="h-7 text-xs" onClick={() => setPage(value => value + 1)}>下一页</Button></div>
          </>}
          {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={close}>取消导入</Button>
          <Button type="button" size="sm" className="h-8 bg-[#185FA5] text-xs hover:bg-[#0C447C]" disabled={locked || !chosen.length || invalidChosen || chosen.length > remainingCapacity} onClick={confirm}>确认追加 {chosen.length} 行</Button>
        </div>
      </DialogContent>
    </Dialog>
    {resetAction && <ConfirmDialog scopeClassName="customer-bom-dialog" title="放弃当前 BOM 预览？" description="已解析的预览及修正不会保存，原需求物料不受影响。" confirmLabel="放弃预览" danger onCancel={() => setResetAction(null)} onConfirm={() => { const action = resetAction; setResetAction(null); action(); }} />}
  </>;
}
