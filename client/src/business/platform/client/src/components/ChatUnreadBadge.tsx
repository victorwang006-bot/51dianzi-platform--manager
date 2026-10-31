import { useEffect, useRef } from "react";
import { trpc } from "../../../../api/business-trpc";

export const CHAT_UNREAD_REFRESH_MS = 5_000;

export function useChatUnreadTotal(enabled: boolean) {
  const query = trpc.chat.getTotalUnread.useQuery(undefined, {
    enabled,
    refetchInterval: enabled ? CHAT_UNREAD_REFRESH_MS : false,
    refetchOnWindowFocus: true,
  });

  return {
    total: enabled ? Math.max(0, Number(query.data?.total ?? 0)) : 0,
    query,
  };
}

export function formatChatUnreadCount(count: number) {
  return count >= 100 ? "99+" : String(Math.max(0, count));
}

/**
 * 浏览器标签页同步展示总未读数。只改数字前缀，不覆盖页面自己的标题。
 */
export function useChatUnreadDocumentTitle(count: number, enabled: boolean) {
  const baseTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (baseTitleRef.current === null) {
      baseTitleRef.current = document.title.replace(/^\(\d+\+?\)\s*/, "");
    }
    const baseTitle = baseTitleRef.current;
    document.title = enabled && count > 0
      ? `(${formatChatUnreadCount(count)}) ${baseTitle}`
      : baseTitle;
    return () => {
      document.title = baseTitle;
    };
  }, [count, enabled]);
}

export default function ChatUnreadBadge({
  count,
  className = "",
  ariaLabel,
  placement = "absolute",
  reserveSpace = false,
}: {
  count: number;
  className?: string;
  ariaLabel?: string;
  placement?: "absolute" | "inline" | "nav";
  reserveSpace?: boolean;
}) {
  if (count <= 0) {
    return placement === "inline" && reserveSpace ? (
      <span
        className={`relative ml-1 inline-block h-[18px] min-w-[18px] shrink-0 ${className}`}
        aria-hidden="true"
      />
    ) : null;
  }
  const label = formatChatUnreadCount(count);
  const accessibleLabel = ariaLabel ?? `${count} 条未读消息`;
  const placementClass = placement === "absolute"
    ? "absolute -right-[9px] -top-[7px]"
    : placement === "nav"
      ? "absolute right-[2px] -top-[3px] z-[1]"
      : "relative ml-1 shrink-0";

  return (
    <span
      className={`${placementClass} inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#E5484D] px-[5px] text-[11px] font-semibold leading-[18px] text-white tabular-nums ring-2 ring-white ${className}`}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      role="status"
    >
      {label}
    </span>
  );
}
