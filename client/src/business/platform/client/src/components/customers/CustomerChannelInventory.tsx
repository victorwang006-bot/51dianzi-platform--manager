import React, { useEffect, useMemo, useRef, useState } from "react";
import { createBusinessScopeTrpcClient, trpc } from "../../../../../api/business-trpc";
import { useBusinessScope } from "../../../../../BusinessScope";
import { ChannelInventoryCopyPartNumber, PrivateNotesPanel, createRequestId, definitiveWriteFailure, errorMessage, materialFormFrom, materialInputFromForm, validateMaterialForm } from "../../pages/ChannelInventoryHost";
import type { MaterialForm } from "../../pages/ChannelInventoryMaterialEditPanel";
import { DEFAULT_CHANNEL_INVENTORY_COLUMNS, channelInventoryColumnLayout, channelInventoryMaterialAccess, channelInventoryMaterialEditGranted } from "../../pages/channelInventoryColumns";
import { ChannelReferenceCell } from "../../pages/ChannelReferenceCell";
import { ChannelInventoryManualReferenceFields } from "../../pages/ChannelInventoryManualReferenceFields";
import { manualReferenceDraftFrom, manualReferencePatch, manualReferenceRetentionKey, manualReferenceValidation } from "../../pages/manualReferenceEdit";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";
import { startChannelReferenceRefresh } from "../../pages/ChannelInventoryHost.referenceRefresh";
import type { ChannelReferenceRow } from "@shared/channelReference";
import { CollaborationNotesPanel } from "../channelInventory/CollaborationNotesPanel";
import { ChannelInventoryCustomerSource, ChannelInventorySourcePanel } from "../channelInventory/ChannelInventorySourcePanel";
import { useFactoryMaterialPublish } from "../channelInventory/FactoryMaterialPublish";
import { inventoryError, inventoryRequestId } from "../channelInventory/management";
import type { InventoryCompanyProjection } from "../channelInventory/company";
import type { SupplyIdentity, SupplyInputs, SupplyOutputs } from "./customerSupply";
import "./CustomerChannelInventory.css";

export type CustomerChannelInventoryProps = {
  customerId: number;
  customerVersion?: number;
  selectedBatchId?: number;
  onBatchChange?: (id: number | undefined) => void;
  identity: SupplyIdentity;
  enabled: boolean;
  refreshVersion?: number;
  isCurrent?: () => boolean;
  onAction?: (action: () => void) => void;
  onOpenChange?: (open: boolean) => void;
  onAuthorizationError: (error: unknown) => void;
};
/** Additive contract on the existing listTeamMaterials endpoint; never a parallel table/API. */
export type CustomerInventoryInput = SupplyInputs["listTeamMaterials"] & { customerId: number };
export type CustomerInventoryResult = SupplyOutputs["listTeamMaterials"] & {
  customerId: number;
  customerVersion?: number;
  bindingCount: number;
};
const PAGE_SIZE = 20;
export function customerInventoryInput(identity: SupplyIdentity, customerId: number, filters: { partNumber: string; brand: string; uploadBatchId?: number }, page: number): CustomerInventoryInput {
  return { expectedEnterpriseId: identity.enterpriseId, expectedActorUserId: identity.actorUserId,
    customerId, partNumber: filters.partNumber.normalize("NFKC").trim() || undefined,
    brand: filters.brand.trim() || undefined, ...(filters.uploadBatchId ? { uploadBatchId: filters.uploadBatchId } : {}), page, pageSize: PAGE_SIZE };
}
/** Defense-in-depth on a server-filtered response, not client filtering of a global read. */
export function verifiedCustomerInventory(value: SupplyOutputs["listTeamMaterials"], input: CustomerInventoryInput, version?: number): CustomerInventoryResult {
  const result = value as Partial<CustomerInventoryResult>;
  if (result.customerId !== input.customerId || !Number.isSafeInteger(result.bindingCount) || result.bindingCount! < 0
    || (version !== undefined && result.customerVersion !== undefined && result.customerVersion !== version)
    || result.page !== input.page || result.pageSize !== input.pageSize || !Number.isSafeInteger(result.total) || result.total! < 0
    || !Number.isSafeInteger(result.pageCount) || result.pageCount! < 0
    || result.pageCount !== Math.ceil(result.total! / input.pageSize!)
    || !Array.isArray(result.items) || result.items.length > input.pageSize!
    || (result.bindingCount === 0 && (result.total !== 0 || result.items.length !== 0))
    || result.items.some(row => {
      const company = (row as typeof row & InventoryCompanyProjection).company;
      return !Number.isSafeInteger(row.id) || row.id <= 0 || row.currency !== "CNY" || row.canViewSource !== true
        || (input.uploadBatchId !== undefined && row.uploadBatchId !== input.uploadBatchId)
        || (company != null && company.id !== input.customerId);
    })) {
    throw new Error("客户库存范围未能确认，未展示其他公司的库存。请刷新或联系管理员核实接口版本。");
  }
  return result as CustomerInventoryResult;
}

type Panel = { key: string; kind: "source" | "notes" | "private" | "edit"; id: number; generation: number };
type DeleteOperation = { key: string; generation: number; controller: AbortController; pending: boolean; submitted?: boolean;
  payload?: SupplyInputs["deleteMaterials"]; labels: string[] };
