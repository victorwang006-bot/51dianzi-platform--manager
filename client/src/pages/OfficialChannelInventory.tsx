import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  OfficialChannelLegacyControls,
  OfficialLegacySourceClassification,
} from "@/components/OfficialChannelLegacyControls";
import OfficialInventoryOwnerTransfer from "@/components/OfficialInventoryOwnerTransfer";
import OfficialInventoryReception, { officialReceptionDescription } from "@/components/OfficialInventoryReception";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  errorMessage,
  formatOfficialDate,
  officialRequestId,
  officialSourceTypeLabel,
  readOfficialSource,
  readOfficialSourceList,
  readOfficialServerScope,
  readOfficialStock,
  readOfficialStockList,
  readOfficialStockNotes,
  readOfficialTeamsOverview,
  type OfficialSource,
  type OfficialSourceType,
  type OfficialStock,
} from "@/lib/officialChannelInventoryUi";
import { trpc } from "@/lib/trpc";
import {
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import "./OfficialChannelInventory.css";

const PAGE_SIZE = 20;
const SOURCE_TYPES: readonly { value: OfficialSourceType; label: string }[] = [
  { value: "factory", label: "原厂" },
  { value: "agent", label: "代理商" },
  { value: "trade", label: "贸易商" },
  { value: "other", label: "其他" },
];

type SourceFilters = {
  name: string;
  type: "all" | OfficialSourceType;
  active: "all" | "active" | "inactive";
};

type StockFilters = {
  sourceId: number | null;
  query: string;
  status: "all" | "draft" | "published" | "offshelf";
};

type SourceForm = {
  name: string;
  type: OfficialSourceType;
  contactName: string;
  phone: string;
  wechat: string;
  qq: string;
  notes: string;
};

type StockForm = {
  sourceId: number | null;
  partNumber: string;
  brand: string;
  qty: string;
  dateCode: string;
  price: string;
  taxIncluded: "unknown" | "included" | "excluded";
  leadTime: string;
};

type SourceEditor =
  | { mode: "create" }
  | { mode: "edit"; source: OfficialSource };
type StockEditor = { mode: "create" } | { mode: "edit"; stock: OfficialStock };

type ImportedDraft = {
  partNumber: string;
  brand: string;
  qty: string;
  dateCode: string;
  price: string;
  currency: string;
  taxIncluded: string;
  leadTime: string;
};

type ImportField = keyof ImportedDraft;
type ImportMapping = Record<ImportField, number>;
type ImportedRow = { row: number; draft: ImportedDraft; errors: string[] };
type BatchEntry = {
  row: number;
  requestId: string;
  payload: ReturnType<typeof stockPayloadFromDraft>;
  status: "pending" | "success" | "unknown";
  error?: string;
};

const IMPORT_FIELDS: readonly {
  key: ImportField;
  label: string;
  required: boolean;
}[] = [
  { key: "partNumber", label: "型号", required: true },
  { key: "brand", label: "品牌", required: true },
  { key: "qty", label: "可供数量", required: false },
  { key: "dateCode", label: "Date Code", required: false },
  { key: "price", label: "报价（CNY）", required: false },
  { key: "currency", label: "币种", required: false },
  { key: "taxIncluded", label: "税务口径", required: false },
  { key: "leadTime", label: "交期", required: false },
];

const EMPTY_SOURCE_FORM: SourceForm = {
  name: "",
  type: "factory",
  contactName: "",
  phone: "",
  wechat: "",
  qq: "",
  notes: "",
};

const EMPTY_STOCK_FORM: StockForm = {
  sourceId: null,
  partNumber: "",
  brand: "",
  qty: "",
  dateCode: "",
  price: "",
  taxIncluded: "unknown",
  leadTime: "",
};

const EMPTY_IMPORTED_DRAFT: ImportedDraft = {
  partNumber: "",
  brand: "",
  qty: "",
  dateCode: "",
  price: "",
  currency: "CNY",
  taxIncluded: "unknown",
  leadTime: "",
};

function nullable(value: string): string | null {
  const result = value.trim();
  return result || null;
}

function sourceFormFrom(source: OfficialSource): SourceForm {
  return {
    name: source.name,
    type: source.type,
    contactName: source.contactName ?? "",
    phone: source.phone ?? "",
    wechat: source.wechat ?? "",
    qq: source.qq ?? "",
    notes: source.notes ?? "",
  };
}

function stockFormFrom(stock: OfficialStock): StockForm {
  return {
    sourceId: stock.sourceId,
    partNumber: stock.partNumber,
    brand: stock.brand,
    qty: stock.qty === null ? "" : String(stock.qty),
    dateCode: stock.dateCode ?? "",
    price: stock.price ?? "",
    taxIncluded:
      stock.taxIncluded === null
        ? "unknown"
        : stock.taxIncluded
          ? "included"
          : "excluded",
    leadTime: stock.leadTime ?? "",
  };
}

function sourcePayload(form: SourceForm) {
  return {
    name: form.name.trim(),
    type: form.type,
    contactName: nullable(form.contactName),
    phone: nullable(form.phone),
    wechat: nullable(form.wechat),
    qq: nullable(form.qq),
    notes: nullable(form.notes),
  };
}

function stockPayloadFromDraft(form: StockForm) {
  const sourceId = form.sourceId;
  const qty = form.qty.trim();
  if (
    typeof sourceId !== "number" ||
    !Number.isSafeInteger(sourceId) ||
    sourceId <= 0
  ) {
    throw new Error("请选择启用的来源");
  }
  return {
    sourceId,
    partNumber: form.partNumber.normalize("NFKC").trim(),
    brand: form.brand.trim(),
    qty: qty ? Number(qty) : null,
    dateCode: nullable(form.dateCode),
    price: nullable(form.price),
    currency: "CNY" as const,
    taxIncluded:
      form.taxIncluded === "unknown" ? null : form.taxIncluded === "included",
    leadTime: nullable(form.leadTime),
  };
}

function validateSource(form: SourceForm): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("请输入来源名称");
  if (form.name.trim().length > 128) errors.push("来源名称不能超过 128 个字符");
  if (form.contactName.trim().length > 128)
    errors.push("联系人不能超过 128 个字符");
  if (form.phone.trim().length > 32) errors.push("联系电话不能超过 32 个字符");
  if (form.wechat.trim().length > 128) errors.push("微信不能超过 128 个字符");
  if (form.qq.trim().length > 64) errors.push("QQ 不能超过 64 个字符");
  if (form.notes.length > 2000) errors.push("来源说明不能超过 2000 个字符");
  return errors;
}

function validateStock(form: StockForm): string[] {
  const errors: string[] = [];
  const sourceId = form.sourceId;
  const qty = form.qty.trim();
  const price = form.price.trim();
  if (
    typeof sourceId !== "number" ||
    !Number.isSafeInteger(sourceId) ||
    sourceId <= 0
  )
    errors.push("请选择启用的来源");
  if (!form.partNumber.normalize("NFKC").trim()) errors.push("请输入型号");
  if (form.partNumber.normalize("NFKC").trim().length > 128)
    errors.push("型号不能超过 128 个字符");
  if (!form.brand.trim()) errors.push("请输入品牌");
  if (form.brand.trim().length > 128) errors.push("品牌不能超过 128 个字符");
  if (qty && (!/^\d+$/.test(qty) || Number(qty) > 2_147_483_647))
    errors.push("数量须为 0 到 2147483647 的整数；留空表示待确认");
  if (form.dateCode.trim().length > 64)
    errors.push("Date Code 不能超过 64 个字符");
  if (price && !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(price))
    errors.push("价格格式无效；留空表示面议");
  if (form.leadTime.trim().length > 255) errors.push("交期不能超过 255 个字符");
  return errors;
}

