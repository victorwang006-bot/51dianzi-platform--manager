import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";

export type ConversationDraftSetter = (next: SetStateAction<string>) => void;
type DraftState = { scopeKey: string | null; generation: number; drafts: Record<number, string> };

/** 常用语只追加到草稿；保留用户原有文字与换行。 */
export function appendConversationDraft(current: string, text: string) {
  return current ? `${current}\n${text}` : text;
}

/**
 * 页面实例内草稿，不读写 localStorage/sessionStorage，也不跨页面实例共享。
 * null scope 表示身份/权限未证实。读取在当前 render 即隔离，layout effect
 * 清除退出域与失去访问权的会话；旧异步 setter 即使切回同一身份也不能复活。
 */
export function useConversationDraft(
  activeConversationId: number | null,
  scopeKey: string | null,
  authorizedConversationIds?: readonly number[],
) {
  const live = useRef({ scopeKey, generation: 0, authorizedConversationIds });
  if (live.current.scopeKey !== scopeKey) {
    live.current = { scopeKey, generation: live.current.generation + 1, authorizedConversationIds };
  } else {
    live.current.authorizedConversationIds = authorizedConversationIds;
  }
  const generation = live.current.generation;
  const mounted = useRef(false);
  const [state, setState] = useState<DraftState>(() => ({ scopeKey, generation, drafts: {} }));
  const canAccess = (conversationId: number) => Number.isSafeInteger(conversationId) && conversationId > 0
    && (authorizedConversationIds === undefined || authorizedConversationIds.includes(conversationId));

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    setState(current => {
      if (!scopeKey || current.scopeKey !== scopeKey || current.generation !== generation) {
        if (current.scopeKey === scopeKey && current.generation === generation
          && Object.keys(current.drafts).length === 0) return current;
        return { scopeKey, generation, drafts: {} };
      }
      if (authorizedConversationIds === undefined) return current;
      const drafts = Object.fromEntries(Object.entries(current.drafts)
        .filter(([id]) => authorizedConversationIds.includes(Number(id))));
      return Object.keys(drafts).length === Object.keys(current.drafts).length ? current : { ...current, drafts };
    });
  }, [scopeKey, generation, authorizedConversationIds]);

  const clearDrafts = useCallback(() => {
    live.current.generation += 1;
    setState({ scopeKey: live.current.scopeKey, generation: live.current.generation, drafts: {} });
  }, []);

  useEffect(() => {
    // Global exit signals clear before a delayed authentication query can settle.
    const onStorage = (event: StorageEvent) => {
      if (event.key === "51dianzi:auth-session-cleared:v1" && event.newValue) clearDrafts();
    };
    window.addEventListener("51dianzi:auth-session-cleared", clearDrafts);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("51dianzi:auth-session-cleared", clearDrafts);
      window.removeEventListener("storage", onStorage);
    };
  }, [clearDrafts]);

  const setConversationDraft = useCallback((conversationId: number, next: SetStateAction<string>) => {
    setState(current => {
      const proof = live.current;
      if (!mounted.current || !scopeKey || proof.scopeKey !== scopeKey || proof.generation !== generation
        || !Number.isSafeInteger(conversationId) || conversationId <= 0
        || (proof.authorizedConversationIds !== undefined && !proof.authorizedConversationIds.includes(conversationId))) return current;
      const scoped = current.scopeKey === scopeKey && current.generation === generation
        ? current : { scopeKey, generation, drafts: {} };
      const previous = scoped.drafts[conversationId] ?? "";
      const value = typeof next === "function" ? next(previous) : next;
      if (value === previous && scoped === current) return current;
      const drafts = { ...scoped.drafts };
      if (value) drafts[conversationId] = value;
      else delete drafts[conversationId];
      return { ...scoped, drafts };
    });
  }, [scopeKey, generation]);

  const setMsgInput: ConversationDraftSetter = useCallback(next => {
    if (activeConversationId !== null) setConversationDraft(activeConversationId, next);
  }, [activeConversationId, setConversationDraft]);

  return {
    msgInput: scopeKey && state.scopeKey === scopeKey && state.generation === generation
      && activeConversationId !== null && canAccess(activeConversationId)
      ? state.drafts[activeConversationId] ?? "" : "",
    setMsgInput,
    setConversationDraft,
    clearDrafts,
  };
}
