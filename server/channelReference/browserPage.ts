import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { mkdtemp, rm, chown } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelReferenceSource } from "../../shared/channelReference";
import { allowedReferencePageUrl, allowedReferenceResourceHost, assertReferenceRobots, MAX_REFERENCE_HTML_BYTES, PublicPageRestrictedError, resolvePublicAddress } from "./publicPage";
import { waitReferenceRequestPermit } from "./requestPacing";
export { waitReferenceRequestPermit } from "./requestPacing";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export type PublicRenderedPage = { html: string; url: string };
export async function readPublicReferencePage(source: ChannelReferenceSource, url: string, binary = fileURLToPath(new URL("./browser/chrome-headless-shell-linux64/chrome-headless-shell", import.meta.url)), diagnose?: (event: { stage: string; host?: string; type?: string; status?: number; code?: string }) => void): Promise<PublicRenderedPage> {
  const trace = (event: Parameters<NonNullable<typeof diagnose>>[0]) => { try { diagnose?.(event); } catch {} };
  await assertReferenceRobots(source, url);
  const deadline = Date.now() + 55_000;
  const profile = await mkdtemp(join(tmpdir(), "51-public-reference-"));
  const sockets = new Set<Socket>();
  // The browser can connect ONLY through this ephemeral TLS proxy. DNS resolves
  // to a checked public IPv4; loopback/link-local/private destinations never pass.
  const proxy = createServer((_req, res) => { res.writeHead(403); res.end(); });
  proxy.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  proxy.on("connect", async (req, socket, head) => {
    try {
      const match = /^([a-z0-9.-]+):443$/i.exec(req.url ?? "");
      if (!match || !allowedReferenceResourceHost(source, match[1].toLowerCase())) throw new Error("Destination denied");
      const ip = await resolvePublicAddress(match[1]);
      if (Date.now() >= deadline) throw new Error("Page deadline");
      trace({ stage: "proxy-connect", host: match[1] });
      const upstream = connect({ host: ip, port: 443 }); sockets.add(upstream);
      upstream.setTimeout(15_000, () => upstream.destroy());
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", (error: NodeJS.ErrnoException) => { trace({ stage: "proxy-error", host: match[1], code: error.code }); socket.destroy(); }); socket.on("error", () => upstream.destroy());
      upstream.once("connect", () => { trace({ stage: "proxy-connected", host: match[1] }); socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    } catch { trace({ stage: "proxy-denied" }); socket.destroy(); }
  });
  let child: ReturnType<typeof spawn>;
  try {
    await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", () => resolve()); });
    const address = proxy.address(); if (!address || typeof address === "string") throw new Error("Proxy address");
    const dropPrivileges = process.getuid?.() === 0;
    if (dropPrivileges) await chown(profile, 65534, 65534);
    child = spawn(binary, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + profile, "--proxy-server=http://127.0.0.1:" + address.port, "--proxy-bypass-list=<-loopback>", "--disable-background-networking", "--no-first-run", "about:blank"], { detached: true, stdio: ["ignore", "ignore", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: tmpdir(), LANG: "C.UTF-8" }, ...(dropPrivileges ? { uid: 65534, gid: 65534 } : {}) });
  } catch (error) {
    sockets.forEach(socket => socket.destroy()); proxy.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  if (process.argv[2] === "--public-reference-page" && child.pid) process.stderr.write("CHREF_BROWSER " + JSON.stringify({ pid: child.pid, profile }) + "\n");
  let closed = false, ws: WebSocket | null = null, violation: Error | null = null;
  const stop = () => { closed = true; if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  const wallTimer = setTimeout(stop, 58_000);
  type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
  const pending = new Map<number, Pending>(); let id = 0;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let text = ""; const timer = setTimeout(() => reject(new Error("Browser startup timeout")), 8_000);
      child.once("error", e => { clearTimeout(timer); reject(e); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Browser startup failed")); });
      child.stderr?.on("data", (chunk: Buffer) => { text = (text + chunk.toString()).slice(-6000); const m = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(text); if (m) { clearTimeout(timer); resolve(m[1]); } });
    });
    ws = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Browser connection timeout")), 5_000); ws!.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true }); ws!.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Browser connection failed")); }, { once: true }); });
    let session = "", mainTargetId = "", userAgent = "", domReady = false;
    const sessions = new Map<string, Promise<void>>();
    const targetSessions = new Map<string, string>();
    let resolveMainSession!: (sessionId: string) => void;
    const mainSession = new Promise<string>(resolve => { resolveMainSession = resolve; });
    const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
    const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Browser closed"));
      const next = ++id;
      return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(next); reject(new Error("Browser command timeout: " + method)); }, Math.max(1, Math.min(8_000, deadline - Date.now()))); pending.set(next, { resolve, reject, timer }); ws!.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) })); });
    };
    // One Fetch owner per target: manual attach followed by root auto-attach
    // creates distinct sessions, so sessionId-only deduplication is insufficient.
    const protectSession = (sessionId: string, targetId: string): Promise<void> => {
      const owner = targetSessions.get(targetId);
      if (owner && owner !== sessionId) throw new Error("Browser target already has a protected session");
      targetSessions.set(targetId, sessionId);
      const existing = sessions.get(sessionId); if (existing) return existing;
      const setup = (async () => {
        await command("Page.enable", {}, sessionId); await command("Network.enable", {}, sessionId);
        await command("Runtime.enable", {}, sessionId);
        // Preserve the actual HeadlessChrome identity; append, never forge/remove it.
        await command("Network.setUserAgentOverride", { userAgent }, sessionId);
        await command("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, sessionId);
        // Auto-attach is not recursive: each allowed iframe/page needs this too.
        await command("Target.setAutoAttach", autoAttach, sessionId);
        await command("Runtime.runIfWaitingForDebugger", {}, sessionId);
      })();
      sessions.set(sessionId, setup); return setup;
    };
    ws.addEventListener("message", event => {
      if (typeof event.data !== "string" || event.data.length > MAX_REFERENCE_HTML_BYTES + 500_000) { violation = new Error("Browser response too large"); stop(); return; }
      const message = JSON.parse(event.data);
      if (message.id) { const p = pending.get(message.id); if (p) { clearTimeout(p.timer); pending.delete(message.id); message.error ? p.reject(new Error("Browser command rejected")) : p.resolve(message.result); } return; }
      if (message.method === "Target.attachedToTarget") {
        const { sessionId, targetInfo } = message.params;
        void (async () => {
          if (targetInfo.type === "iframe" || targetInfo.type === "page" && targetInfo.targetId === mainTargetId) {
            await protectSession(sessionId, targetInfo.targetId);
            if (targetInfo.targetId === mainTargetId) resolveMainSession(sessionId);
          } else {
            // Workers, service/shared workers, popups and unknown target types
            // stay debugger-paused. Never detach/resume them (that permits IO).
            trace({ stage: "target-blocked", type: targetInfo.type });
            const result = await command("Target.closeTarget", { targetId: targetInfo.targetId });
            if (result.success === false) throw new Error("Browser target could not be closed");
          }
        })().catch(error => { if (!closed) { violation = error; stop(); } });
        return;
      }
      if (message.method === "Target.detachedFromTarget") {
        sessions.delete(message.params.sessionId);
        for (const [targetId, owner] of Array.from(targetSessions.entries())) if (owner === message.params.sessionId) targetSessions.delete(targetId);
        return;
      }
      if (message.method === "Page.domContentEventFired" && message.sessionId === session) { domReady = true; trace({ stage: "dom-ready" }); }
      if (message.method === "Network.responseReceived") trace({ stage: "response", type: message.params?.type, status: message.params?.response?.status });
      if (message.method === "Network.loadingFailed") trace({ stage: "loading-failed", type: message.params?.type, code: message.params?.errorText });
      if (message.method === "Network.responseReceived" && [203, 401, 403, 429].includes(message.params.response.status)) {
        try {
          if (allowedReferenceResourceHost(source, new URL(message.params.response.url).hostname)) {
            violation = new PublicPageRestrictedError("Public webpage access restricted"); stop(); return;
          }
        } catch { /* A malformed/non-provider response is not a provider restriction. */ }
      }
      if (message.method !== "Fetch.requestPaused") return;
      const p = message.params, eventSession = message.sessionId;
      if (!eventSession) { violation = new Error("Browser request missing session"); stop(); return; }
      void (async () => {
        let permit = false;
        try {
          const u = new URL(p.request.url);
          permit = sessions.has(eventSession) && u.protocol === "https:" && !u.port && !u.username && !u.password && allowedReferenceResourceHost(source, u.hostname)
            && !["Image", "Font", "Media"].includes(p.resourceType);
          if (p.resourceType === "Document") {
            permit = permit && allowedReferencePageUrl(source, u.href);
            if (!permit) violation = new PublicPageRestrictedError("Public webpage redirect denied");
          }
          trace({ stage: permit ? "resource-permitted" : "resource-blocked", host: u.hostname, type: p.resourceType });
          if (permit) { await waitReferenceRequestPermit(source, deadline); if (closed || !sessions.has(eventSession)) return; await command("Fetch.continueRequest", { requestId: p.requestId }, eventSession); }
          else await command("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }, eventSession);
        } catch { trace({ stage: "resource-failed", type: p.resourceType }); if (!closed) await command("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }, eventSession).catch(() => {}); }
      })();
    });
    const version = await command("Browser.getVersion");
    userAgent = String(version.userAgent) + " 51Dianzi-ChannelReference/1.0";
    const target = await command("Target.createTarget", { url: "about:blank" });
    mainTargetId = target.targetId;
    // Enable root auto-attach only after the main targetId is known. Its event
    // owns main setup/resume; never manually attach a second Fetch session.
    await command("Target.setAutoAttach", autoAttach);
    session = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser main target attach timeout")), Math.max(1, Math.min(8_000, deadline - Date.now())));
      mainSession.then(sessionId => { clearTimeout(timer); resolve(sessionId); });
    });
    const navigation = await command("Page.navigate", { url }, session);
    if (navigation.errorText) throw new Error("Public webpage navigation unavailable");
    let result: { html: string; url: string; ready: string; text: string } | null = null;
    while (Date.now() < deadline && !closed) {
      await sleep(900); if (violation) throw violation;
      // Synchronous page scripts can block evaluation while their ordinary
      // resources are paced. Wait for parsing instead of timing them out early.
      if (!domReady) continue;
      const value = await command("Runtime.evaluate", { expression: "JSON.stringify({html:document.documentElement.outerHTML,url:location.href,ready:document.readyState,text:document.body?.innerText||''})", returnByValue: true }, session);
      if (typeof value.result?.value !== "string") continue;
      result = JSON.parse(value.result.value);
      if (!result || Buffer.byteLength(result.html) > MAX_REFERENCE_HTML_BYTES) throw new Error("Webpage too large");
      if (!allowedReferencePageUrl(source, result.url)) throw new PublicPageRestrictedError("Public webpage redirect denied");
      if (/验证码|访问过于频繁|安全验证|访问受限|人机验证|captcha|challenge validation/i.test(result.text)) throw new PublicPageRestrictedError("Public webpage access restricted");
      if (result.ready === "complete" && (/\d+\+\s*[¥￥]/.test(result.text) || /[¥￥]\s*\d+\.\d+/.test(result.text) || /未找到.+相关商品|没有找到|自营结果数\s*0/.test(result.text))) break;
    }
    if (violation) throw violation;
    if (!result || closed) throw new Error("Public webpage deadline");
    return { html: result.html, url: result.url };
  } catch (error) {
    // A restriction can stop the browser while navigate/evaluate is pending.
    // Preserve access_restricted rather than replacing it with a CDP timeout.
    throw violation ?? error;
  } finally {
    clearTimeout(wallTimer); closed = true;
    pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error("Browser closed")); }); pending.clear();
    try { ws?.close(); } catch {} stop();
    sockets.forEach(socket => socket.destroy()); proxy.close();
    await sleep(100); await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}
