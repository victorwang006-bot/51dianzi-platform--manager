// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demandFreshReadOptions, useDemandReceiptGuard, useDemandServerRead } from "./useDemandReadSession";
import { getDemandQuotePending, registerDemandQuotePending, settleDemandQuotePending, useDemandQuotePending } from "./useDemandQuotePending";

let host: HTMLDivElement, root: Root, client: QueryClient;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function render(children: React.ReactNode) {
  act(() => root.render(h(QueryClientProvider, { client }, children)));
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });

describe("真实 TanStack 首读缓存与旧 pending 隔离（纯本地 promise）", () => {
  it("cached success is not first-mount proof, then retains the verified snapshot during regular refetch", async () => {
    const first = deferred<{ label: string }>(), second = deferred<{ label: string }>();
    const queryFn = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const snapshots: any[] = [];
    client.setQueryData(["synthetic-demand", 12, 41], { label: "旧成功缓存" });
    function Probe() {
      const query = useQuery({ queryKey: ["synthetic-demand", 12, 41], queryFn, ...demandFreshReadOptions });
      const read = useDemandServerRead(query, "actor7:enterprise31:customer12:demand41");
      snapshots.push({ status: query.status, fetching: query.isFetching, afterMount: query.isFetchedAfterMount, cached: query.data?.label });
      return h("p", null, read.data?.label ?? "首读核验中");
    }
    render(h(Probe)); await flush();
    expect(snapshots.some(snapshot => snapshot.status === "success" && snapshot.fetching && !snapshot.afterMount && snapshot.cached === "旧成功缓存")).toBe(true);
    expect(host.textContent).toBe("首读核验中");
    await act(async () => first.resolve({ label: "本次服务器证明" })); await flush();
    expect(host.textContent).toBe("本次服务器证明");
    await act(async () => { void client.invalidateQueries({ queryKey: ["synthetic-demand", 12, 41] }); }); await flush();
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("本次服务器证明");
    await act(async () => second.resolve({ label: "普通刷新结果" })); await flush();
    expect(host.textContent).toBe("普通刷新结果");
  });

  it.each(["success", "error"])("old native %s receipts and pending cannot notify a new same-demand session", async outcome => {
    const old = deferred<{ acceptedQty: number }>(), fresh = deferred<{ acceptedQty: number }>();
    const receipts = vi.fn(), errors = vi.fn();
    const oldSession = {}, newSession = {};
    function Pending({ session }: { session: object }) {
      const pending = useDemandQuotePending(41, session);
      return h("output", { "data-testid": "pending" }, String(pending));
    }
    function Writer({ identity, session, promise }: { identity: string; session: object; promise: Promise<{ acceptedQty: number }> }) {
      const guard = useDemandReceiptGuard(identity, true);
      const mutation = useMutation({
        mutationKey: ["synthetic", "quoteAccept"],
        meta: { customerDemandSession: session },
        mutationFn: (_input: { demandId: number }) => promise,
        onMutate: () => ({ isCurrent: guard.capture(), pendingToken: registerDemandQuotePending(41, session) }),
        onSuccess: (data, _variables, context) => { if (context?.isCurrent()) receipts(data); },
        onError: (error, _variables, context) => { if (context?.isCurrent()) errors(error); },
        onSettled: (_data, _error, _variables, context) => settleDemandQuotePending(context?.pendingToken),
      });
      return h("button", { onClick: () => mutation.mutate({ demandId: 41 }) }, "采用");
    }
    const tree = (identity: string, session: object, promise: Promise<{ acceptedQty: number }>) => h(React.Fragment, null,
      h(Writer, { key: identity, identity, session, promise }), h(Pending, { session }));
    render(tree("actor7:enterprise31:customer12:demand41:auth1", oldSession, old.promise));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
    expect(host.querySelector("output")?.textContent).toBe("true");
    render(tree("actor8:enterprise32:customer12:demand41:auth2", newSession, fresh.promise)); await flush();
    expect(host.querySelector("output")?.textContent).toBe("false");
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
    expect(host.querySelector("output")?.textContent).toBe("true");
    await act(async () => { if (outcome === "success") old.resolve({ acceptedQty: 77 }); else old.reject(new Error("synthetic old rejection")); }); await flush();
    expect(receipts).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
    // The old settlement must not release the new session's pending lock.
    expect(host.querySelector("output")?.textContent).toBe("true");
    await act(async () => fresh.resolve({ acceptedQty: 21 })); await flush();
    expect(receipts).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveBeenCalledWith({ acceptedQty: 21 });
    expect(host.querySelector("output")?.textContent).toBe("false");
  });
});

