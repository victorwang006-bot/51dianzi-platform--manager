#!/usr/bin/env node
/**
 * Isolated admin-page fixture server.
 *
 * Serves only local static files and synthesized tRPC responses. It never
 * proxies requests, reads credentials, opens a database, or mutates sources.
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "0.0.0.0";
const PORT = Number(process.env.FIXTURE_PORT || 8766);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "config.json");
const BASELINE_ROOT = "/home/ubuntu/admin-page-memory/baseline";
const CANDIDATE_ROOT = "/home/ubuntu/admin-page-memory-final/dist";
const MAX_BODY_BYTES = 1_000_000;
const FIXED_TIME = "2026-10-24T00:00:00.000Z";

const ADMIN_PERMISSIONS = Object.freeze([
  "materials.read", "materials.write", "merchants.read", "merchants.write",
  "portalUsers.read", "portalUsers.manage", "messages.read", "messages.write",
  "orders.read", "analytics.read", "profile.manage", "admins.manage", "logs.read",
]);
const SALES_STAFF = Object.freeze([
  { id: 1, staffCode: "fixture-sales-01", displayName: "合成销售甲", status: "active", sortOrder: 1 },
  { id: 2, staffCode: "fixture-sales-02", displayName: "合成销售乙", status: "active", sortOrder: 2 },
  { id: 3, staffCode: "fixture-sales-03", displayName: "合成销售丙", status: "active", sortOrder: 3 },
  { id: 4, staffCode: "fixture-sales-04", displayName: "合成销售丁", status: "active", sortOrder: 4 },
  { id: 5, staffCode: "fixture-sales-05", displayName: "合成销售戊", status: "inactive", sortOrder: 5 },
]);
const STATS = { startedAt: new Date().toISOString(), totalTrpcCalls: 0, byProcedure: Object.create(null), byRoute: Object.create(null) };

function defaultConfig() {
  return { mode: "baseline", total: 714, changedMerchantId: null };
}
function normalizeConfig(value) {
  const base = defaultConfig();
  const mode = value?.mode === "candidate" ? "candidate" : "baseline";
  const total = value?.total === 220 ? 220 : 714;
  const changed = value?.changedMerchantId;
  const changedMerchantId = Number.isInteger(changed) && changed >= 1 && changed <= total ? changed : null;
  return { ...base, mode, total, changedMerchantId };
}
function loadConfig() {
  try { return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))); }
  catch { return defaultConfig(); }
}
let config = loadConfig();
function saveConfig() {
  return fsp.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}
function sourceRoot() { return config.mode === "candidate" ? CANDIDATE_ROOT : BASELINE_ROOT; }
function candidateAvailable() { return fs.existsSync(path.join(CANDIDATE_ROOT, "index.html")); }
function modeAvailable() { return config.mode !== "candidate" || candidateAvailable(); }

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json; charset=utf-8",
  })[extension] || "application/octet-stream";
}
function isolatedHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "x-fixture-isolated": "true",
    "cross-origin-resource-policy": "same-origin",
    ...extra,
  };
}
function sendJson(res, status, value, headers) {
  const body = JSON.stringify(value);
  res.writeHead(status, isolatedHeaders({ "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), ...headers }));
  res.end(body);
}
function sendText(res, status, value, headers) {
  res.writeHead(status, isolatedHeaders({ "content-type": "text/plain; charset=utf-8", ...headers }));
  res.end(value);
}
function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  res.writeHead(200, isolatedHeaders({ "content-type": contentType(file), "content-length": stat.size }));
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}
async function requestBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}
function localFileForUrl(root, requestPath) {
  const decoded = safeDecode(requestPath);
  if (decoded === null || decoded.includes("\0") || !decoded.startsWith("/")) return null;
  const relative = decoded.replace(/^\/+/, "");
  if (!relative || relative.split("/").some(part => part === "." || part === "..")) return null;
  const rootResolved = path.resolve(root);
  const file = path.resolve(rootResolved, relative);
  if (!file.startsWith(rootResolved + path.sep)) return null;
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}
function spaRoute(pathname) {
  if (pathname === "/" || pathname.endsWith("/")) return true;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !last.includes(".");
}
function jsonInput(value) {
  // The compiled main wires the SuperJSON default instance. Plain fixture
  // values serialize as { json: value }, with no meta.values annotation.
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "json") ? value.json : value;
}
function decodePayload(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function inputsFor(procedures, raw, batch) {
  const payload = decodePayload(raw);
  return procedures.map((_, index) => jsonInput(batch ? payload[String(index)] : payload));
}
function superjsonResult(data) {
  // tRPC v11 with the verified compiled default SuperJSON transformer expects
  // result.data to be SuperJSON's {json, meta?} serialized form.
  return { result: { data: { json: data } } };
}
function trpcError(pathname, message, httpStatus = 404, code = "NOT_FOUND") {
  return {
    error: {
      json: {
        message,
        code: -32603,
        data: { code, httpStatus, path: pathname },
      },
    },
  };
}
function fixedAdmin() {
  return {
    id: 901,
    openId: "fixture-superadmin-901",
    name: "合成超级管理员",
    email: null,
    loginMethod: "fixture",
    role: "admin",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    lastSignedIn: FIXED_TIME,
    adminRole: "super_admin",
    username: "fixture_superadmin_901",
    permissions: [...ADMIN_PERMISSIONS],
  };
}
function ownerFor(id) {
  // Some records intentionally remain unassigned so $unassigned is meaningful.
  if (id % 11 === 0) return { salesOwnerCode: null, salesOwner: null };
  const staff = SALES_STAFF[(id - 1) % 4];
  return { salesOwnerCode: staff.staffCode, salesOwner: staff.displayName };
}
function merchantFor(id) {
  const owner = ownerFor(id);
  const changed = config.changedMerchantId === id;
  const registeredCompanyName = `合成企业 ${String(id).padStart(3, "0")}`;
  // Configuration changes only this display field for one synthetic record.
  const companyName = changed ? `${registeredCompanyName}（显示名已更新）` : registeredCompanyName;
  return {
    id,
    merchantNo: `FIX-M-${String(id).padStart(6, "0")}`,
    companyName,
    registeredCompanyName,
    internalContactName: null,
    contactName: "合成联系人",
    contactPhone: null,
    contactEmail: null,
    businessLicense: `FIXTURE-CREDIT-${String(id).padStart(6, "0")}`,
    legalPerson: "合成法定代表人",
    address: "合成地址（非真实）",
    businessScope: "合成经营范围（测试数据）",
    agreementStatus: ["pending", "signed", "rejected"][id % 3],
    agreementSignedAt: id % 3 === 1 ? FIXED_TIME : null,
    crmStatus: id % 5 === 0 ? "enabled" : "none",
    crmOwnerPortalUserId: id % 5 === 0 ? `fixture-portal-${id}` : null,
    crmNote: null,
    ...owner,
    settlementAccountName: "合成结算账户",
    settlementAccount: null,
    settlementBank: "合成结算机构",
    reviewNote: null,
    reviewedAt: null,
    source: "admin",
    submittedAt: null,
    status: "active",
    registrationRegion: "CN",
    hasLicenseDocument: false,
    hasHkBrDocument: false,
    hasHkCiDocument: false,
    hasHkBankDocument: false,
    hasPendingHkRegistration: false,
    hkRegistration: null,
    hkRegistrationPending: null,
    canManage: true,
    canManageLogin: true,
    canOverrideOwnerLogin: true,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  };
}
function normText(value) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
function listMerchants(input) {
  const page = Number.isInteger(input?.page) && input.page >= 1 ? input.page : 1;
  const pageSize = Number.isInteger(input?.pageSize) && input.pageSize >= 1 && input.pageSize <= 100 ? input.pageSize : 20;
  const search = normText(input?.search);
  const requestedOwner = typeof input?.salesOwnerCode === "string" ? input.salesOwnerCode.trim().toLowerCase() : "";
  let ids = Array.from({ length: config.total }, (_, index) => index + 1);
  if (search) ids = ids.filter(id => {
    const merchant = merchantFor(id);
    return merchant.companyName.toLowerCase().includes(search) || merchant.merchantNo.toLowerCase().includes(search);
  });
  if (requestedOwner === "$unassigned") ids = ids.filter(id => !ownerFor(id).salesOwnerCode);
  else if (requestedOwner) ids = ids.filter(id => ownerFor(id).salesOwnerCode === requestedOwner);
  const total = ids.length;
  const start = (page - 1) * pageSize;
  return { data: ids.slice(start, start + pageSize).map(merchantFor), total };
}
function salesOwnerOptions() {
  return {
    options: SALES_STAFF.map(staff => ({
      staffCode: staff.staffCode, displayName: staff.displayName, active: staff.status === "active",
    })),
    canViewUnassigned: true,
  };
}
function salesStaffList(input) {
  const includeInactive = input?.includeInactive ?? true;
  return SALES_STAFF.filter(staff => includeInactive || staff.status === "active").map(staff => ({ ...staff }));
}
function notificationSummary() {
  return { counts: { merchants: 0, orders: 0, reviews: 0, portalUsers: 0 } };
}
function knownProcedureData(procedure, input, method) {
  switch (procedure) {
    case "auth.me": return fixedAdmin();
    case "merchant.list": return listMerchants(input || {});
    case "merchant.salesOwnerFilterOptions": return salesOwnerOptions();
    case "merchant.detail": {
      const id = input?.id;
      return Number.isInteger(id) && id >= 1 && id <= config.total ? merchantFor(id) : null;
    }
    case "salesStaff.list": return salesStaffList(input);
    case "message.unreadCount": return { total: 0 };
    case "moduleNotification.summary": return notificationSummary();
    // Current compiled MerchantDetail requests this in parallel with detail.
    case "merchant.homepageFeatureStatus": return {
      featured: false, showcased: false, eligible: true, approvedPhotoCount: 0,
      hasPublishedInventory: false, missingReasons: [],
    };
    case "moduleNotification.markSeen":
      return method === "POST" ? { module: input?.module ?? null, markedAt: FIXED_TIME } : null;
    default: return undefined;
  }
}
function countProcedure(procedure) {
  STATS.totalTrpcCalls += 1;
  STATS.byProcedure[procedure] = (STATS.byProcedure[procedure] || 0) + 1;
}
async function handleTrpc(req, res, url) {
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "HEAD") return sendText(res, 405, "Method Not Allowed\n", { allow: "GET, HEAD, POST" });
  const suffix = safeDecode(url.pathname.slice("/api/trpc".length));
  if (suffix === null) return sendJson(res, 400, trpcError("", "invalid tRPC path", 400, "BAD_REQUEST"));
  const cleaned = suffix.replace(/^\/+|\/+$/g, "");
  const procedures = cleaned ? cleaned.split(",").filter(Boolean) : [];
  if (!procedures.length || procedures.some(p => !/^[A-Za-z0-9_.-]{1,160}$/.test(p))) {
    return sendJson(res, 400, trpcError("", "fixture requires a valid tRPC procedure", 400, "BAD_REQUEST"));
  }
  const batch = url.searchParams.get("batch") === "1";
  let rawInput = url.searchParams.get("input") || "";
  if (req.method === "POST") rawInput = await requestBody(req);
  const inputs = inputsFor(procedures, rawInput, batch);
  const results = procedures.map((procedure, index) => {
    countProcedure(procedure);
    const data = knownProcedureData(procedure, inputs[index], req.method);
    return data === undefined
      ? trpcError(procedure, "fixture does not implement this business API; no request was forwarded")
      : superjsonResult(data);
  });
  return sendJson(res, 200, batch ? results : results[0]);
}
function sourceSummary() {
  const root = sourceRoot();
  return {
    mode: config.mode,
    total: config.total,
    changedMerchantId: config.changedMerchantId,
    source: { root, index: path.join(root, "index.html"), available: modeAvailable() },
    isolation: "local static files and synthesized fixture APIs only; business APIs are never proxied",
  };
}
function statsSummary() {
  return {
    readonly: true,
    startedAt: STATS.startedAt,
    totalTrpcCalls: STATS.totalTrpcCalls,
    byProcedure: { ...STATS.byProcedure },
    byRoute: { ...STATS.byRoute },
  };
}
async function handleConfig(req, res) {
  if (req.method === "GET") return sendJson(res, 200, sourceSummary());
  if (req.method !== "POST") return sendText(res, 405, "Method Not Allowed\n", { allow: "GET, POST" });
  let body;
  try { body = JSON.parse(await requestBody(req)); }
  catch { return sendJson(res, 400, { error: "expected a JSON object" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, 400, { error: "expected a JSON object" });
  if (body.mode !== undefined && body.mode !== "baseline" && body.mode !== "candidate") {
    return sendJson(res, 400, { error: "mode must be baseline or candidate" });
  }
  if (body.total !== undefined && body.total !== 714 && body.total !== 220) {
    return sendJson(res, 400, { error: "total must be 714 or 220" });
  }
  const next = { ...config, ...body };
  const total = next.total === 220 ? 220 : 714;
  if (next.changedMerchantId !== null && next.changedMerchantId !== undefined
    && (!Number.isInteger(next.changedMerchantId) || next.changedMerchantId < 1 || next.changedMerchantId > total)) {
    return sendJson(res, 400, { error: "changedMerchantId must be null or an integer within the synthetic total" });
  }
  config = normalizeConfig(next);
  await saveConfig();
  return sendJson(res, 200, sourceSummary());
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "fixture.local"}`);
    STATS.byRoute[url.pathname] = (STATS.byRoute[url.pathname] || 0) + 1;
    if (url.pathname === "/__fixture/health") return sendJson(res, 200, { ok: true, port: PORT, ...sourceSummary() });
    if (url.pathname === "/__fixture/config") return handleConfig(req, res);
    if (url.pathname === "/__fixture/stats") return method === "GET" || method === "HEAD"
      ? sendJson(res, 200, statsSummary())
      : sendText(res, 405, "Method Not Allowed\n", { allow: "GET, HEAD" });
    // API is handled before SPA fallback: all unmocked business APIs are a
    // local 404 tRPC response and can never leave this process.
    if (url.pathname === "/api/trpc" || url.pathname.startsWith("/api/trpc/")) return handleTrpc(req, res, url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__")) return sendJson(res, 404, { error: "fixture route not found; no request was forwarded" });
    if (method !== "GET" && method !== "HEAD") return sendText(res, 404, "fixture route not found\n");
    if (!modeAvailable()) return sendJson(res, 503, { error: "candidate static output is not present yet", ...sourceSummary() });
    const root = sourceRoot();
    const staticFile = localFileForUrl(root, url.pathname)
      || (config.mode === "candidate" && url.pathname.startsWith("/assets/")
        ? localFileForUrl(CANDIDATE_ROOT, "/" + path.basename(url.pathname)) || localFileForUrl(BASELINE_ROOT, url.pathname)
        : null);
    if (staticFile) return sendFile(req, res, staticFile);
    if (spaRoute(url.pathname)) return sendFile(req, res, path.join(root, "index.html"));
    return sendText(res, 404, "fixture static file not found\n");
  } catch (error) {
    return sendJson(res, 500, { error: "fixture internal error", detail: String(error?.message || error) });
  }
});
server.listen(PORT, HOST, () => {
  console.log(`admin-page isolated fixture listening on http://${HOST}:${PORT} (mode=${config.mode}; no proxy/no DB)`);
});
