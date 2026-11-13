type AdminMessageSummaryUtils = {
  message: {
    unreadCount: { invalidate: () => Promise<unknown> };
    threads: { invalidate: () => Promise<unknown> };
  };
};

/** The existing shared operations unread count, never a personal task count. */
export function getAdminMessageUnreadTotal({
  canReadMessages,
  isError,
  data,
}: {
  canReadMessages: boolean;
  isError: boolean;
  data?: { total: number };
}): number {
  // Disabled/error queries can retain data from their last successful request.
  if (!canReadMessages || isError) return 0;
  const total = data?.total ?? 0;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

export function getAdminMessageUnreadQueryOptions(canReadMessages: boolean) {
  return {
    enabled: canReadMessages,
    refetchInterval: canReadMessages ? 30000 : false as const,
    refetchOnWindowFocus: "always" as const,
  };
}

/** Invalidate all list filters and the badge on the existing root tRPC cache.
 * Never invalidate detail here: detail reads already mark the thread as read,
 * and invalidating detail after its own success would create a refetch loop.
 */
export async function invalidateAdminMessageSummaries(
  utils: AdminMessageSummaryUtils,
) {
  await Promise.all([
    utils.message.unreadCount.invalidate(),
    utils.message.threads.invalidate(),
  ]);
}
