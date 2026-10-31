import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  trpc,
} from "./bridge";
import "./notes.css";

type ChannelType = "factory" | "agent" | "trade" | "other";

type NoteItem = {
  id: number;
  authorUserId: number | null;
  authorName: string | null;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Authoritative server decision. Never derive this from actorUserId in the UI. */
  canEdit: boolean;
};

type NotesResponse = {
  material: {
    id: number;
    partNumber: string;
    brand: string;
    channelType: ChannelType;
    updatedAt: string;
  };
  legacyNote: string | null;
  items: NoteItem[];
  total: number;
  page: number;
  pageSize: number;
};

type NoteRow = {
  id: number;
  noteCount?: number | null;
  latestNote?: {
    id: number;
    content: string;
    authorName: string | null;
    updatedAt: string;
  } | null;
  /** Historical inventory note, never edited through this panel. */
  note?: string | null;
};

type NotesPanelProps = {
  materialId: number;
  enterpriseId: number;
  actorUserId: number;
  isCurrent: () => boolean;
  onClose: () => void;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  /** The page invalidates SharedMaterials and retains its existing native refresh. */
  onComplete: () => void;
};

type FrozenAdd = { content: string; requestId: string };
type FrozenEdit = {
  noteId: number;
  content: string;
  expectedRevision: number;
  requestId: string;
};

type Editing = {
  id: number;
  initialContent: string;
  content: string;
  revision: number;
};

