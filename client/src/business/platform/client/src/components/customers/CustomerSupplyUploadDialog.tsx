import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../../../../api/business-trpc";
import { businessIndustryCodeSchema, getBusinessIndustryLabel } from "../../../../shared/businessIndustry";
import { BatchUpload } from "../channelInventory/BatchUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button } from "../channelInventory/bridge";
import type { BatchEntry } from "../channelInventory/queue";
import { completedSupplyChannel, customerMaterialInput, customerSupplySessionSuffix, supplyLocation, supplyReceipt,
  type SourceProfile, type SupplyContext, type SupplyIdentity, type SupplyOutputs } from "./customerSupply";
import "./CustomerSupplyUploadDialog.css";

type Channel = SupplyOutputs["getChannel"];
type SessionData = { customerId: number; customerVersion: SupplyContext["customer"]["version"]; sourceProfile?: SourceProfile };
type Props = { customerId: number; identity: SupplyIdentity; isCurrent: () => boolean; onClose: () => void;
  onComplete: () => void; onAuthorizationError: (error: unknown) => void };
const SOURCE_TYPES = [{ value: "factory", label: "工厂" }, { value: "agent", label: "代理商" },
  { value: "trade", label: "贸易商" }, { value: "other", label: "其他" }] as const;

function validSession(value: unknown, customerId: number, version: SessionData["customerVersion"]): value is SessionData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SessionData>;
  const profile = data.sourceProfile;
  return data.customerId === customerId && data.customerVersion === version
    && (!profile || (SOURCE_TYPES.some(type => type.value === profile.type)
      && (profile.existingChannelId === undefined || (Number.isSafeInteger(profile.existingChannelId) && profile.existingChannelId > 0))));
}