type DeleteState = { key: string; busy: boolean; retryLocked: boolean; message: string; review?: DeleteOperation };
const columnLayout = channelInventoryColumnLayout(DEFAULT_CHANNEL_INVENTORY_COLUMNS, false);
export function CustomerChannelInventory(props: CustomerChannelInventoryProps) {
  const utils = trpc.useUtils();
  const business = useBusinessScope();
  const [filters, setFilters] = useState<{ partNumber: string; brand: string; uploadBatchId?: number }>(() => ({ partNumber: "", brand: "", uploadBatchId: props.selectedBatchId }));
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const editPending = useRef(false);
  const frozen = useRef<SupplyInputs["updateTeamMaterial"] | null>(null);
  const deferredRefresh = useRef(false);
  const deleteOperation = useRef<DeleteOperation | null>(null);
  const [deletion, setDeletion] = useState<DeleteState | null>(null);
  const [selection, setSelection] = useState<{ key: string; ids: number[] }>({ key: "", ids: [] });
  // These refs are authoritative even before busy/retryLocked has rerendered.
  const unresolvedEdit = () => editPending.current || frozen.current !== null || deleteOperation.current !== null;
  const input = useMemo(() => customerInventoryInput(props.identity, props.customerId, filters, page), [props.identity.enterpriseId, props.identity.actorUserId, props.customerId, filters, page]);
  const authorityKey = JSON.stringify([business.storageScope, business.contextVerification?.identity,
    business.contextVerification?.state, business.contextVerification?.authorizationVersion, business.contextVerification?.readVersion,
    business.officialInventoryPermissions, business.frontUser.id, business.staffPrincipal]);
  const scopeKey = JSON.stringify([props.identity.key, props.identity.enterpriseId, props.identity.actorUserId, props.customerId, props.customerVersion, authorityKey]);
  const appliedRefresh = useRef({ scopeKey, version: props.refreshVersion });
  if (appliedRefresh.current.scopeKey !== scopeKey) {
    // Identity, authorization and customer version changes must never be frozen.
    appliedRefresh.current = { scopeKey, version: props.refreshVersion };
    deferredRefresh.current = false;
  } else if (appliedRefresh.current.version !== props.refreshVersion) {
    if (unresolvedEdit()) deferredRefresh.current = true;
    else {
      appliedRefresh.current.version = props.refreshVersion;
      deferredRefresh.current = false; // This reread also covers deferred focus/refresh.
    }
  }
  const key = JSON.stringify([scopeKey, input, revision, appliedRefresh.current.version, props.enabled]);
  const [query, setQuery] = useState<{ key: string; result?: CustomerInventoryResult; error?: string; loading: boolean; proofVersion?: number }>({ key: "", loading: true });
  const [panel, setPanel] = useState<Panel | null>(null);
  const lifecycle = useRef({ mounted: false, key, generation: 0 });
  if (lifecycle.current.key !== key) { lifecycle.current.key = key; lifecycle.current.generation++; }
  const latest = useRef(props); latest.current = props;
  const [batchOptions, setBatchOptions] = useState<{ scope: string; items: SupplyOutputs["listUploadBatches"]["items"]; error?: string }>({ scope: "", items: [] });
  const readable = props.enabled && (props.isCurrent?.() ?? true);
  const result = readable && query.key === key && !query.loading && !query.error ? query.result : undefined;
  const rows = result?.items ?? [];
  const liveRows = useRef(rows); liveRows.current = rows;
  const current = () => lifecycle.current.mounted && latest.current.enabled && (latest.current.isCurrent?.() ?? true)
    && lifecycle.current.key === key;
  const contextVerified = business.contextVerification?.state === "verified"
    && business.contextVerification.identity === business.storageScope
    && business.frontUser.id === props.identity.actorUserId
    && business.staffPrincipal?.frontendUserId === props.identity.actorUserId
    && business.staffPrincipal?.enterpriseId === props.identity.enterpriseId
    && business.officialInventoryPermissions.read === true;
  const materialContext = readable && contextVerified && business.officialInventoryPermissions.write === true && result?.canWrite === true;
  const accessRef = useRef(materialContext); accessRef.current = materialContext;
  const access = (row: (typeof rows)[number]) => channelInventoryMaterialAccess(row, current() && accessRef.current);
  // The native/global permissions can deny, never manufacture a server delete grant.
  const canDelete = (row: (typeof rows)[number]) => access(row) && row.canDelete === true;
  const sourceChannelId = (row: (typeof rows)[number]) => {
    // Native list DTOs expose the real channel under channelSource.id, not the
    // customer's company.id. Accept explicit channelId only when server-returned.
    const projection = row as typeof row & { channelId?: unknown };
    const id = Object.prototype.hasOwnProperty.call(projection, "channelId") ? projection.channelId : row.channelSource?.id;
    return row.canViewSource === true && typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  const deletableRows = rows.filter(canDelete);
  const selectedIds = selection.key === key ? selection.ids.filter(id => deletableRows.some(row => row.id === id)) : [];
  const visibleDeletion = readable && deletion?.key === key ? deletion : null;
  const deleteLocked = Boolean(visibleDeletion?.busy || visibleDeletion?.review || visibleDeletion?.retryLocked);
  const refresh = async () => {
    if (!current()) return;
    if (unresolvedEdit()) { deferredRefresh.current = true; return; }
    deferredRefresh.current = false;
    setRevision(value => value + 1);
  };
  useEffect(() => {
    if (!readable) return;
    const abort = new AbortController();
    setBatchOptions({ scope: scopeKey, items: [] });
    void (async () => {
      try {
        const batches: SupplyOutputs["listUploadBatches"]["items"] = [];
        const ids = new Set<number>();
        let expectedTotal: number | undefined;
        let batchPage = 1;
        do {
          const value = await utils.client.channelInventory.listUploadBatches.query({ expectedEnterpriseId: props.identity.enterpriseId,
            expectedActorUserId: props.identity.actorUserId, customerId: props.customerId, page: batchPage, pageSize: 100 }, { signal: abort.signal });
          if (abort.signal.aborted || !latest.current.enabled || !(latest.current.isCurrent?.() ?? true)) return;
          if (!Number.isSafeInteger(value.total) || value.total < 0 || value.page !== batchPage || value.pageSize !== 100
            || value.pageCount !== Math.ceil(value.total / 100) || !Array.isArray(value.items) || value.items.length > 100
            || (expectedTotal !== undefined && value.total !== expectedTotal)
            || value.items.some(item => !Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id))) throw new Error("批次读取未完成");
          for (const item of value.items) { if (ids.has(item.id)) throw new Error("批次读取未完成"); ids.add(item.id); }
          expectedTotal = value.total;
          batches.push(...value.items);
          if (batchPage >= value.pageCount) break;
          batchPage++;
        } while (true);
        if (batches.length !== expectedTotal) throw new Error("批次读取未完成");
        if (!abort.signal.aborted) setBatchOptions({ scope: scopeKey, items: batches });
      } catch (error) {
        if (!abort.signal.aborted) { latest.current.onAuthorizationError(error); setBatchOptions({ scope: scopeKey, items: [], error: errorMessage(error, "批次读取失败") }); }
      }
    })();
    return () => abort.abort();
  }, [scopeKey, readable, props.refreshVersion]);
  useEffect(() => {
    lifecycle.current.mounted = true;
    return () => { lifecycle.current.mounted = false; lifecycle.current.generation++; };
  }, []);
  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    const generation = lifecycle.current.generation;
    const valid = () => !controller.signal.aborted && current() && lifecycle.current.generation === generation;
    setQuery({ key, loading: true });
    void utils.client.channelInventory.listTeamMaterials.query(input, { signal: controller.signal }).then(value => {
      if (!valid()) return;
      const checked = verifiedCustomerInventory(value, input, props.customerVersion);
      setQuery({ key, result: checked, loading: false, proofVersion: generation });
    }).catch(error => {
      if (!valid()) return;
      props.onAuthorizationError(error);
      setQuery({ key, loading: false, error: inventoryError(error, "读取客户渠道库存失败，请刷新后重试。") });
    });
    return () => controller.abort();
  }, [key, readable, utils, input]);
  useEffect(() => {
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [key]);
  useEffect(() => { setPanel(null); }, [key, readable]);
  useEffect(() => {
    setSelection({ key, ids: [] }); setDeletion(null);
    deleteOperation.current?.controller.abort(); deleteOperation.current = null;
    return () => { deleteOperation.current?.controller.abort(); deleteOperation.current = null; };
  }, [key, readable]);
  const nativeNote = business.officialInventoryPermissions.note === true;
  const nativePublish = business.officialInventoryPermissions.publish === true;
  const context = { expectedEnterpriseId: props.identity.enterpriseId, expectedActorUserId: props.identity.actorUserId };
  const publishing = useFactoryMaterialPublish({ rows, context, scopeKey: key,
    authorized: business.frontUser.role === "user" || business.frontUser.role === "admin",
    available: readable && nativePublish && !query.error && !unresolvedEdit(), proofReady: Boolean(result), proofVersion: query.proofVersion,
    isCurrent: current, onComplete: refresh, onAuthorizationError: props.onAuthorizationError,
    onAction: action => {
      const generation = lifecycle.current.generation;
      const guarded = () => { if (current() && lifecycle.current.generation === generation) action(); };
      props.onAction ? props.onAction(guarded) : guarded();
    } });
  const visiblePanel = panel && panel.key === key && readable && result ? panel : null;
  const panelRow = visiblePanel ? rows.find(row => row.id === visiblePanel.id) : undefined;
  const generation = visiblePanel?.generation;
  const panelCurrent = () => current() && lifecycle.current.generation === generation
    && liveRows.current.some(row => row.id === visiblePanel?.id
      && (visiblePanel.kind !== "source" && visiblePanel.kind !== "edit" || access(row)));
  const modalOpen = Boolean(visiblePanel && panelRow
    && (visiblePanel.kind !== "source" && visiblePanel.kind !== "edit" || access(panelRow)) || publishing.dialog || visibleDeletion?.review);
  const openRef = useRef(false);
  useEffect(() => {
    if (openRef.current !== modalOpen) { openRef.current = modalOpen; latest.current.onOpenChange?.(modalOpen); }
  }, [modalOpen]);
  useEffect(() => () => { if (openRef.current) latest.current.onOpenChange?.(false); openRef.current = false; }, []);
  const act = (action: () => void) => {
    if (!current() || !result || unresolvedEdit() || retryLocked) return;
    const expectedGeneration = lifecycle.current.generation;
    const guarded = () => { if (current() && !unresolvedEdit() && !retryLocked && lifecycle.current.generation === expectedGeneration && liveRows.current.length) action(); };
    props.onAction ? props.onAction(guarded) : guarded();
  };
  const open = (id: number, kind: Panel["kind"]) => act(() => {
    const row = liveRows.current.find(item => item.id === id);
    if (!row || (kind === "source" || kind === "edit") && !access(row)
      || kind === "private" && (!row.isMine || !nativeNote)) return;
    setPanel({ id, kind, key, generation: lifecycle.current.generation });
  });

  // Read saved marketplace references through the same BFF boundary as the Host.
  // The exact customer-scoped list input is mandatory; never fall back to a global page.
  const referenceAllowed = Boolean(result && readable && contextVerified
    && Number.isSafeInteger(business.merchantId) && business.merchantId > 0 && rows.length
    && new Set(rows.map(row => row.id)).size === rows.length);
  const referenceKey = referenceAllowed ? JSON.stringify([key, business.merchantId, rows.map(row => [row.id, row.partNumber, row.brand])]) : "";
  const referenceLive = useRef(referenceKey); referenceLive.current = referenceKey;
  const [references, setReferences] = useState<{ key: string; items: ChannelReferenceRow[] }>({ key: "", items: [] });
  const currentReferences = new Map((referenceAllowed && references.key === referenceKey ? references.items : []).map(row => [row.materialId, row.references]));
  useEffect(() => {
    if (!referenceKey) return;
    const referenceClient = createBusinessScopeTrpcClient(business.merchantId);
    const referenceCurrent = () => current() && referenceLive.current === referenceKey;
    return startChannelReferenceRefresh({
      rows, refresh: false, isCurrent: referenceCurrent,
      lookup: (refresh, signal) => referenceClient.channelReference.lookup.query({ listInput: input, materialIds: rows.map(row => row.id), refresh }, { signal }),
      onData: value => { if (referenceCurrent()) setReferences({ key: referenceKey, items: value.items }); },
      onError: error => { if (referenceCurrent()) { setReferences({ key: referenceKey, items: [] }); latest.current.onAuthorizationError(error); } },
      onBusy: () => undefined, onStopped: () => undefined,
    });
  }, [referenceKey]);

  // Only presentation becomes inline. The Host's validation/manual-price
  // transaction and original live CRM/source/owner grants stay unchanged.
  const [editor, setEditor] = useState<SupplyOutputs["getTeamMaterialForEdit"] | null>(null);
  const [editorKey, setEditorKey] = useState("");
  const [form, setForm] = useState<MaterialForm>(() => materialFormFrom({ channelId: null, partNumber: "", brand: "", qty: null, dateCode: null, price: null, taxIncluded: null, leadTime: null } as SupplyOutputs["getTeamMaterialForEdit"]));
  const [manualDraft, setManualDraft] = useState(() => manualReferenceDraftFrom({}));
  const [confirmation, setConfirmation] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const editRequest = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const update = trpc.channelInventory.updateTeamMaterial.useMutation();
  const remove = trpc.channelInventory.deleteMaterials.useMutation();
  const editingId = visiblePanel?.kind === "edit" && panelRow && access(panelRow) ? panelRow.id : undefined;
  const editingKey = editingId === undefined ? "" : JSON.stringify([key, generation, editingId]);
  const editingLive = useRef(editingKey); editingLive.current = editingKey;
  const editCurrent = () => Boolean(editingKey && editingLive.current === editingKey && panelCurrent());
  const closeEdit = () => { if (editCurrent() && !unresolvedEdit()) setPanel(null); };
  useEffect(() => {
    const request = ++editRequest.current;
    setEditor(null); setEditMessage(""); setEditBusy(false); setRetryLocked(false);
    frozen.current = null; editPending.current = false;
    if (editingId === undefined) return;
    const controller = new AbortController();
    const valid = () => !controller.signal.aborted && editRequest.current === request && editCurrent();
    void utils.client.channelInventory.getTeamMaterialForEdit.query({ ...context, id: editingId }, { signal: controller.signal }).then(detail => {
      if (!valid()) return;
      const row = liveRows.current.find(item => item.id === editingId);
      const projection = detail as typeof detail & { company?: { id: number } | null };
      if (!row || !access(row) || detail.id !== editingId || !channelInventoryMaterialEditGranted(detail)
        || sourceChannelId(row) === null || detail.channelId !== sourceChannelId(row)
        || (Object.prototype.hasOwnProperty.call(projection, "company") && projection.company?.id !== props.customerId)) throw new Error("库存编辑范围或写权限未能确认，请刷新后重试。");
      setEditor(detail); setEditorKey(editingKey); setForm(materialFormFrom(detail)); setManualDraft(manualReferenceDraftFrom(detail)); setConfirmation("");
    }).catch(error => { if (valid()) { latest.current.onAuthorizationError(error); setEditMessage(errorMessage(error, "库存详情读取失败。")); } });
    return () => { controller.abort(); editRequest.current++; };
  }, [editingKey]);
  useEffect(() => {
    // Unknown receipts keep the original UUID/payload. Only a confirmed outcome
    // (or the existing permitted close) releases an ordinary deferred reread.
    if (!editBusy && !retryLocked && !unresolvedEdit() && deferredRefresh.current && current()) void refresh();
  }, [editBusy, retryLocked, editingKey, key, deletion]);
  useEffect(() => {
    // Keep showing/querying the applied batch while an immutable write is unresolved.
    // An external selection is applied only after cancellation or a confirmed receipt.
    if (unresolvedEdit() || filters.uploadBatchId === props.selectedBatchId) return;
    setFilters(value => value.uploadBatchId === props.selectedBatchId ? value : { ...value, uploadBatchId: props.selectedBatchId });
    setPage(1);
  }, [props.selectedBatchId, editBusy, retryLocked, deletion, filters.uploadBatchId]);
  useEffect(() => {
    if (!editor || !editingKey) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [editor, editingKey]);
  const retentionKey = editor ? manualReferenceRetentionKey(editor, form, manualDraft) : "";
  const submitEdit = async () => {
    if (!editCurrent() || !editor || editorKey !== editingKey || !channelInventoryMaterialEditGranted(editor) || editPending.current) return;
    const validation = validateMaterialForm(form, false);
    if (!frozen.current) validation.push(...manualReferenceValidation(manualDraft));
    if (validation.length) { setEditMessage(validation.join("；")); return; }
    if (!frozen.current && retentionKey && confirmation !== retentionKey) return;
    const body = materialInputFromForm(form);
    const payload = frozen.current ?? { ...context, id: editor.id, expectedRevision: editor.revision, requestId: createRequestId(),
      partNumber: body.partNumber, brand: body.brand, qty: body.qty, dateCode: body.dateCode, price: body.price,
      taxIncluded: body.taxIncluded, leadTime: body.leadTime, ...manualReferencePatch(editor, manualDraft) };
    frozen.current = payload;
    const request = editRequest.current;
    const valid = () => editCurrent() && request === editRequest.current;
    editPending.current = true; setEditBusy(true); setEditMessage("");
    try {
      await update.mutateAsync(payload);
    } catch (error) {
      if (!valid()) return;
      latest.current.onAuthorizationError(error);
      if (definitiveWriteFailure(error)) { frozen.current = null; setRetryLocked(false); setEditMessage(errorMessage(error, "库存保存失败，请刷新后重试。")); }
      else { setRetryLocked(true); setEditMessage("保存结果未确认。公共资料已锁定，请按原请求重试，不会重复修改库存。"); }
      return;
    } finally { if (valid()) { editPending.current = false; setEditBusy(false); } }
    if (!valid()) return;
    // A confirmed write is finished before refresh. Neither a rejected cache
    // invalidation nor a failed list reread may freeze/retry this saved UUID.
    frozen.current = null; setRetryLocked(false); setPanel(null);
    const settleRefresh = (action: () => unknown): Promise<unknown> => {
      try { return Promise.resolve(action()); } catch (error) { return Promise.reject(error); }
    };
    // Invalidate only this proven actor/enterprise, including main-Host list
    // variants. A late receipt must never invalidate the next identity's cache.
    await Promise.allSettled([
      settleRefresh(() => utils.channelInventory.listTeamMaterials.invalidate(context)),
      settleRefresh(refresh),
    ]);
  };
  const toggleSelection = (id?: number) => {
    if (!current() || !result || unresolvedEdit() || retryLocked) return;
    const eligible = liveRows.current.filter(canDelete).map(row => row.id);
    if (id !== undefined && !eligible.includes(id)) return;
    setSelection(previous => {
      const prior = previous.key === key ? previous.ids.filter(value => eligible.includes(value)) : [];
      return { key, ids: id === undefined ? eligible.every(value => prior.includes(value)) ? [] : eligible
        : prior.includes(id) ? prior.filter(value => value !== id) : [...prior, id] };
    });
  };
  const deleteCurrent = (operation: DeleteOperation) => deleteOperation.current === operation
    && !operation.controller.signal.aborted && current() && operation.key === key
    && lifecycle.current.generation === operation.generation;
  const prepareDelete = (ids: number[]) => act(() => {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) return;
    const candidates = ids.map(id => liveRows.current.find(row => row.id === id));
    if (candidates.some(row => !row || !canDelete(row))) return;
    const operation: DeleteOperation = { key, generation: lifecycle.current.generation,
      controller: new AbortController(), pending: false, labels: candidates.map(row => row!.partNumber) };
    deleteOperation.current = operation; setPanel(null);
    setDeletion({ key, busy: true, retryLocked: false, message: `正在核验 ${ids.length} 条库存的删除权限和版本…` });
    void (async () => {
      try {
        const items: SupplyInputs["deleteMaterials"]["items"] = [];
        // Never borrow a list revision, another page's IDs, or an owner/admin hint.
        // The existing authenticated detail read re-proves original actor + CRM +
        // industry/share grants; source-bearing channelId is present only on grant.
        for (const id of ids) {
          if (!deleteCurrent(operation)) return;
          const row = liveRows.current.find(item => item.id === id);
          if (!row || !canDelete(row) || sourceChannelId(row) === null) throw new Error("库存删除权限或来源已变化，请刷新后重试。");
          const channelId = sourceChannelId(row);
          const detail = await utils.client.channelInventory.getTeamMaterialForEdit.query({ ...context, id }, { signal: operation.controller.signal });
          if (!deleteCurrent(operation)) return;
          const projection = detail as typeof detail & { canDelete?: unknown; company?: { id: number } | null };
          if (detail.id !== id || !channelInventoryMaterialEditGranted(detail)
            || detail.currency !== "CNY"
            || !Number.isSafeInteger(detail.revision) || detail.revision <= 0
            || !Number.isSafeInteger(detail.channelId) || detail.channelId! <= 0
            || detail.channelId !== channelId || sourceChannelId(row) !== channelId
            || (Object.prototype.hasOwnProperty.call(projection, "canDelete") && projection.canDelete !== true)
            || (Object.prototype.hasOwnProperty.call(projection, "company") && projection.company?.id !== props.customerId)
            || !canDelete(row)) throw new Error("库存删除范围、来源或写权限未能确认，请刷新后重试。");
          items.push({ id, expectedRevision: detail.revision });
        }
        if (!deleteCurrent(operation)) return;
        operation.payload = { ...context, items, requestId: inventoryRequestId() };
        setDeletion({ key, busy: false, retryLocked: false, message: "", review: operation });
      } catch (error) {
        if (!deleteCurrent(operation)) return;
        deleteOperation.current = null; latest.current.onAuthorizationError(error);
        setDeletion({ key, busy: false, retryLocked: false, message: errorMessage(error, "删除权限核验失败，未删除任何库存。") });
      }
    })();
  });
  const cancelDelete = () => {
    const operation = deleteOperation.current;
    if (!operation || !deleteCurrent(operation) || operation.pending || operation.submitted) return;
    operation.controller.abort(); deleteOperation.current = null; setDeletion(null);
  };
  const submitDelete = async () => {
    const operation = deleteOperation.current;
    if (!operation?.payload || !deleteCurrent(operation) || operation.pending
      || operation.payload.items.some(item => !liveRows.current.some(row => row.id === item.id && canDelete(row)))) return;
    const payload = operation.payload;
    operation.pending = true; operation.submitted = true;
    setDeletion({ key, busy: true, retryLocked: false, message: "", review: operation });
    let receipt: SupplyOutputs["deleteMaterials"];
    try {
      receipt = await remove.mutateAsync(payload);
      if (!deleteCurrent(operation)) return;
      // An incomplete/malformed receipt is unknown, never a fabricated success.
      const expected = new Set(payload.items.map(item => item.id));
      if (!receipt || !Array.isArray(receipt.results) || receipt.results.length !== expected.size
        || new Set(receipt.results.map(item => item.id)).size !== expected.size
        || receipt.results.some(item => !expected.has(item.id) || typeof item.success !== "boolean")
        || receipt.deletedCount !== receipt.results.filter(item => item.success).length
        || receipt.skippedCount !== expected.size - receipt.deletedCount) throw new Error("删除回执未能确认");
    } catch (error) {
      if (!deleteCurrent(operation)) return;
      latest.current.onAuthorizationError(error);
      if (definitiveWriteFailure(error)) {
        deleteOperation.current = null;
        setDeletion({ key, busy: false, retryLocked: false, message: errorMessage(error, "删除失败，未移除任何库存。") });
      } else {
        setDeletion({ key, busy: false, retryLocked: true, review: operation,
          message: "删除结果未确认。已锁定原库存和请求号，请按原请求重试；未确认成功的库存不会移除。" });
      }
      return;
    } finally { operation.pending = false; }
    if (!deleteCurrent(operation)) return;
    deleteOperation.current = null;
    const deleted = new Set(receipt.results.filter(item => item.success).map(item => item.id));
    const nextTotal = Math.max(0, result!.total - deleted.size);
    const lastPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
    const failures = receipt.results.filter(item => !item.success);
    setDeletion({ key, busy: false, retryLocked: false,
      message: failures.length ? `已删除 ${deleted.size} 条，${failures.length} 条未删除：${failures.map(item => `${operation.labels[payload.items.findIndex(value => value.id === item.id)]}：${item.reason || "权限或版本已变化，请刷新后重试"}`).join("；")}` : "已删除" });
    // Only confirmed successes on this proven customer's original page disappear.
    // Failed/order-blocked/conflicting rows remain; no optimistic all-row removal.
    setSelection(previous => previous.key === key ? { key, ids: previous.ids.filter(id => !deleted.has(id)) } : previous);
    if (deleted.size) {
      setQuery(previous => {
        if (!deleteCurrentScope() || previous.key !== key || !previous.result) return previous;
        const next = { ...previous.result, items: previous.result.items.filter(row => !deleted.has(row.id)),
          total: previous.result.total - deleted.size };
        return { ...previous, result: { ...next, pageCount: Math.ceil(next.total / PAGE_SIZE) } };
      });
      // Settle cache errors outside the write/retry block. Preserve failed rows;
      // only a now-empty obsolete last page needs an immediate scoped reread.
      await Promise.allSettled([
        Promise.resolve().then(() => { if (deleteCurrentScope()) return utils.channelInventory.listTeamMaterials.invalidate({ ...context, customerId: props.customerId }); }),
        Promise.resolve().then(() => { if (deleteCurrentScope() && page > lastPage && liveRows.current.every(row => deleted.has(row.id))) setPage(lastPage); }),
      ]);
    }
    function deleteCurrentScope() { return current() && lifecycle.current.generation === operation!.generation; }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); if (!current() || unresolvedEdit()) return;
    const next = { partNumber: draft.partNumber.normalize("NFKC").trim(), brand: draft.brand.trim(), uploadBatchId: filters.uploadBatchId };
    setFilters(next); setPage(1);
    if (page === 1 && next.partNumber === filters.partNumber && next.brand === filters.brand) void refresh();
  };
  const loading = readable && (query.key !== key || query.loading);
  const error = readable && query.key === key ? query.error : undefined;
  const change = (field: keyof MaterialForm, value: string, identity = false) => {
    if (!editCurrent() || unresolvedEdit() || retryLocked) return;
    setForm(previous => ({ ...previous, [field]: value }));
    if (identity) setConfirmation("");
  };
  const inlineEditor = editingKey && editCurrent() ? <section ref={dialogRef} className="ci-customer-inline-editor" aria-label="编辑渠道库存"
    onKeyDown={event => { if (event.key === "Escape" && !unresolvedEdit() && !retryLocked && editCurrent()) { event.preventDefault(); closeEdit(); } }}>
    {editor && editorKey === editingKey ? <form onSubmit={event => { event.preventDefault(); void submitEdit(); }}>
      <fieldset className="ci-customer-edit-fields" disabled={editBusy || retryLocked}>
        <label className="ci-field"><span>型号 *</span><input aria-label="编辑库存型号" required value={form.partNumber} maxLength={128} onChange={event => change("partNumber", event.target.value, true)} /></label>
        <label className="ci-field"><span>品牌 *</span><input aria-label="编辑库存品牌" required value={form.brand} maxLength={64} onChange={event => change("brand", event.target.value, true)} /></label>
        <label className="ci-field"><span>可供数量</span><input aria-label="编辑库存数量" inputMode="numeric" placeholder="待确认" value={form.qty} onChange={event => change("qty", event.target.value)} /></label>
        <label className="ci-field"><span>报价 CNY</span><input aria-label="编辑库存价格" inputMode="decimal" placeholder="面议" value={form.price} onChange={event => change("price", event.target.value)} /></label>
      </fieldset>
      <details className="ci-customer-edit-extra" open={Boolean(retentionKey)}>
        <summary>更多字段</summary>
        <fieldset className="ci-customer-edit-fields" disabled={editBusy || retryLocked}>
          <label className="ci-field"><span>Date Code</span><input aria-label="编辑库存DC" maxLength={32} value={form.dateCode} onChange={event => change("dateCode", event.target.value)} /></label>
          <label className="ci-field"><span>交期</span><input aria-label="编辑库存交期" maxLength={64} placeholder="待确认" value={form.leadTime} onChange={event => change("leadTime", event.target.value)} /></label>
          <label className="ci-field"><span>税务口径</span><select aria-label="编辑库存税务口径" value={form.taxIncluded} onChange={event => change("taxIncluded", event.target.value)}><option value="unknown">待确认</option><option value="included">含税</option><option value="excluded">未税</option></select></label>
          <ChannelInventoryManualReferenceFields draft={manualDraft} partNumber={editor.partNumber}
            autoReferences={rows.some(row => row.id === editor.id && row.partNumber === editor.partNumber && row.brand === editor.brand) ? currentReferences.get(editor.id) : undefined}
            locked={editBusy || retryLocked} retentionRequired={Boolean(retentionKey)} retentionConfirmed={Boolean(retentionKey && confirmation === retentionKey)}
            onChange={(field, value) => { if (!editCurrent() || unresolvedEdit() || retryLocked) return; setManualDraft(previous => ({ ...previous, [field]: { value, edited: true } })); setConfirmation(""); }}
            onConfirm={confirmed => { if (editCurrent() && !unresolvedEdit() && !retryLocked) setConfirmation(confirmed ? retentionKey : ""); }} />
        </fieldset>
      </details>
      {editMessage ? <p className="ci-error" role="alert">{editMessage}</p> : null}
      <footer className="ci-customer-edit-footer"><button type="submit" className="ci-button ci-primary" disabled={editBusy} onClick={() => void submitEdit()}>{editBusy ? "保存中…" : retryLocked ? "按原请求重试" : "保存"}</button><button type="button" className="ci-button" aria-label="关闭库存编辑" disabled={editBusy || retryLocked} onClick={closeEdit}>取消</button></footer>
    </form> : <><p className={editMessage ? "ci-error" : "ci-empty"} role={editMessage ? "alert" : "status"}>{editMessage || "正在读取库存编辑权限…"}</p><button type="button" className="ci-button" aria-label="关闭库存编辑" onClick={closeEdit}>取消</button></>}
  </section> : null;
  return <section className="ci-page ci-host ci-panel ci-flat-view customer-channel-inventory" aria-label="客户渠道库存列表">
    <form className="ci-toolbar" onSubmit={submit}>
      <label className="ci-field ci-toolbar-search"><span className="ci-filter-label">型号</span><input aria-label="筛选客户库存型号" placeholder="搜索型号" maxLength={128} disabled={deleteLocked} value={draft.partNumber} onChange={event => { if (!deleteOperation.current) setDraft(value => ({ ...value, partNumber: event.target.value })); }} /></label>
      <label className="ci-field ci-brand-input"><span className="ci-filter-label">品牌</span><input aria-label="筛选客户库存品牌" placeholder="搜索品牌" maxLength={64} disabled={deleteLocked} value={draft.brand} onChange={event => { if (!deleteOperation.current) setDraft(value => ({ ...value, brand: event.target.value })); }} /></label>
      <button type="submit" className="ci-button ci-primary" disabled={!readable || editBusy || retryLocked || deleteLocked}>搜索</button>
      <button type="button" className="ci-button" disabled={!readable || editBusy || retryLocked || deleteLocked} onClick={() => void refresh()}>刷新库存</button>
      {selectedIds.length ? <button type="button" className="ci-button ci-customer-delete" disabled={editBusy || retryLocked || deleteLocked} onClick={() => prepareDelete(selectedIds)}>删除所选（{selectedIds.length}）</button> : null}
      <select className="ci-customer-batch-filter" aria-label="按上传批次查看" value={filters.uploadBatchId ?? ""} disabled={!readable || editBusy || retryLocked || deleteLocked || batchOptions.scope !== scopeKey} onChange={event => {
        if (unresolvedEdit()) return;
        const id = event.target.value ? Number(event.target.value) : undefined;
        if (id !== undefined && !batchOptions.items.some(item => item.id === id)) return;
        props.onBatchChange?.(id); setFilters(value => ({ ...value, uploadBatchId: id })); setPage(1);
      }}><option value="">全部批次</option>{batchOptions.scope === scopeKey ? batchOptions.items.map(batch => <option key={batch.id} value={batch.id}>{new Date(batch.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} · {batch.fileName}</option>) : null}</select>
      <span className="ci-filter-count">{result ? `共 ${result.total} 条` : loading ? "正在读取库存条数…" : "库存条数不可用"}</span>
    </form>
    {batchOptions.scope === scopeKey && batchOptions.error ? <p className="ci-error" role="alert">{batchOptions.error}</p> : null}
    {visibleDeletion ? <div className="ci-customer-delete-status">
      {visibleDeletion.review ? <section role="alertdialog" aria-label="确认删除客户库存" aria-describedby="ci-customer-delete-count" className="ci-customer-delete-review">
        <p id="ci-customer-delete-count">删除选中的 <strong>{visibleDeletion.review.payload?.items.length}</strong> 条物料？</p>
        <p className="ci-customer-delete-models">{visibleDeletion.review.labels.join("、")}</p>
        {visibleDeletion.message ? <p role="alert" className="ci-error">{visibleDeletion.message}</p> : null}
        <div className="ci-customer-delete-buttons"><button type="button" className="ci-button ci-customer-delete" disabled={visibleDeletion.busy} onClick={() => void submitDelete()}>{visibleDeletion.busy ? "删除中…" : visibleDeletion.retryLocked ? "按原请求重试" : "删除"}</button><button type="button" className="ci-button" disabled={visibleDeletion.busy || visibleDeletion.retryLocked} onClick={cancelDelete}>取消</button></div>
      </section> : <p role={visibleDeletion.busy ? "status" : "alert"} className={visibleDeletion.busy ? "" : "ci-error"}>{visibleDeletion.message}</p>}
    </div> : null}
    <div className="ci-tablewrap ci-compact-tablewrap"><table className="ci-table ci-compact-stock-table ci-stock-edit-table admin-table-readable customer-channel-inventory-table" style={{ "--ci-stock-min-width": `${columnLayout.minWidth + 196}px` } as React.CSSProperties}>
      <colgroup><col data-column="selection" style={{ width: 36 }} />{columnLayout.visible.map(column => <React.Fragment key={column.id}>{column.id === "actions" ? <col data-column="publication" style={{ width: 80 }} /> : null}<col data-column={column.id} style={{ width: column.id === "actions" ? column.width + 80 : column.width }} /></React.Fragment>)}</colgroup>
      <thead><tr><th className="ci-customer-selection"><input type="checkbox" aria-label="选择本页可删除库存" checked={Boolean(deletableRows.length && selectedIds.length === deletableRows.length)} disabled={!deletableRows.length || editBusy || retryLocked || deleteLocked} onChange={() => toggleSelection()} /></th><th className="ci-material-part-col">型号</th><th className="ci-material-brand-col">品牌</th><th className="ci-material-recorder-col">负责人</th><th className="ci-material-source-col" title="已确认关联的 CRM 客户；与公共渠道参考独立">来源客户</th><th className="ci-material-qty-col">可供数量</th><th className="ci-material-price-col">报价 CNY</th><th className="ci-material-reference-col" title="立创商城公共网页参考">渠道参考一</th><th className="ci-material-reference-col" title="云汉芯城公共网页参考">渠道参考二</th><th className="ci-publication-col">上架状态</th><th className="ci-col-actions">操作</th></tr></thead>
      <tbody>
        {!readable ? <tr><td colSpan={11} className="ci-empty">正在核验客户库存读取权限…</td></tr> : loading ? <tr><td colSpan={11} className="ci-empty">正在读取客户渠道库存…</td></tr> : error ? <tr><td colSpan={11} className="ci-empty ci-host-error" role="alert">{error}</td></tr> : !result ? <tr><td colSpan={11} className="ci-empty">客户库存范围尚未确认。</td></tr> : !rows.length ? <tr><td colSpan={11} className="ci-empty customer-stock-empty-cell"><div className="customer-stock-empty" role="status"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 8 8-4 8 4v10l-8 4-8-4V8Zm0 0 8 4 8-4m-8 4v10M8 6l8 4" /></svg><div><strong>{result.bindingCount === 0 ? "暂无客户库存" : "暂无符合当前条件的库存"}</strong><p>新库存通过「上传库存表」导入，已有记录可在「上传历史」查看。</p></div></div></td></tr> : null}
        {rows.map(row => {
          const granted = channelInventoryMaterialAccess(row, materialContext);
          return <React.Fragment key={row.id}><tr>
            <td className="ci-customer-selection"><input type="checkbox" aria-label={`选择库存：${row.partNumber}`} checked={selectedIds.includes(row.id)} disabled={!canDelete(row) || editBusy || retryLocked || deleteLocked} onChange={() => toggleSelection(row.id)} /></td>
            <td className="ci-material-part-col"><ChannelInventoryCopyPartNumber partNumber={row.partNumber} resetKey={key} /></td>
            <td className="ci-material-brand-col" title={row.brand}>{row.brand || "—"}</td>
            <td className="ci-material-recorder-col admin-cell-primary" title={row.originalRecorderName ?? "待核实"}>{row.originalRecorderName ?? "待核实"}</td>
            <td className="ci-material-source-col"><ChannelInventoryCustomerSource material={row} contextVerified={granted} /></td>
            <td className="ci-number ci-material-qty-col admin-cell-primary">{row.qty === null ? "待确认" : row.qty.toLocaleString("zh-CN")}</td>
            <td className="ci-price ci-material-price-col admin-cell-primary">{row.price === null ? "面议" : `¥${row.price}`}{typeof row.taxIncluded === "boolean" ? <small className="ci-subtext admin-cell-secondary">{row.taxIncluded ? "含税" : "未税"}</small> : null}</td>
            <td className="ci-material-reference-col" data-reference-source="lcsc"><ChannelReferenceCell key={referenceKey} source="lcsc" partNumber={row.partNumber} manualPrice={row.manualReferenceLcsc} quote={currentReferences.get(row.id)?.lcsc} /></td>
            <td className="ci-material-reference-col" data-reference-source="ickey"><ChannelReferenceCell key={referenceKey} source="ickey" partNumber={row.partNumber} manualPrice={row.manualReferenceIckey} quote={currentReferences.get(row.id)?.ickey} /></td>
            <td className="ci-publication-col"><span className={`ci-publication-status ${publishing.status(row) === "published" ? "is-published" : ""}`}>{publishing.status(row) === "published" ? "已上架" : publishing.status(row) === "unpublished" ? "未上架" : "待核验"}</span></td>
            <td className="ci-col-actions"><div className="ci-row-actions">{publishing.action(row)}<button type="button" className="ci-inline-link ci-edit-entry" aria-label={`编辑库存：${row.partNumber}`} disabled={!granted || editBusy || retryLocked || deleteLocked} title={granted ? "编辑公共库存，可补全型号和品牌" : "只读：当前库存编辑与来源客户授权不可用"} onClick={() => open(row.id, "edit")}>编辑</button><button type="button" className="ci-inline-link ci-customer-delete" aria-label={`删除库存：${row.partNumber}`} disabled={!canDelete(row) || editBusy || retryLocked || deleteLocked} title={canDelete(row) ? "删除本条库存，原上传文件保留" : "只读：服务端未授予库存删除权限"} onClick={() => prepareDelete([row.id])}>删除</button><CustomerInventoryMore row={row} granted={granted} locked={editBusy || retryLocked || deleteLocked} nativeNote={nativeNote} publishing={publishing.previewAction(row)} open={open} /></div></td>
          </tr>{editingId === row.id && inlineEditor ? <tr className="ci-customer-edit-row"><td colSpan={11}>{inlineEditor}</td></tr> : null}</React.Fragment>;
        })}
      </tbody>
    </table></div>
    {result ? <nav className="ci-pagination" aria-label="客户渠道库存分页"><span>共 {result.total} 条，第 {page} / {Math.max(1, result.pageCount)} 页</span><button type="button" className="ci-button" disabled={page <= 1 || editBusy || retryLocked || deleteLocked} onClick={() => { if (current() && !unresolvedEdit()) setPage(value => value - 1); }}>上一页</button><button type="button" className="ci-button" disabled={page >= Math.max(1, result.pageCount) || editBusy || retryLocked || deleteLocked} onClick={() => { if (current() && !unresolvedEdit()) setPage(value => value + 1); }}>下一页</button></nav> : null}
    {publishing.dialog}
    {visiblePanel && panelRow && visiblePanel.kind === "source" && access(panelRow) ? <ChannelInventorySourcePanel key={`${key}:source:${panelRow.id}`} materialId={panelRow.id} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} scopeKey={scopeKey} active={readable && materialContext} isCurrent={panelCurrent} onClose={() => setPanel(null)} onAuthorizationError={props.onAuthorizationError} /> : null}
    {visiblePanel && panelRow && visiblePanel.kind === "notes" ? <CollaborationNotesPanel key={`${key}:notes:${panelRow.id}`} materialId={panelRow.id} partNumber={panelRow.partNumber} brand={panelRow.brand} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} canWriteNote={nativeNote} canAddNote={nativeNote && panelRow.canAddNote} isCurrent={panelCurrent} onClose={() => setPanel(null)} onComplete={() => void refresh()} /> : null}
    {visiblePanel && panelRow && visiblePanel.kind === "private" && panelRow.isMine && nativeNote ? <PrivateNotesPanel key={`${key}:private:${panelRow.id}`} materialId={panelRow.id} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} isCurrent={() => panelCurrent() && liveRows.current.find(row => row.id === panelRow.id)?.isMine === true} onClose={() => setPanel(null)} onComplete={() => void refresh()} /> : null}
  </section>;
}

