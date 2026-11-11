import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../../../../api/business-trpc";
import { businessIndustryCodeSchema, getBusinessIndustryLabel } from "../../../../shared/businessIndustry";
import { BatchUpload, batchUploadDialogStyle, type BatchUploadDialogControls } from "../channelInventory/BatchUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "../channelInventory/bridge";
import type { BatchEntry } from "../channelInventory/queue";
import { completedSupplyChannel, customerMaterialInput, customerSupplySessionSuffix, supplyLocation, supplyReceipt,
  type SourceProfile, type SupplyContext, type SupplyIdentity, type SupplyOutputs } from "./customerSupply";
import { CustomerSupplySingleEntry } from "./CustomerSupplySingleEntry";
import "./CustomerSupplyUploadDialog.css";

type Channel = SupplyOutputs["getChannel"];
type SessionData = { customerId: number; customerVersion: SupplyContext["customer"]["version"]; sourceProfile?: SourceProfile; initialChannelId?: number; initialChannelRevision?: number; verifiedChannelRevision?: number };
type Props = { customerId: number; identity: SupplyIdentity; isCurrent: () => boolean; onClose: () => void;
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
    && (!profile || (SOURCE_TYPES.includes(profile.type)
      && (profile.existingChannelId === undefined || (Number.isSafeInteger(profile.existingChannelId) && profile.existingChannelId > 0))));
}
function initialSession(customerId: number, context: SupplyContext): SessionData {
  return { customerId, customerVersion: context.customer.version,
    ...(context.channel ? { initialChannelId: context.channel.id, initialChannelRevision: context.channel.revision } : {}),
    ...(!context.channel ? { sourceProfile: { type: "factory" as const } } : {}) };
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
  const viewResults = (entries: BatchEntry[]) => {
    if (!current()) return;
    const channelId = completedSupplyChannel(entries, props.customerId);
    if (!channelId) { setMessage("成功回执渠道不一致，已阻止跳转，请核实原批次。"); return; }
    // Close the real portal before navigating, never on the first successful row.
    props.onComplete(); props.onClose(); navigate(supplyLocation(channelId, "materials"));
  };
  if (!currentRef.current || invalidated) return null;
  const upload = context && sessionData ? <BatchUpload
    key={`${props.identity.key}:${props.customerId}`}
    dialogMode="content" dialogControlsRef={uploadControls}
    channels={context.channel ? [{ id: context.channel.id, name: context.customer.name,
      active: contextAllowed(context, false) && (!chooseExisting || confirmedExisting) && !settingUp }] : []}
    channelTotal={context.channel ? 1 : 0} initialChannelId={context.channel?.id}
    customerSourceReady={contextAllowed(context, false) && (!chooseExisting || confirmedExisting) && !settingUp}
    enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId}
    sourceLabel={context.customer.name} fixedSource
    renderSingleEntry={controls => <CustomerSupplySingleEntry {...controls} />}
    sourceDetails={(!context.channel && !sourceLocked) || message ? <div className="customer-supply-details">
      {!context.channel && !sourceLocked ? <details className="customer-supply-existing">
        <summary>关联现有渠道（可选）</summary>
        <label className="customer-supply-choice"><input type="checkbox" checked={chooseExisting} disabled={settingUp}
          onChange={event => { resetSource(); setChooseExisting(event.target.checked); if (event.target.checked && !optionPage) void loadOptions(); }} />选择现有渠道</label>
        {chooseExisting ? <>
          <label className="ci-field"><span>人工选择现有渠道</span><select aria-label="人工选择现有渠道" disabled={settingUp || loadingOptions} value={existingId}
            onChange={event => { resetSource(); setExistingId(event.target.value); }}><option value="">请选择渠道</option>{options.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · #{channel.id}</option>)}</select></label>
          {optionPage * 100 < optionTotal || (!optionPage && !loadingOptions) ? <button type="button" className="ci-inline-link" disabled={loadingOptions || settingUp} onClick={() => void loadOptions()}>加载更多现有渠道</button> : null}
          <button type="button" className="ci-inline-link" disabled={!existingId || settingUp || confirmedExisting} onClick={() => void confirmExisting()}>{confirmedExisting ? "已确认关联身份" : settingUp ? "正在核验…" : "确认关联此渠道"}</button>
        </> : null}
      </details> : null}
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
      && (!entries.some(entry => entry.status === "success") || (completedSupplyChannel(entries, props.customerId) !== null
        && context.channel?.id === completedSupplyChannel(entries, props.customerId)))}
    onRestoreSession={(data, entries, batch) => {
      if (!validSession(data, props.customerId, context.customer.version)) return;
      frozen.current = data; setSessionData(data); setSourceLocked(true);
      if (entries.length && batch?.id) uploadBatch.current = { channelId: entries[0].payload.channelId, id: batch.id };
      setChooseExisting(false); setConfirmedExisting(false);
    }}
    onClose={props.onClose} onDirtyChange={() => undefined}
    onBusyChange={busy => { if (busy) setSourceLocked(true); }}
    onLoadMoreChannels={() => undefined} loadingMoreChannels={false} isCurrent={current}
    receiptFromResult={response => supplyReceipt(response, props.customerId, uploadBatch.current?.channelId, uploadBatch.current?.id)}
    onCreateCustomerBatch={async input => {
      try {
        const data = frozen.current;
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
          const batch = await utils.client.channelInventory.createCustomerUploadBatch.mutate({ ...expected,
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
            customerMaterialInput(payload, requestId, props.identity, props.customerId, data.customerVersion, data.sourceProfile, uploadBatchId), { signal: abort.signal });
          if (!current()) throw new Error("上传会话已变化，结果待原请求确认。");
          const checked = supplyReceipt(receipt, props.customerId, uploadBatch.current.channelId, uploadBatchId);
          if (receiptsChannel.current && receiptsChannel.current !== checked.channelId) throw new Error("回执渠道身份不一致，请核实原请求。");
          receiptsChannel.current = checked.channelId;
          return receipt;
        } finally { requests.current.delete(abort); }
      } catch (error) { if (current()) props.onAuthorizationError(error); throw error; }
    }}
    onComplete={() => { if (current()) props.onComplete(); }}
    onFinish={result => { if (result.complete && result.entries.length && current()) viewResults(result.entries); }}
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