function formatPrice(stock: OfficialStock) {
  if (!stock.price) return "面议";
  return `¥${stock.price}${stock.taxIncluded === null ? "" : stock.taxIncluded ? " · 含税" : " · 未税"}`;
}

function statusLabel(status: OfficialStock["status"]) {
  return status === "published"
    ? "已发布"
    : status === "offshelf"
      ? "已下架"
      : "草稿";
}

function filterActive(value: SourceFilters["active"]): boolean | undefined {
  return value === "active" ? true : value === "inactive" ? false : undefined;
}

function headerToken(value: unknown): string {
  return value == null
    ? ""
    : String(value)
        .normalize("NFKC")
        .trim()
        .toLocaleLowerCase()
        .replace(/[\s_\-—–/\\()（）\[\]【】.:：]/g, "");
}

const IMPORT_ALIASES: Record<ImportField, readonly string[]> = {
  partNumber: [
    "型号",
    "料号",
    "型号料号",
    "partnumber",
    "partno",
    "pn",
    "mpn",
    "materialnumber",
    "物料编码",
  ],
  brand: ["品牌", "厂牌", "brand", "manufacturer", "mfr", "制造商"],
  qty: [
    "可供数量",
    "数量",
    "库存",
    "库存数量",
    "qty",
    "quantity",
    "availablequantity",
    "availableqty",
    "stock",
  ],
  dateCode: ["datecode", "dc", "日期码", "生产日期", "批号", "批次"],
  price: [
    "报价cny",
    "人民币报价",
    "报价",
    "价格",
    "单价",
    "price",
    "unitprice",
    "offerprice",
    "quotation",
    "quote",
    "cnyprice",
  ],
  currency: ["币种", "货币", "币别", "currency", "currencycny", "报价币种"],
  taxIncluded: [
    "税务口径",
    "税务",
    "税别",
    "是否含税",
    "含税",
    "taxincluded",
    "tax",
    "vat",
    "taxstatus",
  ],
  leadTime: ["交期", "货期", "交货期", "leadtime", "delivery"],
};

function suggestImportMapping(headers: readonly unknown[]): ImportMapping {
  return Object.fromEntries(
    IMPORT_FIELDS.map(field => [
      field.key,
      headers
        .map(headerToken)
        .findIndex(token => IMPORT_ALIASES[field.key].includes(token)),
    ])
  ) as ImportMapping;
}

function normalizeImportedDraft(draft: ImportedDraft): ImportedDraft {
  const qty = draft.qty.normalize("NFKC").trim();
  const price = draft.price.normalize("NFKC").trim();
  const currency = draft.currency.normalize("NFKC").trim();
  const tax = draft.taxIncluded.normalize("NFKC").trim();
  return {
    partNumber: draft.partNumber.normalize("NFKC").trim(),
    brand: draft.brand.trim(),
    qty: /^\d{1,3}(?:,\d{3})+$/.test(qty) ? qty.replaceAll(",", "") : qty,
    dateCode: draft.dateCode.trim(),
    price: /^\d{1,3}(?:,\d{3})+(?:\.\d{1,12})?$/.test(price)
      ? price.replaceAll(",", "")
      : price,
    currency:
      currency === "" || ["CNY", "元", "人民币", "RMB"].includes(currency)
        ? "CNY"
        : currency,
    taxIncluded:
      tax === "" || tax === "待确认" || tax.toLowerCase() === "unknown"
        ? "unknown"
        : tax === "含税" || tax.toLowerCase() === "true"
          ? "true"
          : tax === "未税" || tax === "不含税" || tax.toLowerCase() === "false"
            ? "false"
            : tax,
    leadTime: draft.leadTime.trim(),
  };
}

function importedRowErrors(draft: ImportedDraft): string[] {
  return validateStock({
    sourceId: 1,
    partNumber: draft.partNumber,
    brand: draft.brand,
    qty: draft.qty,
    dateCode: draft.dateCode,
    price: draft.price,
    taxIncluded:
      draft.taxIncluded === "true"
        ? "included"
        : draft.taxIncluded === "false"
          ? "excluded"
          : "unknown",
    leadTime: draft.leadTime,
  }).filter(error => error !== "请选择启用的来源");
}

function mapImportedRows(
  grid: readonly (readonly unknown[])[],
  mapping: ImportMapping
): ImportedRow[] {
  const rows: ImportedRow[] = [];
  for (let index = 1; index < grid.length; index += 1) {
    const input = grid[index] ?? [];
    if (input.every(value => String(value ?? "").trim() === "")) continue;
    const raw = { ...EMPTY_IMPORTED_DRAFT };
    for (const field of IMPORT_FIELDS) {
      const column = mapping[field.key];
      if (column >= 0) raw[field.key] = String(input[column] ?? "");
    }
    const draft = normalizeImportedDraft(raw);
    const errors = importedRowErrors(draft);
    if (draft.currency !== "CNY")
      errors.push("币种仅支持 CNY，不能换算其他币种");
    if (!["true", "false", "unknown"].includes(draft.taxIncluded))
      errors.push("税务口径仅支持含税、未税/不含税或待确认");
    rows.push({ row: index + 1, draft, errors });
  }
  return rows;
}

function validateImportMapping(mapping: ImportMapping): string[] {
  const errors: string[] = [];
  const used = new Map<number, string>();
  for (const field of IMPORT_FIELDS) {
    const column = mapping[field.key];
    if (field.required && column < 0)
      errors.push(`${field.label}为必填字段，必须映射列`);
    if (column >= 0) {
      const previous = used.get(column);
      if (previous)
        errors.push(`第 ${column + 1} 列重复映射到${previous}和${field.label}`);
      else used.set(column, field.label);
    }
  }
  return errors;
}

function importDraftToStockForm(
  draft: ImportedDraft,
  sourceId: number
): StockForm {
  return {
    sourceId,
    partNumber: draft.partNumber,
    brand: draft.brand,
    qty: draft.qty,
    dateCode: draft.dateCode,
    price: draft.price,
    taxIncluded:
      draft.taxIncluded === "true"
        ? "included"
        : draft.taxIncluded === "false"
          ? "excluded"
          : "unknown",
    leadTime: draft.leadTime,
  };
}

