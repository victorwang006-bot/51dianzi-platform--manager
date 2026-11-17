import { useEffect, useRef, useState } from "react";
import {
  INBOUND_DOCUMENT_ACCEPT, inboundDocumentFileError, inboundDocumentLabels, stableInboundDocuments,
  type AuthorizedInboundDocument, type InboundDocumentKind, type InboundDocumentReference, type InboundDocumentMode, type useInboundDocumentDraft,
} from "./inboundDocumentDraft";

const KINDS: InboundDocumentKind[] = ["contract", "bank_receipt"];
type DocumentDraft = ReturnType<typeof useInboundDocumentDraft>;
type Access = (document: InboundDocumentReference, mode: InboundDocumentMode) => Promise<AuthorizedInboundDocument>;

/** No stored/upload URL is usable here: every user action invokes the scoped RPC. */
function useDocumentAccess({ documents, scope, enabled, access, isCurrentScope, onAuthorizationError }: {
  documents: InboundDocumentReference[]; scope: string; enabled: boolean; access: Access;
  isCurrentScope?: () => boolean; onAuthorizationError?: (error: unknown) => void;
}) {
  const [action, setAction] = useState<{ key: string; mode: InboundDocumentMode; name: string; mimeType: string; url: string; loading: boolean; error: string } | null>(null);
  const generation = useRef(0);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ documents, scope, enabled, access, isCurrentScope, onAuthorizationError });
  live.current = { documents, scope, enabled, access, isCurrentScope, onAuthorizationError };
  const signature = JSON.stringify(stableInboundDocuments(documents));
  const close = () => { generation.current += 1; clearTimeout(expiry.current); setAction(null); };
  useEffect(() => { close(); return () => { generation.current += 1; clearTimeout(expiry.current); }; }, [scope, enabled, signature]);
  useEffect(() => {
    if (!action || action.mode !== "preview") return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [action?.key, action?.mode]);
  const open = async (document: InboundDocumentReference, mode: InboundDocumentMode) => {
    if (!live.current.enabled || !(live.current.isCurrentScope?.() ?? true)) return;
    clearTimeout(expiry.current);
    const ticket = ++generation.current, owner = scope;
    const current = () => generation.current === ticket && live.current.enabled && live.current.scope === owner
      && (live.current.isCurrentScope?.() ?? true) && live.current.documents.some(item => JSON.stringify(item) === JSON.stringify(document));
    if (!current()) return;
    setAction({ key: document.key, mode, name: document.name, mimeType: document.mimeType, url: "", loading: true, error: "" });
    try {
      if (!KINDS.includes(document.kind) || inboundDocumentFileError({ name: document.name, type: document.mimeType, size: document.size })) throw new Error("附件类型或大小无效，请重新获取");
      const authorized = await live.current.access(document, mode);
      if (!current()) return;
      if (!authorized || ["kind", "key", "name", "mimeType", "size"].some(field => authorized[field as keyof InboundDocumentReference] !== document[field as keyof InboundDocumentReference])) throw new Error("附件已变化，请重新获取");
      let url: URL;
      try { url = new URL(authorized.url); } catch { throw new Error("附件地址无效，请重试"); }
      if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new Error("附件地址无效，请重试");
      if (mode === "download") {
        // OSS attachment + RFC5987 filename controls cross-origin downloads; no CORS/blob or a.download assumption.
        const anchor = window.document.createElement("a");
        anchor.href = url.href; anchor.rel = "noopener noreferrer"; anchor.referrerPolicy = "no-referrer";
        anchor.click(); setAction(null);
      } else {
        setAction({ key: document.key, mode, name: document.name, mimeType: document.mimeType, url: url.href, loading: false, error: "" });
        const expiresIn = Number(authorized.expiresIn ?? 300);
        expiry.current = setTimeout(() => { if (current()) { generation.current += 1; setAction({ key: document.key, mode, name: document.name, mimeType: document.mimeType, url: "", loading: false, error: "预览已过期，请重试" }); } }, Math.max(1, Math.min(300, expiresIn || 300)) * 1000);
      }
    } catch (cause) {
      if (!current()) return;
      live.current.onAuthorizationError?.(cause);
      const invalidScope = ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes((cause as { data?: { code?: string } })?.data?.code ?? "");
      setAction({ key: document.key, mode: invalidScope ? "download" : mode, name: document.name, mimeType: document.mimeType, url: "", loading: false, error: cause instanceof Error ? cause.message : "附件读取失败，请重试" });
    }
  };
  const fail = () => { generation.current += 1; setAction(value => value ? { ...value, url: "", loading: false, error: "预览失败，请重试" } : null); };
  const buttons = (item: InboundDocumentReference, disabled = false) => <>
    {(["preview", "download"] as const).map(mode => <button key={mode} type="button" className="shrink-0 text-[#185FA5] disabled:opacity-50" disabled={disabled || !!action?.loading} aria-label={`${mode === "preview" ? "预览" : "下载"}${inboundDocumentLabels[item.kind]} ${item.name}`} onClick={() => { void open(item, mode); }}>{action?.key === item.key && action.mode === mode && action.loading ? "读取中…" : mode === "preview" ? "预览" : "下载"}</button>)}
    {action?.key === item.key && action.mode === "download" && action.loading && <button type="button" className="shrink-0 text-[#666]" onClick={close}>取消</button>}
    {action?.key === item.key && action.mode === "download" && action.error && <span role="alert" className="text-[#B42318]">{action.error}</span>}
  </>;
  const preview = enabled && (isCurrentScope?.() ?? true) && action?.mode === "preview" && <div className="inbound-document-preview" role="dialog" aria-modal="true" aria-label={`预览 ${action.name}`} onClick={close}>
    <div className="inbound-document-preview-panel" onClick={event => event.stopPropagation()}>
      <div className="inbound-document-preview-header"><span className="min-w-0 flex-1 truncate" title={action.name}>{action.name}</span><button type="button" className="crm-btn crm-btn-sm" onClick={close}>关闭预览</button></div>
      {action.loading ? <p role="status" className="p-3 text-[12px]">读取中…</p> : action.error ? <p role="alert" className="p-3 text-[12px] text-[#B42318]">{action.error} <button type="button" className="text-[#185FA5]" onClick={() => { const item = live.current.documents.find(item => item.key === action.key); if (item) void open(item, "preview"); }}>重试</button></p> : action.url && (action.mimeType === "application/pdf" ? <iframe title={`PDF预览 ${action.name}`} src={action.url} referrerPolicy="no-referrer" className="inbound-document-preview-content" onError={fail} /> : <img alt={action.name} src={action.url} referrerPolicy="no-referrer" className="inbound-document-preview-content inbound-document-preview-image" onError={fail} />)}
    </div>
  </div>;
  return { buttons, preview, close };
}