/** Keep the Host's compact edit/more row; existing customer actions retain their
 * parent onAction guard and source is never offered on a canViewSource hint alone. */
function CustomerInventoryMore({ row, granted, locked, nativeNote, publishing, open }: {
  row: SupplyOutputs["listTeamMaterials"]["items"][number];
  granted: boolean;
  locked: boolean;
  nativeNote: boolean;
  publishing: React.ReactElement<{ children?: React.ReactNode; disabled?: boolean }>;
  open: (id: number, kind: Panel["kind"]) => void;
}) {
  const publishActions = publishing.type === React.Fragment ? publishing.props.children : publishing;
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><button type="button" className="ci-inline-link" disabled={locked} aria-label={`更多库存操作：${row.partNumber}`}>更多</button></DropdownMenuTrigger>
    <DropdownMenuContent className="ci-channel-actions-menu ci-material-actions-menu" align="end" onCloseAutoFocus={event => {
      const dialog = document.querySelector<HTMLElement>('.customer-channel-inventory [role="dialog"]');
      if (!dialog) return;
      event.preventDefault();
      const focused = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement) ? document.activeElement : null;
      setTimeout(() => {
        if (!dialog.isConnected || dialog.contains(document.activeElement)) return;
        (focused?.isConnected ? focused : dialog.querySelector<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') ?? dialog).focus({ preventScroll: true });
      }, 0);
    }}>
      {React.Children.map(publishActions, action => React.isValidElement<{ disabled?: boolean }>(action) ? <DropdownMenuItem asChild disabled={action.props.disabled}>{action}</DropdownMenuItem> : null)}
      <DropdownMenuItem onSelect={() => open(row.id, "notes")}>备注（{row.noteCount}）</DropdownMenuItem>
      {row.isMine && nativeNote ? <DropdownMenuItem aria-label={`本人备注：${row.partNumber}`} onSelect={() => open(row.id, "private")}>本人备注</DropdownMenuItem> : null}
      {granted ? <DropdownMenuItem onSelect={() => open(row.id, "source")}>查看来源</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}
