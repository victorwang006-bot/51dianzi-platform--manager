import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// All process, filesystem, browser and transport boundaries are fake. The real
// requestPacing implementation runs against the in-memory rate timestamp below.
const mocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    spawn: vi.fn(), createServer: vi.fn(), connect: vi.fn(),
    mkdtemp: vi.fn(async () => "/tmp/51-public-reference-offline"),
    rm: vi.fn(async () => {}), chown: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async (path: string) => { if (!files.has(path)) throw new Error("ENOENT"); return files.get(path)!; }),
    writeFile: vi.fn(async (path: string, value: string) => { files.set(path, value); }),
    rename: vi.fn(async (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); }),
    robots: vi.fn(async () => {}), resolvePublicAddress: vi.fn(async () => "8.8.8.8"),
  };
});
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:http", () => ({ createServer: mocks.createServer }));
vi.mock("node:net", async importOriginal => ({ ...await importOriginal<typeof import("node:net")>(), connect: mocks.connect }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: mocks.mkdtemp, rm: mocks.rm, chown: mocks.chown,
  mkdir: mocks.mkdir, readFile: mocks.readFile, writeFile: mocks.writeFile, rename: mocks.rename,
}));
vi.mock("./publicPage", async importOriginal => ({
  ...await importOriginal<typeof import("./publicPage")>(),
  assertReferenceRobots: mocks.robots, resolvePublicAddress: mocks.resolvePublicAddress,
}));
import { readPublicReferencePage } from "./browserPage";
import { PublicPageRestrictedError } from "./publicPage";