export function CustomerSupplyUploadDialog(props: Props) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [context, setContext] = useState<SupplyContext | null>(null);
  const [message, setMessage] = useState("");
  const [invalidated, setInvalidated] = useState(false);
  const [sourceType, setSourceType] = useState<SourceProfile["type"] | "">("");
  const [chooseExisting, setChooseExisting] = useState(false);
  const [existingId, setExistingId] = useState("");
  const [confirmedExisting, setConfirmedExisting] = useState(false);
  const [options, setOptions] = useState<Channel[]>([]);
  const [optionPage, setOptionPage] = useState(0);
  const [optionTotal, setOptionTotal] = useState(0);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const frozen = useRef<SessionData | null>(null);
  const receiptsChannel = useRef<number | null>(null);
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
  const contextAllowed = (fresh: SupplyContext) => fresh.customer.id === props.customerId
    && !fresh.customer.archivedAt && fresh.canUpload === true
    && businessIndustryCodeSchema.safeParse(fresh.customer.industryCode).success
    && (!fresh.channel || fresh.channel.active)
    && (!frozen.current || fresh.customer.version === frozen.current.customerVersion)
    && (!receiptsChannel.current || fresh.channel?.id === receiptsChannel.current);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const refresh = async () => {
      try {
        const fresh = await readContext();
        if (!alive || !current()) return;
        if (fresh.customer.id !== props.customerId) { invalidate(); return; }
        if (contextRef.current && (!contextAllowed(fresh)
          || fresh.customer.version !== contextRef.current.customer.version
          || (contextRef.current.channel && (fresh.channel?.id !== contextRef.current.channel.id
            || fresh.channel?.revision !== contextRef.current.channel.revision)))) { invalidate(); return; }
        setContext(fresh);
      } catch (error) {
        if (!alive || !current()) return;
        props.onAuthorizationError(error);
        if (contextRef.current) { invalidate(); return; }
        setMessage(error instanceof Error ? error.message : "无法读取客户供应上传权限。");
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      alive = false; mounted.current = false;
      window.removeEventListener("focus", refresh); window.clearInterval(timer);
      requests.current.forEach(abort => abort.abort());
      requests.current.clear();
    };
  }, [props.customerId, props.identity.key]);

  const loadOptions = async () => {
    if (!current() || loadingOptions) return;
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
  const setup = async () => {
    if (!context || !current() || settingUp || !contextAllowed(context)) return;
    if (!context.channel && !sourceType) { setMessage("首次上传必须明确选择渠道类型，不会猜测。"); return; }
    const id = Number(existingId);
    if (!context.channel && chooseExisting && (!confirmedExisting || !Number.isSafeInteger(id) || id <= 0)) {
      setMessage("请选择本人有权现有渠道，并人工确认关联。"); return;
    }
    setSettingUp(true); setMessage("");
    try {
      const fresh = await readContext();
      if (!current()) return;
      if (!contextAllowed(fresh) || fresh.customer.version !== context.customer.version
        || fresh.channel?.id !== context.channel?.id) { invalidate(); return; }
      if (!fresh.channel && chooseExisting) {
        const chosen = await verifyExisting(id);
        if (!current()) return;
        if (chosen.type !== sourceType) throw new Error("所选渠道类型与首次类型不一致，请核实后选择。");
      }
      const data: SessionData = { customerId: props.customerId, customerVersion: fresh.customer.version,
        ...(!fresh.channel && sourceType ? { sourceProfile: { type: sourceType, ...(chooseExisting ? { existingChannelId: id } : {}) } } : {}) };
      frozen.current = data; setSessionData(data); setContext(fresh);
    } catch (error) {
      if (current()) { props.onAuthorizationError(error); setMessage(error instanceof Error ? error.message : "客户来源核验失败。"); }
    } finally { if (current()) setSettingUp(false); }
  };
  const viewResults = (entries: BatchEntry[]) => {
    if (!current()) return;
    const channelId = completedSupplyChannel(entries, props.customerId);
    if (!channelId) { setMessage("成功回执渠道不一致，已阻止跳转，请核实原批次。"); return; }
    // Close the real portal before navigating. No first-success callback may do this.
    props.onComplete(); props.onClose(); navigate(supplyLocation(channelId, "channels"));
  };
  if (!currentRef.current || invalidated) return null;
  if (context && sessionData) return <BatchUpload
    key={`${props.identity.key}:${props.customerId}`}
    channels={[{ id: props.customerId, name: context.customer.name, active: contextAllowed(context) }]}
    channelTotal={1} initialChannelId={props.customerId}
    enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId}
    sourceLabel={context.customer.name} fixedSource
    sourceDetails={<p className="customer-supply-profile">客户档案：{context.customer.name} · {getBusinessIndustryLabel(context.customer.industryCode)}<br />{context.channel ? "复用已绑定渠道" : "首次实际成功后建立关联；取消或全部失败不会创建空渠道"}</p>}
    storageKeySuffix={customerSupplySessionSuffix(props.identity, props.customerId)} sessionData={sessionData}
    validateSavedSession={(data, entries) => validSession(data, props.customerId, context.customer.version)
      && (!entries.some(entry => entry.status === "success") || (completedSupplyChannel(entries, props.customerId) !== null
        && context.channel?.id === completedSupplyChannel(entries, props.customerId)))}
    onRestoreSession={data => {
      if (!validSession(data, props.customerId, context.customer.version)) return;
      frozen.current = data; setSessionData(data);
    }}
    onClose={props.onClose} onDirtyChange={() => undefined} onBusyChange={() => undefined}
    onLoadMoreChannels={() => undefined} loadingMoreChannels={false} isCurrent={current}
    receiptFromResult={response => supplyReceipt(response, props.customerId)}
    onCreate={async (payload, requestId) => {
      const data = frozen.current;
      if (!current() || !data) throw new Error("客户或授权已变化，已停止上传。");
      const fresh = await readContext();
      if (!current()) throw new Error("上传会话已变化。");
      if (!contextAllowed(fresh) || (context.channel && fresh.channel?.id !== context.channel.id)) {
        invalidate(); throw new Error("客户版本、归档状态、渠道或上传权限已变化，已停止上传。");
      }
      if (data.sourceProfile?.existingChannelId) await verifyExisting(data.sourceProfile.existingChannelId);
      if (!current()) throw new Error("上传会话已变化。");
      const abort = controller();
      try {
        const receipt = await utils.client.channelInventory.createCustomerMaterial.mutate(
          customerMaterialInput(payload, requestId, props.identity, props.customerId, data.customerVersion, data.sourceProfile), { signal: abort.signal });
        if (!current()) throw new Error("上传会话已变化，结果待原请求确认。");
        const checked = supplyReceipt(receipt, props.customerId);
        if (receiptsChannel.current && receiptsChannel.current !== checked.channelId) throw new Error("回执渠道身份不一致，请核实原请求。");
        receiptsChannel.current = checked.channelId;
        return receipt;
      } catch (error) { if (current()) props.onAuthorizationError(error); throw error; }
      finally { requests.current.delete(abort); }
    }}
    onComplete={() => { if (current()) props.onComplete(); }}
    onFinish={result => { if (result.complete && result.entries.length && current()) viewResults(result.entries); }}
    onViewResults={viewResults}
  />;
  const missingIndustry = context && !businessIndustryCodeSchema.safeParse(context.customer.industryCode).success;
  const disabledReason = context?.customer.archivedAt ? "该客户已归档，不能上传物料表。"
    : missingIndustry ? "客户缺少合法所属行业，请先在客户档案补全资料。"
    : context && !context.canUpload ? context.disabledReason || "当前账号没有客户供应上传权限。"
    : context?.channel && !context.channel.active ? "关联渠道已停用，请核实后再上传。" : "";
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}>
    <DialogContent className="ci-dialog customer-supply-dialog" onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>上传客户物料表</DialogTitle><DialogDescription>沿用客户公司资料，不重复维护名称、行业或联系人，不按同名渠道自动关联。</DialogDescription></DialogHeader>
      {!context && !message ? <p role="status">正在核验客户档案与上传权限…</p> : null}
      {context ? <>
        <p className="customer-supply-profile">{context.customer.name} · {getBusinessIndustryLabel(context.customer.industryCode)}</p>
        {disabledReason ? <p className="ci-error" role="alert">{disabledReason}{missingIndustry ? <button type="button" className="ci-inline-link" onClick={() => { props.onClose(); navigate(`/customers/${props.customerId}`); }}>补全客户档案</button> : null}</p> : context.channel ? <p>将复用已绑定渠道，无需重选类型。</p> : <>
          <label className="ci-field"><span>首次渠道类型 *</span><select aria-label="首次渠道类型" value={sourceType} disabled={settingUp} onChange={event => { const choice = SOURCE_TYPES.find(type => type.value === event.target.value); setSourceType(choice?.value ?? ""); }}><option value="">请明确选择渠道类型</option>{SOURCE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label className="customer-supply-choice"><input type="checkbox" checked={chooseExisting} disabled={settingUp} onChange={event => { setChooseExisting(event.target.checked); setConfirmedExisting(false); if (event.target.checked && !optionPage) void loadOptions(); }} />人工关联本人有权现有渠道（可选）</label>
          {chooseExisting ? <>
            <label className="ci-field"><span>人工选择现有渠道</span><select aria-label="人工选择现有渠道" disabled={settingUp || loadingOptions} value={existingId} onChange={event => { setExistingId(event.target.value); setConfirmedExisting(false); }}><option value="">请选择，不会按客户名称猜测</option>{options.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · #{channel.id}</option>)}</select></label>
            {optionPage * 100 < optionTotal ? <button type="button" className="ci-inline-link" disabled={loadingOptions} onClick={() => void loadOptions()}>加载更多现有渠道</button> : null}
            <label className="customer-supply-choice"><input type="checkbox" disabled={!existingId || settingUp} checked={confirmedExisting} onChange={event => setConfirmedExisting(event.target.checked)} />我已核实该渠道真实身份，并明确确认关联本客户</label>
          </> : null}
          <p className="ci-dialog-note">此处仅确认上传来源；不创建渠道，首次实际成功才由服务端事务建立关联。</p>
        </>}
      </> : null}
      {message ? <p className="ci-error" role="alert">{message}</p> : null}
      <div className="ci-dialog-footer"><Button type="button" variant="outline" className="ci-button" onClick={props.onClose}>取消</Button><Button type="button" className="ci-button ci-primary" disabled={!context || Boolean(disabledReason) || settingUp || (!context.channel && (!sourceType || (chooseExisting && (!existingId || !confirmedExisting))))} onClick={() => void setup()}>{settingUp ? "正在核验…" : "继续选择物料表"}</Button></div>
    </DialogContent>
  </Dialog>;
}
