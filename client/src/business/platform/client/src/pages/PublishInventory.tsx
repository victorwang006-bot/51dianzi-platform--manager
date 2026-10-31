import {
  usePageMemory,
  useRememberedState,
  freshListOptions,
  useRestoringListQuery,
  returnToPageSource,
} from "../hooks/usePageMemory";
import { useMemo, useState } from "react";
import {
  NOTE_MAX_LENGTH,
  detectForbiddenContent,
} from "../../../shared/contentModeration";
import { useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { showInventoryImportNotice } from "../lib/inventoryImportNotice";
import { trpc } from "../../../../api/business-trpc";
import { createClientMessageId } from "../lib/clientMessageId";
import {
  formatInventoryQuantity,
  inventoryQuantityDisplay,
} from "../lib/inventoryQuantityDisplay";
import {
  formatInventoryImportFailure,
  formatInventorySubmissionFailure,
  type InventoryImportFailurePhase,
} from "../lib/inventoryImportErrorMessage";
import {
  readInventoryImportUploadPlan,
  splitInventoryImportStageBatches,
  verifyInventoryImportUploadPlanRows,
} from "../lib/inventoryImportUploadPlan";
import {
  loadSimplifiedInventoryImportMapping,
  saveSimplifiedInventoryImportMapping,
  suggestSimplifiedInventoryColumnMapping,
  type SimplifiedInventoryColumnMapping,
} from "../lib/simplifiedInventoryImport";
import {
  useSimplifiedInventoryImport,
  type SimplifiedImportSubmissionPayload,
} from "../hooks/useSimplifiedInventoryImport";
import { useAuth } from "../../../../api/business-auth";
import { ImportRepairs } from "../components/ImportRepairs";
import {
  clearFormDraft,
  FORM_DRAFT_IDS,
  formatDraftTime,
  isFormDirty,
  loadFormDraft,
  saveFormDraft,
} from "../lib/formDraftStore";
import {
  INVENTORY_FAILED_ROW_EXPORT_HEADERS,
  INVENTORY_IMPORT_FIELDS,
  inventoryFailedRowToExportValues,
  parseInventoryRowsWithMapping,
  suggestInventoryColumnMapping,
  suggestInventoryTaxIncluded,
  validateInventoryColumnMapping,
  type InventoryColumnMapping,
  type InventoryFailedRowForExport,
  type InventoryImportFieldKey,
  type InventoryImportRow,
  type InventoryRejectedImportRow,
} from "../lib/inventoryExcelMapping";
import PlatformLayout from "../../../../BusinessContentFrame";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { CATEGORIES, PACKAGES } from "../../../shared/options";
import {
  INVENTORY_IMPORT_ERROR_PAGE_SIZE,
  INVENTORY_IMPORT_JOB_ROW_LIMIT,
} from "../../../shared/inventoryImport";
import { MAX_INVENTORY_LADDER_TIERS } from "../../../shared/inventoryAvailability";
import { INVENTORY_LIST_DEFAULT_PAGE_SIZE } from "../../../shared/inventorySafetyLimits";
import {
  INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH,
  INVENTORY_UPLOAD_NOTE_MAX_LENGTH,
  INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH,
  type InventoryFlexibleImportFieldKey,
  type InventoryImportFixedValues,
} from "../../../shared/inventoryUploadLimits";
import { ComboInput } from "../components/ComboInput";
import {
  ErpHelperText,
  ErpSectionTitle,
  ErpSegmentedControl,
} from "../components/erp/ErpFormControls";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardPaste,
  Columns3,
  FileSpreadsheet,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

type LadderTier = { minQty: string; price: string };

export type InventoryPhoto = {
  key: string;
  url: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
};

export type FormState = {
  partNumber: string;
  brand: string;
  category: string;
  pkg: string;
  dateCode: string;
  qtyOnSale: string;
  qtyOrder: string;
  /** Compatibility-only: publishing always derives this from qtyOnSale. */
  qtyStock: string;
  priceEx: string;
  taxIncluded: boolean;
  invoice: boolean;
  ladderPrices: LadderTier[];
  moq: string;
  spq: string;
  leadTime: string;
  warehouseAddress: string;
  rohs: boolean;
  note: string;
  photos: InventoryPhoto[];
};

const PUBLISH_PART_NUMBER_LOOKUP_LIMIT = 20;
const PUBLISH_PART_NUMBER_LOOKUP_MIN_LENGTH = 2;
const PUBLISH_PART_NUMBER_LOOKUP_SHORT_DEBOUNCE_MS = 600;
const PUBLISH_PART_NUMBER_LOOKUP_NORMAL_DEBOUNCE_MS = 300;

export const EMPTY_FORM: FormState = {
  partNumber: "",
  brand: "",
  category: "",
  pkg: "",
  dateCode: "",
  qtyOnSale: "",
  qtyOrder: "",
  qtyStock: "",
  priceEx: "",
  taxIncluded: true,
  invoice: true,
  ladderPrices: [],
  moq: "",
  spq: "",
  leadTime: "",
  warehouseAddress: "",
  rohs: true,
  note: "",
  photos: [],
};

function digits(v: string) {
  return v.replace(/\D/g, "");
}
function decimal(v: string) {
  return v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}
/** 表单转后端 payload */
export function toPayload(f: FormState) {
  const parsedQtyOnSale = parseInt(f.qtyOnSale, 10);
  const qtyOnSale =
    Number.isSafeInteger(parsedQtyOnSale) && parsedQtyOnSale >= 0
      ? parsedQtyOnSale
      : 0;
  const parsedQtyOrder = parseInt(f.qtyOrder, 10);
  const qtyOrder =
    f.qtyOrder.trim() &&
    Number.isSafeInteger(parsedQtyOrder) &&
    parsedQtyOrder >= 0
      ? parsedQtyOrder
      : null;
  return {
    partNumber: f.partNumber.trim(),
    brand: f.brand.trim(),
    category: f.category.trim(),
    pkg: f.pkg.trim() || undefined,
    dateCode: f.dateCode.trim() || undefined,
    qtyOnSale,
    qtyOrder,
    // The persisted field remains for schema/order compatibility, but this
    // simplified form has one quantity and never accepts a second stock value.
    qtyStock: qtyOnSale,
    priceEx:
      f.priceEx.trim() && parseFloat(f.priceEx) > 0
        ? parseFloat(f.priceEx)
        : undefined,
    taxIncluded: f.taxIncluded,
    invoice: f.invoice,
    ladderPrices: f.ladderPrices
      .filter(t => t.minQty && t.price)
      .map(t => ({ minQty: parseInt(t.minQty), price: parseFloat(t.price) })),
    moq: f.moq ? parseInt(f.moq) : undefined,
    spq: f.spq ? parseInt(f.spq) : undefined,
    leadTime: f.leadTime.trim(),
    warehouseAddress: f.warehouseAddress.trim() || undefined,
    rohs: f.rohs,
    note: f.note.trim() || undefined,
    photos: f.photos,
  };
}

/**
 * 表单校验。
 *
 * `mode` 区分新增与编辑：生产周期仅在**新增**时必填。
 * 生产库存 6166 条中 5032 条批号为空（4914 条在售），
 * 若编辑时也强制，这些商家只是改个价格也会被拦下。
 * 服务端同步采用这一口径（inventoryCreateSchema 仅用于 create）。
 */
export function validateForm(
  f: FormState,
  mode: "create" | "edit" = "create"
): string | null {
  // 校验顺序与页面 DOM 一致，使提交失败时的自动定位落在用户看到的首个问题字段。
  if (!f.partNumber.trim()) return "请输入型号";
  if (!f.brand.trim()) return "请输入品牌";
  // 新增时必填：买家选型强依赖年份，缺失会直接导致询价无法推进。
  if (mode === "create" && !f.dateCode.trim())
    return "请输入生产周期（Date Code）";
  if (f.dateCode.trim().length > 32) return "生产周期最多 32 个字符";
  if (!f.leadTime.trim()) return "请输入货期";
  if (f.leadTime.trim().length > INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH)
    return `货期最多${INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH}个字符`;
  const qtyOnSale = f.qtyOnSale.trim() ? parseInt(f.qtyOnSale, 10) : 0;
  const qtyOrder = f.qtyOrder.trim() ? parseInt(f.qtyOrder, 10) : null;
  if (!Number.isSafeInteger(qtyOnSale) || qtyOnSale < 0)
    return "现货库存须为非负整数";
  if (qtyOrder !== null && (!Number.isSafeInteger(qtyOrder) || qtyOrder < 0))
    return "订货库存须为非负整数";
  const hasSpotInventory = qtyOnSale > 0;
  const hasOrderInventory = qtyOrder !== null && qtyOrder > 0;
  if (mode === "create" && !hasSpotInventory && !hasOrderInventory)
    return "请至少填写现货库存或订货库存";
  if (!hasSpotInventory && hasOrderInventory && f.leadTime.trim() !== "订货")
    return "纯订货的货期须填写“订货”";

  // 含税单价可留空表示面议；未税价仍必须提供单价或至少一档阶梯价。
  if (f.priceEx.trim() && !(parseFloat(f.priceEx) > 0))
    return "单价须大于 0，或留空表示价格面议";
  const hasLadderPrice = f.ladderPrices.some(tier => Number(tier.price) > 0);
  if (!f.taxIncluded && !(Number(f.priceEx) > 0) && !hasLadderPrice)
    return "选择未税价时请填写单价或阶梯价";

  // 以下均为选填字段；分类与封装只在填写后校验格式。
  if (f.category.trim().length > 32) return "分类最多 32 个字符";
  if (f.pkg.trim().length > 32) return "封装最多 32 个字符";
  for (const t of f.ladderPrices) {
    if ((t.minQty && !t.price) || (!t.minQty && t.price))
      return "阶梯价的数量与单价须成对填写";
    if (t.minQty && parseInt(t.minQty) <= 0) return "阶梯数量须为正整数";
    if (t.price && parseFloat(t.price) <= 0) return "阶梯单价须大于0";
  }
  if (f.moq.trim() && parseInt(f.moq) <= 0) return "最小起订量须为正整数";
  if (f.spq.trim() && parseInt(f.spq) <= 0) return "整包数量须为正整数";
  const warehouseMaxLength =
    mode === "create" ? INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH : 255;
  if (f.warehouseAddress.trim().length > warehouseMaxLength)
    return `仓库地址最多${warehouseMaxLength}个字符`;
  /*
   * 备注说明会在前台公开展示，故在提交前先拦一道。
   * 服务端 zod 仍会重复校验（接口可绕过前端），
   * 此处的作用是把错误提示提前到点击保存的那一刻。
   */
  const note = f.note.trim();
  const noteMaxLength =
    mode === "create" ? INVENTORY_UPLOAD_NOTE_MAX_LENGTH : NOTE_MAX_LENGTH;
  if (note.length > noteMaxLength) return `物料备注最多 ${noteMaxLength} 个字`;
  const noteCheck = detectForbiddenContent(note);
  if (!noteCheck.ok) return noteCheck.message;
  return null;
}

export function inventoryValidationField(message: string) {
  if (/阶梯价的数量与单价/.test(message)) return "ladderPrices";
  if (/型号|料号/.test(message)) return "partNumber";
  if (/品牌/.test(message)) return "brand";
  if (/分类/.test(message)) return "category";
  if (/封装/.test(message)) return "pkg";
  if (/生产周期|Date Code/.test(message)) return "dateCode";
  if (/现货库存|上架数量|至少填写/.test(message)) return "qtyOnSale";
  if (/订货库存|纯订货/.test(message)) return "qtyOrder";
  if (/单价|未税价|阶梯价/.test(message)) return "priceEx";
  if (/货期|交期/.test(message)) return "leadTime";
  if (/仓库地址/.test(message)) return "warehouseAddress";
  if (/备注/.test(message)) return "note";
  return null;
}

/** 阶梯价编辑区块（表单/编辑弹窗共用） */
function LadderEditor({
  tiers,
  onChange,
  taxIncluded,
}: {
  tiers: LadderTier[];
  onChange: (tiers: LadderTier[]) => void;
  taxIncluded: boolean;
}) {
  return (
    <div className="space-y-2">
      {tiers.map((tier, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-8 shrink-0">
            第{i + 1}档
          </span>
          <Input
            className="h-8"
            placeholder="数量 ≥"
            value={tier.minQty}
            onChange={e => {
              const next = [...tiers];
              next[i] = { ...tier, minQty: digits(e.target.value) };
              onChange(next);
            }}
          />
          <Input
            className="h-8"
            placeholder={`${taxIncluded ? "含税" : "未税"}单价（元）`}
            value={tier.price}
            onChange={e => {
              const next = [...tiers];
              next[i] = { ...tier, price: decimal(e.target.value) };
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(tiers.filter((_, j) => j !== i))}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      {tiers.length < MAX_INVENTORY_LADDER_TIERS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => onChange([...tiers, { minQty: "", price: "" }])}
        >
          <Plus className="w-3.5 h-3.5" /> 添加阶梯价（最多
          {MAX_INVENTORY_LADDER_TIERS}档）
        </Button>
      )}
      {tiers.length === 0 && (
        <p className="text-xs text-muted-foreground">
          未设置阶梯价时按含税单价统一报价
        </p>
      )}
    </div>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function InventoryPhotoUploader({
  photos,
  onChange,
}: {
  photos: InventoryPhoto[];
  onChange: (photos: InventoryPhoto[]) => void;
}) {
  const [uploadingName, setUploadingName] = useState("");
  const uploadMutation = trpc.inventory.uploadPhoto.useMutation();
  const remaining = Math.max(0, 5 - photos.length);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files.slice(0, remaining);
    if (selected.length < files.length) toast.warning("库存照片最多上传 5 张");
    const uploaded: InventoryPhoto[] = [];
    for (const file of selected) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error(`${file.name} 格式不支持`, {
          description: "请上传 JPG、PNG 或 WebP 图片",
        });
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} 超过 5MB`);
        continue;
      }
      try {
        setUploadingName(file.name);
        const base64 = await fileToBase64(file);
        const photo = await uploadMutation.mutateAsync({
          fileName: file.name,
          mimeType: file.type as InventoryPhoto["mimeType"],
          base64,
        });
        uploaded.push(photo);
      } catch (error) {
        const message = error instanceof Error ? error.message : "图片上传失败";
        toast.error(`${file.name} 上传失败`, { description: message });
      }
    }
    if (uploaded.length > 0) {
      onChange([...photos, ...uploaded].slice(0, 5));
      toast.success(`已上传 ${uploaded.length} 张照片`);
    }
    setUploadingName("");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {photos.map(photo => (
          <div
            key={photo.key}
            className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/30"
          >
            <img
              src={photo.url}
              alt={photo.name}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              aria-label={`移除照片 ${photo.name}`}
              className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white opacity-100 transition-opacity hover:bg-black/80 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              onClick={() =>
                onChange(photos.filter(item => item.key !== photo.key))
              }
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {remaining > 0 && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 px-3 text-center transition-colors hover:border-[#185FA5] hover:bg-[#f7faff]">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              disabled={Boolean(uploadingName)}
              onChange={event => {
                void uploadFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            {uploadingName ? (
              <Loader2 className="h-5 w-5 animate-spin text-[#185FA5]" />
            ) : (
              <ImagePlus className="h-5 w-5 text-[#185FA5]" />
            )}
            <span className="text-[12px] font-medium text-[#185FA5]">
              {uploadingName ? "上传中" : "上传照片"}
            </span>
          </label>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        支持 JPG、PNG、WebP，单张不超过 5MB，最多 5 张。上传后仍需保存库存记录。
        {uploadingName ? ` 正在上传：${uploadingName}` : ""}
      </p>
    </div>
  );
}

type InventoryRecognitionPreview = {
  source: "rules" | "hybrid";
  values: {
    partNumber: string;
    brand: string;
    category: string;
    pkg: string;
    dateCode: string;
    qtyOnSale: number | null;
    priceEx: number | null;
    taxIncluded: boolean | null;
    moq: number | null;
    spq: number | null;
    leadTime: string;
    warehouseAddress: string;
    note: string;
  };
  warnings: string[];
  recognizedFields: string[];
  multiplePartNumbers: boolean;
};

function InventoryTextPaste({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<InventoryRecognitionPreview | null>(
    null
  );
  const recognizeMutation = trpc.inventory.recognizeText.useMutation({
    onSuccess: result => setPreview(result),
    onError: error => toast.error(error.message),
  });

  const applyPreview = () => {
    if (!preview || preview.multiplePartNumbers) return;
    const values = preview.values;
    const conflicts: string[] = [];
    const applyText = (current: string, next: string, label: string) => {
      if (!next) return current;
      if (current.trim() && current.trim() !== next.trim()) {
        conflicts.push(label);
        return current;
      }
      return current || next;
    };
    setForm(current => ({
      ...current,
      partNumber: applyText(current.partNumber, values.partNumber, "型号"),
      brand: applyText(current.brand, values.brand, "品牌"),
      category: applyText(current.category, values.category, "分类"),
      pkg: applyText(current.pkg, values.pkg, "封装"),
      dateCode: applyText(current.dateCode, values.dateCode, "生产周期"),
      qtyOnSale: applyText(
        current.qtyOnSale,
        values.qtyOnSale == null ? "" : String(values.qtyOnSale),
        "上架数量"
      ),
      priceEx: applyText(
        current.priceEx,
        values.priceEx == null ? "" : String(values.priceEx),
        "单价"
      ),
      moq: applyText(
        current.moq,
        values.moq == null ? "" : String(values.moq),
        "MOQ"
      ),
      spq: applyText(
        current.spq,
        values.spq == null ? "" : String(values.spq),
        "SPQ"
      ),
      leadTime: applyText(current.leadTime, values.leadTime, "货期"),
      warehouseAddress: applyText(
        current.warehouseAddress,
        values.warehouseAddress,
        "仓库地址"
      ),
      note: applyText(current.note, values.note, "备注"),
      taxIncluded:
        values.taxIncluded == null || current.priceEx.trim()
          ? current.taxIncluded
          : values.taxIncluded,
    }));
    toast.success("识别结果已填入空字段", {
      description: conflicts.length
        ? `已保留手工内容，未覆盖：${Array.from(new Set(conflicts)).join("、")}`
        : "请核对后再保存或发布",
    });
  };

  const summary = preview
    ? [
        preview.values.partNumber,
        preview.values.brand,
        preview.values.qtyOnSale
          ? `${preview.values.qtyOnSale.toLocaleString("zh-CN")}片`
          : "",
        preview.values.priceEx ? `¥${preview.values.priceEx}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="mb-5 rounded-lg border border-[#cfe0ef] bg-[#f8fbfe]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <ClipboardPaste className="h-4 w-4 shrink-0 text-[#185FA5]" />
        <span className="text-[13px] font-medium">粘贴库存信息（选填）</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {summary || "粘贴微信、邮件或库存文字，识别后填入下方表单"}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-[#dce8f3] px-3.5 py-3">
          <Textarea
            value={text}
            maxLength={5000}
            rows={4}
            placeholder="例如：STM32F407VGT6，ST，LQFP100，Date Code 2335，现货5000片，含税8.5元，MOQ 100，深圳仓，3天发货"
            onChange={event => {
              setText(event.target.value);
              setPreview(null);
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-[11px] text-muted-foreground">
              {text.length}/5000；第一期每次识别一条库存
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="sm:ml-auto"
              disabled={text.trim().length < 2 || recognizeMutation.isPending}
              onClick={() => recognizeMutation.mutate({ text })}
            >
              {recognizeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              识别库存信息
            </Button>
          </div>
          {preview && (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${preview.multiplePartNumbers ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
            >
              <div className="font-medium">
                {preview.multiplePartNumbers
                  ? "检测到多条库存，暂不填入"
                  : summary ||
                    `已识别 ${preview.recognizedFields.length} 个字段`}
              </div>
              {preview.warnings.map((warning, index) => (
                <div key={`${warning}-${index}`} className="mt-1">
                  {warning}
                </div>
              ))}
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 bg-[#185FA5] text-xs hover:bg-[#0C447C]"
                  disabled={preview.multiplePartNumbers}
                  onClick={applyPreview}
                >
                  确认填入表单
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 库存录入表单字段（新增与编辑共用） */
export function InventoryFormFields({
  form,
  setForm,
  mode = "create",
  errorFields = [],
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  /** 批号仅在新增时必填，编辑存量数据时不强制（详见 validateForm 注释） */
  mode?: "create" | "edit";
  errorFields?: string[];
}) {
  const set = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }));
  const warehouseMaxLength =
    mode === "create" ? INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH : 255;
  const noteMaxLength =
    mode === "create" ? INVENTORY_UPLOAD_NOTE_MAX_LENGTH : NOTE_MAX_LENGTH;

  /*
   * 备注违禁词即时检测。
   *
   * 用 useMemo 避免每次重渲染都重跑正则；词库包含上百个词条，
   * 而本组件会因其他字段输入高频重渲染。
   */
  const noteVerdict = useMemo(
    () => detectForbiddenContent(form.note),
    [form.note]
  );

  // ── 型号模糊搜索状态 ──────────────────────────────────────────
  const [lookupKeyword, setLookupKeyword] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeLookupKeywordRef = useRef("");
  const containerRef = useRef<HTMLDivElement>(null);
  const lookupUtils = trpc.useUtils();

  // 短前缀命中范围大、输入变化快，使用更长防抖；完整型号则保持快速反馈。
  // 新字符一输入便取消上一关键词的在途请求，避免旧结果抢先返回造成下拉闪烁。
  const handlePartNumberChange = useCallback(
    (value: string) => {
      // 型号字母按行业惯例统一大写；数字、连字符、斜杠和中文均保持原样。
      const normalizedValue = value.toUpperCase();
      set({ partNumber: normalizedValue });
      const nextKeyword = normalizedValue.trim();
      const activeKeyword = activeLookupKeywordRef.current;
      if (activeKeyword && activeKeyword !== nextKeyword) {
        void lookupUtils.material.lookup.cancel({
          keyword: activeKeyword,
          limit: PUBLISH_PART_NUMBER_LOOKUP_LIMIT,
        });
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const delay =
        nextKeyword.length <= PUBLISH_PART_NUMBER_LOOKUP_MIN_LENGTH
          ? PUBLISH_PART_NUMBER_LOOKUP_SHORT_DEBOUNCE_MS
          : PUBLISH_PART_NUMBER_LOOKUP_NORMAL_DEBOUNCE_MS;
      debounceRef.current = setTimeout(() => {
        activeLookupKeywordRef.current = nextKeyword;
        setLookupKeyword(nextKeyword);
        setDropdownOpen(
          nextKeyword.length >= PUBLISH_PART_NUMBER_LOOKUP_MIN_LENGTH
        );
      }, delay);
    },
    // `set` 是本地表单封装函数，稳定按当前组件生命周期使用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookupUtils]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const activeKeyword = activeLookupKeywordRef.current;
      if (activeKeyword) {
        void lookupUtils.material.lookup.cancel({
          keyword: activeKeyword,
          limit: PUBLISH_PART_NUMBER_LOOKUP_LIMIT,
        });
      }
    };
  }, [lookupUtils]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 调用代理接口获取候选列表
  const { data: lookupResults, isFetching: lookupFetching } =
    trpc.material.lookup.useQuery(
      { keyword: lookupKeyword, limit: PUBLISH_PART_NUMBER_LOOKUP_LIMIT },
      {
        enabled: lookupKeyword.length >= PUBLISH_PART_NUMBER_LOOKUP_MIN_LENGTH,
        staleTime: 30_000,
      }
    );

  // 选中候选项：填充型号、品牌、分类、封装
  const handleSelectCandidate = useCallback(
    (item: {
      partNumber: string;
      brand: string;
      category: string;
      package: string;
    }) => {
      set({
        partNumber: item.partNumber,
        brand: item.brand || form.brand,
        category: item.category || form.category,
        pkg: item.package || form.pkg,
      });
      setLookupKeyword(item.partNumber);
      setDropdownOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.brand, form.category, form.pkg]
  );

  return (
    <div className="space-y-5">
      {/* 仅保留真正必填的字段在顶部；桌面端继续使用紧凑双列布局。 */}
      <div>
        <ErpSectionTitle>必填信息</ErpSectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            data-inventory-field="partNumber"
            className={`space-y-1.5 ${errorFields.includes("partNumber") ? "rounded-md border border-red-300 bg-red-50/60 p-2" : ""}`}
          >
            <Label>
              型号 <span className="text-destructive">*</span>
            </Label>
            <div ref={containerRef} className="relative">
              <Input
                placeholder="如:STM32F103C8T6；输入越完整，联想越快"
                value={form.partNumber}
                autoComplete="off"
                onChange={e => handlePartNumberChange(e.target.value)}
                onFocus={() => {
                  if (
                    lookupKeyword.length >=
                      PUBLISH_PART_NUMBER_LOOKUP_MIN_LENGTH &&
                    lookupResults &&
                    lookupResults.length > 0
                  )
                    setDropdownOpen(true);
                }}
              />
              {lookupFetching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {dropdownOpen && lookupResults && lookupResults.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                  {lookupResults.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#f0f6fd] flex items-center justify-between gap-2 border-b border-border/40 last:border-0"
                      onMouseDown={e => {
                        e.preventDefault();
                        handleSelectCandidate(item);
                      }}
                    >
                      <span className="font-medium text-[#185FA5] truncate">
                        {item.partNumber}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1.5">
                        {item.brand && (
                          <span className="bg-[#e8f0fb] text-[#185FA5] px-1.5 py-0.5 rounded">
                            {item.brand}
                          </span>
                        )}
                        {item.category && (
                          <span className="text-gray-400 truncate max-w-[120px]">
                            {item.category}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                  {lookupResults.length >= PUBLISH_PART_NUMBER_LOOKUP_LIMIT &&
                    lookupKeyword.length < 8 && (
                      <div className="border-t border-border/40 px-3 py-2 text-[12px] text-muted-foreground">
                        匹配型号较多，请继续输入更多型号字符以缩小范围
                      </div>
                    )}
                </div>
              )}
              {dropdownOpen &&
                lookupKeyword.length >= PUBLISH_PART_NUMBER_LOOKUP_MIN_LENGTH &&
                !lookupFetching &&
                lookupResults?.length === 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-md shadow-sm px-3 py-2 text-sm text-muted-foreground">
                    未找到匹配型号，可手动输入
                  </div>
                )}
            </div>
            {errorFields.includes("partNumber") && (
              <p className="text-[11px] text-red-600">
                该型号与已发布库存重复，请修改型号或处理原库存
              </p>
            )}
          </div>
          <div data-inventory-field="brand" className="space-y-1.5">
            <Label>
              品牌 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="如:GigaDevice"
              value={form.brand}
              onChange={e => set({ brand: e.target.value })}
            />
          </div>
          <div data-inventory-field="dateCode" className="space-y-1.5">
            <Label>
              生产周期（Date Code）
              {mode === "create" && (
                <>
                  {" "}
                  <span className="text-destructive">*</span>
                </>
              )}
            </Label>
            <Input
              placeholder="如:2335"
              value={form.dateCode}
              maxLength={32}
              onChange={e => set({ dateCode: e.target.value })}
            />
            {mode === "edit" && !form.dateCode.trim() && (
              <p className="text-[11px] text-muted-foreground">
                建议补充，填写后更容易获得询价
              </p>
            )}
          </div>
          <div data-inventory-field="leadTime" className="space-y-1.5">
            <Label>
              货期 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="如：现货、3天"
              value={form.leadTime}
              maxLength={5}
              onChange={e => set({ leadTime: e.target.value })}
            />
            <ErpHelperText>最多输入5个字符</ErpHelperText>
          </div>
          <div
            data-inventory-field="qtyOnSale"
            className={`space-y-1.5 ${errorFields.includes("qtyOnSale") ? "rounded-md border border-red-300 bg-red-50/60 p-2" : ""}`}
          >
            <Label>现货库存</Label>
            <Input
              placeholder="可填 0"
              value={form.qtyOnSale}
              onChange={e => set({ qtyOnSale: digits(e.target.value) })}
            />
            {errorFields.includes("qtyOnSale") && (
              <p className="text-[11px] text-red-600">请填写非负整数</p>
            )}
          </div>
          <div
            data-inventory-field="qtyOrder"
            className={`space-y-1.5 ${errorFields.includes("qtyOrder") ? "rounded-md border border-red-300 bg-red-50/60 p-2" : ""}`}
          >
            <Label>订货库存</Label>
            <Input
              placeholder="选填"
              value={form.qtyOrder}
              onChange={e => set({ qtyOrder: digits(e.target.value) })}
            />
            {errorFields.includes("qtyOrder") && (
              <p className="text-[11px] text-red-600">请填写非负整数</p>
            )}
          </div>
        </div>
      </div>

      {/* 价格为选填，但紧跟必填区，便于先完成报价。 */}
      <div>
        <ErpSectionTitle>价格信息（选填）</ErpSectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div data-inventory-field="taxIncluded" className="space-y-1.5">
            <Label>价格类型</Label>
            <ErpSegmentedControl
              ariaLabel="价格类型"
              value={form.taxIncluded}
              options={[
                { value: true, label: "含税" },
                { value: false, label: "未税" },
              ]}
              onChange={taxIncluded => set({ taxIncluded })}
            />
            {form.taxIncluded ? (
              <ErpHelperText>该价格为含税价格</ErpHelperText>
            ) : (
              <ErpHelperText tone="warning">
                前台仅展示未税价并关闭直接购买，请确保价格真实准确；含税价格、发票、运费及交货方式由双方通过「聊一聊」确认
              </ErpHelperText>
            )}
          </div>
          <div data-inventory-field="priceEx" className="space-y-1.5">
            <Label>单价（元，{form.taxIncluded ? "含税" : "未税"}）</Label>
            <Input
              placeholder="不填则显示「价格面议」"
              value={form.priceEx}
              onChange={e => set({ priceEx: decimal(e.target.value) })}
            />
            <ErpHelperText>
              {form.taxIncluded
                ? "含税价选填；留空时仅可通过「聊一聊」询价"
                : "未税价须填写单价或下方至少一档阶梯价"}
            </ErpHelperText>
          </div>
        </div>
      </div>

      {/* 所有其余字段均为选填，仍按双列排列以减少桌面端滚动。 */}
      <div>
        <ErpSectionTitle>其他信息（选填）</ErpSectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div data-inventory-field="category" className="space-y-1.5">
            <Label>分类</Label>
            <ComboInput
              value={form.category}
              onChange={v => set({ category: v })}
              options={CATEGORIES}
              placeholder="输入或选择分类，如:芯片IC"
              maxLength={32}
            />
          </div>
          <div data-inventory-field="pkg" className="space-y-1.5">
            <Label>封装</Label>
            <ComboInput
              value={form.pkg}
              onChange={v => set({ pkg: v })}
              options={PACKAGES}
              placeholder="输入或选择封装，如:SOP-8"
              maxLength={32}
            />
          </div>
          <div
            data-inventory-field="ladderPrices"
            className="space-y-1.5 md:col-span-2"
          >
            <Label>
              阶梯价（{form.taxIncluded ? "含税" : "未税"}，多档可选）
            </Label>
            <LadderEditor
              tiers={form.ladderPrices}
              taxIncluded={form.taxIncluded}
              onChange={tiers => set({ ladderPrices: tiers })}
            />
          </div>
          <div data-inventory-field="moq" className="space-y-1.5">
            <Label>最小起订量 (MOQ)</Label>
            <Input
              placeholder="如:100"
              value={form.moq}
              onChange={e => set({ moq: digits(e.target.value) })}
            />
          </div>
          <div data-inventory-field="spq" className="space-y-1.5">
            <Label>整包数量 (SPQ)</Label>
            <Input
              placeholder="如:1000"
              value={form.spq}
              onChange={e => set({ spq: digits(e.target.value) })}
            />
          </div>
          <div
            data-inventory-field="photos"
            className="space-y-1.5 md:col-span-2"
          >
            <Label>库存照片</Label>
            <InventoryPhotoUploader
              photos={form.photos}
              onChange={photos => set({ photos })}
            />
          </div>
          <div
            data-inventory-field="warehouseAddress"
            className="space-y-1.5 md:col-span-2"
          >
            <Label>仓库地址</Label>
            <Input
              placeholder={
                mode === "create" ? "如：深圳仓；选填" : "库存所在地或发货仓"
              }
              value={form.warehouseAddress}
              maxLength={warehouseMaxLength}
              onChange={e => set({ warehouseAddress: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">
              {mode === "create"
                ? `最多${INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH}个字符；Excel 导入也可统一填写`
                : `历史库存编辑最多${warehouseMaxLength}个字符`}
            </p>
          </div>
          <div data-inventory-field="invoice" className="space-y-1.5">
            <Label>发票</Label>
            <label className="flex items-start gap-2.5 p-2 border border-input rounded-md cursor-pointer has-[[data-state=checked]]:border-[#b3cfe8] has-[[data-state=checked]]:bg-[#f0f6fd] transition-colors">
              <Checkbox
                checked={form.invoice}
                onCheckedChange={v => set({ invoice: v === true })}
                className="mt-0.5"
              />
              <span>
                <span className="text-[13px] font-medium block">
                  可开具 13% 增值税专用发票
                </span>
                <span className="text-[11px] text-muted-foreground">
                  请如实勾选
                </span>
              </span>
            </label>
          </div>
          <div data-inventory-field="rohs" className="space-y-1.5">
            <Label>RoHS 合规</Label>
            <label className="flex items-start gap-2.5 p-2 border border-input rounded-md cursor-pointer has-[[data-state=checked]]:border-[#b3cfe8] has-[[data-state=checked]]:bg-[#f0f6fd] transition-colors">
              <Checkbox
                checked={form.rohs}
                onCheckedChange={v => set({ rohs: v === true })}
                className="mt-0.5"
              />
              <span>
                <span className="text-[13px] font-medium block">符合 RoHS</span>
                <span className="text-[11px] text-muted-foreground">
                  环保指令合规
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div data-inventory-field="note">
        <div className="text-[11px] text-muted-foreground font-medium mb-2.5 pb-1 border-b border-border/60 tracking-wide">
          物料备注（选填）
        </div>
        <Textarea
          placeholder={
            mode === "create"
              ? `如：原装现货；最多${INVENTORY_UPLOAD_NOTE_MAX_LENGTH}字`
              : "补充物料说明"
          }
          value={form.note}
          onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          rows={3}
          maxLength={noteMaxLength}
        />
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            会在搜索结果与商品详情页向买家公开展示；请勿填写联系方式或“最优”“第一”等极限词
          </p>
          <span
            className={`shrink-0 text-[11px] tabular-nums ${form.note.length >= noteMaxLength ? "text-destructive" : "text-muted-foreground"}`}
          >
            {form.note.length}/{noteMaxLength}
          </span>
        </div>
        {noteVerdict && !noteVerdict.ok && (
          <p className="mt-1 text-[11px] text-destructive leading-relaxed">
            {noteVerdict.message}
          </p>
        )}
      </div>
    </div>
  );
}

async function sha256Hex(input: ArrayBuffer | string) {
  if (!globalThis.crypto?.subtle)
    throw new Error("当前浏览器不支持安全文件指纹，请升级浏览器后重试");
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function inventoryImportStatusLabel(status: string) {
  if (status === "queued") return "已进入后台队列";
  if (status === "running") return "正在后台处理";
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已完成";
  if (status === "failed") return "处理失败";
  if (status === "cancelled") return "已取消";
  return "状态已更新";
}

/** Excel 批量导入面板：支持任意用户表头在线映射后再预览导入 */
function ExcelImportPanel({ onImported }: { onImported: () => void }) {
  type ImportJobStatus =
    | "staging"
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  const [parsing, setParsing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  /** Exact worksheet lines for new jobs; rawRows stays compact for legacy resumptions. */
  const [sourceRowNumbers, setSourceRowNumbers] = useState<number[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [exportingFailedRows, setExportingFailedRows] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importUtils = trpc.useUtils();
  const importRequestRef = useRef<{
    payloadKey: string;
    requestId: string;
  } | null>(null);
  const restoredActiveJobRef = useRef(false);
  const completedNoticeJobIdsRef = useRef(new Set<string>());
  const [mapping, setMapping] = useState<SimplifiedInventoryColumnMapping>(() =>
    suggestSimplifiedInventoryColumnMapping([])
  );
  const [fixedValues, setFixedValues] = useState<InventoryImportFixedValues>(
    {}
  );
  const [taxIncluded, setTaxIncluded] = useState(true);
  const simplifiedImport = useSimplifiedInventoryImport({
    rawRows,
    headers,
    mapping,
    fixedValues,
    taxIncluded,
    sourceRowNumbers:
      sourceRowNumbers.length === rawRows.length ? sourceRowNumbers : undefined,
  });

  const mappingIssues = useMemo(() => {
    if (headers.length === 0) return [];
    const issues = validateInventoryColumnMapping(
      mapping,
      headers,
      fixedValues
    );
    if (!taxIncluded && mapping.priceEx === null) {
      issues.push("选择未税价时请为“单价”选择用户表头");
    }
    return issues;
  }, [fixedValues, headers, mapping, taxIncluded]);
  // Retain the historical compact parser output exactly for v1 staging-job resumes.
  const parseResult = useMemo(
    () =>
      headers.length > 0 && rawRows.length > 0
        ? parseInventoryRowsWithMapping(
            rawRows,
            mapping,
            headers,
            undefined,
            fixedValues,
            taxIncluded
          )
        : { rows: [], rejectedRows: [], validationErrors: [], errors: [] },
    [fixedValues, headers, mapping, rawRows, taxIncluded]
  );
  const parsedRows = parseResult.rows;
  const rejectedRows = simplifiedImport.prepared.rejectedRows;
  const rowsReadyToImport = simplifiedImport.prepared.payloadRows;
  const previewCanImportCount = simplifiedImport.prepared.rows.length;
  const previewSkippedCount = rejectedRows.length;
  const configuredFieldCount = INVENTORY_IMPORT_FIELDS.filter(
    field =>
      mapping[field.key] !== null ||
      Boolean(fixedValues[field.key as InventoryFlexibleImportFieldKey]?.trim())
  ).length;

  const resetImport = () => {
    setFileName("");
    setFileHash("");
    setHeaders([]);
    setRawRows([]);
    setSourceRowNumbers([]);
    setFileErrors([]);
    setImportProgress(null);
    importRequestRef.current = null;
    setMapping(suggestSimplifiedInventoryColumnMapping([]));
    setFixedValues({});
    setTaxIncluded(true);
  };

  const createJobMutation = trpc.importInventory.createJob.useMutation();
  const stageBatchMutation = trpc.importInventory.stageBatch.useMutation();
  const finalizeJobMutation = trpc.importInventory.finalizeJob.useMutation();
  const { data: recentJobs = [], isSuccess: recentJobsLoaded } =
    trpc.importInventory.listJobs.useQuery({ limit: 10 });
  const { data: activeJob } = trpc.importInventory.getJob.useQuery(
    { jobId: activeJobId ?? "00000000-0000-0000-0000-000000000000" },
    {
      enabled: Boolean(activeJobId),
      refetchInterval: query => {
        const status = query.state.data?.status as ImportJobStatus | undefined;
        return status && ["completed", "failed", "cancelled"].includes(status)
          ? false
          : 2_000;
      },
    }
  );

  const downloadFailedRows = async () => {
    const expectedFailedRows = Math.max(
      activeJob?.errorRows ?? 0,
      activeJob?.skippedRows ?? 0
    );
    if (
      !activeJobId ||
      !activeJob ||
      expectedFailedRows <= 0 ||
      exportingFailedRows
    )
      return;
    setExportingFailedRows(true);
    try {
      const rows: InventoryFailedRowForExport[] = [];
      let afterRowNumber = 0;
      while (rows.length < expectedFailedRows) {
        const page = await importUtils.importInventory.listFailedRows.fetch({
          jobId: activeJobId,
          afterRowNumber,
          limit: INVENTORY_IMPORT_ERROR_PAGE_SIZE,
        });
        if (!page.length) break;
        rows.push(...page);
        afterRowNumber = page[page.length - 1].rowNumber;
        if (page.length < INVENTORY_IMPORT_ERROR_PAGE_SIZE) break;
      }
      if (rows.length === 0) {
        toast.info("当前任务没有可导出的未导入行");
        return;
      }
      rows.sort((left, right) => left.rowNumber - right.rowNumber);
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.aoa_to_sheet([
        [...INVENTORY_FAILED_ROW_EXPORT_HEADERS],
        ...rows.map(inventoryFailedRowToExportValues),
      ]);
      sheet["!cols"] = [
        { wch: 22 },
        { wch: 14 },
        { wch: 18 },
        { wch: 10 },
        { wch: 12 },
        { wch: 10 },
        { wch: 18 },
        { wch: 24 },
        { wch: 12 },
        { wch: 12 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 28 },
        { wch: 12 },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "未导入行");
      const stamp = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(new Date())
        .replace(/[^\d]/g, "");
      const baseName = String(activeJob.fileName || "库存导入").replace(
        /\.[^.]+$/,
        ""
      );
      XLSX.writeFile(workbook, `未导入-${baseName}-${stamp}.xlsx`);
      toast.success(`已导出 ${rows.length} 条未导入行`, {
        description:
          "改完后直接上传该文件即可补入；未导入原因和原Excel行号列不会导入。",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "导出失败，请稍后重试"
      );
    } finally {
      setExportingFailedRows(false);
    }
  };

  const pauseJobMutation = trpc.importInventory.pauseJob.useMutation();
  const resumeJobMutation = trpc.importInventory.resumeJob.useMutation();
  const retryFailedJobMutation =
    trpc.importInventory.retryFailedJob.useMutation();
  const cancelJobMutation = trpc.importInventory.cancelJob.useMutation();
  const { data: activeJobErrors = [] } =
    trpc.importInventory.listErrors.useQuery(
      {
        jobId: activeJobId ?? "00000000-0000-0000-0000-000000000000",
        limit: 20,
      },
      {
        enabled: Boolean(
          activeJobId &&
            activeJob?.status === "completed" &&
            activeJob.errorRows > 0
        ),
      }
    );

  useEffect(() => {
    if (!recentJobsLoaded || restoredActiveJobRef.current) return;
    restoredActiveJobRef.current = true;
    const unfinished = recentJobs.find(job =>
      ["staging", "queued", "running", "paused"].includes(job.status)
    );
    if (unfinished) setActiveJobId(unfinished.id);
  }, [recentJobs, recentJobsLoaded]);

  useEffect(() => {
    if (!activeJob) return;
    if (
      activeJob.status === "completed" &&
      !completedNoticeJobIdsRef.current.has(activeJob.id)
    ) {
      completedNoticeJobIdsRef.current.add(activeJob.id);
      const createdRows = Math.max(
        0,
        activeJob.successRows - (activeJob.updatedRows ?? 0)
      );
      const exceptionRows = Math.max(
        activeJob.errorRows,
        activeJob.skippedRows ?? 0
      );
      showInventoryImportNotice({
        phase: "completed",
        jobId: activeJob.id,
        createdRows,
        updatedRows: activeJob.updatedRows ?? 0,
        exceptionRows,
      });
      resetImport();
      onImported();
      if (activeJob.errorRows === 0) setActiveJobId(null);
    }
  }, [
    activeJob?.id,
    activeJob?.status,
    activeJob?.errorRows,
    activeJob?.skippedRows,
    activeJob?.successRows,
    activeJob?.updatedRows,
  ]);

  const importAllRows = async () => {
    if (rowsReadyToImport.length === 0 || importProgress) return;
    if (
      activeJob &&
      ["queued", "running", "paused"].includes(activeJob.status)
    ) {
      toast.info("当前企业已有后台导入任务", {
        description: "请等待任务完成，或先暂停/取消当前任务。",
      });
      return;
    }
    let completed = 0;
    let total = rowsReadyToImport.length;
    let failurePhase: InventoryImportFailurePhase = "create";
    const resumableJob = activeJob?.status === "staging" ? activeJob : null;
    setImportProgress({ completed, total });
    try {
      if (!fileHash) throw new Error("文件指纹尚未生成，请重新选择 Excel 文件");
      /*
       * A click runs the V3 preview invisibly, then uses this exact return
       * value. Do not read preview state here: React state can still be stale
       * after await and would risk staging a payload without its fingerprint.
       */
      const previewResult = await simplifiedImport.runPreview();
      if (!previewResult.ok) {
        toast.error("上传前预览未完成", {
          description: `${previewResult.error} 请直接再次点击上传重试。`,
        });
        return;
      }
      const submission: SimplifiedImportSubmissionPayload =
        previewResult.payload;
      if (submission.payloadRows.length === 0) {
        throw new Error("没有可保存的库存行");
      }
      const legacyManifestFor = (rowCount: number, parserVersion?: number) =>
        sha256Hex(
          JSON.stringify({
            fileHash,
            total: rowCount,
            taxIncluded,
            mapping: INVENTORY_IMPORT_FIELDS.map(field => [
              field.key,
              mapping[field.key],
            ]),
            fixedValues: (
              ["leadTime", "warehouseAddress", "note"] as const
            ).map(key => [key, fixedValues[key]?.trim() || ""]),
            ...(parserVersion ? { parserVersion } : {}),
          })
        );
      const manifestForRows = async (
        rows: readonly (InventoryImportRow | InventoryRejectedImportRow)[]
      ) =>
        sha256Hex(
          JSON.stringify({
            fileHash,
            total: rows.length,
            taxIncluded,
            mapping: INVENTORY_IMPORT_FIELDS.map(field => [
              field.key,
              mapping[field.key],
            ]),
            fixedValues: (
              ["leadTime", "warehouseAddress", "note"] as const
            ).map(key => [key, fixedValues[key]?.trim() || ""]),
            parserVersion: 3,
            rowsSha256: await sha256Hex(JSON.stringify(rows)),
          })
        );
      const simpleManifestForRows = async (
        rows: readonly (InventoryImportRow | InventoryRejectedImportRow)[]
      ) =>
        sha256Hex(
          JSON.stringify({
            fileHash,
            total: rows.length,
            taxIncluded,
            mapping: [
              ...INVENTORY_IMPORT_FIELDS.map(
                field =>
                  [field.key, mapping[field.key]] as [string, number | null]
              ),
              // Persist the compatibility field as unmapped: the prepared
              // payload always derives qtyStock from qtyOnSale.
              ["qtyStock", null] as [string, number | null],
            ],
            fixedValues: (
              ["leadTime", "warehouseAddress", "note"] as const
            ).map(key => [key, fixedValues[key]?.trim() || ""]),
            parserVersion: 3,
            batchProtocol: "utf8-900k-v1",
            quantityRules: {
              normalization: "explicit-k-wan-v1",
              shareStock: true,
            },
            clearFields: [],
            rowsSha256: await sha256Hex(JSON.stringify(rows)),
          })
        );
      const legacyLiveV3ManifestForRows = async (
        rows: readonly (InventoryImportRow | InventoryRejectedImportRow)[]
      ) =>
        sha256Hex(
          JSON.stringify({
            fileHash,
            total: rows.length,
            taxIncluded,
            mapping: [
              "partNumber",
              "brand",
              "category",
              "pkg",
              "dateCode",
              "qtyOnSale",
              "qtyStock",
              "priceEx",
              "moq",
              "spq",
              "leadTime",
              "rohs",
              "warehouseAddress",
              "note",
            ].map(key => [
              key,
              key === "qtyStock"
                ? null
                : mapping[key as InventoryImportFieldKey],
            ]),
            fixedValues,
            parserVersion: 3,
            batchProtocol: "utf8-900k-v1",
            quantityRules: { allowUnits: false, shareStock: true },
            clearFields: [],
            rowsSha256: await sha256Hex(JSON.stringify(rows)),
          })
        );
      // New jobs bind the exact V3 payload and its server-issued fingerprints.
      // Legacy identities remain read-only fallbacks strictly for resumption.
      const manifestHash = await simpleManifestForRows(submission.payloadRows);
      const legacyLiveV3ManifestHash = await legacyLiveV3ManifestForRows(
        submission.payloadRows
      );
      const v2CurrentManifestHash = await legacyManifestFor(
        submission.payloadRows.length,
        2
      );
      const legacyManifestHash = await legacyManifestFor(parsedRows.length);
      const resumesCurrentJob = Boolean(
        resumableJob &&
          resumableJob.fileHash === fileHash &&
          resumableJob.totalRows === submission.payloadRows.length &&
          [
            manifestHash,
            legacyLiveV3ManifestHash,
            v2CurrentManifestHash,
          ].includes(resumableJob.manifestHash)
      );
      const resumesLegacyJob = Boolean(
        resumableJob &&
          resumableJob.fileHash === fileHash &&
          resumableJob.totalRows === parsedRows.length &&
          resumableJob.manifestHash === legacyManifestHash
      );
      if (resumableJob && !resumesCurrentJob && !resumesLegacyJob) {
        toast.error("检测到未完成上传，当前文件或映射与其不一致", {
          description:
            "为保护已上传的数据，系统不会自动取消或替换该任务。请先在上方任务卡点击“取消任务”，再确认发布当前文件。",
        });
        return;
      }
      // The existing 18,000/54,486 staging job must keep its prior rows and batches untouched.
      const rowsToStage: readonly (
        | InventoryImportRow
        | InventoryRejectedImportRow
        | SimplifiedImportSubmissionPayload["validRows"][number]
      )[] = resumesLegacyJob ? parsedRows : submission.payloadRows;
      total = rowsToStage.length;
      const jobManifestHash = resumesLegacyJob
        ? legacyManifestHash
        : (resumableJob?.manifestHash ?? manifestHash);
      let jobId = resumableJob?.id;
      if (!jobId) {
        const payloadKey = `${jobManifestHash}:${fileName}:${total}:published`;
        if (importRequestRef.current?.payloadKey !== payloadKey) {
          importRequestRef.current = {
            payloadKey,
            requestId: createClientMessageId("inventory-import"),
          };
        }
        failurePhase = "create";
        const created = await createJobMutation.mutateAsync({
          clientRequestId: importRequestRef.current.requestId,
          fileName: fileName || "库存导入.xlsx",
          fileHash,
          manifestHash: jobManifestHash,
          totalRows: total,
          saveAs: "published",
        });
        jobId = created.job.id;
        setActiveJobId(jobId);
        // A confirmed terminal result must not reuse this request id. Retrying
        // a cancelled/failed creation therefore receives a new request id.
        importRequestRef.current = null;
        if (created.job.status !== "staging") {
          await importUtils.importInventory.listJobs.invalidate();
          await importUtils.importInventory.getJob.invalidate({ jobId });
          const label = inventoryImportStatusLabel(created.job.status);
          const details = {
            description: ["cancelled", "failed"].includes(created.job.status)
              ? "本次不会继续暂存。请查看任务状态后再次提交；将使用新的请求号。"
              : "本次不会重复暂存或入队，请在任务卡查看状态。",
          };
          if (["cancelled", "failed"].includes(created.job.status)) {
            toast.error(`导入任务${label}`, details);
          } else {
            toast.info(`导入任务${label}`, details);
          }
          return;
        }
      }
      if (!jobId) throw new Error("导入任务创建失败");

      failurePhase = "staging";
      const uploadPlan = readInventoryImportUploadPlan(
        (await importUtils.importInventory.getUploadPlan.fetch({
          jobId,
        })) as unknown,
        { jobId, totalRows: total }
      );
      if (!uploadPlan) {
        throw new Error(
          "暂存任务批次计划不完整，请刷新任务状态后继续；不会覆盖或取消旧任务"
        );
      }
      if (uploadPlan.status !== "staging") {
        await importUtils.importInventory.listJobs.invalidate();
        await importUtils.importInventory.getJob.invalidate({ jobId });
        const label = inventoryImportStatusLabel(uploadPlan.status);
        const details = {
          description: ["cancelled", "failed"].includes(uploadPlan.status)
            ? "本次不会继续暂存。请查看任务状态后再次提交；将使用新的请求号。"
            : "任务状态已更新，不会继续暂存或入队，请在任务卡查看状态。",
        };
        if (["cancelled", "failed"].includes(uploadPlan.status)) {
          toast.error(`导入任务${label}`, details);
        } else {
          toast.info(`导入任务${label}`, details);
        }
        return;
      }
      if (
        !(await verifyInventoryImportUploadPlanRows(
          rowsToStage,
          uploadPlan,
          sha256Hex
        ))
      ) {
        throw new Error(
          "暂存任务批次计划不完整或与当前文件不一致，请刷新任务状态后继续；不会覆盖或取消旧任务"
        );
      }
      completed = uploadPlan.stagedRows;
      setImportProgress({ completed, total });
      const batches = splitInventoryImportStageBatches(
        rowsToStage.slice(uploadPlan.nextStartRow - 1),
        jobId,
        uploadPlan.nextBatchIndex,
        uploadPlan.nextStartRow
      );
      for (const batch of batches) {
        await stageBatchMutation.mutateAsync({
          jobId,
          batchIndex: batch.batchIndex,
          startRow: batch.startRow,
          rows: batch.rows,
        });
        completed += batch.rows.length;
        setImportProgress({ completed, total });
      }
      failurePhase = "queue";
      await finalizeJobMutation.mutateAsync({ jobId });
      showInventoryImportNotice({
        phase: "queued",
        jobId,
        rejectedRows: submission.rejectedRows.length,
        hasValidRows: submission.validRows.length > 0,
      });
      setHeaders([]);
      setRawRows([]);
      setSourceRowNumbers([]);
    } catch (error) {
      toast.error("导入暂停", {
        description: formatInventoryImportFailure(
          error,
          completed,
          total,
          failurePhase
        ),
      });
    } finally {
      setImportProgress(null);
    }
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setFileErrors([]);
    setFileHash("");
    setHeaders([]);
    setRawRows([]);
    setSourceRowNumbers([]);
    setImportProgress(null);
    setFixedValues({});
    setTaxIncluded(true);
    setFileName(file.name);
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        throw new Error("仅支持 .xlsx 或 .xls 文件");
      }
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      setFileHash(await sha256Hex(buffer));
      const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = firstSheetName
        ? workbook.Sheets[firstSheetName]
        : undefined;
      if (!worksheet) throw new Error("工作簿中没有可读取的工作表");

      // raw:false 使用 Excel 单元格的显示文本，避免把料号中的前导零或显示格式擅自改写。
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: true,
      }) as unknown[][];
      if (matrix.length < 2) {
        throw new Error("文件中没有数据行（第一行应为表头）");
      }

      const detectedHeaders = (matrix[0] ?? []).map((cell, index) => {
        const text = String(cell ?? "").trim();
        return text || `未命名列 ${index + 1}`;
      });
      const firstSheetRow =
        XLSX.utils.decode_range(worksheet["!ref"] || "A1").s.r + 1;
      const dataRowsWithSourceNumbers = matrix
        .slice(1)
        .map((row, index) => ({
          row,
          sourceRowNumber: firstSheetRow + index + 1,
        }))
        .filter(({ row }) =>
          row.some(cell => String(cell ?? "").trim() !== "")
        );
      const dataRows = dataRowsWithSourceNumbers.map(({ row }) => row);
      if (detectedHeaders.length === 0 || dataRows.length === 0) {
        throw new Error("没有找到有效表头或数据行");
      }
      if (dataRows.length > INVENTORY_IMPORT_JOB_ROW_LIMIT) {
        throw new Error(
          `单个文件最多上传 ${INVENTORY_IMPORT_JOB_ROW_LIMIT.toLocaleString("zh-CN")} 条库存，请拆分后再试`
        );
      }

      const suggestedMapping =
        suggestSimplifiedInventoryColumnMapping(detectedHeaders);
      const rememberedMapping =
        loadSimplifiedInventoryImportMapping(detectedHeaders);
      const nextMapping = rememberedMapping?.mapping ?? suggestedMapping;
      setHeaders(detectedHeaders);
      setRawRows(dataRows);
      setSourceRowNumbers(
        dataRowsWithSourceNumbers.map(({ sourceRowNumber }) => sourceRowNumber)
      );
      setMapping(nextMapping);
      setFixedValues(rememberedMapping?.fixedValues ?? {});
      setTaxIncluded(
        rememberedMapping?.taxIncluded ??
          suggestInventoryTaxIncluded(detectedHeaders, nextMapping)
      );
    } catch (error) {
      setFileErrors([
        `文件解析失败：${error instanceof Error ? error.message : "请确认是有效的 Excel 文件"}`,
      ]);
      setHeaders([]);
      setRawRows([]);
      setSourceRowNumbers([]);
    } finally {
      setParsing(false);
    }
  };

  const updateMapping = (
    fieldKey: InventoryImportFieldKey,
    selected: string
  ) => {
    const selectedColumn = selected === "__skip__" ? null : Number(selected);
    setMapping(current => {
      const next = { ...current };
      if (selectedColumn !== null) {
        for (const field of INVENTORY_IMPORT_FIELDS) {
          if (field.key !== fieldKey && next[field.key] === selectedColumn) {
            next[field.key] = null;
          }
        }
      }
      next[fieldKey] = selectedColumn;
      next.qtyStock = null;
      if (fieldKey === "priceEx") {
        setTaxIncluded(suggestInventoryTaxIncluded(headers, next));
      }
      return next;
    });
    if (
      selectedColumn !== null &&
      ["leadTime", "warehouseAddress", "note"].includes(fieldKey)
    ) {
      setFixedValues(current => ({ ...current, [fieldKey]: "" }));
    }
  };

  const fixedValueLimit = (key: InventoryFlexibleImportFieldKey) =>
    ({
      leadTime: INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH,
      warehouseAddress: INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH,
      note: INVENTORY_UPLOAD_NOTE_MAX_LENGTH,
    })[key];

  const fixedValuePlaceholder = (key: InventoryFlexibleImportFieldKey) =>
    ({
      leadTime: "统一填写，如：现货",
      warehouseAddress: "统一填写，如：深圳仓",
      note: "统一填写物料备注",
    })[key];

  const updateFixedValue = (
    fieldKey: InventoryFlexibleImportFieldKey,
    value: string
  ) => {
    setFixedValues(current => ({ ...current, [fieldKey]: value }));
    if (value) {
      setMapping(current => ({ ...current, [fieldKey]: null }));
    }
  };

  useEffect(() => {
    if (headers.length === 0) return;
    saveSimplifiedInventoryImportMapping(headers, {
      mapping,
      fixedValues,
      taxIncluded,
    });
  }, [fixedValues, headers, mapping, taxIncluded]);

  return (
    <Card
      data-inventory-compact-source="true"
      className="p-3 sm:p-4 max-w-[1180px] space-y-3"
    >
      <style>{`
[data-inventory-compact-source] [data-inventory-filebar]{display:flex!important;align-items:center!important;gap:12px!important;width:100%!important;border:1px dashed #cbd5e1!important;border-radius:8px!important;background:#fff!important;outline:0!important;box-shadow:none!important;text-align:left;transition:border-color .15s,background-color .15s}
[data-inventory-compact-source] [data-inventory-filebar]:hover{border-color:#9fb4c7!important;background:#fbfdff!important}
[data-inventory-compact-source] [data-inventory-filebar][data-filebar-state="initial"]{min-height:100px!important;padding:14px 16px!important}
[data-inventory-compact-source] [data-inventory-filebar][data-filebar-state="selected"],[data-inventory-compact-source] [data-inventory-filebar][data-filebar-state="parsing"]{min-height:56px!important;padding:9px 12px!important}
[data-inventory-compact-source] [data-inventory-filebar] :where(label,span,div){border:0!important;outline:0!important;box-shadow:none!important}
[data-inventory-compact-source] [data-inventory-filebar][data-filebar-state="selected"]{border-style:solid!important}
[data-inventory-compact-source] .inventory-filebar-v1-label{display:flex;min-width:0;flex:1;align-items:center;gap:10px;cursor:pointer}
[data-inventory-compact-source] .inventory-filebar-v1-icon{width:20px;height:20px;flex:none;color:#6e91af}
[data-inventory-compact-source] .inventory-filebar-v1-copy{display:grid;min-width:0;gap:2px}
[data-inventory-compact-source] .inventory-filebar-v1-title{overflow:hidden;color:#1f2937;font-size:14px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
[data-inventory-compact-source] .inventory-filebar-v1-subtitle,[data-inventory-compact-source] .inventory-filebar-v1-status{overflow:hidden;color:#6b7280;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
[data-inventory-compact-source] [data-inventory-filebar][data-filebar-state="selected"] .inventory-filebar-v1-subtitle{display:none}
[data-inventory-compact-source] .inventory-filebar-v1-action{height:34px!important;margin:0!important;flex:none;padding:0 12px!important}
[data-inventory-compact-source] .inventory-compact-map-scroll{overflow-x:auto}
[data-inventory-compact-source] .inventory-compact-map{width:100%;min-width:720px;border-collapse:collapse;table-layout:fixed;font-size:12px}
[data-inventory-compact-source] .inventory-compact-map th{height:29px;padding:0 10px;background:#fbfcfd;border-bottom:1px solid #e8edf2;color:#778495;font-size:11px;font-weight:500;text-align:left}
[data-inventory-compact-source] .inventory-compact-map td{height:43px;padding:5px 10px;border-bottom:1px solid #edf1f4;vertical-align:middle}
[data-inventory-compact-source] .inventory-compact-map th:nth-child(1){width:17%}
[data-inventory-compact-source] .inventory-compact-map th:nth-child(2){width:25%}
[data-inventory-compact-source] .inventory-compact-map th:nth-child(3){width:25%}
[data-inventory-compact-source] .inventory-compact-map th:nth-child(4){width:33%}
[data-inventory-compact-source] .inventory-compact-map [data-radix-select-trigger]{height:30px!important;font-size:12px}
[data-inventory-compact-source] .inventory-compact-map input{height:30px!important;font-size:12px}
[data-inventory-compact-source] .inventory-compact-example{overflow:hidden;color:#7a8796;text-overflow:ellipsis;white-space:nowrap}
[data-inventory-compact-source] .inventory-compact-details>summary{display:flex;align-items:center;min-height:34px;padding:0 12px;color:#315a7d;cursor:pointer;font-size:12px;font-weight:500;list-style:none}
[data-inventory-compact-source] .inventory-compact-details>summary::-webkit-details-marker{display:none}
[data-inventory-compact-source] .inventory-compact-details>summary::before{content:"›";margin-right:6px;font-size:17px;line-height:1;transition:transform .15s}
[data-inventory-compact-source] details[open]>summary::before{transform:rotate(90deg)}
[data-inventory-compact-source] .inventory-compact-details-body{border-top:1px solid #e8edf2;padding:10px 12px}
@media(max-width:640px){[data-inventory-compact-source] [data-inventory-filebar][data-filebar-state="initial"]{min-height:96px!important;padding:12px!important}[data-inventory-compact-source] .inventory-filebar-v1-action{padding:0 10px!important}}
      `}</style>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[#185FA5]" />
            Excel 批量导入
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            选择文件，确认字段后直接上传。
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          同型号更新，问题行进入待发布
        </span>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">导入规则</summary>
        <p className="mt-2 leading-5">
          相同型号按现有规则更新；Excel 未提供的旧库存保持不动。
        </p>
      </details>

      {activeJob && (
        <div className="rounded-lg border border-[#b9d3e8] bg-[#eef6fc] px-4 py-3 text-xs text-[#254f72]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">
                后台任务：{activeJob.fileName} ·{" "}
                {activeJob.status === "paused"
                  ? "已暂停"
                  : activeJob.status === "failed"
                    ? "处理失败"
                    : activeJob.status === "cancelled"
                      ? "已取消"
                      : activeJob.status === "completed"
                        ? "已完成"
                        : activeJob.status === "staging"
                          ? "等待文件续传"
                          : activeJob.status === "queued"
                            ? "排队中"
                            : activeJob.status === "running"
                              ? "正在发布"
                              : "处理中"}
              </div>
              <div className="mt-1 tabular-nums">
                {activeJob.status === "staging"
                  ? `已上传 ${activeJob.stagedRows}/${activeJob.totalRows}`
                  : `已完成 ${activeJob.processedRows + (activeJob.skippedRows ?? 0)}/${activeJob.totalRows}，已发布 ${activeJob.successRows}，跳过 ${activeJob.skippedRows ?? 0}`}
              </div>
              <div className="mt-1 text-[#496c88]">
                最后更新（北京时间）：
                {(() => {
                  const updated = new Date(activeJob.updatedAt);
                  return Number.isFinite(updated.getTime())
                    ? updated.toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour12: false,
                      })
                    : "暂无更新时间";
                })()}
              </div>
              {activeJob.status === "queued" && (
                <div className="mt-1 text-[#496c88]">
                  文件已保存，等待后台发布，无需重复上传。
                  {Date.now() - new Date(activeJob.updatedAt).getTime() >=
                    300000 &&
                    "若长时间没有进度，请联系管理员检查任务处理服务。"}
                </div>
              )}
              {activeJob.status === "staging" && (
                <div className="mt-1 text-[#496c88]">
                  {activeJob.stagedRows === 0
                    ? "尚未收到文件数据；15分钟后自动取消。重新选择原文件可继续。若要换文件，请先手动取消当前任务。"
                    : "重新选择同一原文件可从断点继续。为保护已上传的数据，换文件前必须手动取消当前任务；24小时未续传将自动取消。"}
                </div>
              )}
              {activeJob.errorMessage && (
                <div className="mt-1 text-amber-800">
                  {activeJob.errorMessage}
                </div>
              )}
              {activeJobErrors.length > 0 && (
                <div className="mt-2 space-y-1 text-amber-800">
                  {activeJobErrors.map(error => (
                    <div key={error.rowNumber}>
                      Excel 第 {error.rowNumber} 行
                      {error.partNumber ? `（${error.partNumber}）` : ""}：
                      {error.errorMessage || "未导入"}
                    </div>
                  ))}
                  {activeJob.errorRows > activeJobErrors.length && (
                    <div>
                      仅显示前 {activeJobErrors.length} 条，共{" "}
                      {activeJob.errorRows} 条未导入。
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {activeJob.status === "staging" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={parsing || Boolean(importProgress)}
                  onClick={() => fileInputRef.current?.click()}
                >
                  继续上传原文件
                </Button>
              ) : null}
              {activeJob.status === "running" ||
              activeJob.status === "queued" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pauseJobMutation.isPending}
                  onClick={() =>
                    pauseJobMutation.mutateAsync({ jobId: activeJob.id })
                  }
                >
                  暂停
                </Button>
              ) : null}
              {activeJob.status === "paused" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resumeJobMutation.isPending}
                  onClick={() =>
                    resumeJobMutation.mutateAsync({ jobId: activeJob.id })
                  }
                >
                  继续
                </Button>
              ) : null}
              {activeJob.status === "failed" &&
              activeJob.processedRows < activeJob.totalRows ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={retryFailedJobMutation.isPending}
                  onClick={async () => {
                    try {
                      await retryFailedJobMutation.mutateAsync({
                        jobId: activeJob.id,
                      });
                      await importUtils.importInventory.getJob.invalidate({
                        jobId: activeJob.id,
                      });
                      toast.success("任务已重新排队，将继续处理剩余行");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "任务重试失败，请稍后再试"
                      );
                    }
                  }}
                >
                  重试剩余行
                </Button>
              ) : null}
              {["staging", "queued", "running", "paused"].includes(
                activeJob.status
              ) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={cancelJobMutation.isPending}
                  onClick={async () => {
                    const message =
                      activeJob.status === "staging"
                        ? "当前文件尚未进入正式库存。确认取消这次上传？"
                        : "取消只停止尚未处理的数据，已经成功导入的库存不会自动删除。确认取消？";
                    if (!window.confirm(message)) return;
                    try {
                      await cancelJobMutation.mutateAsync({
                        jobId: activeJob.id,
                      });
                      setActiveJobId(null);
                      await importUtils.importInventory.listJobs.invalidate();
                      toast.success("任务已取消，可以重新上传文件");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "取消失败，请稍后重试"
                      );
                    }
                  }}
                >
                  取消任务
                </Button>
              ) : null}
              {Math.max(activeJob.errorRows, activeJob.skippedRows ?? 0) > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={exportingFailedRows}
                  onClick={() => void downloadFailedRows()}
                >
                  {exportingFailedRows ? "正在导出…" : "导出失败行"}
                </Button>
              ) : null}
              {["completed", "failed", "cancelled"].includes(
                activeJob.status
              ) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveJobId(null)}
                >
                  关闭任务结果
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div
        data-inventory-filebar={parsing ? "parsing" : fileName ? "selected" : "initial"}
        data-filebar-state={parsing ? "parsing" : fileName ? "selected" : "initial"}
        className="inventory-filebar-v1"
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <input
          ref={fileInputRef}
          id="inventory-excel-file"
          type="file"
          accept=".xlsx,.xls"
          aria-label="选择库存 Excel 文件"
          className="sr-only"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = "";
          }}
        />
        <label
          htmlFor="inventory-excel-file"
          className="inventory-filebar-v1-label"
        >
          {parsing ? (
            <Loader2 className="inventory-filebar-v1-icon animate-spin text-[#185FA5]" />
          ) : (
            <FileSpreadsheet className="inventory-filebar-v1-icon" />
          )}
          <span className="inventory-filebar-v1-copy">
            <span className="inventory-filebar-v1-title">
            {parsing
              ? "正在读取表头与数据…"
              : fileName
                ? `${fileName} · ${rawRows.length}条`
                : "拖入 Excel，或选择文件"}
            </span>
            <span className="inventory-filebar-v1-subtitle">
              支持 XLSX、XLS，最多10万条
            </span>
          </span>
        </label>
        <Button
          type="button"
          size="sm"
          className="inventory-filebar-v1-action bg-[#185FA5] hover:bg-[#0C447C]"
          disabled={parsing}
          onClick={() => {
            setFileErrors([]);
            if (!fileInputRef.current) {
              setFileErrors(["文件选择器未就绪，请刷新页面后重试"]);
              return;
            }
            fileInputRef.current.click();
          }}
        >
          {parsing
            ? "正在读取…"
            : fileName
              ? "更换文件"
              : "选择文件"}
        </Button>
      </div>

      {fileErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-xs text-red-700 space-y-1">
          {fileErrors.map((error, index) => (
            <div key={index} className="flex items-start gap-2">
              <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ))}
        </div>
      )}

      {headers.length > 0 && (
        <section className="rounded-lg border border-border overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-white px-3 py-2">
            <div className="mr-auto flex items-center gap-2">
              <Columns3 className="w-4 h-4 text-[#185FA5]" />
              <span className="text-[13px] font-medium">
                字段对应 · {rawRows.length} 行
              </span>
              <span className="text-[11px] text-muted-foreground">
                必填：型号、品牌、批次、数量、交期
              </span>
              <span className="text-[11px] text-muted-foreground">
                已匹配 {configuredFieldCount}/{INVENTORY_IMPORT_FIELDS.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">价格</span>
              <ErpSegmentedControl
                ariaLabel="本批价格类型"
                value={taxIncluded}
                options={[
                  { value: true, label: "含税" },
                  { value: false, label: "未税" },
                ]}
                onChange={setTaxIncluded}
                className="h-7"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const suggestedMapping =
                  suggestSimplifiedInventoryColumnMapping(headers);
                setMapping(suggestedMapping);
                setTaxIncluded(
                  suggestInventoryTaxIncluded(headers, suggestedMapping)
                );
                setFixedValues({});
              }}
            >
              <RefreshCw className="w-3 h-3" />
              恢复自动建议
            </Button>
          </div>
          {!taxIncluded && (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              未税价仅保留“聊一聊”；税费、发票与交货方式由双方确认。
            </div>
          )}
          <div className="inventory-compact-map-scroll">
            <table className="inventory-compact-map">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>Excel 列</th>
                  <th>统一填写</th>
                  <th>示例值</th>
                </tr>
              </thead>
              <tbody>
                {INVENTORY_IMPORT_FIELDS.filter(field =>
                  [
                    "partNumber",
                    "brand",
                    "dateCode",
                    "qtyOnSale",
                    "leadTime",
                  ].includes(field.key)
                ).map(field => {
                  const selectedColumn = mapping[field.key];
                  const flexibleKey = [
                    "leadTime",
                    "warehouseAddress",
                    "note",
                  ].includes(field.key)
                    ? (field.key as InventoryFlexibleImportFieldKey)
                    : null;
                  const fixedValue = flexibleKey
                    ? (fixedValues[flexibleKey] ?? "")
                    : "";
                  const label =
                    field.key === "dateCode"
                      ? "批次"
                      : field.key === "partNumber"
                        ? "型号"
                        : field.label;
                  const example =
                    selectedColumn === null
                      ? fixedValue || "—"
                      : rawRows
                          .slice(0, 2)
                          .map(row => String(row[selectedColumn] ?? "").trim())
                          .filter(Boolean)
                          .join(" / ") || "—";
                  return (
                    <tr key={field.key}>
                      <td>
                        <span className="font-medium">{label}</span>
                        <span className="ml-1 text-destructive">*</span>
                      </td>
                      <td>
                        <Select
                          value={
                            selectedColumn === null
                              ? "__skip__"
                              : String(selectedColumn)
                          }
                          onValueChange={value =>
                            updateMapping(field.key, value)
                          }
                        >
                          <SelectTrigger className="h-[30px] w-[158px] max-w-full text-xs">
                            <SelectValue placeholder="选择 Excel 列" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">
                              {flexibleKey ? "请选择 Excel 列" : "不导入此字段"}
                            </SelectItem>
                            {headers.map((header, index) => (
                              <SelectItem
                                key={`${index}-${header}`}
                                value={String(index)}
                              >
                                {header}（第 {index + 1} 列）
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td>
                        {flexibleKey ? (
                          <Input
                            value={fixedValue}
                            maxLength={fixedValueLimit(flexibleKey)}
                            placeholder={fixedValuePlaceholder(flexibleKey)}
                            className="h-[30px] text-xs"
                            onChange={event =>
                              updateFixedValue(flexibleKey, event.target.value)
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="inventory-compact-example" title={example}>
                        {example}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details className="inventory-compact-details border-t border-border">
            <summary>
              选填字段
              <span className="ml-2 font-normal text-muted-foreground">
                单价、仓库、备注、分类、封装、MOQ、SPQ、RoHS 等
              </span>
            </summary>
            <div className="inventory-compact-map-scroll border-t border-border">
              <table className="inventory-compact-map">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>Excel 列</th>
                    <th>统一填写</th>
                    <th>示例值</th>
                  </tr>
                </thead>
                <tbody>
                  {INVENTORY_IMPORT_FIELDS.filter(field => !field.required).map(
                    field => {
                      const selectedColumn = mapping[field.key];
                      const flexibleKey = ["warehouseAddress", "note"].includes(
                        field.key
                      )
                        ? (field.key as InventoryFlexibleImportFieldKey)
                        : null;
                      const fixedValue = flexibleKey
                        ? (fixedValues[flexibleKey] ?? "")
                        : "";
                      const example =
                        selectedColumn === null
                          ? fixedValue || "—"
                          : rawRows
                              .slice(0, 2)
                              .map(row =>
                                String(row[selectedColumn] ?? "").trim()
                              )
                              .filter(Boolean)
                              .join(" / ") || "—";
                      return (
                        <tr key={field.key}>
                          <td>
                            <span className="font-medium">{field.label}</span>
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              选填
                            </span>
                          </td>
                          <td>
                            <Select
                              value={
                                selectedColumn === null
                                  ? "__skip__"
                                  : String(selectedColumn)
                              }
                              onValueChange={value =>
                                updateMapping(field.key, value)
                              }
                            >
                              <SelectTrigger className="h-[30px] w-[158px] max-w-full text-xs">
                                <SelectValue placeholder="不从 Excel 读取" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__skip__">
                                  不从 Excel 读取
                                </SelectItem>
                                {headers.map((header, index) => (
                                  <SelectItem
                                    key={`${index}-${header}`}
                                    value={String(index)}
                                  >
                                    {header}（第 {index + 1} 列）
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            {flexibleKey ? (
                              <Input
                                value={fixedValue}
                                maxLength={fixedValueLimit(flexibleKey)}
                                placeholder={fixedValuePlaceholder(flexibleKey)}
                                className="h-[30px] text-xs"
                                onChange={event =>
                                  updateFixedValue(
                                    flexibleKey,
                                    event.target.value
                                  )
                                }
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td
                            className="inventory-compact-example"
                            title={example}
                          >
                            {example}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {mappingIssues.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800 space-y-1">
          {mappingIssues.map((issue, index) => (
            <div key={index} className="flex items-start gap-2">
              <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}

      {simplifiedImport.prepared.issues.length > 0 &&
        mappingIssues.length === 0 && (
          <details className="inventory-compact-details rounded-md border border-amber-200 bg-amber-50 text-xs text-amber-800">
            <summary className="justify-between">
              <span>
                已发现 {simplifiedImport.prepared.rejectedRows.length}
                条异常记录，稍后请在待发布页面查看。
              </span>
              <span className="font-normal">展开问题行</span>
            </summary>
            <div className="inventory-compact-details-body overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-2">Excel 行</th>
                    <th className="pb-2">原值</th>
                    <th className="pb-2">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {simplifiedImport.prepared.rejectedRows.map(row => (
                    <tr
                      key={row.sourceRowNumber}
                      className="border-t border-amber-100"
                    >
                      <td className="py-2">第 {row.sourceRowNumber} 行</td>
                      <td className="py-2">{row.partNumber || "—"}</td>
                      <td className="py-2">
                        {row.validationError || "未导入"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

      {rowsReadyToImport.length > 0 && (
        <details className="inventory-compact-details rounded-md border border-border bg-white">
          <summary>
            数据预览{" "}
            <span className="ml-2 font-normal text-muted-foreground">
              默认收起
            </span>
          </summary>
          <div className="inventory-compact-details-body overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-2">Excel 行</th>
                  <th className="pb-2">型号</th>
                  <th className="pb-2">品牌</th>
                  <th className="pb-2">上架数量</th>
                  <th className="pb-2">交期</th>
                </tr>
              </thead>
              <tbody>
                {simplifiedImport.prepared.rows.slice(0, 20).map(row => (
                  <tr
                    key={row.sourceRowNumber}
                    className="border-t border-border/60"
                  >
                    <td className="py-2">第 {row.sourceRowNumber} 行</td>
                    <td className="py-2">{row.partNumber}</td>
                    <td className="py-2">{row.brand}</td>
                    <td className="py-2">{row.qtyOnSale}</td>
                    <td className="py-2">{row.leadTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {rowsReadyToImport.length > 0 && mappingIssues.length === 0 && (
        <section className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-[#238653]" />
              {`${previewCanImportCount} 条可上传`}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              点击上传时自动校验库存版本；无需二次确认。
            </p>
            {previewSkippedCount > 0 && (
              <span className="mt-1 block text-[11px] text-amber-800">
                已发现 {previewSkippedCount}条异常记录，稍后请在待发布页面查看。
              </span>
            )}
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-[#185FA5] hover:bg-[#0C447C]"
            disabled={Boolean(importProgress) || simplifiedImport.previewBusy}
            onClick={() => void importAllRows()}
          >
            {(importProgress || simplifiedImport.previewBusy) && (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            )}
            {importProgress
              ? `正在上传 ${importProgress.completed}/${importProgress.total}`
              : simplifiedImport.previewBusy
                ? `正在校验 ${simplifiedImport.previewProgress}/${previewCanImportCount}`
                : `上传 ${rowsReadyToImport.length} 行`}
          </Button>
        </section>
      )}
    </Card>
  );
}

export default function PublishInventory() {
  const d51Ready = usePageMemory();

  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const [tab, setTab] = useRememberedState<"single" | "list" | "import">(
    "tab",
    requestedTab === "list" || requestedTab === "single"
      ? requestedTab
      : "import"
  );
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitFeedback, setSubmitFeedback] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [submitErrorField, setSubmitErrorField] = useState<string | null>(null);
  const [submitIntent, setSubmitIntent] = useState<
    "draft" | "published" | null
  >(null);
  const { user, loading: authLoading } = useAuth();
  /*
   * 草稿隔离到用户：办公机常被多人共用，库存价格属敏感信息，
   * 不能让下一个登录的人看到上一个人的报价草稿。
   */
  const draftUserId = user?.id ?? null;
  /* 恢复提示条：仅在真的从草稿恢复出内容时出现，避免无意义打扰 */
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  /*
   * 标记「本次挂载是否已完成草稿读取」。
   * 必须有这个开关：读取是异步于首帧的（要等 user 就绪才知道读哪个 key），
   * 若保存逻辑先跑一轮，会把空表单覆盖写进去，等于亲手删掉用户的草稿。
   */
  const draftLoadedRef = useRef(false);
  const submitLockRef = useRef(false);
  const publishRequestRef = useRef<{
    requestId: string;
    payloadKey: string;
  } | null>(null);
  const publishAllRequestRef = useRef<string | null>(null);
  const publishJobNoticeRef = useRef(new Set<string>());
  const [draftPage, setDraftPage] = useRememberedState("draftPage", 1);
  const [activePublishJobId, setActivePublishJobId] = useState<string | null>(
    null
  );
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<number>>(
    () => new Set()
  );
  const [publishFailures, setPublishFailures] = useState<
    Record<number, string>
  >({});
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const enterpriseScope = trpc.enterprise.me.useQuery(undefined, {
    enabled: Boolean(user?.id) && !authLoading,
    retry: false,
  });
  const activeEnterpriseId = Number(enterpriseScope.data?.enterprise?.id);
  const scopeIdentityMatches =
    Number(enterpriseScope.data?.currentUserId) === Number(user?.id);
  const repairScopeKey =
    scopeIdentityMatches &&
    Number.isSafeInteger(activeEnterpriseId) &&
    activeEnterpriseId > 0 &&
    user?.id
      ? `${user.id}:${activeEnterpriseId}`
      : null;
  const repairScopeReady = Boolean(
    user?.id &&
      !authLoading &&
      !enterpriseScope.isLoading &&
      !enterpriseScope.isError &&
      scopeIdentityMatches &&
      repairScopeKey
  );
  const repairInitialJobId =
    new URLSearchParams(window.location.search).get("repairJob") || undefined;
  const repairCountInput = useMemo(
    () => ({
      page: 1,
      limit: 1,
      // This client-only key partitions the query cache during enterprise switches.
      __repairScopeKey: repairScopeKey ?? "unresolved",
    }),
    [repairScopeKey]
  );
  const repairCountQuery = (trpc.importInventory as any).repairList.useQuery(
    repairCountInput,
    {
      enabled: repairScopeReady,
      retry: false,
      keepPreviousData: false,
    }
  );
  const repairTotal =
    repairScopeReady &&
    repairCountQuery.data?.scopeKey === repairScopeKey &&
    Number.isFinite(Number(repairCountQuery.data?.total))
      ? Math.max(0, Number(repairCountQuery.data.total))
      : 0;
  const onRepairCountChange = useCallback(
    (reportedScope: string, count: number) => {
      // The callback is only a prompt to re-read the shared server query. It
      // never turns a child-local count into a cross-enterprise static badge.
      if (
        reportedScope !== repairScopeKey ||
        !repairScopeReady ||
        !Number.isFinite(count) ||
        count < 0
      )
        return;
      void repairCountQuery.refetch();
    },
    [repairCountQuery.refetch, repairScopeKey, repairScopeReady]
  );

  const { data: draftList, isLoading } = useRestoringListQuery(
    trpc.inventory.listPaged.useQuery(
      {
        status: "draft",
        page: draftPage,
        pageSize: INVENTORY_LIST_DEFAULT_PAGE_SIZE,
      },
      freshListOptions({}, d51Ready)
    )
  );
  const drafts = draftList?.items ?? [];
  const draftTotal = draftList?.total ?? 0;
  const pendingTotal = draftTotal + repairTotal;
  const draftPageCount = draftList?.pageCount ?? 1;
  const failedDraftCount = useMemo(
    () => drafts.filter(item => Boolean(item.publishErrorCode)).length,
    [drafts]
  );
  const allDraftsSelected =
    drafts.length > 0 && selectedDraftIds.size === drafts.length;

  useEffect(() => {
    const availableIds = new Set(drafts.map(item => item.id));
    setSelectedDraftIds(current => {
      const next = new Set(
        Array.from(current).filter(id => availableIds.has(id))
      );
      const unchanged =
        next.size === current.size &&
        Array.from(current).every(id => next.has(id));
      return unchanged ? current : next;
    });
    setPublishFailures(current => {
      const next = Object.fromEntries(
        drafts
          .map(item => [item.id, item.publishErrorMessage || current[item.id]])
          .filter((entry): entry is [number, string] => Boolean(entry[1]))
      );
      return next;
    });
  }, [drafts]);

  useEffect(() => {
    if (draftList && draftList.page !== draftPage) setDraftPage(draftList.page);
  }, [draftList?.page, draftPage]);

  const invalidate = () => utils.inventory.list.invalidate();
  const { data: recentPublishJobs = [], isSuccess: publishJobsLoaded } =
    trpc.inventory.listPublishJobs.useQuery({ limit: 10 });
  const { data: activePublishJob } = trpc.inventory.getPublishJob.useQuery(
    { jobId: activePublishJobId ?? "00000000-0000-0000-0000-000000000000" },
    {
      enabled: Boolean(activePublishJobId),
      refetchInterval: query => {
        const status = query.state.data?.status;
        return status && ["completed", "failed", "cancelled"].includes(status)
          ? false
          : 2_000;
      },
    }
  );
  const { data: publishJobErrors = [] } =
    trpc.inventory.listPublishJobErrors.useQuery(
      {
        jobId: activePublishJobId ?? "00000000-0000-0000-0000-000000000000",
        limit: 20,
      },
      {
        enabled: Boolean(
          activePublishJobId &&
            ["completed", "failed"].includes(activePublishJob?.status ?? "") &&
            (activePublishJob?.errorRows ?? 0) > 0
        ),
      }
    );

  useEffect(() => {
    if (!publishJobsLoaded || activePublishJobId) return;
    const unfinished = recentPublishJobs.find(job =>
      ["queued", "running", "paused", "failed"].includes(job.status)
    );
    if (unfinished) setActivePublishJobId(unfinished.id);
  }, [recentPublishJobs, publishJobsLoaded, activePublishJobId]);

  useEffect(() => {
    if (
      !activePublishJob ||
      publishJobNoticeRef.current.has(activePublishJob.id)
    )
      return;
    if (activePublishJob.status === "completed") {
      publishJobNoticeRef.current.add(activePublishJob.id);
      void invalidate();
      toast.success(`后台发布完成：成功 ${activePublishJob.successRows} 条`, {
        description:
          activePublishJob.errorRows > 0
            ? `另有 ${activePublishJob.errorRows} 条未发布，原因已保留。`
            : "库存已全部发布。",
      });
    } else if (activePublishJob.status === "failed") {
      publishJobNoticeRef.current.add(activePublishJob.id);
      toast.error("后台发布任务暂停", {
        description: activePublishJob.errorMessage ?? "请重试剩余库存",
      });
    }
  }, [
    activePublishJob?.id,
    activePublishJob?.status,
    activePublishJob?.successRows,
    activePublishJob?.errorRows,
  ]);

  const showSubmitFailure = useCallback((title: string, message: string) => {
    const field = inventoryValidationField(message);
    setSubmitFeedback({ title, message });
    setSubmitErrorField(field);
    toast.error(title, { description: message, duration: 8_000 });
    if (!field) return;
    requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>(
        `[data-inventory-field="${field}"]`
      );
      container?.scrollIntoView({ behavior: "smooth", block: "center" });
      container
        ?.querySelector<HTMLElement>("input, textarea, button")
        ?.focus({ preventScroll: true });
    });
  }, []);

  const createMutation = trpc.inventory.create.useMutation({
    onSuccess: (res, vars) => {
      publishRequestRef.current = null;
      if (!res.success) {
        void invalidate();
        setForm(EMPTY_FORM);
        clearFormDraft(FORM_DRAFT_IDS.publishInventory, draftUserId);
        setRestoredAt(null);
        setTab("list");
        if (res.id) setSelectedDraftIds(new Set([res.id]));
        toast.warning("发布失败，已保存到待发布列表", {
          description: res.message ?? "请修改错误字段后重新发布",
        });
        return;
      }
      invalidate();
      setSubmitFeedback(null);
      setSubmitErrorField(null);
      setForm(EMPTY_FORM);
      /* 内容已落库，本地草稿的使命结束，立即清掉避免下次误弹恢复提示 */
      clearFormDraft(FORM_DRAFT_IDS.publishInventory, draftUserId);
      setRestoredAt(null);
      if (vars.saveAs === "published") {
        toast.success("已发布", { description: "买家现在可检索到该型号" });
      } else {
        toast.success("已加入待发布列表");
        setTab("list");
      }
    },
    onError: error => {
      showSubmitFailure(
        "物料提交失败",
        formatInventorySubmissionFailure(error)
      );
    },
    onSettled: () => {
      submitLockRef.current = false;
      setSubmitIntent(null);
    },
  });

  const publishMutation = trpc.inventory.publish.useMutation({
    onSuccess: (res, vars) => {
      if (!res.success) {
        setPublishFailures(current => ({
          ...current,
          [vars.id]: res.message ?? "发布失败，请检查后重试",
        }));
        toast.error("发布失败", { description: res.message });
        return;
      }
      setPublishFailures(current => {
        const next = { ...current };
        delete next[vars.id];
        return next;
      });
      invalidate();
      toast.success("已发布", { description: "买家现在可检索到该型号" });
    },
    onError: e => toast.error(e.message),
  });

  const publishAllMutation = trpc.inventory.publishAll.useMutation({
    onSuccess: res => {
      publishAllRequestRef.current = null;
      setActivePublishJobId(res.job.id);
      setTab("list");
      toast.success(`已进入后台发布队列，共 ${res.job.totalRows} 条`, {
        description: "可以关闭页面，系统会分批发布并保留失败原因。",
      });
    },
    onError: e => toast.error(e.message),
  });
  const pausePublishJobMutation = trpc.inventory.pausePublishJob.useMutation({
    onError: error => {
      toast.error(error.message);
    },
  });
  const resumePublishJobMutation = trpc.inventory.resumePublishJob.useMutation({
    onError: error => {
      toast.error(error.message);
    },
  });
  const retryPublishJobMutation = trpc.inventory.retryPublishJob.useMutation({
    onError: error => {
      toast.error(error.message);
    },
  });
  const cancelPublishJobMutation = trpc.inventory.cancelPublishJob.useMutation({
    onError: error => {
      toast.error(error.message);
    },
  });

  const startPublishAll = () => {
    if (draftTotal === 0 || publishAllMutation.isPending) return;
    if (
      activePublishJob &&
      ["queued", "running", "paused"].includes(activePublishJob.status)
    ) {
      toast.info("当前已有后台发布任务", {
        description: "请等待完成，或先暂停/取消当前任务。",
      });
      return;
    }
    if (!publishAllRequestRef.current) {
      publishAllRequestRef.current = createClientMessageId(
        "inventory-publish-all"
      );
    }
    publishAllMutation.mutate({ requestId: publishAllRequestRef.current });
  };

  const removeMutation = trpc.inventory.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("已删除");
    },
    onError: e => toast.error(e.message),
  });

  const removeManyMutation = trpc.inventory.removeManyDrafts.useMutation({
    onSuccess: res => {
      setSelectedDraftIds(new Set());
      invalidate();
      toast.success(`已删除 ${res.deletedCount} 条待发布库存`);
    },
    onError: e => toast.error(e.message),
  });

  const clearDraftsMutation = trpc.inventory.clearDrafts.useMutation({
    onSuccess: res => {
      setSelectedDraftIds(new Set());
      setDraftPage(1);
      invalidate();
      toast.success(`已清空 ${res.deletedCount} 条待发布库存`);
    },
    onError: e => toast.error(e.message),
  });

  const toggleDraftSelection = (id: number, selected: boolean) => {
    setSelectedDraftIds(current => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllDrafts = (selected: boolean) => {
    setSelectedDraftIds(
      selected ? new Set(drafts.map(item => item.id)) : new Set()
    );
  };

  const deleteSelectedDrafts = () => {
    const ids = Array.from(selectedDraftIds);
    if (ids.length === 0) return;
    if (
      confirm(`确定删除选中的 ${ids.length} 条待发布库存吗？此操作不可撤销。`)
    ) {
      removeManyMutation.mutate({ ids });
    }
  };

  const clearAllDrafts = () => {
    if (draftTotal === 0) return;
    if (
      confirm(`确定一键删除全部 ${draftTotal} 条待发布库存吗？此操作不可撤销。`)
    ) {
      clearDraftsMutation.mutate();
    }
  };

  const handleSubmit = (saveAs: "draft" | "published") => {
    if (submitLockRef.current || createMutation.isPending) {
      toast.info("物料正在提交，请稍候");
      return;
    }
    setSubmitFeedback(null);
    setSubmitErrorField(null);
    const err = validateForm(form);
    if (err) {
      showSubmitFailure("请检查物料信息", err);
      return;
    }
    submitLockRef.current = true;
    setSubmitIntent(saveAs);
    try {
      const payload = toPayload(form);
      let requestId: string | undefined;
      if (saveAs === "published") {
        const payloadKey = JSON.stringify(payload);
        const previousRequest = publishRequestRef.current;
        if (previousRequest && previousRequest.payloadKey === payloadKey) {
          requestId = previousRequest.requestId;
        } else {
          requestId = createClientMessageId("inventory");
          publishRequestRef.current = { requestId, payloadKey };
        }
      }
      createMutation.mutate({
        data: payload,
        saveAs,
        requestId,
      });
    } catch (error) {
      submitLockRef.current = false;
      setSubmitIntent(null);
      showSubmitFailure(
        "物料提交失败",
        formatInventorySubmissionFailure(error)
      );
    }
  };

  /* 当前表单是否有未保存内容，保存与提醒都以此为准 */
  const formDirty = useMemo(() => isFormDirty(form, EMPTY_FORM), [form]);

  /*
   * 挂载时恢复草稿。
   * 依赖 draftUserId：user 是异步拉回的，首帧时还不知道当前是谁，
   * 不能用错的 key 去读。
   * 只在表单仍为空时回填，避免覆盖用户已经手动输入的内容。
   */
  useEffect(() => {
    if (draftLoadedRef.current) return;
    const restored = loadFormDraft<FormState>(
      FORM_DRAFT_IDS.publishInventory,
      draftUserId
    );
    draftLoadedRef.current = true;
    if (!restored) return;
    if (!isFormDirty(restored.data, EMPTY_FORM)) return;
    setForm(prev =>
      isFormDirty(prev, EMPTY_FORM) ? prev : { ...EMPTY_FORM, ...restored.data }
    );
    setRestoredAt(restored.savedAt);
  }, [draftUserId]);

  /*
   * 防抖自动保存。
   * 800ms 是权衷：太短会在连续敲字时频繁写磁盘，
   * 太长则在用户写完立即跳转的情况下丢掉最后几个字段。
   */
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    if (!formDirty) {
      /* 用户主动清空也是一种意图表达，同步清掉草稿避免“幽灵恢复” */
      clearFormDraft(FORM_DRAFT_IDS.publishInventory, draftUserId);
      return;
    }
    const timer = window.setTimeout(() => {
      saveFormDraft(FORM_DRAFT_IDS.publishInventory, draftUserId, form);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [form, formDirty, draftUserId]);

  /*
   * 关闭/刷新页面前的原生提醒。
   * 只在确有未保存内容时注册，避免空表单也弹系统确认框。
   * 注：浏览器不允许自定义文案，因此此处只能拦住动作，
   * 真正的安全感来自上面的自动保存 —— 即使用户确认离开，内容也在。
   */
  useEffect(() => {
    if (!formDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [formDirty]);

  /* 主动清空：同时清除本地草稿与恢复提示 */
  const resetFormAndDraft = () => {
    setForm(EMPTY_FORM);
    setSubmitFeedback(null);
    setSubmitErrorField(null);
    publishRequestRef.current = null;
    clearFormDraft(FORM_DRAFT_IDS.publishInventory, draftUserId);
    setRestoredAt(null);
  };

  const statusTag = (status: string) => {
    if (status === "published")
      return (
        <Badge className="bg-[#EAF3DE] text-[#3B6D11] hover:bg-[#EAF3DE] shadow-none">
          已发布
        </Badge>
      );
    if (status === "offshelf")
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          已下架
        </Badge>
      );
    return (
      <Badge className="bg-[#FAEEDA] text-[#854F0B] hover:bg-[#FAEEDA] shadow-none">
        待发布
      </Badge>
    );
  };

  return (
    <PlatformLayout>
      <div className="erp-ui">
        {/* 页头 */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">发布库存</h1>
            <p className="text-xs text-muted-foreground mt-1">
              上传自己的 Excel 并对齐表头后一键发布，也可单条录入
            </p>
          </div>
          {draftTotal > 0 && (
            <Button
              size="sm"
              className="bg-[#185FA5] hover:bg-[#0C447C]"
              disabled={publishAllMutation.isPending}
              onClick={startPublishAll}
            >
              {publishAllMutation.isPending && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              一键发布全部（{draftTotal}）
            </Button>
          )}
        </div>

        {/* Tabs */}
        <Tabs
          value={tab}
          onValueChange={v => setTab(v as "single" | "list" | "import")}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="import">Excel 批量导入</TabsTrigger>
            <TabsTrigger value="single">单条录入</TabsTrigger>
            <TabsTrigger value="list">
              待发布
              <span className="ml-1.5 text-[11px] bg-[#185FA5] text-white rounded-full px-1.5 min-w-[16px] inline-block text-center">
                {pendingTotal}
              </span>
              {failedDraftCount > 0 && (
                <span className="ml-1 text-[10px] font-medium text-red-600">
                  本页失败 {failedDraftCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "single" && (
          <Card
            className="p-6 max-w-[880px]"
            aria-busy={createMutation.isPending}
          >
            {/* 草稿恢复提示：告知恢复事实并给出一键放弃的退路 */}
            {restoredAt !== null && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-[#FAEEDA] bg-[#FFFBF3] px-3 py-2">
                <p className="text-xs text-[#854F0B] leading-relaxed">
                  已恢复上次未完成的录入内容（{formatDraftTime(restoredAt)}）。
                  如需重新填写，可点击右侧「放弃草稿」。
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-[#854F0B] hover:bg-[#FAEEDA]"
                  onClick={resetFormAndDraft}
                >
                  放弃草稿
                </Button>
              </div>
            )}
            {submitFeedback && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-red-800"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">
                    {submitFeedback.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-5">
                    {submitFeedback.message}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="关闭提交错误提示"
                  className="rounded p-0.5 text-red-500 hover:bg-red-100 hover:text-red-700"
                  onClick={() => {
                    setSubmitFeedback(null);
                    setSubmitErrorField(null);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <InventoryTextPaste form={form} setForm={setForm} />
            <InventoryFormFields
              form={form}
              setForm={setForm}
              errorFields={submitErrorField ? [submitErrorField] : []}
            />
            <div className="flex flex-col gap-3 mt-5 pt-4 border-t border-border/60 sm:flex-row sm:items-center sm:justify-end">
              {/* 让自动保存可见：用户知道内容已被保留，才敢放心离开页面 */}
              {formDirty && (
                <span className="text-[11px] text-muted-foreground sm:mr-auto">
                  {createMutation.isPending
                    ? submitIntent === "published"
                      ? "正在发布物料，请勿重复点击…"
                      : "正在保存到待发布列表…"
                    : "内容已自动暂存，离开本页后仍可继续填写"}
                </span>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={createMutation.isPending}
                  onClick={resetFormAndDraft}
                >
                  清空
                </Button>
                <Button
                  variant="outline"
                  className="border-[#185FA5] text-[#185FA5] hover:bg-[#f0f6fd] hover:text-[#0C447C]"
                  disabled={createMutation.isPending}
                  onClick={() => handleSubmit("draft")}
                >
                  {createMutation.isPending && submitIntent === "draft" && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {createMutation.isPending && submitIntent === "draft"
                    ? "保存中…"
                    : "加入待发布列表"}
                </Button>
                <Button
                  className="bg-[#185FA5] hover:bg-[#0C447C]"
                  disabled={createMutation.isPending}
                  onClick={() => handleSubmit("published")}
                >
                  {createMutation.isPending && submitIntent === "published" && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {createMutation.isPending && submitIntent === "published"
                    ? "发布中…"
                    : "直接发布"}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {tab === "import" && (
          <ExcelImportPanel
            onImported={() => {
              invalidate();
            }}
          />
        )}

        {tab === "list" && (
          <div>
            {activePublishJob && (
              <Card className="mb-3 border-[#b9d3e8] bg-[#eef6fc] p-4 text-xs text-[#254f72]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-medium">
                      后台一键发布 ·{" "}
                      {activePublishJob.status === "paused"
                        ? "已暂停"
                        : activePublishJob.status === "failed"
                          ? "处理失败"
                          : activePublishJob.status === "cancelled"
                            ? "已取消"
                            : activePublishJob.status === "completed"
                              ? "已完成"
                              : "处理中"}
                    </div>
                    <div className="mt-1 tabular-nums">
                      已处理 {activePublishJob.processedRows}/
                      {activePublishJob.totalRows}，成功{" "}
                      {activePublishJob.successRows}，未发布{" "}
                      {activePublishJob.errorRows}
                    </div>
                    <div className="mt-1 text-[11px] text-[#496c88]">
                      可以关闭页面，任务会在后台按小批次继续执行。
                    </div>
                    {activePublishJob.errorMessage && (
                      <div className="mt-1 text-amber-800">
                        {activePublishJob.errorMessage}
                      </div>
                    )}
                    {publishJobErrors.length > 0 && (
                      <div className="mt-2 space-y-1 text-amber-800">
                        {publishJobErrors.map(error => (
                          <div key={error.inventoryId}>
                            {error.partNumber || `库存${error.inventoryId}`}：
                            {error.errorMessage}
                          </div>
                        ))}
                        {activePublishJob.errorRows >
                          publishJobErrors.length && (
                          <div>
                            仅显示前 {publishJobErrors.length} 条，共{" "}
                            {activePublishJob.errorRows} 条未发布。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["queued", "running"].includes(
                      activePublishJob.status
                    ) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pausePublishJobMutation.isPending}
                        onClick={() =>
                          pausePublishJobMutation.mutate(
                            { jobId: activePublishJob.id },
                            {
                              onSuccess: () =>
                                utils.inventory.getPublishJob.invalidate({
                                  jobId: activePublishJob.id,
                                }),
                            }
                          )
                        }
                      >
                        暂停
                      </Button>
                    )}
                    {activePublishJob.status === "paused" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={resumePublishJobMutation.isPending}
                        onClick={() =>
                          resumePublishJobMutation.mutate(
                            { jobId: activePublishJob.id },
                            {
                              onSuccess: () =>
                                utils.inventory.getPublishJob.invalidate({
                                  jobId: activePublishJob.id,
                                }),
                            }
                          )
                        }
                      >
                        继续
                      </Button>
                    )}
                    {activePublishJob.status === "failed" &&
                      activePublishJob.processedRows <
                        activePublishJob.totalRows && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={retryPublishJobMutation.isPending}
                          onClick={() =>
                            retryPublishJobMutation.mutate(
                              { jobId: activePublishJob.id },
                              {
                                onSuccess: () => {
                                  publishJobNoticeRef.current.delete(
                                    activePublishJob.id
                                  );
                                  return utils.inventory.getPublishJob.invalidate(
                                    { jobId: activePublishJob.id }
                                  );
                                },
                              }
                            )
                          }
                        >
                          重试剩余库存
                        </Button>
                      )}
                    {["queued", "running", "paused"].includes(
                      activePublishJob.status
                    ) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={cancelPublishJobMutation.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "取消只停止尚未处理的库存，已经成功发布的库存不会自动下架。确认取消？"
                            )
                          )
                            return;
                          cancelPublishJobMutation.mutate(
                            { jobId: activePublishJob.id },
                            {
                              onSuccess: () =>
                                utils.inventory.getPublishJob.invalidate({
                                  jobId: activePublishJob.id,
                                }),
                            }
                          );
                        }}
                      >
                        取消任务
                      </Button>
                    )}
                    {["completed", "failed", "cancelled"].includes(
                      activePublishJob.status
                    ) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setActivePublishJobId(null)}
                      >
                        关闭任务结果
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )}
            <ImportRepairs
              scopeKey={repairScopeKey}
              scopeReady={repairScopeReady}
              initialJobId={repairInitialJobId}
              onCountChange={onRepairCountChange}
              onShowManualDrafts={
                draftTotal > 0
                  ? () => {
                      const manualDrafts = document.getElementById(
                        "manual-pending-publish"
                      ) as HTMLDetailsElement | null;
                      manualDrafts?.setAttribute("open", "");
                      manualDrafts?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                      });
                    }
                  : undefined
              }
              onRepairQueued={repairJobId => {
                // A queued repair is not a successful publish; the repair
                // component remains the authoritative status display.
                void repairJobId;
              }}
            />
            {draftTotal > 0 && (
              <details
                id="manual-pending-publish"
                className="mt-3 rounded-lg border border-border bg-white"
              >
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">
                  手工草稿（{draftTotal}）
                </summary>
                <div className="border-t border-border/60">
              <Card className="rounded-none border-0 p-0 overflow-hidden gap-0 shadow-none">
                <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-[13px] font-medium">待发布清单</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      已选择本页 {selectedDraftIds.size} / {drafts.length} 条
                    </span>
                    {failedDraftCount > 0 && (
                      <span className="ml-2 text-[11px] font-medium text-red-600">
                        本页发布失败 {failedDraftCount} 条
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                      disabled={
                        removeManyMutation.isPending ||
                        selectedDraftIds.size === 0
                      }
                      onClick={deleteSelectedDrafts}
                    >
                      {removeManyMutation.isPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      删除选中（{selectedDraftIds.size}）
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                      disabled={
                        clearDraftsMutation.isPending || draftTotal === 0
                      }
                      onClick={clearAllDrafts}
                    >
                      {clearDraftsMutation.isPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      一键删除全部（{draftTotal}）
                    </Button>
                    <Button
                      size="sm"
                      className="bg-[#185FA5] hover:bg-[#0C447C] h-7 text-xs"
                      disabled={
                        publishAllMutation.isPending || draftTotal === 0
                      }
                      onClick={startPublishAll}
                    >
                      一键发布全部（{draftTotal}）
                    </Button>
                  </div>
                </div>
                {failedDraftCount > 0 && (
                  <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                    <div className="font-medium">
                      本页有 {failedDraftCount}{" "}
                      条库存发布失败，记录和错误原因已保留。
                    </div>
                    <div className="mt-1">
                      点击“修改并重新发布”，页面会定位需要修改的字段。
                    </div>
                  </div>
                )}
                {isLoading ? (
                  <div className="p-12 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="w-11 px-3">
                            <Checkbox
                              aria-label="全选当前页待发布库存"
                              checked={
                                allDraftsSelected
                                  ? true
                                  : selectedDraftIds.size > 0
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={value =>
                                toggleAllDrafts(value === true)
                              }
                            />
                          </TableHead>
                          <TableHead className="text-[11px]">
                            型号 / 品牌
                          </TableHead>
                          <TableHead className="text-[11px]">
                            分类 / 封装
                          </TableHead>
                          <TableHead className="text-[11px]">
                            现货库存
                          </TableHead>
                          <TableHead className="text-[11px]">
                            订货库存
                          </TableHead>
                          <TableHead className="text-[11px]">单价</TableHead>
                          <TableHead className="text-[11px]">阶梯价</TableHead>
                          <TableHead className="text-[11px]">货期</TableHead>
                          <TableHead className="text-[11px] min-w-[150px]">
                            仓库地址
                          </TableHead>
                          <TableHead className="text-[11px]">状态</TableHead>
                          <TableHead className="text-[11px] text-right">
                            操作
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drafts.map(item => (
                          <TableRow
                            key={item.id}
                            className={
                              item.publishErrorMessage ||
                              publishFailures[item.id]
                                ? "bg-red-50/60"
                                : selectedDraftIds.has(item.id)
                                  ? "bg-[#f5f9fd]"
                                  : undefined
                            }
                            data-page-memory-row={String(item.id)}
                          >
                            <TableCell className="w-11 px-3">
                              <Checkbox
                                aria-label={`选择 ${item.partNumber}`}
                                checked={selectedDraftIds.has(item.id)}
                                onCheckedChange={value =>
                                  toggleDraftSelection(item.id, value === true)
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-[13px]">
                                {item.partNumber}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {item.brand}
                              </div>
                              {(item.publishErrorMessage ||
                                publishFailures[item.id]) && (
                                <div className="mt-1 max-w-[360px] rounded bg-red-100 px-1.5 py-1 text-[11px] leading-4 text-red-700">
                                  <div>
                                    发布失败：
                                    {item.publishErrorMessage ||
                                      publishFailures[item.id]}
                                  </div>
                                  {item.publishErrorFields?.length ? (
                                    <div className="mt-0.5 text-red-600">
                                      请修改：
                                      {item.publishErrorFields
                                        .map(
                                          field =>
                                            ({
                                              partNumber: "型号",
                                              qtyOnSale: "现货库存",
                                              qtyOrder: "订货库存",
                                              qtyStock: "实际库存",
                                              dateCode: "生产周期",
                                              priceEx: "单价",
                                              note: "备注",
                                            })[field] || field
                                        )
                                        .join("、")}
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="text-[13px]">{item.category}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {item.pkg || "—"}
                              </div>
                            </TableCell>
                            <TableCell className="text-[13px]">
                              {formatInventoryQuantity(
                                inventoryQuantityDisplay(item).spotQuantity
                              )}
                            </TableCell>
                            <TableCell className="text-[13px]">
                              {formatInventoryQuantity(
                                inventoryQuantityDisplay(item).orderQuantity
                              )}
                            </TableCell>
                            <TableCell className="text-[13px]">
                              <div>
                                {item.priceEx != null
                                  ? `¥${item.priceEx}`
                                  : "面议"}
                              </div>
                              {item.priceEx != null && (
                                <div className="text-[11px] text-muted-foreground">
                                  {item.taxIncluded === false
                                    ? "未税价"
                                    : "含税价"}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">
                              {item.ladderPrices?.length
                                ? `${item.ladderPrices.length} 档`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-[13px] text-muted-foreground">
                              {item.leadTime || "—"}
                            </TableCell>
                            <TableCell
                              className="text-[11px] text-muted-foreground max-w-[220px] truncate"
                              title={item.warehouseAddress || undefined}
                            >
                              {item.warehouseAddress || "—"}
                            </TableCell>
                            <TableCell>
                              {item.publishErrorCode ? (
                                <Badge className="bg-red-100 text-red-700 hover:bg-red-100 shadow-none">
                                  发布失败
                                </Badge>
                              ) : (
                                statusTag(item.status)
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex gap-1.5">
                                {item.status === "draft" && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() =>
                                        navigate(`/publish/${item.id}/edit`)
                                      }
                                    >
                                      {item.publishErrorCode
                                        ? "修改并重新发布"
                                        : "编辑"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs bg-[#185FA5] hover:bg-[#0C447C]"
                                      disabled={publishMutation.isPending}
                                      onClick={() =>
                                        publishMutation.mutate({ id: item.id })
                                      }
                                    >
                                      {item.publishErrorCode ||
                                      publishFailures[item.id]
                                        ? "重新发布"
                                        : "发布"}
                                    </Button>
                                  </>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                                  disabled={removeMutation.isPending}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `确定删除「${item.partNumber}」吗？`
                                      )
                                    ) {
                                      removeMutation.mutate({ id: item.id });
                                    }
                                  }}
                                >
                                  删除
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
              <div className="mt-3 px-4 pb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    共 {draftTotal} 条待发布库存 · 每页{" "}
                    {INVENTORY_LIST_DEFAULT_PAGE_SIZE} 条
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 bg-white text-xs"
                      disabled={draftPage <= 1}
                      onClick={() => {
                        setDraftPage(page => Math.max(1, page - 1));
                        setSelectedDraftIds(new Set());
                      }}
                    >
                      上一页
                    </Button>
                    <span className="min-w-[64px] text-center">
                      第 {draftPage} / {draftPageCount} 页
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 bg-white text-xs"
                      disabled={draftPage >= draftPageCount}
                      onClick={() => {
                        setDraftPage(page =>
                          Math.min(draftPageCount, page + 1)
                        );
                        setSelectedDraftIds(new Set());
                      }}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </PlatformLayout>
  );
}
