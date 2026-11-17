import type { ChannelReferenceLookupResult, ChannelReferenceRow, ChannelReferenceSource } from "@shared/channelReference";
import type { ChannelReferenceRefreshDiagnostic } from "@shared/channelReferenceRefresh";
import { channelReferenceHasPrice, channelReferenceLookupResult, CHANNEL_REFERENCE_POLL_INTERVAL_MS, CHANNEL_REFERENCE_POLL_LIMIT_MS, CHANNEL_REFERENCE_STATUS_LABELS } from "./channelReferenceModel";

export type ChannelReferenceProgress = ChannelReferenceLookupResult & { loading?: boolean };
export class ChannelReferenceBindingError extends Error {}
const states = new Set(["idle", "disabled", "queued", "running", "cooldown", "blocked", "queue_full", "completed", "unavailable"]);
function time(value: unknown) {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day); calendar.setUTCHours(hour, minute, second, 0);
  return year > 0 && calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day
    && calendar.getUTCHours() === hour && calendar.getUTCMinutes() === minute && calendar.getUTCSeconds() === second;
}
const version = (value: unknown) => value === null || typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

/** Diagnostics are public evidence, never authorization or a client-side brand rule. */
export function channelReferenceProgress(value: unknown, rows: readonly { id: number; partNumber: string; brand: string }[]): ChannelReferenceProgress {
  try {
    const result = channelReferenceLookupResult(value, rows) as ChannelReferenceProgress;
    if (rows.length < 1 || rows.length > 20 || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !Number.isSafeInteger(row.id) || row.id <= 0)) throw new Error("Invalid current rows");
    if (result.loading !== undefined && typeof result.loading !== "boolean") throw new Error("Invalid loading state");
    if (result.refreshDiagnostics !== undefined) {
      if (!Array.isArray(result.refreshDiagnostics) || result.refreshDiagnostics.length > rows.length * 2) throw new Error("Invalid diagnostics");
      const ids = new Set(rows.map(row => row.id));
      const seen = new Set<string>();
      for (const d of result.refreshDiagnostics) {
        if (!d || typeof d !== "object" || !ids.has(d.materialId) || !["lcsc", "ickey"].includes(d.source) || !states.has(d.state)) throw new Error("Foreign diagnostic");
        const key = `${d.materialId}:${d.source}`;
        if (seen.has(key) || !time(d.lastAttemptAt) || !time(d.nextAllowedAt)
          || d.lastAttemptStatus !== null && !Object.hasOwn(CHANNEL_REFERENCE_STATUS_LABELS, d.lastAttemptStatus)
          || !version(d.referenceVersion) || d.sourceSha256 !== null && (typeof d.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(d.sourceSha256))) throw new Error("Malformed diagnostic");
        seen.add(key);
      }
    }
    return result;
  } catch { throw new ChannelReferenceBindingError("参考响应或诊断与当前授权库存页不匹配"); }
}
export function channelReferenceInProgress(result: ChannelReferenceProgress) {
  return result.loading === true || result.items.some(row => row.references.lcsc.status === "pending" || row.references.ickey.status === "pending")
    || result.refreshDiagnostics?.some(d => d.state === "queued" || d.state === "running") === true;
}
export const CHANNEL_REFERENCE_REFRESH_LABELS: Record<ChannelReferenceRefreshDiagnostic["state"], string> = {
  idle: "保存记录", disabled: "重查未启用", queued: "已排队", running: "正在重查", cooldown: "重查冷却中",
  blocked: "来源访问受限，已停止", queue_full: "重查队列已满", completed: "本次尝试已结束", unavailable: "重查服务不可用",
};
export function channelReferenceRefreshMessage(result: ChannelReferenceProgress, manual: boolean) {
  const reasons = Array.from(new Set((result.refreshDiagnostics ?? []).filter(d => ["disabled", "cooldown", "blocked", "queue_full", "unavailable"].includes(d.state)).map(d => CHANNEL_REFERENCE_REFRESH_LABELS[d.state])));
  if (channelReferenceInProgress(result)) return `正在核对当前页未匹配来源${reasons.length ? `；${reasons.join("；")}` : ""}`;
  if (reasons.length) return reasons.join("；");
  if (!manual) return "保存记录（非实时）";
  return result.refreshDiagnostics?.some(d => d.state === "completed")
    ? "已读取本次尝试结果，保存记录非实时；未匹配项仍保留真实状态"
    : "已读取保存记录，未确认重查完成";
}

function keepSuccessfulReferences(result: ChannelReferenceProgress, previous: ChannelReferenceRow[]): ChannelReferenceProgress {
  const prior = new Map(previous.map(row => [row.materialId, row]));
  return { ...result, items: result.items.map(row => {
    const old = prior.get(row.materialId);
    if (!old || old.partNumber !== row.partNumber || old.brand !== row.brand) return row;
    const references = { ...row.references };
    for (const source of ["lcsc", "ickey"] as ChannelReferenceSource[]) {
      if (old.references[source].status === "ok" && channelReferenceHasPrice(old.references[source]) && row.references[source].status === "pending") references[source] = old.references[source];
    }
    return { ...row, references };
  }) };
}

/** One explicit refresh, then read-only polling; busy spans the entire finite session. */
export function startChannelReferenceRefresh(options: {
  lookup: (refresh: boolean, signal: AbortSignal) => Promise<unknown>;
  rows: readonly { id: number; partNumber: string; brand: string }[];
  refresh: boolean; previousItems?: ChannelReferenceRow[]; isCurrent: () => boolean;
  onData: (result: ChannelReferenceProgress) => void;
  onError: (error: unknown) => void; onBusy: (busy: boolean) => void; onStopped: () => void;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let previous = options.previousItems ?? [];
  const current = () => !disposed && !controller.signal.aborted && options.isCurrent();
  const finish = () => { disposed = true; clearTimeout(deadline); clearTimeout(timer); controller.abort(); };
  const deadline = setTimeout(() => {
    if (!current()) { finish(); return; }
    options.onStopped(); options.onBusy(false); finish();
  }, CHANNEL_REFERENCE_POLL_LIMIT_MS);
  const request = async (refresh: boolean) => {
    if (!current()) { finish(); return; }
    try {
      const value = await options.lookup(refresh, controller.signal);
      if (!current()) return;
      const incoming = channelReferenceProgress(value, options.rows);
      const result = keepSuccessfulReferences(incoming, previous);
      previous = result.items;
      options.onData(result);
      if (channelReferenceInProgress(incoming)) timer = setTimeout(() => void request(false), CHANNEL_REFERENCE_POLL_INTERVAL_MS);
      else { options.onBusy(false); finish(); }
    } catch (error) {
      if (current()) { options.onError(error); options.onBusy(false); finish(); }
    }
  };
  options.onBusy(true);
  void request(options.refresh);
  return finish;
}
