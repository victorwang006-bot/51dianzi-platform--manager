import { describe, expect, it, vi } from "vitest";
import {
  getAdminMessageUnreadQueryOptions,
  getAdminMessageUnreadTotal,
  invalidateAdminMessageSummaries,
} from "./adminMessageRefresh";

describe("shared operations message refresh", () => {
  it("hides cached unread without read permission, including permission revocation", () => {
    const snapshot = { data: { total: 7 }, isError: false };
    expect(getAdminMessageUnreadTotal({ ...snapshot, canReadMessages: true })).toBe(7);
    expect(getAdminMessageUnreadTotal({ ...snapshot, canReadMessages: false })).toBe(0);
  });

  it("hides a failed query's previous successful data and recovers after success", () => {
    expect(getAdminMessageUnreadTotal({ canReadMessages: true, isError: true, data: { total: 7 } })).toBe(0);
    expect(getAdminMessageUnreadTotal({ canReadMessages: true, isError: false, data: { total: 3 } })).toBe(3);
    expect(getAdminMessageUnreadTotal({ canReadMessages: true, isError: false })).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("does not display an invalid unread count %s", total => {
    expect(getAdminMessageUnreadTotal({ canReadMessages: true, isError: false, data: { total } })).toBe(0);
  });

  it("keeps the 30-second count query and always refreshes on window focus only when enabled", () => {
    expect(getAdminMessageUnreadQueryOptions(true)).toEqual({ enabled: true, refetchInterval: 30000, refetchOnWindowFocus: "always" });
    expect(getAdminMessageUnreadQueryOptions(false)).toEqual({ enabled: false, refetchInterval: false, refetchOnWindowFocus: "always" });
  });

  it("invalidates all unread/list filters without invalidating detail or other modules", async () => {
    const unread = vi.fn(async () => {});
    const threads = vi.fn(async () => {});
    const detail = vi.fn(async () => {});
    const module = vi.fn(async () => {});
    await invalidateAdminMessageSummaries({ message: { unreadCount: { invalidate: unread }, threads: { invalidate: threads }, detail: { invalidate: detail } }, moduleNotification: { invalidate: module } } as Parameters<typeof invalidateAdminMessageSummaries>[0]);
    expect(unread.mock.calls).toEqual([[]]);
    expect(threads.mock.calls).toEqual([[]]);
    expect(detail).not.toHaveBeenCalled();
    expect(module).not.toHaveBeenCalled();
  });
});
