// @vitest-environment jsdom
import * as React from "react";
import { act, createElement, startTransition, StrictMode, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SaveError = { message: string; data?: { code: string } };
type SaveResult = { status: "in_transit" | "received"; slipNo: string };
type SaveAttempt = {
  input: any;
  success: (result: SaveResult) => void;
  fail: (error: SaveError) => void;
};
const runtime = vi.hoisted(() => ({
  storage: "synthetic-account-a:enterprise-a",
  activeStorage: "synthetic-account-a:enterprise-a" as string | null,
  identity: "synthetic-account-a:enterprise-a",
  authorization: "synthetic-proof-1",
  verified: true,
  location: "/inbound",
  onAuthError: undefined as ((error: unknown) => void) | undefined,
  authErrorSpy: vi.fn(),
  createOptions: undefined as any,
  attempts: [] as SaveAttempt[],
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  refetch: vi.fn(),
  invalidate: vi.fn(),
  upload: vi.fn(),
  errorToast: vi.fn(),
  successToast: vi.fn(),
  suspend: false,
  speculativeVersions: [] as string[],
  authorizationContext: undefined as unknown as React.Context<string>,
}));
vi.mock("../../../../BusinessContentFrame", () => ({ default: ({ children }: any) => children }));
vi.mock("../../../../BusinessScope", async () => {
  const { createContext, useContext } = await import("react");
  runtime.authorizationContext = createContext("synthetic-proof-1");
  return {
    businessStorageScope: () => runtime.activeStorage,
    useBusinessScope: () => {
      const authorizationVersion = useContext(runtime.authorizationContext);
      runtime.speculativeVersions.push(authorizationVersion);
      return {
        frontUser: { id: 201 }, merchantId: 301,
        staffPrincipal: { frontendUserId: 201 }, storageScope: runtime.storage,
        contextVerification: { state: runtime.verified ? "verified" : "revalidating", identity: runtime.identity, authorizationVersion },
        onAuthorizationError: runtime.onAuthError,
      };
    },
  };
});
vi.mock("../components/companyStock/useCompanyStockSession", () => ({
  useCompanyStockScope: () => ({ ready: true, identityKey: runtime.storage, storageScope: runtime.storage }),
}));
vi.mock("../../../../../lib/adminNewInformation", async importOriginal => ({
  ...(await importOriginal<any>()),
  useAdminNewInformationContextRows: () => ({ getRow: () => ({ isNew: false, ref: undefined }) }),
}));
vi.mock("wouter", () => ({ useLocation: () => [runtime.location, vi.fn()] }));
vi.mock("sonner", () => ({ toast: { error: runtime.errorToast, success: runtime.successToast, info: vi.fn() } }));
vi.mock("../../../../api/business-trpc", async () => {
  const { useState } = await import("react");
  const buyers = {
    actorUserId: 201, canChooseBuyer: false, teamId: 9, scope: "self",
    options: [{ userId: 201, name: "合成采购员", username: "synthetic-buyer" }],
  };
  const query = (name: string) => ({
    useQuery: () => ({
      data: name === "list" || name === "photos" ? [] : name === "procurementBuyers" ? buyers : undefined,
      isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch: runtime.refetch,
    }),
    useMutation: (options?: unknown) => {
      const [isPending, setPending] = useState(false);
      if (name === "create") runtime.createOptions = options;
      return {
        isPending,
        mutate: (input: any, callbacks?: any) => {
          (runtime.mutations[name] ??= vi.fn())(input, callbacks);
          if (name !== "create") return;
          setPending(true);
          // Deferred mock transport. Deliberately allow obsolete callbacks to
          // run even after unmount: the page fence must independently reject them.
          runtime.attempts.push({
            input,
            success: result => { setPending(false); callbacks?.onSuccess?.(result); },
            fail: error => { setPending(false); callbacks?.onError?.(error); },
          });
        },
        mutateAsync: name === "uploadDocument" ? runtime.upload : vi.fn(),
      };
    },
    invalidate: runtime.invalidate, cancel: vi.fn(),
    fetch: vi.fn().mockResolvedValue([]),
  });
  const domain = new Proxy({}, { get: (_target, name: string) => query(name) });
  const utils = new Proxy({}, { get: () => domain });
  return { trpc: new Proxy({ useUtils: () => utils }, { get: (target, name: string) => name === "useUtils" ? target.useUtils : domain }) };
});
import InboundManagement from "./InboundManagement";

const suspended = new Promise<never>(() => {});
function SuspendProbe() { if (runtime.suspend) throw suspended; return null; }
function TestPage({ authorization }: { authorization: string }) {
  return createElement(StrictMode, null,
    createElement(runtime.authorizationContext.Provider, { value: authorization },
      createElement(Suspense, { fallback: createElement("p", null, "synthetic fallback") },
        createElement(InboundManagement), createElement(SuspendProbe))));
}
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
const dialog = () => host.querySelector<HTMLElement>('[aria-label="新建采购入库单"]');
const details = () => dialog()?.querySelector<HTMLDetailsElement>('details[role="alert"]') ?? null;
const error = { message: `响应确认丢失\n${"合成诊断，".repeat(180)}\n<img src=x onerror=alert(1)><script>window.syntheticLeak=1</script>` };
const success = { status: "in_transit", slipNo: "SYNTHETIC-ONLY-NEW" } as const;

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  runtime.storage = "synthetic-account-a:enterprise-a";
  runtime.activeStorage = runtime.storage; runtime.identity = runtime.storage;
  runtime.authorization = "synthetic-proof-1"; runtime.verified = true; runtime.location = "/inbound";
  runtime.onAuthError = runtime.authErrorSpy; runtime.authErrorSpy.mockReset();
  runtime.attempts = []; runtime.mutations = {}; runtime.suspend = false; runtime.speculativeVersions = [];
  runtime.upload.mockImplementation(async input => ({
    kind: input.kind, key: `synthetic-private/${input.fileName}`, name: input.fileName,
    mimeType: input.mimeType, size: 64, url: "https://files.invalid/synthetic", expiresIn: 300,
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); mounted = true;
});
afterEach(async () => {
  vi.useRealTimers();
  if (mounted) await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks();
});
const pageElement = () => createElement(TestPage, { authorization: runtime.authorization });
async function renderPage() { await act(async () => root.render(pageElement())); }
function button(text: string, within: ParentNode = host) {
  const result = Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
async function click(text: string, within: ParentNode = host) { await act(async () => button(text, within).click()); }
function field(label: string) {
  const group = Array.from(dialog()!.querySelectorAll<HTMLElement>(".inbound-field")).find(node => node.querySelector("label")?.textContent?.replace(/\*/g, "").trim() === label);
  if (!group) throw new Error(`Missing field ${label}`);
  return group.querySelector<HTMLInputElement>("input")!;
}
async function fill(label: string, value: string) {
  await act(async () => {
    const input = field(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function openValidCreate() {
  await renderPage(); await click("新建采购入库");
  await fill("料号/型号", "stm32"); await fill("计划到货数量", "3"); await fill("供应商名称", "合成供应商");
}
async function upload(kind: string, name: string, type: string) {
  const input = Array.from(dialog()!.querySelectorAll<HTMLInputElement>(`[aria-label="选择${kind}"]`)).find(node => !node.closest("[hidden]"))!;
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic only"], name, { type })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}
async function save() { await click("保存为在途", dialog()!); return runtime.attempts.at(-1)!; }
async function fail(attempt: SaveAttempt, failure: SaveError = error) { await act(async () => attempt.fail(failure)); }
async function succeed(attempt: SaveAttempt, result: SaveResult = success) { await act(async () => attempt.success(result)); }
function expectNoOutcome() {
  expect(runtime.authErrorSpy).not.toHaveBeenCalled();
  expect(runtime.errorToast).not.toHaveBeenCalled(); expect(runtime.successToast).not.toHaveBeenCalled();
  expect(runtime.refetch).not.toHaveBeenCalled(); expect(runtime.invalidate).not.toHaveBeenCalled();
  expect(details()).toBeNull();
}

describe("actual single-create error presentation (StrictMode, synthetic transport, no DB)", () => {
  it("retains inputs, uploaded documents and original request ID; uses a short toast and persistent escaped details, never automatic retry", async () => {
    await openValidCreate();
    await upload("合同", "contract.pdf", "application/pdf");
    await upload("银行付款水单", "receipt.png", "image/png");
    const first = await save();
    expect(runtime.createOptions).toEqual({ retry: false });
    expect(button("保存为在途", dialog()!).disabled).toBe(true);
    expect(dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭新建采购入库单"]')!.disabled).toBe(true);
    await fail(first);
    expect(runtime.authErrorSpy.mock.calls).toEqual([[error]]);
    expect(runtime.errorToast.mock.calls).toEqual([["保存遇到问题，请查看表单中的错误详情"]]);
    expect(runtime.successToast).not.toHaveBeenCalled();
    expect(runtime.refetch).not.toHaveBeenCalled(); expect(runtime.invalidate).not.toHaveBeenCalled();
    expect(details()!.open).toBe(true); expect(details()!.textContent).toContain(error.message);
    expect(details()!.textContent).toContain("保存结果请以系统确认为准");
    expect(details()!.textContent).not.toMatch(/未创建|没有创建|创建失败|未保存/);
    expect(details()!.querySelector("img,script")).toBeNull();
    expect(field("料号/型号").value).toBe("STM32"); expect(field("计划到货数量").value).toBe("3"); expect(field("供应商名称").value).toBe("合成供应商");
    expect(dialog()!.textContent).toContain("contract.pdf"); expect(dialog()!.textContent).toContain("receipt.png");
    expect(first.input.clientRequestId).toBe(runtime.upload.mock.calls[0][0].clientRequestId);
    expect(first.input.clientRequestId).toBe(runtime.upload.mock.calls[1][0].clientRequestId);
    vi.useFakeTimers(); await act(async () => vi.advanceTimersByTime(30_000)); vi.useRealTimers();
    await renderPage(); expect(details()!.textContent).toContain(error.message);
    expect(runtime.mutations.create).toHaveBeenCalledOnce();
    const second = await save();
    expect(details()).toBeNull(); // explicit new transport attempt, not an automatic retry
    expect(second.input).toEqual(first.input);
    expect(runtime.upload).toHaveBeenCalledTimes(2);
    expect(runtime.mutations.create).toHaveBeenCalledTimes(2);
    await fail(second, { message: "第二次合成诊断" });
    expect(details()!.open).toBe(true); expect(details()!.textContent).toContain("第二次合成诊断"); expect(details()!.textContent).not.toContain(error.message);
  });

  it("does not erase the previous server diagnostic on a local validation failure", async () => {
    await openValidCreate(); const first = await save(); await fail(first);
    await fill("供应商名称", ""); await click("保存为在途", dialog()!);
    expect(runtime.mutations.create).toHaveBeenCalledOnce(); expect(details()!.textContent).toContain(error.message);
    await fill("供应商名称", "合成供应商"); const second = await save(); expect(second.input.clientRequestId).toBe(first.input.clientRequestId);
  });

  it("optional authorization handler does not throw or prevent displaying ordinary errors", async () => {
    runtime.onAuthError = undefined;
    await openValidCreate(); await fail(await save());
    expect(details()!.textContent).toContain(error.message); expect(runtime.errorToast).toHaveBeenCalledOnce();
  });

  it.each(["fail", "success"] as const)("blocks %s from a changed live storage scope even before React rerenders", async outcome => {
    await openValidCreate(); const attempt = await save(); runtime.activeStorage = "synthetic-account-b:enterprise-b";
    if (outcome === "fail") await fail(attempt); else await succeed(attempt);
    expectNoOutcome(); expect(dialog()).not.toBeNull();
  });

  it.each((["storage", "identity", "authorization", "verification", "route"] as const).flatMap(dimension =>
    (["fail", "success"] as const).map(outcome => ({ dimension, outcome }))
  ))("rejects old $outcome after committed A → B → A $dimension transitions", async ({ dimension, outcome }) => {
    await openValidCreate(); const attempt = await save();
    const original = { storage: runtime.storage, identity: runtime.identity, authorization: runtime.authorization, verified: runtime.verified, location: runtime.location };
    if (dimension === "storage") { runtime.storage = "synthetic-account-b:enterprise-b"; runtime.activeStorage = runtime.storage; runtime.identity = runtime.storage; }
    if (dimension === "identity") runtime.identity = "synthetic-other-proof";
    if (dimension === "authorization") runtime.authorization = "synthetic-proof-2";
    if (dimension === "verification") runtime.verified = false;
    if (dimension === "route") runtime.location = "/inventory";
    await renderPage();
    Object.assign(runtime, original); runtime.activeStorage = runtime.storage; await renderPage();
    if (outcome === "fail") await fail(attempt); else await succeed(attempt);
    expectNoOutcome(); expect(dialog()).not.toBeNull();
  });

  it("clears errors on single → bulk → single and rejects another old callback", async () => {
    await openValidCreate(); const old = await save(); await fail(old);
    expect(details()).not.toBeNull(); await click("批量入库", dialog()!); await click("单条录入", dialog()!);
    expect(details()).toBeNull(); runtime.authErrorSpy.mockClear(); runtime.errorToast.mockClear();
    await fail(old); await succeed(old); expectNoOutcome();
  });

  it("rejects late callbacks from another form and does not replace its current diagnostic", async () => {
    await openValidCreate(); const old = await save(); await fail(old);
    await act(async () => dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭新建采购入库单"]')!.click());
    await click("新建采购入库"); runtime.authErrorSpy.mockClear(); runtime.errorToast.mockClear();
    await fail(old); expectNoOutcome();
    await fill("料号/型号", "LM358"); await fill("计划到货数量", "7"); await fill("供应商名称", "另一个合成供应商");
    const current = await save(); expect(current.input.clientRequestId).not.toBe(old.input.clientRequestId);
    await fail(current, { message: "当前表单诊断" });
    await succeed(old); await fail(old);
    expect(details()!.textContent).toContain("当前表单诊断"); expect(details()!.textContent).not.toContain(error.message);
    expect(field("料号/型号").value).toBe("LM358");
    expect(runtime.errorToast).toHaveBeenCalledOnce(); expect(runtime.successToast).not.toHaveBeenCalled(); expect(runtime.refetch).not.toHaveBeenCalled();
  });

  it("clears closed form errors and ignores a late old callback after reopening", async () => {
    await openValidCreate(); const old = await save(); await fail(old);
    await act(async () => dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭新建采购入库单"]')!.click());
    expect(dialog()).toBeNull(); await click("新建采购入库"); expect(details()).toBeNull();
    runtime.authErrorSpy.mockClear(); runtime.errorToast.mockClear();
    await fail(old); await succeed(old); expectNoOutcome(); expect(field("料号/型号").value).toBe("");
  });

  it("rechecks live scope after the authorization callback changes it", async () => {
    runtime.authErrorSpy.mockImplementation(() => { runtime.activeStorage = null; });
    await openValidCreate(); await fail(await save(), { message: "合成权限错误", data: { code: "FORBIDDEN" } });
    expect(runtime.authErrorSpy).toHaveBeenCalledOnce(); expect(runtime.errorToast).not.toHaveBeenCalled(); expect(details()).toBeNull();
  });

  it("rechecks the fence after the authorization callback synchronously commits another proof", async () => {
    runtime.authErrorSpy.mockImplementation(() => {
      runtime.authorization = "synthetic-proof-2";
      flushSync(() => root.render(pageElement()));
    });
    await openValidCreate(); await fail(await save(), { message: "合成权限错误" });
    expect(runtime.authErrorSpy).toHaveBeenCalledOnce(); expect(runtime.errorToast).not.toHaveBeenCalled(); expect(details()).toBeNull();
  });

  it("does not leak a toast when the authorization callback synchronously unmounts the page", async () => {
    runtime.authErrorSpy.mockImplementation(() => {
      flushSync(() => root.unmount()); mounted = false;
    });
    await openValidCreate(); await fail(await save(), { message: "合成权限错误" });
    expect(runtime.authErrorSpy).toHaveBeenCalledOnce(); expect(runtime.errorToast).not.toHaveBeenCalled(); expect(host.childNodes).toHaveLength(0);
  });

  it.each(["fail", "success"] as const)("does not emit %s or refresh after unmount", async outcome => {
    await openValidCreate(); const attempt = await save();
    await act(async () => root.unmount()); mounted = false;
    if (outcome === "fail") await fail(attempt); else await succeed(attempt);
    expectNoOutcome(); expect(host.childNodes).toHaveLength(0);
  });

  it("does not invalidate the current request for an abandoned concurrent render", async () => {
    await openValidCreate(); const attempt = await save();
    runtime.authorization = "synthetic-speculative-proof"; runtime.suspend = true;
    await act(async () => { startTransition(() => root.render(pageElement())); });
    expect(runtime.speculativeVersions).toContain("synthetic-speculative-proof");
    expect(host.textContent).not.toContain("synthetic fallback"); expect(dialog()).not.toBeNull();
    runtime.authorization = "synthetic-proof-1"; runtime.suspend = false;
    await renderPage(); await succeed(attempt);
    expect(dialog()).toBeNull(); expect(runtime.successToast.mock.calls).toEqual([[`在途单 ${success.slipNo} 已创建`]]);
    expect(runtime.refetch).toHaveBeenCalledOnce(); expect(runtime.invalidate).toHaveBeenCalledOnce();
  });

  it.each(["in_transit", "received"] as const)("confirmed %s success clears any diagnostic, closes normally and refreshes once", async status => {
    await openValidCreate(); const failed = await save(); await fail(failed);
    const current = await save(); await succeed(current, { ...success, status });
    expect(dialog()).toBeNull(); expect(runtime.successToast.mock.calls).toEqual([[status === "received" ? `入库单 ${success.slipNo} 已完成入库` : `在途单 ${success.slipNo} 已创建`]]);
    expect(runtime.refetch).toHaveBeenCalledOnce(); expect(runtime.invalidate).toHaveBeenCalledOnce();
    await fail(failed); expect(runtime.errorToast).toHaveBeenCalledOnce(); // only the original failure
    await click("新建采购入库"); expect(details()).toBeNull(); expect(field("料号/型号").value).toBe("");
  });
});
