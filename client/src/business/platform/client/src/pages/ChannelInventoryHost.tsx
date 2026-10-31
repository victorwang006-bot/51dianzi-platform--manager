import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../front-router-types/server/routers";
import { trpc } from "../../../../api/business-trpc";
import { BatchUpload } from "../components/channelInventory/BatchUpload";
import { NotesPanel } from "../components/channelInventory/NotesPanel";
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
  | { mode: "edit"; material: SharedMaterial };

type FrozenCreate<T> = {
  fingerprint: string;
  requestId: string;
  payload: T;
};

const PAGE_SIZE = 20;
const CHANNEL_TYPES: readonly { value: ChannelType; label: string }[] = [
  { value: "factory", label: "原厂" },
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
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function noteTime(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
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

function materialFormFrom(material: SharedMaterial): MaterialForm {
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

  const [tab, setTab] = useState<"channels" | "materials">("channels");
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
  const [notesMaterial, setNotesMaterial] = useState<SharedMaterial | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"channel" | "material" | "status" | null>(null);
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
    enabled: ready && tab === "materials" && materialChannelId !== undefined,
    retry: false,
  });
  const materialScopeReady = materialChannelId === undefined
    || materialScopeQuery.data?.id === materialChannelId;

  const materialInput: ChannelInventoryInputs["listSharedMaterials"] = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    channelId: materialChannelId,
    partNumber: materialFilters.partNumber.normalize("NFKC").trim() || undefined,
    brand: materialFilters.brand.trim() || undefined,
    type: materialFilters.type === "all" ? undefined : materialFilters.type,
    page: materialPage,
    pageSize: PAGE_SIZE,
  };
  const materialsQuery = trpc.channelInventory.listSharedMaterials.useQuery(materialInput, {
    // A selected range is never trusted from the DOM. It must first resolve via
    // getChannel in the current BFF scope before it can constrain the list query.
    enabled: ready && tab === "materials" && materialScopeReady,
    retry: false,
  });

  const optionQueryInput: ChannelInventoryInputs["listChannels"] = {
    expectedEnterpriseId: enterpriseId ?? undefined,
    expectedActorUserId: actorUserId ?? undefined,
    page: optionPage,
    pageSize: 100,
  };
  const channelOptionsQuery = trpc.channelInventory.listChannels.useQuery(optionQueryInput, {
    enabled: ready && (tab === "materials" || Boolean(materialEditor) || batchOpen),
    retry: false,
  });

  const createChannel = trpc.channelInventory.createChannel.useMutation();
  const updateChannel = trpc.channelInventory.updateChannel.useMutation();
  const setChannelActive = trpc.channelInventory.setChannelActive.useMutation();
  const createMaterial = trpc.channelInventory.createMaterial.useMutation();
  const updateMaterial = trpc.channelInventory.updateMaterial.useMutation();

  useEffect(() => {
    identityRef.current = identity;
    setChannelPage(1);
    setMaterialPage(1);
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
      const next = new Map(current.map(channel => [channel.id, channel]));
      for (const channel of result.items) next.set(channel.id, channel);
      return Array.from(next.values()).sort((left, right) => right.id - left.id);
    });
  }, [channelOptionsQuery.data, ready]);

  const isCurrent = useCallback(() => identityRef.current === identity && Boolean(identity), [identity]);

  const refreshChannels = useCallback(async () => {
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
    setChannelForm(channelFormFrom(channel));
    setMessage("");
    setChannelEditor({ mode: "edit", channel });
  };

  const viewChannelMaterials = (channel: Channel) => {
    setMessage("");
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
    if (!expectedContext || busy) return;
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
    const initialChannel = optionChannels.find(channel => channel.active);
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

  const openMaterialEdit = (material: SharedMaterial) => {
    if (material.channelId === null) return;
    setMaterialForm(materialFormFrom(material));
    setMessage("");
    setMaterialEditor({ mode: "edit", material });
  };

  const submitMaterial = async () => {
    if (!expectedContext || !materialEditor || busy) return;
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

  const submitBatchMaterial = async (payload: BatchMaterialPayload, requestId: string) => {
    if (!expectedContext || !isCurrent()) throw new Error("当前企业或账号已变化，请重新打开批量上传。");
    return createMaterial.mutateAsync({ ...expectedContext, ...payload, requestId });
  };

  const activeChannels = optionChannels.filter(channel => channel.active);
  const channelResult = channelsQuery.data;
  const materialResult = materialsQuery.data;
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
      <header className="ci-heading">
        <div className="ci-title-line">
          <h1>渠道库存</h1>
          <p>管理渠道资料与渠道库存。数量、价格和税务口径未确认时会明确保留为待确认，不作换算或推断。</p>
        </div>
        <div className="ci-heading-actions">
          {tab === "channels" ? (
            <button type="button" className="ci-button ci-primary" onClick={openChannelCreate}>+ 新增渠道</button>
          ) : (
            <>
              <button type="button" className="ci-button" onClick={() => setBatchOpen(true)}>批量上传</button>
              <button type="button" className="ci-button ci-primary" onClick={openMaterialCreate}>+ 新增库存</button>
            </>
          )}
        </div>
      </header>

      <div className="ci-tabs" role="tablist" aria-label="渠道库存内容">
        <button type="button" role="tab" aria-selected={tab === "channels"} onClick={() => setTab("channels")}>渠道管理</button>
        <button type="button" role="tab" aria-selected={tab === "materials"} onClick={() => setTab("materials")}>渠道库存</button>
      </div>

      {message ? <p className="ci-error" role="alert">{message}</p> : null}

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
                    <td><strong className="ci-channel-name">{channel.name}</strong><small className="ci-subtext">负责人由服务器按当前业务分工审计</small></td>
                    <td><span className="ci-channel-type-tag">{channelTypeLabel(channel.type)}</span></td>
                    <td><div>{channel.contactName || "—"}</div><small className="ci-subtext">{[channel.phone, channel.wechat ? `微信 ${channel.wechat}` : null, channel.qq ? `QQ ${channel.qq}` : null].filter(Boolean).join(" · ") || "未填写联系方式"}</small></td>
                    <td><span className={channel.active ? "ci-status ci-status-active" : "ci-status ci-status-inactive"}>{activeLabel(channel.active)}</span></td>
                    <td className="ci-date">{displayDate(channel.updatedAt)}</td>
                    <td className="ci-col-actions"><div className="ci-row-actions"><button type="button" className="ci-inline-link" onClick={() => viewChannelMaterials(channel)} disabled={busy !== null}>查看库存</button><button type="button" className="ci-inline-link" onClick={() => openChannelEdit(channel)} disabled={busy !== null}>编辑</button><button type="button" className={channel.active ? "ci-inline-link ci-danger-link" : "ci-inline-link"} onClick={() => void toggleChannel(channel)} disabled={busy !== null}>{channel.active ? "停用" : "启用"}</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={channelPage} pageCount={channelPageCount} total={channelResult?.total ?? 0} onPage={setChannelPage} label="渠道" />
        </section>
      ) : (
        <section className="ci-panel" aria-label="渠道库存列表">
          <div className="ci-toolbar">
            <label className="ci-field ci-channel-select"><span>渠道范围</span><select aria-label="筛选库存渠道范围" value={materialFilters.channelId} onChange={event => { setMaterialFilters(current => ({ ...current, channelId: event.target.value })); setMaterialPage(1); setMessage(""); }}><option value="">全部渠道</option>{optionChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}{channel.active ? "" : "（已停用）"}</option>)}</select></label>
            <label className="ci-field ci-toolbar-search"><span>型号</span><input aria-label="筛选库存型号" value={materialFilters.partNumber} onChange={event => { setMaterialFilters(current => ({ ...current, partNumber: event.target.value })); setMaterialPage(1); }} placeholder="搜索型号" /></label>
            <label className="ci-field ci-brand-input"><span>品牌</span><input aria-label="筛选库存品牌" value={materialFilters.brand} onChange={event => { setMaterialFilters(current => ({ ...current, brand: event.target.value })); setMaterialPage(1); }} placeholder="搜索品牌" /></label>
            <label className="ci-field ci-notes-type-filter"><span>渠道类型</span><select aria-label="筛选库存渠道类型" value={materialFilters.type} onChange={event => { setMaterialFilters(current => ({ ...current, type: event.target.value as MaterialFilters["type"] })); setMaterialPage(1); }}><option value="all">全部类型</option>{CHANNEL_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            <button type="button" className="ci-button" onClick={() => { setMaterialFilters({ channelId: "", partNumber: "", brand: "", type: "all" }); setMaterialPage(1); setMessage(""); }}>重置</button>
            <span className="ci-filter-count">{materialResult?.total ?? 0} 条库存</span>
          </div>
          <div className="ci-tablewrap ci-compact-tablewrap">
            <table className="ci-table ci-compact-stock-table ci-stock-edit-table">
              <thead><tr><th className="ci-col-index">#</th><th className="ci-material-part-col">型号 / 品牌</th><th className="ci-material-type-col">渠道类型</th><th className="ci-material-qty-col">可供数量</th><th className="ci-material-price-col">报价 CNY</th><th className="ci-material-lead-col">交期</th><th className="ci-material-date-col">Date Code / 更新</th><th className="ci-material-notes-col">共享备注</th><th className="ci-col-actions">操作</th></tr></thead>
              <tbody>
                {!materialScopeReady && !materialScopeQuery.isError ? <tr><td colSpan={9} className="ci-empty">正在验证渠道范围…</td></tr> : null}
                {materialScopeQuery.isError ? <tr><td colSpan={9} className="ci-empty ci-host-error">{errorMessage(materialScopeQuery.error, "渠道范围不可访问，请重新选择。")}</td></tr> : null}
                {materialScopeReady && materialsQuery.isLoading ? <tr><td colSpan={9} className="ci-empty">正在加载渠道库存…</td></tr> : null}
                {materialScopeReady && materialsQuery.isError ? <tr><td colSpan={9} className="ci-empty ci-host-error">{errorMessage(materialsQuery.error, "渠道库存加载失败。")}</td></tr> : null}
                {materialScopeReady && !materialsQuery.isLoading && !materialsQuery.isError && !(materialResult?.items.length) ? <tr><td colSpan={9} className="ci-empty">暂无符合筛选条件的渠道库存。</td></tr> : null}
                {materialScopeReady ? materialResult?.items.map((material, index) => (
                  <tr key={material.id}>
                    <td className="ci-number">{(materialResult.page - 1) * materialResult.pageSize + index + 1}</td>
                    <td><div className="ci-part-with-type"><strong className="ci-cell-title">{material.partNumber}</strong></div><small className="ci-subtext">{material.brand}</small></td>
                    <td><span className="ci-channel-type-tag">{channelTypeLabel(material.channelType)}</span>{!material.channelActive ? <small className="ci-subtext">渠道已停用</small> : null}</td>
                    <td className="ci-number">{material.qty === null ? "待确认" : material.qty.toLocaleString("zh-CN")}</td>
                    <td className="ci-price">{material.price === null ? "面议" : `¥${material.price}`}<small className="ci-subtext">{material.taxIncluded === null ? "税务待确认" : material.taxIncluded ? "含税" : "未税"}</small></td>
                    <td>{material.leadTime || "待确认"}</td>
                    <td className="ci-date"><div>{material.dateCode || "—"}</div><small className="ci-subtext">{displayDate(material.updatedAt)}</small></td>
                    <td><NotesSummaryCompact row={{ ...material, latestNote: material.latestNote ? { ...material.latestNote, updatedAt: noteTime(material.latestNote.updatedAt) } : null }} onOpen={() => { setMessage(""); setNotesMaterial(material); }} disabled={busy !== null} /></td>
                    <td className="ci-col-actions"><div className="ci-row-actions">{material.channelId === null ? <span className="ci-readonly">团队共享</span> : <button type="button" className="ci-inline-link" onClick={() => openMaterialEdit(material)} disabled={busy !== null}>编辑</button>}</div></td>
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
            <header><div><h2 id="ci-material-editor-title">{materialEditor.mode === "create" ? "新增渠道库存" : "编辑渠道库存"}</h2><p>空数量记为待确认，空价格记为面议；只支持 CNY，税务口径必须明确选择或保留待确认。</p></div><button type="button" className="ci-icon-close" aria-label="关闭库存编辑" disabled={busy === "material"} onClick={() => setMaterialEditor(null)}>×</button></header>
            {!activeChannels.length ? <p className="ci-error" role="alert">暂无可用渠道。请先创建并启用渠道后再录入库存。</p> : null}
            <div className="ci-form-grid">
              <label className="ci-field ci-form-wide"><span>关联渠道 *</span><select aria-label="关联渠道" value={materialForm.channelId} disabled={materialEditor.mode === "edit" && materialEditor.material.channelId === null} onChange={event => setMaterialForm(current => ({ ...current, channelId: event.target.value }))}><option value="">请选择启用渠道</option>{activeChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
              <label className="ci-field"><span>型号 *</span><input value={materialForm.partNumber} maxLength={128} onChange={event => setMaterialForm(current => ({ ...current, partNumber: event.target.value }))} /></label>
              <label className="ci-field"><span>品牌 *</span><input value={materialForm.brand} maxLength={64} onChange={event => setMaterialForm(current => ({ ...current, brand: event.target.value }))} /></label>
              <label className="ci-field"><span>可供数量</span><input inputMode="numeric" placeholder="留空为待确认" value={materialForm.qty} onChange={event => setMaterialForm(current => ({ ...current, qty: event.target.value }))} /></label>
              <label className="ci-field"><span>Date Code</span><input maxLength={32} value={materialForm.dateCode} onChange={event => setMaterialForm(current => ({ ...current, dateCode: event.target.value }))} /></label>
              <label className="ci-field"><span>报价 CNY</span><input inputMode="decimal" placeholder="留空为面议" value={materialForm.price} onChange={event => setMaterialForm(current => ({ ...current, price: event.target.value }))} /></label>
              <label className="ci-field"><span>税务口径</span><select value={materialForm.taxIncluded} onChange={event => setMaterialForm(current => ({ ...current, taxIncluded: event.target.value as MaterialForm["taxIncluded"] }))}><option value="unknown">待确认</option><option value="included">含税</option><option value="excluded">未税</option></select></label>
              <label className="ci-field ci-form-wide"><span>交期</span><input maxLength={64} placeholder="留空为待确认" value={materialForm.leadTime} onChange={event => setMaterialForm(current => ({ ...current, leadTime: event.target.value }))} /></label>
              <label className="ci-field ci-form-wide"><span>历史库存备注</span><textarea value={materialForm.note} maxLength={2000} rows={3} onChange={event => setMaterialForm(current => ({ ...current, note: event.target.value }))} /><small>团队协作请使用列表中的“共享备注”；这里的历史库存备注不伪造作者或时间。</small></label>
            </div>
            <footer><button type="button" className="ci-button" disabled={busy === "material"} onClick={() => setMaterialEditor(null)}>取消</button><button type="button" className="ci-button ci-primary" disabled={busy === "material" || !activeChannels.length} onClick={() => void submitMaterial()}>{busy === "material" ? "保存中…" : materialEditor.mode === "create" ? "保存库存" : "保存修改"}</button></footer>
          </section>
        </div>
      ) : null}

      {batchOpen ? <BatchUpload channels={optionChannels.map(channel => ({ id: channel.id, name: channel.name, active: channel.active }))} channelTotal={channelOptionsQuery.data?.total ?? null} enterpriseId={enterpriseId!} actorUserId={actorUserId!} onClose={() => setBatchOpen(false)} onDirtyChange={() => undefined} onBusyChange={() => undefined} onLoadMoreChannels={() => { const pages = channelOptionsQuery.data?.pageCount ?? 1; setOptionPage(current => Math.min(pages, current + 1)); }} loadingMoreChannels={channelOptionsQuery.isFetching} onCreate={submitBatchMaterial} onComplete={() => { void refreshMaterials(); }} isCurrent={isCurrent} /> : null}
      {notesMaterial ? <NotesPanel key={`${identity}:${notesMaterial.id}`} materialId={notesMaterial.id} enterpriseId={enterpriseId!} actorUserId={actorUserId!} isCurrent={isCurrent} onClose={() => setNotesMaterial(null)} onDirtyChange={() => undefined} onBusyChange={() => undefined} onComplete={() => { void refreshMaterials(); }} /> : null}
    </section>
  );
}
