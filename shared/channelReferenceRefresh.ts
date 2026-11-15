import type { ChannelReferenceSource, ChannelReferenceStatus } from "./channelReference";

/** Only currently re-authorized material IDs are returned. Persisted reference
 * state contains no material ID, actor, tenant or business quantity/price. */
export type ChannelReferenceRefreshDiagnostic = {
  materialId: number;
  source: ChannelReferenceSource;
  state: "idle" | "disabled" | "queued" | "running" | "cooldown" | "blocked" | "queue_full" | "completed" | "unavailable";
  lastAttemptAt: string | null;
  lastAttemptStatus: ChannelReferenceStatus | null;
  nextAllowedAt: string | null;
  referenceVersion: string | null;
  sourceSha256: string | null;
};