export function InboundDocuments({ draft, disabled = false, bulk = false }: { draft: DocumentDraft; disabled?: boolean; bulk?: boolean }) {
  const viewer = useDocumentAccess({ documents: draft.documents, scope: draft.accessScope, enabled: !disabled && draft.enabled, access: draft.authorize, isCurrentScope: draft.isCurrentScope });
  return <section className="inbound-entry-card inbound-documents mt-3" aria-label="单据附件" data-testid="inbound-documents">
    <div className="inbound-entry-card-title">单据附件 <span className="font-normal text-[11px] text-[#8A94A3]">{bulk ? "本批共享 · 选填" : "选填"}</span></div>
    <div className="px-3 pb-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{KINDS.map(kind => <DocumentColumn key={kind} kind={kind} draft={draft} disabled={disabled} viewer={viewer} />)}</div>
      {draft.error && <p className="mt-2 text-[12px] text-[#B42318]" role="alert">{draft.error}</p>}
    </div>{viewer.preview}
  </section>;
}
function DocumentColumn({ kind, draft, disabled, viewer }: { kind: InboundDocumentKind; draft: DocumentDraft; disabled: boolean; viewer: ReturnType<typeof useDocumentAccess> }) {
  const input = useRef<HTMLInputElement>(null);
  const documents = draft.documents.filter(item => item.kind === kind), uploads = draft.uploads.filter(item => item.kind === kind);
  const count = documents.length + uploads.length, label = inboundDocumentLabels[kind];
  return <div className="min-w-0" data-document-kind={kind}>
    <div className="flex items-center justify-between gap-2"><span className="erp-field-label font-medium">{label}</span><button type="button" className="crm-btn crm-btn-sm inbound-document-button text-[#185FA5]" disabled={disabled || count >= 5} onClick={() => input.current?.click()}>上传（{count}/5）</button><input ref={input} type="file" multiple className="sr-only" aria-label={`选择${label}`} accept={INBOUND_DOCUMENT_ACCEPT} disabled={disabled || count >= 5} onChange={event => { draft.select(kind, event.currentTarget.files); event.currentTarget.value = ""; }} /></div>
    <ul className="mt-2 space-y-1" aria-label={`${label}文件列表`}>
      {documents.map(item => <li key={item.key} className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate text-[#47637D]" title={item.name}>{item.name}</span>{viewer.buttons(item, disabled)}<button type="button" className="shrink-0 text-[#B42318] disabled:opacity-50" disabled={disabled} aria-label={`删除${label} ${item.name}`} onClick={() => { viewer.close(); draft.remove(item.key); }}>删除</button></li>)}
      {uploads.map(item => <li key={item.id} className="text-[12px]"><div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate" title={item.file.name}>{item.file.name}</span>{item.state === "uploading" ? <span className="shrink-0 text-[11px] text-[#47637D]" role="status">上传中…</span> : <button type="button" className="shrink-0 text-[#185FA5] disabled:opacity-50" disabled={disabled} aria-label={`重试${label} ${item.file.name}`} onClick={() => draft.retry(item.id)}>重试</button>}<button type="button" className="shrink-0 text-[#B42318] disabled:opacity-50" disabled={disabled} aria-label={`删除${label} ${item.file.name}`} onClick={() => draft.remove(item.id)}>删除</button></div>{item.error && <div className="mt-0.5 break-words text-[11px] text-[#B42318]" role="alert">{item.error}</div>}</li>)}
    </ul>
  </div>;
}

export function InboundDocumentDetails({ id, scope, enabled, load, access, onAuthorizationError, isCurrentScope }: {
  id: number; scope: string; enabled: boolean;
  load: (id: number) => Promise<AuthorizedInboundDocument[]>;
  access: (id: number, key: string, mode: InboundDocumentMode) => Promise<AuthorizedInboundDocument>;
  onAuthorizationError?: (error: unknown) => void; isCurrentScope?: () => boolean;
}) {
  const [documents, setDocuments] = useState<InboundDocumentReference[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const generation = useRef(0), live = useRef({ id, scope, enabled, load, access, onAuthorizationError, isCurrentScope });
  live.current = { id, scope, enabled, load, access, onAuthorizationError, isCurrentScope };
  useEffect(() => {
    const ticket = ++generation.current;
    const current = () => generation.current === ticket && live.current.id === id && live.current.scope === scope && live.current.enabled && (live.current.isCurrentScope?.() ?? true);
    setDocuments([]); setError(""); setLoading(enabled);
    if (enabled && current()) void live.current.load(id).then(result => { if (current()) setDocuments(stableInboundDocuments(result)); }).catch(cause => { if (!current()) return; live.current.onAuthorizationError?.(cause); setError(cause instanceof Error ? cause.message : "附件读取失败，请重试"); }).finally(() => { if (current()) setLoading(false); });
    return () => { generation.current += 1; };
  }, [id, scope, enabled, retry]);
  const viewer = useDocumentAccess({ documents, scope: `${scope}:${id}:${retry}`, enabled: enabled && !loading, access: (document, mode) => live.current.access(id, document.key, mode), isCurrentScope, onAuthorizationError });
  return <section className="inbound-documents mt-4" aria-label="单据附件" data-testid="inbound-document-details">
    <div className="mb-2 text-[12px] font-medium text-[#666]">单据附件</div>
    {!enabled ? null : loading ? <p className="text-[12px] text-[#8A94A3]" role="status">附件加载中…</p> : (!error || documents.length > 0) && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{KINDS.map(kind => <div key={kind}><div className="mb-1 text-[12px] text-[#666]">{inboundDocumentLabels[kind]}</div><ul className="space-y-1">{documents.filter(item => item.kind === kind).map(item => <li key={item.key} className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>{viewer.buttons(item)}</li>)}</ul></div>)}</div>}
    {error && <div className="mt-2 text-[12px] text-[#B42318]" role="alert">{error} <button type="button" className="text-[#185FA5]" disabled={loading || !enabled} onClick={() => setRetry(value => value + 1)}>重新获取</button></div>}{viewer.preview}
  </section>;
}
