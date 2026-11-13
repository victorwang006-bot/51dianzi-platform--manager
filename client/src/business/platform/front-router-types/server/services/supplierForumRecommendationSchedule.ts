import { beijingDay, inPublishWindow, instant, safety } from "./supplierForumRecommendationModel";

export const SUPPLIER_FORUM_DAILY_SLOTS = 12;
export const SUPPLIER_FORUM_SLOT_WINDOW_MS = 60_000;
const MINUTE = 60_000;
export type SupplierForumSlot = { slotNo: number; plannedAt: Date | string };
export type SupplierForumRunKey = { runId: number; day: string; slotNo: number };
/** Pure planner: caller supplies crypto.randomInt in production, deterministic RNG
 * in mock tests. Exactly one draw per bucket; persist ALL slots atomically before
 * any claim. Minute-aligned offsets 0..30 leave >=15 min between adjacent slots. */
export function planSupplierForumDay(day: string, randomOffset: (maxExclusive: number) => number): SupplierForumSlot[] {
  safety(/^\d{4}-\d{2}-\d{2}$/.test(day), "PLAN_DAY_INVALID");
  const start = Date.parse(`${day}T09:00:00+08:00`);
  safety(Number.isFinite(start) && beijingDay(new Date(start)) === day, "PLAN_DAY_INVALID");
  const slots = Array.from({ length: SUPPLIER_FORUM_DAILY_SLOTS }, (_, i) => {
    const offset = randomOffset(31);
    safety(Number.isInteger(offset) && offset >= 0 && offset < 31, "PLAN_RANDOM_INVALID");
    return { slotNo: i + 1, plannedAt: new Date(start + (i * 45 + offset) * MINUTE) };
  });
  assertSupplierForumDayPlan(day, slots);
  return slots;
}
export function assertSupplierForumDayPlan(day: string, slots: SupplierForumSlot[]): void {
  safety(slots.length === SUPPLIER_FORUM_DAILY_SLOTS, "DAY_PLAN_INVALID");
  const start = Date.parse(`${day}T09:00:00+08:00`);
  const sorted = [...slots].sort((a, b) => a.slotNo - b.slotNo);
  sorted.forEach((slot, i) => {
    const time = instant(slot.plannedAt), bucket = start + i * 45 * MINUTE;
    safety(slot.slotNo === i + 1 && Number.isFinite(time) && time % MINUTE === 0
      && time >= bucket && time <= bucket + 30 * MINUTE && beijingDay(new Date(time)) === day
      && inPublishWindow(new Date(time)), "DAY_PLAN_INVALID");
    safety(i === 0 || time - instant(sorted[i - 1].plannedAt) >= 15 * MINUTE, "DAY_PLAN_INVALID");
  });
}
/** No catch-up: only this persisted planned minute is eligible. Later invocations
 * do not claim/reclaim a missed slot, even if its status is still planned/claimed. */
export function inSupplierForumSlot(day: string, slot: SupplierForumSlot, now: Date): boolean {
  const time = instant(slot.plannedAt);
  return Number.isInteger(slot.slotNo) && slot.slotNo >= 1 && slot.slotNo <= SUPPLIER_FORUM_DAILY_SLOTS
    && inPublishWindow(now) && day === beijingDay(now) && Number.isFinite(time)
    && now.getTime() >= time && now.getTime() < time + SUPPLIER_FORUM_SLOT_WINDOW_MS;
}
export function supplierForumClientKey(day: string, slotNo: number): string {
  safety(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(slotNo) && slotNo >= 1 && slotNo <= 12, "CLIENT_KEY_INVALID");
  return `supplier_forum_${day.replaceAll("-", "")}_${String(slotNo).padStart(2, "0")}`;
}
/** Fail closed on a backwards or invalid wall clock within a worker invocation. */
export function supplierForumCheckedClock(clock: () => Date): () => Date {
  let last = -Infinity;
  return () => {
    const now = clock(), time = now.getTime();
    safety(Number.isFinite(time) && time >= last, "CLOCK_MOVED_BACKWARDS");
    last = time;
    return new Date(time);
  };
}
