import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../../../../api/business-trpc";
import { businessIndustryCodeSchema, getBusinessIndustryLabel } from "../../../../shared/businessIndustry";
import { BatchUpload, batchUploadDialogStyle, type CustomerConfirmRows, type BatchUploadDialogControls } from "../channelInventory/BatchUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "../channelInventory/bridge";
import type { BatchEntry } from "../channelInventory/queue";
import { completedSupplyChannel, customerMaterialInput, customerSupplySessionSuffix, supplyLocation, supplyReceipt,
  type SourceProfile, type SupplyContext, type SupplyIdentity, type SupplyOutputs } from "./customerSupply";
import { normalizeDraft, validateDraft } from "../channelInventory/import";
import type { ConfirmationEntry } from "../../../../shared/customerUploadHistory";
import type { ManagedBatchEntry } from "../channelInventory/management";
import { CustomerParseUpload } from "./CustomerParseUpload";
import { canonicalConfirmationPayload, confirmationIssueResolutions, fileInput, historySession, isUUID, originalReview, recoveryEntries, resultReview, uuid, type History, type HistoryDetail, type HistorySession, type ReviewRow, type Confirmation } from "./customerUploadHistory";
import { CustomerSupplySingleEntry } from "./CustomerSupplySingleEntry";
import { __customerUploadRetry20261119_originalNotSavedAfterRelease } from "./customerUploadOriginalRetry";
import "./CustomerSupplyUploadDialog.css";

type Channel = SupplyOutputs["getChannel"];
type SessionData = { customerId: number; customerVersion: SupplyContext["customer"]["version"]; sourceProfile?: SourceProfile; initialChannelId?: number; initialChannelRevision?: number; verifiedChannelRevision?: number; history?: HistorySession };
type Props = { initialFile?: File; initialHistory?: HistoryDetail; customerId: number; identity: SupplyIdentity; isCurrent: () => boolean; onClose: () => void;
  onComplete: () => void; onAuthorizationError: (error: unknown) => void };
const SOURCE_TYPES = ["factory", "agent", "trade", "other"] as const;

function validSession(value: unknown, customerId: number, version: SessionData["customerVersion"]): value is SessionData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SessionData>;
  const profile = data.sourceProfile;
  // Historical, explicitly confirmed source types remain valid recovery metadata.
  // Never rewrite them: the server checks the original request/type against binding.
  return data.customerId === customerId && data.customerVersion === version
    && (data.initialChannelId === undefined || (Number.isSafeInteger(data.initialChannelId) && data.initialChannelId > 0))
    && [data.initialChannelRevision, data.verifiedChannelRevision].every(value => value === undefined || (Number.isSafeInteger(value) && value > 0))
    && (!data.history || (isUUID(data.history.historyId) && isUUID(data.history.prepareRequestId) && Number.isSafeInteger(data.history.revision) && data.history.revision > 0))
    && (!profile || (SOURCE_TYPES.includes(profile.type)
      && (profile.existingChannelId === undefined || (Number.isSafeInteger(profile.existingChannelId) && profile.existingChannelId > 0))));
}
function initialSession(customerId: number, context: SupplyContext): SessionData {
  return { customerId, customerVersion: context.customer.version,
    ...(context.channel ? { initialChannelId: context.channel.id, initialChannelRevision: context.channel.revision } : {}) };
}

