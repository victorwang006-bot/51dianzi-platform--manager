import { useLocation, useSearch } from "wouter";
import { parseSupplyLocation, supplyLocation } from "../components/customers/customerSupply";
import { channelInventoryTabLocation, channelInventoryViewLocation, getChannelInventoryNavigationView, readChannelInventoryTabIntent, channelInventoryBatchListLocation, channelInventoryBatchMaterialLocation, readChannelInventoryBatchListState, readChannelInventoryBatchMaterialIntent, positiveInventoryId } from "../../../../../lib/channelInventoryNavigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../front-router-types/server/routers";
import { formatBeijingDateTime, formatBeijingDateTimeWithSeconds } from "../../../shared/beijingTime";
import { createBusinessScopeTrpcClient, trpc } from "../../../../api/business-trpc";
import type { ChannelReferenceRow } from "@shared/channelReference";
import { startChannelReferenceLookup } from "./channelReferenceModel";
import { useBusinessScope } from "../../../../BusinessScope";
import { BatchUpload } from "../components/channelInventory/BatchUpload";
import { CollaborationNotesPanel } from "../components/channelInventory/CollaborationNotesPanel";
import { ChannelInventorySourcePanel } from "../components/channelInventory/ChannelInventorySourcePanel";
import { ChannelInventoryManagementPanel, useMaterialDeletion } from "../components/channelInventory/ChannelInventoryManagementPanel";
import { InventoryChannelSelector, type InventoryChannelAvailability } from "../components/channelInventory/InventoryChannelSelector";
import { useFactoryMaterialPublish, type FactoryMaterialPublishRow } from "../components/channelInventory/FactoryMaterialPublish";
import { materialUploadBatchAssociation, type MaterialUploadBatchProjection } from "../components/channelInventory/management";
import type { InventoryManagementClient, InventoryTab, ReadableInventoryChannel, UploadBatchInput } from "../components/channelInventory/management";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "../components/ui/dropdown-menu";
import type { Payload as BatchMaterialPayload } from "../components/channelInventory/import";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";
import { CHANNEL_INVENTORY_COLUMNS, DEFAULT_CHANNEL_INVENTORY_COLUMNS, channelInventoryColumnsStorageKey, normalizeChannelInventoryColumns, readChannelInventoryColumns, saveChannelInventoryColumns, channelInventoryColumnLayout, type ChannelInventoryColumnId } from "./channelInventoryColumns";
import { ChannelReferenceCell } from "./ChannelReferenceCell";
import "../components/channelInventory/layout.css";
import "../components/channelInventory/batch.css";
import "../components/channelInventory/notes.css";
import "./ChannelInventoryHost.css";

import { BUSINESS_INDUSTRY_OPTIONS, businessIndustryCodeSchema, getBusinessIndustryLabel } from "../../../shared/businessIndustry";

type ChannelInventoryInputs = inferRouterInputs<AppRouter>["channelInventory"];
type ChannelInventoryOutputs = inferRouterOutputs<AppRouter>["channelInventory"];
type Channel = ChannelInventoryOutputs["listChannels"]["items"][number];
type TeamMaterial = ChannelInventoryOutputs["listTeamMaterials"]["items"][number];
type PublicMaterial = ChannelInventoryOutputs["getTeamMaterialForEdit"];
type SourceOptions = ChannelInventoryOutputs["listTeamSourceOptions"];
type ChannelType = ChannelInventoryInputs["createChannel"]["type"];
type MaterialCreateInput = ChannelInventoryInputs["createMaterial"];
type MaterialUpdateInput = ChannelInventoryInputs["updateTeamMaterial"];

type ChannelFilters = {
  name: string;
  type: "all" | ChannelType;
  active: "all" | "active" | "inactive";
};

type MaterialFilters = {
  channelId: string;
  partNumber: string;
  brand: string;
  type: "all" | ChannelType;
  uploadBatchId?: string;
  industryCode?: "all" | NonNullable<ChannelInventoryInputs["listTeamMaterials"]["industryCode"]>;
};

type ChannelForm = {
  name: string;
  industryCode: string;
  type: ChannelType;
  contactName: string;
  phone: string;
  wechat: string;
  qq: string;
  notes: string;
};

type MaterialForm = {
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

type ChannelEditor =
  | { mode: "create" }
  | { mode: "edit"; channel: Channel };

type MaterialEditor =
  | { mode: "create" }
  | { mode: "edit"; material: PublicMaterial; isMine: boolean };

type FrozenCreate<T> = {
  fingerprint: string;
  requestId: string;
  payload: T;
  batchRequestId?: string;
};

const PAGE_SIZE = 20;
const CHANNEL_TYPES: readonly { value: ChannelType; label: string }[] = [
  { value: "factory", label: "工厂" },
  { value: "agent", label: "代理商" },
  { value: "trade", label: "贸易商" },
  { value: "other", label: "其他" },
];

const EMPTY_CHANNEL_FORM: ChannelForm = {
  name: "",
  industryCode: "",
  type: "factory",
  contactName: "",
  phone: "",
  wechat: "",
  qq: "",
  notes: "",
};

function channelTypeLabel(type: ChannelType) {
  return CHANNEL_TYPES.find(item => item.value === type)?.label ?? type;
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, key => {
    const value = Math.floor(Math.random() * 16);
    return (key === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function toNullable(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function displayDate(value: Date | string | null | undefined) {
  return formatBeijingDateTime(value) || "—";
}

/** Inventory only: SQL DATETIME literals are Beijing wall time (channelInventoryExport.instant).
 * Internal delegation preserves strings; manager/platformBusinessApi unwraps JSON without reviving Dates.
 * Zoned ISO/Date already represent instants. Never apply this contract to other pages or exports. */
export function channelInventoryUpdatedAt(value: Date | string | null | undefined, now: Date = new Date()) {
  if (typeof value === "string") {
    // Raw SQL datetime (seconds required, MySQL fractional precision up to 6).
    const literal = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(value);
    if (literal && literal[0] === value) {
      value = `${literal[1]}T${literal[2]}${literal[3] ? `.${literal[3].slice(0, 3)}` : ""}+08:00`;
    }
    // Match the entire explicit-zone ISO value before Date can normalize invalid fields.
    const calendar = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!calendar || calendar[0] !== value) return null;
    const year = Number(calendar[1]), month = Number(calendar[2]), day = Number(calendar[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
    if (Number(calendar[4]) > 23 || Number(calendar[5]) > 59 || Number(calendar[6] ?? 0) > 59
      || Number(calendar[9] ?? 0) > 23 || Number(calendar[10] ?? 0) > 59) return null;
  } else if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return null;
  }
  const full = formatBeijingDateTimeWithSeconds(value);
  if (!full) return null;
  const minute = full.slice(0, -3);
  return {
    compact: minute.slice(0, 4) === formatBeijingDateTime(now).slice(0, 4) ? minute.slice(5) : minute,
    full: `${full}（北京时间）`,
  };
}

/** Flat-view only: copy the untouched identifier without a large duplicate tooltip. */
export function ChannelInventoryCopyPartNumber({ partNumber, resetKey }: { partNumber: string; resetKey: string }) {
  const [feedback, setFeedback] = useState("");
  const current = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    current.current += 1; setFeedback("");
    return () => { current.current += 1; clearTimeout(timer.current); };
  }, [partNumber, resetKey]);
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const generation = current.current;
    const button = event.currentTarget;
    let copied = false;
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(partNumber); copied = true;
      }
    } catch { /* A denied secure clipboard may still permit a user-initiated local copy. */ }
    if (generation !== current.current) return;
    if (!copied) {
      const field = document.createElement("textarea");
      field.value = partNumber; field.readOnly = true;
      field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      try {
        document.body.append(field); field.select();
        copied = typeof document.execCommand === "function" && document.execCommand("copy");
      } catch { copied = false; }
      finally { field.remove(); button.focus({ preventScroll: true }); }
    }
    clearTimeout(timer.current); setFeedback(copied ? "已复制" : "复制失败，请重试");
    timer.current = setTimeout(() => setFeedback(""), 1800);
  };
  return <span className="ci-part-copy">
    <span className="ci-cell-title admin-cell-primary ci-part-number-text" aria-label={partNumber}>{partNumber || "—"}</span>
    <button type="button" className="ci-part-copy-button" aria-label={`复制完整型号：${partNumber}`} disabled={!partNumber}
      onClick={event => void copy(event)} onKeyDown={event => event.stopPropagation()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>
    </button>
    <span className={feedback ? "ci-copy-feedback" : "ci-sr-only"} role="status" aria-live="polite">{feedback}</span>
  </span>;
}

/** Presentation only: retain the complete value and escape the table's clipping/sticky context. */
export function ChannelInventoryPartNumber({ partNumber, resetKey, displayValue, kind }: {
  partNumber: string; resetKey: string; displayValue?: string; kind?: "time" | "dc";
}) {
  const trigger = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  const cancelLeave = useCallback(() => {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelLeave(); pinned.current = false; setPosition(null);
  }, [cancelLeave]);
  const open = useCallback(() => {
    cancelLeave();
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const style = getComputedStyle(trigger.current);
    setPosition({
      left: Math.max(8, rect.left), top: Math.max(8, rect.bottom + 6),
      maxWidth: Math.max(1, Math.min(520, window.innerWidth - 16)),
      maxHeight: Math.max(1, window.innerHeight - 16),
      fontFamily: style.fontFamily, fontSize: style.fontSize,
      lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
    });
  }, [cancelLeave]);
  const leave = () => {
    if (!pinned.current && document.activeElement !== trigger.current && document.activeElement !== popover.current) {
      cancelLeave(); leaveTimer.current = setTimeout(close, 120);
    }
  };
  const toggle = () => {
    if (pinned.current) close();
    else { pinned.current = true; open(); }
  };

  useEffect(() => { close(); }, [partNumber, resetKey, close]);
  useEffect(() => () => cancelLeave(), [cancelLeave]);
  useEffect(() => {
    if (!position || !trigger.current || !popover.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const panel = popover.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - panel.width - 8));
    const below = anchor.bottom + 6;
    const top = Math.max(8, Math.min(
      below + panel.height <= window.innerHeight - 8 ? below : anchor.top - panel.height - 6,
      window.innerHeight - panel.height - 8,
    ));
    if (position.left !== left || position.top !== top) setPosition({ ...position, left, top });
  }, [position]);
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popover.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popover.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [position, close]);

  return <>
    <span ref={trigger} className={kind === "time" ? "ci-updated-at-trigger" : kind === "dc" ? "ci-dc-trigger" : "ci-cell-title admin-cell-primary ci-part-number-trigger"} role="button" tabIndex={0}
      aria-label={partNumber || "—"} aria-expanded={Boolean(position)}
      onMouseEnter={open} onMouseLeave={leave} onFocus={open}
      onBlur={event => { if (!popover.current?.contains(event.relatedTarget as Node | null)) close(); }}
      onClick={toggle} onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
      }}>{displayValue ?? (partNumber || "—")}</span>
    {position ? createPortal(<div ref={popover} className={kind === "time" ? "ci-updated-at-popover" : "ci-part-number-popover"} role="tooltip" tabIndex={0}
      aria-label={kind === "time" ? "完整更新时间（北京时间）" : kind === "dc" ? "完整 DC" : "完整型号"} style={position} onMouseEnter={cancelLeave} onMouseLeave={leave}
      onBlur={event => { if (event.relatedTarget !== trigger.current && !popover.current?.contains(event.relatedTarget as Node | null)) close(); }}
    >{partNumber || "—"}</div>, document.body) : null}
  </>;
}

/** Explicit cells prevent formula execution and numeric identifier/price coercion. */
export function createChannelInventoryExportWorkbook(xlsx: typeof import("xlsx"), result: ChannelInventoryOutputs["exportChannelMaterials"]) {
  const text = (value: string): import("xlsx").CellObject => ({
    t: "s", z: "@", v: /^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(value) ? `'${value}` : value,
  });
  const sheet = xlsx.utils.aoa_to_sheet([
    ["型号", "品牌", "可供数量", "Date Code", "报价（人民币元）", "币种", "税制", "交期", "更新时间（北京时间）"].map(text),
    ...result.items.map(item => [
      text(item.partNumber), text(item.brand), item.qty === null ? text("待确认") : { t: "n" as const, v: item.qty },
      text(item.dateCode ?? ""), text(item.price === null ? "面议" : item.price), text(item.currency),
      text(item.taxIncluded === null ? "待确认" : item.taxIncluded ? "含税" : "未税"),
      text(item.leadTime ?? ""), text(formatBeijingDateTimeWithSeconds(item.updatedAt)),
    ]),
  ]);
  sheet["!cols"] = [30, 18, 14, 24, 32, 10, 12, 20, 24].map(wch => ({ wch }));
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, "渠道库存");
  const metadata = xlsx.utils.aoa_to_sheet([
    ["渠道", result.channel.name], ["类型", channelTypeLabel(result.channel.type)],
    ["渠道状态", activeLabel(result.channel.active)], ["导出时间（北京时间）", formatBeijingDateTimeWithSeconds(result.exportedAt)],
    ["导出条数", String(result.total)], ["范围", "该渠道本人有权读取的全部库存；不含联系人和私有备注"],
    ["业务口径", "数量空值为待确认，0 为实际零；报价空值为面议，0 为零价；报价文本保留原精度；税制未知为待确认"],
    ["文本安全", "型号及 Date Code 为文本；以公式字符开头的文本增加单引号保护"],
  ].map(row => row.map(text)));
  metadata["!cols"] = [{ wch: 26 }, { wch: 110 }];
  xlsx.utils.book_append_sheet(workbook, metadata, "导出说明");
  const name = result.channel.name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").slice(0, 60).replace(/^[. ]+|[. ]+$/g, "") || "渠道";
  const stamp = formatBeijingDateTimeWithSeconds(result.exportedAt).replace(/[- :]/g, "");
  return { workbook, fileName: `${name}_渠道库存_${stamp}_北京时间.xlsx` };
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return "";
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function definitiveWriteFailure(error: unknown) {
  return new Set([
    "BAD_REQUEST",
    "CONFLICT",
    "FORBIDDEN",
    "NOT_FOUND",
    "PRECONDITION_FAILED",
    "UNAUTHORIZED",
  ]).has(errorCode(error));
}

function activeLabel(active: boolean) {
  return active ? "启用" : "已停用";
}

