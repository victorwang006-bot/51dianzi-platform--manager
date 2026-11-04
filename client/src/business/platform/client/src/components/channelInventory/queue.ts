import type { Payload } from "./import";

export type BatchReceipt = { item: unknown; idempotent: boolean; channelId: number; customerId: number };

export type BatchEntry = {
  row: number;
  requestId: string;
  payload: Payload;
  status: "pending" | "success" | "unknown";
  error?: string;
  receipt?: BatchReceipt;
};

export type BatchOptions = {
  submit: (payload: Payload, requestId: string) => Promise<unknown>;
  isCurrent: () => boolean;
  shouldStop: () => boolean;
  onProgress: (entries: BatchEntry[]) => void;
  receiptFromResult?: (response: unknown) => BatchReceipt;
};

function copyEntries(entries: readonly BatchEntry[]): BatchEntry[] {
  return entries.map((entry) => ({ ...entry, payload: { ...entry.payload } }));
}

function result(entries: readonly BatchEntry[], complete: boolean, reason?: string): {
  entries: BatchEntry[];
  complete: boolean;
  reason?: string;
} {
  return reason === undefined
    ? { entries: copyEntries(entries), complete }
    : { entries: copyEntries(entries), complete, reason };
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const message = String(error);
  return message === "" ? "提交失败" : message;
}

/**
 * Runs sequentially so a later record is never submitted after an earlier request
 * is uncertain. Existing request IDs and payloads are reused for unknown retries.
 */
export async function runBatch(
  entries: BatchEntry[],
  options: BatchOptions,
): Promise<{ entries: BatchEntry[]; complete: boolean; reason?: string }> {
  const current = copyEntries(entries);

  for (let index = 0; index < current.length; index += 1) {
    const entry = current[index];
    if (entry.status === "success") continue;

    // Never begin a request for a stale actor/context, and retain its pending/unknown state.
    if (!options.isCurrent()) return result(current, false, "context-changed");
    if (options.shouldStop()) return result(current, false, "stopped");

    let receipt: BatchReceipt | undefined;
    try {
      const response = await options.submit({ ...entry.payload }, entry.requestId);
      if (options.isCurrent()) receipt = options.receiptFromResult?.(response);
    } catch (error) {
      // If context changed while an in-flight request failed, do not claim its outcome.
      if (!options.isCurrent()) return result(current, false, "context-changed");
      const { error: _previousError, ...withoutError } = entry;
      current[index] = { ...withoutError, status: "unknown", error: failureMessage(error) };
      options.onProgress(copyEntries(current));
      return result(current, false, "error");
    }

    // A request may have reached the server, but a new actor must not receive a result
    // or cause subsequent requests; preserve this entry as pending for reconciliation.
    if (!options.isCurrent()) return result(current, false, "context-changed");

    const { error: _previousError, ...withoutError } = entry;
    current[index] = { ...withoutError, status: "success", ...(receipt ? { receipt } : {}) };
    options.onProgress(copyEntries(current));
  }

  return result(current, true);
}
