import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../front-router-types/server/routers";
import { formatBeijingDateTime } from "../../../shared/beijingTime";
import { trpc } from "../../../../api/business-trpc";
import { BatchUpload } from "../components/channelInventory/BatchUpload";
import { NotesSummaryCompact } from "../components/channelInventory/NotesSummaryCompact";
import type { Payload as BatchMaterialPayload } from "../components/channelInventory/import";
import "../components/channelInventory/layout.css";
import "../components/channelInventory/batch.css";
import "../components/channelInventory/notes.css";
import "./ChannelInventoryHost.css";

type ChannelInventoryInputs = inferRouterInputs<AppRouter>["channelInventory"];
type ChannelInventoryOutputs = inferRouterOutputs<AppRouter>["channelInventory"];
type Channel = ChannelInventoryOutputs["listChannels"]["items"][number];
type SharedMaterial = ChannelInventoryOutputs["listSharedMaterials"]["items"][number];
type PrivateMaterial = ChannelInventoryOutputs["listMaterials"]["items"][number];
type ChannelType = ChannelInventoryInputs["createChannel"]["type"];
type MaterialCreateInput = ChannelInventoryInputs["createMaterial"];
type MaterialUpdateInput = ChannelInventoryInputs["updateMaterial"];

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
};

type ChannelForm = {
  name: string;
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
  | { mode: "edit"; material: PrivateMaterial };

type FrozenCreate<T> = {
  fingerprint: string;
  requestId: string;
  payload: T;
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

function channelFormFrom(channel: Channel): ChannelForm {
  return {
    name: channel.name,
    type: channel.type,
    contactName: channel.contactName ?? "",
    phone: channel.phone ?? "",
    wechat: channel.wechat ?? "",
    qq: channel.qq ?? "",
    notes: channel.notes ?? "",
  };
}

function materialFormFrom(material: PrivateMaterial): MaterialForm {
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
    note: material.note ?? "",
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

function validateMaterialForm(form: MaterialForm) {
  const errors: string[] = [];
  const channelId = Number(form.channelId);
  const quantity = form.qty.trim();
  const price = form.price.trim();
  if (!Number.isSafeInteger(channelId) || channelId <= 0) errors.push("请选择启用的关联渠道");
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

function Pagination({
  page,
  pageCount,
  total,
  onPage,
  label,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
}) {
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
function PrivateNotesPanel({ materialId, enterpriseId, actorUserId, isCurrent, onClose, onComplete }: {
  materialId: number; enterpriseId: number; actorUserId: number;
  isCurrent: () => boolean; onClose: () => void; onComplete: () => void;
}) {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; revision: number; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [message, setMessage] = useState("");
  const frozen = useRef<{ mode: "add" | "edit"; content: string; requestId: string; noteId?: number; expectedRevision?: number } | null>(null);
  const context = { expectedEnterpriseId: enterpriseId, expectedActorUserId: actorUserId };
  const query = trpc.channelInventory.notesList.useQuery({ ...context, materialId, page, pageSize: 50 }, { enabled: isCurrent(), retry: false, refetchOnWindowFocus: true });
  const add = trpc.channelInventory.notesAdd.useMutation();
  const edit = trpc.channelInventory.notesEdit.useMutation();
  const result = isCurrent() ? query.data : undefined;
  const canWrite = result?.canEdit === true && result.readOnly === false;
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / 50));

  const submit = async () => {
    if (!isCurrent() || busy || !canWrite) return;
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
      if (!isCurrent()) return;
      frozen.current = null; setRetryLocked(false); setDraft(""); setEditing(null);
      await query.refetch(); if (isCurrent()) onComplete();
    } catch (error) {
      if (!isCurrent()) return;
      if (definitiveWriteFailure(error)) {
        frozen.current = null; setRetryLocked(false);
        setMessage(errorMessage(error, "备注保存失败，请刷新后重试。"));
        void query.refetch();
      } else {
        setRetryLocked(true);
        setMessage("保存结果未确认。内容已锁定，请按原请求重试，系统不会重复追加或覆盖备注。");
      }
    } finally { if (isCurrent()) setBusy(false); }
  };

  return <div className="ci-modal-backdrop" role="presentation">
    <section className="ci-host-dialog ci-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-private-notes-title">
      <header><div><h2 id="ci-private-notes-title">本人库存备注（私有）</h2><p>仅当前负责人可见和维护；任何备注、作者和备注时间都不会随库存共享给团队。</p></div><button type="button" className="ci-icon-close" aria-label="关闭本人备注" disabled={busy || retryLocked} onClick={onClose}>×</button></header>
      {query.isLoading ? <p className="ci-empty">正在读取本人私有备注…</p> : null}
      {query.isError ? <p className="ci-error" role="alert">{errorMessage(query.error, "备注读取失败。")}</p> : null}
      {result ? <>
        <p><strong>{result.material.partNumber}</strong> · {result.material.brand}</p>
        {result.legacyNote ? <article className="ci-note-entry ci-note-legacy"><strong>原库存备注</strong><p>{result.legacyNote}</p><small>原作者和填写时间未记录；可在本人库存编辑页维护。</small></article> : null}
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
      <footer><button type="button" className="ci-button" disabled={busy || retryLocked} onClick={() => void query.refetch()}>刷新</button><button type="button" className="ci-button" disabled={busy || retryLocked} onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}

/**
 * New equivalent reconstruction of the missing channel-inventory Host.
 * It deliberately obtains identity only from the authenticated BFF response and
 * sends it back solely as the router's mismatch assertion. The server remains
 * the authority for inventory.manage, enterprise/data-owner scope, record owner,
 * team visibility, CAS and audit.
 */
export default function ChannelInventoryHost() {
  const utils = trpc.useUtils();
  const enterpriseQuery = trpc.enterprise.me.useQuery(undefined, { retry: false });
  const summary = enterpriseQuery.data;
  const enterpriseId = summary?.enterprise?.id;
  const actorUserId = summary?.currentUserId;
  const permissionKeys: readonly string[] = summary?.permissionKeys ?? [];
  const hasInventoryManage = Boolean(
    summary?.isOwner || permissionKeys.includes("inventory.manage"),
  );
  const ready = Number.isSafeInteger(enterpriseId) && (enterpriseId ?? 0) > 0
    && Number.isSafeInteger(actorUserId) && (actorUserId ?? 0) > 0
    && hasInventoryManage;
  const identity = ready ? `${enterpriseId}:${actorUserId}` : "";
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const [tab, setTab] = useState<"channels" | "materials">("materials");
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
  const [materialPage, setMaterialPage] = useState(1);
  const [materialVisibility, setMaterialVisibility] = useState<"own" | "team">("own");
  const [optionPage, setOptionPage] = useState(1);
  const [optionChannels, setOptionChannels] = useState<Channel[]>([]);
  const [channelEditor, setChannelEditor] = useState<ChannelEditor | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelForm>(EMPTY_CHANNEL_FORM);
  const [materialEditor, setMaterialEditor] = useState<MaterialEditor | null>(null);
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
  const [notesMaterial, setNotesMaterial] = useState<PrivateMaterial | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"channel" | "material" | "status" | "share" | null>(null);
  const channelCreateRef = useRef<FrozenCreate<ChannelInventoryInputs["createChannel"]> | null>(null);
  const materialCreateRef = useRef<FrozenCreate<MaterialCreateInput> | null>(null);

  const expectedContext = useMemo(
    () => ready ? { expectedEnterpriseId: enterpriseId!, expectedActorUserId: actorUserId! } : undefined,
    [actorUserId, enterpriseId, ready],
  );

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
    enabled: ready && tab === "channels",
    retry: false,
  });

  const parsedMaterialChannelId = Number(materialFilters.channelId);
  const materialChannelId = Number.isSafeInteger(parsedMaterialChannelId) && parsedMaterialChannelId > 0
    ? parsedMaterialChannelId
    : undefined;
  const materialScopeInput: ChannelInventoryInputs["getChannel"] = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    // The disabled query never reaches the server; an in-schema placeholder keeps
    // the typed query input complete before a channel range is selected.
    id: materialChannelId ?? 1,
  };
  const materialScopeQuery = trpc.channelInventory.getChannel.useQuery(materialScopeInput, {
    enabled: ready && tab === "materials" && materialVisibility === "own" && materialChannelId !== undefined,
    retry: false,
  });
  const materialScopeReady = materialChannelId === undefined
    || materialScopeQuery.data?.id === materialChannelId;

  const materialInput: ChannelInventoryInputs["listSharedMaterials"] = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    partNumber: materialFilters.partNumber.normalize("NFKC").trim() || undefined,
    brand: materialFilters.brand.trim() || undefined,
    page: materialPage,
    pageSize: PAGE_SIZE,
  };
  const materialsQuery = trpc.channelInventory.listSharedMaterials.useQuery(materialInput, {
    enabled: ready && tab === "materials" && materialVisibility === "team",
    retry: false,
  });

  const ownMaterialsQuery = trpc.channelInventory.listMaterials.useQuery({
    ...expectedContext, channelId: materialChannelId,
    partNumber: materialFilters.partNumber.normalize("NFKC").trim() || undefined,
    brand: materialFilters.brand.trim() || undefined, page: materialPage, pageSize: PAGE_SIZE,
  }, { enabled: ready && tab === "materials" && materialVisibility === "own" && materialScopeReady, retry: false });

  const optionQueryInput: ChannelInventoryInputs["listChannels"] = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    page: optionPage,
    pageSize: 100,
  };
  const channelOptionsQuery = trpc.channelInventory.listChannels.useQuery(optionQueryInput, {
    enabled: ready && ((tab === "materials" && materialVisibility === "own") || Boolean(materialEditor) || batchOpen),
    retry: false,
  });

  const createChannel = trpc.channelInventory.createChannel.useMutation();
  const updateChannel = trpc.channelInventory.updateChannel.useMutation();
  const setChannelActive = trpc.channelInventory.setChannelActive.useMutation();
  const createMaterial = trpc.channelInventory.createMaterial.useMutation();
  const updateMaterial = trpc.channelInventory.updateMaterial.useMutation();
  const setMaterialShare = trpc.channelInventory.setMaterialShare.useMutation();
  const shareRequestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  useEffect(() => {
    identityRef.current = identity;
    setChannelPage(1);
    setMaterialPage(1);
    setMaterialVisibility("own");
    shareRequestRef.current = null;
    setOptionPage(1);
    setOptionChannels([]);
    setChannelEditor(null);
    setMaterialEditor(null);
    setBatchOpen(false);
    setNotesMaterial(null);
    setMessage("");
    channelCreateRef.current = null;
    materialCreateRef.current = null;
  }, [identity]);

  useEffect(() => {
    const result = channelOptionsQuery.data;
    if (!result || !ready) return;
    setOptionChannels(current => {
      const next = new Map((result.page === 1 ? [] : current).map(channel => [channel.id, channel]));
      for (const channel of result.items) next.set(channel.id, channel);
      return Array.from(next.values()).sort((left, right) => right.id - left.id);
    });
  }, [channelOptionsQuery.data, ready]);

  const isCurrent = useCallback(() => identityRef.current === identity && Boolean(identity), [identity]);

  const refreshChannels = useCallback(async () => {
    setOptionPage(1); setOptionChannels([]);
    await Promise.allSettled([
      utils.channelInventory.listChannels.invalidate(),
      utils.channelInventory.listSharedMaterials.invalidate(),
      utils.channelInventory.listMaterials.invalidate(),
    ]);
  }, [utils]);

  const refreshMaterials = useCallback(async () => {
    await Promise.allSettled([
      utils.channelInventory.listSharedMaterials.invalidate(),
      utils.channelInventory.listMaterials.invalidate(),
      utils.channelInventory.notesList.invalidate(),
    ]);
  }, [utils]);

  const openChannelCreate = () => {
    channelCreateRef.current = null;
    setChannelForm(EMPTY_CHANNEL_FORM);
    setMessage("");
    setChannelEditor({ mode: "create" });
  };

  const openChannelEdit = (channel: Channel) => {
    if (!channel.canEdit || channel.readOnly) return;
    setChannelForm(channelFormFrom(channel));
    setMessage("");
    setChannelEditor({ mode: "edit", channel });
  };

  const viewChannelMaterials = (channel: Channel) => {
    setMessage("");
    setMaterialVisibility("own");
    setMaterialFilters(current => ({ ...current, channelId: String(channel.id) }));
    setMaterialPage(1);
    setTab("materials");
  };

  const submitChannel = async () => {
    if (!expectedContext || !channelEditor || busy) return;
    const name = channelForm.name.trim();
    if (!name) {
      setMessage("请输入渠道名称。");
      return;
    }
    setBusy("channel");
    setMessage("");
    try {
      if (channelEditor.mode === "create") {
        const candidate: Omit<ChannelInventoryInputs["createChannel"], "requestId"> = {
          ...expectedContext,
          name,
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
      } else {
        await updateChannel.mutateAsync({
          ...expectedContext,
          id: channelEditor.channel.id,
          expectedRevision: channelEditor.channel.revision,
          name,
          type: channelForm.type,
          contactName: toNullable(channelForm.contactName),
          phone: toNullable(channelForm.phone),
          wechat: toNullable(channelForm.wechat),
          qq: toNullable(channelForm.qq),
          notes: toNullable(channelForm.notes),
        });
      }
      if (!isCurrent()) return;
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
    if (!expectedContext || busy || !channel.canEdit || channel.readOnly) return;
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
    materialCreateRef.current = null;
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

  const openMaterialEdit = (material: PrivateMaterial) => {
    if (!material.canEdit || material.readOnly) return;
    setMaterialForm(materialFormFrom(material));
    setMessage("");
    setMaterialEditor({ mode: "edit", material });
  };

  const submitMaterial = async () => {
    if (!expectedContext || !isCurrent() || !materialEditor || busy) return;
    if (ownMaterialsQuery.data?.canWrite !== true || !optionChannels.some(channel => channel.id === Number(materialForm.channelId) && channel.active && channel.canEdit && !channel.readOnly)) {
      setMessage("关联渠道不可写或已停用，请刷新后重试。");
      return;
    }
    const validation = validateMaterialForm(materialForm);
    if (validation.length) {
      setMessage(validation.join("；"));
      return;
    }
    const body = materialInputFromForm(materialForm);
    setBusy("material");
    setMessage("");
    try {
      if (materialEditor.mode === "create") {
        const candidate: Omit<MaterialCreateInput, "requestId"> = { ...expectedContext, ...body };
        const fingerprint = JSON.stringify(candidate);
        let frozen = materialCreateRef.current;
        if (!frozen || frozen.fingerprint !== fingerprint) {
          frozen = { fingerprint, requestId: createRequestId(), payload: { ...candidate, requestId: createRequestId() } };
          frozen.payload.requestId = frozen.requestId;
          materialCreateRef.current = frozen;
        }
        await createMaterial.mutateAsync(frozen.payload);
        materialCreateRef.current = null;
      } else {
        const input: MaterialUpdateInput = {
          ...expectedContext,
          ...body,
          id: materialEditor.material.id,
          expectedRevision: materialEditor.material.revision,
        };
        await updateMaterial.mutateAsync(input);
      }
      if (!isCurrent()) return;
      setMaterialEditor(null);
      await refreshMaterials();
    } catch (error) {
      if (!isCurrent()) return;
      if (materialEditor.mode === "create" && !definitiveWriteFailure(error)) {
        setMessage("保存结果尚未确认。请按原内容重试；系统会使用同一请求号，不会重复创建库存。");
      } else {
        materialCreateRef.current = null;
        setMessage(errorMessage(error, "库存保存失败，请刷新后重试。"));
      }
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const toggleMaterialShare = async (material: PrivateMaterial) => {
    if (!expectedContext || busy || !material.canEdit || material.readOnly) return;
    const enabled = !material.shareEnabled;
    if (!window.confirm(enabled
      ? "确认共享此库存给其归属团队？只公开型号、品牌、数量、报价、税务、批次与交期，不包含渠道来源和任何备注。"
      : "确认撤销团队共享？撤销后同队成员将不能再查看此库存。")) return;
    const payload = { materialId: material.id, enabled, expectedRevision: material.revision };
    const fingerprint = `${identity}:${JSON.stringify(payload)}`;
    if (shareRequestRef.current?.fingerprint !== fingerprint) shareRequestRef.current = { fingerprint, requestId: createRequestId() };
    setBusy("share"); setMessage("");
    try {
      await setMaterialShare.mutateAsync({ ...payload, requestId: shareRequestRef.current.requestId });
      shareRequestRef.current = null;
      if (isCurrent()) await refreshMaterials();
    } catch (error) {
      if (isCurrent()) {
        if (definitiveWriteFailure(error)) shareRequestRef.current = null;
        setMessage(errorMessage(error, "共享设置结果未确认，请按原设置重试。"));
      }
    } finally { if (isCurrent()) setBusy(null); }
  };

  const submitBatchMaterial = async (payload: BatchMaterialPayload, requestId: string) => {
    if (!expectedContext || !isCurrent()) throw new Error("当前企业或账号已变化，请重新打开批量上传。");
    if (ownMaterialsQuery.data?.canWrite !== true || !optionChannels.some(channel => channel.id === payload.channelId && channel.active && channel.canEdit && !channel.readOnly)) throw new Error("关联渠道不可写或已停用，已停止后续上传。");
    return createMaterial.mutateAsync({ ...expectedContext, ...payload, requestId });
  };

  const activeChannels = optionChannels.filter(channel => channel.active && channel.canEdit && !channel.readOnly);
  const channelResult = channelsQuery.data;
  const selectedMaterialsQuery = materialVisibility === "own" ? ownMaterialsQuery : materialsQuery;
  const materialResult = selectedMaterialsQuery.data;
  const materialRows: (PrivateMaterial | SharedMaterial)[] = materialResult?.items ?? [];
  const materialsReady = materialVisibility === "team" || materialScopeReady;
  const canWriteChannels = channelsQuery.data?.canWrite === true;
  const canWriteMaterials = ownMaterialsQuery.data?.canWrite === true;
  const channelPageCount = Math.max(1, channelResult?.pageCount ?? 1);
  const materialPageCount = Math.max(1, Math.ceil((materialResult?.total ?? 0) / PAGE_SIZE));

  if (enterpriseQuery.isLoading) {
    return <section className="ci-page ci-host-state" aria-busy="true">正在核对企业权限…</section>;
  }
  if (enterpriseQuery.isError) {
    return <section className="ci-page ci-host-state ci-host-error" role="alert">企业权限加载失败：{enterpriseQuery.error.message}</section>;
  }
  if (!ready) {
    return (
      <section className="ci-page ci-host-state ci-host-error" role="alert">
        当前账号没有渠道库存管理权限，或尚未选择有效企业。请在原企业工作台完成登录、选企及权限配置后重试。
      </section>
    );
  }

  return (
    <section className="ci-page ci-host" aria-label="渠道库存管理" data-channel-inventory-host>
      <div className="ci-tabbar">
        <div className="ci-tabs" role="tablist" aria-label="渠道库存内容">
          <button type="button" role="tab" aria-selected={tab === "materials"} onClick={() => setTab("materials")}>渠道库存</button>
          <button type="button" role="tab" aria-selected={tab === "channels"} onClick={() => setTab("channels")}>渠道档案</button>
        </div>
        <div className="ci-heading-actions" aria-label="渠道库存操作">
          {tab === "channels" ? (
            <button type="button" className="ci-button ci-primary" disabled={!canWriteChannels} onClick={openChannelCreate}>+ 新增渠道</button>
          ) : materialVisibility === "own" ? (
            <>
              <button type="button" className="ci-button" disabled={!canWriteMaterials} onClick={() => setBatchOpen(true)}>表格上传</button>
              <button type="button" className="ci-button ci-primary" disabled={!canWriteMaterials} onClick={openMaterialCreate}>单条上传</button>
            </>
          ) : null}
        </div>
      </div>

      {message && !materialEditor ? <p className="ci-error" role="alert">{message}</p> : null}

      {tab === "channels" ? (
        <section className="ci-panel" aria-label="渠道管理列表">
          <div className="ci-toolbar">
            <label className="ci-field ci-toolbar-search">
              <span>渠道名称</span>
              <input aria-label="筛选渠道名称" value={channelFilters.name} onChange={event => { setChannelFilters(current => ({ ...current, name: event.target.value })); setChannelPage(1); }} placeholder="搜索渠道名称" />
            </label>
            <label className="ci-field ci-short-select">
              <span>渠道类型</span>
              <select aria-label="筛选渠道类型" value={channelFilters.type} onChange={event => { setChannelFilters(current => ({ ...current, type: event.target.value as ChannelFilters["type"] })); setChannelPage(1); }}>
                <option value="all">全部类型</option>
                {CHANNEL_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <label className="ci-field ci-short-select">
              <span>状态</span>
              <select aria-label="筛选渠道状态" value={channelFilters.active} onChange={event => { setChannelFilters(current => ({ ...current, active: event.target.value as ChannelFilters["active"] })); setChannelPage(1); }}>
                <option value="all">全部状态</option>
                <option value="active">启用</option>
                <option value="inactive">已停用</option>
              </select>
            </label>
            <button type="button" className="ci-button" onClick={() => { setChannelFilters({ name: "", type: "all", active: "all" }); setChannelPage(1); }}>重置</button>
            <span className="ci-filter-count">{channelResult?.total ?? 0} 条渠道</span>
          </div>
          <div className="ci-tablewrap">
            <table className="ci-table ci-channel-table">
              <thead><tr><th className="ci-channel-name-col">渠道名称</th><th className="ci-channel-type-col">类型</th><th className="ci-channel-contact-col">联系人 / 联系方式</th><th className="ci-channel-status-col">状态</th><th className="ci-channel-date-col">更新时间</th><th className="ci-col-actions">操作</th></tr></thead>
              <tbody>
                {channelsQuery.isLoading ? <tr><td colSpan={6} className="ci-empty">正在加载渠道…</td></tr> : null}
                {channelsQuery.isError ? <tr><td colSpan={6} className="ci-empty ci-host-error">{errorMessage(channelsQuery.error, "渠道加载失败。")}</td></tr> : null}
                {!channelsQuery.isLoading && !channelsQuery.isError && !(channelResult?.items.length) ? <tr><td colSpan={6} className="ci-empty">暂无符合筛选条件的渠道。</td></tr> : null}
                {channelResult?.items.map(channel => (
                  <tr key={channel.id}>
                    <td><strong className="ci-channel-name">{channel.name}</strong></td>
                    <td><span className="ci-channel-type-tag">{channelTypeLabel(channel.type)}</span></td>
                    <td><div>{channel.contactName || "—"}</div><small className="ci-subtext">{[channel.phone, channel.wechat ? `微信 ${channel.wechat}` : null, channel.qq ? `QQ ${channel.qq}` : null].filter(Boolean).join(" · ") || "未填写联系方式"}</small></td>
                    <td><span className={channel.active ? "ci-status ci-status-active" : "ci-status ci-status-inactive"}>{activeLabel(channel.active)}</span></td>
                    <td className="ci-date">{displayDate(channel.updatedAt)}</td>
                    <td className="ci-col-actions"><div className="ci-row-actions"><button type="button" className="ci-inline-link" onClick={() => viewChannelMaterials(channel)} disabled={busy !== null}>查看库存</button><button type="button" className="ci-inline-link" onClick={() => openChannelEdit(channel)} disabled={busy !== null || !channel.canEdit}>编辑</button><button type="button" className={channel.active ? "ci-inline-link ci-danger-link" : "ci-inline-link"} onClick={() => void toggleChannel(channel)} disabled={busy !== null || !channel.canEdit}>{channel.active ? "停用" : "启用"}</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={channelPage} pageCount={channelPageCount} total={channelResult?.total ?? 0} onPage={setChannelPage} label="渠道" />
        </section>
      ) : (
        <section className="ci-panel" aria-label="渠道库存列表">
          <div className="ci-tabs" role="tablist" aria-label="库存可见范围">
            <button type="button" role="tab" aria-selected={materialVisibility === "own"} onClick={() => { setMaterialVisibility("own"); setMaterialPage(1); setNotesMaterial(null); }}>本人库存</button>
            <button type="button" role="tab" aria-selected={materialVisibility === "team"} onClick={() => { setMaterialVisibility("team"); setMaterialPage(1); setNotesMaterial(null); setMaterialEditor(null); setBatchOpen(false); }}>团队共享（只读）</button>
          </div>
          <div className="ci-toolbar">
            {materialVisibility === "own" ? <label className="ci-field ci-channel-select"><span>渠道范围</span><select aria-label="筛选库存渠道范围" value={materialFilters.channelId} onChange={event => { setMaterialFilters(current => ({ ...current, channelId: event.target.value })); setMaterialPage(1); setMessage(""); }}><option value="">全部渠道</option>{optionChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}{channel.active ? "" : "（已停用）"}</option>)}</select></label> : null}
            <label className="ci-field ci-toolbar-search"><span>型号</span><input aria-label="筛选库存型号" value={materialFilters.partNumber} onChange={event => { setMaterialFilters(current => ({ ...current, partNumber: event.target.value })); setMaterialPage(1); }} placeholder="搜索型号" /></label>
            <label className="ci-field ci-brand-input"><span>品牌</span><input aria-label="筛选库存品牌" value={materialFilters.brand} onChange={event => { setMaterialFilters(current => ({ ...current, brand: event.target.value })); setMaterialPage(1); }} placeholder="搜索品牌" /></label>
            <button type="button" className="ci-button" onClick={() => { setMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all" }); setMaterialPage(1); setMessage(""); }}>重置</button>
            <span className="ci-filter-count">{materialResult?.total ?? 0} 条库存</span>
          </div>
          <div className="ci-tablewrap ci-compact-tablewrap">
            <table className={`ci-table ci-compact-stock-table ci-stock-edit-table${materialVisibility === "team" ? " ci-shared-stock-table" : ""}`}>
              <thead><tr><th className="ci-col-index">#</th><th className="ci-material-part-col">型号 / 品牌</th><th className="ci-material-qty-col">可供数量</th><th className="ci-material-price-col">报价 CNY</th><th className="ci-material-lead-col">交期</th><th className="ci-material-date-col">Date Code / 更新</th>{materialVisibility === "own" ? <th className="ci-material-notes-col">本人私有备注</th> : null}<th className="ci-col-actions">操作</th></tr></thead>
              <tbody>
                {materialVisibility === "own" && !materialScopeReady && !materialScopeQuery.isError ? <tr><td colSpan={materialVisibility === "own" ? 8 : 7} className="ci-empty">正在验证渠道范围…</td></tr> : null}
                {materialVisibility === "own" && materialScopeQuery.isError ? <tr><td colSpan={materialVisibility === "own" ? 8 : 7} className="ci-empty ci-host-error">{errorMessage(materialScopeQuery.error, "渠道范围不可访问，请重新选择。")}</td></tr> : null}
                {materialsReady && selectedMaterialsQuery.isLoading ? <tr><td colSpan={materialVisibility === "own" ? 8 : 7} className="ci-empty">正在加载渠道库存…</td></tr> : null}
                {materialsReady && selectedMaterialsQuery.isError ? <tr><td colSpan={materialVisibility === "own" ? 8 : 7} className="ci-empty ci-host-error">{errorMessage(selectedMaterialsQuery.error, "渠道库存加载失败。")}</td></tr> : null}
                {materialsReady && !selectedMaterialsQuery.isLoading && !selectedMaterialsQuery.isError && !(materialResult?.items.length) ? <tr><td colSpan={materialVisibility === "own" ? 8 : 7} className="ci-empty">暂无符合筛选条件的渠道库存。</td></tr> : null}
                {materialsReady ? materialRows.map((material, index) => (
                  <tr key={material.id}>
                    <td className="ci-number">{((materialResult?.page ?? 1) - 1) * (materialResult?.pageSize ?? PAGE_SIZE) + index + 1}</td>
                    <td><div className="ci-part-with-type"><strong className="ci-cell-title">{material.partNumber}</strong></div><small className="ci-subtext">{material.brand}</small></td>
                    <td className="ci-number">{material.qty === null ? "待确认" : material.qty.toLocaleString("zh-CN")}</td>
                    <td className="ci-price">{material.price === null ? "面议" : `¥${material.price}`}<small className="ci-subtext">{material.taxIncluded === null ? "税务待确认" : material.taxIncluded ? "含税" : "未税"}</small></td>
                    <td>{material.leadTime || "待确认"}</td>
                    <td className="ci-date"><div>{material.dateCode || "—"}</div><small className="ci-subtext">{displayDate(material.updatedAt)}</small></td>
                    {materialVisibility === "own" ? <td>{"channelId" in material ? <NotesSummaryCompact row={material} onOpen={() => { setMessage(""); setNotesMaterial(material); }} disabled={busy !== null} /> : null}</td> : null}
                    <td className="ci-col-actions"><div className="ci-row-actions">{"channelId" in material && material.canEdit && !material.readOnly ? <><button type="button" className="ci-inline-link" onClick={() => openMaterialEdit(material)} disabled={busy !== null}>编辑</button><button type="button" className="ci-inline-link" onClick={() => void toggleMaterialShare(material)} disabled={busy !== null}>{material.shareEnabled ? "撤销共享" : "共享给同队"}</button></> : <span className="ci-readonly">只读</span>}</div></td>
                  </tr>
                )) : null}
              </tbody>
            </table>
          </div>
          <Pagination page={materialPage} pageCount={materialPageCount} total={materialResult?.total ?? 0} onPage={setMaterialPage} label="渠道库存" />
        </section>
      )}

      {channelEditor ? (
        <div className="ci-modal-backdrop" role="presentation">
          <section className="ci-host-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-channel-editor-title">
            <header><div><h2 id="ci-channel-editor-title">{channelEditor.mode === "create" ? "新增渠道" : "编辑渠道"}</h2><p>渠道负责人、企业归属和审计信息由服务器根据当前权限上下文处理。</p></div><button type="button" className="ci-icon-close" aria-label="关闭渠道编辑" disabled={busy === "channel"} onClick={() => setChannelEditor(null)}>×</button></header>
            <div className="ci-form-grid">
              <label className="ci-field ci-form-wide"><span>渠道名称 *</span><input value={channelForm.name} maxLength={128} onChange={event => setChannelForm(current => ({ ...current, name: event.target.value }))} /></label>
              <label className="ci-field"><span>渠道类型 *</span><select value={channelForm.type} onChange={event => setChannelForm(current => ({ ...current, type: event.target.value as ChannelType }))}>{CHANNEL_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
              <label className="ci-field"><span>联系人</span><input value={channelForm.contactName} maxLength={64} onChange={event => setChannelForm(current => ({ ...current, contactName: event.target.value }))} /></label>
              <label className="ci-field"><span>联系电话</span><input value={channelForm.phone} maxLength={32} onChange={event => setChannelForm(current => ({ ...current, phone: event.target.value }))} /></label>
              <label className="ci-field"><span>微信</span><input value={channelForm.wechat} maxLength={64} onChange={event => setChannelForm(current => ({ ...current, wechat: event.target.value }))} /></label>
              <label className="ci-field"><span>QQ</span><input value={channelForm.qq} maxLength={32} onChange={event => setChannelForm(current => ({ ...current, qq: event.target.value }))} /></label>
              <label className="ci-field ci-form-wide"><span>渠道说明</span><textarea value={channelForm.notes} maxLength={2000} rows={4} onChange={event => setChannelForm(current => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <footer><button type="button" className="ci-button" disabled={busy === "channel"} onClick={() => setChannelEditor(null)}>取消</button><button type="button" className="ci-button ci-primary" disabled={busy === "channel"} onClick={() => void submitChannel()}>{busy === "channel" ? "保存中…" : channelEditor.mode === "create" ? "保存渠道" : "保存修改"}</button></footer>
          </section>
        </div>
      ) : null}

      {materialEditor ? (
        <div className="ci-modal-backdrop" role="presentation">
          <section className="ci-host-dialog ci-host-material-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-material-editor-title">
            <header><div><h2 id="ci-material-editor-title">{materialEditor.mode === "create" ? "单条上传" : "编辑渠道库存"}</h2></div><button type="button" className="ci-icon-close" aria-label="关闭库存编辑" disabled={busy === "material"} onClick={() => setMaterialEditor(null)}>×</button></header>
            {!activeChannels.length ? <p className="ci-error" role="alert">暂无可用渠道。请先创建并启用渠道后再录入库存。</p> : null}
            <div className="ci-form-grid">
              <label className="ci-field"><span>关联渠道 *{materialEditor.mode === "edit" ? "（不可更换）" : ""}</span><select required aria-label="关联渠道" value={materialForm.channelId} disabled={materialEditor.mode === "edit"} onChange={event => setMaterialForm(current => ({ ...current, channelId: event.target.value }))}><option value="">请选择启用渠道</option>{activeChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
              <label className="ci-field"><span>型号 *</span><input required value={materialForm.partNumber} maxLength={128} onChange={event => setMaterialForm(current => ({ ...current, partNumber: event.target.value }))} /></label>
              <label className="ci-field"><span>品牌 *</span><input required value={materialForm.brand} maxLength={64} onChange={event => setMaterialForm(current => ({ ...current, brand: event.target.value }))} /></label>
              <label className="ci-field"><span>可供数量</span><input inputMode="numeric" placeholder="待确认" value={materialForm.qty} onChange={event => setMaterialForm(current => ({ ...current, qty: event.target.value }))} /></label>
              <label className="ci-field"><span>Date Code</span><input maxLength={32} value={materialForm.dateCode} onChange={event => setMaterialForm(current => ({ ...current, dateCode: event.target.value }))} /></label>
              <label className="ci-field"><span>报价 CNY</span><input inputMode="decimal" placeholder="面议" value={materialForm.price} onChange={event => setMaterialForm(current => ({ ...current, price: event.target.value }))} /></label>
              <label className="ci-field"><span>税务口径</span><select value={materialForm.taxIncluded} onChange={event => setMaterialForm(current => ({ ...current, taxIncluded: event.target.value as MaterialForm["taxIncluded"] }))}><option value="unknown">待确认</option><option value="included">含税</option><option value="excluded">未税</option></select></label>
              <label className="ci-field"><span>交期</span><input maxLength={64} placeholder="待确认" value={materialForm.leadTime} onChange={event => setMaterialForm(current => ({ ...current, leadTime: event.target.value }))} /></label>
              <label className="ci-field ci-form-wide"><span>备注（仅本人）</span><textarea placeholder="仅本人可见，不共享" value={materialForm.note} maxLength={2000} rows={2} onChange={event => setMaterialForm(current => ({ ...current, note: event.target.value }))} /></label>
            </div>
            {message ? <p className="ci-error" role="alert">{message}</p> : null}
            <footer><button type="button" className="ci-button" disabled={busy === "material"} onClick={() => setMaterialEditor(null)}>取消</button><button type="button" className="ci-button ci-primary" disabled={busy === "material" || !activeChannels.length} onClick={() => void submitMaterial()}>{busy === "material" ? "保存中…" : materialEditor.mode === "create" ? "上传库存" : "保存修改"}</button></footer>
          </section>
        </div>
      ) : null}

      {batchOpen ? <BatchUpload channels={optionChannels.filter(channel => channel.canEdit && !channel.readOnly).map(channel => ({ id: channel.id, name: channel.name, active: channel.active }))} channelTotal={channelOptionsQuery.data?.total ?? null} enterpriseId={enterpriseId!} actorUserId={actorUserId!} initialChannelId={materialChannelId} onClose={() => setBatchOpen(false)} onDirtyChange={() => undefined} onBusyChange={() => undefined} onLoadMoreChannels={() => { const pages = channelOptionsQuery.data?.pageCount ?? 1; setOptionPage(current => Math.min(pages, current + 1)); }} loadingMoreChannels={channelOptionsQuery.isFetching} onCreate={submitBatchMaterial} onComplete={() => { void refreshMaterials(); }} isCurrent={isCurrent} /> : null}
      {notesMaterial ? <PrivateNotesPanel key={`${identity}:${notesMaterial.id}`} materialId={notesMaterial.id} enterpriseId={enterpriseId!} actorUserId={actorUserId!} isCurrent={isCurrent} onClose={() => setNotesMaterial(null)} onComplete={() => { void refreshMaterials(); }} /> : null}
    </section>
  );
}