function PendingProbe({ demandId, session }: { demandId?: number; session?: object }) {
  return h("output", null, String(useDemandQuotePending(demandId, session)));
}

describe("owned callback registry 的真实 TanStack 生命周期（无外部网络）", () => {
  it.each(["success", "error"])("multiple concurrent native tokens survive one %s and only the final settlement unlocks", async firstOutcome => {
    const session = {}, one = deferred<number>(), two = deferred<number>(), three = deferred<number>();
    const promises = [one, two, three];
    const mutationFn = vi.fn((input: { demandId: number; requestId: string; index: number }) => promises[input.index].promise);
    const onMutate = vi.fn(() => ({ pendingToken: registerDemandQuotePending(41, session) }));
    const onSettled = vi.fn((_data, _error, _input, context) => settleDemandQuotePending(context?.pendingToken));
    function Writer() {
      const mutation = useMutation({ mutationFn, onMutate, onSettled, meta: { customerDemandSession: session } });
      return h("button", { onClick: () => {
        for (let index = 0; index < 3; index += 1) mutation.mutate({ demandId: 41, requestId: `original-${index}`, index });
      } }, "并发采用");
    }
    render(h(React.Fragment, null, h(Writer), h(PendingProbe, { demandId: 41, session })));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
    expect(host.querySelector("output")?.textContent).toBe("true");
    expect(mutationFn).toHaveBeenCalledTimes(3);
    expect(onMutate).toHaveBeenCalledTimes(3);
    const tokens = onMutate.mock.results.map(result => result.value.pendingToken);
    expect(new Set(tokens).size).toBe(3);
    expect(mutationFn.mock.calls.map(([input]) => input)).toEqual([0, 1, 2].map(index => ({ demandId: 41, requestId: `original-${index}`, index })));
    await act(async () => { if (firstOutcome === "success") one.resolve(1); else one.reject(new Error("local rejection")); }); await flush();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(host.querySelector("output")?.textContent).toBe("true");
    // Duplicate/late settlement is idempotent, not a session-wide boolean reset.
    act(() => settleDemandQuotePending(tokens[0]));
    expect(getDemandQuotePending(41, session)).toBe(true);
    await act(async () => two.reject(new Error("another local rejection"))); await flush();
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(host.querySelector("output")?.textContent).toBe("true");
    await act(async () => three.resolve(3)); await flush();
    expect(onSettled).toHaveBeenCalledTimes(3);
    expect(host.querySelector("output")?.textContent).toBe("false");
  });

  it.each(["same-demand-remount", "actor", "authorization-ABA", "demand-ABA"])("new %s session is isolated before it writes, and old native receipts cannot release its lock", async transition => {
    const old = deferred<number>(), fresh = deferred<number>();
    const oldSession = {}, newSession = {}, middleSession = {};
    const receipts = vi.fn(), errors = vi.fn(), mutationFn = vi.fn((_input: { demandId: number; requestId: string }, promise: Promise<number>) => promise);
    function Writer({ identity, demandId, session, promise }: { identity: string; demandId: number; session: object; promise: Promise<number> }) {
      const guard = useDemandReceiptGuard(identity, true);
      const mutation = useMutation({
        mutationFn: (input: { demandId: number; requestId: string }) => mutationFn(input, promise),
        onMutate: () => ({ isCurrent: guard.capture(), pendingToken: registerDemandQuotePending(demandId, session) }),
        onSuccess: (data, _input, context) => { if (context?.isCurrent()) receipts(data); },
        onError: (error, _input, context) => { if (context?.isCurrent()) errors(error); },
        onSettled: (_data, _error, _input, context) => settleDemandQuotePending(context?.pendingToken),
      });
      return h("button", { onClick: () => mutation.mutate({ demandId, requestId: identity }) }, "采用");
    }
    const tree = (mount: string, identity: string, demandId: number, session: object, promise: Promise<number>) => h(React.Fragment, null,
      h(Writer, { key: mount, identity, demandId, session, promise }), h(PendingProbe, { demandId, session }));
    const identityA = "actor7:enterprise31:customer12:authA";
    render(tree("old", identityA, 41, oldSession, old.promise));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
    expect(host.querySelector("output")?.textContent).toBe("true");
    if (transition.endsWith("ABA")) {
      render(tree("middle", "actor7:enterprise31:customer12:authB", transition === "demand-ABA" ? 42 : 41, middleSession, fresh.promise));
      expect(host.querySelector("output")?.textContent).toBe("false");
    }
    render(tree("fresh", transition === "actor" ? "actor8:enterprise32:customer12:authC" : identityA, 41, newSession, fresh.promise));
    // Render-time snapshot must exclude old pending even without a cache event.
    expect(host.querySelector("output")?.textContent).toBe("false");
    expect(getDemandQuotePending(41, oldSession)).toBe(true);
    expect(mutationFn).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
    expect(host.querySelector("output")?.textContent).toBe("true");
    await act(async () => old.reject(new Error("stale native error"))); await flush();
    expect(receipts).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
    expect(getDemandQuotePending(41, oldSession)).toBe(false);
    expect(host.querySelector("output")?.textContent).toBe("true");
    await act(async () => fresh.resolve(25)); await flush();
    expect(receipts).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveBeenCalledWith(25);
    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelector("output")?.textContent).toBe("false");
    expect(mutationFn).toHaveBeenCalledTimes(2);
  });

  it("observer requires no QueryClient/provider and filters by exact session object plus demand", () => {
    const session = {}, equalLookingSession = {};
    const one = registerDemandQuotePending(41, session);
    const two = registerDemandQuotePending(42, session);
    try {
      act(() => root.render(h(PendingProbe, { demandId: 41, session })));
      expect(host.textContent).toBe("true");
      act(() => root.render(h(PendingProbe, { demandId: 41, session: equalLookingSession })));
      expect(host.textContent).toBe("false");
      act(() => root.render(h(PendingProbe, { demandId: 43, session })));
      expect(host.textContent).toBe("false");
      act(() => root.render(h(PendingProbe, { demandId: undefined, session })));
      expect(host.textContent).toBe("false");
      // Legacy demand-only observation is optional; the dialog never uses it.
      act(() => root.render(h(PendingProbe, { demandId: 41 })));
      expect(host.textContent).toBe("true");
      act(() => settleDemandQuotePending(one));
      expect(host.textContent).toBe("false");
      expect(getDemandQuotePending(42, session)).toBe(true);
    } finally { act(() => { settleDemandQuotePending(one); settleDemandQuotePending(two); }); }
  });

  it("native retry keeps one token and the exact original request variables until the retry settles", async () => {
    const session = {}, first = deferred<number>(), retry = deferred<number>();
    const mutationFn = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => retry.promise);
    const onMutate = vi.fn(() => ({ pendingToken: registerDemandQuotePending(41, session) }));
    const onSettled = vi.fn((_data, _error, _input, context) => settleDemandQuotePending(context?.pendingToken));
    const input = { demandId: 41, quoteId: 501, quoteVersion: 3, demandRevision: 2, requestId: "same-original-id", items: [{ demandItemId: 401, alternateNo: 1, qty: 37 }] };
    function Writer() {
      const mutation = useMutation({ mutationFn, onMutate, onSettled, retry: 1, retryDelay: 0 });
      return h("button", { onClick: () => mutation.mutate(input) }, "采用");
    }
    render(h(React.Fragment, null, h(Writer), h(PendingProbe, { demandId: 41, session })));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
    await act(async () => first.reject(new Error("synthetic retryable unknown result"))); await flush();
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(onMutate).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
    expect(host.querySelector("output")?.textContent).toBe("true");
    expect(mutationFn.mock.calls[0][0]).toBe(input);
    expect(mutationFn.mock.calls[1][0]).toBe(input);
    await act(async () => retry.resolve(37)); await flush();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(host.querySelector("output")?.textContent).toBe("false");
  });
});
