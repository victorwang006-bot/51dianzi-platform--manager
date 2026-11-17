import { useEffect, useRef, useState } from "react";
import {
  INBOUND_DOCUMENT_ACCEPT, inboundDocumentLabels, stableInboundDocuments,
  type AuthorizedInboundDocument, type InboundDocumentKind, type InboundDocumentReference, type useInboundDocumentDraft,
} from "./inboundDocumentDraft";

const KINDS: InboundDocumentKind[] = ["contract", "bank_receipt"];
type DocumentDraft = ReturnType<typeof useInboundDocumentDraft>;
export function InboundDocuments({ draft, disabled = false, bulk = false }: { draft: DocumentDraft; disabled?: boolean; bulk?: boolean }) {
  return <section className="inbound-entry-card inbound-documents mt-3" aria-label="单据附件" data-testid="inbound-documents">
    <div className="inbound-entry-card-title">单据附件 <span className="font-normal text-[11px] text-[#8A94A3]">选填</span></div>
    <div className="px-3 pb-3">
      {bulk && <p className="mb-2 text-[12px] text-[#47637D]">本次附件应用本批生成的入库单</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {KINDS.map(kind => <DocumentColumn key={kind} kind={kind} draft={draft} disabled={disabled} />)}
      </div>
      <p className="mt-2 text-[11px] text-[#8A94A3]">PDF、JPG、PNG、WebP · 单份 ≤5MiB · 每类最多 5 份。上传水单不改变付款状态或金额。</p>
      {draft.error && <p className="mt-2 text-[12px] text-[#B42318]" role="alert">{draft.error}</p>}
      {draft.busy && <p className="mt-1 text-[11px] text-[#47637D]" role="status">附件上传中，请完成后提交</p>}
      {!draft.busy && draft.blocked && <p className="mt-1 text-[11px] text-[#B42318]">请重试失败附件，或删除本次草稿引用后提交</p>}
    </div>
  </section>;
}
function DocumentColumn({ kind, draft, disabled }: { kind: InboundDocumentKind; draft: DocumentDraft; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const documents = draft.documents.filter(item => item.kind === kind);
  const uploads = draft.uploads.filter(item => item.kind === kind);
  const count = documents.length + uploads.length;
  const label = inboundDocumentLabels[kind];
  return <div className="min-w-0" data-document-kind={kind}>
    <div className="flex items-center justify-between gap-2">
      <span className="erp-field-label font-medium">{label}</span>
      <button type="button" className="crm-btn crm-btn-sm inbound-document-button text-[#185FA5]" disabled={disabled || count >= 5} onClick={() => input.current?.click()}>上传{label}（{count}/5）</button>
      <input ref={input} type="file" multiple className="sr-only" aria-label={`选择${label}`} accept={INBOUND_DOCUMENT_ACCEPT} disabled={disabled || count >= 5} onChange={event => { draft.select(kind, event.currentTarget.files); event.currentTarget.value = ""; }} />
    </div>
    <ul className="mt-2 space-y-1" aria-label={`${label}文件列表`}>
      {!count && <li className="text-[11px] text-[#8A94A3]">未上传</li>}
      {documents.map(item => <li key={item.key} className="flex min-w-0 items-center gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate text-[#47637D]" title={item.name}>{item.name}</span>
        <button type="button" className="shrink-0 text-[#B42318] disabled:opacity-50" disabled={disabled} aria-label={`删除${label} ${item.name}`} onClick={() => draft.remove(item.key)}>删除</button>
      </li>)}
      {uploads.map(item => <li key={item.id} className="text-[12px]">
        <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate" title={item.file.name}>{item.file.name}</span>
          {item.state === "uploading" ? <span className="shrink-0 text-[11px] text-[#47637D]" role="status">上传中…</span> : <button type="button" className="shrink-0 text-[#185FA5] disabled:opacity-50" disabled={disabled} aria-label={`重试${label} ${item.file.name}`} onClick={() => draft.retry(item.id)}>重试</button>}
          <button type="button" className="shrink-0 text-[#B42318] disabled:opacity-50" disabled={disabled} aria-label={`删除${label} ${item.file.name}`} onClick={() => draft.remove(item.id)}>删除</button>
        </div>
        {item.error && <div className="mt-0.5 break-words text-[11px] text-[#B42318]" role="alert">{item.error}</div>}
      </li>)}
    </ul>
  </div>;
}

/** A reopened detail and each download must obtain current authorization, not cached signed URLs. */
export function InboundDocumentDetails({ id, scope, enabled, load, access, onAuthorizationError, isCurrentScope }: {
  id: number; scope: string; enabled: boolean;
  load: (id: number) => Promise<AuthorizedInboundDocument[]>;
  access: (id: number, key: string) => Promise<AuthorizedInboundDocument>;
  onAuthorizationError?: (error: unknown) => void;
  isCurrentScope?: () => boolean;
}) {
  const [documents, setDocuments] = useState<InboundDocumentReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const currentScope = useRef({ id, scope, enabled });
  currentScope.current = { id, scope, enabled };
  const loadRef = useRef(load); loadRef.current = load;
  const accessRef = useRef(access); accessRef.current = access;
  const authErrorRef = useRef(onAuthorizationError); authErrorRef.current = onAuthorizationError;
  const scopeGuard = useRef(isCurrentScope); scopeGuard.current = isCurrentScope;
  useEffect(() => {
    const ticket = ++generation.current;
    setDocuments([]); setError(""); setDownloading(""); setLoading(enabled);
    if (enabled && (scopeGuard.current?.() ?? true)) void loadRef.current(id).then(result => {
      if (generation.current === ticket && currentScope.current.enabled && (scopeGuard.current?.() ?? true) && currentScope.current.id === id && currentScope.current.scope === scope) setDocuments(stableInboundDocuments(result));
    }).catch(cause => {
      if (generation.current !== ticket) return;
      authErrorRef.current?.(cause);
      setError(cause instanceof Error ? cause.message : "单据附件读取失败，请重试");
    }).finally(() => { if (generation.current === ticket) setLoading(false); });
    return () => { generation.current += 1; };
  }, [id, scope, enabled, retry]);
  const download = async (document: InboundDocumentReference) => {
    if (!enabled || !(scopeGuard.current?.() ?? true) || downloading) return;
    const ticket = generation.current;
    setDownloading(document.key); setError("");
    try {
      const authorized = await accessRef.current(id, document.key);
      if (generation.current !== ticket || !currentScope.current.enabled || !(scopeGuard.current?.() ?? true) || currentScope.current.id !== id || currentScope.current.scope !== scope) return;
      if (!authorized?.url || authorized.key !== document.key || authorized.kind !== document.kind) throw new Error("附件已移除或无下载权限，请重新获取");
      const url = new URL(authorized.url, window.location.origin);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("附件下载地址无效，请重试");
      const anchor = window.document.createElement("a");
      anchor.href = url.href; anchor.download = authorized.name; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch (cause) {
      if (generation.current !== ticket) return;
      authErrorRef.current?.(cause);
      setError(cause instanceof Error ? cause.message : "鉴权下载失败，请重试");
    } finally { if (generation.current === ticket) setDownloading(""); }
  };
  return <section className="inbound-documents mt-4" aria-label="单据附件" data-testid="inbound-document-details">
    <div className="mb-2 text-[12px] font-medium text-[#666]">单据附件</div>
    {!enabled ? <p className="text-[12px] text-[#8A94A3]">正在核验业务身份，暂不可读取或下载</p> : loading ? <p className="text-[12px] text-[#8A94A3]" role="status">附件加载中…</p> : (!error || documents.length > 0) && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{KINDS.map(kind => <div key={kind}>
      <div className="mb-1 text-[12px] text-[#666]">{inboundDocumentLabels[kind]}</div>
      <ul className="space-y-1">{!documents.some(item => item.kind === kind) && <li className="text-[11px] text-[#8A94A3]">未上传</li>}{documents.filter(item => item.kind === kind).map(item => <li key={item.key} className="flex min-w-0 items-center gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span><button type="button" className="shrink-0 text-[#185FA5] disabled:opacity-50" disabled={!!downloading} aria-label={`下载${inboundDocumentLabels[kind]} ${item.name}`} onClick={() => { void download(item); }}>{downloading === item.key ? "鉴权中…" : "下载"}</button></li>)}</ul>
    </div>)}</div>}
    {error && <div className="mt-2 text-[12px] text-[#B42318]" role="alert">{error} <button type="button" className="text-[#185FA5]" disabled={loading || !enabled} onClick={() => setRetry(value => value + 1)}>重新获取</button></div>}
  </section>;
}