function linkedCustomerId(channel: Channel) {
  const id = channel.customerId;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function channelEditDisabledReason(channel: Channel) {
  if (channel.readOnly || !channel.canEdit) return "该渠道为只读";
  if (channel.companyReadOnly === true && !linkedCustomerId(channel)) return "客户档案不可访问，不能编辑关联渠道";
  return undefined;
}

function channelFormFrom(channel: Channel): ChannelForm {
  return {
    name: channel.name,
    industryCode: channel.industryCode ?? "",
    type: channel.type,
    contactName: channel.contactName ?? "",
    phone: channel.phone ?? "",
    wechat: channel.wechat ?? "",
    qq: channel.qq ?? "",
    notes: channel.notes ?? "",
  };
}

function materialFormFrom(material: PublicMaterial): MaterialForm {
  return {
    channelId: material.channelId === null ? "" : String(material.channelId),
    partNumber: material.partNumber,
    brand: material.brand,
    qty: material.qty === null ? "" : String(material.qty),
    dateCode: material.dateCode ?? "",
    price: material.price ?? "",
    taxIncluded:
      material.taxIncluded === null
        ? "unknown"
        : material.taxIncluded
          ? "included"
          : "excluded",
    leadTime: material.leadTime ?? "",
    note: "",
  };
}

function materialInputFromForm(
  form: MaterialForm,
): Omit<MaterialCreateInput, "requestId" | "expectedEnterpriseId" | "expectedActorUserId"> {
  const channelId = Number(form.channelId);
  const quantity = form.qty.trim();
  return {
    channelId,
    partNumber: form.partNumber.normalize("NFKC").trim(),
    brand: form.brand.trim(),
    qty: quantity ? Number(quantity) : null,
    dateCode: toNullable(form.dateCode),
    price: toNullable(form.price),
    currency: "CNY",
    taxIncluded:
      form.taxIncluded === "unknown"
        ? null
        : form.taxIncluded === "included",
    leadTime: toNullable(form.leadTime),
    note: toNullable(form.note),
  };
}

function validateMaterialForm(form: MaterialForm, creating = true) {
  const errors: string[] = [];
  const channelId = Number(form.channelId);
  const quantity = form.qty.trim();
  const price = form.price.trim();
  if (creating && (!Number.isSafeInteger(channelId) || channelId <= 0)) errors.push("请选择启用的关联渠道");
  if (!form.partNumber.normalize("NFKC").trim()) errors.push("请输入型号");
  if (!form.brand.trim()) errors.push("请输入品牌");
  if (quantity && (!/^\d+$/.test(quantity) || Number(quantity) > 2_147_483_647)) {
    errors.push("数量须为 0 到 2147483647 的整数；留空表示待确认");
  }
  if (price && !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(price)) {
    errors.push("价格格式无效；留空表示面议");
  }
  if (form.dateCode.trim().length > 32) errors.push("Date Code 不能超过 32 个字符");
  if (form.leadTime.trim().length > 64) errors.push("交期不能超过 64 个字符");
  if (form.note.length > 2_000) errors.push("备注不能超过 2000 个字符");
  return errors;
}

export function channelInventoryPageNumbers(page: number, pageCount: number): (number | "ellipsis")[] {
  const count = Math.max(1, Math.floor(pageCount));
  const current = Math.max(1, Math.min(count, Math.floor(page)));
  const pages = Array.from(new Set([1, count, ...Array.from({ length: 5 }, (_, index) => current + index - 2)]))
    .filter(value => value >= 1 && value <= count).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  for (const value of pages) {
    const last = result.at(-1);
    if (typeof last === "number" && value - last > 1) result.push("ellipsis");
    result.push(value);
  }
  return result;
}

export function Pagination({
  page,
  pageCount,
  total,
  onPage,
  label,
  pageNumbers = false,
  loading = false,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
  pageNumbers?: boolean;
  loading?: boolean;
}) {
  if (pageNumbers) return <nav className="ci-pagination ci-pagination-numbered" aria-label={`${label}分页`} aria-busy={loading}>
    <span className="ci-pagination-summary">共 {total} 条，第 {page} / {pageCount} 页</span>
    <div className="ci-pagination-controls">
      <button type="button" className="ci-button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      {channelInventoryPageNumbers(page, pageCount).map((value, index) => value === "ellipsis"
        ? <span className="ci-pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
        : <button type="button" className="ci-button ci-page-number" key={value} aria-label={`第 ${value} 页`} aria-current={value === page ? "page" : undefined}
          disabled={loading || value === page} onClick={() => onPage(value)}>{value}</button>)}
      <button type="button" className="ci-button" disabled={loading || page >= pageCount} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  </nav>;
  return (
    <nav className="ci-pagination" aria-label={`${label}分页`}>
      <span>共 {total} 条，第 {page} / {pageCount} 页</span>
      <button type="button" className="ci-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <button type="button" className="ci-button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        下一页
      </button>
    </nav>
  );
}

/** Private notes never share their content, author or metadata with teammates. */
export function PrivateNotesPanel({ materialId, enterpriseId, actorUserId, isCurrent, onClose, onComplete }: {
  materialId: number; enterpriseId: number; actorUserId: number;
  isCurrent: () => boolean; onClose: () => void; onComplete: () => void;
}) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && isCurrent();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; revision: number; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [message, setMessage] = useState("");
  const frozen = useRef<{ mode: "add" | "edit"; content: string; requestId: string; noteId?: number; expectedRevision?: number } | null>(null);
  const context = { expectedEnterpriseId: enterpriseId, expectedActorUserId: actorUserId };
  const query = trpc.channelInventory.notesList.useQuery({ ...context, materialId, page, pageSize: 50 }, { enabled: current(), retry: false, staleTime: 0, refetchOnWindowFocus: false, trpc: { abortOnUnmount: true } });
  const add = trpc.channelInventory.notesAdd.useMutation();
  const edit = trpc.channelInventory.notesEdit.useMutation();
  const refreshPendingRef = useRef(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshProof, setRefreshProof] = useState<{ page: number; data?: ChannelInventoryOutputs["notesList"]; error?: unknown } | null>(null);
  const refresh = async () => {
    if (!current() || refreshPendingRef.current) return;
    // Block old click closures immediately, before React can hide cached controls.
    refreshPendingRef.current = true; setRefreshPending(true);
    try {
      const fresh = await query.refetch();
      if (current()) setRefreshProof({ page, data: !fresh.isError ? fresh.data : undefined, error: fresh.isError ? fresh.error : undefined });
    } catch (error) {
      if (current()) setRefreshProof({ page, error });
    } finally {
      refreshPendingRef.current = false;
      if (current()) setRefreshPending(false);
    }
  };
  useEffect(() => {
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [query.refetch, isCurrent, page]);
  const data = refreshProof?.page === page ? refreshProof.data : query.data;
  const result = current() && !query.isError && !query.isFetching && !refreshPending && data?.material.id === materialId ? data : undefined;
  const canWrite = result?.canEdit === true && result.readOnly === false;
  const canWriteRef = useRef(false);
  canWriteRef.current = canWrite;
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / 50));

  const submit = async () => {
    if (!current() || busy || refreshPendingRef.current || !canWriteRef.current) return;
    const content = (editing ? editing.content : draft).trim();
    if (!content || content.length > 2000) { setMessage("请输入 1 到 2000 字的备注内容。"); return; }
    let payload = frozen.current;
    if (!payload || !retryLocked) {
      payload = { mode: editing ? "edit" : "add", content, requestId: createRequestId(),
        ...(editing ? { noteId: editing.id, expectedRevision: editing.revision } : {}) };
      frozen.current = payload;
    }
    setBusy(true); setMessage("");
    try {
      if (payload.mode === "edit") {
        await edit.mutateAsync({ ...context, noteId: payload.noteId!, expectedRevision: payload.expectedRevision!, content: payload.content, requestId: payload.requestId });
      } else {
        await add.mutateAsync({ ...context, materialId, content: payload.content, requestId: payload.requestId });
      }
      if (!current()) return;
      frozen.current = null; setRetryLocked(false); setDraft(""); setEditing(null);
      await refresh(); if (current()) onComplete();
    } catch (error) {
      if (!current()) return;
      if (definitiveWriteFailure(error)) {
        frozen.current = null; setRetryLocked(false);
        setMessage(errorMessage(error, "备注保存失败，请刷新后重试。"));
        void refresh();
      } else {
        setRetryLocked(true);
        setMessage("保存结果未确认。内容已锁定，请按原请求重试，系统不会重复追加或覆盖备注。");
      }
    } finally { if (current()) setBusy(false); }
  };

  return <div className="ci-modal-backdrop" role="presentation">
    <section className="ci-host-dialog ci-notes-dialog ci-private-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-private-notes-title">
      <header><div><h2 id="ci-private-notes-title">本人库存备注（私有）</h2><p>仅当前负责人可见和维护；任何备注、作者和备注时间都不会随库存共享给团队。</p></div><button type="button" className="ci-icon-close" aria-label="关闭本人备注" disabled={busy || retryLocked} onClick={onClose}>×</button></header>
      <div className="ci-dialog-scroll">
      {query.isLoading || query.isFetching || refreshPending ? <p className="ci-empty">正在读取本人私有备注…</p> : null}
      {query.isError ? <p className="ci-error" role="alert">{errorMessage(query.error, "备注读取失败。")}</p> : null}
      {refreshProof?.error ? <p className="ci-error" role="alert">{errorMessage(refreshProof.error, "备注重核验失败，未使用缓存授权。")}</p> : null}
      {result ? <>
        <p><strong>{result.material.partNumber}</strong> · {result.material.brand}</p>
        {result.legacyNote ? <article className="ci-note-entry ci-note-legacy"><strong>原库存备注</strong><p>{result.legacyNote}</p><small>原作者和填写时间未记录；此历史仍仅本人可见，不会加入协作备注。</small></article> : null}
        <section className="ci-notes-history" aria-label="本人备注历史">
          {result.items.map(note => <article className="ci-note-entry" key={note.id}><div className="ci-note-entry-meta"><strong>{note.authorName}</strong><span>{displayDate(note.updatedAt)}</span></div><p>{note.content}</p>{canWrite && note.canEdit ? <button type="button" className="ci-inline-link" disabled={busy || retryLocked} onClick={() => { frozen.current = null; setEditing({ id: note.id, revision: note.revision, content: note.content }); setMessage(""); }}>修改我的备注</button> : null}</article>)}
          {!result.items.length && !result.legacyNote ? <p>暂无本人私有备注。</p> : null}
        </section>
        {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} total={result.total} onPage={next => { if (!busy && !retryLocked) { setEditing(null); setPage(next); } }} label="本人备注" /> : null}
        {canWrite ? <section className="ci-note-add" aria-label={editing ? "编辑本人备注" : "新增本人备注"}>
          <label className="ci-field"><span>{editing ? "编辑本人备注" : "新增本人备注"}</span><textarea rows={3} maxLength={2000} disabled={busy || retryLocked} value={editing ? editing.content : draft} placeholder="仅本人可见，不共享给团队" onChange={event => { const value = event.target.value; frozen.current = null; if (editing) setEditing({ ...editing, content: value }); else setDraft(value); }} /></label>
          <div className="ci-note-add-meta">{editing ? <button type="button" className="ci-button" disabled={busy || retryLocked} onClick={() => { frozen.current = null; setEditing(null); }}>取消编辑</button> : null}<button type="button" className="ci-button ci-primary" disabled={busy || !(editing ? editing.content : draft).trim()} onClick={() => void submit()}>{busy ? "保存中…" : retryLocked ? "按原请求重试" : editing ? "保存备注修改" : "保存本人备注"}</button></div>
        </section> : <p className="ci-readonly">当前库存为只读，不能新增或修改备注。</p>}
      </> : null}
      {message ? <p className="ci-error" role="alert">{message}</p> : null}
      </div>
      <footer><button type="button" className="ci-button" disabled={busy || retryLocked || refreshPending} onClick={() => void refresh()}>刷新</button><button type="button" className="ci-button" disabled={busy || retryLocked} onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}

/**
 * New equivalent reconstruction of the missing channel-inventory Host.
 * It deliberately obtains identity only from the authenticated BFF response and
 * sends it back solely as the router's mismatch assertion. The server remains
 * the authority for official inventory grants, module/data-owner scope, record owner,
 * team visibility, CAS and audit.
 */
