// @vitest-environment jsdom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchUpload } from "../channelInventory/BatchUpload";
import type { CustomerParseUpload } from "./CustomerParseUpload";
import type { History } from "./customerUploadHistory";

const rt = vi.hoisted(() => ({ current: true, context: vi.fn(), original: vi.fn(), upload: vi.fn(), close: vi.fn(), auth: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", vi.fn()] }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ storageScope: "retry-safety", officialInventoryPermissions: { read: true, write: true, note: true } }) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ client: { channelInventory: {
  customerSupplyContext: { query: rt.context }, customerUploadOriginal: { mutate: rt.original },
} } }) } }));
vi.mock("../channelInventory/BatchUpload", () => ({ batchUploadDialogStyle: {}, BatchUpload: (props: ComponentProps<typeof BatchUpload>) => { rt.upload(props); return React.createElement("div"); } }));
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { customerSupplySessionSuffix } from "./customerSupply";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const identity = { enterpriseId: 31, actorUserId: 7, key: "retry-safety-auth" };
const key = `customer-upload-original:${customerSupplySessionSuffix(identity, 801)}`;
const context = () => ({ customer: { id: 801, name: "绑定客户", version: 4, industryCode: "electronic_components", archivedAt: null }, channel: null, canUpload: true, disabledReason: null });
const history = (mode: "standard" | "parse" = "parse") => ({ historyId: randomUUID(), customerId: 801, mode, revision: 1, originalFile: { fileName: "source.csv" }, latestVersionId: null }) as History;
function file(name = "source.csv", text = "型号,品牌\nONE,TI") {
  const bytes = new TextEncoder().encode(text);
  const value = new File([bytes], name);
  Object.defineProperty(value, "arrayBuffer", { value: vi.fn(async () => bytes.buffer) });
  return value;
}
let root: Root | undefined;
let send: ComponentProps<typeof CustomerParseUpload>["persistOriginal"];
async function setup() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: vi.fn(), onAuthorizationError: rt.auth })); });
  const props = rt.upload.mock.calls.at(-1)![0] as ComponentProps<typeof BatchUpload>;
  const parse = props.renderParseEntry!({} as Parameters<NonNullable<typeof props.renderParseEntry>>[0]) as React.ReactElement<ComponentProps<typeof CustomerParseUpload>>;
  send = parse.props.persistOriginal;
}
async function tick() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function started(value = file(), mode: "parse" | "standard" = "parse") {
  let finish!: (result: { history: History }) => void;
  let fail!: (error: unknown) => void;
  rt.original.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const promise = send(value, mode); const outcome = promise.then(result => ({ result }), error => ({ error }));
  await vi.waitFor(() => expect(rt.original).toHaveBeenCalledTimes(1));
  const raw = sessionStorage.getItem(key)!;
  return { promise, outcome, finish, fail, raw, value };
}
beforeEach(() => {
  Object.values(rt).forEach(value => { if (typeof value !== "boolean") value.mockReset(); });
  rt.current = true; rt.context.mockResolvedValue(context()); sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real network forbidden in retry-safety tests"); }));
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("native original upload retry safety", () => {
  it("shares the exact Promise for same file object/mode and sends one API UUID", async () => {
    await setup(); const f = file();
    const first = send(f, "parse"); const second = send(f, "parse"); expect(second).toBe(first);
    rt.original.mockResolvedValue({ history: history() });
    await expect(first).resolves.toMatchObject({ customerId: 801 });
    expect(rt.original).toHaveBeenCalledTimes(1); expect(rt.original.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(f.arrayBuffer).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("rejects a different object or mode while the original is in flight", async () => {
    await setup(); const run = await started();
    await expect(send(file(), "parse")).rejects.toThrow("不能并发");
    await expect(send(run.value, "standard")).rejects.toThrow("不能并发");
    run.finish({ history: history() }); await run.outcome; expect(rt.original).toHaveBeenCalledTimes(1);
  });
  it.each(["silent", "mismatch", "throws"])("blocks API after %s storage write and holds the unknown operation", async kind => {
    await setup(); const nativeSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, k, raw) {
      if (kind === "throws") throw new Error("storage denied");
      if (kind === "mismatch") nativeSet.call(this, k, JSON.stringify({ ...JSON.parse(raw), requestId: randomUUID() }));
    });
    const f = file(); await expect(send(f, "parse")).rejects.toThrow(); expect(rt.original).not.toHaveBeenCalled();
    vi.restoreAllMocks(); sessionStorage.clear();
    await expect(send(f, "parse")).rejects.toThrow("恢复锁无法确认"); expect(rt.original).not.toHaveBeenCalled();
  });
  it.each(["foreign", "raw-change"])("never removes a %s lock swapped during response", async kind => {
    await setup(); const run = await started(); const remove = vi.spyOn(Storage.prototype, "removeItem");
    const foreign = kind === "foreign" ? JSON.stringify({ ...JSON.parse(run.raw), requestId: randomUUID() }) : ` ${run.raw}`;
    sessionStorage.setItem(key, foreign); run.finish({ history: history() });
    expect(await run.outcome).toMatchObject({ error: expect.any(Error) }); expect(remove).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe(foreign);
  });
  it.each(["throws", "silent", "reinsert"])("does not report success after cleanup %s", async kind => {
    await setup(); const run = await started(); const nativeRemove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function(this: Storage, k) {
      if (kind === "throws") throw new Error("remove denied");
      if (kind === "reinsert") { nativeRemove.call(this, k); this.setItem(k, run.raw); }
    });
    run.finish({ history: history() }); expect(await run.outcome).toMatchObject({ error: expect.any(Error) }); expect(sessionStorage.getItem(key)).toBe(run.raw);
  });
  it("releases only a real BAD_REQUEST with exact native notSaved prefix and nonempty detail", async () => {
    await setup(); const run = await started(); const error = Object.assign(new Error("原文件未保存：文件格式不支持"), { data: { code: "BAD_REQUEST" } });
    run.fail(error); expect(await run.outcome).toEqual({ error }); expect(sessionStorage.getItem(key)).toBeNull();
    rt.original.mockResolvedValue({ history: history() }); await send(file(), "parse");
    expect(rt.original.mock.calls[1][0].requestId).not.toBe(JSON.parse(run.raw).requestId);
  });
  it.each([
    { data: { code: "BAD_REQUEST" }, message: "原文件未保存：   " },
    { data: { code: "BAD_REQUEST" }, message: "原文件未保存:失败" },
    { data: { code: "BAD_REQUEST" }, message: "未知错误" },
    { data: { code: "CONFLICT" }, message: "原文件未保存：冲突" },
    { code: "BAD_REQUEST", message: "原文件未保存：没有后端data" },
    new Error("network lost"), null,
  ])("holds original UUID for unknown or malformed rejection %#", async error => {
    await setup(); const run = await started(); run.fail(error); expect(await run.outcome).toEqual({ error }); expect(sessionStorage.getItem(key)).toBe(run.raw);
    rt.original.mockResolvedValue({ history: history() }); await send(run.value, "parse");
    expect(rt.original.mock.calls[1][0].requestId).toBe(JSON.parse(run.raw).requestId);
  });
  it.each(["success", "notSaved"])("does not clean a late %s after identity closes", async kind => {
    await setup(); const run = await started(); const remove = vi.spyOn(Storage.prototype, "removeItem"); rt.current = false;
    await act(async () => root?.unmount()); root = undefined;
    if (kind === "success") run.finish({ history: history() });
    else run.fail(Object.assign(new Error("原文件未保存：拒绝"), { data: { code: "BAD_REQUEST" } }));
    expect(await run.outcome).toMatchObject({ error: expect.any(Error) }); expect(remove).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe(run.raw);
  });
  it("rejects fresh UUID when a known operation loses stored lock", async () => {
    await setup(); const run = await started(); run.fail(new Error("lost response")); await run.outcome; sessionStorage.removeItem(key);
    await expect(send(run.value, "parse")).rejects.toThrow("恢复锁无法确认"); expect(rt.original).toHaveBeenCalledTimes(1);
  });
  it.each(["bytes", "filename", "mode", "version"])("cannot replace unknown operation %s", async kind => {
    await setup(); const run = await started(); run.fail(new Error("unknown")); await run.outcome;
    if (kind === "version") {
      const props = rt.upload.mock.calls.at(-1)![0] as ComponentProps<typeof BatchUpload>;
      (props.sessionData as { customerVersion: number }).customerVersion = 5;
    }
    const f = kind === "bytes" ? file("source.csv", "different") : kind === "filename" ? file("other.csv") : run.value;
    await expect(send(f, kind === "mode" ? "standard" : "parse")).rejects.toThrow("未知请求不能更换");
    expect(sessionStorage.getItem(key)).toBe(run.raw); expect(rt.original).toHaveBeenCalledTimes(1);
  });
  it.each(["customer", "mode", "uuid", "absent"])("holds lock for malformed success %s", async kind => {
    await setup(); const run = await started(); const h = history();
    if (kind === "customer") h.customerId = 802;
    if (kind === "mode") h.mode = "standard";
    if (kind === "uuid") h.historyId = "invalid";
    run.finish({ history: kind === "absent" ? undefined as unknown as History : h });
    expect(await run.outcome).toMatchObject({ error: expect.any(Error) }); expect(sessionStorage.getItem(key)).toBe(run.raw);
  });
  it.each(["uuid", "hash", "mode", "filename", "version", "json"])("rejects malformed stored lock %s without API or overwrite", async kind => {
    await setup();
    const lock = { requestId: randomUUID(), hash: "a".repeat(64), mode: "parse", fileName: "source.csv", customerVersion: 4 };
    if (kind === "uuid") lock.requestId = "00000000-0000-0000-0000-000000000000";
    if (kind === "hash") lock.hash = "A".repeat(64);
    if (kind === "mode") lock.mode = "unknown";
    if (kind === "filename") lock.fileName = " ";
    if (kind === "version") lock.customerVersion = -1;
    const raw = kind === "json" ? "{" : JSON.stringify(lock); sessionStorage.setItem(key, raw);
    const set = vi.spyOn(Storage.prototype, "setItem");
    await expect(send(file(), "parse")).rejects.toThrow(); expect(rt.original).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe(raw);
  });
  it.each(["before-remove", "after-remove"])("does not release ownership lost %s", async kind => {
    await setup(); const run = await started();
    const nativeGet = Storage.prototype.getItem; const nativeRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function(this: Storage, k) {
      nativeRemove.call(this, k); if (kind === "after-remove") rt.current = false;
    });
    const get = kind === "before-remove" ? vi.spyOn(Storage.prototype, "getItem").mockImplementation(function(this: Storage, k) {
      const raw = nativeGet.call(this, k); rt.current = false; return raw;
    }) : undefined;
    run.finish({ history: history() }); expect(await run.outcome).toMatchObject({ error: expect.any(Error) });
    expect(remove).toHaveBeenCalledTimes(kind === "before-remove" ? 0 : 1);
    remove.mockRestore(); get?.mockRestore(); rt.current = true;
    if (kind === "after-remove") await expect(send(run.value, "parse")).rejects.toThrow("恢复锁无法确认");
    else expect(sessionStorage.getItem(key)).toBe(run.raw);
    expect(rt.original).toHaveBeenCalledTimes(1);
  });
  it("success clears owned standard lock and updates real history session", async () => {
    await setup(); const run = await started(file(), "standard"); const h = history("standard");
    await act(async () => { run.finish({ history: h }); await run.outcome; }); await tick();
    expect(await run.outcome).toEqual({ result: h }); expect(sessionStorage.getItem(key)).toBeNull();
    expect(rt.upload.mock.calls.at(-1)![0].sessionData.history.historyId).toBe(h.historyId);
  });
});
