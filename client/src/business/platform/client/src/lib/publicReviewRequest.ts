export function createPublicReviewRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const random = Math.random().toString(36).slice(2).padEnd(12, "0").slice(0, 12);
  return `review_${Date.now().toString(36)}_${random}`;
}