type Command = { id: number; method: string; params: Record<string, any>; sessionId?: string; at: number };
const pageUrl = "https://so.szlcsc.com/global.html?k=P-1";
const scriptUrl = "https://so.szlcsc.com/public.js";
const main = "main-session";
let commands: Command[];
let onCommand: ((ws: MockWebSocket, command: Command) => void) | undefined;
let rejectCommand: ((command: Command) => boolean) | undefined;
let omitReply: ((command: Command) => boolean) | undefined;
let rootAttachmentTiming: "before-reply" | "after-reply" | "delayed" | "missing";
let attachedMainSessions: Set<string>;
let socket: MockWebSocket;
let proxy: EventEmitter & { listen: ReturnType<typeof vi.fn>; address: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let kill: ReturnType<typeof vi.spyOn>;
let killTimes: number[];

class MockWebSocket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  close = vi.fn(() => { this.readyState = 3; });
  constructor(readonly endpoint: string) {
    super(); socket = this;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  emit(message: Record<string, any>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
  attached(sessionId: string, type: string, targetId: string, parentSession?: string, waitingForDebugger = true) {
    if (type === "page" && targetId === "main-target") attachedMainSessions.add(sessionId);
    this.emit({ method: "Target.attachedToTarget", ...(parentSession ? { sessionId: parentSession } : {}), params: {
      sessionId, waitingForDebugger, targetInfo: { type, targetId, url: "about:blank", ...(type === "page" && targetId !== "main-target" ? { openerId: "main-target" } : {}) },
    } });
  }
  paused(sessionId: string, requestId: string, resourceType = "Script", url = scriptUrl) {
    this.emit({ method: "Fetch.requestPaused", sessionId, params: { requestId, networkId: requestId, resourceType, request: { url } } });
  }
  dom() { this.emit({ method: "Page.domContentEventFired", sessionId: main, params: {} }); }
  response(sessionId: string, status: number, type = "Script", url = scriptUrl) {
    this.emit({ method: "Network.responseReceived", sessionId, params: { type, response: { status, url } } });
  }
  send(serialized: string) {
    const command: Command = { ...JSON.parse(serialized), at: Date.now() };
    commands.push(command);
    queueMicrotask(() => {
      if (command.method === "Target.attachToTarget") this.attached(main, "page", "main-target", undefined, false);
      // Root auto-attach emits an event, not a sessionId in its command result.
      // If manually attached first, real CDP creates another main session.
      const rootAttach = command.method === "Target.setAutoAttach" && !command.sessionId;
      const attachMain = () => this.attached(attachedMainSessions.has(main) ? "main-auto-session" : main, "page", "main-target");
      if (rootAttach && rootAttachmentTiming === "before-reply") attachMain();
      let result: any = {};
      if (command.method === "Browser.getVersion") result = { userAgent: "Mozilla/5.0 HeadlessChrome/123.0.0.0 Safari/537.36" };
      if (command.method === "Target.createTarget") result = { targetId: "main-target" };
      if (command.method === "Target.attachToTarget") result = { sessionId: main };
      if (command.method === "Target.closeTarget") result = { success: true };
      if (command.method === "Runtime.evaluate") result = { result: { value: JSON.stringify({ html: "<html><body>¥ 1.23</body></html>", url: pageUrl, ready: "complete", text: "¥ 1.23" }) } };
      if (!omitReply?.(command)) this.emit({ id: command.id, ...(rejectCommand?.(command) ? { error: { message: "offline rejection" } } : { result }) });
      if (rootAttach && rootAttachmentTiming === "after-reply") attachMain();
      if (rootAttach && rootAttachmentTiming === "delayed") setTimeout(attachMain, 20);
      if (onCommand) onCommand(this, command);
      else if (command.method === "Page.navigate") { this.paused(main, "document", "Document", pageUrl); this.dom(); }
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T06:00:00Z"));
  vi.clearAllMocks(); mocks.files.clear(); commands = []; onCommand = undefined; rejectCommand = undefined; omitReply = undefined;
  rootAttachmentTiming = "before-reply"; attachedMainSessions = new Set();
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External fetch forbidden in offline tests"); }));
  killTimes = [];
  kill = vi.spyOn(process, "kill").mockImplementation(() => { killTimes.push(Date.now()); return true; });
  const child = Object.assign(new EventEmitter(), { pid: 123456, stderr: new EventEmitter() });
  mocks.spawn.mockImplementation(() => {
    setTimeout(() => child.stderr.emit("data", Buffer.from("DevTools listening on ws://127.0.0.1:9222/devtools/browser/offline\n")), 0);
    return child;
  });
  proxy = Object.assign(new EventEmitter(), {
    listen: vi.fn((_port: number, _host: string, callback: () => void) => callback()),
    address: vi.fn(() => ({ port: 32123, address: "127.0.0.1" })), close: vi.fn(),
  });
  mocks.createServer.mockReturnValue(proxy);
  mocks.connect.mockImplementation(() => { throw new Error("Real socket forbidden in offline tests"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function run() {
  // Observe rejection immediately, including restrictions during a pending CDP command.
  const result = readPublicReferencePage("lcsc", pageUrl, "/offline/chrome")
    .then(value => ({ value, error: null })).catch((error: Error) => ({ value: null, error }));
  await vi.advanceTimersByTimeAsync(60_000);
  return result;
}
const sent = (method: string, sessionId?: string) => commands.filter(c => c.method === method && (sessionId === undefined || c.sessionId === sessionId));
function expectProtectedBeforeResume(sessionId: string) {
  const resume = commands.findIndex(c => c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === sessionId);
  expect(resume).toBeGreaterThan(-1);
  for (const method of ["Page.enable", "Network.enable", "Runtime.enable", "Network.setUserAgentOverride", "Fetch.enable", "Target.setAutoAttach"]) {
    const index = commands.findIndex(c => c.method === method && c.sessionId === sessionId);
    expect(index, method + " installed before resume").toBeGreaterThan(-1); expect(index).toBeLessThan(resume);
  }
}

describe("public browser network-target containment (offline CDP)", () => {
  it("owns exactly one root-auto-attached main session, with all hooks installed before resume/navigation", async () => {
    const result = await run(); expect(result.error).toBeNull(); expect(result.value?.url).toBe(pageUrl);
    expect([...attachedMainSessions]).toEqual([main]);
    expect(sent("Fetch.enable").map(c => c.sessionId)).toEqual([main]);
    expect(sent("Fetch.enable", main)).toHaveLength(1); expectProtectedBeforeResume(main);
    const navigate = commands.findIndex(c => c.method === "Page.navigate");
    for (const c of sent("Target.setAutoAttach")) {
      expect(c.params).toEqual({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
      expect(commands.indexOf(c)).toBeLessThan(navigate);
    }
    expect(sent("Target.setAutoAttach").map(c => c.sessionId)).toEqual([undefined, main]);
    expect(sent("Target.attachToTarget")).toHaveLength(0);
    expect(commands.findIndex(c => c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === main)).toBeLessThan(navigate);
    expect(sent("Fetch.continueRequest")[0].sessionId).toBe(main);
    expect(sent("Network.setUserAgentOverride", main)[0].params.userAgent).toBe("Mozilla/5.0 HeadlessChrome/123.0.0.0 Safari/537.36 51Dianzi-ChannelReference/1.0");
    expect(kill).toHaveBeenCalledWith(-123456, "SIGKILL"); expect(socket.close).toHaveBeenCalledOnce(); expect(proxy.close).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/51-public-reference-offline", { recursive: true, force: true });
    const [binary, args, options] = mocks.spawn.mock.calls[0];
    expect(binary).toBe("/offline/chrome");
    for (const flag of ["--headless", "--no-sandbox", "--disable-quic", "--disable-background-networking", "--proxy-bypass-list=<-loopback>", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--proxy-server=http://127.0.0.1:32123", "--user-data-dir=/tmp/51-public-reference-offline"]) expect(args).toContain(flag);
    expect(options).toMatchObject({ detached: true, stdio: ["ignore", "ignore", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8" } });
    expect(Object.keys(options.env).sort()).toEqual(["HOME", "LANG", "PATH"]);
    if (process.getuid?.() === 0) { expect(options).toMatchObject({ uid: 65534, gid: 65534 }); expect(mocks.chown).toHaveBeenCalledWith("/tmp/51-public-reference-offline", 65534, 65534); }
    expect(mocks.connect).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["before-reply", "after-reply", "delayed"] as const)("awaits the root main attachment %s without falling back to manual attach", async timing => {
    rootAttachmentTiming = timing;
    expect((await run()).error).toBeNull(); expectProtectedBeforeResume(main);
    expect(sent("Target.attachToTarget")).toHaveLength(0);
    expect(sent("Fetch.enable").map(c => c.sessionId)).toEqual([main]);
    expect(sent("Page.navigate")[0].sessionId).toBe(main);
    expect(sent("Fetch.continueRequest")[0].sessionId).toBe(main);
  });

  it("deduplicates repeated attachedToTarget notifications for the same main session", async () => {
    onCommand = (ws, c) => {
      if (c.method === "Target.setAutoAttach" && !c.sessionId) ws.attached(main, "page", "main-target");
      if (c.method === "Page.navigate") { ws.paused(main, "document", "Document", pageUrl); ws.dom(); }
    };
    expect((await run()).error).toBeNull(); expectProtectedBeforeResume(main);
    for (const method of ["Page.enable", "Network.enable", "Runtime.enable", "Fetch.enable", "Runtime.runIfWaitingForDebugger"]) expect(sent(method, main)).toHaveLength(1);
  });

  it.each(["page", "iframe"])("fails closed instead of installing a second Fetch owner for the same %s target", async type => {
    onCommand = (ws, c) => {
      if (type === "page" && c.method === "Target.setAutoAttach" && !c.sessionId) ws.attached("duplicate-session", type, "main-target");
      if (type === "iframe" && c.method === "Page.navigate") {
        ws.attached("iframe-session", type, "iframe-target", main);
        ws.attached("duplicate-session", type, "iframe-target", main);
      }
    };
    expect((await run()).error?.message).toBe("Browser target already has a protected session");
    expect(sent("Fetch.enable", "duplicate-session")).toHaveLength(0);
    expect(sent("Runtime.runIfWaitingForDebugger", "duplicate-session")).toHaveLength(0);
    expect(sent("Target.detachFromTarget")).toHaveLength(0); expect(sent("Fetch.continueRequest")).toHaveLength(0);
    expect(kill).toHaveBeenCalledWith(-123456, "SIGKILL");
  });

  it("fails closed on missing root attachment without manual fallback or navigation", async () => {
    rootAttachmentTiming = "missing";
    expect((await run()).error?.message).toBe("Browser main target attach timeout");
    expect(sent("Target.attachToTarget")).toHaveLength(0); expect(sent("Page.navigate")).toHaveLength(0);
    expect(sent("Fetch.enable")).toHaveLength(0); expect(kill).toHaveBeenCalled();
  });

  it("completes one-session paced Document/Script/CSS responses with sourceMap metadata without fetching maps", async () => {
    const diagnose = vi.fn();
    const resources = [
      ["document", "Document", pageUrl],
      ...[1, 2, 3].map(i => ["script-" + i, "Script", scriptUrl + "?v=" + i]),
      ...[1, 2, 3, 4, 5].map(i => ["css-" + i, "Stylesheet", "https://so.szlcsc.com/public.css?v=" + i]),
    ];
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") for (const [requestId, type, url] of resources) ws.paused(main, requestId, type, url);
      if (c.method === "Fetch.continueRequest") {
        const [requestId, type, url] = resources.find(r => r[0] === c.params.requestId)!;
        // A target's Network event is delivered once per enabled session. This
        // fixture would expose the old manual+auto attachment as double responses.
        for (const owner of attachedMainSessions) if (sent("Network.enable", owner).length) {
          ws.emit({ method: "Network.responseReceived", sessionId: owner, params: {
            requestId, loaderId: "main-loader", timestamp: Date.now() / 1000, type, hasExtraInfo: true,
            response: { status: 200, url, headers: { "content-type": type === "Stylesheet" ? "text/css" : "text/javascript" }, protocol: "h2", fromDiskCache: false },
          } });
          ws.emit({ method: "Network.responseReceivedExtraInfo", sessionId: owner, params: { requestId, statusCode: 200, headers: {} } });
          ws.emit({ method: "Network.loadingFinished", sessionId: owner, params: { requestId, timestamp: Date.now() / 1000, encodedDataLength: 100 } });
        }
        if (type === "Script") ws.emit({ method: "Runtime.scriptParsed", sessionId: main, params: {
          scriptId: requestId, url, sourceMapURL: requestId === "script-1" ? "https://evil.example/public.js.map" : "public.js.map", hasSourceURL: false,
        } });
        if (sent("Fetch.continueRequest").length === resources.length) ws.dom();
      }
    };
    const result = readPublicReferencePage("lcsc", pageUrl, "/offline/chrome", diagnose).then(value => ({ value, error: null })).catch((error: Error) => ({ value: null, error }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await result).error).toBeNull();
    expect(diagnose.mock.calls.filter(([event]) => event.stage === "response")).toHaveLength(resources.length);
    expect([...attachedMainSessions]).toEqual([main]);
    expect(sent("Fetch.continueRequest").map(c => [c.sessionId, c.params.requestId])).toEqual(resources.map(([requestId]) => [main, requestId]));
    const continued = sent("Fetch.continueRequest");
    for (let i = 1; i < continued.length; i++) expect(continued[i].at - continued[i - 1].at).toBeGreaterThanOrEqual(560);
    expect(diagnose.mock.calls.filter(([event]) => event.stage === "dom-ready")).toHaveLength(1);
    expect(sent("Runtime.evaluate")).toHaveLength(1); expect(sent("Fetch.failRequest")).toHaveLength(0);
    expect(sent("Target.attachToTarget")).toHaveLength(0); expect(mocks.rename).toHaveBeenCalledTimes(resources.length);
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each(["worker", "service_worker", "shared_worker", "page", "other", "worklet"])("closes extra %s paused, without permit, resume or detach", async type => {
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") {
        ws.attached("blocked-session", type, "blocked-target", main);
        ws.paused("blocked-session", "blocked-request");
        ws.paused(main, "document", "Document", pageUrl); ws.dom();
      }
    };
    expect((await run()).error).toBeNull();
    expect(sent("Target.closeTarget").map(c => [c.params.targetId, c.sessionId])).toEqual([["blocked-target", undefined]]);
    expect(sent("Runtime.runIfWaitingForDebugger", "blocked-session")).toHaveLength(0);
    expect(sent("Target.detachFromTarget")).toHaveLength(0); expect(sent("Fetch.enable", "blocked-session")).toHaveLength(0);
    expect(sent("Fetch.failRequest", "blocked-session")[0].params.requestId).toBe("blocked-request");
    expect(sent("Fetch.continueRequest").map(c => c.params.requestId)).toEqual(["document"]);
    expect(mocks.rename).toHaveBeenCalledTimes(1);
  });

  it("recursively protects iframe targets and shares the real 560ms permit across flattened sessions", async () => {
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") { ws.attached("iframe-session", "iframe", "iframe-target", main); ws.paused(main, "document", "Document", pageUrl); }
      if (c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === "iframe-session") {
        ws.paused("iframe-session", "iframe-script"); ws.attached("nested-session", "iframe", "nested-target", "iframe-session");
      }
      if (c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === "nested-session") ws.paused("nested-session", "nested-xhr", "XHR");
      if (c.method === "Fetch.continueRequest" && sent("Fetch.continueRequest").length === 3) ws.dom();
    };
    expect((await run()).error).toBeNull(); expectProtectedBeforeResume("iframe-session"); expectProtectedBeforeResume("nested-session");
    const continued = sent("Fetch.continueRequest");
    expect(continued.map(c => [c.sessionId, c.params.requestId])).toEqual([[main, "document"], ["iframe-session", "iframe-script"], ["nested-session", "nested-xhr"]]);
    for (let i = 1; i < continued.length; i++) expect(continued[i].at - continued[i - 1].at).toBeGreaterThanOrEqual(560);
    expect(mocks.rename).toHaveBeenCalledTimes(3);
    expect(sent("Target.setAutoAttach", "nested-session")[0].params.waitForDebuggerOnStart).toBe(true);
  });

  it.each([
    ["Script", "http://so.szlcsc.com/public.js"], ["Script", "https://user@so.szlcsc.com/public.js"],
    ["XHR", "https://so.szlcsc.com:444/private"], ["Script", "https://evil.example/public.js"],
    ["Image", scriptUrl], ["Font", scriptUrl], ["Media", scriptUrl],
  ])("rejects %s at %s in iframe without spending a permit", async (type, url) => {
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") ws.attached("iframe-session", "iframe", "iframe-target", main);
      if (c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === "iframe-session") { ws.paused("iframe-session", "denied", type, url); ws.dom(); }
    };
    expect((await run()).error).toBeNull();
    expect(sent("Fetch.failRequest", "iframe-session")[0].params).toEqual({ requestId: "denied", errorReason: "BlockedByClient" });
    expect(sent("Fetch.continueRequest")).toHaveLength(0); expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("rejects iframe Document redirects outside fixed public pages", async () => {
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") ws.attached("iframe-session", "iframe", "iframe-target", main);
      if (c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === "iframe-session") { ws.paused("iframe-session", "redirect", "Document", "https://so.szlcsc.com/login"); ws.dom(); }
    };
    expect((await run()).error).toBeInstanceOf(PublicPageRestrictedError);
    expect(sent("Fetch.failRequest", "iframe-session")[0].params.requestId).toBe("redirect"); expect(mocks.rename).not.toHaveBeenCalled();
  });

  it.each([
    [203, "Script", main], [401, "XHR", main], [403, "Fetch", main], [429, "Stylesheet", main],
    [203, "XHR", "iframe-session"], [401, "Script", "iframe-session"], [403, "Stylesheet", "iframe-session"], [429, "XHR", "iframe-session"],
    [429, "Document", main],
  ])("stops the whole page on permitted provider %i %s in %s, cancelling queued resource IO", async (status, type, sessionId) => {
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") {
        if (sessionId === main) { ws.paused(main, "restricted", type, type === "Document" ? pageUrl : scriptUrl); ws.paused(main, "queued"); }
        else ws.attached(sessionId, "iframe", "iframe-target", main);
      }
      if (c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === sessionId && sessionId !== main) { ws.paused(sessionId, "restricted", type); ws.paused(main, "queued"); }
      if (c.method === "Fetch.continueRequest" && c.params.requestId === "restricted") ws.response(sessionId, status, type, type === "Document" ? pageUrl : scriptUrl);
    };
    const result = await run(); expect(result.error).toBeInstanceOf(PublicPageRestrictedError);
    expect(sent("Fetch.continueRequest").map(c => [c.sessionId, c.params.requestId])).toEqual([[sessionId, "restricted"]]);
    expect(kill).toHaveBeenCalledWith(-123456, "SIGKILL"); expect(sent("Runtime.evaluate")).toHaveLength(0);
  });

  it("preserves PublicPageRestrictedError when restriction arrives while navigate has no reply", async () => {
    omitReply = c => c.method === "Page.navigate";
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") ws.paused(main, "restricted", "XHR");
      if (c.method === "Fetch.continueRequest") ws.response(main, 429, "XHR");
    };
    expect((await run()).error).toBeInstanceOf(PublicPageRestrictedError);
  });

  it("does not classify a foreign response as a provider restriction", async () => {
    onCommand = (ws, c) => { if (c.method === "Page.navigate") { ws.response(main, 429, "XHR", "https://evil.example/"); ws.paused(main, "document", "Document", pageUrl); ws.dom(); } };
    expect((await run()).error).toBeNull();
  });

  it.each(["Target.closeTarget", "Fetch.enable"])("fails closed if target containment command %s fails", async method => {
    rejectCommand = c => c.method === method && (method !== "Fetch.enable" || c.sessionId === "iframe-session");
    onCommand = (ws, c) => { if (c.method === "Page.navigate") { ws.attached("worker-session", "worker", "worker-target", main); ws.attached("iframe-session", "iframe", "iframe-target", main); } };
    expect((await run()).error).toBeInstanceOf(Error);
    expect(sent("Runtime.runIfWaitingForDebugger", "worker-session")).toHaveLength(0);
    expect(sent("Runtime.runIfWaitingForDebugger", "iframe-session")).toHaveLength(0);
    expect(sent("Fetch.continueRequest")).toHaveLength(0); expect(kill).toHaveBeenCalled();
  });

  it("does not continue an iframe request that detaches while awaiting its permit", async () => {
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") { ws.paused(main, "document", "Document", pageUrl); ws.attached("iframe-session", "iframe", "iframe-target", main); }
      if (c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === "iframe-session") {
        ws.paused("iframe-session", "detached"); ws.emit({ method: "Target.detachedFromTarget", sessionId: main, params: { sessionId: "iframe-session", targetId: "iframe-target" } }); ws.dom();
      }
    };
    expect((await run()).error).toBeNull(); expect(sent("Fetch.continueRequest").map(c => c.params.requestId)).toEqual(["document"]);
  });

  it("stops rather than routing a missing-session Fetch request to the main page", async () => {
    onCommand = (ws, c) => { if (c.method === "Page.navigate") ws.emit({ method: "Fetch.requestPaused", params: { requestId: "unroutable", resourceType: "Script", request: { url: scriptUrl } } }); };
    expect((await run()).error?.message).toBe("Browser request missing session"); expect(sent("Fetch.continueRequest")).toHaveLength(0);
  });

  it("fails an iframe request in its own session if the shared permit cannot be acquired", async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error("Rate state unavailable"));
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") ws.attached("iframe-session", "iframe", "iframe-target", main);
      if (c.method === "Runtime.runIfWaitingForDebugger" && c.sessionId === "iframe-session") { ws.paused("iframe-session", "no-permit"); ws.dom(); }
    };
    expect((await run()).error).toBeNull(); expect(sent("Fetch.continueRequest")).toHaveLength(0);
    expect(sent("Fetch.failRequest", "iframe-session")[0].params.requestId).toBe("no-permit");
  });

  it("retains 55s page deadline and 58s owned-process wall limit", async () => {
    onCommand = () => {}; // Navigation replies, but parsing never becomes ready.
    const timers = vi.spyOn(globalThis, "setTimeout");
    const start = Date.now();
    const result = await run(); expect(result.error?.message).toBe("Public webpage deadline"); expect(kill).toHaveBeenCalledWith(-123456, "SIGKILL");
    expect(timers.mock.calls.some(([, delay]) => delay === 58_000)).toBe(true);
    expect(killTimes[0] - start).toBeGreaterThanOrEqual(55_000);
    expect(killTimes[0] - start).toBeLessThan(58_000);
    expect(sent("Runtime.evaluate")).toHaveLength(0);
    expect(socket.close).toHaveBeenCalled(); expect(mocks.rm).toHaveBeenCalled();
    const navigate = sent("Page.navigate")[0]; expect(navigate.at).toBeLessThan(new Date("2026-11-14T06:00:55Z").getTime());
  });

  it("TLS CONNECT still uses only the validated IPv4 and port 443 (fake transport)", async () => {
    const upstream = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn(), write: vi.fn(), pipe: vi.fn() });
    const client = Object.assign(new EventEmitter(), { destroy: vi.fn(), write: vi.fn(), pipe: vi.fn() });
    mocks.connect.mockReturnValue(upstream);
    onCommand = (ws, c) => {
      if (c.method === "Page.navigate") {
        proxy.emit("connect", { url: "so.szlcsc.com:443" }, client, Buffer.alloc(0));
        ws.paused(main, "document", "Document", pageUrl); ws.dom();
      }
    };
    expect((await run()).error).toBeNull();
    expect(mocks.resolvePublicAddress).toHaveBeenCalledWith("so.szlcsc.com");
    expect(mocks.connect).toHaveBeenCalledWith({ host: "8.8.8.8", port: 443 });
    expect(upstream.destroy).toHaveBeenCalled(); expect(client.destroy).not.toHaveBeenCalled();
  });
});
