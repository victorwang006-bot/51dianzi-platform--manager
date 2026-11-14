import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import type { ChannelReferenceSource } from "../../shared/channelReference";
import { waitReferenceRequestPermit } from "./requestPacing";

export const REFERENCE_USER_AGENT = "51Dianzi-ChannelReference/1.0 (public webpage reference; no login; low frequency)";
export const MAX_REFERENCE_HTML_BYTES = 3_000_000;
export class PublicPageRestrictedError extends Error {}

export function referenceSearchUrl(source: ChannelReferenceSource, partNumber: string): string {
  const url = new URL(source === "lcsc" ? "https://so.szlcsc.com/global.html" : "https://search.ickey.cn/");
  url.searchParams.set(source === "lcsc" ? "k" : "keyword", partNumber);
  return url.href;
}
export function allowedReferencePageUrl(source: ChannelReferenceSource, value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash) return false;
    if (source === "lcsc") return (u.hostname === "so.szlcsc.com" && u.pathname === "/global.html" && Array.from(u.searchParams.keys()).every(k => k === "k"))
      || (u.hostname === "item.szlcsc.com" && /^\/\d+\.html$/.test(u.pathname) && !u.search);
    return (u.hostname === "search.ickey.cn" && ["/", "/yuncang/search/index"].includes(u.pathname) && Array.from(u.searchParams.keys()).every(k => k === "keyword"))
      || (u.hostname === "www.ickey.cn" && /^\/detail\/\d+\/[^/]+\.html$/.test(u.pathname) && !u.search);
  } catch { return false; }
}
export function allowedReferenceResourceHost(source: ChannelReferenceSource, host: string): boolean {
  return source === "lcsc" ? host === "szlcsc.com" || host.endsWith(".szlcsc.com") : host === "ickey.cn" || host.endsWith(".ickey.cn");
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const p = address.split(".").map(Number);
    return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || p[0] === 169 && p[1] === 254
      || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168
      || p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] === 198 && [18, 19].includes(p[1]));
  }
  // Use public IPv4 for the constrained transport. Never accept mapped/private IPv6.
  return false;
}
export async function resolvePublicAddress(host: string): Promise<string> {
  const records = await lookup(host, { all: true, family: 4 });
  if (!records.length || records.some(r => !publicAddress(r.address))) throw new PublicPageRestrictedError("Non-public destination");
  return records[0].address;
}

/** RFC-style longest allow/disallow rule for the matching agent; no evaluation. */
export function robotsAllows(text: string, value: string, agent = "51Dianzi-ChannelReference"): boolean {
  type Group = { agents: string[]; rules: Array<{ allow: boolean; path: string }> };
  const groups: Group[] = []; let current: Group | null = null;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim(), match = /^([^:]+):\s*(.*)$/.exec(clean);
    if (!match) continue;
    const key = match[1].trim().toLowerCase(), val = match[2].trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase());
    } else if (current && ["allow", "disallow"].includes(key) && val) current.rules.push({ allow: key === "allow", path: val });
  }
  const name = agent.toLowerCase();
  const specificity = (g: Group) => Math.max(-1, ...g.agents.map(a => a === "*" ? 0 : name.includes(a) ? a.length : -1));
  const best = Math.max(-1, ...groups.map(specificity));
  const u = new URL(value), path = u.pathname + u.search; let winningLength = -1, allowed = true;
  for (const g of groups.filter(g => specificity(g) === best && best >= 0)) for (const rule of g.rules) {
    const pattern = "^" + rule.path.split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$");
    if (new RegExp(pattern).test(path) && (rule.path.length > winningLength || rule.path.length === winningLength && rule.allow)) {
      winningLength = rule.path.length; allowed = rule.allow;
    }
  }
  return allowed;
}
/** Connect directly to the checked address; SNI, Host and TLS verification still
 * use the original provider hostname. No second DNS lookup or redirects. */
export function readPinnedReferenceRobots(hostname: string, address: string): Promise<{ status: number; text: string }> {
  if (!publicAddress(address) || !["so.szlcsc.com", "item.szlcsc.com", "search.ickey.cn", "www.ickey.cn"].includes(hostname)) return Promise.reject(new PublicPageRestrictedError("Unsupported robots destination"));
  return new Promise((resolve, reject) => {
    let finished = false;
    let req: ReturnType<typeof request> | undefined;
    const timer = setTimeout(() => finish(new PublicPageRestrictedError("Robots timeout")), 8_000);
    const finish = (error: Error | null, value?: { status: number; text: string }) => {
      if (finished) return;
      finished = true; clearTimeout(timer); req?.destroy();
      if (error) reject(error); else resolve(value!);
    };
    req = request({ protocol: "https:", hostname: address, port: 443, servername: hostname, rejectUnauthorized: true, agent: false, method: "GET", path: "/robots.txt", headers: { Host: hostname, "User-Agent": REFERENCE_USER_AGENT } }, response => {
      const status = response.statusCode ?? 0;
      if (status !== 200) { finish(null, { status, text: "" }); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 64_000) { finish(new PublicPageRestrictedError("Robots too large")); return; }
        chunks.push(chunk);
      });
      response.once("error", error => finish(error));
      response.once("aborted", () => finish(new PublicPageRestrictedError("Robots interrupted")));
      response.once("end", () => finish(null, { status, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", error => finish(error));
    req.end();
  });
}
const robotCache = new Map<string, { text: string; expires: number }>();
export async function assertReferenceRobots(source: ChannelReferenceSource, url: string): Promise<void> {
  if (!allowedReferencePageUrl(source, url)) throw new PublicPageRestrictedError("Unsupported webpage");
  const u = new URL(url), origin = u.origin;
  const address = await resolvePublicAddress(u.hostname);
  let entry = robotCache.get(origin);
  if (!entry || entry.expires <= Date.now()) {
    await waitReferenceRequestPermit(source, Date.now() + 8_000);
    const response = await readPinnedReferenceRobots(u.hostname, address);
    if (response.status === 404 || response.status === 410) entry = { text: "", expires: Date.now() + 20 * 60_000 };
    else {
      if (response.status !== 200) throw new PublicPageRestrictedError("Robots unavailable");
      entry = { text: response.text, expires: Date.now() + 20 * 60_000 };
    }
    robotCache.set(origin, entry);
  }
  if (!robotsAllows(entry.text, url)) throw new PublicPageRestrictedError("Robots disallow webpage");
}