export function CustomerSupplyUploadDialog(props: Props) {
  return <CustomerSupplyUploadSession key={`${props.identity.enterpriseId}:${props.identity.actorUserId}:${props.identity.key}:${props.customerId}`} {...props} />;
}
function CustomerSupplyUploadSession(props: Props) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const uploadControls = useRef<BatchUploadDialogControls | null>(null);
  const [context, setContext] = useState<SupplyContext | null>(null);
  const [message, setMessage] = useState("");
  const [invalidated, setInvalidated] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [chooseExisting, setChooseExisting] = useState(false);
  const [existingId, setExistingId] = useState("");
  const [confirmedExisting, setConfirmedExisting] = useState(false);
  const [options, setOptions] = useState<Channel[]>([]);
  const [optionPage, setOptionPage] = useState(0);
  const [optionTotal, setOptionTotal] = useState(0);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [sourceLocked, setSourceLocked] = useState(false);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [globalResolutions, setGlobalResolutions] = useState<Record<string, string>>({});
  const frozen = useRef<SessionData | null>(null);
  const receiptsChannel = useRef<number | null>(null);
  const uploadBatch = useRef<{ channelId: number; id: number } | null>(null);
  const mounted = useRef(true);
  const currentRef = useRef(false);
  currentRef.current = props.isCurrent() && !invalidated;
  const requests = useRef(new Set<AbortController>());
  const contextRef = useRef(context); contextRef.current = context;
  const current = () => mounted.current && currentRef.current && props.isCurrent();
  const expected = { expectedEnterpriseId: props.identity.enterpriseId, expectedActorUserId: props.identity.actorUserId };
  const invalidate = () => {
    currentRef.current = false;
    setInvalidated(true);
    requests.current.forEach(controller => controller.abort());
    props.onClose();
  };
  const controller = () => { const next = new AbortController(); requests.current.add(next); return next; };
  const readContext = async () => {
    const abort = controller();
    try {
      return await utils.client.channelInventory.customerSupplyContext.query({ ...expected, customerId: props.customerId }, { signal: abort.signal });
    } finally { requests.current.delete(abort); }
  };
  const contextAllowed = (fresh: SupplyContext, checkReceipt = true) => fresh.customer.id === props.customerId
    && !fresh.customer.archivedAt && fresh.canUpload === true
    && businessIndustryCodeSchema.safeParse(fresh.customer.industryCode).success
    && (!fresh.channel || fresh.channel.active)
    && (!frozen.current || (fresh.customer.version === frozen.current.customerVersion
      && (!frozen.current.initialChannelId || (fresh.channel?.id === frozen.current.initialChannelId && fresh.channel.revision === frozen.current.initialChannelRevision))
      && (!frozen.current.verifiedChannelRevision || !fresh.channel || fresh.channel.revision === frozen.current.verifiedChannelRevision)))
    && (!checkReceipt || !receiptsChannel.current || fresh.channel?.id === receiptsChannel.current);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const refresh = async () => {
      setMessage("");
      try {
        const fresh = await readContext();
        if (!alive || !current()) return;
        if (fresh.customer.id !== props.customerId) { invalidate(); return; }
        if (contextRef.current && (!contextAllowed(fresh)
          || fresh.customer.version !== contextRef.current.customer.version
          || (contextRef.current.channel && (fresh.channel?.id !== contextRef.current.channel.id
            || fresh.channel?.revision !== contextRef.current.channel.revision)))) { invalidate(); return; }
        setContext(fresh);
        if (contextAllowed(fresh) && !frozen.current) {
          const data = initialSession(props.customerId, fresh);
          if (props.initialHistory) {
            if (props.initialHistory.history.customerId !== props.customerId || !props.initialHistory.history.capabilities.canConfirm) throw new Error("服务端未允许本账号确认此任务；管理账号不能冒充原上传者。");
            data.history = historySession(props.initialHistory.history);
            data.history.sourceExclusions = props.initialHistory.selectedVersion?.rows.filter(row => row.disposition === "excluded").map(row => ({ logicalRowId: row.logicalRowId, reason: row.excludeReason ?? "", sourceRefs: row.sourceRefs })) ?? [];
            const confirmation = props.initialHistory.confirmation;
            if (confirmation?.entries[0]?.payload.expectedCustomerVersion !== undefined && confirmation.entries[0].payload.expectedCustomerVersion !== fresh.customer.version) throw new Error("原确认客户版本已变化，请核实原批次，不能重建。");
            if (confirmation?.entries[0]?.payload.sourceProfile) { data.sourceProfile = confirmation.entries[0].payload.sourceProfile; }
            if (confirmation) { recoveryEntries(confirmation); data.history.confirmationId = confirmation.confirmationId; }
          }
          frozen.current = data; setSessionData(data);
        }
      } catch (error) {
        if (!alive || !current()) return;
        props.onAuthorizationError(error);
        if (contextRef.current) { invalidate(); return; }
        setMessage(error instanceof Error ? error.message : "无法读取客户供应上传权限。");
      }
    };
    // Initial/identity read or explicit error retry only. Writes recheck below.
    void refresh();
    return () => {
      alive = false; mounted.current = false;
      requests.current.forEach(abort => abort.abort());
      requests.current.clear();
    };
  }, [props.customerId, props.identity.key, contextRevision]);

  const loadOptions = async () => {
    if (!current() || loadingOptions || sourceLocked) return;
    const abort = controller(); setLoadingOptions(true); setMessage("");
    try {
      const result = await utils.client.channelInventory.listChannels.query({ ...expected, active: true, page: optionPage + 1, pageSize: 100 }, { signal: abort.signal });
      if (!current()) return;
      if (!result.canWrite) { invalidate(); return; }
      setOptions(previous => Array.from(new Map([...previous, ...result.items].filter(channel => channel.active && channel.canEdit && !channel.readOnly).map(channel => [channel.id, channel])).values()));
      setOptionPage(result.page); setOptionTotal(result.total);
    } catch (error) {
      if (current()) { props.onAuthorizationError(error); setMessage(error instanceof Error ? error.message : "现有渠道读取失败。"); }
    } finally { requests.current.delete(abort); if (current()) setLoadingOptions(false); }
  };
  const verifyExisting = async (id: number) => {
    const abort = controller();
    try {
      const result = await utils.client.channelInventory.getChannel.query({ ...expected, id }, { signal: abort.signal });
      if (result.id !== id || result.enterpriseId !== props.identity.enterpriseId || !result.active || !result.canEdit || result.readOnly)
        throw new Error("人工选择的渠道不可写或已停用，请刷新后核实。");
      return result;
    } finally { requests.current.delete(abort); }
  };
  const confirmExisting = async () => {
    if (!context || !current() || settingUp || sourceLocked || !chooseExisting || !contextAllowed(context)) return;
    const id = Number(existingId);
    if (!Number.isSafeInteger(id) || id <= 0) { setMessage("请选择本人有权现有渠道，并人工确认关联。"); return; }
    setSettingUp(true); setMessage("");
    try {
      const fresh = await readContext();
      if (!current()) return;
      if (!contextAllowed(fresh) || fresh.customer.version !== context.customer.version || fresh.channel) { invalidate(); return; }
      const chosen = await verifyExisting(id);
      if (!current()) return;
      const type = SOURCE_TYPES.find(value => value === chosen.type);
      if (!type) throw new Error("现有渠道真实类型无效，请核实后重试。");
      const data: SessionData = { customerId: props.customerId, customerVersion: fresh.customer.version,
        sourceProfile: { type, existingChannelId: id }, verifiedChannelRevision: chosen.revision };
      frozen.current = data; setSessionData(data); setContext(fresh); setConfirmedExisting(true);
    } catch (error) {
      if (current()) { props.onAuthorizationError(error); setMessage(error instanceof Error ? error.message : "客户来源核验失败。"); }
    } finally { if (current()) setSettingUp(false); }
  };
  const resetSource = () => {
    if (!context || sourceLocked) return;
    const data = initialSession(props.customerId, context);
    frozen.current = data; setSessionData(data); setConfirmedExisting(false); setMessage("");
  };
  const standardAttachment = useRef<{ history: History; sessionData: SessionData; file: File; rows?: { row: number; metadata: ReviewRow }[] } | null>(null);
  type OriginalLock = { requestId: string; hash: string; mode: "standard" | "parse"; fileName: string; customerVersion: SessionData["customerVersion"] };
  type OriginalSnapshot = { raw: string; lock: OriginalLock };
  const originalOperation = useRef<{ requestId: string; mode: "standard" | "parse"; file: Awaited<ReturnType<typeof fileInput>>; snapshot: OriginalSnapshot } | null>(null);
  const originalInFlight = useRef<{ file: File; mode: "standard" | "parse"; promise: Promise<History> } | null>(null);
  const prepared = useRef<ManagedBatchEntry[] | undefined>(undefined);
  const canonicalEntries = useRef(new Map<string, ConfirmationEntry>(props.initialHistory?.confirmation?.entries.map(entry => [entry.rowRequestId, entry]) ?? []));
  const persistOriginal = (file: File, mode: "standard" | "parse"): Promise<History> => {
    const pending = originalInFlight.current;
    if (pending) return pending.file === file && pending.mode === mode ? pending.promise : Promise.reject(new Error("原文件提交尚在进行，请保留原文件和UUID，不能并发更换上传。"));
    const send = async (): Promise<History> => {
      const data = frozen.current;
      if (!current() || !data) throw new Error("客户上传会话已失效。");
      const encoded = await fileInput(file);
      if (!current()) throw new Error("当前身份已变化。");
      const operationKey = `customer-upload-original:${customerSupplySessionSuffix(props.identity, props.customerId)}`;
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded.base64)))).map(b => b.toString(16).padStart(2, "0")).join("");
      if (!current()) throw new Error("当前身份已变化。");
      const sameLock = (a: OriginalLock, b: OriginalLock) => a.requestId === b.requestId && a.hash === b.hash && a.mode === b.mode && a.fileName === b.fileName && a.customerVersion === b.customerVersion;
      const readLock = (): OriginalSnapshot | null => {
        const raw = sessionStorage.getItem(operationKey);
        if (raw === null) return null;
        const lock: OriginalLock = JSON.parse(raw);
        if (!lock || typeof lock !== "object" || !isUUID(lock.requestId) || typeof lock.hash !== "string" || !/^[0-9a-f]{64}$/.test(lock.hash)
          || !["standard", "parse"].includes(lock.mode) || typeof lock.fileName !== "string" || !lock.fileName.trim()
          || !Number.isSafeInteger(lock.customerVersion) || lock.customerVersion < 0) throw new Error("原文件恢复记录无效，不能重建上传；请核实原请求。");
        return { raw, lock };
      };
      const previous = originalOperation.current;
      if (previous && (previous.file.base64 !== encoded.base64 || previous.file.fileName !== encoded.fileName || previous.mode !== mode || previous.snapshot.lock.customerVersion !== data.customerVersion)) throw new Error("原文件未知请求不能更换字节或UUID。");
      let snapshot: OriginalSnapshot;
      const stored = readLock();
      if (stored) {
        const lock = stored.lock;
        if (lock.hash !== hash || lock.mode !== mode || lock.fileName !== encoded.fileName || lock.customerVersion !== data.customerVersion) throw new Error("另一个原文件提交结果待确认，请恢复原文件/UUID或先核实服务端历史，不能重建上传。");
        if (previous && (previous.requestId !== lock.requestId || previous.snapshot.raw !== stored.raw || !sameLock(previous.snapshot.lock, lock))) throw new Error("原文件恢复锁已变化，不能重建上传。");
        snapshot = stored;
      } else {
        if (previous) throw new Error("原文件恢复锁无法确认，请保留原UUID并核实服务端历史，不能重建上传。");
        const lock: OriginalLock = { requestId: uuid(), hash, mode, fileName: encoded.fileName, customerVersion: data.customerVersion };
        snapshot = { lock, raw: JSON.stringify(lock) };
        // Hold the UUID even when storage throws, silently drops, or replaces this write.
        originalOperation.current = { requestId: lock.requestId, mode, file: encoded, snapshot };
        sessionStorage.setItem(operationKey, snapshot.raw);
        const saved = readLock();
        if (!saved || saved.raw !== snapshot.raw || !sameLock(saved.lock, lock)) throw new Error("无法确认原文件恢复记录已保存，已阻止提交。");
      }
      const requestId = snapshot.lock.requestId;
      const operation = { requestId, mode, file: encoded, snapshot };
      originalOperation.current = operation;
      const ownsRequest = () => current() && frozen.current?.customerVersion === data.customerVersion
        && contextRef.current?.customer.version === data.customerVersion && originalOperation.current === operation && operation.requestId === requestId;
      const release = () => {
        try {
          if (!ownsRequest()) return false;
          const held = readLock();
          if (!held || held.raw !== snapshot.raw || !sameLock(held.lock, snapshot.lock) || !ownsRequest()) return false;
          sessionStorage.removeItem(operationKey);
          if (sessionStorage.getItem(operationKey) !== null || !ownsRequest()) return false;
          originalOperation.current = null;
          return true;
        } catch { return false; }
      };
      const fresh = await readContext();
      if (!ownsRequest() || !contextAllowed(fresh) || fresh.customer.version !== data.customerVersion) throw new Error("客户版本、渠道或上传权限已变化。");
      const abort = controller();
      try {
        let history: History;
        try {
          const result = await utils.client.channelInventory.customerUploadOriginal.mutate({ ...expected, customerId: props.customerId, expectedCustomerVersion: data.customerVersion, mode, file: encoded, requestId }, { signal: abort.signal });
          history = result.history;
        } catch (error) {
          const response = error as { data?: { code?: unknown }; message?: unknown } | null;
          const prefix = "原文件未保存：";
          if (response && typeof response === "object" && response.data?.code === "BAD_REQUEST" && typeof response.message === "string"
            && response.message.startsWith(prefix) && response.message.slice(prefix.length).trim() && release()) {
            throw __customerUploadRetry20261119_originalNotSavedAfterRelease({ message: response.message });
          }
          // Unknown or unowned failures stay unbranded and keep the original lock.
          throw error;
        }
        if (!ownsRequest()) throw new Error("提交结果待原身份核实，请保留原请求。");
        if (!history || history.customerId !== props.customerId || history.mode !== mode || !isUUID(history.historyId)) throw new Error("原文件任务回执身份不匹配。");
        if (!release()) throw new Error("原文件恢复锁未能安全清理，提交结果待核实，请保留原文件和UUID，不能重建上传。");
        if (mode === "standard") { const next = { ...data, history: historySession(history) }; frozen.current = next; setSessionData(next); }
        return history;
      } catch (error) { if (current()) props.onAuthorizationError(error); throw error; }
      finally { requests.current.delete(abort); }
    };
    const slot = { file, mode, promise: undefined as unknown as Promise<History> };
    slot.promise = send().finally(() => { if (originalInFlight.current === slot) originalInFlight.current = null; });
    originalInFlight.current = slot;
    return slot.promise;
  };
  const reconcileQueue = async (entries: ManagedBatchEntry[]): Promise<ManagedBatchEntry[]> => {
    const data = frozen.current;
    if (!data?.history?.confirmationId) return entries;
    if (!current()) throw new Error("上传会话已变化。");
    const abort = controller();
    try {
      const detail = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId: data.history.historyId }, { signal: abort.signal });
      if (!current() || detail.confirmation?.confirmationId !== data.history.confirmationId) throw new Error("服务端原确认映射不匹配。");
      canonicalEntries.current = new Map(detail.confirmation.entries.map(entry => [entry.rowRequestId, entry]));
      const result = await utils.client.channelInventory.customerUploadReconcileBatch.mutate({ ...expected, historyId: data.history.historyId, confirmationId: data.history.confirmationId, requestId: uuid() }, { signal: abort.signal });
      if (!current()) throw new Error("结果待原身份核实。");
      if (result.history.historyId !== data.history.historyId || result.batch.id !== uploadBatch.current?.id) throw new Error("核实结果与原批次不一致。");
      if (result.batch.batchCode !== detail.confirmation.batch.batchCode || result.batch.channelId !== detail.confirmation.batch.channelId) throw new Error("核实结果批次身份与原持久确认不一致。");
      const confirmed = recoveryEntries({ confirmationId: data.history.confirmationId, batchRequestId: detail.confirmation.batchRequestId, batch: result.batch, entries: entries.map((entry, i) => {
        const actual = result.entries.find(row => row.rowRequestId === entry.requestId);
        if (!actual) throw new Error("服务端缺少原UUID核实结果，不能自报成功。");
        const canonical = canonicalEntries.current.get(entry.requestId);
        if (!canonical || canonical.logicalRowId !== actual.logicalRowId || canonical.payload.channelId !== entry.payload.channelId) throw new Error("缺少完整原服务payload映射，不能补造CAS。");
        return { ...canonical, ...actual };
      }) });
      data.history.revision = result.history.revision;
      return confirmed.map((entry, i) => ({ ...entry, row: entries[i].row, ...(entry.status !== "success" && entries[i].error ? { error: entries[i].error } : {}) }));
    } finally { requests.current.delete(abort); }
  };
  const initialRecovery = (() => {
    if (!props.initialHistory?.confirmation || !sessionData) return undefined;
    const confirmation = props.initialHistory.confirmation;
    try { return { channelId: confirmation.batch.channelId, entries: recoveryEntries(confirmation), name: props.initialHistory.history.originalFile.fileName, sessionData,
      skippedRows: confirmation.excludedRows.filter(row => props.initialHistory?.selectedVersion?.rows.some(candidate => candidate.logicalRowId === row.logicalRowId)
        || row.sourceRefs?.some(ref => ref.sheetIndex === 0 && ref.rowNumber > 1)).length,
      uploadBatch: { requestId: confirmation.batchRequestId, id: confirmation.batch.id, batchCode: confirmation.batch.batchCode } }; }
    catch { return undefined; }
  })();
  const complete = () => {
    if (!current()) return;
    // One identity-isolated QueryClient covers global/channel/page inventory keys.
    // Cache refresh failures must never turn an acknowledged receipt into a retry.
    void Promise.allSettled([
      utils.channelInventory.listTeamMaterials.invalidate(),
      utils.channelInventory.listChannels.invalidate(),
      utils.channelInventory.listUploadBatches.invalidate(),
    ]);
    props.onComplete();
  };
  const viewResults = (entries: BatchEntry[]) => {
    if (!current()) return;
    if (!entries.length || entries.some(entry => entry.status !== "success")) { setMessage("仍有结果待确认，请继续原批次。"); return; }
    const channelId = completedSupplyChannel(entries, props.customerId);
    if (!channelId) { setMessage("成功回执渠道不一致，已阻止跳转，请核实原批次。"); return; }
    let location = supplyLocation(channelId, "materials");
    const batchId = (entries[0] as ManagedBatchEntry).uploadBatchId;
    if (Number.isSafeInteger(batchId) && batchId! > 0 && entries.every(entry => {
      if ((entry as ManagedBatchEntry).uploadBatchId !== batchId || entry.payload.channelId !== channelId || entry.receipt?.uploadBatchId !== batchId) return false;
      try { supplyReceipt(entry.receipt, props.customerId, channelId, batchId); return true; }
      catch { return false; }
    })) {
      const [path, search] = location.split("?");
      const params = new URLSearchParams(search); params.set("uploadBatchId", String(batchId));
      location = `${path}?${params.toString()}`;
    }
    // Close the real portal before navigating, never on the first successful row.
    complete(); props.onClose(); navigate(location);
  };
  if (!currentRef.current || invalidated) return null;
  const globalIssuesReady = Boolean(props.initialHistory?.confirmation) || (props.initialHistory?.selectedVersion?.issues ?? []).filter(issue => issue.rowId === null).every(issue => issue.resolved || Boolean(globalResolutions[issue.issueId]?.trim()));
  const customerSourceDisabledReason = context?.customer.archivedAt ? "该客户已归档，不能上传物料表。"
    : context && !businessIndustryCodeSchema.safeParse(context.customer.industryCode).success ? "客户缺少合法所属行业，请先在客户档案补全资料。"
    : context && !context.canUpload ? context.disabledReason || "当前账号没有客户供应上传权限。"
    : context?.channel && !context.channel.active ? "关联渠道已停用，请核实后再上传。"
    : context && !contextAllowed(context, false) ? "客户版本或关联渠道版本已变化，请核实原批次。"
    : chooseExisting && !confirmedExisting ? "请先明确确认所选渠道真实身份。"
    : settingUp ? "正在核验所选渠道，请稍候。"
    : sessionData?.history?.otherSheetCount && !sessionData.history.sourceScopeConfirmed ? "请明确确认本次仅导入首工作表。"
    : !globalIssuesReady ? `请解决全局问题：${(props.initialHistory?.selectedVersion?.issues ?? []).filter(issue => issue.rowId === null && !issue.resolved && !globalResolutions[issue.issueId]?.trim()).map(issue => issue.message).join("；")}` : "";
  const upload = context && sessionData ? <BatchUpload
    key={`${props.identity.key}:${props.customerId}`}
    dialogMode="content" dialogControlsRef={uploadControls}
    skipIssueRows
    initialExcludedRowCount={sessionData.history?.versionId ? sessionData.history.sourceExclusions?.length ?? 0 : 0}
    channels={context.channel ? [{ id: context.channel.id, name: context.customer.name,
      active: contextAllowed(context, false) && (!chooseExisting || confirmedExisting) && !settingUp && globalIssuesReady }] : []}
    channelTotal={context.channel ? 1 : 0} initialChannelId={context.channel?.id}
    customerSourceReady={contextAllowed(context, false) && (!chooseExisting || confirmedExisting) && !settingUp && (!sessionData.history?.otherSheetCount || sessionData.history.sourceScopeConfirmed) && globalIssuesReady}
    customerSourceDisabledReason={customerSourceDisabledReason}
    enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId}
    sourceLabel={context.customer.name} fixedSource
    renderParseEntry={controls => <CustomerParseUpload {...controls} persistOriginal={persistOriginal} isCurrent={current} />}
    onOriginalFilePersist={async file => {
      if (!current() || !frozen.current) throw new Error("客户上传会话已失效。");
      const attachment = standardAttachment.current;
      if (attachment?.file === file && attachment.sessionData.customerVersion !== frozen.current.customerVersion) throw new Error("客户版本已变化，不能复用原上传任务。");
      if (attachment?.file === file && originalOperation.current) throw new Error("另一个原文件提交结果待确认，请保留原文件和UUID，不能更换上传。");
      if (attachment?.file === file && attachment.rows) return { sessionData: frozen.current, rows: attachment.rows };
      const history = props.initialHistory && props.initialFile === file ? props.initialHistory.history : attachment && attachment.file === file ? attachment.history : await persistOriginal(file, "standard");
      if (!attachment || attachment.history.historyId !== history.historyId) standardAttachment.current = { history, sessionData: frozen.current!, file };
      const abort = controller();
      try {
        const detail = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId: history.historyId }, { signal: abort.signal });
        if (!current()) throw new Error("上传会话已变化。");
        const sourceExclusions = detail.originalSheets.flatMap(sheet => sheet.rows.filter(row => sheet.sheetIndex !== 0 || row.rowNumber === 1).map(row => ({ logicalRowId: uuid(), reason: sheet.sheetIndex === 0 ? "标准首表第1行为表头，不作为库存入库" : "员工明确确认：本次标准上传仅首表，此工作表不在本次正式导入范围；完整原表仍保留", sourceRefs: [{ sheetIndex: sheet.sheetIndex, sheetName: sheet.sheetName, rowNumber: row.rowNumber, originalRowHash: row.originalRowHash }] })));
        const data = frozen.current!;
        if (data.history) { data.history.sourceExclusions = sourceExclusions; data.history.otherSheetCount = Math.max(0, detail.originalSheets.length - 1); data.history.sourceScopeConfirmed = detail.originalSheets.length <= 1; }
        frozen.current = data; setSessionData({ ...data });
        const rows = originalReview(detail.originalSheets).map(row => ({ row: row.row, metadata: row }));
        standardAttachment.current = { history, sessionData: data, file, rows };
        return { sessionData: data, rows };
      } finally { requests.current.delete(abort); }
    }}
    initialFile={props.initialFile}
    initialRows={!props.initialHistory?.confirmation && props.initialHistory?.selectedVersion ? resultReview(props.initialHistory.selectedVersion).filter(row => !sessionData.history?.sourceExclusions?.some(excluded => excluded.logicalRowId === row.logicalRowId)).map(row => ({ row: row.row, draft: row.draft, metadata: row })) : undefined}
    initialRecovery={initialRecovery}
    preparedEntries={() => prepared.current}
    reconcileQueue={reconcileQueue}
    renderSingleEntry={controls => <CustomerSupplySingleEntry {...controls} isCurrent={current} />}
    renderConfirmationDetails={() => <>
      {sessionData.history?.sourceExclusions?.length && sessionData.history.versionId ? <details className="ci-dialog-note"><summary>已排除 {sessionData.history.sourceExclusions.length} 条</summary>{sessionData.history.sourceExclusions.map(row => <p key={row.logicalRowId}>{row.sourceRefs.map(ref => `${ref.sheetName} #${ref.rowNumber}`).join("；")}：{row.reason}</p>)}</details> : null}
      {props.initialHistory?.selectedVersion?.issues.filter(issue => issue.rowId === null).map(issue => <label className="ci-field" key={issue.issueId}><span>全局问题：{issue.message}</span><input aria-label={`核对全局问题${issue.issueId}`} maxLength={1000} disabled={sourceLocked || issue.resolved} value={issue.resolved ? issue.resolution ?? "" : globalResolutions[issue.issueId] ?? ""} placeholder="须明确填写人工解决说明；排除行不能代替" onChange={e => { const values = { ...globalResolutions, [issue.issueId]: e.target.value }; const data = { ...frozen.current!, history: { ...frozen.current!.history!, globalResolutions: Object.entries(values).filter(([, resolution]) => resolution.trim()).map(([issueId, resolution]) => ({ issueId, resolution })) } }; frozen.current = data; setSessionData(data); setGlobalResolutions(values); }} /></label>)}
      {sessionData.history?.otherSheetCount ? <label className="ci-dialog-note"><input aria-label="明确确认本次仅导入首工作表" type="checkbox" checked={sessionData.history.sourceScopeConfirmed === true} disabled={sourceLocked} onChange={e => { const data = { ...frozen.current!, history: { ...frozen.current!.history!, sourceScopeConfirmed: e.target.checked } }; frozen.current = data; setSessionData(data); }} />仅导入首表，跳过其余 {sessionData.history.otherSheetCount} 张表；完整原文件保留。</label> : null}
    </>}
    sourceDetails={message ? <div className="customer-supply-details">
      {message ? <p className="ci-error" role="alert">{message}</p> : null}
    </div> : null}
    storageKeySuffix={customerSupplySessionSuffix(props.identity, props.customerId)} sessionData={sessionData}
    validateSavedSession={(data, entries) => validSession(data, props.customerId, context.customer.version)
      && (!(data as SessionData).initialChannelId || ((data as SessionData).initialChannelId === context.channel?.id
        && (data as SessionData).initialChannelRevision === context.channel?.revision))
      && (!(data as SessionData).verifiedChannelRevision || !context.channel || (data as SessionData).verifiedChannelRevision === context.channel.revision)
      // Historical virtual queues have no proven batch association: never backfill them.
      && (!entries.length || entries.every(entry => Number.isSafeInteger((entry as BatchEntry & { uploadBatchId?: number }).uploadBatchId)
        && (entry as BatchEntry & { uploadBatchId?: number }).uploadBatchId! > 0 && entry.payload.channelId === context.channel?.id))
      && (!props.initialHistory || (data as SessionData).history?.historyId === props.initialHistory.history.historyId)
      && (!entries.some(entry => entry.status === "success") || (completedSupplyChannel(entries, props.customerId) !== null
        && context.channel?.id === completedSupplyChannel(entries, props.customerId)))}
    onRestoreSession={(data, entries, batch) => {
      if (!validSession(data, props.customerId, context.customer.version)) return;
      frozen.current = data; setSessionData(data); setSourceLocked(true);
      setGlobalResolutions(Object.fromEntries((data.history?.globalResolutions ?? []).map(issue => [issue.issueId, issue.resolution])));
      if (data.history && entries.length) {
        canonicalEntries.current = new Map(entries.map(entry => {
          const payload = canonicalConfirmationPayload(entry.payload);
          const existing = canonicalEntries.current.get(entry.requestId);
          if (existing) return [entry.requestId, existing];
          // Session queue supplements server persistence, never supplies a new UUID/CAS.
          return [entry.requestId, { rowRequestId: entry.requestId, rowId: "", logicalRowId: "", uploadBatchId: entry.uploadBatchId!, status: entry.status, payload }];
        }));
      }
      if (entries.length && batch?.id) uploadBatch.current = { channelId: entries[0].payload.channelId, id: batch.id };
      setChooseExisting(false); setConfirmedExisting(false);
    }}
    onClose={props.onClose} onDirtyChange={() => undefined}
    onBusyChange={busy => { if (busy) setSourceLocked(true); }}
    onLoadMoreChannels={() => undefined} loadingMoreChannels={false} isCurrent={current}
    receiptFromResult={response => supplyReceipt(response, props.customerId, uploadBatch.current?.channelId, uploadBatch.current?.id)}
    onCreateCustomerBatch={async (input, confirmation) => {
      try {
        const data = frozen.current;
        if (!Number.isSafeInteger(input.totalRows) || input.totalRows < 1 || input.totalRows > 1000
          || (confirmation && (confirmation.confirmedDrafts.length !== input.totalRows || !confirmation.confirmedDrafts.length)))
          throw new Error("没有有效行或导入数量无效，不能准备批次。");
        if (!current() || !data) throw new Error("客户或授权已变化，已停止上传。");
        if (chooseExisting && !confirmedExisting) throw new Error("请先明确确认所选渠道真实身份。");
        const fresh = await readContext();
        if (!current()) throw new Error("上传会话已变化。");
        if (!contextAllowed(fresh) || (data.initialChannelId && fresh.channel?.id !== data.initialChannelId)) {
          invalidate(); throw new Error("客户版本、渠道或上传权限已变化，已停止上传。");
        }
        if (data.sourceProfile?.existingChannelId) {
          const chosen = await verifyExisting(data.sourceProfile.existingChannelId);
          if (chosen.type !== data.sourceProfile.type || (data.verifiedChannelRevision !== undefined && chosen.revision !== data.verifiedChannelRevision)) throw new Error("所选渠道真实类型已变化，请核实原批次。");
        }
        if (!current()) throw new Error("上传会话已变化。");
        const abort = controller();
        try {
          let batch;
          if (data.history && confirmation) {
            if (data.history.otherSheetCount && !data.history.sourceScopeConfirmed) throw new Error("请明确确认本次仅导入首表，不能隐藏其他工作表。");
            if (confirmation.batchRequestId !== input.requestId) throw new Error("确认批次必须沿用原UUID。");
            const detail = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId: data.history.historyId }, { signal: abort.signal });
            if (!current() || !detail.history.capabilities.canConfirm) throw new Error("当前账号不能确认此任务，管理权限不代表可冒充上传者。");
            const toConfirmed = (row: CustomerConfirmRows["confirmedDrafts"][number]) => {
              const metadata = row.metadata as ReviewRow | undefined;
              if (!metadata?.sourceRefs.length || !isUUID(metadata.logicalRowId) || !isUUID(metadata.rowId)) throw new Error("缺少真实来源证据，不能按索引猜测。");
              const draft = normalizeDraft(row.draft);
              if (row.draft.currency !== "CNY" || validateDraft(draft).length) throw new Error("确认字段仍有错误或币种未明确为CNY。");
              return { logicalRowId: metadata.logicalRowId, rowId: metadata.rowId, rowRequestId: row.rowRequestId, sourceRefs: metadata.sourceRefs,
                fields: { partNumber: draft.partNumber, brand: draft.brand, qty: draft.qty === "" ? null : Number(draft.qty), price: draft.price || null, currency: "CNY", taxIncluded: draft.taxIncluded === "true" ? true : draft.taxIncluded === "false" ? false : null, dateCode: draft.dateCode || null, leadTime: draft.leadTime || null, note: draft.note || null } };
            };
            const profile = data.sourceProfile;
            if (profile && !SOURCE_TYPES.includes(profile.type)) throw new Error("客户来源真实类型无效。");
            // These reasons are operation facts, not invented human issue verification.
            const excludedRows = [...(data.history.sourceExclusions ?? []), ...confirmation.excludedRows.map(row => {
              const metadata = row.metadata as ReviewRow;
              if (!isUUID(metadata?.logicalRowId) || !metadata.sourceRefs?.length || !row.reason.trim() || row.reason.length > 1000)
                throw new Error("排除行缺少真实来源证据或操作记录。");
              return { logicalRowId: metadata.logicalRowId, reason: row.reason, sourceRefs: metadata.sourceRefs };
            })];
            const resolvedIssues = confirmationIssueResolutions(detail.selectedVersion, [...confirmation.confirmedDrafts, ...confirmation.excludedRows].map(row => row.metadata as ReviewRow), excludedRows, data.history.globalResolutions);
            const result = await utils.client.channelInventory.customerUploadPrepareConfirmation.mutate({ ...expected, historyId: data.history.historyId, ...(data.history.versionId ? { versionId: data.history.versionId } : {}), expectedRevision: data.history.revision,
              requestId: data.history.prepareRequestId, batchRequestId: confirmation.batchRequestId, expectedCustomerVersion: data.customerVersion,
              ...(data.initialChannelId ? { expectedChannelId: data.initialChannelId } : {}), ...((data.initialChannelRevision ?? data.verifiedChannelRevision) ? { expectedChannelRevision: data.initialChannelRevision ?? data.verifiedChannelRevision } : {}), ...(profile ? { sourceProfile: profile } : {}),
              resolvedIssues, confirmedRows: confirmation.confirmedDrafts.map(toConfirmed), excludedRows }, { signal: abort.signal });
            if (!current()) throw new Error("确认结果待原身份核实，不会更换UUID。");
            // Display code is generated by the old batch service independently from its idempotency UUID.
            if (result.historyId !== data.history.historyId || !isUUID(result.batch.batchCode)) throw new Error("服务端批次任务身份或展示码无效。");
            canonicalEntries.current = new Map(result.entries.map(entry => [entry.rowRequestId, entry]));
            prepared.current = recoveryEntries({ confirmationId: result.confirmationId, batchRequestId: confirmation.batchRequestId, batch: result.batch, entries: result.entries });
            data.history.confirmationId = result.confirmationId; data.history.revision = result.revision;
            frozen.current = data; setSessionData({ ...data }); batch = result.batch;
          } else if (data.history && confirmation === undefined && input.fileName !== "单条手工录入") throw new Error("历史确认缺少冻结原UUID和候选行，不能另建正式批次。");
          else batch = await utils.client.channelInventory.createCustomerUploadBatch.mutate({ ...expected,
            customerId: props.customerId, expectedCustomerVersion: data.customerVersion,
            ...(data.initialChannelId ? { expectedChannelId: data.initialChannelId } : {}),
            ...((data.initialChannelRevision ?? data.verifiedChannelRevision) === undefined ? {} : { expectedChannelRevision: data.initialChannelRevision ?? data.verifiedChannelRevision }),
            ...(data.sourceProfile ? { sourceProfile: data.sourceProfile } : {}), ...input }, { signal: abort.signal });
          if (!current()) throw new Error("上传会话已变化，批次待原请求确认。");
          if (batch.customerId !== props.customerId || !Number.isSafeInteger(batch.channelId) || batch.channelId <= 0
            || !Number.isSafeInteger(batch.id) || batch.id <= 0
            || (fresh.channel && batch.channelId !== fresh.channel.id)
            || (data.sourceProfile?.existingChannelId && batch.channelId !== data.sourceProfile.existingChannelId)
            || (uploadBatch.current && (uploadBatch.current.id !== batch.id || uploadBatch.current.channelId !== batch.channelId)))
            throw new Error("客户批次回执身份不匹配，请按原请求确认，不会新建批次。");
          uploadBatch.current = { channelId: batch.channelId, id: batch.id };
          return batch;
        } finally { requests.current.delete(abort); }
      } catch (error) { if (current()) props.onAuthorizationError(error); throw error; }
    }}
    onCreate={async (payload, requestId, uploadBatchId) => {
      try {
        const data = frozen.current;
        if (!current() || !data) throw new Error("客户或授权已变化，已停止上传。");
        if (uploadBatchId === undefined || uploadBatch.current?.id !== uploadBatchId || uploadBatch.current.channelId !== payload.channelId)
          throw new Error("真实上传批次尚未核验，已阻止无批次提交。");
        if (chooseExisting && !confirmedExisting) throw new Error("请先明确确认所选渠道真实身份。");
        const fresh = await readContext();
        if (!current()) throw new Error("上传会话已变化。");
        if (!contextAllowed(fresh) || fresh.channel?.id !== uploadBatch.current.channelId
          || (context.channel && fresh.channel?.id !== context.channel.id)) {
          invalidate(); throw new Error("客户版本、归档状态、渠道或上传权限已变化，已停止上传。");
        }
        if (data.sourceProfile?.existingChannelId) {
          const chosen = await verifyExisting(data.sourceProfile.existingChannelId);
          if (chosen.type !== data.sourceProfile.type || (data.verifiedChannelRevision !== undefined && chosen.revision !== data.verifiedChannelRevision)) throw new Error("所选渠道真实类型已变化，请核实原批次。");
        }
        if (!current()) throw new Error("上传会话已变化。");
        const abort = controller();
        try {
          const receipt = await utils.client.channelInventory.createCustomerMaterial.mutate(
            (() => {
              if (!data.history?.confirmationId) return customerMaterialInput(payload, requestId, props.identity, props.customerId, data.customerVersion, data.sourceProfile, uploadBatchId);
              const entry = canonicalEntries.current.get(requestId);
              if (!entry) throw new Error("原确认完整payload尚未核实，不能构造新CAS。");
              const canonical = canonicalConfirmationPayload(entry.payload);
              if (canonical.requestId !== requestId || canonical.customerId !== props.customerId || canonical.expectedCustomerVersion !== data.customerVersion || canonical.expectedEnterpriseId !== expected.expectedEnterpriseId || canonical.expectedActorUserId !== expected.expectedActorUserId || canonical.uploadBatchId !== uploadBatchId || canonical.channelId !== payload.channelId) throw new Error("服务端冻结payload/CAS身份不一致，已阻止重建。");
              const keys = ["partNumber", "brand", "qty", "price", "currency", "taxIncluded", "leadTime", "dateCode", "note"] as const;
              if (keys.some(key => canonical[key] !== payload[key])) throw new Error("队列字段与原服务payload不同，不允许unknown改写。");
              const { channelId, ...originalPayload } = canonical;
              return originalPayload;
            })(), { signal: abort.signal });
          if (!current()) throw new Error("上传会话已变化，结果待原请求确认。");
          const checked = supplyReceipt(receipt, props.customerId, uploadBatch.current.channelId, uploadBatchId);
          if (receiptsChannel.current && receiptsChannel.current !== checked.channelId) throw new Error("回执渠道身份不一致，请核实原请求。");
          receiptsChannel.current = checked.channelId;
          return receipt;
        } finally { requests.current.delete(abort); }
      } catch (error) { if (current()) props.onAuthorizationError(error); throw error; }
    }}
    onComplete={complete}
    onViewResults={viewResults}
  /> : null;
  const missingIndustry = context && !businessIndustryCodeSchema.safeParse(context.customer.industryCode).success;
  const disabledReason = context?.customer.archivedAt ? "该客户已归档，不能上传物料表。"
    : missingIndustry ? "客户缺少合法所属行业，请先在客户档案补全资料。"
    : context && !context.canUpload ? context.disabledReason || "当前账号没有客户供应上传权限。"
    : context?.channel && !context.channel.active ? "关联渠道已停用，请核实后再上传。" : "";
  const close = () => { if (uploadControls.current) uploadControls.current.close(); else props.onClose(); };
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="ci-dialog ci-batch-dialog customer-supply-dialog" style={batchUploadDialogStyle}
      data-testid={upload ? "channel-inventory-batch-dialog" : "customer-supply-loading-dialog"}
      aria-describedby={undefined} onEscapeKeyDown={event => uploadControls.current?.onEscapeKeyDown(event)}
      onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader style={{ flex: "0 0 auto" }}><DialogTitle>上传客户物料</DialogTitle></DialogHeader>
      {upload ?? <>
        <div className="customer-supply-loading-body">
          {!context && !message ? <p role="status">正在核验上传权限…</p> : null}
          {context ? <p className="customer-supply-profile">{context.customer.name} · {getBusinessIndustryLabel(context.customer.industryCode)}</p> : null}
          {disabledReason ? <p className="ci-error" role="alert">{disabledReason}{missingIndustry ? <button type="button" className="ci-inline-link" onClick={() => { props.onClose(); navigate(`/customers/${props.customerId}`); }}>补全客户档案</button> : null}</p> : null}
          {message ? <p className="ci-error" role="alert">{message}</p> : null}
        </div>
        <div className="ci-dialog-footer ci-batch-footer"><Button type="button" variant="outline" className="ci-button" onClick={props.onClose}>取消</Button>
          {message || disabledReason ? <Button type="button" className="ci-button" onClick={() => setContextRevision(value => value + 1)}>重试核验</Button> : null}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
