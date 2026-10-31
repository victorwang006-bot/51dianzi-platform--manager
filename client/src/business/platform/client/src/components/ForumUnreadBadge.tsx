import ChatUnreadBadge from "./ChatUnreadBadge";
import { trpc } from "../../../../api/business-trpc";

export const FORUM_UNREAD_REFRESH_MS = 5_000;

export function useForumUnreadTotal(enabled: boolean) {
  const query = trpc.forum.unreadState.useQuery(undefined, {
    enabled,
    retry: false,
    refetchInterval: enabled ? FORUM_UNREAD_REFRESH_MS : false,
    refetchOnWindowFocus: true,
  });
  const compatibilityState = query.data as {
    notificationMode?: "all" | "mentions" | "muted";
    notificationsMuted?: boolean;
    unreadCount?: number;
  } | undefined;
  const notificationMode = compatibilityState?.notificationMode
    ?? (compatibilityState?.notificationsMuted ? "muted" : "all");

  return {
    total: enabled && notificationMode !== "muted"
      ? Math.max(0, Number(compatibilityState?.unreadCount ?? 0))
      : 0,
    query,
  };
}

export default function ForumUnreadBadge({
  count,
  className = "",
  placement = "absolute",
  reserveSpace = false,
}: {
  count: number;
  className?: string;
  placement?: "absolute" | "inline" | "nav";
  reserveSpace?: boolean;
}) {
  return (
    <ChatUnreadBadge
      count={count}
      className={className}
      placement={placement}
      reserveSpace={reserveSpace}
      ariaLabel={`${count} 条论坛未读消息`}
    />
  );
}
