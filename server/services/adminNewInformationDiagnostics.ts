import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// Server-only, deliberately no db, schema, SQL, Zod or tRPC imports/realms.
const PROCEDURES = ["summary", "unreadRefs", "inspect", "markDisplayed"] as const;
const MODULES = ["all", "customers", "inventory", "reception", "procurement", "inbound", "sales", "mall"] as const;
const SOURCE_KINDS = ["core", "nativeOrders", "crmSales", "sellerOrders", "business", "nativeMall"] as const;
const METHODS = ["none", "internalOrder.newInformationFacts", "crmSalesOrder.newInformationFacts", "order.sellerNewInformationFacts", "customer.newInformationFacts", "channelInventory.newInformationFacts", "enterprise.inquiryNewInformationFacts", "customerDemand.procurementNewInformationFacts", "inbound.newInformationFacts", "nativeMall.read"] as const;
const PHASES = ["request", "viewer", "secret", "fence", "fenceLease", "fenceConnect", "fenceLock", "operation", "cleanup", "cleanupUnlock", "cleanupEnd", "store", "establish", "list", "lookup", "events", "receipt", "commit", "authorization", "entryRead", "validFacts", "allSettled", "union"] as const;
const OUTCOMES = ["begin", "ok", "error", "denied", "temporary"] as const;
const TRPC_CODES = new Set(["PARSE_ERROR", "BAD_REQUEST", "INTERNAL_SERVER_ERROR", "NOT_IMPLEMENTED", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "METHOD_NOT_SUPPORTED", "TIMEOUT", "CONFLICT", "PRECONDITION_FAILED", "PAYLOAD_TOO_LARGE", "UNPROCESSABLE_CONTENT", "TOO_MANY_REQUESTS", "CLIENT_CLOSED_REQUEST"]);
const MYSQL_CODES = new Set(["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_PARSE_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_DUP_ENTRY", "ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS", "PROTOCOL_CONNECTION_LOST", "PROTOCOL_SEQUENCE_TIMEOUT", "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
const SQL_STATES = new Set(["00000", "01000", "02000", "08000", "08001", "08004", "08006", "08S01", "23000", "28000", "40001", "42000", "42S02", "42S22", "HY000", "HY001", "HYT00", "HYT01"]);
const TRANSPORT_KINDS = new Set(["config", "network", "timeout", "http", "upstream", "decode", "empty", "remote", "invalid-response", "fetch", "invalid_json", "trpc", "CONFIGURATION", "NETWORK", "TIMEOUT", "UPSTREAM_4XX", "UPSTREAM_5XX", "PARSE", "INVALID_RESPONSE", "UNKNOWN"]);
const TIMINGS = new Set(["config", "fetch", "headers", "body", "decode", "response", "before_request", "request", "after_response"]);
const FENCE_CLASSES = new Set(["ADMIN_INVALID", "MERCHANT_INVALID", "LEASE_TIMEOUT", "BUSY", "DATABASE_UNAVAILABLE"]);
export type DiagnosticProcedure = typeof PROCEDURES[number];
export type DiagnosticModule = typeof MODULES[number];
export type DiagnosticPhase = typeof PHASES[number];
export type DiagnosticSourceKind = typeof SOURCE_KINDS[number];
export type DiagnosticMethod = typeof METHODS[number];
type Outcome = typeof OUTCOMES[number];
type Labels = { module?: DiagnosticModule; sourceKind?: DiagnosticSourceKind; method?: DiagnosticMethod; entry?: number };
export type SafeDiagnosticError = { trpcCode?: string; mysqlCode?: string; errno?: number; sqlState?: string; kind?: string; httpStatus?: number; upstreamTrpcCode?: string; timing?: string | number | { configMs?: number; requestMs?: number; decodeMs?: number }; fenceClass?: string };
export type AdminNewInformationDiagnosticRecord = {
  event: "adminNewInformationDiagnostic"; traceId: string; procedure: DiagnosticProcedure;
  module: DiagnosticModule; sourceKind: DiagnosticSourceKind; method: DiagnosticMethod;
  phase: DiagnosticPhase; coreStage: DiagnosticPhase; outcome: Outcome; durationMs: number;
  entry?: number; error?: SafeDiagnosticError; truncated?: boolean;
};
export type DiagnosticSink = (record: Readonly<AdminNewInformationDiagnosticRecord>) => void;
type Trace = { id: string; started: number; records: AdminNewInformationDiagnosticRecord[]; failed: boolean; truncated: boolean; closed: boolean; sink: DiagnosticSink };
type Context = Labels & { trace: Trace; procedure: DiagnosticProcedure; module: DiagnosticModule; phase: DiagnosticPhase; coreStage: DiagnosticPhase };
const storage = new AsyncLocalStorage<Context>();
const sinks = new AsyncLocalStorage<DiagnosticSink>();
const CORE_PHASES = new Set<DiagnosticPhase>(["request", "viewer", "secret", "fence", "operation", "cleanup", "store", "establish", "list", "lookup", "events", "receipt", "commit"]);
const MAX_RECORDS = 160;
const MAX_FAILURE_RECORDS_PER_MINUTE = 1200;
const MAX_SUCCESS_RECORDS_PER_MINUTE = 60;
let minute = -1, failureCount = 0, successCount = 0;
const clock = () => performance.now();
const defaultSink: DiagnosticSink = record => console.info(JSON.stringify(record));
function member<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}
function field(object: unknown, key: string): unknown {
  try { return object && typeof object === "object" ? (object as Record<string, unknown>)[key] : undefined; } catch { return undefined; }
}
// Never enumerate/spread an error, serialize it, read its message/stack/cause/SQL,
// or trust an arbitrary name, regex-shaped code, SQL state or transport value.
export function safeAdminNewInformationError(error: unknown): SafeDiagnosticError {
  const safe: SafeDiagnosticError = {};
  const code = field(error, "code");
  if (typeof code === "string" && TRPC_CODES.has(code)) safe.trpcCode = code;
  if (typeof code === "string" && MYSQL_CODES.has(code)) safe.mysqlCode = code;
  const errno = field(error, "errno");
  if (typeof errno === "number" && Number.isInteger(errno) && errno >= 1 && errno <= 65535) safe.errno = errno;
  const sqlState = field(error, "sqlState");
  if (typeof sqlState === "string" && SQL_STATES.has(sqlState)) safe.sqlState = sqlState;
  const kind = field(error, "kind");
  if (typeof kind === "string" && TRANSPORT_KINDS.has(kind)) safe.kind = kind;
  const httpStatus = field(error, "httpStatus");
  if (typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) safe.httpStatus = httpStatus;
  const upstream = field(error, "upstreamTrpcCode");
  if (typeof upstream === "string" && TRPC_CODES.has(upstream)) safe.upstreamTrpcCode = upstream;
  const timing = field(error, "timing");
  if (typeof timing === "string" && TIMINGS.has(timing)) safe.timing = timing;
  else if (typeof timing === "number" && Number.isFinite(timing) && timing >= 0 && timing <= 3_600_000) safe.timing = Math.round(timing);
  else if (timing && typeof timing === "object") {
    const phases: { configMs?: number; requestMs?: number; decodeMs?: number } = {};
    for (const key of ["configMs", "requestMs", "decodeMs"] as const) {
      const value = field(timing, key);
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 3_600_000) phases[key] = Math.round(value);
    }
    if (Object.keys(phases).length) safe.timing = phases;
  }
  const fenceClass = field(error, "fenceClass");
  if (typeof fenceClass === "string" && FENCE_CLASSES.has(fenceClass)) safe.fenceClass = fenceClass;
  return safe;
}
function elapsed(start: number) { return Math.max(0, Math.min(3_600_000, Math.round(clock() - start))); }
export function recordAdminNewInformationDiagnostic(phase: DiagnosticPhase, outcome: Outcome, started = clock(), error?: unknown, labels: Labels = {}) {
  try {
    const ctx = storage.getStore();
    if (!ctx || ctx.trace.closed) return;
    const trace = ctx.trace;
    const safeOutcome = member(OUTCOMES, outcome, "error");
    if (safeOutcome === "error" || safeOutcome === "temporary") trace.failed = true;
    const record: AdminNewInformationDiagnosticRecord = {
      event: "adminNewInformationDiagnostic", traceId: trace.id, procedure: ctx.procedure,
      module: member(MODULES, labels.module ?? ctx.module, "all"),
      sourceKind: member(SOURCE_KINDS, labels.sourceKind ?? ctx.sourceKind, "core"),
      method: member(METHODS, labels.method ?? ctx.method, "none"),
      phase: member(PHASES, phase, "request"), coreStage: ctx.coreStage, outcome: safeOutcome, durationMs: elapsed(started),
    };
    const entry = labels.entry ?? ctx.entry;
    if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry <= 96) record.entry = entry;
    if (error !== undefined) record.error = safeAdminNewInformationError(error);
    if (trace.records.length < MAX_RECORDS) trace.records.push(record);
    else {
      trace.truncated = true;
      // Retain late error/cleanup evidence in a rolling tail, still strictly bounded.
      if (safeOutcome !== "begin" && safeOutcome !== "ok") { trace.records.splice(MAX_RECORDS - 16, 1); trace.records.push(record); }
    }
  } catch { /* diagnostics never alter business control flow */ }
}
export async function adminNewInformationDiagnosticStage<T>(phase: DiagnosticPhase, operation: () => Promise<T>, labels: Labels = {}): Promise<T> {
  const ctx = storage.getStore();
  if (!ctx) return operation();
  const start = clock();
  recordAdminNewInformationDiagnostic(phase, "begin", start, undefined, labels);
  return storage.run({ ...ctx, ...labels, phase: member(PHASES, phase, "request"),
    coreStage: CORE_PHASES.has(phase) ? phase : ctx.coreStage }, async () => {
    try { const result = await operation(); recordAdminNewInformationDiagnostic(phase, "ok", start); return result; }
    catch (error) { recordAdminNewInformationDiagnostic(phase, "error", start, error); throw error; }
  });
}
export function adminNewInformationDiagnosticSync<T>(phase: DiagnosticPhase, operation: () => T): T {
  const ctx = storage.getStore();
  if (!ctx) return operation();
  const start = clock();
  return storage.run({ ...ctx, phase, coreStage: CORE_PHASES.has(phase) ? phase : ctx.coreStage }, () => {
    try { const result = operation(); recordAdminNewInformationDiagnostic(phase, "ok", start); return result; }
    catch (error) { recordAdminNewInformationDiagnostic(phase, "error", start, error); throw error; }
  });
}
export function withAdminNewInformationDiagnosticLabels<T>(labels: Labels, operation: () => T): T {
  const ctx = storage.getStore();
  return ctx ? storage.run({ ...ctx, ...labels }, operation) : operation();
}
// Stores own their transactions. This observes the genuine interval AFTER a
// callback succeeds and BEFORE withModule(s) settles; it does not claim to issue
// COMMIT itself or log a commit for a callback that failed.
export async function adminNewInformationDiagnosticStore<T>(operation: (callbackComplete: () => void) => Promise<T>): Promise<T> {
  return adminNewInformationDiagnosticStage("store", async () => {
    let commitStart: number | undefined;
    try {
      const result = await operation(() => { commitStart = clock(); recordAdminNewInformationDiagnostic("commit", "begin", commitStart); });
      if (commitStart !== undefined) recordAdminNewInformationDiagnostic("commit", "ok", commitStart);
      return result;
    } catch (error) {
      if (commitStart !== undefined) recordAdminNewInformationDiagnostic("commit", "error", commitStart, error);
      throw error;
    }
  });
}
export const adminNewInformationFenceDiagnostics = {
  stage: adminNewInformationDiagnosticStage,
};
function emit(trace: Trace, record: AdminNewInformationDiagnosticRecord, failure: boolean) {
  const now = Math.floor(Date.now() / 60_000);
  if (now !== minute) { minute = now; failureCount = 0; successCount = 0; }
  if (failure ? failureCount >= MAX_FAILURE_RECORDS_PER_MINUTE : successCount >= MAX_SUCCESS_RECORDS_PER_MINUTE) return;
  if (failure) failureCount++; else successCount++;
  try { trace.sink(Object.freeze(record)); } catch { /* sink throws must not replace response */ }
}
export async function runAdminNewInformationDiagnostic<T>(procedure: DiagnosticProcedure, module: DiagnosticModule, operation: () => Promise<T>): Promise<T> {
  const trace: Trace = { id: randomUUID(), started: clock(), records: [], failed: false, truncated: false, closed: false, sink: sinks.getStore() ?? defaultSink };
  const ctx: Context = { trace, procedure: member(PROCEDURES, procedure, "inspect"), module: member(MODULES, module, "all"), phase: "request", coreStage: "request" };
  return storage.run(ctx, async () => {
    let rejected = false;
    try { return await operation(); }
    catch (error) { rejected = true; recordAdminNewInformationDiagnostic("request", "error", trace.started, error); throw error; }
    finally {
      trace.closed = true;
      const end: AdminNewInformationDiagnosticRecord = { event: "adminNewInformationDiagnostic", traceId: trace.id, procedure: ctx.procedure, module: ctx.module, sourceKind: "core", method: "none", phase: "request", coreStage: "request", outcome: rejected ? "error" : trace.failed ? "temporary" : "ok", durationMs: elapsed(trace.started), ...(trace.truncated ? { truncated: true } : {}) };
      // Emit the bounded end first so a noisy minute cannot consume its trace end
      // budget with a partial stage sequence. Success emits ONE record, no PII.
      emit(trace, end, trace.failed);
      if (trace.failed) for (const record of trace.records) emit(trace, record, true);
      trace.records.length = 0;
    }
  });
}
// Request-scoped server injection for synthetic tests/private logging adapters;
// no global sink mutation, browser input, persistent trace registry or cache.
export function withAdminNewInformationDiagnosticSink<T>(sink: DiagnosticSink, operation: () => T): T {
  return sinks.run(sink, operation);
}
