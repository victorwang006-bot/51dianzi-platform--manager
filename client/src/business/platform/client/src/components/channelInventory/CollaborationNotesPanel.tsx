import React, { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../front-router-types/server/routers";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";
import { trpc } from "../../../../../api/business-trpc";

type Note = inferRouterOutputs<AppRouter>["channelInventory"]["collaborationNotesList"]["items"][number];
type FrozenNote = { mode: "add" | "edit"; content: string; requestId: string; noteId?: number; expectedRevision?: number };
const PAGE_SIZE = 20;
const definitiveCodes = new Set(["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "UNAUTHORIZED"]);
const readDeniedCodes = new Set(["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED", "PRECONDITION_FAILED"]);
function failureCode(error: unknown) {
  return (error as { data?: { code?: string } } | null)?.data?.code ?? "";
}
function requestId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, key => {
    const n = Math.floor(Math.random() * 16);
    return (key === "x" ? n : (n & 3) | 8).toString(16);
  });
}

/** This panel knows only the new public collaboration DTO, never legacy private notes. */
export function CollaborationNotesPanel({ materialId, partNumber, brand, enterpriseId, actorUserId, startAdding, canAddNote, isCurrent, onClose, onComplete }: {
  materialId: number; partNumber: string; brand: string; enterpriseId: number; actorUserId: number;
  startAdding: boolean; canAddNote: boolean; isCurrent: () => boolean; onClose: () => void; onComplete: () => void;
}) {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; revision: number; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [message, setMessage] = useState("");
  const frozen = useRef<FrozenNote | null>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const focusStarted = useRef(false);
  const context = { expectedEnterpriseId: enterpriseId, expectedActorUserId: actorUserId };
  const query = trpc.channelInventory.collaborationNotesList.useQuery({ ...context, materialId, page, pageSize: PAGE_SIZE }, {
    enabled: isCurrent(), retry: false, refetchOnWindowFocus: true, trpc: { abortOnUnmount: true },
  });
  const accessDenied = !isCurrent() || (query.isError && readDeniedCodes.has(failureCode(query.error)));
  const effectiveBusy = busy && !accessDenied;
  const effectiveRetryLocked = retryLocked && !accessDenied;
  const result = isCurrent() && !query.isError ? query.data : undefined;
  const canAdd = canAddNote && result?.canAdd === true;
  const editableNote = editing ? result?.items.find((note: Note) => note.id === editing.id && note.canEdit && note.authorUserId === actorUserId) : undefined;
  const permitted = !accessDenied && (editing ? Boolean(editableNote) : canAdd);
  const live = useRef({ isCurrent, permitted, onClose, busy: effectiveBusy, retryLocked: effectiveRetryLocked, accessDenied });
  live.current = { isCurrent, permitted, onClose, busy: effectiveBusy, retryLocked: effectiveRetryLocked, accessDenied };
  const current = () => alive.current && !live.current.accessDenied && live.current.isCurrent();
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    alive.current = true;
    const trigger = document.activeElement as HTMLElement | null;
    if (!startAdding) dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !live.current.busy && !live.current.retryLocked) { event.preventDefault(); live.current.onClose(); }
      if (event.key !== "Tab") return;
      const fields = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []);
      const first = fields[0]; const last = fields.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
    };
    dialog.current?.addEventListener("keydown", keydown);
    const element = dialog.current;
    return () => {
      alive.current = false; controller.current?.abort(); frozen.current = null;
      element?.removeEventListener("keydown", keydown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  useEffect(() => {
    if (startAdding && !focusStarted.current && textarea.current) { textarea.current.focus(); focusStarted.current = true; }
  }, [startAdding, canAdd, result]);
  useEffect(() => { if (editing) textarea.current?.focus(); }, [editing?.id]);
  useEffect(() => {
    if (!accessDenied) return;
    // Render already masks all old data in this same frame. Cleanup must also
    // release an unknown write lock so revoked users can close the panel.
    controller.current?.abort(); frozen.current = null; pending.current = false;
    setEditing(null); setDraft(""); setRetryLocked(false); setBusy(false); setMessage("");
  }, [accessDenied]);

  const submit = async () => {
    if (!current() || pending.current || !live.current.permitted) return;
    const content = (editing ? editing.content : draft).trim();
    if (!content || content.length > 2000) { setMessage("请输入 1 到 2000 字的备注内容。"); return; }
    let payload = frozen.current;
    if (!payload) {
      payload = { mode: editing ? "edit" : "add", content, requestId: requestId(),
        ...(editing ? { noteId: editing.id, expectedRevision: editing.revision } : {}) };
      frozen.current = payload;
    }
    pending.current = true; setBusy(true); setMessage("");
    const abort = new AbortController(); controller.current = abort;
    try {
      if (payload.mode === "edit") {
        await utils.client.channelInventory.collaborationNotesEdit.mutate({ ...context, noteId: payload.noteId!, expectedRevision: payload.expectedRevision!, content: payload.content, requestId: payload.requestId }, { signal: abort.signal });
      } else {
        await utils.client.channelInventory.collaborationNotesAdd.mutate({ ...context, materialId, content: payload.content, requestId: payload.requestId }, { signal: abort.signal });
      }
      if (!current()) return;
      frozen.current = null; setRetryLocked(false); setDraft(""); setEditing(null);
      await query.refetch(); if (current()) onComplete();
    } catch (error) {
      if (!current() || abort.signal.aborted) return;
      if (definitiveCodes.has(failureCode(error))) {
        frozen.current = null; setRetryLocked(false);
        setMessage(error instanceof Error ? error.message : "备注保存失败，请刷新后重试。");
        void query.refetch();
      } else {
        setRetryLocked(true);
        setMessage("保存结果未确认。内容已锁定，请按原请求重试，系统不会重复追加或覆盖备注。");
      }
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };

  return <div className="ci-modal-backdrop" role="presentation">
    <section ref={dialog} tabIndex={-1} className="ci-host-dialog ci-notes-dialog ci-collaboration-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-collaboration-title">
      <header><div><h2 id="ci-collaboration-title">协作备注</h2>{accessDenied ? <p>当前访问权限或上下文已变化，已清理备注内容。</p> : <p>{partNumber} · {brand} · 对有权查看这条库存的成员可见；只有作者可修改自己的备注。</p>}</div><button type="button" className="ci-icon-close" aria-label="关闭协作备注" disabled={effectiveBusy || effectiveRetryLocked} onClick={onClose}>×</button></header>
      <div className="ci-dialog-scroll">
        {query.isLoading ? <p className="ci-empty">正在读取协作备注…</p> : null}
        {query.isError ? <p className="ci-error" role="alert">{query.error.message || "协作备注读取失败。"}</p> : null}
        {accessDenied || startAdding || editing ? null : <section className="ci-notes-history" aria-label="协作备注历史">
          {result?.items.map((note: Note) => <article className="ci-note-entry" key={note.id}>
            <div className="ci-note-entry-meta"><strong>{note.authorName}</strong><time>{formatBeijingDateTime(note.createdAt) || "—"}{String(note.updatedAt) !== String(note.createdAt) ? ` · 修改于 ${formatBeijingDateTime(note.updatedAt)}` : ""}</time></div>
            <p>{note.content}</p>
            {note.canEdit && note.authorUserId === actorUserId ? <button type="button" className="ci-inline-link" disabled={busy || retryLocked} onClick={() => { frozen.current = null; setEditing({ id: note.id, revision: note.revision, content: note.content }); setMessage(""); }}>修改我的备注</button> : null}
          </article>)}
          {result && !result.items.length ? <p className="ci-note-empty">暂无协作备注。</p> : null}
        </section>}
        {!accessDenied && !startAdding && !editing && pageCount > 1 ? <nav className="ci-pagination" aria-label="协作备注分页"><span>共 {result?.total ?? 0} 条，第 {page} / {pageCount} 页</span><button type="button" className="ci-button" disabled={busy || retryLocked || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button type="button" className="ci-button" disabled={busy || retryLocked || page >= pageCount} onClick={() => setPage(page + 1)}>下一页</button></nav> : null}
        {!accessDenied && (canAdd || editing) ? <section className="ci-note-add" aria-label={editing ? "编辑我的协作备注" : "新增协作备注"}>
          <label className="ci-field"><span>{editing ? "编辑我的协作备注" : "新增协作备注"}</span><textarea ref={textarea} rows={4} maxLength={2000} disabled={busy || retryLocked || !permitted} value={editing ? editing.content : draft} placeholder="记录沟通进展、库存核实等协作信息，1–2000 字" onChange={event => {
            frozen.current = null; const value = event.target.value;
            if (editing) setEditing({ ...editing, content: value }); else setDraft(value);
          }} /></label>
          <div className="ci-note-add-meta"><small>{(editing ? editing.content : draft).length} / 2000</small>{editing ? <button type="button" className="ci-button" disabled={busy || retryLocked} onClick={() => { frozen.current = null; setEditing(null); setMessage(""); }}>取消编辑</button> : null}</div>
        </section> : result ? <p className="ci-readonly">当前不可新增协作备注。</p> : null}
        {!accessDenied && message ? <p className="ci-error" role="alert">{message}</p> : null}
      </div>
      <footer><button type="button" className="ci-button" disabled={effectiveBusy || effectiveRetryLocked} onClick={() => void query.refetch()}>刷新备注</button><button type="button" className="ci-button" disabled={effectiveBusy || effectiveRetryLocked} onClick={onClose}>关闭</button>{!accessDenied && (canAdd || editing) ? <button type="button" className="ci-button ci-primary" disabled={busy || !permitted || !(editing ? editing.content : draft).trim()} onClick={() => void submit()}>{busy ? "保存中…" : retryLocked ? "按原请求重试" : editing ? "保存备注修改" : "保存协作备注"}</button> : null}</footer>
    </section>
  </div>;
}