export default function ChannelInventoryHost() {
  const utils = trpc.useUtils();
  const managementClient = useMemo(() => utils.client.channelInventory as unknown as InventoryManagementClient, [utils]);
  const search = useSearch();
  const [, navigate] = useLocation();
  const [dismissedSupplyLink, setDismissedSupplyLink] = useState<string | null>(null);
  const supplyLink = useMemo(() => readChannelInventoryTabIntent(search) || dismissedSupplyLink === search
    ? null : parseSupplyLocation(search), [search, dismissedSupplyLink]);
  const businessScope = useBusinessScope();
  const enterpriseQuery = trpc.enterprise.me.useQuery(undefined, { retry: false });
  const summary = enterpriseQuery.data;
  const enterpriseId = summary?.enterprise?.id;
  const actorUserId = summary?.currentUserId;
  const permissionKeys: readonly string[] = summary?.permissionKeys ?? [];
  const nativeRead = businessScope.officialInventoryPermissions.read === true;
  const nativeWrite = businessScope.officialInventoryPermissions.write === true;
  const nativeNote = businessScope.officialInventoryPermissions.note === true;
  // The BFF verifies native publish independently of inventory edit. Missing projections
  // fail closed; neither canEdit nor the separate native edit grant substitutes.
  const nativePublish = businessScope.officialInventoryPermissions.publish === true;
  // Official grants are the current server-verified projection, never ERP role guesses.
  const hasInventoryWrite = nativeWrite;
  const ready = Number.isSafeInteger(enterpriseId) && (enterpriseId ?? 0) > 0
    && Number.isSafeInteger(actorUserId) && (actorUserId ?? 0) > 0
    && nativeRead;
  const sourceContextVerified = businessScope.contextVerification.state === "verified"
    && businessScope.contextVerification.identity === businessScope.storageScope;
  const sourceIdentityCurrent = businessScope.contextVerification.identity === businessScope.storageScope;
  // Polling state is not authority. Only stable server-proven identity and
  // effective authorization versions may invalidate an open source dialog.
  const sourceAuthority = { domain: businessScope.storageScope, role: businessScope.frontUser.role,
    identity: businessScope.contextVerification.identity,
    authorizationVersion: businessScope.contextVerification.authorizationVersion,
    nativeGrantVersion: businessScope.officialInventoryPermissions.authorizationVersion,
    nativeRead, nativeWrite, nativeNote, nativePublish,
    readVersion: businessScope.contextVerification.readVersion,
    enterpriseId, actorUserId, member: summary?.member ? {
      id: summary.member.id, role: summary.member.role, status: summary.member.status,
      inventoryDataScope: summary.member.inventoryDataScope, permissionVersion: summary.member.permissionVersion,
    } : null, permissionVersion: summary?.permissionVersion,
    permissions: [...permissionKeys].sort(), owner: summary?.isOwner, readable: sourceIdentityCurrent && ready && !enterpriseQuery.isError };
  const sourceAuthorityKey = JSON.stringify(sourceAuthority);
  const sourceAuthorityRef = useRef(sourceAuthorityKey);
  sourceAuthorityRef.current = sourceAuthorityKey;
  // A same-authority polling state is not an identity change. Binding, grant,
  // team/data-scope and effective authorization changes are, before any paint.
  // Write-only changes keep private-note/read sessions; stock operations still
  // lose their live write gates and sources retain the full authority key.
  const identity = ready ? JSON.stringify({ ...sourceAuthority, nativeWrite: undefined }) : "";
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const exportSessionRef = useRef({ identity, nativeWrite, generation: 0 });
  if (exportSessionRef.current.identity !== identity || exportSessionRef.current.nativeWrite !== nativeWrite) {
    exportSessionRef.current = { identity, nativeWrite, generation: exportSessionRef.current.generation + 1 };
  }
  const exportRequestRef = useRef(0);
  const exportPendingRef = useRef(false);
  const [downloadingChannelId, setDownloadingChannelId] = useState<number | null>(null);
  const [downloadStatus, setDownloadStatus] = useState("");

  const [tab, setTab] = useState<InventoryTab>(() => readChannelInventoryTabIntent(search) ?? parseSupplyLocation(search)?.tab ?? "materials");
  const batchMaterialIntent = useMemo(() => readChannelInventoryBatchMaterialIntent(search), [search]);
  const [appliedBatchIntentKey, setAppliedBatchIntentKey] = useState("");
  const batchIntentKey = `${identity}:${search}`;
  const batchIntentReady = !batchMaterialIntent || batchMaterialIntent.id !== null && appliedBatchIntentKey === batchIntentKey;
  const [batchListState, setBatchListState] = useState(() => readChannelInventoryBatchListState(search));
  const focusBatchText = new URLSearchParams(search).get("ciBatchFocusId");
  const focusBatchId = tab === "batches" && focusBatchText !== null ? positiveInventoryId(focusBatchText) ?? 0 : undefined;
  const [channelFilters, setChannelFilters] = useState<ChannelFilters>({
    name: "",
    type: "all",
    active: "all",
  });
  const [channelPage, setChannelPage] = useState(1);
  const [materialFilters, setMaterialFilters] = useState<MaterialFilters>({
    channelId: "",
    partNumber: "",
    brand: "",
    type: "all",
  });
  const [draftMaterialFilters, setDraftMaterialFilters] = useState<MaterialFilters>({ channelId: "", partNumber: "", brand: "", type: "all" });
  // Trusted programmatic intents (batch/channel/deep links) apply immediately;
  // ordinary filter controls change only their draft until Confirm/Enter.
  const applyMaterialFilters = (next: MaterialFilters) => { setMaterialFilters(next); setDraftMaterialFilters(next); };
  const [materialPage, setMaterialPage] = useState(1);
  // A top entry, refresh or history travel must never reuse a remembered view.
  const inventoryView = getChannelInventoryNavigationView(search);
  const [readableChannel, setReadableChannel] = useState<{ scope: string; search: string; channel: ReadableInventoryChannel } | null>(null);
  const [channelAvailability, setChannelAvailability] = useState<InventoryChannelAvailability>({ scopeKey: "", ready: false, channels: [] });
  const receiveChannelAvailability = useCallback((state: InventoryChannelAvailability) => {
    if (identityRef.current === state.scopeKey) setChannelAvailability(state);
  }, []);
  const [materialSort, setMaterialSort] = useState<{ field: "qty" | "dateCode"; direction: "asc" | "desc" } | null>(null);
  const [stateIdentity, setStateIdentity] = useState(identity);
  const contextCurrent = stateIdentity === identity;
  // A cached enterprise.me from the previous binding must never namespace preferences.
  const columnsContextVerified = ready && sourceContextVerified && contextCurrent && !enterpriseQuery.isLoading && !enterpriseQuery.isError
    && businessScope.frontUser.id === actorUserId && businessScope.staffPrincipal?.frontendUserId === actorUserId
    && businessScope.staffPrincipal?.enterpriseId === enterpriseId;
  const columnsKey = columnsContextVerified ? channelInventoryColumnsStorageKey(actorUserId, enterpriseId) : null;
  const [columnPreference, setColumnPreference] = useState<{ key: string | null; columns: readonly ChannelInventoryColumnId[] }>({ key: null, columns: DEFAULT_CHANNEL_INVENTORY_COLUMNS });
  const visibleColumns = columnsKey && columnPreference.key === columnsKey ? columnPreference.columns : DEFAULT_CHANNEL_INVENTORY_COLUMNS;
  const columnVisible = (id: ChannelInventoryColumnId) => visibleColumns.includes(id);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    setColumnPreference({ key: columnsKey, columns: columnsKey ? readChannelInventoryColumns(columnsKey) : DEFAULT_CHANNEL_INVENTORY_COLUMNS });
  }, [columnsKey]);
  useEffect(() => { setColumnsOpen(false); setAdvancedOpen(false); }, [identity, columnsKey, tab]);
  const updateColumns = (columns: readonly ChannelInventoryColumnId[]) => {
    if (!columnsKey || !columnsContextVerified) return;
    const normalized = normalizeChannelInventoryColumns(columns);
    setColumnPreference({ key: columnsKey, columns: normalized });
    saveChannelInventoryColumns(columnsKey, normalized);
  };
  const editRequestRef = useRef(0);
  const editAbortRef = useRef<AbortController | null>(null);
  const invalidateEditSession = () => { editRequestRef.current += 1; editAbortRef.current?.abort(); };
  const [optionPage, setOptionPage] = useState(1);
  const [optionChannels, setOptionChannels] = useState<Channel[]>([]);
  const [channelEditor, setChannelEditor] = useState<ChannelEditor | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelForm>(EMPTY_CHANNEL_FORM);
  const linkedCompanyEditing = channelEditor?.mode === "edit" && channelEditor.channel.companyReadOnly === true;
  const editingCustomerId = channelEditor?.mode === "edit" ? linkedCustomerId(channelEditor.channel) : undefined;
  const [materialEditor, setMaterialEditor] = useState<MaterialEditor | null>(null);
  const materialDialogRef = useRef<HTMLElement>(null);
  const [materialForm, setMaterialForm] = useState<MaterialForm>({
    channelId: "",
    partNumber: "",
    brand: "",
    qty: "",
    dateCode: "",
    price: "",
    taxIncluded: "unknown",
    leadTime: "",
    note: "",
  });
  const [batchOpen, setBatchOpen] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<{ identity: string; channelId: number; session: number } | null>(null);
  const [batchTarget, setBatchTarget] = useState<Channel | null>(null);
  const batchSessionRef = useRef(0);
  const batchAbortRef = useRef<AbortController | null>(null);
  const batchActiveRef = useRef(false);
  const clearBatch = () => {
    batchSessionRef.current += 1;
    batchAbortRef.current?.abort();
    batchActiveRef.current = false;
    setPendingBatch(null); setBatchTarget(null); setBatchOpen(false);
  };
  const [notesMaterial, setNotesMaterial] = useState<{ id: number } | null>(null);
  const [collaboration, setCollaboration] = useState<{ material: TeamMaterial; session: number } | null>(null);
  const [sourceRequested, setSourceRequested] = useState(false);
  const [sourceRequestScope, setSourceRequestScope] = useState("");
  const [sourceOptionsRevision, setSourceOptionsRevision] = useState(0);
  const [sourcesState, setSourcesState] = useState<{ scope: string; data?: SourceOptions; isLoading: boolean; isError: boolean }>({ scope: "", isLoading: false, isError: false });
  const [sourceDetail, setSourceDetail] = useState<{ materialId: number; scopeKey: string } | null>(null);
  const collaborationSessionRef = useRef(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"channel" | "material" | "status" | null>(null);
  const channelCreateRef = useRef<FrozenCreate<ChannelInventoryInputs["createChannel"]> | null>(null);
  const materialCreateRef = useRef<FrozenCreate<MaterialCreateInput> | null>(null);
  const materialUpdateRef = useRef<MaterialUpdateInput | null>(null);
  const [materialRetryLocked, setMaterialRetryLocked] = useState(false);

  const expectedContext = useMemo(
    () => ready ? { expectedEnterpriseId: enterpriseId!, expectedActorUserId: actorUserId! } : undefined,
    [actorUserId, enterpriseId, ready],
  );

  // The URL is only a UI intent. Exact server reads prove target identity and
  // source-read permission; neither names nor the first 100 upload options locate it.
  const [supplyLinkRevision, setSupplyLinkRevision] = useState(0);
  const supplyLinkKey = `${identity}:${search}:${supplyLinkRevision}`;
  const supplyLinkRef = useRef(supplyLinkKey); supplyLinkRef.current = supplyLinkKey;
  const [supplyTarget, setSupplyTarget] = useState<{ key: string; channel?: Channel; exactSourceReadable?: boolean; error?: string; loading: boolean }>({ key: "", loading: false });
  const exactTarget = supplyLink && supplyTarget.key === supplyLinkKey && contextCurrent && sourceIdentityCurrent && !enterpriseQuery.isError ? supplyTarget.channel : undefined;
  const exactReady = Boolean(exactTarget && !supplyTarget.error && exactTarget.active);
  const exactSourceReadable = exactReady && supplyTarget.exactSourceReadable === true;
  useEffect(() => {
    if (!supplyLink || !ready || !contextCurrent || !sourceIdentityCurrent || enterpriseQuery.isError || !expectedContext) return;
    setTab(supplyLink.tab);
    setSupplyTarget({ key: supplyLinkKey, loading: true });
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && identityRef.current === identity && supplyLinkRef.current === supplyLinkKey;
    void (async () => {
      try {
        if (!supplyLink.channelId) throw new Error("库存跳转参数无效，未定位任何渠道。");
        const channel = await utils.client.channelInventory.getChannel.query({ ...expectedContext, id: supplyLink.channelId }, { signal: abort.signal });
        if (!current()) return;
        if (channel.id !== supplyLink.channelId || channel.enterpriseId !== expectedContext.expectedEnterpriseId || !channel.active)
          throw new Error("目标渠道身份不匹配或已停用，未定位其他同名渠道。");
        if (supplyLink.tab === "materials") {
          // This uncached, exact request proves both stock and source readability.
          // A channel/profile/write grant and the leader-only options are not proof.
          // The team DTO intentionally need not expose a public channelId.
          const proofInput: ChannelInventoryInputs["listTeamMaterials"] = { ...expectedContext, channelId: channel.id, page: 1, pageSize: 1 };
          const stock = await utils.client.channelInventory.listTeamMaterials.query(proofInput, { signal: abort.signal });
          if (!current()) return;
          if (!stock?.items) throw new Error("目标库存核验暂不可用，未展示其他库存。");
          if (!stock.items.length) throw new Error("暂无目标可读库存，未展示其他库存。");
          if (!stock.items.every(row => row.canViewSource === true))
            throw new Error("当前账号没有目标渠道库存来源读取权限或权限已改变，未展示其他库存。");
          applyMaterialFilters({ channelId: String(channel.id), partNumber: "", brand: "", type: "all" }); setMaterialPage(1);
        }
        setSupplyTarget({ key: supplyLinkKey, channel, exactSourceReadable: supplyLink.tab === "materials", loading: false });
      } catch (error) {
        if (!current()) return;
        businessScope.onAuthorizationError(error);
        const detail = errorMessage(error, "");
        setSupplyTarget({ key: supplyLinkKey, loading: false, error: `目标渠道库存核验不可用或权限已改变，未展示其他库存。${detail ? ` ${detail}` : ""}` });
      }
    })();
    return () => abort.abort();
  }, [supplyLink, supplyLinkKey, identity, ready, contextCurrent, sourceIdentityCurrent, enterpriseQuery.isError, expectedContext, utils]);

  const channelInput: ChannelInventoryInputs["listChannels"] = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    name: channelFilters.name.trim() || undefined,
    type: channelFilters.type === "all" ? undefined : channelFilters.type,
    active:
      channelFilters.active === "all"
        ? undefined
        : channelFilters.active === "active",
    page: channelPage,
    pageSize: PAGE_SIZE,
  };
  const channelsQuery = trpc.channelInventory.listChannels.useQuery(channelInput, {
    enabled: ready && tab === "channels" && !supplyLink,
    retry: false,
  });

  const sourcesQuery = sourcesState.scope === sourceAuthorityKey ? sourcesState : { data: undefined, isLoading: false, isError: false };
  const sourceAllowed = sourceRequested && sourceRequestScope === sourceAuthorityKey && contextCurrent && !sourcesQuery.isError && sourcesQuery.data?.canFilterSource === true;
  const sourceOptions = sourceAllowed ? sourcesQuery.data!.items : [];
  const parsedMaterialChannelId = Number(materialFilters.channelId);
  const currentReadableChannel = inventoryView === "channels" && contextCurrent && readableChannel?.scope === identity && readableChannel.search === search
    && channelAvailability.scopeKey === identity && channelAvailability.ready
    && channelAvailability.channels.some(channel => channel.id === readableChannel.channel.id) ? readableChannel.channel : undefined;
  const browsingChannelsOnly = inventoryView === "channels" && !currentReadableChannel && !supplyLink;
  const materialChannelId = supplyLink
    ? exactSourceReadable ? exactTarget?.id : undefined
    : currentReadableChannel ? currentReadableChannel.id
    : sourceAllowed && sourceOptions.some(source => source.id === parsedMaterialChannelId) ? parsedMaterialChannelId : undefined;
  const rawUploadBatchId = contextCurrent ? materialFilters.uploadBatchId?.trim() ?? "" : "";
  const parsedUploadBatchId = Number(rawUploadBatchId);
  const uploadBatchFilterValid = !rawUploadBatchId || /^\d+$/.test(rawUploadBatchId) && Number.isSafeInteger(parsedUploadBatchId) && parsedUploadBatchId > 0;
  const materialInput: ChannelInventoryInputs["listTeamMaterials"] & { uploadBatchId?: number } = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    partNumber: contextCurrent ? materialFilters.partNumber.normalize("NFKC").trim() || undefined : undefined,
    brand: contextCurrent ? materialFilters.brand.trim() || undefined : undefined,
    channelId: materialChannelId,
    industryCode: contextCurrent && materialFilters.industryCode !== "all" ? materialFilters.industryCode : undefined,
    uploadBatchId: uploadBatchFilterValid && rawUploadBatchId ? parsedUploadBatchId : undefined,
    page: contextCurrent ? materialPage : 1,
    pageSize: PAGE_SIZE,
    sortBy: contextCurrent ? materialSort?.field : undefined,
    sortDirection: contextCurrent ? materialSort?.direction : undefined,
  };
  const managementTab = tab === "batches" || tab === "trash";
  const materialsQuery = trpc.channelInventory.listTeamMaterials.useQuery(managementTab ? {
    expectedEnterpriseId: enterpriseId ?? undefined, expectedActorUserId: actorUserId ?? undefined, page: 1, pageSize: 1,
  } : materialInput, {
    // Management tabs re-use the server write proof, not cached role guesses.
    enabled: ready && (managementTab || tab === "materials" && !browsingChannelsOnly && uploadBatchFilterValid && batchIntentReady) && (!supplyLink || (exactSourceReadable && materialChannelId === supplyLink.channelId)), retry: false, staleTime: 0, refetchOnWindowFocus: true,
  });
  const exactStockDenied = materialsQuery.isError || Boolean(materialsQuery.data?.items.some(row => row.canViewSource !== true));
  useEffect(() => {
    if (!supplyLink || supplyLink.tab !== "materials" || !exactSourceReadable || !exactStockDenied) return;
    setSupplyTarget({ key: supplyLinkKey, loading: false, error: "目标库存读取失败或来源权限已改变，未展示其他库存。" });
  }, [supplyLink, exactSourceReadable, exactStockDenied, supplyLinkKey]);
  // Retain only a same-authority filter hint during pagination, never across a
  // denial/context change. It is not sufficient to read any source options.
  const sourceFilterProof = useRef({ scope: "", allowed: false });
  if (materialsQuery.data || materialsQuery.isError || sourceFilterProof.current.scope !== sourceAuthorityKey) {
    sourceFilterProof.current = { scope: sourceAuthorityKey, allowed: !materialsQuery.isError && materialsQuery.data?.canFilterSource === true };
  }
  const sourceFilterHint = sourceContextVerified && contextCurrent && !enterpriseQuery.isError
    && sourceFilterProof.current.allowed;
  const canFilterSource = sourceAllowed && sourceFilterHint;
  const sourceFilterDenied = sourceRequested && !sourcesQuery.isLoading && (sourcesQuery.isError || sourcesQuery.data?.canFilterSource === false);
  const requestSourceOptions = () => {
    if (!sourceFilterHint) return;
    setSourceRequestScope(sourceAuthorityKey); setSourceRequested(true);
    if (sourceFilterDenied) setSourceOptionsRevision(current => current + 1);
  };
  useEffect(() => {
    if (!sourceRequested || sourceRequestScope !== sourceAuthorityKey || !ready || !sourceFilterHint || tab !== "materials") return;
    const controller = new AbortController();
    let alive = true;
    const current = () => alive && !controller.signal.aborted && sourceAuthorityRef.current === sourceAuthorityKey;
    setSourcesState({ scope: sourceAuthorityKey, isLoading: true, isError: false });
    void utils.client.channelInventory.listTeamSourceOptions.query({ expectedEnterpriseId: enterpriseId!, expectedActorUserId: actorUserId! }, { signal: controller.signal })
      .then(data => { if (current()) setSourcesState({ scope: sourceAuthorityKey, data, isLoading: false, isError: false }); })
      .catch(error => { if (current()) { setSourcesState({ scope: sourceAuthorityKey, isLoading: false, isError: true }); businessScope.onAuthorizationError(error); } });
    return () => { alive = false; controller.abort(); };
  }, [sourceRequested, sourceRequestScope, sourceOptionsRevision, sourceAuthorityKey, ready, sourceFilterHint, tab, utils, enterpriseId, actorUserId]);
  useEffect(() => {
    if (!sourceRequested || !sourceFilterHint || tab !== "materials") return;
    const refresh = () => { setSourcesState({ scope: sourceAuthorityKey, isLoading: true, isError: false }); setSourceOptionsRevision(current => current + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [sourceRequested, sourceFilterHint, sourceAuthorityKey, tab]);
  useEffect(() => {
    setSourceRequested(false); setSourceRequestScope("");
    setSourcesState({ scope: "", isLoading: false, isError: false });
  }, [sourceAuthorityKey]);
  useEffect(() => {
    if (materialsQuery.isError || materialsQuery.data?.canFilterSource === false) {
      setSourceRequested(false); setSourceRequestScope("");
      setSourcesState({ scope: "", isLoading: false, isError: false });
    }
  }, [materialsQuery.isError, materialsQuery.data?.canFilterSource]);

  const optionQueryInput: ChannelInventoryInputs["listChannels"] = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    active: true,
    page: optionPage,
    pageSize: 100,
  };
  const optionsNeeded = materialEditor?.mode === "create" || batchOpen || pendingBatch !== null;
  const channelOptionsQuery = trpc.channelInventory.listChannels.useQuery(optionQueryInput, {
    enabled: ready && contextCurrent && optionsNeeded,
    retry: false,
  });

  const createChannel = trpc.channelInventory.createChannel.useMutation();
  const updateChannel = trpc.channelInventory.updateChannel.useMutation();
  const setChannelActive = trpc.channelInventory.setChannelActive.useMutation();
  const createMaterial = trpc.channelInventory.createMaterial.useMutation();
  const updateMaterial = trpc.channelInventory.updateTeamMaterial.useMutation();

  useEffect(() => {
    identityRef.current = identity;
    setChannelPage(1);
    setMaterialPage(1);
    setStateIdentity(identity);
    applyMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all" });
    setChannelFilters({ name: "", type: "all", active: "all" });
    setReadableChannel(null);
    setMaterialSort(null);
    editRequestRef.current += 1; editAbortRef.current?.abort();
    setBusy(null);
    exportRequestRef.current += 1;
    exportPendingRef.current = false;
    setDownloadingChannelId(null);
    setDownloadStatus("");
    setOptionPage(1);
    setOptionChannels([]);
    setChannelEditor(null);
    setMaterialEditor(null);
    clearBatch();
    setNotesMaterial(null);
    setCollaboration(null); collaborationSessionRef.current += 1;
    setSourceRequested(false); setSourceDetail(null);
    materialUpdateRef.current = null; setMaterialRetryLocked(false);
    setMessage("");
    channelCreateRef.current = null;
    materialCreateRef.current = null;
  }, [identity]);

  useEffect(() => {
    if (readChannelInventoryTabIntent(search) === "batches") setBatchListState(readChannelInventoryBatchListState(search));
    if (!batchMaterialIntent) return;
    // URL state never proves scope/source rights. Keep source-list filters
    // entirely separate from this exact batch inventory intent.
    setReadableChannel(null);
    applyMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all", uploadBatchId: batchMaterialIntent.id === null ? "invalid" : String(batchMaterialIntent.id) });
    setMaterialPage(1); setMaterialSort(null);
    setAppliedBatchIntentKey(batchIntentKey);
  }, [search, identity]);

  useEffect(() => () => { exportRequestRef.current += 1; editRequestRef.current += 1; editAbortRef.current?.abort(); batchSessionRef.current += 1; batchAbortRef.current?.abort(); }, []);

  useEffect(() => {
    if (!materialEditor) return;
    const trigger = document.activeElement as HTMLElement | null;
    materialDialogRef.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [materialEditor]);

  useEffect(() => {
    const result = channelOptionsQuery.data;
    if (!result || !ready || !contextCurrent || !optionsNeeded || channelOptionsQuery.isError) return;
    setOptionChannels(current => {
      const next = new Map((result.page === 1 ? [] : current).map(channel => [channel.id, channel]));
      for (const channel of result.items) next.set(channel.id, channel);
      return Array.from(next.values()).sort((left, right) => right.id - left.id);
    });
  }, [channelOptionsQuery.data, channelOptionsQuery.isError, ready, contextCurrent, optionsNeeded]);

  useEffect(() => {
    if (materialEditor?.mode !== "create") return;
    const initial = optionChannels.find(channel => channel.active && channel.canEdit && !channel.readOnly);
    if (initial) setMaterialForm(current => current.channelId ? current : { ...current, channelId: String(initial.id) });
  }, [optionChannels, materialEditor?.mode]);

  const isCurrent = useCallback(() => identityRef.current === identity && Boolean(identity), [identity]);

  const refreshChannels = useCallback(async () => {
    setOptionPage(1); setOptionChannels([]);
    await Promise.allSettled([
      utils.channelInventory.listChannels.invalidate(),
      utils.channelInventory.listTeamMaterials.invalidate(),
      utils.channelInventory.listTeamSourceOptions.invalidate(),
    ]);
  }, [utils]);

  const refreshMaterials = useCallback(async () => {
    await Promise.allSettled([
      utils.channelInventory.listTeamMaterials.invalidate(),
      utils.channelInventory.listTeamSourceOptions.invalidate(),
      utils.channelInventory.notesList.invalidate(),
      utils.channelInventory.collaborationNotesList.invalidate(),
    ]);
  }, [utils]);

  const changeTab = (next: InventoryTab, syncLocation = true) => {
    invalidateEditSession();
    setMaterialEditor(null); setChannelEditor(null); clearBatch(); setNotesMaterial(null);
    setCollaboration(null); collaborationSessionRef.current += 1;
    setSourceDetail(null);
    materialUpdateRef.current = null; setMaterialRetryLocked(false);
    setMessage("");
    setDismissedSupplyLink(search);
    setTab(next);
    if (next === "materials") setReadableChannel(null);
    const target = next === "materials" ? channelInventoryViewLocation("flat", true) : channelInventoryTabLocation(next, true);
    if (syncLocation && target && typeof window !== "undefined") {
      const actual = `${window.location.pathname}${window.location.search}`;
      const absoluteTarget = next === "materials" ? channelInventoryViewLocation("flat") : channelInventoryTabLocation(next);
      if (actual !== target && actual !== absoluteTarget) {
        // changeTab has already invalidated the old UI. Do not destroy a legacy
        // upload session opened immediately afterwards on its own URL event.
        tabSearchRef.current = target.slice(target.indexOf("?") + 1);
        navigate(target);
      }
    }
  };

  const tabSearchRef = useRef(search);
  useEffect(() => {
    if (tabSearchRef.current === search) return;
    const previousSearch = tabSearchRef.current;
    tabSearchRef.current = search;
    // Browser/menu navigation must not push another history entry. Legacy
    // supply targets (including invalid ones) retain their exact proof effect.
    const next = readChannelInventoryTabIntent(search) ?? (parseSupplyLocation(search) ? null : "materials");
    const viewChanged = getChannelInventoryNavigationView(previousSearch) !== inventoryView;
    const leftExactTarget = !supplyLink && Boolean(parseSupplyLocation(previousSearch) || readChannelInventoryBatchMaterialIntent(previousSearch));
    if (next && (next !== tab || viewChanged || leftExactTarget)) {
      changeTab(next, false);
      if (next === "materials" && !batchMaterialIntent) {
        applyMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all" });
        setMaterialPage(1); setMaterialSort(null);
      }
    }
    // Only a new search is an intent; internal state changes are not navigation.
  }, [search]);

  const openChannelCreate = () => {
    if (!canWriteChannels || !isCurrent()) return;
    invalidateEditSession();
    channelCreateRef.current = null;
    setChannelForm(EMPTY_CHANNEL_FORM);
    setMessage("");
    setChannelEditor({ mode: "create" });
  };

  const openChannelEdit = (channel: Channel) => {
    if (!canWriteChannels || channelEditDisabledReason(channel)) return;
    invalidateEditSession();
    setChannelForm(channelFormFrom(channel));
    setMessage("");
    setChannelEditor({ mode: "edit", channel });
  };

  const viewChannelMaterials = (channel: Channel) => {
    if (supplyLink && exactReady) { navigate(supplyLocation(channel.id, "materials")); return; }
    changeTab("materials");
    setMessage("");
    requestSourceOptions();
    applyMaterialFilters({ ...materialFilters, channelId: sourceFilterHint ? String(channel.id) : "" });
    setMaterialPage(1);
    setTab("materials");
  };

  const downloadChannelMaterials = async (channel: Channel) => {
    if (!canExportChannels) { setMessage("当前账号没有库存导出权限或权限上下文不可用，未生成文件。"); return; }
    if (!expectedContext || !contextCurrent || !sourceContextVerified || !sourceIdentityCurrent || enterpriseQuery.isError || !isCurrent() || channelsQuery.isError || exportPendingRef.current) return;
    const generation = exportSessionRef.current.generation;
    const request = ++exportRequestRef.current;
    const current = () => isCurrent() && exportAllowedRef.current && generation === exportSessionRef.current.generation && request === exportRequestRef.current;
    exportPendingRef.current = true;
    setDownloadingChannelId(channel.id); setMessage(""); setDownloadStatus("");
    try {
      // A direct query bypasses the query cache and never exports the visible page.
      const [xlsx, result] = await Promise.all([
        import("xlsx"),
        utils.client.channelInventory.exportChannelMaterials.query({ ...expectedContext, channelId: channel.id }),
      ]);
      if (!current()) return;
      if (result.enterpriseId !== enterpriseId || result.actorUserId !== actorUserId || result.channel.id !== channel.id || result.total !== result.items.length || result.total > 10_000) throw new Error("导出结果上下文不匹配，未生成文件，请刷新后重试。");
      const { workbook, fileName } = createChannelInventoryExportWorkbook(xlsx, result);
      // Recheck the live authenticated subject immediately before creating a file.
      const fresh = await enterpriseQuery.refetch();
      if (!current()) return;
      if (fresh.isError || fresh.data?.enterprise?.id !== enterpriseId || fresh.data?.currentUserId !== actorUserId) throw new Error("企业或账号权限已变化，未生成文件，请刷新后重新下载。");
      if (!current()) return;
      xlsx.writeFile(workbook, fileName, { bookType: "xlsx", compression: true });
      setDownloadStatus(result.total ? `已下载该渠道全部 ${result.total} 条可读库存。` : "该渠道暂无可读库存，已下载含表头的空表。");
    } catch (error) {
      if (current()) setMessage(errorMessage(error, "渠道库存下载失败，未生成文件，请重试。"));
    } finally {
      if (current()) { exportPendingRef.current = false; setDownloadingChannelId(null); }
    }
  };

  const submitChannel = async () => {
    if (!expectedContext || !isCurrent() || !canWriteChannels || !channelEditor || busy) return;
    const name = channelForm.name.trim();
    if (!linkedCompanyEditing && !name) {
      setMessage("请输入渠道名称。");
      return;
    }
    const industry = businessIndustryCodeSchema.safeParse(channelForm.industryCode);
    if (!linkedCompanyEditing && !industry.success) {
      setMessage("请选择所属行业。");
      return;
    }
    if (channelEditor.mode === "edit" && channelEditDisabledReason(channelEditor.channel)) return;
    setBusy("channel");
    setMessage("");
    try {
      if (linkedCompanyEditing && channelEditor.mode === "edit") {
        // CRM is authoritative. Never send company fields, even unchanged ones.
        await updateChannel.mutateAsync({
          ...expectedContext,
          id: channelEditor.channel.id,
          expectedRevision: channelEditor.channel.revision,
          type: channelForm.type,
        });
      } else if (channelEditor.mode === "create" && industry.success) {
        const candidate: Omit<ChannelInventoryInputs["createChannel"], "requestId"> = {
          ...expectedContext,
          name,
          industryCode: industry.data,
          type: channelForm.type,
          contactName: toNullable(channelForm.contactName),
          phone: toNullable(channelForm.phone),
          wechat: toNullable(channelForm.wechat),
          qq: toNullable(channelForm.qq),
          notes: toNullable(channelForm.notes),
          active: true,
        };
        const fingerprint = JSON.stringify(candidate);
        let frozen = channelCreateRef.current;
        if (!frozen || frozen.fingerprint !== fingerprint) {
          frozen = { fingerprint, requestId: createRequestId(), payload: { ...candidate, requestId: createRequestId() } };
          frozen.payload.requestId = frozen.requestId;
          channelCreateRef.current = frozen;
        }
        await createChannel.mutateAsync(frozen.payload);
        channelCreateRef.current = null;
      } else if (channelEditor.mode === "edit" && industry.success) {
        await updateChannel.mutateAsync({
          ...expectedContext,
          id: channelEditor.channel.id,
          expectedRevision: channelEditor.channel.revision,
          name,
          industryCode: industry.data,
          type: channelForm.type,
          contactName: toNullable(channelForm.contactName),
          phone: toNullable(channelForm.phone),
          wechat: toNullable(channelForm.wechat),
          qq: toNullable(channelForm.qq),
          notes: toNullable(channelForm.notes),
        });
      }
      if (!isCurrent()) return;
      invalidateEditSession();
      setChannelEditor(null);
      await refreshChannels();
    } catch (error) {
      if (!isCurrent()) return;
      if (channelEditor.mode === "create" && !definitiveWriteFailure(error)) {
        setMessage("保存结果尚未确认。请按原内容重试；系统会使用同一请求号，不会重复创建渠道。");
      } else {
        channelCreateRef.current = null;
        setMessage(errorMessage(error, "渠道保存失败，请刷新后重试。"));
      }
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const toggleChannel = async (channel: Channel) => {
    if (!expectedContext || !isCurrent() || !canWriteChannels || busy || !channel.canEdit || channel.readOnly) return;
    const action = channel.active ? "停用" : "启用";
    if (!window.confirm(`确认${action}渠道“${channel.name}”吗？${channel.active ? "停用后不能新增或修改其库存。" : ""}`)) return;
    setBusy("status");
    setMessage("");
    try {
      await setChannelActive.mutateAsync({
        ...expectedContext,
        id: channel.id,
        active: !channel.active,
        expectedRevision: channel.revision,
      });
      if (isCurrent()) await refreshChannels();
    } catch (error) {
      if (isCurrent()) setMessage(errorMessage(error, "渠道状态更新失败，请刷新后重试。"));
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const openMaterialCreate = () => {
    if (!canWriteMaterials || !isCurrent()) return;
    clearBatch();
    // Retained legacy logic: never discard an independently proven supply target.
    if (!supplyLink && inventoryView !== "flat") changeTab("materials");
    setReadableChannel(null);
    invalidateEditSession();
    materialCreateRef.current = null;
    materialUpdateRef.current = null; setMaterialRetryLocked(false);
    setNotesMaterial(null); setCollaboration(null);
    const initialChannel = optionChannels.find(channel => channel.active && channel.canEdit && !channel.readOnly);
    setMaterialForm({
      channelId: initialChannel ? String(initialChannel.id) : "",
      partNumber: "",
      brand: "",
      qty: "",
      dateCode: "",
      price: "",
      taxIncluded: "unknown",
      leadTime: "",
      note: "",
    });
    setMessage("");
    setMaterialEditor({ mode: "create" });
  };

  const openMaterialEdit = async (material: TeamMaterial) => {
    if (!material.canEdit || material.readOnly || !isCurrent() || !editAllowedRef.current) return;
    invalidateEditSession();
    const request = ++editRequestRef.current;
    const abort = new AbortController(); editAbortRef.current = abort;
    materialUpdateRef.current = null; setMaterialRetryLocked(false); setNotesMaterial(null);
    setMessage("");
    try {
      // Public-only detail: leader editing must never fetch the legacy private endpoint.
      const detail = await utils.client.channelInventory.getTeamMaterialForEdit.query({ ...expectedContext, id: material.id }, { signal: abort.signal });
      if (!isCurrent() || abort.signal.aborted || !editAllowedRef.current || request !== editRequestRef.current || detail.id !== material.id || !detail.canEdit || detail.readOnly || !editableRowsRef.current.has(material.id)) return;
      setMaterialForm(materialFormFrom(detail));
      setMaterialEditor({ mode: "edit", material: detail, isMine: material.isMine });
    } catch (error) {
      if (!abort.signal.aborted && isCurrent() && editAllowedRef.current && request === editRequestRef.current && editableRowsRef.current.has(material.id)) setMessage(errorMessage(error, "库存详情读取失败。"));
    }
  };

  const submitMaterial = async () => {
    if (!expectedContext || !isCurrent() || !materialEditor || busy) return;
    if (!editAllowedRef.current || materialsQuery.data?.canWrite !== true || (materialEditor.mode === "create"
      ? !optionChannels.some(channel => channel.id === Number(materialForm.channelId) && channel.active && channel.canEdit && !channel.readOnly)
      : !editableRowsRef.current.has(materialEditor.material.id) || !materialEditor.material.canEdit || materialEditor.material.readOnly)) {
      setMessage("关联渠道不可写或已停用，请刷新后重试。");
      return;
    }
    const validation = validateMaterialForm(materialForm, materialEditor.mode === "create");
    if (validation.length) {
      setMessage(validation.join("；"));
      return;
    }
    const body = materialInputFromForm({ ...materialForm, note: nativeNote ? materialForm.note : "" });
    const session = editRequestRef.current;
    const current = () => isCurrent() && session === editRequestRef.current;
    setBusy("material");
    setMessage("");
    try {
      if (materialEditor.mode === "create") {
        const candidate: Omit<MaterialCreateInput, "requestId"> = { ...expectedContext, ...body };
        const fingerprint = JSON.stringify(candidate);
        let frozen = materialCreateRef.current;
        if (!frozen || frozen.fingerprint !== fingerprint) {
          frozen = { fingerprint, requestId: createRequestId(), batchRequestId: createRequestId(), payload: { ...candidate, requestId: createRequestId() } };
          frozen.payload.requestId = frozen.requestId;
          materialCreateRef.current = frozen;
        }
        // File uploads already do this in BatchUpload. The Host's separate
        // single-entry form previously bypassed it; freeze both requests here.
        if (frozen.payload.uploadBatchId === undefined) {
          const batch = await managementClient.createUploadBatch.mutate({ ...expectedContext, channelId: body.channelId,
            fileName: "单条手工录入", totalRows: 1, requestId: frozen.batchRequestId! });
          if (!current() || !editAllowedRef.current) return;
          if (!Number.isSafeInteger(batch.id) || batch.id <= 0) throw new Error("上传批次回执无效，请按原请求重试。");
          frozen.payload.uploadBatchId = batch.id;
        }
        await createMaterial.mutateAsync(frozen.payload);
        materialCreateRef.current = null;
      } else {
        const input: MaterialUpdateInput = materialUpdateRef.current ?? {
          ...expectedContext,
          partNumber: body.partNumber, brand: body.brand, qty: body.qty,
          dateCode: body.dateCode, price: body.price, taxIncluded: body.taxIncluded, leadTime: body.leadTime,
          id: materialEditor.material.id,
          expectedRevision: materialEditor.material.revision,
          requestId: createRequestId(),
        };
        materialUpdateRef.current = input;
        await updateMaterial.mutateAsync(input);
      }
      if (!current()) return;
      materialUpdateRef.current = null; setMaterialRetryLocked(false); setBusy(null);
      invalidateEditSession();
      setMaterialEditor(null);
      await refreshMaterials();
    } catch (error) {
      if (!current()) return;
      if (materialEditor.mode === "create" && !definitiveWriteFailure(error)) {
        setMaterialRetryLocked(true);
        setMessage("保存结果尚未确认。请按原内容重试；系统会使用同一请求号，不会重复创建库存。");
      } else if (materialEditor.mode === "edit" && !definitiveWriteFailure(error)) {
        setMaterialRetryLocked(true);
        setMessage("保存结果未确认。公共资料已锁定，请按原请求重试，不会重复修改库存。");
      } else {
        materialCreateRef.current = null;
        materialUpdateRef.current = null; setMaterialRetryLocked(false);
        setMessage(errorMessage(error, "库存保存失败，请刷新后重试。"));
      }
    } finally {
      if (current()) setBusy(null);
    }
  };

  const submitBatchMaterial = async (payload: BatchMaterialPayload, requestId: string, uploadBatchId?: number) => {
    if (!expectedContext || !isCurrent() || !batchActiveRef.current) throw new Error("当前企业、账号或上传会话已变化，请重新打开批量上传。");
    if (!editAllowedRef.current || materialsQuery.data?.canWrite !== true || !batchChannels.some(channel => channel.id === payload.channelId && channel.active && channel.canEdit && !channel.readOnly)) throw new Error("关联渠道不可写或已停用，已停止后续上传。");
    return createMaterial.mutateAsync({ ...expectedContext, ...payload, requestId, ...(uploadBatchId === undefined ? {} : { uploadBatchId }) });
  };
  const submitUploadBatch = async (input: UploadBatchInput) => {
    if (!expectedContext || !isCurrent() || !batchActiveRef.current || !editAllowedRef.current || materialsQuery.data?.canWrite !== true)
      throw new Error("当前企业、账号或上传权限已变化，已停止创建批次。");
    if (!batchChannels.some(channel => channel.id === input.channelId && channel.active && channel.canEdit && !channel.readOnly))
      throw new Error("关联渠道不可写或已停用，不能创建上传批次。");
    return managementClient.createUploadBatch.mutate({ ...expectedContext, ...input });
  };

  const activeChannels = optionChannels.filter(channel => channel.active && channel.canEdit && !channel.readOnly);
  // Keep the exact, server-validated target even if it is outside the loaded
  // option page. A fresh loaded row overrides it, including inactive/read-only.
  const batchChannels = Array.from(new Map([
    ...(batchTarget ? [batchTarget] : []), ...optionChannels,
  ].map(channel => [channel.id, channel])).values());
  const channelResult = contextCurrent && !channelsQuery.isError ? channelsQuery.data : undefined;
  const readableChannelStockDenied = Boolean(currentReadableChannel && (materialsQuery.isError || materialsQuery.data?.items.some(row => row.canViewSource !== true)));
  const materialResult = uploadBatchFilterValid && batchIntentReady && !browsingChannelsOnly && !readableChannelStockDenied && !materialsQuery.isError && contextCurrent && (!supplyLink || (exactSourceReadable && materialChannelId === supplyLink.channelId && !exactStockDenied)) ? materialsQuery.data : undefined;
  const displayedChannels = supplyLink ? exactReady && exactTarget ? [exactTarget] : [] : channelResult?.items ?? [];
  const displayedChannelTotal = supplyLink ? displayedChannels.length : channelResult?.total ?? 0;
  const materialRows = materialResult?.items ?? [];
  // Only the current, settled native page can authorize public reference work.
  // Wait for scoped preferences too: hidden saved columns must never start IO.
  const referencesShown = columnVisible("refLcsc") || columnVisible("refIckey");
  const referenceRows = materialRows.map(row => ({ id: row.id, partNumber: row.partNumber, brand: row.brand }));
  const referenceAllowed = ready && nativeRead && sourceContextVerified && sourceIdentityCurrent && contextCurrent
    && columnsContextVerified && columnPreference.key === columnsKey && referencesShown
    && !enterpriseQuery.isLoading && !enterpriseQuery.isFetching && !enterpriseQuery.isError
    && tab === "materials" && !browsingChannelsOnly && Boolean(materialResult)
    && tabSearchRef.current === search && (!readChannelInventoryTabIntent(search) || readChannelInventoryTabIntent(search) === tab)
    && !materialsQuery.isLoading && !materialsQuery.isFetching && !materialsQuery.isPlaceholderData && !materialsQuery.isError
    && materialResult?.page === materialInput.page && materialResult?.pageSize === PAGE_SIZE
    && Number.isSafeInteger(businessScope.merchantId) && businessScope.merchantId > 0
    && referenceRows.length > 0 && referenceRows.length <= PAGE_SIZE
    && referenceRows.every(row => Number.isSafeInteger(row.id) && row.id > 0)
    && new Set(referenceRows.map(row => row.id)).size === referenceRows.length;
  const referenceKey = referenceAllowed ? JSON.stringify({
    identity, authority: sourceAuthorityKey, merchantId: businessScope.merchantId,
    tab, view: inventoryView, search, page: materialPage, filters: materialFilters, order: materialSort,
    listInput: materialInput, rows: referenceRows, columnsShown: visibleColumns,
  }) : "";
  const referenceRunKey = referenceKey ? JSON.stringify([referenceKey, 0]) : "";
  const referenceCurrentRef = useRef(referenceRunKey);
  referenceCurrentRef.current = referenceRunKey;
  const referencePendingRef = useRef(false);
  const [referenceState, setReferenceState] = useState<{ key: string; items: ChannelReferenceRow[]; busy: boolean }>({ key: "", items: [], busy: false });
  const currentReferences = new Map((referenceAllowed && referenceState.key === referenceRunKey ? referenceState.items : []).map(row => [row.materialId, row.references]));
  useEffect(() => {
    referencePendingRef.current = false;
    setReferenceState({ key: referenceRunKey, items: [], busy: Boolean(referenceRunKey) });
    if (!referenceRunKey) return;
    // This BFF-only client is deliberately separate from the front-domain trpc/utils.
    const referenceClient = createBusinessScopeTrpcClient(businessScope.merchantId);
    const current = () => referenceCurrentRef.current === referenceRunKey;
    const cancel = startChannelReferenceLookup({
      rows: referenceRows, refresh: false, isCurrent: current,
      lookup: (refresh, signal) => referenceClient.channelReference.lookup.query({
        listInput: materialInput, materialIds: referenceRows.map(row => row.id), refresh,
      }, { signal }),
      onData: result => setReferenceState(state => ({ ...state, key: referenceRunKey, items: result.items })),
      onBusy: busy => { referencePendingRef.current = busy; setReferenceState(state => ({ ...state, key: referenceRunKey, busy })); },
      onError: error => {
        referencePendingRef.current = false;
        setReferenceState({ key: referenceRunKey, items: [], busy: false });
        businessScope.onAuthorizationError(error);
      },
      onStopped: () => { referencePendingRef.current = false; },
    });
    return () => { cancel(); referencePendingRef.current = false; };
    // The serialized boundary contains every captured request/identity/row/column input.
  }, [referenceRunKey]);
  // Row hints and list refresh snapshots are never authorization or a reason to
  // destroy an independently reauthorized source dialog.
  const sourceScopeKey = JSON.stringify({
    authority: sourceAuthorityKey, readable: sourceIdentityCurrent && ready && !enterpriseQuery.isError && !materialsQuery.isError && contextCurrent && !browsingChannelsOnly,
    view: inventoryView, selectedChannel: inventoryView === "channels" ? currentReadableChannel?.id : undefined,
    tab,
  });
  const sourceScopeRef = useRef(sourceScopeKey);
  sourceScopeRef.current = sourceScopeKey;
  useEffect(() => { setSourceDetail(null); }, [sourceScopeKey]);
  const openSource = (material: TeamMaterial) => {
    if (material.canViewSource !== true || !sourceContextVerified || !isCurrent() || !contextCurrent || materialsQuery.isError || enterpriseQuery.isError) return;
    setSourceDetail({ materialId: material.id, scopeKey: sourceScopeKey });
  };
  const canWriteChannels = nativeWrite && hasInventoryWrite && ready && contextCurrent && sourceIdentityCurrent && !enterpriseQuery.isError
    && (supplyLink ? exactReady && exactTarget?.canEdit === true && !exactTarget.readOnly : !channelsQuery.isError && channelsQuery.data?.canWrite === true);
  // Export uses the effective management grant plus the existing readable
  // channel proof; a record's readonly/edit hint is not an export grant.
  const canExportChannels = hasInventoryWrite && ready && contextCurrent && sourceContextVerified && sourceIdentityCurrent && !enterpriseQuery.isError
    && (supplyLink ? exactReady && channelsQuery.data?.canWrite !== false : !channelsQuery.isError && channelsQuery.data?.canWrite === true);
  const exportAllowedRef = useRef(false);
  exportAllowedRef.current = canExportChannels;
  const canWriteMaterials = nativeWrite && hasInventoryWrite && ready && sourceIdentityCurrent && !enterpriseQuery.isError && !browsingChannelsOnly && !materialsQuery.isError && contextCurrent && materialsQuery.data?.canWrite === true
    && (!supplyLink || (supplyLink.tab === "channels" ? exactReady : exactSourceReadable && Boolean(materialResult)));
  const channelPageCount = supplyLink ? 1 : Math.max(1, channelResult?.pageCount ?? 1);
  const materialTotalsKey = JSON.stringify([identity, materialInput.channelId, materialInput.partNumber, materialInput.brand,
    materialInput.industryCode, materialInput.uploadBatchId, materialInput.sortBy, materialInput.sortDirection]);
  const materialTotalsRef = useRef({ key: "", total: 0, pageCount: 1 });
  if (materialResult) materialTotalsRef.current = { key: materialTotalsKey, total: materialResult.total, pageCount: Math.max(1, materialResult.pageCount) };
  const materialTotals = !materialsQuery.isError && contextCurrent && (!supplyLink || Boolean(materialResult)) && materialTotalsRef.current.key === materialTotalsKey
    ? materialTotalsRef.current : { total: 0, pageCount: 1 };
  const materialTotal = materialTotals.total;
  const materialPageCount = materialTotals.pageCount;
  const materialTotalKnown = !browsingChannelsOnly && batchIntentReady && contextCurrent && (Boolean(materialResult) || materialTotalsRef.current.key === materialTotalsKey);
  const editAllowedRef = useRef(false);
  editAllowedRef.current = canWriteMaterials;
  batchActiveRef.current = batchOpen && tab === "materials" && canWriteMaterials && sourceIdentityCurrent
    && !enterpriseQuery.isError && !channelOptionsQuery.isError && channelOptionsQuery.data?.canWrite === true;
  const batchSession = batchSessionRef.current;
  const batchCurrent = () => isCurrent() && batchSessionRef.current === batchSession && batchActiveRef.current;
  const uploadDisabledReason = (channel: Channel) => {
    if (!channel.active) return "该渠道已停用，不能上传库存";
    if (channel.readOnly || !channel.canEdit) return "该渠道为只读，不能上传库存";
    if (!nativeWrite || !hasInventoryWrite) return "当前账号没有库存上传权限";
    if (!canWriteChannels || !sourceIdentityCurrent || enterpriseQuery.isError) return "当前渠道或企业权限不可用";
    if (materialsQuery.isError || materialsQuery.data?.canWrite === false) return "当前账号没有可用的库存写权限";
    if (busy !== null || pendingBatch !== null) return "正在处理操作，请稍候";
    return undefined;
  };
  const openBatch = (channel?: Channel) => {
    if (!isCurrent() || (channel ? uploadDisabledReason(channel) : !canWriteMaterials)) return;
    changeTab("materials");
    setOptionPage(1); setOptionChannels([]);
    if (channel) {
      setPendingBatch({ identity, channelId: channel.id, session: batchSessionRef.current });
    } else setBatchOpen(true);
  };
  useEffect(() => {
    if (!pendingBatch || pendingBatch.identity !== identity || tab !== "materials" || !expectedContext) return;
    const abort = new AbortController(); batchAbortRef.current = abort;
    const current = () => !abort.signal.aborted && identityRef.current === pendingBatch.identity
      && batchSessionRef.current === pendingBatch.session;
    // Exact read is independent of archive filters and the 100-row option page.
    void utils.client.channelInventory.getChannel.query({ ...expectedContext, id: pendingBatch.channelId }, { signal: abort.signal })
      .then(channel => {
        if (!current()) return;
        if (channel.id !== pendingBatch.channelId || channel.enterpriseId !== expectedContext.expectedEnterpriseId
          || !channel.active || !channel.canEdit || channel.readOnly) {
          clearBatch(); setMessage("关联渠道不可写或已停用，请刷新后重试。"); return;
        }
        setBatchTarget(channel);
      })
      .catch(error => {
        if (!current()) return;
        clearBatch(); setMessage(errorMessage(error, "渠道核验失败，请刷新后重试。"));
        businessScope.onAuthorizationError(error);
      });
    return () => abort.abort();
  }, [pendingBatch, identity, tab, expectedContext, utils]);
  useEffect(() => {
    if (!pendingBatch) return;
    if (pendingBatch.identity !== identity || tab !== "materials" || !nativeWrite || !hasInventoryWrite
      || !sourceIdentityCurrent || enterpriseQuery.isError || materialsQuery.isError
      || materialsQuery.data?.canWrite === false || channelOptionsQuery.isError || channelOptionsQuery.data?.canWrite === false) {
      clearBatch(); return;
    }
    if (!canWriteMaterials || materialsQuery.isLoading || materialsQuery.isFetching
      || channelOptionsQuery.isLoading || channelOptionsQuery.isFetching || channelOptionsQuery.data?.canWrite !== true
      || batchTarget?.id !== pendingBatch.channelId) return;
    const target = batchChannels.find(channel => channel.id === pendingBatch.channelId);
    if (!target?.active || !target.canEdit || target.readOnly) { clearBatch(); return; }
    setPendingBatch(null); setBatchOpen(true);
  }, [pendingBatch, identity, tab, nativeWrite, hasInventoryWrite, sourceIdentityCurrent, enterpriseQuery.isError,
    canWriteMaterials, materialsQuery.isLoading, materialsQuery.isFetching, materialsQuery.isError, materialsQuery.data?.canWrite,
    channelOptionsQuery.isLoading, channelOptionsQuery.isFetching, channelOptionsQuery.isError, channelOptionsQuery.data, batchTarget, optionChannels]);
  const editableRowsRef = useRef(new Set<number>());
  editableRowsRef.current = new Set(materialRows.filter(row => row.canEdit && !row.readOnly).map(row => row.id));
  const collaborationRowsRef = useRef(new Map<number, TeamMaterial>());
  collaborationRowsRef.current = new Map(materialRows.map(row => [row.id, row]));
  const privateNotesAllowed = ready && nativeRead && nativeNote && contextCurrent && sourceIdentityCurrent
    && sourceContextVerified && !enterpriseQuery.isError && !materialsQuery.isError && tab === "materials";
  const privateNotesAllowedRef = useRef(false);
  privateNotesAllowedRef.current = privateNotesAllowed;
  const openPrivateNotes = (materialId: number, fromEditor = false) => {
    if (!isCurrent() || !privateNotesAllowedRef.current || collaborationRowsRef.current.get(materialId)?.isMine !== true) return;
    if (!fromEditor) {
      invalidateEditSession(); setMaterialEditor(null); clearBatch();
      materialUpdateRef.current = null; setMaterialRetryLocked(false); setBusy(null);
    }
    setCollaboration(null); collaborationSessionRef.current += 1;
    setNotesMaterial({ id: materialId });
  };
  useEffect(() => {
    if (!privateNotesAllowed || notesMaterial && collaborationRowsRef.current.get(notesMaterial.id)?.isMine !== true) setNotesMaterial(null);
  }, [privateNotesAllowed, notesMaterial, materialResult]);
  const openCollaboration = (material: TeamMaterial) => {
    if (!isCurrent() || !contextCurrent || materialsQuery.isError) return;
    invalidateEditSession(); setMaterialEditor(null); setNotesMaterial(null); clearBatch();
    materialUpdateRef.current = null; setMaterialRetryLocked(false); setBusy(null);
    setCollaboration({ material, session: ++collaborationSessionRef.current });
  };
  useEffect(() => {
    if (materialEditor?.mode === "edit" && materialResult && !editableRowsRef.current.has(materialEditor.material.id)) {
      editRequestRef.current += 1;
      setMaterialEditor(null);
    }
  }, [materialEditor, materialResult]);

  useEffect(() => {
    if (!supplyLink && !currentReadableChannel && (!sourceFilterHint || (sourceRequested && !sourcesQuery.isLoading && !canFilterSource))) {
      if (materialFilters.channelId) { setMaterialFilters(current => ({ ...current, channelId: "" })); setMaterialPage(1); }
      if (draftMaterialFilters.channelId) setDraftMaterialFilters(current => ({ ...current, channelId: "" }));
    }
  }, [supplyLink, currentReadableChannel, sourceFilterHint, sourceRequested, sourcesQuery.isLoading, canFilterSource, materialFilters.channelId, draftMaterialFilters.channelId]);
  useEffect(() => {
    if (!canWriteChannels) setChannelEditor(null);
  }, [canWriteChannels]);
  useEffect(() => {
    if (!canExportChannels) {
      exportRequestRef.current += 1; exportPendingRef.current = false;
      setDownloadingChannelId(null); setDownloadStatus("");
    }
  }, [canExportChannels]);
  useEffect(() => {
    if (!canWriteMaterials) {
      editRequestRef.current += 1; editAbortRef.current?.abort();
      setMaterialEditor(null); setBatchOpen(false);
      // Loading the real stock query is allowed only for a pending intent; an
      // already-open batch must be destroyed on loss of its write proof.
      if (batchOpen) clearBatch();
    }
    if (batchOpen && (channelOptionsQuery.isError || channelOptionsQuery.data?.canWrite === false)) clearBatch();
  }, [canWriteMaterials, batchOpen, channelOptionsQuery.isError, channelOptionsQuery.data?.canWrite]);

  const cycleSort = (field: "qty" | "dateCode") => {
    const first = field === "qty" ? "desc" : "asc";
    setMaterialSort(current => current?.field !== field ? { field, direction: first }
      : current.direction === first ? { field, direction: first === "desc" ? "asc" : "desc" } : null);
    setMaterialPage(1);
  };
  const sortAria = (field: "qty" | "dateCode") => materialSort?.field === field
    ? materialSort.direction === "asc" ? "ascending" : "descending" : "none";
  const sortArrow = (field: "qty" | "dateCode") => materialSort?.field === field
    ? <span className="ci-sort-arrow" aria-hidden="true">{materialSort.direction === "asc" ? "↑" : "↓"}</span> : null;
  const quantitySortLabel = materialSort?.field === "qty"
    ? materialSort.direction === "desc" ? "数量从多到少" : "数量从少到多" : "数量默认顺序";
  const quantitySortNext = materialSort?.field !== "qty" ? "点击数量从多到少"
    : materialSort.direction === "desc" ? "点击数量从少到多" : "点击恢复默认顺序";
  const quantitySortIcon = <svg className="ci-quantity-sort-icon" width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">
    <path className={materialSort?.field === "qty" && materialSort.direction === "asc" ? "ci-sort-active" : undefined} d="M2 7 L6 3 L10 7" />
    <path className={materialSort?.field === "qty" && materialSort.direction === "desc" ? "ci-sort-active" : undefined} d="M2 11 L6 15 L10 11" />
  </svg>;

  const managementCanWrite = canWriteMaterials && sourceContextVerified && sourceIdentityCurrent && !enterpriseQuery.isError && !readableChannelStockDenied;
  const selectionScopeKey = JSON.stringify([identity, tab, inventoryView, currentReadableChannel?.id, search, materialPage, materialFilters, draftMaterialFilters, materialSort, managementCanWrite]);
  const [selectionModeKey, setSelectionModeKey] = useState<string | null>(null);
  const selectionMode = selectionModeKey === selectionScopeKey;
  useEffect(() => { setSelectionModeKey(current => current === selectionScopeKey ? current : null); }, [selectionScopeKey]);
  const deletion = useMaterialDeletion({ client: managementClient, context: expectedContext,
    scopeKey: JSON.stringify([selectionScopeKey, selectionMode]), rows: materialRows,
    canWrite: managementCanWrite && tab === "materials", isCurrent, onComplete: refreshMaterials, onAuthorizationError: businessScope.onAuthorizationError });
  const showDeleteSelection = selectionMode && managementCanWrite;
  const columnLayout = channelInventoryColumnLayout(visibleColumns, showDeleteSelection);
  const presentationScopeKey = JSON.stringify([selectionScopeKey, visibleColumns]);
  const publishing = useFactoryMaterialPublish({ rows: materialRows as readonly FactoryMaterialPublishRow[], context: expectedContext,
    scopeKey: identity, authorized: businessScope.frontUser.role === "user" || businessScope.frontUser.role === "admin", available: nativePublish && ready && contextCurrent && sourceContextVerified && sourceIdentityCurrent && !enterpriseQuery.isError && !materialsQuery.isError && tab === "materials",
    proofReady: Boolean(materialResult), proofVersion: materialsQuery.dataUpdatedAt, isCurrent, onComplete: refreshMaterials, onAuthorizationError: businessScope.onAuthorizationError });
  const confirmMaterialFilters = () => {
    if (!isCurrent() || !contextCurrent) return;
    const batchText = draftMaterialFilters.uploadBatchId?.trim() ?? "";
    const batchId = Number(batchText);
    const validBatch = !batchText || /^\d+$/.test(batchText) && Number.isSafeInteger(batchId) && batchId > 0;
    const draftChannelId = Number(draftMaterialFilters.channelId);
    const nextChannelId = supplyLink ? exactSourceReadable ? exactTarget?.id : undefined
      : currentReadableChannel ? currentReadableChannel.id
      : sourceAllowed && sourceOptions.some(source => source.id === draftChannelId) ? draftChannelId : undefined;
    const nextInput = { ...materialInput,
      partNumber: draftMaterialFilters.partNumber.normalize("NFKC").trim() || undefined,
      brand: draftMaterialFilters.brand.trim() || undefined, channelId: nextChannelId,
      industryCode: draftMaterialFilters.industryCode !== "all" ? draftMaterialFilters.industryCode : undefined,
      uploadBatchId: validBatch && batchText ? batchId : undefined, page: 1 };
    // A changed key fetches the new filters after render. Only re-fetch here
    // when the normalized key is unchanged, never with stale/invalid drafts.
    const repeatSearch = ready && sourceContextVerified && sourceIdentityCurrent && !enterpriseQuery.isError
      && tab === "materials" && !browsingChannelsOnly && validBatch
      && (!supplyLink || exactSourceReadable && nextChannelId === supplyLink.channelId)
      && JSON.stringify(nextInput) === JSON.stringify(materialInput);
    applyMaterialFilters({ ...draftMaterialFilters }); setMaterialPage(1); setMessage("");
    if (repeatSearch) void materialsQuery.refetch();
  };
  const changeInventoryView = (next: "flat" | "channels") => {
    const target = channelInventoryViewLocation(next, true);
    if (!target) return;
    changeTab("materials", false); setReadableChannel(null);
    applyMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all" }); setMaterialPage(1); setMaterialSort(null);
    navigate(target);
  };
  const selectReadableChannel = (channel: ReadableInventoryChannel) => {
    if (!isCurrent() || !sourceContextVerified || !sourceIdentityCurrent || channel.canViewSource === false) return;
    setReadableChannel({ scope: identity, search, channel });
    applyMaterialFilters({ channelId: String(channel.id), partNumber: "", brand: "", type: "all" });
    setMaterialPage(1); setMaterialSort(null);
  };
  const viewUploadBatch = (id: number) => {
    if (!isCurrent() || !Number.isSafeInteger(id) || id <= 0) return;
    const origin = channelInventoryBatchListLocation(batchListState, false, focusBatchId);
    const target = channelInventoryBatchMaterialLocation(id, origin, true);
    if (!target) return;
    changeTab("materials", false);
    setReadableChannel(null);
    applyMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all", uploadBatchId: String(id) });
    setMaterialPage(1); setMaterialSort(null);
    navigate(target);
  };
  const returnToUploadBatches = () => {
    const target = batchMaterialIntent?.returnLocation ?? channelInventoryBatchListLocation(batchListState, true);
    changeTab("batches", false); navigate(target);
  };
  const viewMaterialUploadBatch = (material: TeamMaterial) => {
    const metadata = material as TeamMaterial & { uploadBatchId?: number | null; canViewUploadBatch?: boolean };
    if (!isCurrent() || !contextCurrent || !sourceContextVerified || materialsQuery.isError || metadata.canViewUploadBatch !== true
      || !Number.isSafeInteger(metadata.uploadBatchId) || metadata.uploadBatchId! <= 0) return;
    changeTab("batches", false);
    navigate(channelInventoryBatchListLocation({ channelId: "", archived: "all", page: 1 }, true, metadata.uploadBatchId!));
  };
  const batchReturn = tab === "materials" && (batchMaterialIntent || rawUploadBatchId) ? <button type="button" className="ci-button" onClick={returnToUploadBatches}>返回上传批次</button> : null;
  // Read access is the existing management-panel contract, not its write grant.
  const managementCanRead = ready && contextCurrent && sourceIdentityCurrent && !enterpriseQuery.isError;
  const inventoryMore = managementCanRead ? <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className="ci-button" aria-label="更多库存管理">更多</button></DropdownMenuTrigger>
    <DropdownMenuContent className="ci-channel-actions-menu ci-inventory-more-menu" align="end">
      <DropdownMenuItem onSelect={() => { changeTab("batches", false); navigate(channelInventoryBatchListLocation(undefined, true)); }}>上传记录</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => changeTab("trash")}>已删除库存</DropdownMenuItem>
      {hasInventoryWrite && (canWriteMaterials || tab === "channels" && canWriteChannels) ? <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => changeTab("channels")}>历史渠道整理</DropdownMenuItem></> : null}
    </DropdownMenuContent>
  </DropdownMenu> : null;

  if (enterpriseQuery.isLoading) {
    return <section className="ci-page ci-host-state" aria-busy="true">{batchReturn}正在核对官方工作台权限…</section>;
  }
  if (enterpriseQuery.isError) {
    return <section className="ci-page ci-host-state ci-host-error" role="alert">{batchReturn}官方工作台权限加载失败：{enterpriseQuery.error.message}</section>;
  }
  if (!ready) {
    return (
      <section className="ci-page ci-host-state ci-host-error" role="alert">
        {batchReturn}
        当前账号没有渠道库存查看权限。请由管理员核实官方库存查看授权、有效官方员工身份及当前渠道分配后重试。
      </section>
    );
  }

  return (
    <section className={`ci-page ci-host${tab === "materials" && inventoryView === "flat" ? " ci-flat-host" : ""}`} aria-label="渠道库存管理" data-channel-inventory-host>
      <h1 className="ci-sr-only">{tab === "materials" ? inventoryView === "channels" ? "渠道库存" : "库存列表" : tab === "channels" ? "历史渠道整理" : tab === "batches" ? "上传记录" : "已删除库存"}</h1>
      {batchReturn}

      {supplyLink ? <div className="ci-supply-location" role="status">
        {supplyTarget.key !== supplyLinkKey || supplyTarget.loading ? "正在精确核验客户关联渠道…" : supplyTarget.error
          ? <span className="ci-error">{supplyTarget.error}</span> : <span>已精确定位渠道 #{exactTarget?.id}：{exactTarget?.name}</span>}
        {supplyLink.tab === "materials" && exactSourceReadable && !materialsQuery.isLoading && !materialsQuery.isError && materialsQuery.data?.items.length === 0
          ? <span>暂无目标可读库存，未展示其他库存。</span> : null}
        <button type="button" className="ci-inline-link" disabled={supplyTarget.loading || busy !== null} onClick={() => setSupplyLinkRevision(value => value + 1)}>重新核验目标</button>
        <button type="button" className="ci-inline-link" onClick={() => { setDismissedSupplyLink(search); applyMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all" }); setChannelPage(1); setMaterialPage(1); }}>清除定位</button>
      </div> : null}
      {message && !materialEditor ? <p className="ci-error" role="alert">{message}</p> : null}
      {downloadStatus && contextCurrent ? <p className="ci-export-status" role="status">{downloadStatus}</p> : null}
      {pendingBatch && pendingBatch.identity === identity ? <p className="ci-readonly" role="status">正在核验库存写权限和关联渠道…</p> : null}

      {tab === "channels" ? (
        <section className="ci-panel" aria-label="渠道管理列表">
          <div className="ci-toolbar">
            <label className="ci-field ci-toolbar-search">
              <span className="ci-filter-label">渠道名称</span>
              <input aria-label="筛选渠道名称" value={channelFilters.name} onChange={event => { setChannelFilters(current => ({ ...current, name: event.target.value })); setChannelPage(1); }} placeholder="搜索渠道名称" />
            </label>
            <label className="ci-field ci-short-select">
              <span className="ci-filter-label">渠道类型</span>
              <select aria-label="筛选渠道类型" value={channelFilters.type} onChange={event => { setChannelFilters(current => ({ ...current, type: event.target.value as ChannelFilters["type"] })); setChannelPage(1); }}>
                <option value="all">全部类型</option>
                {CHANNEL_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <label className="ci-field ci-short-select">
              <span className="ci-filter-label">状态</span>
              <select aria-label="筛选渠道状态" value={channelFilters.active} onChange={event => { setChannelFilters(current => ({ ...current, active: event.target.value as ChannelFilters["active"] })); setChannelPage(1); }}>
                <option value="all">全部状态</option>
                <option value="active">启用</option>
                <option value="inactive">已停用</option>
              </select>
            </label>
            <button type="button" className="ci-button" onClick={() => { setChannelFilters({ name: "", type: "all", active: "all" }); setChannelPage(1); }}>重置</button>
            <button type="button" className="ci-button" disabled={!canWriteChannels} onClick={openChannelCreate}>+ 新增渠道</button>
            {inventoryMore}
            <span className="ci-filter-count">{displayedChannelTotal} 条渠道</span>
          </div>
          <div className="ci-tablewrap">
            <table className="ci-table ci-channel-table admin-table-readable">
              <thead><tr><th className="ci-channel-name-col">渠道名称</th><th className="ci-channel-type-col">类型</th><th className="ci-channel-contact-col">联系人 / 联系方式</th><th className="ci-channel-status-col">状态</th><th className="ci-channel-date-col">更新时间</th><th className="ci-col-actions">操作</th></tr></thead>
              <tbody>
                {!supplyLink && channelsQuery.isLoading ? <tr><td colSpan={6} className="ci-empty">正在加载渠道…</td></tr> : null}
                {!supplyLink && channelsQuery.isError ? <tr><td colSpan={6} className="ci-empty ci-host-error">{errorMessage(channelsQuery.error, "渠道加载失败。")}</td></tr> : null}
                {!supplyLink && !channelsQuery.isLoading && !channelsQuery.isError && !displayedChannels.length ? <tr><td colSpan={6} className="ci-empty">暂无符合筛选条件的渠道。</td></tr> : null}
                {displayedChannels.map(channel => (
                  <tr key={channel.id} data-channel-id={channel.id} className={supplyLink && exactTarget?.id === channel.id ? "ci-supply-target" : undefined}>
                    <td><strong className="ci-channel-name admin-cell-primary">{channel.name}</strong></td>
                    <td><span className="ci-channel-type-tag">{channelTypeLabel(channel.type)}</span></td>
                    <td><div className="admin-cell-primary">{channel.contactName || "—"}</div><small className="ci-subtext admin-cell-secondary">{[channel.phone, channel.wechat ? `微信 ${channel.wechat}` : null, channel.qq ? `QQ ${channel.qq}` : null].filter(Boolean).join(" · ") || "未填写联系方式"}</small></td>
                    <td><span className={channel.active ? "ci-status ci-status-active" : "ci-status ci-status-inactive"}>{activeLabel(channel.active)}</span></td>
                    <td className="ci-date admin-cell-secondary">{displayDate(channel.updatedAt)}</td>
                    <td className="ci-col-actions"><div className="ci-row-actions">
                      <button type="button" className="ci-inline-link" title={uploadDisabledReason(channel)} disabled={Boolean(uploadDisabledReason(channel))} onClick={() => openBatch(channel)}>上传库存</button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><button type="button" className="ci-inline-link" aria-label={`更多操作：${channel.name}`}>更多操作</button></DropdownMenuTrigger>
                        <DropdownMenuContent className="ci-channel-actions-menu" align="end">
                          <DropdownMenuItem disabled={busy !== null || !contextCurrent} title={busy !== null ? "正在处理操作，请稍候" : !contextCurrent ? "企业或账号已变化" : undefined} onSelect={() => viewChannelMaterials(channel)}>查看库存</DropdownMenuItem>
                          <DropdownMenuItem disabled={busy !== null || downloadingChannelId !== null || !canExportChannels} title={!canExportChannels ? "当前账号没有库存导出权限或权限上下文不可用" : downloadingChannelId !== null ? "正在下载库存，请稍候" : busy !== null ? "正在处理操作，请稍候" : undefined} aria-busy={downloadingChannelId === channel.id} onSelect={() => void downloadChannelMaterials(channel)}>{downloadingChannelId === channel.id ? "下载中…" : "下载库存"}</DropdownMenuItem>
                          <DropdownMenuItem disabled={busy !== null || !canWriteChannels || Boolean(channelEditDisabledReason(channel))} title={channelEditDisabledReason(channel) ?? (!canWriteChannels ? "当前账号没有渠道编辑权限" : busy !== null ? "正在处理操作，请稍候" : undefined)} onSelect={() => openChannelEdit(channel)}>编辑渠道</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant={channel.active ? "destructive" : "default"} disabled={busy !== null || !canWriteChannels || !channel.canEdit || channel.readOnly} title={channel.readOnly || !channel.canEdit ? "该渠道为只读" : !canWriteChannels ? "当前账号没有渠道状态修改权限" : busy !== null ? "正在处理操作，请稍候" : undefined} onSelect={() => void toggleChannel(channel)}>{channel.active ? "停用" : "启用"}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={supplyLink ? 1 : channelPage} pageCount={channelPageCount} total={displayedChannelTotal} onPage={setChannelPage} label="渠道" />
        </section>
      ) : tab === "materials" ? (
        <section className={`ci-panel${inventoryView === "flat" ? " ci-flat-view" : ""}`} aria-label="渠道库存列表">
          <form className="ci-toolbar" aria-label="材料筛选" onSubmit={event => { event.preventDefault(); confirmMaterialFilters(); }} onKeyDown={event => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); confirmMaterialFilters(); }
          }}>
            <label className="ci-field ci-view-select"><span className="ci-filter-label">库存查看方式</span><select aria-label="库存查看方式" value={inventoryView} onChange={event => changeInventoryView(event.target.value as "flat" | "channels")}><option value="flat">库存列表</option><option value="channels">渠道库存</option></select></label>
            {inventoryView === "channels" && !supplyLink && expectedContext ? <InventoryChannelSelector key={identity} client={managementClient} context={expectedContext} scopeKey={identity} active={sourceContextVerified && contextCurrent && sourceIdentityCurrent} canReadChannels={ready} canReadTeamSources={sourceFilterHint} selectedChannelId={readableChannel?.scope === identity && readableChannel.search === search ? readableChannel.channel.id : undefined} isCurrent={isCurrent} onSelect={selectReadableChannel} onAvailability={receiveChannelAvailability} onAuthorizationError={businessScope.onAuthorizationError} /> : null}
            {inventoryView !== "channels" || supplyLink ? <label className="ci-field ci-channel-select" title={supplyLink || currentReadableChannel ? "仅展示精确目标的可读库存；不扩大渠道来源筛选权限" : !sourceFilterHint || sourceFilterDenied ? "仅来源筛选受限；库存仍按当前可见范围展示" : undefined}><span className="ci-filter-label">渠道来源</span><select aria-label="筛选库存渠道来源" disabled={Boolean(currentReadableChannel) || !sourceFilterHint || sourceFilterDenied} onFocus={() => { if (!currentReadableChannel) requestSourceOptions(); }} onPointerDown={() => { if (!currentReadableChannel) requestSourceOptions(); }} value={currentReadableChannel ? String(currentReadableChannel.id) : canFilterSource ? draftMaterialFilters.channelId : supplyLink && exactSourceReadable && !sourceFilterHint ? String(exactTarget?.id) : ""} onChange={event => { if (currentReadableChannel || !canFilterSource) return; setDraftMaterialFilters(current => ({ ...current, channelId: event.target.value })); setMessage(""); }}>
              {currentReadableChannel ? <option value={currentReadableChannel.id}>{currentReadableChannel.name}</option> : sourceFilterHint && !sourceFilterDenied ? <><option value="">{sourceRequested && sourcesQuery.isLoading ? "正在读取渠道…" : "全部可见库存"}</option>{sourceOptions.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</> : supplyLink ? <option value={exactSourceReadable ? String(exactTarget?.id) : ""}>{exactSourceReadable ? `目标渠道：${exactTarget?.name}` : "目标库存尚未核验或不可用"}</option> : <option value="">全部可见库存</option>}
            </select></label> : null}
            <label className="ci-field ci-toolbar-search"><span className="ci-filter-label">型号</span><input aria-label="筛选库存型号" value={draftMaterialFilters.partNumber} onChange={event => setDraftMaterialFilters(current => ({ ...current, partNumber: event.target.value }))} placeholder="搜索型号" /></label>
            <label className="ci-field ci-brand-input"><span className="ci-filter-label">品牌</span><input aria-label="筛选库存品牌" value={draftMaterialFilters.brand} onChange={event => setDraftMaterialFilters(current => ({ ...current, brand: event.target.value }))} placeholder="搜索品牌" /></label>
            <button type="submit" className="ci-button ci-primary" disabled={browsingChannelsOnly}>搜索</button>
            <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <PopoverTrigger asChild><button type="button" className="ci-button" aria-label="高级库存筛选">高级筛选{(materialFilters.industryCode && materialFilters.industryCode !== "all" ? 1 : 0) + (rawUploadBatchId ? 1 : 0) ? `（${(materialFilters.industryCode && materialFilters.industryCode !== "all" ? 1 : 0) + (rawUploadBatchId ? 1 : 0)}）` : ""}</button></PopoverTrigger>
              <PopoverContent className="ci-inventory-advanced" align="start" aria-label="高级库存筛选条件">
                <label className="ci-field ci-industry-select"><span>所属行业</span><select aria-label="筛选库存行业" value={draftMaterialFilters.industryCode ?? "all"} onChange={event => setDraftMaterialFilters(current => ({ ...current, industryCode: event.target.value as MaterialFilters["industryCode"] }))}><option value="all">全部行业</option>{BUSINESS_INDUSTRY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}<option value="unset">未设置</option></select></label>
                <label className="ci-field ci-upload-batch-filter"><span>上传批次 ID</span><input aria-label="筛选上传批次 ID" inputMode="numeric" placeholder="上传批次 ID" value={draftMaterialFilters.uploadBatchId ?? ""} onChange={event => setDraftMaterialFilters(current => ({ ...current, uploadBatchId: event.target.value }))} /></label>
                <button type="button" className="ci-button ci-primary" disabled={browsingChannelsOnly} onClick={() => { confirmMaterialFilters(); setAdvancedOpen(false); }}>应用筛选</button>
              </PopoverContent>
            </Popover>
            <button type="button" className="ci-button" onClick={() => void refreshMaterials()}>刷新</button>
            {managementCanWrite ? <button type="button" className="ci-button" aria-pressed={selectionMode} disabled={deletion.busy || !selectionMode && !deletion.eligible.length} onClick={() => { deletion.cancelSelection(); setSelectionModeKey(selectionMode ? null : selectionScopeKey); }}>{selectionMode ? "取消选择" : "批量操作"}</button> : null}
            {!browsingChannelsOnly ? <Popover open={columnsOpen && columnsContextVerified} onOpenChange={setColumnsOpen}>
              <PopoverTrigger asChild><button type="button" className="ci-button" disabled={!columnsContextVerified}>显示列</button></PopoverTrigger>
              <PopoverContent className="ci-columns-popover" align="end" aria-label="库存显示列" onKeyDown={event => event.stopPropagation()}>
                <div className="ci-columns-options">{CHANNEL_INVENTORY_COLUMNS.map(column => <label key={column.id}>
                  <input type="checkbox" checked={columnVisible(column.id)} disabled={"fixed" in column && column.fixed}
                    onChange={event => updateColumns(event.target.checked ? [...visibleColumns, column.id] : visibleColumns.filter(id => id !== column.id))} />
                  <span>{column.label}{"fixed" in column && column.fixed ? <small>固定</small> : null}</span>
                </label>)}</div>
                <button type="button" className="ci-columns-reset" onClick={() => updateColumns(DEFAULT_CHANNEL_INVENTORY_COLUMNS)}>恢复默认</button>
              </PopoverContent>
            </Popover> : null}
            {inventoryMore}
            <span className="ci-filter-count">{browsingChannelsOnly ? channelAvailability.scopeKey === identity && channelAvailability.ready ? `${channelAvailability.channels.length} 个已授权渠道` : "正在核验渠道…" : materialsQuery.isError || !uploadBatchFilterValid || readableChannelStockDenied ? "库存条数不可用" : materialTotalKnown ? `${materialTotal} 条库存` : "正在读取库存条数…"}</span>
          </form>
          {materialFilters.industryCode && materialFilters.industryCode !== "all" || rawUploadBatchId ? <div className="ci-applied-filters" role="status" aria-label="已应用库存筛选">{materialFilters.industryCode && materialFilters.industryCode !== "all" ? <span>行业：{getBusinessIndustryLabel(materialFilters.industryCode === "unset" ? null : materialFilters.industryCode)}</span> : null}{rawUploadBatchId ? <span>批次：{rawUploadBatchId}</span> : null}</div> : null}
          {browsingChannelsOnly ? <p className="ci-empty">{channelAvailability.scopeKey === identity && channelAvailability.ready && channelAvailability.channels.length ? "请选择已授权渠道查看库存。" : "当前未选择可用渠道，未展示其他渠道库存。"}</p> : <>
          <p className="ci-sort-status ci-sr-only" id="ci-quantity-sort-status" role="status">{quantitySortLabel}{materialSort?.field === "qty" ? " · 待确认数量排末尾" : ""}</p>
          {!uploadBatchFilterValid ? <p className="ci-error" role="alert">上传批次 ID 须为正整数，未扩大展示其他库存。</p> : null}
          {readableChannelStockDenied ? <p className="ci-error" role="alert">当前渠道库存来源读取失败或权限已改变，未展示其他渠道库存。请返回渠道列表重新核验。</p> : null}
          {showDeleteSelection && deletion.selected.length ? <div className="ci-toolbar ci-selection-toolbar" role="group" aria-label="当前页批量删除"><span>已选 {deletion.selected.length} 条</span><button type="button" className="ci-button ci-danger-link" disabled={deletion.busy} onClick={() => deletion.requestDelete()}>批量删除</button><span className="ci-readonly">仅当前页，不跨页选择</span></div> : null}{deletion.feedback}
          <div className="ci-tablewrap ci-compact-tablewrap">
            <table className={`ci-table ci-compact-stock-table ci-stock-edit-table admin-table-readable${showDeleteSelection ? " ci-stock-managed-table" : ""}`} style={{ "--ci-stock-min-width": `${columnLayout.minWidth}px` } as React.CSSProperties}>
              <colgroup>
                {showDeleteSelection ? <col style={{ width: 40 }} /> : null}
                {columnLayout.visible.map(column => <col key={column.id} data-column={column.id} style={inventoryView !== "flat" && column.id === "partNumber" ? undefined : { width: column.width }} />)}
              </colgroup>
              <thead><tr>
                {showDeleteSelection ? <th className="ci-selection-col"><input type="checkbox" className="ci-selection-checkbox" aria-label="全选当前页可删除库存" disabled={!deletion.eligible.length || deletion.busy} checked={Boolean(deletion.eligible.length && deletion.selected.length === deletion.eligible.length)} ref={element => { if (element) element.indeterminate = deletion.selected.length > 0 && deletion.selected.length < deletion.eligible.length; }} onChange={deletion.selectAll} /></th> : null}
                {columnVisible("index") ? <th className="ci-col-index">#</th> : null}
                <th className="ci-material-part-col">型号</th>
                {columnVisible("brand") ? <th className="ci-material-brand-col">品牌</th> : null}
                {columnVisible("recorder") ? <th className="ci-material-recorder-col">负责人</th> : null}
                {columnVisible("industry") ? <th className="ci-material-industry-col">所属行业</th> : null}
                {columnVisible("qty") ? <th className="ci-material-qty-col" aria-sort={sortAria("qty")}><button type="button" className="ci-sort-button ci-quantity-sort-button" aria-label="按可供数量排序" aria-describedby="ci-quantity-sort-status" title={`${quantitySortLabel}；${quantitySortNext}`} onClick={() => cycleSort("qty")}>可供数量{quantitySortIcon}</button></th> : null}
                {columnVisible("price") ? <th className="ci-material-price-col">报价 CNY</th> : null}
                {columnVisible("refLcsc") ? <th className="ci-material-reference-col" title="立创商城公共网页参考">渠道参考一</th> : null}
                {columnVisible("refIckey") ? <th className="ci-material-reference-col" title="云汉芯城公共网页参考">渠道参考二</th> : null}
                {columnVisible("leadTime") ? <th className="ci-material-lead-col">交期</th> : null}
                {columnVisible("dateCode") ? <th className="ci-material-dc-col" aria-sort={sortAria("dateCode")}><button type="button" className="ci-sort-button" aria-label="按 Date Code 排序" onClick={() => cycleSort("dateCode")}>DC{sortArrow("dateCode")}</button></th> : null}
                {columnVisible("updatedAt") ? <th className="ci-material-date-col" title="更新时间（北京时间）">更新时间</th> : null}
                {columnVisible("source") ? <th className="ci-material-source-col">渠道来源</th> : null}
                <th className="ci-col-actions">操作</th>
              </tr></thead>
              <tbody>
                {materialsQuery.isLoading ? <tr><td colSpan={columnLayout.count} className="ci-empty">正在加载渠道库存…</td></tr> : null}
                {materialsQuery.isError ? <tr><td colSpan={columnLayout.count} className="ci-empty ci-host-error">{errorMessage(materialsQuery.error, "渠道库存加载失败。")}</td></tr> : null}
                {!materialsQuery.isLoading && !materialsQuery.isError && !materialRows.length ? <tr><td colSpan={columnLayout.count} className="ci-empty">暂无符合筛选条件的渠道库存。</td></tr> : null}
                {materialRows.map((material, index) => {
                  const batchAssociation = materialUploadBatchAssociation(material as TeamMaterial & MaterialUploadBatchProjection);
                  const updatedAt = channelInventoryUpdatedAt(material.updatedAt);
                  return (
                  <tr key={material.id}>
                    {showDeleteSelection ? <td className="ci-selection-col">{deletion.eligible.some(row => row.id === material.id) ? <input type="checkbox" className="ci-selection-checkbox" aria-label={`选择删除库存：${material.partNumber}`} disabled={deletion.busy} checked={deletion.selected.some(row => row.id === material.id)} onChange={() => deletion.toggle(material.id)} /> : null}</td> : null}
                    {columnVisible("index") ? <td className="ci-number ci-row-index">{((materialResult?.page ?? 1) - 1) * (materialResult?.pageSize ?? PAGE_SIZE) + index + 1}</td> : null}
                    <td className="ci-material-part-col">{inventoryView === "flat" ? <ChannelInventoryCopyPartNumber key={presentationScopeKey} partNumber={material.partNumber} resetKey={presentationScopeKey} /> : <ChannelInventoryPartNumber partNumber={material.partNumber} resetKey={presentationScopeKey} />}</td>
                    {columnVisible("brand") ? <td className="ci-material-brand-col" title={material.brand}>{material.brand || "—"}</td> : null}
                    {columnVisible("recorder") ? <td className="ci-material-recorder-col admin-cell-primary" title={(material as TeamMaterial & { originalRecorderName?: string | null }).originalRecorderName ?? "待核实"}>{(material as TeamMaterial & { originalRecorderName?: string | null }).originalRecorderName ?? "待核实"}</td> : null}
                    {columnVisible("industry") ? <td className="ci-material-industry-col admin-cell-primary">{getBusinessIndustryLabel(businessIndustryCodeSchema.safeParse(material.industryCode).success ? material.industryCode : null)}</td> : null}
                    {columnVisible("qty") ? <td className="ci-material-qty-col ci-number admin-cell-primary">{material.qty === null ? "待确认" : material.qty.toLocaleString("zh-CN")}</td> : null}
                    {columnVisible("price") ? <td className="ci-material-price-col ci-price admin-cell-primary">{material.price === null ? "面议" : `¥${material.price}`}{material.taxIncluded === true || material.taxIncluded === false ? <small className="ci-subtext admin-cell-secondary">{material.taxIncluded ? "含税" : "未税"}</small> : null}</td> : null}
                    {columnVisible("refLcsc") ? <td className="ci-material-reference-col" data-reference-source="lcsc"><ChannelReferenceCell key={referenceRunKey} source="lcsc" quote={currentReferences.get(material.id)?.lcsc} /></td> : null}
                    {columnVisible("refIckey") ? <td className="ci-material-reference-col" data-reference-source="ickey"><ChannelReferenceCell key={referenceRunKey} source="ickey" quote={currentReferences.get(material.id)?.ickey} /></td> : null}
                    {columnVisible("leadTime") ? <td className="ci-material-lead-col ci-lead-time admin-cell-primary">{material.leadTime || "待确认"}</td> : null}
                    {columnVisible("dateCode") ? <td className="ci-material-dc-col">{material.dateCode?.trim() ? <ChannelInventoryPartNumber partNumber={material.dateCode} kind="dc" resetKey={presentationScopeKey} /> : null}</td> : null}
                    {columnVisible("updatedAt") ? <td className="ci-date ci-material-date-col">{updatedAt ? <time className="ci-updated-at admin-cell-secondary" dateTime={`${updatedAt.full.slice(0, 19).replace(" ", "T")}+08:00`}><ChannelInventoryPartNumber partNumber={updatedAt.full} displayValue={updatedAt.compact} kind="time" resetKey={presentationScopeKey} /></time> : null}</td> : null}
                    {columnVisible("source") ? <td className="ci-material-source-col">{material.canViewSource === true ? <button type="button" className="ci-inline-link ci-source-link" onClick={() => openSource(material)}>查看来源</button> : null}{batchAssociation.state !== "unlinked" ? <small className="ci-subtext ci-batch-source">{batchAssociation.state === "linked" ? <button type="button" className="ci-inline-link" aria-label={`查看库存 ${material.partNumber} 的来源批次 ${batchAssociation.id}`} onClick={() => viewMaterialUploadBatch(material)}>查看上传批次 #{batchAssociation.id}</button> : batchAssociation.state === "unavailable" ? "来源批次当前不可查看" : "批次信息不可用"}</small> : null}</td> : null}
                    <td className="ci-col-actions"><div className="ci-row-actions">{publishing.action(material)}<button type="button" className="ci-inline-link" onClick={() => openCollaboration(material)}>备注（{material.noteCount}）</button>{material.isMine && nativeNote ? <button type="button" className="ci-inline-link" aria-label={`本人备注：${material.partNumber}`} disabled={!privateNotesAllowed} onClick={() => openPrivateNotes(material.id)}>本人备注</button> : null}{material.canEdit && !material.readOnly || deletion.eligible.some(row => row.id === material.id) ? <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="ci-inline-link" aria-label={`更多库存操作：${material.partNumber}`}>更多</button></DropdownMenuTrigger><DropdownMenuContent className="ci-channel-actions-menu" align="end">{material.canEdit && !material.readOnly ? <DropdownMenuItem disabled={busy !== null || !canWriteMaterials} onSelect={() => void openMaterialEdit(material)}>编辑</DropdownMenuItem> : null}{deletion.eligible.some(row => row.id === material.id) ? <DropdownMenuItem variant="destructive" disabled={busy !== null || deletion.busy} onSelect={() => deletion.requestDelete([material])}>删除</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu> : null}</div></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!materialsQuery.isError && uploadBatchFilterValid && !readableChannelStockDenied && materialTotalKnown ? <Pagination page={materialPage} pageCount={materialPageCount} total={materialTotal} onPage={setMaterialPage} label="渠道库存" pageNumbers={inventoryView === "flat"} loading={inventoryView === "flat" && (materialsQuery.isLoading || materialsQuery.isFetching || !contextCurrent || !sourceIdentityCurrent)} /> : <p className="ci-readonly">{materialsQuery.isLoading ? "正在读取库存分页…" : "库存分页条数不可用。"}</p>}
          </>}
        </section>
      ) : expectedContext && contextCurrent && sourceIdentityCurrent ? <ChannelInventoryManagementPanel key={`${identity}:${tab}`} mode={tab} client={managementClient} context={expectedContext} canWrite={managementCanWrite} isCurrent={isCurrent} listState={tab === "batches" ? batchListState : undefined} onListStateChange={tab === "batches" ? setBatchListState : undefined} focusBatchId={focusBatchId} onClearBatchFocus={() => navigate(channelInventoryBatchListLocation(batchListState, true))} onViewBatch={viewUploadBatch} onComplete={refreshMaterials} onAuthorizationError={businessScope.onAuthorizationError} /> : null}
      {deletion.dialog}
      {publishing.dialog}

      {channelEditor && canWriteChannels && contextCurrent ? (
        <div className="ci-modal-backdrop" role="presentation">
          <section className="ci-host-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-channel-editor-title">
            <header><div><h2 id="ci-channel-editor-title">{channelEditor.mode === "create" ? "新增渠道" : "编辑渠道"}</h2><p>渠道负责人、企业归属和审计信息由服务器根据当前权限上下文处理。</p></div><button type="button" className="ci-icon-close" aria-label="关闭渠道编辑" disabled={busy === "channel"} onClick={() => { invalidateEditSession(); setChannelEditor(null); }}>×</button></header>
            {linkedCompanyEditing ? <p className="ci-readonly">公司名称、行业、联系人、电话、微信、QQ 和说明来自客户档案，仅可在客户档案维护；此处只修改供货类型。{editingCustomerId ? <button type="button" className="ci-inline-link" disabled={busy === "channel"} onClick={() => { if (!isCurrent()) return; invalidateEditSession(); setChannelEditor(null); navigate(`/customers/${editingCustomerId}`); }}>前往客户档案</button> : null}</p> : null}
            <div className="ci-form-grid">
              <label className="ci-field ci-form-wide"><span>渠道名称 *</span><input readOnly={linkedCompanyEditing} disabled={linkedCompanyEditing} value={channelForm.name} maxLength={128} onChange={event => setChannelForm(current => ({ ...current, name: event.target.value }))} /></label>
              <label className="ci-field"><span>渠道类型 *</span><select value={channelForm.type} onChange={event => setChannelForm(current => ({ ...current, type: event.target.value as ChannelType }))}>{CHANNEL_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
              <label className="ci-field"><span>联系人</span><input readOnly={linkedCompanyEditing} disabled={linkedCompanyEditing} value={channelForm.contactName} maxLength={64} onChange={event => setChannelForm(current => ({ ...current, contactName: event.target.value }))} /></label>
              <label className="ci-field"><span>联系电话</span><input readOnly={linkedCompanyEditing} disabled={linkedCompanyEditing} value={channelForm.phone} maxLength={32} onChange={event => setChannelForm(current => ({ ...current, phone: event.target.value }))} /></label>
              <label className="ci-field"><span>微信</span><input readOnly={linkedCompanyEditing} disabled={linkedCompanyEditing} value={channelForm.wechat} maxLength={64} onChange={event => setChannelForm(current => ({ ...current, wechat: event.target.value }))} /></label>
              <label className="ci-field"><span>QQ</span><input readOnly={linkedCompanyEditing} disabled={linkedCompanyEditing} value={channelForm.qq} maxLength={32} onChange={event => setChannelForm(current => ({ ...current, qq: event.target.value }))} /></label>
              <label className="ci-field"><span>所属行业{linkedCompanyEditing ? "（客户档案）" : " *"}</span><select disabled={linkedCompanyEditing} required={!linkedCompanyEditing} aria-required={!linkedCompanyEditing} aria-label="所属行业" value={channelForm.industryCode} onChange={event => setChannelForm(current => ({ ...current, industryCode: event.target.value }))}><option value="">{linkedCompanyEditing ? "客户档案未设置行业" : "请选择所属行业"}</option>{BUSINESS_INDUSTRY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="ci-field ci-form-wide"><span>渠道说明</span><textarea readOnly={linkedCompanyEditing} disabled={linkedCompanyEditing} value={channelForm.notes} maxLength={2000} rows={4} onChange={event => setChannelForm(current => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <footer><button type="button" className="ci-button" disabled={busy === "channel"} onClick={() => { invalidateEditSession(); setChannelEditor(null); }}>取消</button><button type="button" className="ci-button ci-primary" disabled={busy === "channel"} onClick={() => void submitChannel()}>{busy === "channel" ? "保存中…" : channelEditor.mode === "create" ? "保存渠道" : "保存修改"}</button></footer>
          </section>
        </div>
      ) : null}

      {materialEditor && canWriteMaterials && contextCurrent ? (
        <div className="ci-modal-backdrop" role="presentation">
          <section ref={materialDialogRef} className="ci-host-dialog ci-host-material-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-material-editor-title" onKeyDown={event => {
            if (event.key === "Escape" && busy !== "material" && !materialRetryLocked) { event.preventDefault(); invalidateEditSession(); setMaterialEditor(null); }
            if (event.key !== "Tab") return;
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
            const first = controls[0]; const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }}>
            <header><div><h2 id="ci-material-editor-title">{materialEditor.mode === "create" ? "单条上传" : "编辑渠道库存"}</h2></div><button type="button" className="ci-icon-close" aria-label="关闭库存编辑" disabled={busy === "material" || materialRetryLocked} onClick={() => { invalidateEditSession(); setMaterialEditor(null); }}>×</button></header>
            <div className="ci-dialog-scroll">
            {materialEditor.mode === "create" && !activeChannels.length ? <p className="ci-error" role="alert">暂无可用渠道。请先创建并启用渠道后再录入库存。</p> : null}
            <fieldset className="ci-form-grid" disabled={busy === "material" || materialRetryLocked}>
              {materialEditor.mode === "create" ? <label className="ci-field"><span>关联渠道 *</span><select required aria-label="关联渠道" value={materialForm.channelId} onChange={event => setMaterialForm(current => ({ ...current, channelId: event.target.value }))}><option value="">请选择启用渠道</option>{activeChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label> : <label className="ci-field"><span>关联渠道（不可更换）</span><input aria-label="关联渠道" readOnly disabled value="关联渠道由服务端保留" /></label>}
              <label className="ci-field"><span>型号 *</span><input required value={materialForm.partNumber} maxLength={128} onChange={event => setMaterialForm(current => ({ ...current, partNumber: event.target.value }))} /></label>
              <label className="ci-field"><span>品牌 *</span><input required value={materialForm.brand} maxLength={64} onChange={event => setMaterialForm(current => ({ ...current, brand: event.target.value }))} /></label>
              <label className="ci-field"><span>可供数量</span><input inputMode="numeric" placeholder="待确认" value={materialForm.qty} onChange={event => setMaterialForm(current => ({ ...current, qty: event.target.value }))} /></label>
              <label className="ci-field"><span>Date Code</span><input maxLength={32} value={materialForm.dateCode} onChange={event => setMaterialForm(current => ({ ...current, dateCode: event.target.value }))} /></label>
              <label className="ci-field"><span>报价 CNY</span><input inputMode="decimal" placeholder="面议" value={materialForm.price} onChange={event => setMaterialForm(current => ({ ...current, price: event.target.value }))} /></label>
              <label className="ci-field"><span>税务口径</span><select value={materialForm.taxIncluded} onChange={event => setMaterialForm(current => ({ ...current, taxIncluded: event.target.value as MaterialForm["taxIncluded"] }))}><option value="unknown">待确认</option><option value="included">含税</option><option value="excluded">未税</option></select></label>
              <label className="ci-field"><span>交期</span><input maxLength={64} placeholder="待确认" value={materialForm.leadTime} onChange={event => setMaterialForm(current => ({ ...current, leadTime: event.target.value }))} /></label>
              {nativeNote && materialEditor.mode === "create" ? <label className="ci-field ci-form-wide"><span>备注（仅本人）</span><textarea placeholder="仅本人可见，不共享" value={materialForm.note} maxLength={2000} rows={2} onChange={event => setMaterialForm(current => ({ ...current, note: event.target.value }))} /></label> : null}
            </fieldset>
            {nativeNote && materialEditor.mode === "edit" && materialEditor.isMine && collaborationRowsRef.current.get(materialEditor.material.id)?.isMine ? <div className="ci-private-entry"><button type="button" className="ci-inline-link" disabled={busy === "material" || materialRetryLocked || !privateNotesAllowed} onClick={() => openPrivateNotes(materialEditor.material.id, true)}>本人备注历史（私有）</button><small>独立私人历史，不随公共库存共享。</small></div> : null}
            {message ? <p className="ci-error" role="alert">{message}</p> : null}
            </div>
            <footer><button type="button" className="ci-button" disabled={busy === "material" || materialRetryLocked} onClick={() => { invalidateEditSession(); setMaterialEditor(null); }}>取消</button><button type="button" className="ci-button ci-primary" disabled={busy === "material" || (materialEditor.mode === "create" && !activeChannels.length)} onClick={() => void submitMaterial()}>{busy === "material" ? "保存中…" : materialRetryLocked ? "按原请求重试" : materialEditor.mode === "create" ? "上传库存" : "保存修改"}</button></footer>
          </section>
        </div>
      ) : null}

      {batchOpen && canWriteMaterials && contextCurrent && tab === "materials" ? <BatchUpload key={`${identity}:${batchSession}`} channels={batchChannels.filter(channel => channel.canEdit && !channel.readOnly).map(channel => ({ id: channel.id, name: channel.name, active: channel.active }))} channelTotal={channelOptionsQuery.data?.total ?? null} enterpriseId={enterpriseId!} actorUserId={actorUserId!} initialChannelId={batchTarget?.id} onClose={() => { invalidateEditSession(); clearBatch(); }} onDirtyChange={() => undefined} onBusyChange={() => undefined} onLoadMoreChannels={() => { const pages = channelOptionsQuery.data?.pageCount ?? 1; setOptionPage(current => Math.min(pages, current + 1)); }} loadingMoreChannels={channelOptionsQuery.isFetching} onCreate={submitBatchMaterial} onCreateBatch={submitUploadBatch} onComplete={() => { if (batchCurrent()) void refreshMaterials(); }} isCurrent={batchCurrent} /> : null}
      {notesMaterial && privateNotesAllowed && collaborationRowsRef.current.get(notesMaterial.id)?.isMine === true ? <PrivateNotesPanel key={`${identity}:${notesMaterial.id}`} materialId={notesMaterial.id} enterpriseId={enterpriseId!} actorUserId={actorUserId!} isCurrent={() => isCurrent() && privateNotesAllowedRef.current && collaborationRowsRef.current.get(notesMaterial.id)?.isMine === true} onClose={() => setNotesMaterial(null)} onComplete={() => { void refreshMaterials(); }} /> : null}
      {collaboration && contextCurrent && tab === "materials" && collaborationRowsRef.current.has(collaboration.material.id) ? <CollaborationNotesPanel key={`${identity}:${collaboration.material.id}:${collaboration.session}`} materialId={collaboration.material.id} partNumber={collaboration.material.partNumber} brand={collaboration.material.brand} enterpriseId={enterpriseId!} actorUserId={actorUserId!} canWriteNote={nativeNote} canAddNote={nativeNote && collaborationRowsRef.current.get(collaboration.material.id)?.canAddNote === true} isCurrent={() => isCurrent() && collaborationSessionRef.current === collaboration.session && collaborationRowsRef.current.has(collaboration.material.id)} onClose={() => { collaborationSessionRef.current += 1; setCollaboration(null); }} onComplete={() => void refreshMaterials()} /> : null}
      {sourceDetail && sourceIdentityCurrent && sourceDetail.scopeKey === sourceScopeKey && contextCurrent && tab === "materials" ? <ChannelInventorySourcePanel key={`${sourceScopeKey}:${sourceDetail.materialId}`} materialId={sourceDetail.materialId} enterpriseId={enterpriseId!} actorUserId={actorUserId!} scopeKey={sourceScopeKey} active={sourceContextVerified} isCurrent={() => isCurrent() && sourceScopeRef.current === sourceDetail.scopeKey} onClose={() => setSourceDetail(null)} onAuthorizationError={businessScope.onAuthorizationError} /> : null}
    </section>
  );
}
