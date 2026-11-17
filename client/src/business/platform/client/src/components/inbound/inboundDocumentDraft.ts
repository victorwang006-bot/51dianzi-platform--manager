import { useEffect, useRef, useState } from "react";
import { INBOUND_DOCUMENT_MAX_BYTES, INBOUND_DOCUMENT_MAX_PER_KIND, type InboundDocumentRef, type InboundDocumentUploadInput, type InboundDocumentAccess } from "../../../../shared/inboundDocuments";

// The API lane owns the shared protocol; UI state adds no request fields.
export type InboundDocumentKind = InboundDocumentRef["kind"];
export type InboundDocumentMime = InboundDocumentRef["mimeType"];
export type InboundDocumentReference = InboundDocumentRef;
export type AuthorizedInboundDocument = Pick<InboundDocumentAccess, keyof InboundDocumentRef | "url">;
export type { InboundDocumentUploadInput };
export type UploadInboundDocument = (input: InboundDocumentUploadInput) => Promise<InboundDocumentReference>;
export { INBOUND_DOCUMENT_MAX_BYTES, INBOUND_DOCUMENT_MAX_PER_KIND };
export const INBOUND_DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
export const inboundDocumentLabels: Record<InboundDocumentKind, string> = { contract: "合同", bank_receipt: "银行付款水单" };
const MIME_EXTENSIONS: Record<InboundDocumentMime, RegExp> = {
  "application/pdf": /\.pdf$/i,
  "image/jpeg": /\.jpe?g$/i,
  "image/png": /\.png$/i,
  "image/webp": /\.webp$/i,
};
export function inboundDocumentFileError(file: Pick<File, "name" | "type" | "size">): string {
  if (!Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, file.type)) return "仅支持 PDF、JPG、PNG、WebP 文件";
  if (!MIME_EXTENSIONS[file.type as InboundDocumentMime].test(file.name)) return "文件扩展名与类型不一致，请重新选择";
  if (file.size <= 0) return "不能上传空文件";
  if (file.size > INBOUND_DOCUMENT_MAX_BYTES) return "单份附件不能超过 5MiB";
  return "";
}
export function stableInboundDocuments(documents: readonly InboundDocumentReference[]): InboundDocumentReference[] {
  return documents.map(({ kind, key, name, mimeType, size }) => ({ kind, key, name, mimeType, size }));
}
export function readInboundDocumentFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("附件读取失败，请重试"));
    reader.onabort = () => reject(new Error("附件读取已取消"));
    reader.readAsDataURL(file);
  });
}
function newUploadId() {
  return globalThis.crypto?.randomUUID?.() ?? `document-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export type InboundDocumentUploadRow = { id: string; kind: InboundDocumentKind; file: File; state: "uploading" | "failed"; error: string };

/** Draft references are memory-only. Removing a row never deletes private storage. */
export function useInboundDocumentDraft({ ownerScope, responseFence, clientRequestId, orderId, enabled, upload, onAuthorizationError, isCurrentScope }: {
  ownerScope: string;
  responseFence: string;
  clientRequestId: string;
  orderId?: number;
  enabled: boolean;
  upload: UploadInboundDocument;
  onAuthorizationError?: (error: unknown) => void;
  isCurrentScope?: () => boolean;
}) {
  const [documents, setDocuments] = useState<InboundDocumentReference[]>([]);
  const [uploads, setUploads] = useState<InboundDocumentUploadRow[]>([]);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const state = useRef({ documents, uploads, ownerScope, responseFence, enabled });
  state.current = { documents, uploads, ownerScope, responseFence, enabled };
  const mounted = useRef(true);
  const previousOwner = useRef(ownerScope);
  const previousFence = useRef(responseFence);
  const currentScope = useRef(isCurrentScope); currentScope.current = isCurrentScope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    if (previousOwner.current !== ownerScope) {
      previousOwner.current = ownerScope;
      generation.current += 1;
      state.current.documents = []; state.current.uploads = [];
      setDocuments([]); setUploads([]); setError("");
    } else if (previousFence.current !== responseFence) {
      generation.current += 1;
      state.current.uploads = [];
      setUploads([]);
      // Preserve stable references and all original form input on buyer revalidation.
      if (uploads.some(row => row.state === "uploading")) setError("业务身份或采购员核验已变化，未完成的附件未关联，请重新选择");
    }
    previousFence.current = responseFence;
  }, [ownerScope, responseFence]);
  const reset = (next: readonly InboundDocumentReference[] = []) => {
    generation.current += 1;
    const stable = stableInboundDocuments(next);
    state.current.documents = stable; state.current.uploads = [];
    setDocuments(stable); setUploads([]); setError("");
  };
  const run = async (row: InboundDocumentUploadRow) => {
    const ticket = generation.current, owner = ownerScope, fence = responseFence;
    const current = () => mounted.current && generation.current === ticket
      && state.current.ownerScope === owner && state.current.responseFence === fence
      && state.current.enabled && (currentScope.current?.() ?? true) && state.current.uploads.some(item => item.id === row.id);
    try {
      const base64 = await readInboundDocumentFile(row.file);
      if (!current()) return;
      const result = await upload({ kind: row.kind, fileName: row.file.name, mimeType: row.file.type as InboundDocumentMime, base64, clientRequestId, ...(orderId != null ? { orderId } : {}) });
      if (!current()) return;
      if (result.kind !== row.kind || !result.key) throw new Error("上传返回的附件分类或引用无效，请重试");
      const reference = stableInboundDocuments([result])[0];
      const next = state.current.documents.some(item => item.key === reference.key) ? state.current.documents : [...state.current.documents, reference];
      state.current.documents = next;
      state.current.uploads = state.current.uploads.filter(item => item.id !== row.id);
      setDocuments(next); setUploads(state.current.uploads);
    } catch (cause) {
      if (!current()) return;
      onAuthorizationError?.(cause);
      state.current.uploads = state.current.uploads.map(item => item.id === row.id ? { ...item, state: "failed", error: cause instanceof Error ? cause.message : "附件上传失败，请重试" } : item);
      setUploads(state.current.uploads);
    }
  };
  const select = (kind: InboundDocumentKind, files: FileList | readonly File[] | null) => {
    if (!enabled || !(currentScope.current?.() ?? true) || !files?.length) return;
    setError("");
    const selected = Array.from(files);
    const occupied = state.current.documents.filter(item => item.kind === kind).length + state.current.uploads.filter(item => item.kind === kind).length;
    if (occupied + selected.length > INBOUND_DOCUMENT_MAX_PER_KIND) { setError(`${inboundDocumentLabels[kind]}最多 5 份（含上传中及待重试文件），请删除后重新选择`); return; }
    const invalid = selected.map(inboundDocumentFileError).find(Boolean);
    if (invalid) { setError(invalid); return; }
    const next = selected.map(file => ({ id: newUploadId(), kind, file, state: "uploading" as const, error: "" }));
    state.current.uploads = [...state.current.uploads, ...next];
    setUploads(state.current.uploads);
    next.forEach(row => { void run(row); });
  };
  const retry = (id: string) => {
    if (!enabled || !(currentScope.current?.() ?? true)) return;
    const row = state.current.uploads.find(item => item.id === id && item.state === "failed");
    if (!row) return;
    state.current.uploads = state.current.uploads.map(item => item.id === id ? { ...item, state: "uploading", error: "" } : item);
    setUploads(state.current.uploads); void run(row);
  };
  const remove = (id: string) => {
    if (!enabled) return;
    state.current.documents = state.current.documents.filter(item => item.key !== id);
    state.current.uploads = state.current.uploads.filter(item => item.id !== id);
    setDocuments(state.current.documents); setUploads(state.current.uploads); setError("");
  };
  return { documents, uploads, error, reset, select, retry, remove,
    busy: uploads.some(row => row.state === "uploading"),
    blocked: uploads.length > 0,
    isBlocked: () => state.current.uploads.length > 0,
  };
}