const PAGE_SIZE = 50;
const MAX_CONTENT_LENGTH = 2000;

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, key => {
    const value = Math.floor(Math.random() * 16);
    return (key === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function displayTime(value: string | null | undefined) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
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

/** These are definitive responses, not ambiguous transport failures. */
function mustStartAgain(error: unknown) {
  return new Set([
    "BAD_REQUEST",
    "CONFLICT",
    "FORBIDDEN",
    "NOT_FOUND",
    "UNAUTHORIZED",
    "PRECONDITION_FAILED",
  ]).has(errorCode(error));
}

function countText(row: NoteRow) {
  const count = Number(row.noteCount ?? 0);
  if (Number.isFinite(count) && count > 0) return `${count} 条备注`;
  return row.note?.trim() ? "1 条历史备注" : "暂无备注";
}

/**
 * Read-only list-cell summary. It consumes only list DTO aggregation and never
 * makes a row-level query, avoiding N+1 requests in the inventory table.
 */
export function NotesSummary({
  row,
  onOpen,
  disabled = false,
}: {
  row: NoteRow;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const latest = row.latestNote ?? null;
  const fallback = row.note?.trim() ?? "";
  const summary = latest?.content ?? fallback;

  return (
    <div className="ci-notes-summary">
      <button
        type="button"
        className="ci-notes-summary-open"
        onClick={onOpen}
        disabled={disabled}
        aria-label={`打开库存 ${row.id} 的备注`}
      >
        {countText(row)}
      </button>
      <div className="ci-notes-summary-text" title={summary || undefined}>
        {summary || "—"}
      </div>
      <div className="ci-notes-summary-meta">
        {latest
          ? `${latest.authorName?.trim() || "作者未知"} · ${displayTime(latest.updatedAt)}`
          : fallback
            ? "原库存备注 · 作者与时间未记录"
            : "尚无备注时间"}
      </div>
    </div>
  );
}

export function NotesPanel({
  materialId,
  enterpriseId,
  actorUserId,
  isCurrent,
  onClose,
  onDirtyChange,
  onBusyChange,
  onComplete,
}: NotesPanelProps) {
  const identity = `${enterpriseId}:${actorUserId}:${materialId}`;
  const mounted = useRef(true);
  const identityRef = useRef(identity);
  const addFrozen = useRef<FrozenAdd | null>(null);
  const editFrozen = useRef<FrozenEdit | null>(null);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"add" | "edit" | null>(null);
  // An unknown result may already have committed. Lock its payload and UUID
  // until the exact retry reaches a definitive server response.
  const [retryLocked, setRetryLocked] = useState<"add" | "edit" | null>(null);

  const input = useMemo(
    () => ({
      materialId,
      page,
      pageSize: PAGE_SIZE,
      expectedEnterpriseId: enterpriseId,
      expectedActorUserId: actorUserId,
    }),
    [actorUserId, enterpriseId, materialId, page],
  );
  // Identity-bearing input is intentionally the complete cache key. No UI-only
  // cache fields are sent because the server input schemas are strict.
  const notesQuery = trpc.channelInventory.notesList.useQuery(input, {
    enabled: isCurrent(),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const addNote = trpc.channelInventory.notesAdd.useMutation();
  const editNote = trpc.channelInventory.notesEdit.useMutation();
  const response = (isCurrent() ? notesQuery.data : null) as NotesResponse | undefined;
  const current = () => mounted.current && isCurrent();
  const dirty =
    Boolean(draft.trim()) ||
    Boolean(editing && editing.content !== editing.initialContent) ||
    Boolean(addFrozen.current || editFrozen.current);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    onBusyChange(Boolean(busy));
  }, [busy, onBusyChange]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Parent supplies a strict key as well. This defensive path also prevents a
  // stale open dialog from displaying or submitting under a changed identity.
  useEffect(() => {
    if (identityRef.current === identity && isCurrent()) return;
    identityRef.current = identity;
    addFrozen.current = null;
    editFrozen.current = null;
    setPage(1);
    setDraft("");
    setEditing(null);
    setMessage("");
    setBusy(null);
    setRetryLocked(null);
    onDirtyChange(false);
    onBusyChange(false);
    onClose();
  }, [identity, isCurrent, onBusyChange, onClose, onDirtyChange]);

  const finishSuccess = async () => {
    if (!current()) return;
    setMessage("");
    await notesQuery.refetch();
    if (current()) onComplete();
  };

  const submitAdd = async () => {
    if (!current() || busy) return;
    const content = draft.trim();
    if (!content) {
      setMessage("请填写备注内容。");
      return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      setMessage(`备注不能超过 ${MAX_CONTENT_LENGTH} 个字符。`);
      return;
    }

    let frozen = addFrozen.current;
    if (retryLocked === "add" && (!frozen || frozen.content !== content)) {
      setMessage("保存结果待确认，请先按原内容重试，确认后才能修改内容。");
      return;
    }
    if (!frozen || frozen.content !== content) {
      frozen = { content, requestId: createRequestId() };
      addFrozen.current = frozen;
    }
    setBusy("add");
    setMessage("");
    try {
      await addNote.mutateAsync({
        materialId,
        content: frozen.content,
        requestId: frozen.requestId,
        expectedEnterpriseId: enterpriseId,
        expectedActorUserId: actorUserId,
      });
      if (!current()) return;
      addFrozen.current = null;
      setRetryLocked(null);
      setDraft("");
      await finishSuccess();
    } catch (error) {
      if (!current()) return;
      if (mustStartAgain(error)) {
        addFrozen.current = null;
        setRetryLocked(null);
        setMessage(`${errorMessage(error, "无法保存备注。")} 请刷新备注后重新提交。`);
        void notesQuery.refetch();
      } else {
        setRetryLocked("add");
        setMessage(
          "保存结果尚未确认。内容已锁定，请按原请求重试；系统会使用同一请求号，不会重复追加备注。",
        );
      }
    } finally {
      if (current()) setBusy(null);
    }
  };

  const beginEdit = (note: NoteItem) => {
    if (!current() || busy || retryLocked || !note.canEdit) return;
    editFrozen.current = null;
    setEditing({
      id: note.id,
      initialContent: note.content,
      content: note.content,
      revision: note.revision,
    });
    setMessage("");
  };

  const submitEdit = async () => {
    if (!editing || !current() || busy) return;
    const content = editing.content.trim();
    if (!content) {
      setMessage("请填写备注内容。");
      return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      setMessage(`备注不能超过 ${MAX_CONTENT_LENGTH} 个字符。`);
      return;
    }
    if (content === editing.initialContent) {
      setEditing(null);
      return;
    }

    let frozen = editFrozen.current;
    if (
      retryLocked === "edit" &&
      (!frozen ||
        frozen.noteId !== editing.id ||
        frozen.content !== content ||
        frozen.expectedRevision !== editing.revision)
    ) {
      setMessage("保存结果待确认，请先按原内容重试，确认后才能修改内容。");
      return;
    }
    if (
      !frozen ||
      frozen.noteId !== editing.id ||
      frozen.content !== content ||
      frozen.expectedRevision !== editing.revision
    ) {
      frozen = {
        noteId: editing.id,
        content,
        expectedRevision: editing.revision,
        requestId: createRequestId(),
      };
      editFrozen.current = frozen;
    }
    setBusy("edit");
    setMessage("");
    try {
      await editNote.mutateAsync({
        noteId: frozen.noteId,
        content: frozen.content,
        expectedRevision: frozen.expectedRevision,
        requestId: frozen.requestId,
        expectedEnterpriseId: enterpriseId,
        expectedActorUserId: actorUserId,
      });
      if (!current()) return;
      editFrozen.current = null;
      setRetryLocked(null);
      setEditing(null);
      await finishSuccess();
    } catch (error) {
      if (!current()) return;
      if (mustStartAgain(error)) {
        editFrozen.current = null;
        setRetryLocked(null);
        setMessage(`${errorMessage(error, "备注已变化。")} 请刷新后重新编辑。`);
        void notesQuery.refetch();
      } else {
        setRetryLocked("edit");
        setMessage(
          "保存结果尚未确认。本次内容已锁定，请按原请求重试；系统会使用同一请求号，不会覆盖他人备注。",
        );
      }
    } finally {
      if (current()) setBusy(null);
    }
  };

  const total = response?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const title = response?.material ?? {
    id: materialId,
    partNumber: "正在读取料号",
    brand: "正在读取品牌",
    channelType: "other" as ChannelType,
    updatedAt: "",
  };

  return (
    <Dialog
      open
      onOpenChange={(next: boolean) => {
        if (!next && !busy && !retryLocked) onClose();
      }}
    >
      <DialogContent
        className="ci-dialog ci-notes-dialog"
        onEscapeKeyDown={(event: KeyboardEvent) => {
          if (busy || retryLocked) event.preventDefault();
        }}
        onPointerDownOutside={(event: Event) => {
          if (busy || retryLocked) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>库存备注</DialogTitle>
          <DialogDescription>
            本库存备注对有库存权限的同团队成员可见，每人仅能修改本人备注。
            数量、价格、DC 和交期不在此处修改，请勿填写私有跟进或渠道联系人信息。
          </DialogDescription>
        </DialogHeader>

        <div className="ci-notes-material" aria-label="库存识别信息">
          <span>料号</span>
          <strong>{title.partNumber}</strong>
          <span>品牌</span>
          <strong>{title.brand}</strong>
        </div>

        {notesQuery.isError ? (
          <div className="ci-error" role="alert">
            {errorMessage(notesQuery.error, "备注加载失败。")}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ci-button ci-notes-retry"
              onClick={() => void notesQuery.refetch()}
              disabled={Boolean(busy)}
            >
              重试
            </Button>
          </div>
        ) : (
          <>
            <section className="ci-notes-history" aria-label="备注历史">
              {response?.legacyNote ? (
                <article className="ci-note-entry ci-note-legacy">
                  <div className="ci-note-entry-meta">
                    <strong>原库存备注</strong>
                    <span>作者未知 · 时间未记录</span>
                  </div>
                  <p>{response.legacyNote}</p>
                </article>
              ) : null}

              {notesQuery.isPending ? (
                <p className="ci-notes-loading">正在加载备注…</p>
              ) : response?.items.length ? (
                response.items.map(note => {
                  const isEditing = editing?.id === note.id;
                  return (
                    <article className="ci-note-entry" key={`${identity}:${note.id}:${note.revision}`}>
                      <div className="ci-note-entry-meta">
                        <strong>{note.authorName?.trim() || "作者未知"}</strong>
                        <span>
                          填写于 {displayTime(note.createdAt)}
                          {note.updatedAt !== note.createdAt
                            ? ` · 更新于 ${displayTime(note.updatedAt)}`
                            : ""}
                        </span>
                      </div>
                      {isEditing ? (
                        <div className="ci-note-edit-form">
                          <textarea
                            className="ci-note-textarea"
                            value={editing.content}
                            maxLength={MAX_CONTENT_LENGTH}
                            rows={3}
                            disabled={Boolean(busy) || retryLocked === "edit"}
                            onChange={event => {
                              editFrozen.current = null;
                              setEditing(currentEdit =>
                                currentEdit
                                  ? { ...currentEdit, content: event.target.value }
                                  : currentEdit,
                              );
                              setMessage("");
                            }}
                          />
                          <div className="ci-note-edit-actions">
                            <span>{editing.content.length}/{MAX_CONTENT_LENGTH}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="ci-button"
                              disabled={Boolean(busy) || retryLocked === "edit"}
                              onClick={() => {
                                editFrozen.current = null;
                                setEditing(null);
                                setMessage("");
                              }}
                            >
                              取消
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="ci-button ci-primary"
                              disabled={Boolean(busy)}
                              onClick={() => void submitEdit()}
                            >
                              {busy === "edit"
                                ? "正在保存…"
                                : retryLocked === "edit"
                                  ? "按原请求重试"
                                  : "保存修改"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p>{note.content}</p>
                      )}
                      {note.canEdit && !isEditing ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ci-inline-link ci-note-edit-link"
                          disabled={Boolean(busy) || Boolean(retryLocked)}
                          onClick={() => beginEdit(note)}
                        >
                          修改我的备注
                        </Button>
                      ) : null}
                    </article>
                  );
                })
              ) : response?.legacyNote ? null : (
                <p className="ci-notes-empty">暂无新增备注。</p>
              )}
            </section>

            {response && pageCount > 1 ? (
              <nav className="ci-notes-pagination" aria-label="备注分页">
                <span>
                  共 {total} 条，第 {response.page} / {pageCount} 页
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ci-button"
                  disabled={response.page <= 1 || Boolean(busy) || Boolean(retryLocked)}
                  onClick={() => {
                    editFrozen.current = null;
                    setEditing(null);
                    setMessage("");
                    setPage(value => Math.max(1, value - 1));
                  }}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ci-button"
                  disabled={response.page >= pageCount || Boolean(busy) || Boolean(retryLocked)}
                  onClick={() => {
                    editFrozen.current = null;
                    setEditing(null);
                    setMessage("");
                    setPage(value => Math.min(pageCount, value + 1));
                  }}
                >
                  下一页
                </Button>
              </nav>
            ) : null}

            <section className="ci-note-add" aria-label="新增备注">
              <label htmlFor={`ci-note-add-${identity}`}>新增备注</label>
              <textarea
                id={`ci-note-add-${identity}`}
                className="ci-note-textarea"
                value={draft}
                maxLength={MAX_CONTENT_LENGTH}
                rows={3}
                disabled={Boolean(busy) || retryLocked === "add"}
                placeholder="填写团队共享的库存备注"
                onChange={event => {
                  setDraft(event.target.value);
                  setMessage("");
                }}
              />
              <div className="ci-note-add-meta">
                <span>{draft.length}/{MAX_CONTENT_LENGTH}</span>
                <Button
                  type="button"
                  size="sm"
                  className="ci-button ci-primary"
                  disabled={Boolean(busy) || !draft.trim()}
                  onClick={() => void submitAdd()}
                >
                  {busy === "add"
                    ? "正在保存…"
                    : retryLocked === "add"
                      ? "按原请求重试"
                      : "保存备注"}
                </Button>
              </div>
            </section>
          </>
        )}

        {message ? <p className="ci-error" role="alert">{message}</p> : null}

        <DialogFooter className="ci-dialog-footer">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ci-button"
            disabled={Boolean(busy) || Boolean(retryLocked)}
            onClick={onClose}
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