function downloadOfficialCsv(
  filename: string,
  csv: string,
  contentType: string
) {
  const url = URL.createObjectURL(new Blob([csv], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function OfficialChannelInventory() {
  const { user } = useAuth();
  const trpcUtils = trpc.useUtils();
  const [tab, setTab] = useState<"sources" | "stocks">("stocks");
  const [sourcePage, setSourcePage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const [sourceFilters, setSourceFilters] = useState<SourceFilters>({
    name: "",
    type: "all",
    active: "all",
  });
  const [stockFilters, setStockFilters] = useState<StockFilters>({
    sourceId: null,
    query: "",
    status: "all",
  });
  const [sourceEditor, setSourceEditor] = useState<SourceEditor | null>(null);
  const [sourceForm, setSourceForm] = useState<SourceForm>(EMPTY_SOURCE_FORM);
  const [sourceTeamId, setSourceTeamId] = useState<number | null>(null);
  const [stockEditor, setStockEditor] = useState<StockEditor | null>(null);
  const [stockForm, setStockForm] = useState<StockForm>(EMPTY_STOCK_FORM);
  const [stockDetailId, setStockDetailId] = useState<number | null>(null);
  const [sourceDetailId, setSourceDetailId] = useState<number | null>(null);
  const [notesStock, setNotesStock] = useState<OfficialStock | null>(null);
  const [noteText, setNoteText] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSourceId, setBatchSourceId] = useState<number | null>(null);
  const [batchFileName, setBatchFileName] = useState("");
  const [batchGrid, setBatchGrid] = useState<unknown[][]>([]);
  const [batchMapping, setBatchMapping] = useState<ImportMapping>(() =>
    suggestImportMapping([])
  );
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const teamsOverviewQuery = trpc.officialTeams.overview.useQuery(undefined, {
    enabled:
      user?.hasNativeAdminAccount === true && user?.adminRole === "super_admin",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const teamsOverview = useMemo(
    () => readOfficialTeamsOverview(teamsOverviewQuery.data),
    [teamsOverviewQuery.data]
  );

  const sourcesQuery = trpc.officialChannelInventory.listSources.useQuery(
    {
      limit: PAGE_SIZE,
      offset: (sourcePage - 1) * PAGE_SIZE,
      query: sourceFilters.name.trim() || undefined,
      type: sourceFilters.type === "all" ? undefined : sourceFilters.type,
      active: filterActive(sourceFilters.active),
    },
    { retry: false, refetchOnWindowFocus: false }
  );
  const sourceOptionsQuery = trpc.officialChannelInventory.listSources.useQuery(
    {
      limit: 100,
      offset: 0,
    },
    { retry: false, refetchOnWindowFocus: false }
  );
  const stocksQuery = trpc.officialChannelInventory.listStocks.useQuery(
    {
      limit: PAGE_SIZE,
      offset: (stockPage - 1) * PAGE_SIZE,
      sourceId: stockFilters.sourceId ?? undefined,
      query: stockFilters.query.trim() || undefined,
      status: stockFilters.status === "all" ? undefined : stockFilters.status,
    },
    { retry: false, refetchOnWindowFocus: false }
  );
  const sourceDetailQuery = trpc.officialChannelInventory.getSource.useQuery(
    { sourceId: sourceDetailId ?? 0 },
    {
      enabled: sourceDetailId !== null,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const stockDetailQuery = trpc.officialChannelInventory.getStock.useQuery(
    { stockId: stockDetailId ?? 0 },
    {
      enabled: stockDetailId !== null,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const notesQuery = trpc.officialChannelInventory.listNotes.useQuery(
    { stockId: notesStock?.id ?? 0, limit: 50, offset: 0 },
    { enabled: notesStock !== null, retry: false, refetchOnWindowFocus: false }
  );

  const createSource = trpc.officialChannelInventory.createSource.useMutation();
  const updateSource = trpc.officialChannelInventory.updateSource.useMutation();
  const setSourceActive =
    trpc.officialChannelInventory.setSourceActive.useMutation();
  const createStock = trpc.officialChannelInventory.createStock.useMutation();
  const updateStock = trpc.officialChannelInventory.updateStock.useMutation();
  const publishStock = trpc.officialChannelInventory.publishStock.useMutation();
  const offshelfStock =
    trpc.officialChannelInventory.offshelfStock.useMutation();
  const addNote = trpc.officialChannelInventory.addNote.useMutation();
  const busy =
    createSource.isPending ||
    updateSource.isPending ||
    setSourceActive.isPending ||
    createStock.isPending ||
    updateStock.isPending ||
    publishStock.isPending ||
    offshelfStock.isPending ||
    addNote.isPending ||
    batchBusy;

  const sources = readOfficialSourceList(sourcesQuery.data);
  const sourceOptionsResult = readOfficialSourceList(sourceOptionsQuery.data);
  const sourceOptions = sourceOptionsResult.available
    ? sourceOptionsResult.items
    : [];
  const stocks = readOfficialStockList(stocksQuery.data);
  const sourceServerScope = useMemo(
    () => readOfficialServerScope(sourcesQuery.data),
    [sourcesQuery.data]
  );
  const stockServerScope = useMemo(
    () => readOfficialServerScope(stocksQuery.data),
    [stocksQuery.data]
  );
  // Compatibility and ownership-transfer controls must not inherit the team
  // overview's scope. They are visible only after a native inventory list has
  // returned a complete server-derived super-admin scope.
  const inventoryServerScope = sourceServerScope.available
    ? sourceServerScope
    : stockServerScope.available
      ? stockServerScope
      : null;
  const isInventoryServerSuperAdmin =
    inventoryServerScope?.isSuperAdmin === true;
  // Teams overview is a real-super-admin-only configuration API. A normal
  // inventory user can only become writable after list APIs return serverScope.
  const serverScope = sourceServerScope.available
    ? sourceServerScope
    : stockServerScope.available
      ? stockServerScope
      : readOfficialServerScope(null);
  const isRealSuperAdmin =
    serverScope.available && serverScope.isSuperAdmin === true;
  const canWrite =
    serverScope.available &&
    (isRealSuperAdmin ||
      serverScope.permissions.includes("officialInventory.write"));
  const canExport =
    serverScope.available &&
    (isRealSuperAdmin ||
      serverScope.permissions.includes("officialInventory.read"));
  const canCreateSource =
    canWrite && (!isRealSuperAdmin || teamsOverview.available);
  const canCreateStock = canWrite && sourceOptionsResult.available;
  const activeOfficialTeams = teamsOverview.teams.filter(
    team => team.status === "active"
  );
  const sourceDetail = readOfficialSource(sourceDetailQuery.data);
  const stockDetail = readOfficialStock(stockDetailQuery.data?.stock);
  const notesResult = readOfficialStockNotes(notesQuery.data);
  const notes = notesResult.items;
  const importRows = useMemo(
    () => mapImportedRows(batchGrid, batchMapping),
    [batchGrid, batchMapping]
  );
  const importMappingErrors = useMemo(
    () => validateImportMapping(batchMapping),
    [batchMapping]
  );
  const invalidImportRows = importRows.filter(row => row.errors.length > 0);
  const selectedBatchSource =
    sourceOptions.find(source => source.id === batchSourceId) ?? null;

  useEffect(() => {
    setSourcePage(1);
  }, [sourceFilters.active, sourceFilters.name, sourceFilters.type]);
  useEffect(() => {
    setStockPage(1);
  }, [stockFilters.query, stockFilters.sourceId, stockFilters.status]);

  const refreshSources = async () => {
    await Promise.all([sourcesQuery.refetch(), sourceOptionsQuery.refetch()]);
  };
  const refreshStocks = async () => {
    await stocksQuery.refetch();
  };

  const openSourceEditor = (editor: SourceEditor) => {
    setSourceEditor(editor);
    setSourceForm(
      editor.mode === "edit" ? sourceFormFrom(editor.source) : EMPTY_SOURCE_FORM
    );
    setSourceTeamId(
      editor.mode === "create" && activeOfficialTeams.length === 1
        ? activeOfficialTeams[0].id
        : null
    );
  };
  const openStockEditor = (editor: StockEditor) => {
    setStockEditor(editor);
    setStockForm(
      editor.mode === "edit" ? stockFormFrom(editor.stock) : EMPTY_STOCK_FORM
    );
  };

  const saveSource = async () => {
    if (!sourceEditor || !canCreateSource) return;
    const errors = validateSource(sourceForm);
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    if (
      sourceEditor.mode === "create" &&
      isRealSuperAdmin &&
      (typeof sourceTeamId !== "number" ||
        !Number.isSafeInteger(sourceTeamId) ||
        sourceTeamId <= 0)
    ) {
      toast.error("请选择来源所属的官方团队");
      return;
    }
    try {
      if (sourceEditor.mode === "create") {
        await createSource.mutateAsync({
          ...sourcePayload(sourceForm),
          requestId: officialRequestId("official_source_create"),
          ...(isRealSuperAdmin && sourceTeamId ? { teamId: sourceTeamId } : {}),
        });
        toast.success("来源已创建");
      } else {
        await updateSource.mutateAsync({
          sourceId: sourceEditor.source.id,
          ...sourcePayload(sourceForm),
          expectedRevision: sourceEditor.source.revision,
          requestId: officialRequestId("official_source_update"),
        });
        toast.success("来源已更新");
      }
      setSourceEditor(null);
      await refreshSources();
    } catch (error) {
      toast.error("来源未保存", {
        description: errorMessage(error, "请刷新后重试。"),
      });
    }
  };

  const toggleSource = async (source: OfficialSource) => {
    if (!canWrite) return;
    try {
      await setSourceActive.mutateAsync({
        sourceId: source.id,
        active: !source.active,
        expectedRevision: source.revision,
        requestId: officialRequestId("official_source_active"),
      });
      toast.success(source.active ? "来源已停用" : "来源已启用");
      await refreshSources();
    } catch (error) {
      toast.error("来源状态未更新", {
        description: errorMessage(error, "请刷新后重试。"),
      });
    }
  };

  const confirmSourcePublication = async (source: OfficialSource) => {
    if (!isRealSuperAdmin) return;
    try {
      // Server-side super-admin validation remains authoritative. Send the full
      // current private source fields so an approval never clears source data.
      await updateSource.mutateAsync({
        sourceId: source.id,
        ...sourcePayload(sourceFormFrom(source)),
        publicationApproved: true,
        expectedRevision: source.revision,
        requestId: officialRequestId("official_source_approve"),
      });
      toast.success("来源已确认可发布");
      await refreshSources();
      await sourceDetailQuery.refetch();
    } catch (error) {
      toast.error("未确认发布资格", {
        description: errorMessage(error, "当前来源的发布资格未被确认。"),
      });
    }
  };

  const saveStock = async () => {
    if (!stockEditor || !canCreateStock) return;
    const errors = validateStock(stockForm);
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    const payload = stockPayloadFromDraft(stockForm);
    try {
      if (stockEditor.mode === "create") {
        // teamId, ownerAdminUserId and createdByAdminUserId are intentionally
        // absent: createStock derives all three from the server scope.
        await createStock.mutateAsync({
          ...payload,
          requestId: officialRequestId("official_stock_create"),
        });
        toast.success("渠道库存已保存为草稿");
      } else {
        // Source cannot be reassigned by the editor; it is only supplied on create.
        const { sourceId: _sourceId, ...updatePayload } = payload;
        await updateStock.mutateAsync({
          stockId: stockEditor.stock.id,
          ...updatePayload,
          expectedRevision: stockEditor.stock.revision,
          requestId: officialRequestId("official_stock_update"),
        });
        toast.success("渠道库存已更新");
      }
      setStockEditor(null);
      await refreshStocks();
    } catch (error) {
      toast.error("渠道库存未保存", {
        description: errorMessage(error, "请刷新后重试。"),
      });
    }
  };

  const changeStockStatus = async (stock: OfficialStock) => {
    if (
      (stock.status === "published" && !stock.permissions.canOffshelf) ||
      (stock.status !== "published" && !stock.permissions.canPublish)
    )
      return;
    const mutation =
      stock.status === "published" ? offshelfStock : publishStock;
    const label = stock.status === "published" ? "下架" : "发布";
    try {
      if (stock.status !== "published") {
        const current = await trpcUtils.client.officialChannelInventory.getReception.query({ stockId: stock.id });
        if (current.stockRevision !== stock.revision) throw new Error("库存责任或版本已变化，请刷新核对后再发布");
        const prompt = `${officialReceptionDescription(current.reception)}。\n${current.reception.status === "pending" ? "本次只能发布展示，前台询价会被拦截；请先配置接待以便投递。" : "接待员工将在前台确认询价时再次核验。"}\n是否明确确认发布？`;
        if (!window.confirm(prompt)) return;
      }
      await mutation.mutateAsync({
        stockId: stock.id,
        expectedRevision: stock.revision,
        requestId: officialRequestId(
          stock.status === "published"
            ? "official_stock_offshelf"
            : "official_stock_publish"
        ),
      });
      toast.success(`库存已${label}`);
      await refreshStocks();
    } catch (error) {
      toast.error(`库存未${label}`, {
        description: errorMessage(error, "请刷新后重试。"),
      });
    }
  };

  const submitNote = async () => {
    if (!notesStock?.permissions.canAddNote) return;
    const body = noteText.trim();
    if (!body) {
      toast.error("请输入内部备注");
      return;
    }
    try {
      await addNote.mutateAsync({
        stockId: notesStock.id,
        body,
        requestId: officialRequestId("official_stock_note"),
      });
      setNoteText("");
      toast.success("内部备注已追加");
      await Promise.all([notesQuery.refetch(), refreshStocks()]);
    } catch (error) {
      toast.error("内部备注未保存", {
        description: errorMessage(error, "请刷新后重试。"),
      });
    }
  };

  const exportStocks = async () => {
    if (!canExport) return;
    try {
      const data =
        await trpcUtils.client.officialChannelInventory.exportStocks.query({
          sourceId: stockFilters.sourceId ?? undefined,
          status:
            stockFilters.status === "all" ? undefined : stockFilters.status,
        });
      if (!data.count) {
        toast.info("当前筛选没有可导出的库存");
        return;
      }
      downloadOfficialCsv(data.filename, data.csv, data.contentType);
      toast.success(`已导出 ${data.count} 条库存`);
    } catch (error) {
      toast.error("导出失败", {
        description: errorMessage(error, "请刷新后重试。"),
      });
    }
  };

  const onSelectImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBatchError(null);
    setBatchEntries([]);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setBatchError("请选择 Excel（.xlsx/.xls）或 CSV 文件。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setBatchError("每份文件最多 5MB，请拆分后重试。");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        sheetRows: 1002,
        cellFormula: false,
        cellHTML: false,
        cellDates: false,
        raw: /\.csv$/i.test(file.name),
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("表格没有可读取的工作表。");
      const sheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(
        sheet["!fullref"] ?? sheet["!ref"] ?? "A1"
      );
      if (range.e.r > 1000)
        throw new Error("每批最多 1000 行数据，请拆分表格；不会静默截断。");
      if (range.e.c > 39)
        throw new Error("每份表格最多 40 列，请删除无关列后重试。");
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: true,
      });
      if (grid.length < 2)
        throw new Error("首行应为表头，且至少有一行库存数据。");
      setBatchGrid(grid);
      setBatchMapping(suggestImportMapping(grid[0] ?? []));
      setBatchFileName(`${file.name} · ${sheetName}`);
    } catch (error) {
      setBatchError(errorMessage(error, "文件读取失败，请用模板整理后重试。"));
    } finally {
      event.target.value = "";
    }
  };

  const resetBatch = () => {
    if (batchBusy) return;
    setBatchSourceId(null);
    setBatchFileName("");
    setBatchGrid([]);
    setBatchMapping(suggestImportMapping([]));
    setBatchEntries([]);
    setBatchError(null);
  };

  const runBatchImport = async () => {
    if (!canCreateStock || batchBusy) return;
    if (!selectedBatchSource || !selectedBatchSource.active) {
      setBatchError("请选择有权访问且启用的单一来源。");
      return;
    }
    if (
      importMappingErrors.length ||
      invalidImportRows.length ||
      !importRows.length
    ) {
      setBatchError("请完成字段匹配并修正所有错误行后再上传。");
      return;
    }
    const entries = batchEntries.length
      ? batchEntries
      : importRows.map(row => ({
          row: row.row,
          requestId: officialRequestId("official_stock_batch"),
          payload: stockPayloadFromDraft(
            importDraftToStockForm(row.draft, selectedBatchSource.id)
          ),
          status: "pending" as const,
        }));
    // One selected source is applied to every payload. No owner/team field is
    // ever extracted from the spreadsheet or sent to createStock.
    if (
      entries.some(entry => entry.payload.sourceId !== selectedBatchSource.id)
    ) {
      setBatchError(
        "当前恢复批次的来源与所选来源不一致。请关闭后重新选择同一来源。"
      );
      return;
    }
    setBatchEntries(entries);
    setBatchBusy(true);
    setBatchError(null);
    const next = entries.map(entry => ({ ...entry }));
    try {
      for (let index = 0; index < next.length; index += 1) {
        const entry = next[index];
        if (entry.status === "success") continue;
        try {
          await createStock.mutateAsync({
            ...entry.payload,
            requestId: entry.requestId,
          });
          next[index] = { ...entry, status: "success" };
          setBatchEntries([...next]);
        } catch (error) {
          // Preserve requestId and payload for an idempotent retry. Stop after
          // the first unknown server result; later rows are never submitted.
          const rowError = errorMessage(error, "保存结果待确认");
          next[index] = {
            ...entry,
            status: "unknown",
            error: rowError,
          };
          setBatchEntries([...next]);
          setBatchError(
            `第 ${entry.row} 行保存结果待确认：${rowError}。请保持本批次并重试。`
          );
          return;
        }
      }
      toast.success(`已逐条保存 ${next.length} 条库存，均为草稿，未自动发布。`);
      await refreshStocks();
      await refreshSources();
    } finally {
      setBatchBusy(false);
    }
  };

  const sourceListError = sourcesQuery.isError
    ? errorMessage(sourcesQuery.error, "来源加载失败")
    : sourcesQuery.isSuccess && !sources.available
      ? "来源列表未返回完整的官方分页数据，操作保持关闭。"
      : null;
  const stockListError = stocksQuery.isError
    ? errorMessage(stocksQuery.error, "渠道库存加载失败")
    : stocksQuery.isSuccess && !stocks.available
      ? "渠道库存列表未返回完整的官方分页数据，操作保持关闭。"
      : null;
  const scopeError =
    !sourceServerScope.available &&
    !stockServerScope.available &&
    teamsOverviewQuery.isError
      ? errorMessage(teamsOverviewQuery.error, "官方权限范围读取失败")
      : null;

  return (
    <DashboardLayout>
      <section
        className="official-channel-inventory"
        aria-label="官方渠道库存"
        data-official-channel-inventory
      >
        <header className="official-channel-inventory__heading">
          <div>
            <h1>渠道库存</h1>
          </div>
          <div className="official-channel-inventory__heading-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={sourcesQuery.isFetching || stocksQuery.isFetching}
              onClick={() =>
                void Promise.all([
                  refreshSources(),
                  refreshStocks(),
                  teamsOverviewQuery.refetch(),
                ])
              }
            >
              <RefreshCw
                className={`mr-1 h-3.5 w-3.5 ${sourcesQuery.isFetching || stocksQuery.isFetching ? "animate-spin" : ""}`}
              />
              刷新
            </Button>
            {isInventoryServerSuperAdmin ? (
              <OfficialChannelLegacyControls
                isRealSuperAdmin={isInventoryServerSuperAdmin}
              />
            ) : null}
            {tab === "sources" && canCreateSource ? (
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                onClick={() => openSourceEditor({ mode: "create" })}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                新增来源
              </Button>
            ) : null}
            {tab === "stocks" && canCreateStock ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    resetBatch();
                    setBatchOpen(true);
                  }}
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  批量 Excel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => openStockEditor({ mode: "create" })}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  新增库存
                </Button>
              </>
            ) : null}
          </div>
        </header>

        {scopeError ? (
          <div className="official-channel-inventory__error" role="alert">
            官方权限范围读取失败：{scopeError}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-2 h-7 bg-background text-xs"
              onClick={() => void teamsOverviewQuery.refetch()}
            >
              重试
            </Button>
          </div>
        ) : null}
        {!scopeError && !sourcesQuery.isPending && !serverScope.available ? (
          <div className="official-channel-inventory__error" role="alert">
            官方权限范围未返回有效服务器范围，操作保持不可用。
          </div>
        ) : null}

        <div
          className="official-channel-inventory__tabs"
          role="tablist"
          aria-label="渠道库存内容"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stocks"}
            onClick={() => setTab("stocks")}
          >
            渠道库存
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sources"}
            onClick={() => setTab("sources")}
          >
            渠道管理
          </button>
        </div>

        {tab === "sources" ? (
          <section
            className="official-channel-inventory__panel"
            aria-label="来源管理列表"
          >
            <div className="official-channel-inventory__toolbar">
              <label>
                <span>来源名称</span>
                <Input
                  value={sourceFilters.name}
                  className="h-8 text-xs"
                  placeholder="搜索来源"
                  onChange={event =>
                    setSourceFilters(current => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>来源类型</span>
                <select
                  value={sourceFilters.type}
                  onChange={event =>
                    setSourceFilters(current => ({
                      ...current,
                      type: event.target.value as SourceFilters["type"],
                    }))
                  }
                >
                  <option value="all">全部类型</option>
                  {SOURCE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>状态</span>
                <select
                  value={sourceFilters.active}
                  onChange={event =>
                    setSourceFilters(current => ({
                      ...current,
                      active: event.target.value as SourceFilters["active"],
                    }))
                  }
                >
                  <option value="all">全部状态</option>
                  <option value="active">启用</option>
                  <option value="inactive">已停用</option>
                </select>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() =>
                  setSourceFilters({ name: "", type: "all", active: "all" })
                }
              >
                重置
              </Button>
              <span className="official-channel-inventory__count">
                本页 {sources.items.length} 条
              </span>
            </div>
            <div className="official-channel-inventory__table-wrap">
              <table className="official-channel-inventory__table official-channel-inventory__source-table">
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>类型</th>
                    <th>联系人 / 联系方式</th>
                    <th>状态</th>
                    <th>更新时间</th>
                    <th className="official-channel-inventory__actions">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sourcesQuery.isPending ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="official-channel-inventory__empty"
                      >
                        正在加载来源…
                      </td>
                    </tr>
                  ) : null}
                  {sourceListError ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="official-channel-inventory__empty is-error"
                      >
                        来源加载失败：{sourceListError}
                        <button
                          type="button"
                          onClick={() => void sourcesQuery.refetch()}
                        >
                          重试
                        </button>
                      </td>
                    </tr>
                  ) : null}
                  {!sourcesQuery.isPending &&
                  !sourceListError &&
                  !sources.items.length ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="official-channel-inventory__empty"
                      >
                        暂无符合筛选条件的来源。
                      </td>
                    </tr>
                  ) : null}
                  {sources.items.map(source => (
                    <tr key={source.id}>
                      <td>
                        <button
                          type="button"
                          className="official-channel-inventory__name"
                          onClick={() => setSourceDetailId(source.id)}
                        >
                          {source.name}
                        </button>
                      </td>
                      <td>
                        <span className="official-channel-inventory__type">
                          {officialSourceTypeLabel(source.type)}
                        </span>
                      </td>
                      <td>
                        <div>{source.contactName ?? "—"}</div>
                        <small>
                          {[
                            source.phone,
                            source.wechat ? `微信 ${source.wechat}` : null,
                            source.qq ? `QQ ${source.qq}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "未填写联系方式"}
                        </small>
                      </td>
                      <td>
                        <span
                          className={
                            source.active
                              ? "official-channel-inventory__status is-active"
                              : "official-channel-inventory__status"
                          }
                        >
                          {source.active ? "启用" : "已停用"}
                        </span>
                      </td>
                      <td>{formatOfficialDate(source.updatedAt)}</td>
                      <td className="official-channel-inventory__actions">
                        <div className="official-channel-inventory__inline-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setStockFilters(current => ({
                                ...current,
                                sourceId: source.id,
                              }));
                              setTab("stocks");
                            }}
                          >
                            查看库存
                          </button>
                          {canWrite ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  openSourceEditor({ mode: "edit", source })
                                }
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                className={source.active ? "is-danger" : ""}
                                onClick={() => void toggleSource(source)}
                              >
                                {source.active ? "停用" : "启用"}
                              </button>
                            </>
                          ) : null}
                          <OfficialLegacySourceClassification
                            isRealSuperAdmin={isInventoryServerSuperAdmin}
                            source={source}
                            activeTeams={activeOfficialTeams}
                            teamsAvailable={teamsOverview.available}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={sourcePage}
              pageCount={sources.pageCount}
              total={sources.total}
              onChange={setSourcePage}
              label="来源"
            />
          </section>
        ) : (
          <section
            className="official-channel-inventory__panel"
            aria-label="渠道库存列表"
          >
            <div className="official-channel-inventory__toolbar official-channel-inventory__stock-toolbar">
              <label>
                <span>来源</span>
                <select
                  value={stockFilters.sourceId ?? ""}
                  onChange={event =>
                    setStockFilters(current => ({
                      ...current,
                      sourceId: Number(event.target.value) || null,
                    }))
                  }
                >
                  <option value="">全部来源</option>
                  {sourceOptions.map(source => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                      {source.active ? "" : "（已停用）"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>型号 / 品牌 / 来源</span>
                <Input
                  value={stockFilters.query}
                  className="h-8 text-xs"
                  placeholder="搜索型号、品牌或来源"
                  onChange={event =>
                    setStockFilters(current => ({
                      ...current,
                      query: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>状态</span>
                <select
                  value={stockFilters.status}
                  onChange={event =>
                    setStockFilters(current => ({
                      ...current,
                      status: event.target.value as StockFilters["status"],
                    }))
                  }
                >
                  <option value="all">全部状态</option>
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                  <option value="offshelf">已下架</option>
                </select>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() =>
                  setStockFilters({
                    sourceId: null,
                    query: "",
                    status: "all",
                  })
                }
              >
                重置
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={!canExport}
                onClick={() => void exportStocks()}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                导出
              </Button>
              <span className="official-channel-inventory__count">
                本页 {stocks.items.length} 条
              </span>
            </div>
            <div className="official-channel-inventory__table-wrap">
              <table className="official-channel-inventory__table official-channel-inventory__stock-table">
                <thead>
                  <tr>
                    <th>型号 / 品牌</th>
                    <th>来源</th>
                    <th>负责人</th>
                    <th>数量</th>
                    <th>报价 CNY</th>
                    <th>交期 / Date Code</th>
                    <th>内部备注</th>
                    <th>状态</th>
                    <th className="official-channel-inventory__actions">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stocksQuery.isPending ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="official-channel-inventory__empty"
                      >
                        正在加载渠道库存…
                      </td>
                    </tr>
                  ) : null}
                  {stockListError ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="official-channel-inventory__empty is-error"
                      >
                        渠道库存加载失败：{stockListError}
                        <button
                          type="button"
                          onClick={() => void stocksQuery.refetch()}
                        >
                          重试
                        </button>
                      </td>
                    </tr>
                  ) : null}
                  {!stocksQuery.isPending &&
                  !stockListError &&
                  !stocks.items.length ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="official-channel-inventory__empty"
                      >
                        暂无符合筛选条件的渠道库存。
                      </td>
                    </tr>
                  ) : null}
                  {stocks.items.map(stock => (
                    <tr key={stock.id}>
                      <td>
                        <strong>{stock.partNumber}</strong>
                        <small>{stock.brand}</small>
                      </td>
                      <td>
                        <div>{stock.sourceName}</div>
                        <small>
                          {officialSourceTypeLabel(stock.sourceType)}
                        </small>
                      </td>
                      <td>{stock.responsibleName ?? "未指派"}</td>
                      <td>
                        {stock.qty === null
                          ? "待确认"
                          : stock.qty.toLocaleString("zh-CN")}
                      </td>
                      <td>{formatPrice(stock)}</td>
                      <td>
                        <div>{stock.leadTime ?? "待确认"}</div>
                        <small>{stock.dateCode ?? "—"}</small>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="official-channel-inventory__note-summary"
                          disabled={!stock.permissions.canAddNote || busy}
                          title={stock.latestNote?.body ?? "暂无内部备注"}
                          onClick={() => {
                            setNotesStock(stock);
                            setNoteText("");
                          }}
                        >
                          {stock.latestNote?.body ?? "—"}
                        </button>
                      </td>
                      <td>
                        <span
                          className={`official-channel-inventory__status is-${stock.status}`}
                        >
                          {statusLabel(stock.status)}
                        </span>
                      </td>
                      <td className="official-channel-inventory__actions">
                        <div className="official-channel-inventory__inline-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setStockDetailId(stock.id)}
                          >
                            详情
                          </button>
                          {stock.permissions.canEdit ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                openStockEditor({ mode: "edit", stock })
                              }
                            >
                              编辑
                            </button>
                          ) : null}
                          {stock.permissions.canPublish ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void changeStockStatus(stock)}
                            >
                              发布
                            </button>
                          ) : null}
                          {stock.permissions.canOffshelf ? (
                            <button
                              type="button"
                              className="is-danger"
                              disabled={busy}
                              onClick={() => void changeStockStatus(stock)}
                            >
                              下架
                            </button>
                          ) : null}
                          {stock.permissions.canAddNote ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setNotesStock(stock);
                                setNoteText("");
                              }}
                            >
                              备注
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={stockPage}
              pageCount={stocks.pageCount}
              total={stocks.total}
              onChange={setStockPage}
              label="渠道库存"
            />
          </section>
        )}

        <Dialog
          open={stockDetailId !== null}
          onOpenChange={open => {
            if (!open) setStockDetailId(null);
          }}
        >
          <DialogContent className="official-channel-inventory__dialog max-w-[680px]">
            <DialogHeader>
              <DialogTitle>渠道库存详情</DialogTitle>
            </DialogHeader>
            {stockDetailQuery.isPending ? (
              <p className="text-sm text-muted-foreground">
                正在读取渠道库存详情…
              </p>
            ) : stockDetailQuery.isError ? (
              <p className="text-sm text-destructive">
                渠道库存详情读取失败：{errorMessage(stockDetailQuery.error)}
              </p>
            ) : stockDetail ? (
              <div className="official-channel-inventory__detail-grid">
                <div>
                  <span>型号</span>
                  <strong>{stockDetail.partNumber}</strong>
                </div>
                <div>
                  <span>品牌</span>
                  <strong>{stockDetail.brand}</strong>
                </div>
                <div>
                  <span>来源</span>
                  <strong>{stockDetail.sourceName}</strong>
                </div>
                <div>
                  <span>来源类型</span>
                  <strong>
                    {officialSourceTypeLabel(stockDetail.sourceType)}
                  </strong>
                </div>
                <div>
                  <span>当前负责人</span>
                  <strong>{stockDetail.responsibleName ?? "未指派"}</strong>
                </div>
                <div>
                  <span>
                    {stockDetail.legacyMaterialId ? "导入人" : "原录入人"}
                  </span>
                  <strong>{stockDetail.createdByName ?? "—"}</strong>
                </div>
                <div>
                  <span>数量</span>
                  <strong>
                    {stockDetail.qty === null
                      ? "待确认"
                      : stockDetail.qty.toLocaleString("zh-CN")}
                  </strong>
                </div>
                <div>
                  <span>报价</span>
                  <strong>{formatPrice(stockDetail)}</strong>
                </div>
                <div>
                  <span>交期</span>
                  <strong>{stockDetail.leadTime ?? "待确认"}</strong>
                </div>
                <div>
                  <span>Date Code</span>
                  <strong>{stockDetail.dateCode ?? "—"}</strong>
                </div>
                <div>
                  <span>状态</span>
                  <strong>{statusLabel(stockDetail.status)}</strong>
                </div>
                <div>
                  <span>录入时间</span>
                  <strong>{formatOfficialDate(stockDetail.createdAt)}</strong>
                </div>
                <div className="is-wide">
                  <span>录入内部说明</span>
                  <strong>{stockDetail.note ?? "—"}</strong>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                未返回可核验的渠道库存详情。
              </p>
            )}
            {stockDetail ? <OfficialInventoryReception key={stockDetail.id} stock={stockDetail}
              isRealSuperAdmin={isInventoryServerSuperAdmin} teamsOverview={teamsOverview} /> : null}
            <DialogFooter>
              <OfficialInventoryOwnerTransfer
                isRealSuperAdmin={isInventoryServerSuperAdmin}
                stock={stockDetail}
                teamsOverview={teamsOverview}
              />
              {stockDetail?.permissions.canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setStockDetailId(null);
                    openStockEditor({ mode: "edit", stock: stockDetail });
                  }}
                >
                  编辑
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStockDetailId(null)}
              >
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={sourceEditor !== null}
          onOpenChange={open => {
            if (!open && !busy) setSourceEditor(null);
          }}
        >
          <DialogContent
            className="official-channel-inventory__dialog max-w-[680px]"
            onPointerDownOutside={event => {
              if (busy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {sourceEditor?.mode === "edit" ? "编辑来源" : "新增来源"}
              </DialogTitle>
            </DialogHeader>
            <div className="official-channel-inventory__form-grid">
              <label className="is-wide">
                <span>来源名称 *</span>
                <Input
                  value={sourceForm.name}
                  maxLength={128}
                  disabled={busy}
                  onChange={event =>
                    setSourceForm(current => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              {sourceEditor?.mode === "create" && isRealSuperAdmin ? (
                <label className="is-wide">
                  <span>所属官方团队 *</span>
                  <select
                    value={sourceTeamId ?? ""}
                    disabled={busy}
                    onChange={event =>
                      setSourceTeamId(Number(event.target.value) || null)
                    }
                  >
                    <option value="">请选择官方团队</option>
                    {activeOfficialTeams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span>来源类型 *</span>
                <select
                  value={sourceForm.type}
                  disabled={busy}
                  onChange={event =>
                    setSourceForm(current => ({
                      ...current,
                      type: event.target.value as OfficialSourceType,
                    }))
                  }
                >
                  {SOURCE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>联系人</span>
                <Input
                  value={sourceForm.contactName}
                  maxLength={64}
                  disabled={busy}
                  onChange={event =>
                    setSourceForm(current => ({
                      ...current,
                      contactName: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>联系电话</span>
                <Input
                  value={sourceForm.phone}
                  maxLength={32}
                  disabled={busy}
                  onChange={event =>
                    setSourceForm(current => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>微信</span>
                <Input
                  value={sourceForm.wechat}
                  maxLength={64}
                  disabled={busy}
                  onChange={event =>
                    setSourceForm(current => ({
                      ...current,
                      wechat: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>QQ</span>
                <Input
                  value={sourceForm.qq}
                  maxLength={32}
                  disabled={busy}
                  onChange={event =>
                    setSourceForm(current => ({
                      ...current,
                      qq: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="is-wide">
                <span>来源内部说明</span>
                <Textarea
                  value={sourceForm.notes}
                  maxLength={2000}
                  rows={3}
                  disabled={busy}
                  onChange={event =>
                    setSourceForm(current => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setSourceEditor(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={busy || !canWrite}
                onClick={() => void saveSource()}
              >
                {busy ? "保存中…" : "保存来源"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={sourceDetailId !== null}
          onOpenChange={open => {
            if (!open) setSourceDetailId(null);
          }}
        >
          <DialogContent className="official-channel-inventory__dialog max-w-[620px]">
            <DialogHeader>
              <DialogTitle>来源详情</DialogTitle>
            </DialogHeader>
            {sourceDetailQuery.isPending ? (
              <p className="text-sm text-muted-foreground">正在读取来源详情…</p>
            ) : sourceDetailQuery.isError ? (
              <p className="text-sm text-destructive">
                来源详情读取失败：{errorMessage(sourceDetailQuery.error)}
              </p>
            ) : sourceDetail ? (
              <div className="official-channel-inventory__detail-grid">
                <div>
                  <span>来源</span>
                  <strong>{sourceDetail.name}</strong>
                </div>
                <div>
                  <span>类型</span>
                  <strong>{officialSourceTypeLabel(sourceDetail.type)}</strong>
                </div>
                <div>
                  <span>联系人</span>
                  <strong>{sourceDetail.contactName ?? "—"}</strong>
                </div>
                <div>
                  <span>联系方式</span>
                  <strong>
                    {[
                      sourceDetail.phone,
                      sourceDetail.wechat
                        ? `微信 ${sourceDetail.wechat}`
                        : null,
                      sourceDetail.qq ? `QQ ${sourceDetail.qq}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </strong>
                </div>
                <div className="is-wide">
                  <span>内部说明</span>
                  <strong>{sourceDetail.notes ?? "—"}</strong>
                </div>
                <div>
                  <span>发布资格</span>
                  <strong>
                    {sourceDetail.publicationApproved ? "已确认" : "未确认"}
                  </strong>
                </div>
                <div>
                  <span>状态</span>
                  <strong>{sourceDetail.active ? "启用" : "已停用"}</strong>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">未找到来源详情。</p>
            )}
            <DialogFooter>
              {sourceDetail && canWrite ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setSourceDetailId(null);
                    openSourceEditor({ mode: "edit", source: sourceDetail });
                  }}
                >
                  编辑
                </Button>
              ) : null}
              {sourceDetail &&
              isRealSuperAdmin &&
              !sourceDetail.publicationApproved ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void confirmSourcePublication(sourceDetail)}
                >
                  确认可发布
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSourceDetailId(null)}
              >
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={stockEditor !== null}
          onOpenChange={open => {
            if (!open && !busy) setStockEditor(null);
          }}
        >
          <DialogContent
            className="official-channel-inventory__dialog max-w-[680px]"
            onPointerDownOutside={event => {
              if (busy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {stockEditor?.mode === "edit" ? "编辑渠道库存" : "新增渠道库存"}
              </DialogTitle>
              <DialogDescription>
                库存保存为草稿；发布须由服务端再次校验来源资格与操作范围。
              </DialogDescription>
            </DialogHeader>
            <div className="official-channel-inventory__form-grid">
              <label className="is-wide">
                <span>关联来源 *</span>
                <select
                  value={stockForm.sourceId ?? ""}
                  disabled={busy || stockEditor?.mode === "edit"}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      sourceId: Number(event.target.value) || null,
                    }))
                  }
                >
                  <option value="">请选择启用来源</option>
                  {sourceOptions
                    .filter(
                      source =>
                        source.active || source.id === stockForm.sourceId
                    )
                    .map(source => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                        {source.active ? "" : "（已停用）"}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>型号 *</span>
                <Input
                  value={stockForm.partNumber}
                  maxLength={128}
                  disabled={busy}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      partNumber: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>品牌 *</span>
                <Input
                  value={stockForm.brand}
                  maxLength={128}
                  disabled={busy}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      brand: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>可供数量</span>
                <Input
                  value={stockForm.qty}
                  inputMode="numeric"
                  placeholder="留空为待确认"
                  disabled={busy}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      qty: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Date Code</span>
                <Input
                  value={stockForm.dateCode}
                  maxLength={64}
                  disabled={busy}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      dateCode: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>报价 CNY</span>
                <Input
                  value={stockForm.price}
                  inputMode="decimal"
                  placeholder="留空为面议"
                  disabled={busy}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      price: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>税务口径</span>
                <select
                  value={stockForm.taxIncluded}
                  disabled={busy}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      taxIncluded: event.target
                        .value as StockForm["taxIncluded"],
                    }))
                  }
                >
                  <option value="unknown">待确认</option>
                  <option value="included">含税</option>
                  <option value="excluded">未税</option>
                </select>
              </label>
              <label className="is-wide">
                <span>交期</span>
                <Input
                  value={stockForm.leadTime}
                  maxLength={255}
                  placeholder="留空为待确认"
                  disabled={busy}
                  onChange={event =>
                    setStockForm(current => ({
                      ...current,
                      leadTime: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <p className="official-channel-inventory__form-note">
              内部备注只能在库存保存后通过“备注”追加，不能在此修改或覆盖。
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setStockEditor(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={busy || !canWrite}
                onClick={() => void saveStock()}
              >
                {busy ? "保存中…" : "保存库存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={notesStock !== null}
          onOpenChange={open => {
            if (!open && !addNote.isPending) setNotesStock(null);
          }}
        >
          <DialogContent
            className="official-channel-inventory__dialog max-w-[640px]"
            onPointerDownOutside={event => {
              if (addNote.isPending) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>内部备注 · {notesStock?.partNumber}</DialogTitle>
              <DialogDescription>
                仅可追加，不能编辑或删除已有备注。
              </DialogDescription>
            </DialogHeader>
            <div className="official-channel-inventory__notes-list">
              {notesQuery.isPending ? (
                <p>正在加载备注…</p>
              ) : notesQuery.isError ? (
                <p className="text-destructive">
                  备注读取失败：{errorMessage(notesQuery.error)}
                </p>
              ) : !notesResult.available ? (
                <p className="text-destructive">
                  备注未返回完整的官方数据，追加操作保持关闭。
                </p>
              ) : !notes.length ? (
                <p>暂无内部备注。</p>
              ) : (
                notes.map(note => (
                  <article key={note.id}>
                    <p>{note.body}</p>
                    <small>
                      {note.authorName ?? "后台员工"} ·{" "}
                      {formatOfficialDate(note.createdAt)}
                    </small>
                  </article>
                ))
              )}
            </div>
            <Textarea
              value={noteText}
              maxLength={2000}
              rows={3}
              disabled={
                !notesResult.available ||
                !notesStock?.permissions.canAddNote ||
                addNote.isPending
              }
              placeholder={
                notesResult.available && notesStock?.permissions.canAddNote
                  ? "追加内部备注"
                  : "当前账号不能追加备注"
              }
              onChange={event => setNoteText(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={addNote.isPending}
                onClick={() => setNotesStock(null)}
              >
                关闭
              </Button>
              <Button
                type="button"
                disabled={
                  !notesResult.available ||
                  !notesStock?.permissions.canAddNote ||
                  addNote.isPending
                }
                onClick={() => void submitNote()}
              >
                {addNote.isPending ? "追加中…" : "追加备注"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={batchOpen}
          onOpenChange={open => {
            if (!open && !batchBusy) setBatchOpen(false);
          }}
        >
          <DialogContent
            className="official-channel-inventory__dialog official-channel-inventory__batch-dialog max-w-[860px]"
            onPointerDownOutside={event => {
              if (batchBusy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>批量导入渠道库存</DialogTitle>
              <DialogDescription>
                一个批次只能选择一个启用来源；每一行以独立请求号逐条保存为草稿，不会导入负责人、团队或自动发布。
              </DialogDescription>
            </DialogHeader>
            <div className="official-channel-inventory__batch-controls">
              <label>
                <span>单一来源 *</span>
                <select
                  value={batchSourceId ?? ""}
                  disabled={batchBusy || batchEntries.length > 0}
                  onChange={event =>
                    setBatchSourceId(Number(event.target.value) || null)
                  }
                >
                  <option value="">请选择启用来源</option>
                  {sourceOptions
                    .filter(source => source.active)
                    .map(source => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                </select>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={event => void onSelectImportFile(event)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={batchBusy || batchEntries.length > 0}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
                选择 Excel / CSV
              </Button>
              <span>{batchFileName || "未选择文件"}</span>
            </div>
            {batchGrid.length ? (
              <>
                <div className="official-channel-inventory__mapping">
                  {IMPORT_FIELDS.map(field => (
                    <label key={field.key}>
                      <span>
                        {field.label}
                        {field.required ? " *" : ""}
                      </span>
                      <select
                        value={batchMapping[field.key]}
                        disabled={batchBusy || batchEntries.length > 0}
                        onChange={event =>
                          setBatchMapping(current => ({
                            ...current,
                            [field.key]: Number(event.target.value),
                          }))
                        }
                      >
                        <option value={-1}>不导入</option>
                        {(batchGrid[0] ?? []).map((header, index) => (
                          <option
                            key={`${String(header)}_${index}`}
                            value={index}
                          >
                            第 {index + 1} 列 · {String(header || "（空表头）")}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="official-channel-inventory__import-summary">
                  <span>
                    有效 {importRows.length - invalidImportRows.length} 行 / 共{" "}
                    {importRows.length} 行
                  </span>
                  {importMappingErrors.length ? (
                    <span className="is-error">{importMappingErrors[0]}</span>
                  ) : null}
                  {invalidImportRows.length ? (
                    <span className="is-error">
                      {invalidImportRows.length} 行待修正（首条：第{" "}
                      {invalidImportRows[0].row} 行{" "}
                      {invalidImportRows[0].errors[0]}）
                    </span>
                  ) : null}
                </div>
                <div className="official-channel-inventory__import-preview">
                  <table>
                    <thead>
                      <tr>
                        <th>行</th>
                        <th>型号</th>
                        <th>品牌</th>
                        <th>数量</th>
                        <th>报价</th>
                        <th>校验</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 12).map(row => (
                        <tr key={row.row}>
                          <td>{row.row}</td>
                          <td>{row.draft.partNumber || "—"}</td>
                          <td>{row.draft.brand || "—"}</td>
                          <td>{row.draft.qty || "待确认"}</td>
                          <td>{row.draft.price || "面议"}</td>
                          <td className={row.errors.length ? "is-error" : ""}>
                            {row.errors[0] ?? "通过"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 12 ? <p>仅显示前 12 行预览。</p> : null}
                </div>
              </>
            ) : null}
            {batchError ? (
              <p
                className="official-channel-inventory__batch-error"
                role="alert"
              >
                {batchError}
              </p>
            ) : null}
            {batchEntries.length ? (
              <p className="text-xs text-muted-foreground">
                已确认{" "}
                {
                  batchEntries.filter(entry => entry.status === "success")
                    .length
                }{" "}
                / {batchEntries.length}{" "}
                行。待确认行会保留原请求号，重试不会重复创建。
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={batchBusy}
                onClick={() => setBatchOpen(false)}
              >
                关闭
              </Button>
              <Button
                type="button"
                disabled={batchBusy || !canWrite || !batchGrid.length}
                onClick={() => void runBatchImport()}
              >
                {batchBusy
                  ? "逐条导入中…"
                  : batchEntries.some(entry => entry.status === "unknown")
                    ? "按原批次重试"
                    : "开始导入"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </DashboardLayout>
  );
}

function Pager({
  page,
  pageCount,
  total,
  onChange,
  label,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
  label: string;
}) {
  const totalPages = Math.max(1, pageCount);
  return (
    <nav
      className="official-channel-inventory__pager"
      aria-label={`${label}分页`}
    >
      <span>
        共 {total} 条，第 {page} / {totalPages} 页
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </Button>
    </nav>
  );
}
