// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { BusinessWorkbenchSession, retainBusinessQueryClient } from "./BusinessWorkbenchSession";
describe("shared authorized reception cache lifetime", () => {
  it("does not cancel active page reads when its navigation consumer leaves", () => {
    const client = new QueryClient(); const cancel = vi.spyOn(client, "cancelQueries");
    const releaseNavigation = retainBusinessQueryClient(client); const releasePage = retainBusinessQueryClient(client);
    releaseNavigation(); expect(cancel).not.toHaveBeenCalled();
    releasePage(); expect(cancel).toHaveBeenCalledTimes(1);
    releasePage(); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("handles discovery/context/domain independently and retains completed cache for ordinary route re-entry", () => {
    const first = new QueryClient(); const second = new QueryClient();
    first.setQueryData(["inquiry-only-unread"], 4);
    const cancelFirst = vi.spyOn(first, "cancelQueries"); const cancelSecond = vi.spyOn(second, "cancelQueries");
    const releaseFirst = retainBusinessQueryClient(first); const releaseSecond = retainBusinessQueryClient(second);
    releaseFirst(); expect(cancelFirst).toHaveBeenCalledTimes(1); expect(cancelSecond).not.toHaveBeenCalled();
    expect(first.getQueryData(["inquiry-only-unread"])).toBe(4); releaseSecond();
  });
  it("revocation still aborts every retained consumer and discards unread immediately", () => {
    const session = new BusinessWorkbenchSession(7, () => {}); session.confirmAuthorization("enterprise:1");
    const resources = session.domainResources("enterprise:1"); resources.client.setQueryData(["unread"], 5);
    const releasePage = retainBusinessQueryClient(resources.client); const releaseNavigation = retainBusinessQueryClient(resources.client);
    session.revoke(); expect(resources.abort.signal.aborted).toBe(true); expect(resources.client.getQueryData(["unread"])).toBeUndefined(); expect(session.denied).toBe(true);
    releasePage(); releaseNavigation();
  });
});
