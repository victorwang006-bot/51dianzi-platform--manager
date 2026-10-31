import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ErpHelperText, ErpSegmentedControl } from "../erp/ErpFormControls";
import { trpc } from "../../../../../api/business-trpc";
import { toast } from "sonner";
import {
  INBOUND_BULK_FIELDS,
  INBOUND_BULK_FILE_MAX_BYTES,
  INBOUND_BULK_MAX_ROWS,
  validInboundDate,
  type InboundBulkCreateInput,
  type InboundBulkDraftRow,
  type InboundBulkField,
  type InboundBulkMapping,
  type InboundBulkRow,
} from "../../../../shared/inboundBulk";
import {
  emptyInboundBulkRow,
  mapInboundBulkRows,
  parseInboundPaste,
  suggestInboundBulkMapping,
  validateInboundBulkDraft,
  validateInboundBulkMapping,
} from "../../../../shared/inboundBulkImport";
import {
  CNY_TAX_EXCLUDED,
  CNY_TAX_INCLUDED,
  DEFAULT_INBOUND_TAX_RATE,
  type InboundPriceBasis,
} from "../../../../shared/inboundPricing";

type InboundStatus = "in_transit" | "received";
type ImportSource = {
  headers: string[];
  rows: unknown[][];
  name: string;
  sheetName?: string;
};
type MissingPriceConfirmation = {
  fingerprint: string;
  rows: InboundBulkRow[];
  missingRows: InboundBulkDraftRow[];
};
type RequestState = "idle" | "saving" | "uncertain";

type BulkInboundFormProps = {
  onSuccess: () => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
};

const PRIORITY_FIELDS = new Set<InboundBulkField>([
  "partNumber", "qty", "prodYear", "unitCost", "operator", "supplierName", "location",
]);
const DETERMINISTIC_TRPC_CODES = new Set([
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "TOO_MANY_REQUESTS",
  "UNPROCESSABLE_CONTENT",
]);

function newClientRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function beijingToday() {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => values.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isNonBlankRow(row: unknown[]) {
  return row.some(value => value != null && String(value).trim() !== "");
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "保存失败，请检查后重试";
}

function fieldErrorKey(rowKey: string, field: InboundBulkField) {
  return `${rowKey}:${field}`;
}

/**
 * Batch inbound entry content only. It is intentionally rendered inside the
 * existing inbound modal, rather than opening a second page-level dialog.
 */
export function BulkInboundForm({ onSuccess, onCancel, onDirtyChange, onBusyChange }: BulkInboundFormProps) {
  const [status, setStatus] = useState<InboundStatus>("in_transit");
  const [inboundDate, setInboundDate] = useState(beijingToday);
  const [unitCostBasis, setUnitCostBasis] = useState<InboundPriceBasis>(CNY_TAX_INCLUDED);
  const [taxRate, setTaxRate] = useState(String(DEFAULT_INBOUND_TAX_RATE));
  const [showOptionalColumns, setShowOptionalColumns] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(true);
  const [readingFile, setReadingFile] = useState(false);
  const importGeneration = useRef(0);
  const everUncertain = useRef(false);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [mapping, setMapping] = useState<InboundBulkMapping>(() => suggestInboundBulkMapping([]));
  const [drafts, setDrafts] = useState<InboundBulkDraftRow[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [fileError, setFileError] = useState("");
  const [formError, setFormError] = useState("");
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<MissingPriceConfirmation | null>(null);
  const [showMissingPriceFocus, setShowMissingPriceFocus] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [uncertainPayload, setUncertainPayload] = useState<InboundBulkCreateInput | null>(null);
  const [saveError, setSaveError] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const workbookRef = useRef<import("xlsx").WorkBook | null>(null);
  const missingPriceFocusRef = useRef<HTMLInputElement | null>(null);

  const utils = trpc.useUtils();
  const bulkCreateMutation = trpc.inbound.bulkCreate.useMutation();
  const locked = requestState !== "idle" || readingFile;
  const nonBlankSourceRows = source?.rows.filter(isNonBlankRow).length ?? 0;
  const priceHeader = `采购单价（${unitCostBasis === CNY_TAX_INCLUDED ? "含税" : "未税"}）`;
  const mappingErrors = useMemo(
    () => source ? validateInboundBulkMapping(source.headers, mapping) : [],
    [mapping, source],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(locked);
  }, [locked, onBusyChange]);

  useEffect(() => () => {
    importGeneration.current += 1;
    onDirtyChange?.(false);
    onBusyChange?.(false);
  }, [onBusyChange, onDirtyChange]);

  const snapshot = () => JSON.stringify({ status, inboundDate, unitCostBasis, taxRate, drafts });

  const markChanged = () => {
    if (locked) return false;
    setIsDirty(true);
    setClientRequestId(newClientRequestId());
    setConfirmation(null);
    setShowMissingPriceFocus(false);
    setSaveError("");
    setFormError("");
    return true;
  };

  const setImportSource = (next: ImportSource) => {
    if (!markChanged()) return;
    setSource(next);
    setMappingOpen(true);
    setMapping(suggestInboundBulkMapping(next.headers));
    setDrafts([]);
    setCellErrors({});
    setFileError(next.rows.filter(isNonBlankRow).length > INBOUND_BULK_MAX_ROWS ? `导入内容有 ${next.rows.filter(isNonBlankRow).length} 行，单批最多 ${INBOUND_BULK_MAX_ROWS} 行；请拆分后再预览。` : "");
  };

  const readWorkbookSheet = async (sheetName: string, workbook = workbookRef.current, generation = importGeneration.current) => {
    if (!workbook) return;
    const XLSX = await import("xlsx");
    if (generation !== importGeneration.current) return;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const declared = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
    if (declared.e.r >= 1002 || declared.e.c >= 128) throw new Error("工作表范围过大，请仅保留表头及数据，每批最多200行");
    const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header:1, raw:false, defval:"", blankrows:true });
    const [headerRow = [], ...rawRows] = values;
    const headers = headerRow.map((value,index)=>String(value??"").trim() || `第${index+1}列`);
    if (!headers.length || !rawRows.some(isNonBlankRow)) throw new Error("请上传含表头和数据的工作表");
      // Import commits once after parsing, while all editable controls are locked.
      setIsDirty(true); setClientRequestId(newClientRequestId()); setConfirmation(null); setSaveError("");
      setSource({headers,rows:rawRows,name:"Excel",sheetName}); setMappingOpen(true);
    setMapping(suggestInboundBulkMapping(headers));setDrafts([]);setCellErrors({});
    setFileError(rawRows.filter(isNonBlankRow).length > INBOUND_BULK_MAX_ROWS ? "每批最多200行，请拆分后上传" : "");
  };
  const selectFile = async (file: File | undefined) => {
    if (!file || locked) return;
    setFileError("");
    if (!/\.(xlsx|xls)$/i.test(file.name)) {setFileError("仅支持 .xlsx 或 .xls");return;}
    if (file.size <= 0 || file.size > INBOUND_BULK_FILE_MAX_BYTES) {setFileError("文件不能超过5MB");return;}
    const generation=++importGeneration.current;setReadingFile(true);
    try {
      const XLSX=await import("xlsx");
      const workbook=XLSX.read(await file.arrayBuffer(),{type:"array",cellText:false,cellFormula:false,sheetRows:1002});
      if(generation!==importGeneration.current)return;
      if(!workbook.SheetNames.length)throw new Error("文件中没有工作表");
      workbookRef.current=workbook;setSheetNames(workbook.SheetNames);
      await readWorkbookSheet(workbook.SheetNames[0],workbook,generation);
      if(generation===importGeneration.current)setSource(current=>current?{...current,name:file.name}:current);
    } catch(error) {if(generation===importGeneration.current)setFileError(error instanceof Error?error.message:"读取失败");}
    finally {if(generation===importGeneration.current)setReadingFile(false);}
  };
  const handleFileDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (locked) return;
    void selectFile(event.dataTransfer.files?.[0]);
  };
  const changeSheet=async(name:string)=>{
    if(locked)return;setReadingFile(true);
    try{await readWorkbookSheet(name);}catch(error){setFileError(error instanceof Error?error.message:"读取失败");}
    finally{setReadingFile(false);}
  };

  const importPaste = () => {
    if (!markChanged()) return;
    try {
      const parsed = parseInboundPaste(pasteValue);
      if (!parsed.headers.length || !parsed.rows.length) {
        setFileError("请粘贴含表头和至少一行数据的 Excel 区域");
        return;
      }
      setImportSource({ headers: parsed.headers, rows: parsed.rows, name: "Excel 粘贴" });
      setMapping(suggestInboundBulkMapping(parsed.headers));
      setDrafts([]);
      setCellErrors({});
      setFileError(parsed.rows.filter(isNonBlankRow).length > INBOUND_BULK_MAX_ROWS ? `粘贴内容有 ${parsed.rows.filter(isNonBlankRow).length} 行，单批最多 ${INBOUND_BULK_MAX_ROWS} 行；请拆分后再预览。` : "");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "粘贴内容无法解析");
    }
  };

  const changeMapping = (field: InboundBulkField, selected: string) => {
    if (!markChanged()) return;
    setMapping(current => ({ ...current, [field]: selected === "" ? null : Number(selected) }));
    setDrafts([]);
    setCellErrors({});
  };

  const buildPreview = () => {
    if (locked || !source) return;
    if (nonBlankSourceRows > INBOUND_BULK_MAX_ROWS) {
      setFileError(`导入内容有 ${nonBlankSourceRows} 行，单批最多 ${INBOUND_BULK_MAX_ROWS} 行；没有跳过任何行。`);
      return;
    }
    if (mappingErrors.length) {
      setFileError("请先修正表头对应关系");
      return;
    }
    const next = mapInboundBulkRows(source.rows, mapping);
    if (!next.length) {
      setFileError("未读取到有效数据行");
      return;
    }
    if (!markChanged()) return;
    setDrafts(next);
    setMappingOpen(false);
    setCellErrors({});
    setFileError("");
  };

  const addManualRow = () => {
    if (locked) return;
    if (drafts.length >= INBOUND_BULK_MAX_ROWS) {
      setFormError(`单批最多 ${INBOUND_BULK_MAX_ROWS} 行`);
      return;
    }
    if (!markChanged()) return;
    const sourceRow = Math.max(1, ...drafts.map(row => row.sourceRow), ...(source?.rows.map((_, index) => index + 2) ?? [1])) + 1;
    setDrafts(current => [...current, emptyInboundBulkRow(sourceRow)]);
    setCellErrors({});
  };

  const updateDraft = (rowKey: string, field: InboundBulkField, value: string) => {
    if (!markChanged()) return;
    setDrafts(current => current.map(row => row.rowKey === rowKey ? { ...row, [field]: value } : row));
    setCellErrors(current => {
      const next = { ...current };
      delete next[fieldErrorKey(rowKey, field)];
      return next;
    });
  };

  const removeDraft = (rowKey: string) => {
    if (!markChanged()) return;
    setDrafts(current => current.filter(row => row.rowKey !== rowKey));
    setCellErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${rowKey}:`))));
  };

  const validateBatchValues = () => {
    if (!validInboundDate(inboundDate)) return "请选择有效的北京日期";
    const numericTaxRate = Number(taxRate);
    if (!/^\d+(?:\.\d+)?$/.test(taxRate.trim()) || !Number.isFinite(numericTaxRate) || numericTaxRate < 0 || numericTaxRate > 13 || Math.round(numericTaxRate * 10) !== numericTaxRate * 10) {
      return "税率须为 0%–13%，最多 1 位小数";
    }
    if (!drafts.length) return "请先导入数据或新增一行";
    return "";
  };

  const validateDrafts = () => {
    const batchError = validateBatchValues();
    if (batchError) {
      setFormError(batchError);
      return null;
    }
    const result = validateInboundBulkDraft(drafts, status);
    const nextErrors: Record<string, string> = {};
    for (const error of result.errors) nextErrors[fieldErrorKey(error.rowKey, error.field)] = error.message;
    setCellErrors(nextErrors);
    if (result.errors.length) {
      setFormError(`请修正 ${result.errors.length} 处数据后再确认录入`);
      return null;
    }
    return result;
  };

  const completeSuccess = async (count: number) => {
    everUncertain.current = false;
    toast.success(`已录入 ${count} 条`);
    // Cache refresh is best effort. A successful mutation must not be presented
    // as failed merely because a refetch/invalidation is interrupted.
    try {
      await Promise.all([
        utils.inbound.list.invalidate(),
        utils.inbound.overview.invalidate(),
      ]);
    } catch {
      // Parent refreshes the list as well; preserve the successful result.
    }
    setRequestState("idle");
    setUncertainPayload(null);
    setConfirmation(null);
    setIsDirty(false);
    setSaveError("");
    onSuccess();
  };

  const submitPayload = (payload: InboundBulkCreateInput) => {
    setRequestState("saving");
    setSaveError("");
    bulkCreateMutation.mutate(payload, {
      onSuccess: result => { void completeSuccess(result.count); },
      onError: error => {
        const code = errorCode(error);
        if (everUncertain.current || !code || !DETERMINISTIC_TRPC_CODES.has(code)) {
          everUncertain.current = true;
          setRequestState("uncertain");
          setUncertainPayload(payload);
          setSaveError("结果未确认，请重试原请求，勿重复录入。");
          return;
        }
        setRequestState("idle");
        setUncertainPayload(null);
        setSaveError(errorMessage(error));
      },
    });
  };

  const requestSubmit = () => {
    if (locked) return;
    const result = validateDrafts();
    if (!result) return;
    const fingerprint = snapshot();
    if (result.missingPriceRows.length) {
      setConfirmation({ fingerprint, rows: result.rows, missingRows: result.missingPriceRows });
      setShowMissingPriceFocus(false);
      return;
    }
    submitPayload({
      clientRequestId,
      status,
      inboundDate,
      unitCostBasis,
      taxRate: Number(taxRate),
      acceptMissingPrices: false,
      rows: result.rows,
    });
  };

  const acceptMissingPrices = () => {
    if (!confirmation || locked) return;
    if (confirmation.fingerprint !== snapshot()) {
      setConfirmation(null);
      setFormError("录入内容已变化，请重新确认未填写价格的行");
      return;
    }
    submitPayload({
      clientRequestId,
      status,
      inboundDate,
      unitCostBasis,
      taxRate: Number(taxRate),
      acceptMissingPrices: true,
      rows: confirmation.rows,
    });
  };

  const returnToMissingPrices = () => {
    setConfirmation(null);
    setShowMissingPriceFocus(true);
    requestAnimationFrame(() => missingPriceFocusRef.current?.focus());
  };

  const downloadTemplate = async () => {
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.aoa_to_sheet([INBOUND_BULK_FIELDS.map(field => String(field.label))], { cellDates: false });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "批量入库");
      XLSX.writeFile(workbook, "入库批量导入模板.xlsx", { cellDates: false });
    } catch {
      setFileError("模板下载失败，请稍后重试");
    }
  };

  const setBatchField = <T,>(setter: (value: T) => void, value: T) => {
    if (!markChanged()) return;
    setter(value);
  };

  return (
    <section className="erp-ui space-y-3" data-testid="inbound-bulk-form" aria-label="批量入库">
      <div data-bulk-step="导入明细" className="inbound-entry-card">
        <div className="inbound-entry-card-title">1. 导入明细</div>
        <div className="grid gap-3 px-3 pb-3 lg:grid-cols-[minmax(360px,1fr)_auto] lg:items-stretch">
          <label
            data-testid="inbound-bulk-dropzone"
            className={`flex min-h-[88px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-5 py-3 text-center transition-colors ${locked ? "cursor-not-allowed border-[#D8DEE7] bg-[#F7F8FA] opacity-60" : "border-[#8DB7DE] bg-[#F7FBFF] hover:border-[#185FA5] hover:bg-[#F0F7FD]"}`}
            onDragOver={event => event.preventDefault()}
            onDrop={handleFileDrop}
          >
            <span className="text-[14px] font-semibold text-[#185FA5]">{readingFile ? "正在读取…" : "上传 Excel"}</span>
            <span className="mt-1 text-[12px] text-[#5F6B7A]">点击选择或拖拽文件到这里</span>
            <span className="mt-1 text-[11px] text-[#8A94A3]">自动匹配表头，也可手动调整 · .xlsx/.xls · ≤5MB · 最多 {INBOUND_BULK_MAX_ROWS} 行</span>
            <input aria-label="选择 Excel" type="file" accept=".xlsx,.xls" className="sr-only" disabled={locked} onChange={event => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          </label>
          <div className="flex min-w-[136px] flex-row gap-2 lg:flex-col lg:justify-center">
            <button type="button" className="crm-btn crm-btn-sm" disabled={locked} onClick={() => setPasteOpen(value => !value)}>{pasteOpen ? "收起粘贴" : "粘贴表格"}</button>
            <button type="button" className="crm-btn crm-btn-sm" disabled={locked} onClick={() => { void downloadTemplate(); }}>示例模板（可选）</button>
          </div>
        </div>
        {source && <div className="mx-3 mb-3 text-[12px] text-[#47637D]">已读取：{source.name}{source.sheetName ? ` · ${source.sheetName}` : ""} · {nonBlankSourceRows} 行</div>}
      </div>

      <div data-bulk-step="本批设置" className="inbound-entry-card">
        <div className="inbound-entry-card-title">2. 本批设置</div>
        <div className="inbound-form-controls grid gap-3 px-3 pb-3 md:grid-cols-4">
          <div>
            <label className="erp-field-label mb-1.5 block">批量状态 <span className="text-[#C63C3C]">*</span></label>
            <ErpSegmentedControl
              ariaLabel="批量状态"
              value={status}
              disabled={locked}
              options={[{ value: "in_transit", label: "在途" }, { value: "received", label: "直接入库" }]}
              onChange={value => setBatchField(setStatus, value)}
              variant="buttons"
              className="inbound-status-choice"
            />
          </div>
          <label className="erp-field-label block">{status === "in_transit" ? "预计到货" : "入库日期"} <span className="text-[#C63C3C]">*</span>
            <input aria-label="北京日期" type="date" className="crm-input mt-1.5 w-full" disabled={locked} value={inboundDate} onChange={event => setBatchField(setInboundDate, event.target.value)} />
          </label>
          <div>
            <label className="erp-field-label mb-1.5 block">价格类型</label>
            <ErpSegmentedControl
              ariaLabel="价格类型"
              value={unitCostBasis}
              disabled={locked}
              options={[{ value: CNY_TAX_INCLUDED, label: "含税" }, { value: CNY_TAX_EXCLUDED, label: "未税" }]}
              onChange={value => setBatchField(setUnitCostBasis, value)}
              variant="buttons"
              className="inbound-price-choice"
            />
          </div>
          <label className="erp-field-label block">{unitCostBasis === CNY_TAX_INCLUDED ? "税率 %" : "换算税率 %"}
            <input aria-label="税率" inputMode="decimal" className="crm-input mt-1.5 w-full" disabled={locked} value={taxRate} onChange={event => setBatchField(setTaxRate, event.target.value)} />
          </label>
        </div>
      </div>

      {pasteOpen && <div className="inbound-entry-card inbound-form-controls p-3">
        <label className="erp-field-label mb-1.5 block">粘贴内容</label>
        <textarea aria-label="Excel TSV" className="crm-input h-24 w-full resize-y" disabled={locked} placeholder="从 Excel 复制含表头的区域后粘贴到此处" value={pasteValue} onChange={event => setPasteValue(event.target.value)} />
        <div className="mt-2 flex justify-end"><button type="button" className="crm-btn crm-btn-sm crm-btn-primary" disabled={locked} onClick={importPaste}>读取粘贴</button></div>
      </div>}

      {sheetNames.length > 1 && <label className="erp-field-label block">工作表
        <select aria-label="工作表" className="crm-input ml-2 min-w-40" disabled={locked} value={source?.sheetName ?? sheetNames[0]} onChange={event => { void changeSheet(event.target.value); }}>
          {sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>}

      {source && <div className="inbound-entry-card p-3" data-testid="inbound-bulk-mapping">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-medium text-[#303642]">表头对应 <span className="font-normal text-[#8A94A3]">{source.name}{source.sheetName ? ` · ${source.sheetName}` : ""} · {nonBlankSourceRows} 行</span></div>
          <div className="flex gap-2">{drafts.length > 0 && <button type="button" className="crm-btn crm-btn-sm" disabled={locked} onClick={() => setMappingOpen(value => !value)}>{mappingOpen ? "收起对应" : "修改对应"}</button>}{mappingOpen && <button type="button" className="crm-btn crm-btn-sm crm-btn-primary" disabled={locked || nonBlankSourceRows > INBOUND_BULK_MAX_ROWS} onClick={buildPreview}>预览</button>}</div>
        </div>
        <div hidden={!mappingOpen} className={mappingOpen ? "grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3" : "hidden"}>
          {INBOUND_BULK_FIELDS.map(field => <label key={field.key} className="flex items-center gap-2 text-[12px] text-slate-600">
            <span className="w-24 shrink-0 truncate">{field.label}{field.required ? " *" : ""}</span>
            <select aria-label={`${field.label}对应列`} className={`crm-input h-8 min-w-0 flex-1 text-[12px] ${mappingErrors.some(error => error.includes(field.label)) ? "border-[#C63C3C]" : ""}`} disabled={locked} value={mapping[field.key] ?? ""} onChange={event => changeMapping(field.key, event.target.value)}>
              <option value="">不导入</option>
              {source.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>第{index + 1}列 · {header}</option>)}
            </select>
          </label>)}
        </div>
        {mappingErrors.length > 0 && <div className="mt-2 space-y-1" role="alert">{mappingErrors.map(error => <ErpHelperText key={error} tone="danger">{error}</ErpHelperText>)}</div>}
      </div>}

      <div data-testid="inbound-bulk-preview" data-bulk-step="明细预览" className="inbound-entry-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E3E8EF] px-3 py-2">
          <div className="text-[13px] font-semibold text-[#303642]">3. 明细预览 <span className="font-normal text-[#8A94A3]">{drafts.length} / {INBOUND_BULK_MAX_ROWS} 行</span></div>
          <div className="flex gap-2">
            <button type="button" className="crm-btn crm-btn-sm" aria-pressed={showOptionalColumns} onClick={() => setShowOptionalColumns(value => !value)}>{showOptionalColumns ? "收起更多字段" : "显示更多字段"}</button>
            <button type="button" className="crm-btn crm-btn-sm" disabled={locked || drafts.length >= INBOUND_BULK_MAX_ROWS} onClick={addManualRow}>新增行</button>
          </div>
        </div>
        <div className="inbound-bulk-table-scroll overflow-auto">
          <table className={`crm-table text-[12px] ${showOptionalColumns ? "min-w-[1620px]" : "min-w-[1120px]"}`}>
            <thead><tr>
              <th className="sticky left-0 z-30 w-[72px] min-w-[72px] bg-[#FAFAFA]">行</th>
              {INBOUND_BULK_FIELDS.filter(field => showOptionalColumns || PRIORITY_FIELDS.has(field.key)).map(field => <th key={field.key} className={field.key === "partNumber" ? "sticky left-[72px] z-20 min-w-[180px] bg-[#FAFAFA]" : undefined}>{field.key === "unitCost" ? priceHeader : field.label}{field.required || (field.key === "location" && status === "received") ? " *" : ""}</th>)}
              <th className="sticky right-0 z-20 bg-[#FAFAFA]">操作</th>
            </tr></thead>
            <tbody>
              {!drafts.length && <tr><td colSpan={(showOptionalColumns ? INBOUND_BULK_FIELDS.length : PRIORITY_FIELDS.size) + 2} className="py-8 text-center text-[#8A94A3]">上传文件或新增行</td></tr>}
              {drafts.map(row => <tr key={row.rowKey}>
                <td className="sticky left-0 z-20 w-[72px] min-w-[72px] whitespace-nowrap bg-white text-[12px] text-[#6B7280]">第{row.sourceRow}行</td>
                {INBOUND_BULK_FIELDS.filter(field => showOptionalColumns || PRIORITY_FIELDS.has(field.key)).map(field => {
                  const error = cellErrors[fieldErrorKey(row.rowKey, field.key)];
                  const missingPrice = field.key === "unitCost" && showMissingPriceFocus && !row.unitCost.trim();
                  return <td key={field.key} className={`${field.key === "partNumber" ? "sticky left-[72px] z-10 min-w-[180px] bg-white" : "min-w-[122px]"} p-1.5 align-top`}>
                    <input
                      ref={missingPrice && row.rowKey === drafts.find(item => !item.unitCost.trim())?.rowKey ? missingPriceFocusRef : undefined}
                      aria-label={`第${row.sourceRow}行${field.label}`}
                      className={`crm-input h-8 w-full px-2 text-[12px] ${field.key === "partNumber" ? "min-w-[168px]" : "min-w-[110px]"} ${error || missingPrice ? "border-[#C63C3C] bg-[#FFF8F8]" : ""}`}
                      data-missing-price={missingPrice || undefined}
                      disabled={locked}
                      maxLength={field.maxLength}
                      value={row[field.key]}
                      onChange={event => updateDraft(row.rowKey, field.key, event.target.value)}
                    />
                    {error && <div className="mt-1 max-w-[140px] text-[11px] leading-4 text-[#C63C3C]">{error}</div>}
                  </td>;
                })}
                <td className="sticky right-0 z-10 bg-white p-1.5"><button type="button" className="text-[12px] text-[#B42318] disabled:opacity-50" disabled={locked} aria-label={`删除第${row.sourceRow}行`} onClick={() => removeDraft(row.rowKey)}>删除</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {(fileError || formError || saveError) && <div role="alert" className="rounded-md border border-[#F1C7C7] bg-[#FFF8F8] px-3 py-2 text-[12px] text-[#B42318]">{saveError || formError || fileError}</div>}

      {confirmation && <div role="alertdialog" aria-modal="false" aria-labelledby="inbound-missing-price-title" className="rounded-lg border border-[#E7C78C] bg-[#FFF9EF] p-3 shadow-sm">
        <h3 id="inbound-missing-price-title" className="text-[14px] font-semibold text-[#704D00]">价格未填写</h3>
        <p className="mt-1 text-[12px] text-[#704D00]">有 {confirmation.missingRows.length} 条物料未填写价格，将按 0 元录入。</p>
        <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto text-[12px] text-[#704D00]">
          {confirmation.missingRows.map(row => <li key={row.rowKey}>第{row.sourceRow}行 · {row.partNumber || "未填料号"} · 数量 {row.qty || "未填"}</li>)}
        </ul>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="crm-btn crm-btn-sm" disabled={locked} onClick={returnToMissingPrices}>返回编辑</button>
          <button type="button" className="crm-btn crm-btn-sm crm-btn-primary" disabled={locked} onClick={acceptMissingPrices}>按 0 元录入</button>
        </div>
      </div>}

      {requestState === "uncertain" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E7C78C] bg-[#FFF9EF] px-3 py-2">
        <span className="text-[12px] text-[#704D00]">已保留原请求，暂不可编辑。</span>
        <button type="button" className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => uncertainPayload && submitPayload(uncertainPayload)}>重试原请求</button>
      </div>}

      <div className="inbound-entry-actions">
        {onCancel && <button type="button" className="crm-btn" disabled={locked} onClick={onCancel}>取消</button>}
        <button type="button" className="crm-btn crm-btn-primary" disabled={locked || !drafts.length} onClick={requestSubmit}>{requestState === "saving" ? "录入中…" : "确认录入"}</button>
      </div>
    </section>
  );
}

export default BulkInboundForm;
