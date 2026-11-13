import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "./api/business-trpc";
import { useBusinessScope } from "./BusinessScope";
import {
  INQUIRY_RECEPTION_CONVERSATION_OPTIONS,
  INQUIRY_RECEPTION_REFRESH_MS,
  receptionUnreadTotal,
  type InquiryReceptionRow,
} from "./InquiryReceptionModel";

export function useInquiryReceptionUnread(enabled: boolean) {
  const query = trpc.chat.listConversations.useQuery(undefined, {
    ...INQUIRY_RECEPTION_CONVERSATION_OPTIONS,
    enabled,
  });
  return {
    query,
    conversations: enabled && !query.isError ? query.data ?? [] : [],
    total: enabled && !query.isError ? receptionUnreadTotal(query.data ?? []) : 0,
  };
}

export function useInquiryReception() {
  const scope = useBusinessScope();
  const utils = trpc.useUtils();
  const enterprise = trpc.enterprise.me.useQuery(undefined, {
    ...INQUIRY_RECEPTION_CONVERSATION_OPTIONS,
    enabled: scope.sessionCapabilities.receptionReady === true,
  });
  const permissionKeys: readonly string[] = enterprise.data?.permissionKeys ?? [];
  const canReceive = scope.sessionCapabilities.receptionReady === true && !enterprise.isError &&
    Boolean(enterprise.data?.isOwner || permissionKeys.includes("inquiry.receive"));
  const unread = useInquiryReceptionUnread(canReceive);
  const inbox = useQuery({
    queryKey: ["inquiry-reception-queue", scope.storageScope, scope.contextVerification.authorizationVersion],
    enabled: canReceive,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    refetchInterval: INQUIRY_RECEPTION_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        const readPage = (page: number) => utils.client.enterprise.inquiryInbox.query(
          { status: "all", page, pageSize: 100 }, { signal },
        );
        const first = await readPage(1);
        const rows: InquiryReceptionRow[] = [...first.rows];
        const pages = Math.ceil(first.total / 100);
        // Four bounded reads per batch. Search/status covers the entire authorized
        // queue, not just the current twenty-item page. Abort on identity teardown.
        for (let page = 2; page <= pages; page += 4) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          const batch = await Promise.all(Array.from({ length: Math.min(4, pages - page + 1) }, (_, i) => readPage(page + i)));
          batch.forEach(result => rows.push(...result.rows));
        }
        const unique = new Map(rows.map(row => [row.id, row]));
        return Array.from(unique.values());
      } catch (error) {
        if (!signal.aborted) scope.onAuthorizationError(error);
        throw error;
      }
    },
  });
  const refresh = useCallback(async () => {
    await Promise.all([enterprise.refetch(), inbox.refetch(), unread.query.refetch()]);
  }, [enterprise.refetch, inbox.refetch, unread.query.refetch]);
  return { scope, enterprise, canReceive, inbox, ...unread, refresh };
}

/** Optional sound never enables itself, and no notification provider is added. */
export function useInquiryReceptionNotice(identity: string, conversations: ReturnType<typeof useInquiryReceptionUnread>["conversations"], ready: boolean) {
  const [sound, setSound] = useState(false);
  const [notice, setNotice] = useState("");
  const previous = useRef<Map<number, { unread: number; stamp: string }> | null>(null);
  useEffect(() => {
    previous.current = null;
    setNotice("");
    setSound(false);
  }, [identity]);
  useEffect(() => {
    if (!ready) return;
    const next = new Map(conversations.map(item => [item.id, {
      unread: Math.max(0, Number(item.unreadCount) || 0), stamp: String(item.lastMessageAt),
    }]));
    const incoming = previous.current && conversations.find(item => {
      const before = previous.current?.get(item.id);
      return item.unreadCount > 0 && (!before || item.unreadCount > before.unread || String(item.lastMessageAt) !== before.stamp);
    });
    previous.current = next;
    if (!incoming) return;
    setNotice(`收到新的询价消息：${incoming.otherUserName}`);
    if (!sound || document.hidden) return;
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.frequency.value = 660; gain.gain.value = 0.035;
      oscillator.start(); oscillator.stop(audio.currentTime + 0.15);
      oscillator.onended = () => { void audio.close(); };
    } catch { /* Audio autoplay policy does not affect delivery or unread state. */ }
  }, [conversations, ready, sound]);
  return { sound, setSound, notice, dismiss: () => setNotice("") };
}
