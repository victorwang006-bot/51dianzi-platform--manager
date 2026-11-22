import { AsyncLocalStorage } from "node:async_hooks";
import { newInformationFactsInputSchema, newInformationFactsResultSchema } from "./newInformation.contracts.e9f76fbcf7ffe29e590a8e83f326aa388ddfacf170b45f85cf38a1a14a462d9a.runtime.mjs";
import { createHash as createHash2, randomUUID } from "node:crypto";
import { TRPCError as TRPCError3 } from "@trpc/server";
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  int as int2,
  json as json2,
  mysqlEnum as mysqlEnum2,
  mysqlTable as mysqlTable2,
  text,
  uniqueIndex,
  varchar as varchar2
} from "drizzle-orm/mysql-core";
import { z as z2 } from "zod";
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
import { TRPCError as TRPCError4 } from "@trpc/server";
import { and as and2, asc, desc, eq as eq2, inArray, isNotNull, like, ne, or, sql as sql2 } from "drizzle-orm";
import { z as z3 } from "zod";
import { createHash as createHash4 } from "node:crypto";
import { TRPCError as TRPCError5 } from "@trpc/server";
import {
  ADMIN_NEW_INFORMATION_ACTIVATED_AT,
  newInformationFactsInputSchema as newInformationFactsInputSchema2,
  newInformationFactsResultSchema as newInformationFactsResultSchema2
} from "./newInformation.contracts.e9f76fbcf7ffe29e590a8e83f326aa388ddfacf170b45f85cf38a1a14a462d9a.runtime.mjs";
import { TRPCError as TRPCError2 } from "@trpc/server";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  varchar
} from "drizzle-orm/mysql-core";
import { createHash as createHash5 } from "node:crypto";
import { eq as eq3 } from "drizzle-orm";
import {
  ADMIN_NEW_INFORMATION_ACTIVATED_AT as ADMIN_NEW_INFORMATION_ACTIVATED_AT2,
  ADMIN_NEW_INFORMATION_GENERATION,
  newInformationFactsInputSchema as newInformationFactsInputSchema3,
  newInformationFactsResultSchema as newInformationFactsResultSchema3
} from "./newInformation.contracts.e9f76fbcf7ffe29e590a8e83f326aa388ddfacf170b45f85cf38a1a14a462d9a.runtime.mjs";
export function createNativeNewInformationRuntime(native) {
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// /home/ubuntu/work/channel-release-20261121-1837/manager/server/services/adminNewInformationDiagnostics.ts (pinned compiled additive diagnostics)
function member(values, value, fallback) {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}
function field(object, key) {
  try {
    return object && typeof object === "object" ? object[key] : void 0;
  } catch {
    return void 0;
  }
}
function safeAdminNewInformationError(error) {
  const safe = {};
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
  else if (typeof timing === "number" && Number.isFinite(timing) && timing >= 0 && timing <= 36e5) safe.timing = Math.round(timing);
  else if (timing && typeof timing === "object") {
    const phases = {};
    for (const key of ["configMs", "requestMs", "decodeMs"]) {
      const value = field(timing, key);
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 36e5) phases[key] = Math.round(value);
    }
    if (Object.keys(phases).length) safe.timing = phases;
  }
  const fenceClass = field(error, "fenceClass");
  if (typeof fenceClass === "string" && FENCE_CLASSES.has(fenceClass)) safe.fenceClass = fenceClass;
  return safe;
}
function elapsed(start) {
  return Math.max(0, Math.min(36e5, Math.round(clock() - start)));
}
function recordAdminNewInformationDiagnostic(phase, outcome, started = clock(), error, labels = {}) {
  try {
    const ctx = storage.getStore();
    if (!ctx || ctx.trace.closed) return;
    const trace = ctx.trace;
    const safeOutcome = member(OUTCOMES, outcome, "error");
    if (safeOutcome === "error" || safeOutcome === "temporary") trace.failed = true;
    const record = {
      event: "adminNewInformationDiagnostic",
      traceId: trace.id,
      procedure: ctx.procedure,
      module: member(MODULES, labels.module ?? ctx.module, "all"),
      sourceKind: member(SOURCE_KINDS, labels.sourceKind ?? ctx.sourceKind, "core"),
      method: member(METHODS, labels.method ?? ctx.method, "none"),
      phase: member(PHASES, phase, "request"),
      coreStage: ctx.coreStage,
      outcome: safeOutcome,
      durationMs: elapsed(started)
    };
    const entry = labels.entry ?? ctx.entry;
    if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry <= 96) record.entry = entry;
    if (error !== void 0) record.error = safeAdminNewInformationError(error);
    if (trace.records.length < MAX_RECORDS) trace.records.push(record);
    else {
      trace.truncated = true;
      if (safeOutcome !== "begin" && safeOutcome !== "ok") {
        trace.records.splice(MAX_RECORDS - 16, 1);
        trace.records.push(record);
      }
    }
  } catch {
  }
}
async function adminNewInformationDiagnosticStage(phase, operation, labels = {}) {
  const ctx = storage.getStore();
  if (!ctx) return operation();
  const start = clock();
  recordAdminNewInformationDiagnostic(phase, "begin", start, void 0, labels);
  return storage.run({
    ...ctx,
    ...labels,
    phase: member(PHASES, phase, "request"),
    coreStage: CORE_PHASES.has(phase) ? phase : ctx.coreStage
  }, async () => {
    try {
      const result = await operation();
      recordAdminNewInformationDiagnostic(phase, "ok", start);
      return result;
    } catch (error) {
      recordAdminNewInformationDiagnostic(phase, "error", start, error);
      throw error;
    }
  });
}
function adminNewInformationDiagnosticSync(phase, operation) {
  const ctx = storage.getStore();
  if (!ctx) return operation();
  const start = clock();
  return storage.run({ ...ctx, phase, coreStage: CORE_PHASES.has(phase) ? phase : ctx.coreStage }, () => {
    try {
      const result = operation();
      recordAdminNewInformationDiagnostic(phase, "ok", start);
      return result;
    } catch (error) {
      recordAdminNewInformationDiagnostic(phase, "error", start, error);
      throw error;
    }
  });
}
function withAdminNewInformationDiagnosticLabels(labels, operation) {
  const ctx = storage.getStore();
  return ctx ? storage.run({ ...ctx, ...labels }, operation) : operation();
}
async function adminNewInformationDiagnosticStore(operation) {
  return adminNewInformationDiagnosticStage("store", async () => {
    let commitStart;
    try {
      const result = await operation(() => {
        commitStart = clock();
        recordAdminNewInformationDiagnostic("commit", "begin", commitStart);
      });
      if (commitStart !== void 0) recordAdminNewInformationDiagnostic("commit", "ok", commitStart);
      return result;
    } catch (error) {
      if (commitStart !== void 0) recordAdminNewInformationDiagnostic("commit", "error", commitStart, error);
      throw error;
    }
  });
}
function emit(trace, record, failure2) {
  const now2 = Math.floor(Date.now() / 6e4);
  if (now2 !== minute) {
    minute = now2;
    failureCount = 0;
    successCount = 0;
  }
  if (failure2 ? failureCount >= MAX_FAILURE_RECORDS_PER_MINUTE : successCount >= MAX_SUCCESS_RECORDS_PER_MINUTE) return;
  if (failure2) failureCount++;
  else successCount++;
  try {
    trace.sink(Object.freeze(record));
  } catch {
  }
}
async function runAdminNewInformationDiagnostic(procedure, module, operation) {
  const trace = { id: randomUUID(), started: clock(), records: [], failed: false, truncated: false, closed: false, sink: sinks.getStore() ?? defaultSink };
  const ctx = { trace, procedure: member(PROCEDURES, procedure, "inspect"), module: member(MODULES, module, "all"), phase: "request", coreStage: "request" };
  return storage.run(ctx, async () => {
    let rejected = false;
    try {
      return await operation();
    } catch (error) {
      rejected = true;
      recordAdminNewInformationDiagnostic("request", "error", trace.started, error);
      throw error;
    } finally {
      trace.closed = true;
      const end = { event: "adminNewInformationDiagnostic", traceId: trace.id, procedure: ctx.procedure, module: ctx.module, sourceKind: "core", method: "none", phase: "request", coreStage: "request", outcome: rejected ? "error" : trace.failed ? "temporary" : "ok", durationMs: elapsed(trace.started), ...trace.truncated ? { truncated: true } : {} };
      emit(trace, end, trace.failed);
      if (trace.failed) for (const record of trace.records) emit(trace, record, true);
      trace.records.length = 0;
    }
  });
}
function withAdminNewInformationDiagnosticSink(sink, operation) {
  return sinks.run(sink, operation);
}
var PROCEDURES, MODULES, SOURCE_KINDS, METHODS, PHASES, OUTCOMES, TRPC_CODES, MYSQL_CODES, SQL_STATES, TRANSPORT_KINDS, TIMINGS, FENCE_CLASSES, storage, sinks, CORE_PHASES, MAX_RECORDS, MAX_FAILURE_RECORDS_PER_MINUTE, MAX_SUCCESS_RECORDS_PER_MINUTE, minute, failureCount, successCount, clock, defaultSink, adminNewInformationFenceDiagnostics;
var init_adminNewInformationDiagnostics = __esm({
  "pinned-source:/home/ubuntu/work/channel-release-20261121-1837/manager/server/services/adminNewInformationDiagnostics.ts"() {
    PROCEDURES = ["summary", "unreadRefs", "inspect", "markDisplayed"];
    MODULES = ["all", "customers", "inventory", "reception", "procurement", "inbound", "sales", "mall"];
    SOURCE_KINDS = ["core", "nativeOrders", "crmSales", "sellerOrders", "business", "nativeMall"];
    METHODS = ["none", "internalOrder.newInformationFacts", "crmSalesOrder.newInformationFacts", "order.sellerNewInformationFacts", "customer.newInformationFacts", "channelInventory.newInformationFacts", "enterprise.inquiryNewInformationFacts", "customerDemand.procurementNewInformationFacts", "inbound.newInformationFacts", "nativeMall.read"];
    PHASES = ["request", "viewer", "secret", "fence", "fenceLease", "fenceConnect", "fenceLock", "operation", "cleanup", "cleanupUnlock", "cleanupEnd", "store", "establish", "list", "lookup", "events", "receipt", "commit", "authorization", "entryRead", "validFacts", "allSettled", "union"];
    OUTCOMES = ["begin", "ok", "error", "denied", "temporary"];
    TRPC_CODES = /* @__PURE__ */ new Set(["PARSE_ERROR", "BAD_REQUEST", "INTERNAL_SERVER_ERROR", "NOT_IMPLEMENTED", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "METHOD_NOT_SUPPORTED", "TIMEOUT", "CONFLICT", "PRECONDITION_FAILED", "PAYLOAD_TOO_LARGE", "UNPROCESSABLE_CONTENT", "TOO_MANY_REQUESTS", "CLIENT_CLOSED_REQUEST"]);
    MYSQL_CODES = /* @__PURE__ */ new Set(["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_PARSE_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_DUP_ENTRY", "ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS", "PROTOCOL_CONNECTION_LOST", "PROTOCOL_SEQUENCE_TIMEOUT", "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
    SQL_STATES = /* @__PURE__ */ new Set(["00000", "01000", "02000", "08000", "08001", "08004", "08006", "08S01", "23000", "28000", "40001", "42000", "42S02", "42S22", "HY000", "HY001", "HYT00", "HYT01"]);
    TRANSPORT_KINDS = /* @__PURE__ */ new Set(["config", "network", "timeout", "http", "upstream", "decode", "empty", "remote", "invalid-response", "fetch", "invalid_json", "trpc", "CONFIGURATION", "NETWORK", "TIMEOUT", "UPSTREAM_4XX", "UPSTREAM_5XX", "PARSE", "INVALID_RESPONSE", "UNKNOWN"]);
    TIMINGS = /* @__PURE__ */ new Set(["config", "fetch", "headers", "body", "decode", "response", "before_request", "request", "after_response"]);
    FENCE_CLASSES = /* @__PURE__ */ new Set(["ADMIN_INVALID", "MERCHANT_INVALID", "LEASE_TIMEOUT", "BUSY", "DATABASE_UNAVAILABLE"]);
    storage = new AsyncLocalStorage();
    sinks = new AsyncLocalStorage();
    CORE_PHASES = /* @__PURE__ */ new Set(["request", "viewer", "secret", "fence", "operation", "cleanup", "store", "establish", "list", "lookup", "events", "receipt", "commit"]);
    MAX_RECORDS = 160;
    MAX_FAILURE_RECORDS_PER_MINUTE = 1200;
    MAX_SUCCESS_RECORDS_PER_MINUTE = 60;
    minute = -1;
    failureCount = 0;
    successCount = 0;
    clock = () => performance.now();
    defaultSink = (record) => console.info(JSON.stringify(record));
    adminNewInformationFenceDiagnostics = {
      stage: adminNewInformationDiagnosticStage
    };
  }
});
init_adminNewInformationDiagnostics();


// native-bridge:/home/ubuntu/work/51dianzi-platform--manager/drizzle/schema.ts
var adminStaffArchives, materials;
var init_schema = __esm({
  "native-bridge:/home/ubuntu/work/51dianzi-platform--manager/drizzle/schema.ts"() {
    ({ adminStaffArchives, materials } = native);
  }
});

// native-bridge:/home/ubuntu/work/51dianzi-platform--manager/server/new-native-contract.ts

var init_new_native_contract = __esm({
  "native-bridge:/home/ubuntu/work/51dianzi-platform--manager/server/new-native-contract.ts"() {
  }
});

// narrow-source:/home/ubuntu/work/51dianzi-platform--manager/server/businessRouter.ts
var businessRouter_exports = {};
__export(businessRouter_exports, {
  BUSINESS_NEW_INFORMATION_READS: () => BUSINESS_NEW_INFORMATION_READS,
  readBusinessNewInformationFacts: () => readBusinessNewInformationFacts
});


async function readBusinessNewInformationFacts(ctx, merchantId, method, input) {
  const params = newInformationFactsInputSchema.parse(input);
  const module = BUSINESS_NEW_INFORMATION_READS[method];
  if (!module)
    throw new TRPCError3({ code: "FORBIDDEN", message: "\u65E0\u6548\u901A\u77E5\u8BFB\u53D6" });
  return withCurrentBusinessAuthorization(ctx, merchantId, { method, module, mode: "read" }, async (authorization) => {
    const { account, staffBinding, scope, merchant, officialInventoryPermissions } = authorization;
    const live = await db.getAdminUserById(account.id);
    if (!live || live.status !== "active" || live.sessionVersion !== account.sessionVersion) {
      throw new TRPCError3({ code: "UNAUTHORIZED", message: "\u540E\u53F0\u8D26\u53F7\u4F1A\u8BDD\u5DF2\u5931\u6548" });
    }
    const actor = businessAuditActor(ctx);
    const raw = await callPlatformBusinessCommand({
      binding: businessEnterpriseBindingFromMerchant2(merchant),
      staffUserId: staffBinding.frontUserId,
      bindingVersion: staffBinding.bindingVersion,
      adminActor: { id: account.id, name: actor.operatorName, role: actor.operatorRole },
      requestId: randomUUID(),
      method,
      params,
      officialInventoryPermissions
    });
    const result = newInformationFactsResultSchema.parse(raw);
    const version = createHash2("sha256").update(JSON.stringify([
      account.id,
      live.sessionVersion,
      staffBinding.frontUserId,
      staffBinding.bindingVersion,
      scope.scopeVersion,
      result.scope.identity,
      result.scope.version,
      officialInventoryPermissions ?? null
    ])).digest("hex");
    return { ...result, scope: {
      identity: `admin:${account.id}:merchant:${merchant.id}:${method}`,
      version,
      actorKey: `admin:${account.id}`
    } };
  }, true);
}
var db, withCurrentBusinessAuthorization, businessAuditActor, businessEnterpriseBindingFromMerchant2, callPlatformBusinessCommand, BUSINESS_NEW_INFORMATION_READS;
var init_businessRouter = __esm({
  "narrow-source:/home/ubuntu/work/51dianzi-platform--manager/server/businessRouter.ts"() {
    init_new_native_contract();
    db = native;
    withCurrentBusinessAuthorization = native.withCurrentBusinessAuthorization;
    businessAuditActor = native.businessAuditActor;
    businessEnterpriseBindingFromMerchant2 = native.businessEnterpriseBindingFromMerchant;
    callPlatformBusinessCommand = native.callPlatformBusinessCommand;
    BUSINESS_NEW_INFORMATION_READS = { "customer.newInformationFacts": "customers", "channelInventory.newInformationFacts": "inventory", "enterprise.inquiryNewInformationFacts": "inquiries", "customerDemand.procurementNewInformationFacts": "procurement", "inbound.newInformationFacts": "inventory", "crmSalesOrder.newInformationFacts": "orders", "order.sellerNewInformationFacts": "orders" };
  }
});

// native-bridge:/home/ubuntu/work/51dianzi-platform--manager/drizzle/officialChannelSchema.ts
var officialChannelTeams;
var init_officialChannelSchema = __esm({
  "native-bridge:/home/ubuntu/work/51dianzi-platform--manager/drizzle/officialChannelSchema.ts"() {
    ({ officialChannelTeams } = native);
  }
});

// work/51dianzi-platform--manager/drizzle/officialMallSchema.ts


var localTimestamp, now, officialMallMaterials, officialMallPublications, officialMallRequests;
var init_officialMallSchema = __esm({
  "work/51dianzi-platform--manager/drizzle/officialMallSchema.ts"() {
    localTimestamp = customType({
      dataType: () => "timestamp",
      fromDriver(value) {
        const raw = value;
        return raw instanceof Date ? raw : /* @__PURE__ */ new Date(String(raw).replace(" ", "T") + "+08:00");
      },
      toDriver(value) {
        return new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        }).format(value).replace("T", " ");
      }
    });
    now = sql`CURRENT_TIMESTAMP`;
    officialMallMaterials = mysqlTable2(
      "official_mall_materials",
      {
        id: int2("id").autoincrement().primaryKey(),
        publicId: varchar2("publicId", { length: 40 }).notNull(),
        teamId: int2("teamId"),
        ownerAdminUserId: int2("ownerAdminUserId").notNull(),
        createdByAdminUserId: int2("createdByAdminUserId").notNull(),
        updatedByAdminUserId: int2("updatedByAdminUserId").notNull(),
        publishedByAdminUserId: int2("publishedByAdminUserId"),
        partNumber: varchar2("partNumber", { length: 128 }).notNull(),
        brand: varchar2("brand", { length: 128 }).notNull(),
        pkg: varchar2("pkg", { length: 128 }).default("").notNull(),
        dateCode: varchar2("dateCode", { length: 64 }).default("").notNull(),
        qtyOnSale: int2("qtyOnSale"),
        qtyStock: int2("qtyStock"),
        qtyOrder: int2("qtyOrder"),
        leadTime: varchar2("leadTime", { length: 128 }).default("").notNull(),
        priceEx: varchar2("priceEx", { length: 32 }),
        taxIncluded: boolean("taxIncluded"),
        moq: int2("moq"),
        spq: int2("spq"),
        ladderPrices: json2("ladderPrices").$type().notNull(),
        note: text("note").notNull(),
        status: mysqlEnum2("status", ["draft", "published", "offshelf"]).default("draft").notNull(),
        revision: int2("revision").default(1).notNull(),
        createdAt: localTimestamp("createdAt").default(now).notNull(),
        updatedAt: localTimestamp("updatedAt").default(now).notNull(),
        publishedAt: localTimestamp("publishedAt")
      },
      (table) => ({
        publicIdUnique: uniqueIndex("om_material_public_id_uq").on(table.publicId),
        scopeStatus: index("om_material_scope_status_idx").on(
          table.teamId,
          table.status,
          table.id
        ),
        duplicateScope: index("om_material_duplicate_idx").on(
          table.teamId,
          table.partNumber,
          table.brand,
          table.pkg,
          table.dateCode
        )
      })
    );
    officialMallPublications = mysqlTable2(
      "official_mall_publications",
      {
        materialId: int2("materialId").primaryKey(),
        publicId: varchar2("publicId", { length: 40 }).notNull(),
        revision: int2("revision").notNull(),
        partNumber: varchar2("partNumber", { length: 128 }).notNull(),
        brand: varchar2("brand", { length: 128 }).notNull(),
        snapshot: json2("snapshot").$type().notNull(),
        publishedAt: localTimestamp("publishedAt").notNull()
      },
      (table) => ({
        publicIdUnique: uniqueIndex("om_publication_public_id_uq").on(
          table.publicId
        ),
        search: index("om_publication_search_idx").on(
          table.partNumber,
          table.brand
        )
      })
    );
    officialMallRequests = mysqlTable2(
      "official_mall_requests",
      {
        id: int2("id").autoincrement().primaryKey(),
        actorAdminUserId: int2("actorAdminUserId").notNull(),
        requestId: varchar2("requestId", { length: 64 }).notNull(),
        action: varchar2("action", { length: 32 }).notNull(),
        payloadHash: varchar2("payloadHash", { length: 64 }).notNull(),
        state: mysqlEnum2("state", ["pending", "completed"]).notNull(),
        result: json2("result").$type(),
        before: json2("before").$type(),
        after: json2("after").$type(),
        createdAt: localTimestamp("createdAt").default(now).notNull(),
        completedAt: localTimestamp("completedAt")
      },
      (table) => ({
        actorRequest: uniqueIndex("om_request_actor_uuid_uq").on(
          table.actorAdminUserId,
          table.requestId
        )
      })
    );
  }
});

// work/51dianzi-platform--manager/shared/officialMall.ts

var OFFICIAL_MALL_IMPORT_LIMIT, OFFICIAL_MALL_BULK_LIMIT, officialMallRequestIdSchema, officialMallIdSchema, officialMallRevisionSchema, quantity, packQuantity, price, officialMallTierSchema, officialMallMaterialInputSchema, officialMallListSchema, officialMallRowMutationSchema, officialMallImportRowSchema;
var init_officialMall = __esm({
  "work/51dianzi-platform--manager/shared/officialMall.ts"() {
    OFFICIAL_MALL_IMPORT_LIMIT = 500;
    OFFICIAL_MALL_BULK_LIMIT = 100;
    officialMallRequestIdSchema = z2.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
    officialMallIdSchema = z2.number().int().positive().max(2147483647);
    officialMallRevisionSchema = z2.number().int().positive().max(2147483647);
    quantity = z2.number().int().min(0).max(2147483647).nullable().default(null);
    packQuantity = z2.number().int().min(1).max(2147483647).nullable().default(null);
    price = z2.string().trim().max(32).regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/, "\u5355\u4EF7\u683C\u5F0F\u6216\u7CBE\u5EA6\u65E0\u6548");
    officialMallTierSchema = z2.object({ minQty: z2.number().int().positive().max(2147483647), price: price.refine((v) => Number(v) > 0, "\u9636\u68AF\u5355\u4EF7\u5FC5\u987B\u5927\u4E8E0") }).strict();
    officialMallMaterialInputSchema = z2.object({
      partNumber: z2.string().trim().min(1, "\u8BF7\u8F93\u5165\u578B\u53F7").max(128),
      brand: z2.string().trim().min(1, "\u8BF7\u8F93\u5165\u54C1\u724C").max(128),
      pkg: z2.string().trim().max(128).default(""),
      dateCode: z2.string().trim().max(64).default(""),
      qtyOnSale: quantity,
      qtyStock: quantity,
      qtyOrder: quantity,
      leadTime: z2.string().trim().max(128).default(""),
      priceEx: price.nullable().default(null),
      taxIncluded: z2.boolean().nullable().default(null),
      moq: packQuantity,
      spq: packQuantity,
      ladderPrices: z2.array(officialMallTierSchema).max(10).default([]),
      note: z2.string().trim().max(2e3).default("")
    }).strict().superRefine((d, ctx) => {
      if (d.qtyOnSale != null && d.qtyStock != null && d.qtyOnSale > d.qtyStock) ctx.addIssue({ code: "custom", path: ["qtyOnSale"], message: "\u53EF\u552E\u6570\u91CF\u4E0D\u80FD\u8D85\u8FC7\u5B9E\u9645\u5E93\u5B58" });
      let previous = 0;
      d.ladderPrices.forEach((tier, i) => {
        if (tier.minQty <= previous) ctx.addIssue({ code: "custom", path: ["ladderPrices", i, "minQty"], message: "\u68AF\u5EA6\u6570\u91CF\u987B\u9012\u589E\u4E14\u4E0D\u80FD\u91CD\u590D" });
        previous = tier.minQty;
      });
    });
    officialMallListSchema = z2.object({
      partNumber: z2.string().trim().max(128).optional(),
      brand: z2.string().trim().max(128).optional(),
      status: z2.enum(["draft", "published", "offshelf"]).optional(),
      page: z2.number().int().min(1).max(1e4).default(1),
      pageSize: z2.number().int().min(1).max(100).default(30)
    }).strict();
    officialMallRowMutationSchema = z2.object({
      id: officialMallIdSchema,
      expectedRevision: officialMallRevisionSchema,
      requestId: officialMallRequestIdSchema
    }).strict();
    officialMallImportRowSchema = z2.object({
      rowNumber: z2.number().int().positive(),
      data: officialMallMaterialInputSchema,
      duplicatePolicy: z2.enum(["skip", "update", "new"]).default("skip"),
      duplicateId: officialMallIdSchema.optional(),
      expectedRevision: officialMallRevisionSchema.optional()
    }).strict().superRefine((r, ctx) => {
      if (r.duplicatePolicy === "update" && (!r.duplicateId || !r.expectedRevision)) ctx.addIssue({ code: "custom", message: "\u66F4\u65B0\u91CD\u590D\u7269\u6599\u5FC5\u987B\u643A\u5E26\u539F\u8BB0\u5F55\u4E0E\u7248\u672C" });
    });
  }
});

// work/51dianzi-platform--manager/server/services/officialMall.ts




function fail(message, code = "BAD_REQUEST") {
  throw new TRPCError4({ code, message });
}
function canonicalJson(value) {
  if (value === void 0) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value;
  return `{${Object.keys(row).filter((key) => row[key] !== void 0).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
}
function payloadHash(action, actor, payload) {
  return createHash3("sha256").update(
    canonicalJson({ action, actorAdminUserId: actor.adminUserId, payload })
  ).digest("hex");
}
function exactPrice(value) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1e6) + BigInt(fraction.padEnd(6, "0"));
}
function validateOfficialMallMaterial(value) {
  const result = officialMallMaterialInputSchema.safeParse(value);
  if (!result.success)
    fail(
      result.error.issues.map((issue) => `${issue.path.join(".") || "\u7269\u6599"}: ${issue.message}`).join("\uFF1B")
    );
  const data = result.data;
  if (data.priceEx !== null && exactPrice(data.priceEx) <= BigInt(0))
    fail("\u57FA\u7840\u5355\u4EF7\u5FC5\u987B\u5927\u4E8E0\uFF0C\u9762\u8BAE\u8BF7\u7559\u7A7A");
  let previousPrice = data.priceEx === null ? null : exactPrice(data.priceEx);
  for (const tier of data.ladderPrices) {
    const current = exactPrice(tier.price);
    if (previousPrice !== null && current > previousPrice)
      fail("\u68AF\u5EA6\u5355\u4EF7\u4E0D\u80FD\u968F\u6570\u91CF\u589E\u52A0\u800C\u4E0A\u5347");
    previousPrice = current;
  }
  if (/(现货|立[即刻]?发|即发|秒发|当天[发出]|当日[发出]|24\s*[hH小时]|当天到)/.test(
    data.leadTime
  ) && !(data.qtyOnSale !== null && data.qtyOnSale > 0 && data.qtyStock !== null && data.qtyStock > 0)) {
    fail("\u96F6\u5E93\u5B58\u6216\u6570\u91CF\u672A\u786E\u8BA4\u4E0D\u80FD\u58F0\u660E\u73B0\u8D27\u7ACB\u53D1\uFF0C\u8BF7\u586B\u5199\u771F\u5B9E\u8D27\u671F\u6216\u8BE2\u4EF7");
  }
  return data;
}
function assertPublishable(data) {
  if (!(data.qtyOnSale !== null && data.qtyOnSale > 0) && !(data.qtyOrder !== null && data.qtyOrder > 0))
    fail("\u4E0A\u67B6\u987B\u660E\u786E\u586B\u5199\u5927\u4E8E0\u7684\u53EF\u552E\u6570\u91CF\u6216\u8BA2\u8D27\u6570\u91CF");
  if (!data.leadTime.trim()) fail("\u4E0A\u67B6\u987B\u586B\u5199\u660E\u786E\u8D27\u671F");
}
function assertRevision(actual, expected) {
  if (actual !== expected) fail("\u7269\u6599\u7248\u672C\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", "CONFLICT");
  if (actual >= 2147483647) fail("\u7269\u6599\u7248\u672C\u8FBE\u5230\u4E0A\u9650\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458", "CONFLICT");
}
function inputFromRow(row) {
  return validateOfficialMallMaterial({
    partNumber: row.partNumber,
    brand: row.brand,
    pkg: row.pkg,
    dateCode: row.dateCode,
    qtyOnSale: row.qtyOnSale,
    qtyStock: row.qtyStock,
    qtyOrder: row.qtyOrder,
    leadTime: row.leadTime,
    priceEx: row.priceEx,
    taxIncluded: row.taxIncluded,
    moq: row.moq,
    spq: row.spq,
    ladderPrices: row.ladderPrices,
    note: row.note
  });
}
function privateMaterial(row) {
  return {
    ...inputFromRow(row),
    id: row.id,
    revision: row.revision,
    status: row.status,
    teamId: row.teamId,
    ownerAdminUserId: row.ownerAdminUserId,
    createdByAdminUserId: row.createdByAdminUserId,
    updatedByAdminUserId: row.updatedByAdminUserId,
    publishedByAdminUserId: row.publishedByAdminUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt
  };
}
function publicProjection(row, publishedAt) {
  const data = validateOfficialMallMaterial({
    partNumber: row.partNumber,
    brand: row.brand,
    pkg: row.pkg,
    dateCode: row.dateCode,
    qtyOnSale: row.qtyOnSale,
    qtyStock: row.qtyStock,
    qtyOrder: row.qtyOrder,
    leadTime: row.leadTime,
    priceEx: row.priceEx,
    taxIncluded: row.taxIncluded,
    moq: row.moq,
    spq: row.spq,
    ladderPrices: row.ladderPrices,
    note: ""
  });
  return {
    sourceType: "official_mall",
    publicId: row.publicId,
    revision: row.revision,
    partNumber: data.partNumber,
    brand: data.brand,
    pkg: data.pkg,
    dateCode: data.dateCode,
    qtyOnSale: data.qtyOnSale,
    qtyStock: data.qtyStock,
    qtyOrder: data.qtyOrder,
    leadTime: data.leadTime,
    priceEx: data.priceEx,
    taxIncluded: data.taxIncluded,
    moq: data.moq,
    spq: data.spq,
    ladderPrices: data.ladderPrices.map((tier) => ({
      minQty: tier.minQty,
      price: tier.price
    })),
    publishedAt
  };
}
function sameIdentity(a, b) {
  const normalize = (v) => v.normalize("NFKC").trim().toLowerCase();
  return ["partNumber", "brand", "pkg", "dateCode"].every(
    (key) => normalize(a[key]) === normalize(b[key])
  );
}
function suggestion(row) {
  return { partNumber: row.partNumber, brand: row.brand, pkg: row.pkg };
}
function duplicate(row) {
  return {
    id: row.id,
    revision: row.revision,
    partNumber: row.partNumber,
    brand: row.brand,
    pkg: row.pkg,
    dateCode: row.dateCode
  };
}
function matchStatus(data, matches) {
  if (matches.length > 1) return "multiple";
  if (matches.length === 1 && matches[0].partNumber.toLowerCase() === data.partNumber.toLowerCase() && matches[0].brand.toLowerCase() === data.brand.toLowerCase() && (!data.pkg || matches[0].pkg.toLowerCase() === data.pkg.toLowerCase()))
    return "exact";
  return "unmatched";
}
function safeError(error) {
  return error instanceof TRPCError4 ? error.message : "\u672C\u5730\u6570\u636E\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9\u539F\u8BF7\u6C42\u7ED3\u679C";
}
function throwSecurity(error) {
  if (error instanceof TRPCError4 && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code))
    throw error;
}
function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
function createOfficialMallService(deps) {
  async function db2() {
    const connection = await deps.getDb();
    if (!connection)
      fail("\u540E\u53F0\u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u6838\u5BF9\u539F\u8BF7\u6C42\u7ED3\u679C", "INTERNAL_SERVER_ERROR");
    return connection;
  }
  async function withAccess(actor, permission, run) {
    return (await db2()).transaction(
      async (tx) => {
        const access = await deps.loadOfficialAccess(tx, actor, permission);
        deps.officialTeamPredicate(access, officialMallMaterials);
        return run(tx, access);
      },
      { isolationLevel: "repeatable read" }
    );
  }
  async function loadMaterial(tx, access, id, action) {
    const [row] = await tx.select().from(officialMallMaterials).where(
      and2(deps.officialTeamPredicate(access, officialMallMaterials), eq2(officialMallMaterials.id, id))
    ).limit(1).for("update");
    if (!row) fail("\u5B98\u65B9\u8BB0\u5F55\u4E0D\u5B58\u5728\u6216\u4E0D\u5728\u5F53\u524D\u56E2\u961F\u8303\u56F4\u5185", "FORBIDDEN");
    deps.assertOfficialRecordAction(access, row, action);
    if (action !== "read") {
      if (!row.teamId) fail("\u5546\u57CE\u7269\u6599\u5FC5\u987B\u5C5E\u4E8E\u6709\u6548\u5B98\u65B9\u56E2\u961F", "FORBIDDEN");
      const [team] = await tx.select({
        id: officialChannelTeams.id,
        status: officialChannelTeams.status
      }).from(officialChannelTeams).where(eq2(officialChannelTeams.id, row.teamId)).limit(1).for("update");
      if (!team || team.status !== "active")
        fail("\u7269\u6599\u6240\u5C5E\u5B98\u65B9\u56E2\u961F\u4E0D\u5B58\u5728\u6216\u5DF2\u5F52\u6863", "FORBIDDEN");
    }
    return row;
  }
  async function chooseTeam(tx, access, teamId) {
    if (!access.isSuperAdmin && teamId !== void 0 && teamId !== access.teamId)
      fail("\u666E\u901A\u5DE5\u4F5C\u4EBA\u5458\u4E0D\u80FD\u6307\u5B9A\u5176\u4ED6\u5B98\u65B9\u56E2\u961F", "FORBIDDEN");
    const selected = teamId ?? access.teamId;
    if (!selected)
      fail("\u8BF7\u5148\u914D\u7F6E\u6709\u6548\u5B98\u65B9\u56E2\u961F\uFF1B\u8D85\u7EA7\u7BA1\u7406\u5458\u987B\u660E\u786E\u9009\u62E9\u56E2\u961F", "FORBIDDEN");
    const [team] = await tx.select({
      id: officialChannelTeams.id,
      status: officialChannelTeams.status
    }).from(officialChannelTeams).where(eq2(officialChannelTeams.id, selected)).limit(1).for("update");
    if (!team || team.status !== "active")
      fail("\u5B98\u65B9\u56E2\u961F\u4E0D\u5B58\u5728\u6216\u5DF2\u5F52\u6863", "FORBIDDEN");
    return selected;
  }
  async function write(actor, action, input, permission, recordAction, run) {
    return withAccess(actor, permission, async (tx, access) => {
      const hash = payloadHash(action, actor, input);
      const key = and2(
        eq2(officialMallRequests.actorAdminUserId, actor.adminUserId),
        eq2(officialMallRequests.requestId, input.requestId)
      );
      const [receipt] = await tx.select().from(officialMallRequests).where(key).limit(1).for("update");
      if (receipt) {
        if (receipt.action !== action || receipt.payloadHash !== hash)
          fail("\u539F requestId \u5DF2\u7528\u4E8E\u4E0D\u540C\u5185\u5BB9\uFF0C\u4E0D\u5F97\u91CD\u7528", "CONFLICT");
        if (receipt.state !== "completed" || !receipt.result)
          fail(
            "\u539F\u8BF7\u6C42\u7ED3\u679C\u5C1A\u672A\u786E\u5B9A\uFF0C\u8BF7\u67E5\u8BE2 requestStatus\uFF0C\u52FF\u81EA\u52A8\u91CD\u53D1",
            "CONFLICT"
          );
        for (const row of receipt.after ?? [])
          await loadMaterial(tx, access, row.id, recordAction);
        return { ...receipt.result, idempotent: true };
      }
      await tx.insert(officialMallRequests).values({
        actorAdminUserId: actor.adminUserId,
        requestId: input.requestId,
        action,
        payloadHash: hash,
        state: "pending"
      });
      const audit = { before: [], after: [] };
      const result = await run({ tx, access, audit });
      await tx.update(officialMallRequests).set({
        state: "completed",
        result,
        before: audit.before,
        after: audit.after,
        completedAt: /* @__PURE__ */ new Date()
      }).where(key);
      return result;
    });
  }
  async function insertMaterial(context, actor, teamId, data) {
    const created = await context.tx.insert(officialMallMaterials).values({
      ...data,
      publicId: `OM_${randomUUID2()}`,
      teamId,
      ownerAdminUserId: actor.adminUserId,
      createdByAdminUserId: actor.adminUserId,
      updatedByAdminUserId: actor.adminUserId,
      status: "draft",
      revision: 1,
      publishedByAdminUserId: null,
      publishedAt: null
    }).$returningId();
    const row = await loadMaterial(
      context.tx,
      context.access,
      created[0].id,
      "manage"
    );
    context.audit.after.push(row);
    return row;
  }
  async function updateMaterial(context, actor, row, revision, data) {
    assertRevision(row.revision, revision);
    if (row.status === "published")
      fail("\u5DF2\u4E0A\u67B6\u7269\u6599\u5FC5\u987B\u5148\u663E\u5F0F\u4E0B\u67B6\uFF0C\u518D\u7F16\u8F91\u4FDD\u5B58\u4E3A\u5F85\u4E0A\u67B6", "CONFLICT");
    context.audit.before.push(row);
    await context.tx.delete(officialMallPublications).where(eq2(officialMallPublications.materialId, row.id));
    await context.tx.update(officialMallMaterials).set({
      ...data,
      status: "draft",
      revision: row.revision + 1,
      updatedByAdminUserId: actor.adminUserId,
      updatedAt: /* @__PURE__ */ new Date(),
      publishedByAdminUserId: null,
      publishedAt: null
    }).where(
      and2(
        eq2(officialMallMaterials.id, row.id),
        eq2(officialMallMaterials.revision, row.revision),
        deps.officialTeamPredicate(context.access, officialMallMaterials)
      )
    );
    const after = await loadMaterial(
      context.tx,
      context.access,
      row.id,
      "manage"
    );
    context.audit.after.push(after);
    return after;
  }
  async function changePublication(context, actor, row, revision, action) {
    assertRevision(row.revision, revision);
    const data = inputFromRow(row);
    if (action === "publish") assertPublishable(data);
    if (action === "publish" && row.status === "published")
      fail("\u7269\u6599\u5DF2\u7ECF\u4E0A\u67B6\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9", "CONFLICT");
    if (action === "offshelf" && row.status !== "published")
      fail("\u53EA\u6709\u5DF2\u4E0A\u67B6\u7269\u6599\u53EF\u663E\u5F0F\u4E0B\u67B6", "CONFLICT");
    const date = /* @__PURE__ */ new Date();
    const nextRevision = row.revision + 1;
    const status = action === "publish" ? "published" : "offshelf";
    context.audit.before.push(row);
    await context.tx.delete(officialMallPublications).where(eq2(officialMallPublications.materialId, row.id));
    if (action === "publish") {
      const snapshot = publicProjection(
        { ...data, publicId: row.publicId, revision: nextRevision },
        date.toISOString()
      );
      await context.tx.insert(officialMallPublications).values({
        materialId: row.id,
        publicId: row.publicId,
        revision: nextRevision,
        partNumber: snapshot.partNumber,
        brand: snapshot.brand,
        snapshot,
        publishedAt: date
      });
    }
    await context.tx.update(officialMallMaterials).set({
      status,
      revision: nextRevision,
      updatedByAdminUserId: actor.adminUserId,
      updatedAt: date,
      publishedByAdminUserId: action === "publish" ? actor.adminUserId : null,
      publishedAt: action === "publish" ? date : null
    }).where(
      and2(
        eq2(officialMallMaterials.id, row.id),
        eq2(officialMallMaterials.revision, row.revision),
        deps.officialTeamPredicate(context.access, officialMallMaterials)
      )
    );
    const after = await loadMaterial(
      context.tx,
      context.access,
      row.id,
      "publish"
    );
    context.audit.after.push(after);
    return after;
  }
  const resultFor = (row) => ({
    success: true,
    id: row.id,
    revision: row.revision,
    status: row.status
  });
  async function findDuplicates(tx, access, data) {
    return tx.select().from(officialMallMaterials).where(
      and2(
        deps.officialTeamPredicate(access, officialMallMaterials),
        eq2(officialMallMaterials.partNumber, data.partNumber),
        eq2(officialMallMaterials.brand, data.brand),
        eq2(officialMallMaterials.pkg, data.pkg),
        eq2(officialMallMaterials.dateCode, data.dateCode)
      )
    ).orderBy(asc(officialMallMaterials.id)).for("update");
  }
  async function suggestions(tx, access, query, brand) {
    if (!query) return [];
    const rows = await tx.select({
      partNumber: officialMallMaterials.partNumber,
      brand: officialMallMaterials.brand,
      pkg: officialMallMaterials.pkg
    }).from(officialMallMaterials).where(
      and2(
        deps.officialTeamPredicate(access, officialMallMaterials),
        or(
          like(officialMallMaterials.partNumber, likePattern(query)),
          like(officialMallMaterials.brand, likePattern(query))
        ),
        brand ? eq2(officialMallMaterials.brand, brand) : void 0
      )
    ).groupBy(officialMallMaterials.partNumber, officialMallMaterials.brand, officialMallMaterials.pkg).orderBy(
      asc(officialMallMaterials.partNumber),
      asc(officialMallMaterials.brand),
      asc(officialMallMaterials.pkg)
    ).limit(20);
    const catalogRows = await tx.select({
      partNumber: materials.partNumber,
      brand: materials.brand,
      pkg: materials.package
    }).from(materials).where(
      and2(
        eq2(materials.status, "enabled"),
        isNotNull(materials.brand),
        ne(materials.brand, ""),
        or(
          like(materials.partNumber, likePattern(query)),
          like(materials.brand, likePattern(query))
        ),
        brand ? eq2(materials.brand, brand) : void 0
      )
    ).groupBy(
      materials.partNumber,
      materials.brand,
      materials.package
    ).orderBy(
      asc(materials.partNumber),
      asc(materials.brand),
      asc(materials.package)
    ).limit(20);
    const merged = /* @__PURE__ */ new Map();
    for (const row of [...rows, ...catalogRows]) {
      if (!row.partNumber?.trim() || !row.brand?.trim()) continue;
      const candidate = suggestion({ ...row, pkg: row.pkg ?? "" });
      const key = canonicalJson(
        [candidate.partNumber, candidate.brand, candidate.pkg].map(
          (value) => value.normalize("NFKC").trim().toLowerCase()
        )
      );
      if (!merged.has(key)) merged.set(key, candidate);
      if (merged.size === 20) break;
    }
    return Array.from(merged.values());
  }
  function publicJoin() {
    return and2(
      eq2(officialMallPublications.materialId, officialMallMaterials.id),
      eq2(officialMallPublications.publicId, officialMallMaterials.publicId),
      eq2(officialMallPublications.revision, officialMallMaterials.revision),
      eq2(officialMallMaterials.status, "published")
    );
  }
  function readSnapshot(row) {
    return publicProjection(
      {
        ...row.snapshot,
        note: "",
        publicId: row.publicId,
        revision: row.revision
      },
      row.publishedAt.toISOString()
    );
  }
  return {
    async status(actor) {
      try {
        return await withAccess(
          actor,
          "officialInventory.read",
          async (tx, access) => ({
            available: true,
            permissions: {
              read: access.permissions.includes("officialInventory.read"),
              write: access.permissions.includes("officialInventory.write"),
              publish: access.permissions.includes("officialInventory.publish")
            },
            scope: {
              adminUserId: access.adminUserId,
              teamId: access.teamId,
              teamRole: access.teamRole,
              isSuperAdmin: access.isSuperAdmin
            },
            ...access.isSuperAdmin ? {
              teams: await tx.select({
                id: officialChannelTeams.id,
                name: officialChannelTeams.name
              }).from(officialChannelTeams).where(eq2(officialChannelTeams.status, "active")).orderBy(asc(officialChannelTeams.id))
            } : {}
          })
        );
      } catch (error) {
        if (!(error instanceof TRPCError4) || !["FORBIDDEN", "UNAUTHORIZED"].includes(error.code))
          throw error;
        return {
          available: false,
          permissions: { read: false, write: false, publish: false },
          scope: {
            adminUserId: actor.adminUserId,
            teamId: null,
            teamRole: null,
            isSuperAdmin: false
          },
          message: error.message
        };
      }
    },
    /**
     * One authority-fenced RR transaction, no writes, pagination or mutable fields.
     * Reuses the native account/session/grant/team algorithm exactly as private list.
     * undefined IDs means ALL current authorized rows; [] means an empty intersection.
     */
    async readNewInformationFacts(actor, ids) {
      if (ids !== void 0 && (ids.length > 100 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)))
        fail("\u5546\u57CE\u7269\u6599\u4E8B\u5B9E\u5F15\u7528\u65E0\u6548");
      return withAccess(actor, "officialInventory.read", async (tx, access) => {
        const items = await tx.select({
          id: officialMallMaterials.id,
          createdAt: officialMallMaterials.createdAt,
          createdByAdminUserId: officialMallMaterials.createdByAdminUserId
        }).from(officialMallMaterials).where(and2(
          deps.officialTeamPredicate(access, officialMallMaterials),
          ids === void 0 ? void 0 : ids.length ? inArray(officialMallMaterials.id, [...ids]) : sql2`1 = 0`
        )).orderBy(asc(officialMallMaterials.id));
        return { access, items };
      });
    },
    async list(actor, value) {
      const input = officialMallListSchema.parse(value);
      return withAccess(actor, "officialInventory.read", async (tx, access) => {
        const where = and2(
          deps.officialTeamPredicate(access, officialMallMaterials),
          input.partNumber ? like(officialMallMaterials.partNumber, likePattern(input.partNumber)) : void 0,
          input.brand ? like(officialMallMaterials.brand, likePattern(input.brand)) : void 0,
          input.status ? eq2(officialMallMaterials.status, input.status) : void 0
        );
        const [{ total }] = await tx.select({ total: sql2`count(*)` }).from(officialMallMaterials).where(where);
        const rows = await tx.select().from(officialMallMaterials).where(where).orderBy(desc(officialMallMaterials.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
        return {
          items: rows.map(privateMaterial),
          total: Number(total),
          page: input.page,
          pageSize: input.pageSize
        };
      });
    },
    async create(actor, value) {
      const input = officialMallCreateSchema.parse(value);
      input.data = validateOfficialMallMaterial(input.data);
      return write(
        actor,
        "create",
        input,
        "officialInventory.write",
        "manage",
        async (context) => resultFor(
          await insertMaterial(
            context,
            actor,
            await chooseTeam(context.tx, context.access, input.teamId),
            input.data
          )
        )
      );
    },
    async update(actor, value) {
      const input = officialMallUpdateSchema.parse(value);
      input.data = validateOfficialMallMaterial(input.data);
      return write(
        actor,
        "update",
        input,
        "officialInventory.write",
        "manage",
        async (context) => resultFor(
          await updateMaterial(
            context,
            actor,
            await loadMaterial(
              context.tx,
              context.access,
              input.id,
              "manage"
            ),
            input.expectedRevision,
            input.data
          )
        )
      );
    },
    async publish(actor, value) {
      const input = officialMallRowMutationSchema.parse(value);
      return write(
        actor,
        "publish",
        input,
        "officialInventory.publish",
        "publish",
        async (context) => resultFor(
          await changePublication(
            context,
            actor,
            await loadMaterial(
              context.tx,
              context.access,
              input.id,
              "publish"
            ),
            input.expectedRevision,
            "publish"
          )
        )
      );
    },
    async offshelf(actor, value) {
      const input = officialMallRowMutationSchema.parse(value);
      return write(
        actor,
        "offshelf",
        input,
        "officialInventory.publish",
        "publish",
        async (context) => resultFor(
          await changePublication(
            context,
            actor,
            await loadMaterial(
              context.tx,
              context.access,
              input.id,
              "publish"
            ),
            input.expectedRevision,
            "offshelf"
          )
        )
      );
    },
    async bulkAction(actor, value) {
      const input = officialMallBulkSchema.parse(value);
      if (new Set(input.items.map((item) => item.id)).size !== input.items.length)
        fail("\u6279\u91CF\u64CD\u4F5C\u5305\u542B\u91CD\u590D\u7269\u6599 ID");
      return write(
        actor,
        `bulk_${input.action}`,
        input,
        "officialInventory.publish",
        "publish",
        async (context) => {
          const locked = /* @__PURE__ */ new Map();
          for (const item of [...input.items].sort((a, b) => a.id - b.id))
            locked.set(
              item.id,
              await loadMaterial(context.tx, context.access, item.id, "publish")
            );
          const result = {
            success: true,
            successful: 0,
            errors: []
          };
          for (const item of input.items) {
            const row = locked.get(item.id);
            try {
              assertRevision(row.revision, item.expectedRevision);
              const data = inputFromRow(row);
              if (input.action === "publish") assertPublishable(data);
              if (input.action === "publish" && row.status === "published")
                fail("\u7269\u6599\u5DF2\u7ECF\u4E0A\u67B6", "CONFLICT");
              if (input.action === "offshelf" && row.status !== "published")
                fail("\u53EA\u6709\u5DF2\u4E0A\u67B6\u7269\u6599\u53EF\u4E0B\u67B6", "CONFLICT");
            } catch (error) {
              throwSecurity(error);
              result.errors.push({ id: item.id, message: safeError(error) });
              continue;
            }
            await changePublication(
              context,
              actor,
              row,
              item.expectedRevision,
              input.action
            );
            result.successful++;
          }
          result.success = result.errors.length === 0;
          return result;
        }
      );
    },
    async requestStatus(actor, value) {
      const input = officialMallRequestStatusSchema.parse(value);
      return withAccess(actor, "officialInventory.read", async (tx) => {
        const [receipt] = await tx.select({ state: officialMallRequests.state, result: officialMallRequests.result }).from(officialMallRequests).where(
          and2(
            eq2(officialMallRequests.actorAdminUserId, actor.adminUserId),
            eq2(officialMallRequests.requestId, input.requestId)
          )
        ).limit(1);
        if (!receipt) return { state: "not_found", result: null };
        return {
          state: receipt.state,
          result: receipt.state === "completed" ? receipt.result : null
        };
      });
    },
    async suggest(actor, value) {
      const input = officialMallSuggestSchema.parse(value);
      return withAccess(
        actor,
        "officialInventory.read",
        async (tx, access) => ({
          items: await suggestions(tx, access, input.query, input.brand)
        })
      );
    },
    async importPreview(actor, value) {
      const input = officialMallPreviewSchema.parse(value);
      return withAccess(actor, "officialInventory.read", async (tx, access) => {
        const rows = [];
        const seen = /* @__PURE__ */ new Map();
        const rowNumbers = /* @__PURE__ */ new Set();
        for (const row of input.rows) {
          const preview = {
            rowNumber: row.rowNumber,
            errors: [],
            duplicates: [],
            matches: [],
            matchStatus: "unmatched"
          };
          if (rowNumbers.has(row.rowNumber))
            preview.errors.push("\u5BFC\u5165\u884C\u53F7\u91CD\u590D");
          rowNumbers.add(row.rowNumber);
          try {
            preview.data = validateOfficialMallMaterial(row.data);
          } catch (error) {
            preview.errors.push(safeError(error));
            rows.push(preview);
            continue;
          }
          const data = preview.data;
          const key = canonicalJson(
            [data.partNumber, data.brand, data.pkg, data.dateCode].map(
              (v) => v.normalize("NFKC").toLowerCase()
            )
          );
          const firstRow = seen.get(key);
          if (firstRow !== void 0)
            preview.errors.push(
              `\u4E0E\u672C\u6B21\u5BFC\u5165\u7B2C ${firstRow} \u884C\u578B\u53F7/\u54C1\u724C/\u5C01\u88C5/\u6279\u6B21\u91CD\u590D\uFF0C\u8BF7\u660E\u786E\u9009\u62E9\u8DF3\u8FC7\u3001\u66F4\u65B0\u539F ID \u6216\u53E6\u5EFA\u8BB0\u5F55`
            );
          else seen.set(key, row.rowNumber);
          preview.duplicates = (await findDuplicates(tx, access, data)).map(
            duplicate
          );
          preview.matches = await suggestions(
            tx,
            access,
            data.partNumber,
            data.brand
          );
          preview.matchStatus = matchStatus(data, preview.matches);
          rows.push(preview);
        }
        return { rows };
      });
    },
    async importRows(actor, value) {
      const input = officialMallImportSchema.parse(value);
      return write(
        actor,
        "import",
        input,
        "officialInventory.write",
        "manage",
        async (context) => {
          const teamId = await chooseTeam(
            context.tx,
            context.access,
            input.teamId
          );
          const result = {
            success: true,
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: [],
            ids: []
          };
          const updates = /* @__PURE__ */ new Map();
          for (const id of Array.from(
            new Set(
              input.rows.filter((row) => row.duplicatePolicy === "update").map((row) => row.duplicateId)
            )
          ).sort((a, b) => a - b))
            updates.set(
              id,
              await loadMaterial(context.tx, context.access, id, "manage")
            );
          const rowNumbers = /* @__PURE__ */ new Set();
          const updatedIds = /* @__PURE__ */ new Set();
          for (const row of input.rows) {
            let data;
            let target;
            try {
              if (rowNumbers.has(row.rowNumber)) fail("\u5BFC\u5165\u884C\u53F7\u91CD\u590D");
              rowNumbers.add(row.rowNumber);
              data = validateOfficialMallMaterial(row.data);
              if (row.duplicatePolicy === "update") {
                target = updates.get(row.duplicateId);
                if (target.teamId !== teamId)
                  fail("\u66F4\u65B0\u8BB0\u5F55\u4E0D\u5728\u6240\u9009\u5B98\u65B9\u56E2\u961F\u8303\u56F4", "FORBIDDEN");
                if (!sameIdentity(data, target))
                  fail(
                    "\u66F4\u65B0\u539F ID \u7684\u578B\u53F7\u3001\u54C1\u724C\u3001\u5C01\u88C5\u53CA\u6279\u6B21\u5FC5\u987B\u4E00\u81F4\uFF1B\u53E6\u5EFA\u8BB0\u5F55\u8BF7\u663E\u5F0F\u9009\u62E9 new"
                  );
                if (updatedIds.has(target.id))
                  fail("\u540C\u4E00\u5BFC\u5165\u8BF7\u6C42\u4E0D\u80FD\u591A\u6B21\u66F4\u65B0\u540C\u4E00\u539F ID");
                assertRevision(target.revision, row.expectedRevision);
                if (target.status === "published")
                  fail("\u91CD\u590D\u7269\u6599\u5DF2\u4E0A\u67B6\uFF0C\u987B\u5148\u663E\u5F0F\u4E0B\u67B6\u540E\u66F4\u65B0", "CONFLICT");
              }
            } catch (error) {
              throwSecurity(error);
              result.errors.push({
                rowNumber: row.rowNumber,
                message: safeError(error)
              });
              continue;
            }
            if (row.duplicatePolicy === "skip") {
              const existing = await findDuplicates(
                context.tx,
                context.access,
                data
              );
              if (existing.length) {
                result.skipped++;
                continue;
              }
            }
            if (target) {
              const after = await updateMaterial(
                context,
                actor,
                target,
                row.expectedRevision,
                data
              );
              result.updated++;
              result.ids.push(after.id);
              updatedIds.add(after.id);
            } else {
              const after = await insertMaterial(context, actor, teamId, data);
              result.imported++;
              result.ids.push(after.id);
            }
          }
          result.success = result.errors.length === 0;
          return result;
        }
      );
    },
    async publicList(value) {
      const input = officialMallPublicListSchema.parse(value);
      const connection = await db2();
      const where = and2(
        input.partNumber ? like(officialMallPublications.partNumber, likePattern(input.partNumber)) : void 0,
        input.brand ? like(officialMallPublications.brand, likePattern(input.brand)) : void 0
      );
      return connection.transaction(
        async (tx) => {
          const [{ total }] = await tx.select({ total: sql2`count(*)` }).from(officialMallPublications).innerJoin(officialMallMaterials, publicJoin()).where(where);
          const rows = await tx.select({
            snapshot: officialMallPublications.snapshot,
            publicId: officialMallPublications.publicId,
            revision: officialMallPublications.revision,
            publishedAt: officialMallPublications.publishedAt
          }).from(officialMallPublications).innerJoin(officialMallMaterials, publicJoin()).where(where).orderBy(desc(officialMallPublications.materialId)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
          return {
            items: rows.map(readSnapshot),
            total: Number(total),
            page: input.page,
            pageSize: input.pageSize
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
      );
    },
    async publicDetail(value) {
      const input = officialMallPublicIdSchema.parse(value);
      const [row] = await (await db2()).select({
        snapshot: officialMallPublications.snapshot,
        publicId: officialMallPublications.publicId,
        revision: officialMallPublications.revision,
        publishedAt: officialMallPublications.publishedAt
      }).from(officialMallPublications).innerJoin(officialMallMaterials, publicJoin()).where(eq2(officialMallPublications.publicId, input.publicId)).limit(1);
      return { item: row ? readSnapshot(row) : null };
    }
  };
}
var officialMallCreateSchema, officialMallUpdateSchema, officialMallBulkSchema, officialMallSuggestSchema, officialMallPreviewSchema, officialMallImportSchema, officialMallPublicListSchema, officialMallPublicIdSchema, officialMallRequestStatusSchema;
var init_officialMall2 = __esm({
  "work/51dianzi-platform--manager/server/services/officialMall.ts"() {
    init_officialChannelSchema();
    init_schema();
    init_officialMallSchema();
    init_officialMall();
    officialMallCreateSchema = z3.object({
      requestId: officialMallRequestIdSchema,
      data: officialMallMaterialInputSchema,
      teamId: officialMallIdSchema.optional()
    }).strict();
    officialMallUpdateSchema = officialMallRowMutationSchema.extend({ data: officialMallMaterialInputSchema }).strict();
    officialMallBulkSchema = z3.object({
      action: z3.enum(["publish", "offshelf"]),
      requestId: officialMallRequestIdSchema,
      items: z3.array(
        z3.object({
          id: officialMallIdSchema,
          expectedRevision: officialMallRevisionSchema
        }).strict()
      ).min(1).max(OFFICIAL_MALL_BULK_LIMIT)
    }).strict();
    officialMallSuggestSchema = z3.object({
      query: z3.string().trim().max(128),
      brand: z3.string().trim().max(128).optional()
    }).strict();
    officialMallPreviewSchema = z3.object({
      rows: z3.array(
        z3.object({ rowNumber: z3.number().int().positive(), data: z3.unknown() }).strict()
      ).max(OFFICIAL_MALL_IMPORT_LIMIT)
    }).strict();
    officialMallImportSchema = z3.object({
      requestId: officialMallRequestIdSchema,
      rows: z3.array(officialMallImportRowSchema).min(1).max(OFFICIAL_MALL_IMPORT_LIMIT),
      teamId: officialMallIdSchema.optional()
    }).strict();
    officialMallPublicListSchema = officialMallListSchema.omit({
      status: true
    });
    officialMallPublicIdSchema = z3.object({
      publicId: z3.string().regex(
        /^OM_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    }).strict();
    officialMallRequestStatusSchema = z3.object({ requestId: officialMallRequestIdSchema }).strict();
  }
});

// work/51dianzi-platform--manager/server/services/adminNewInformationSources/mall.ts
var mall_exports = {};
__export(mall_exports, {
  MALL_NEW_INFORMATION_PREFIX: () => MALL_NEW_INFORMATION_PREFIX,
  createMallNewInformationReader: () => createMallNewInformationReader,
  mallNewInformationFactsInputSchema: () => mallNewInformationFactsInputSchema,
  mallNewInformationFactsResultSchema: () => mallNewInformationFactsResultSchema
});



function digest(value) {
  return createHash4("sha256").update(JSON.stringify(value)).digest("hex");
}
function nativeAdminKey(id) {
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? `admin:${id}` : void 0;
}
function idsFor(refs) {
  if (refs === void 0) return void 0;
  const ids = refs.flatMap((ref) => {
    const match = /^mall-material:([1-9]\d*)$/.exec(ref);
    if (!match) return [];
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id <= 2147483647 ? [id] : [];
  });
  return Array.from(new Set(ids));
}
function createMallNewInformationReader(deps) {
  const service = createOfficialMallService(deps);
  return {
    async read(actor, value = {}) {
      const input = mallNewInformationFactsInputSchema.parse(value);
      const { access, items: rows } = await service.readNewInformationFacts(
        actor,
        idsFor(input.refs)
      );
      const actorKey = nativeAdminKey(access.adminUserId);
      if (!actorKey || access.adminUserId !== actor.adminUserId)
        throw new TRPCError5({ code: "FORBIDDEN", message: "\u5546\u57CE\u540E\u53F0\u4E3B\u4F53\u6838\u9A8C\u5931\u8D25" });
      const scope = {
        identity: actorKey,
        version: digest([
          "official-mall-materials-scope-v1",
          access.adminUserId,
          actor.sessionVersion,
          access.isSuperAdmin,
          access.teamId,
          access.teamRole,
          [...access.permissions].sort()
        ]),
        actorKey
      };
      const items = rows.map((row) => {
        if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.id > 2147483647 || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime()))
          throw new TRPCError5({ code: "INTERNAL_SERVER_ERROR", message: "\u5546\u57CE\u4E8B\u4EF6\u5143\u6570\u636E\u65E0\u6548" });
        const occurredAt = row.createdAt.toISOString();
        const creator = nativeAdminKey(row.createdByAdminUserId);
        return {
          id: `${MALL_NEW_INFORMATION_PREFIX}${row.id}`,
          version: `created:${occurredAt}`,
          occurredAt,
          historical: occurredAt < ADMIN_NEW_INFORMATION_ACTIVATED_AT,
          // insertMaterial sets this column only from the trusted native admin actor.
          // No owner/updater/publication account inference or front-user mapping.
          ...creator ? { actorKey: creator } : {}
        };
      });
      return mallNewInformationFactsResultSchema.parse({
        available: true,
        scope,
        items,
        snapshot: digest(["official-mall-materials-facts-v1", scope, items])
      });
    }
  };
}
var MALL_NEW_INFORMATION_PREFIX, mallNewInformationFactsInputSchema, mallNewInformationFactsResultSchema;
var init_mall = __esm({
  "work/51dianzi-platform--manager/server/services/adminNewInformationSources/mall.ts"() {
    init_officialMall2();
    MALL_NEW_INFORMATION_PREFIX = "mall-material:";
    mallNewInformationFactsInputSchema = newInformationFactsInputSchema2;
    mallNewInformationFactsResultSchema = newInformationFactsResultSchema2;
  }
});

// native-bridge:/home/ubuntu/work/51dianzi-platform--manager/server/services/officialChannelAccess.ts
var officialChannelAccess_exports = {};
__export(officialChannelAccess_exports, {
  assertOfficialRecordAction: () => assertOfficialRecordAction,
  loadOfficialAccess: () => loadOfficialAccess,
  officialActorFromContext: () => officialActorFromContext,
  officialTeamPredicate: () => officialTeamPredicate
});
var loadOfficialAccess, assertOfficialRecordAction, officialTeamPredicate, officialActorFromContext;
var init_officialChannelAccess = __esm({
  "native-bridge:/home/ubuntu/work/51dianzi-platform--manager/server/services/officialChannelAccess.ts"() {
    ({ loadOfficialAccess, assertOfficialRecordAction, officialTeamPredicate, officialActorFromContext } = native);
  }
});

// narrow-source:/home/ubuntu/work/51dianzi-platform--manager/server/platformOrderApi.ts
var callPlatformOrder;
var platformOrderApi_exports = {};
__export(platformOrderApi_exports, {
  getPlatformOrderNewInformationFacts: () => getPlatformOrderNewInformationFacts
});
function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim() || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE \u672A\u914D\u7F6E\uFF0C\u65E0\u6CD5\u8FDE\u63A5\u5546\u57CE\u8BA2\u5355\u670D\u52A1");
  if (!key) throw new Error("PORTAL_API_KEY \u672A\u914D\u7F6E\uFF0C\u65E0\u6CD5\u8FDE\u63A5\u5546\u57CE\u8BA2\u5355\u670D\u52A1");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}
async function callPlatformOrderNewInformation(input) {
  const started = performance.now();
  let config;
  try {
    config = getConfig();
  } catch {
    throw new PlatformOrderNewInformationError("config", started);
  }
  const body = JSON.stringify({ "0": { json: input } });
  let response;
  try {
    response = await fetch(`${config.baseUrl}/api/trpc/internalOrder.newInformationFacts?batch=1&input=${encodeURIComponent(body)}`, {
      headers: { "content-type": "application/json", "x-portal-key": config.key },
      signal: AbortSignal.timeout(1e4)
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new PlatformOrderNewInformationError(timeout ? "timeout" : "network", started);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PlatformOrderNewInformationError(response.ok ? "decode" : "http", started, response.status);
  }
  const first = Array.isArray(payload) ? payload[0] : void 0;
  if (!response.ok || first?.error) {
    throw new PlatformOrderNewInformationError(
      response.ok ? "upstream" : "http",
      started,
      response.status,
      first?.error?.json?.data?.code ?? first?.error?.data?.code
    );
  }
  const data = first?.result?.data;
  if (!data) throw new PlatformOrderNewInformationError("empty", started, response.status);
  return typeof data === "object" && data !== null && "json" in data ? data.json : data;
}
function getPlatformOrderNewInformationFacts(input, salesStaffCodes) {
  return callPlatformOrderNewInformation({
    ...input,
    ...salesStaffCodes === void 0 ? {} : { salesStaffCodes }
  });
}
var PlatformOrderNewInformationError;
var init_platformOrderApi = __esm({
  "narrow-source:/home/ubuntu/work/channel-release-20261121-1837/manager/server/platformOrderApi.ts"() {
callPlatformOrder = native.callPlatformOrder;

    init_adminNewInformationDiagnostics();
    PlatformOrderNewInformationError = class extends Error {
      kind;
      httpStatus;
      upstreamTrpcCode;
      timing;
      constructor(kind, started, httpStatus, upstreamTrpcCode) {
        super("ADMIN_NEW_INFORMATION_ORDER_TRANSPORT_UNAVAILABLE");
        const safe = safeAdminNewInformationError({ kind, httpStatus, upstreamTrpcCode, timing: Math.max(0, performance.now() - started) });
        this.kind = safe.kind ?? "network";
        this.httpStatus = safe.httpStatus;
        this.upstreamTrpcCode = safe.upstreamTrpcCode;
        this.timing = typeof safe.timing === "number" ? safe.timing : 0;
      }
    };
  }
});

// work/51dianzi-platform--manager/server/routers/adminNewInformation.ts


// native-bridge:/home/ubuntu/work/51dianzi-platform--manager/server/_core/trpc.ts
var { router, adminProcedure } = native;

// work/51dianzi-platform--manager/shared/adminNewInformation.ts

var ADMIN_NEW_INFORMATION_MODULES = [
  "customers",
  "inventory",
  "mall",
  "reception",
  "procurement",
  "inbound",
  "sales"
];
var adminNewInformationModuleSchema = z.enum(ADMIN_NEW_INFORMATION_MODULES);
var ADMIN_NEW_INFORMATION_MAX_UNREAD_REFS = 2e3;
var adminNewInformationUnreadRefsSchema = z.object({
  module: adminNewInformationModuleSchema,
  scope: z.string().max(180).optional()
});
var adminNewInformationInspectSchema = z.object({
  module: adminNewInformationModuleSchema,
  refs: z.array(z.string().min(1).max(180)).max(100),
  scope: z.string().max(180).optional()
});
var adminNewInformationMarkSchema = z.object({
  /** Short-lived server-issued receipt for a single inspected creation event. */
  receipts: z.array(z.string().min(1).max(4096)).max(100)
});

// work/51dianzi-platform--manager/server/services/adminNewInformation.ts




// work/51dianzi-platform--manager/drizzle/adminNewInformationSchema.ts

var adminNewInformationStates = mysqlTable(
  "admin_new_information_states",
  {
    adminUserId: int("adminUserId", { unsigned: true }).notNull(),
    module: mysqlEnum("module", ADMIN_NEW_INFORMATION_MODULES).notNull(),
    initialized: int("initialized", { unsigned: true }).default(0).notNull(),
    lastCount: int("lastCount", { unsigned: true }).default(0).notNull(),
    lastChildren: json("lastChildren").$type()
  },
  (table) => ({ pk: primaryKey({ columns: [table.adminUserId, table.module] }) })
);
var adminNewInformationSeen = mysqlTable(
  "admin_new_information_seen",
  {
    adminUserId: int("adminUserId", { unsigned: true }).notNull(),
    module: mysqlEnum("module", ADMIN_NEW_INFORMATION_MODULES).notNull(),
    eventKey: varchar("eventKey", { length: 64 }).notNull()
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.adminUserId, table.module, table.eventKey]
    })
  })
);

// native-bridge:/home/ubuntu/work/51dianzi-platform--manager/server/db.ts
var { getDb, withBusinessAuthorizationFence, getAdminUserById, getAdminUserPermissions, getActiveBusinessStaffBinding, getActiveBusinessMerchantScope, getBusinessWorkbenchMerchantById, getAdminUserSalesScopeCodes } = native;

// work/51dianzi-platform--manager/server/services/adminNewInformation.ts
function unavailable() {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "\u65B0\u589E\u4FE1\u606F\u6838\u9A8C\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"
  });
}
var SourceUnavailableError = class extends Error {
  constructor(reason) {
    super("ADMIN_NEW_INFORMATION_SOURCE_UNAVAILABLE");
    this.reason = reason;
  }
};
function assertViewer(viewer) {
  if (!viewer || !Number.isSafeInteger(viewer.adminUserId) || viewer.adminUserId <= 0 || !Number.isSafeInteger(viewer.sessionVersion) || viewer.sessionVersion <= 0) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "\u8BF7\u4F7F\u7528\u6709\u6548\u7684\u672C\u5730\u540E\u53F0\u8D26\u53F7\u767B\u5F55"
    });
  }
}
function nonempty(value, max = 180) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function assertScope(scope) {
  if (!scope || !nonempty(scope.identity) || !nonempty(scope.version) || scope.actorKey != null && !nonempty(scope.actorKey))
    throw unavailable();
}
function eventKey(event) {
  return createHash("sha256").update(JSON.stringify([event.id, event.version])).digest("hex");
}
function validateEvents(items) {
  if (!Array.isArray(items)) throw unavailable();
  const unique = /* @__PURE__ */ new Map();
  for (const row of items) {
    if (!row || !nonempty(row.id) || !nonempty(row.version) || !nonempty(row.occurredAt, 64) || !Number.isFinite(Date.parse(row.occurredAt)) || row.actorKey != null && !nonempty(row.actorKey) || row.historical !== void 0 && typeof row.historical !== "boolean" || row.countKey !== void 0 && !nonempty(row.countKey) || row.children !== void 0 && (!Array.isArray(row.children) || !row.children.every((child) => nonempty(child))))
      throw unavailable();
    const key = eventKey(row);
    const previous = unique.get(key);
    if (previous && (previous.actorKey !== row.actorKey || previous.occurredAt !== row.occurredAt || previous.historical !== row.historical || previous.countKey !== row.countKey)) {
      throw unavailable();
    }
    unique.set(key, {
      id: row.id,
      version: row.version,
      occurredAt: row.occurredAt,
      actorKey: row.actorKey,
      historical: row.historical,
      countKey: row.countKey,
      children: Array.from(
        /* @__PURE__ */ new Set([...previous?.children ?? [], ...row.children ?? []])
      )
    });
  }
  return Array.from(unique.values());
}
function sameScope(a, b) {
  return a.identity === b.identity && a.version === b.version && a.actorKey === b.actorKey;
}
function isNew(state, row, scope) {
  return row.historical !== true && !state.seen.has(eventKey(row)) && !(scope.actorKey && row.actorKey === scope.actorKey);
}
function countEvents(state, rows, scope) {
  const ids = /* @__PURE__ */ new Set();
  const children = /* @__PURE__ */ new Map();
  for (const row of rows) {
    for (const child of row.children ?? [])
      if (!children.has(child)) children.set(child, /* @__PURE__ */ new Set());
    if (!isNew(state, row, scope)) continue;
    const countKey = JSON.stringify(
      row.countKey === void 0 ? ["id", row.id] : ["count", row.countKey]
    );
    ids.add(countKey);
    for (const child of row.children ?? []) children.get(child).add(countKey);
  }
  return {
    count: ids.size,
    available: true,
    ...children.size ? {
      children: Object.fromEntries(
        Array.from(children).map(([key, values]) => [key, values.size])
      )
    } : {}
  };
}
function createDrizzleAdminNewInformationStore(loadDb = getDb) {
  async function withModules(viewer, modules, operation) {
    const db2 = await loadDb();
    if (!db2) throw unavailable();
    const ordered = ADMIN_NEW_INFORMATION_MODULES.filter(
      (module) => modules.includes(module)
    );
    return db2.transaction(async (tx) => {
      const states = /* @__PURE__ */ new Map();
      const originals = /* @__PURE__ */ new Map();
      for (const module of ordered) {
        await tx.insert(adminNewInformationStates).values({ adminUserId: viewer.adminUserId, module }).onDuplicateKeyUpdate({ set: { module } });
        const where = and(
          eq(adminNewInformationStates.adminUserId, viewer.adminUserId),
          eq(adminNewInformationStates.module, module)
        );
        const [stored] = await tx.select().from(adminNewInformationStates).where(where).for("update");
        if (!stored) throw unavailable();
        const seenRows = await tx.select({ eventKey: adminNewInformationSeen.eventKey }).from(adminNewInformationSeen).where(
          and(
            eq(adminNewInformationSeen.adminUserId, viewer.adminUserId),
            eq(adminNewInformationSeen.module, module)
          )
        );
        const original = new Set(seenRows.map((row) => row.eventKey));
        const state = {
          initialized: stored.initialized === 1,
          seen: new Set(original),
          lastSummary: {
            count: stored.lastCount,
            available: true,
            ...stored.lastChildren ? { children: stored.lastChildren } : {}
          }
        };
        states.set(module, state);
        originals.set(module, original);
      }
      const result = await operation(states);
      for (const module of ordered) {
        const state = states.get(module);
        const original = originals.get(module);
        const additions = Array.from(state.seen).filter(
          (key) => !original.has(key)
        );
        for (let offset = 0; offset < additions.length; offset += 100) {
          await tx.insert(adminNewInformationSeen).values(
            additions.slice(offset, offset + 100).map((key) => ({
              adminUserId: viewer.adminUserId,
              module,
              eventKey: key
            }))
          ).onDuplicateKeyUpdate({ set: { module } });
        }
        await tx.update(adminNewInformationStates).set({
          initialized: state.initialized ? 1 : 0,
          lastCount: state.lastSummary.count,
          lastChildren: state.lastSummary.children ?? null
        }).where(
          and(
            eq(adminNewInformationStates.adminUserId, viewer.adminUserId),
            eq(adminNewInformationStates.module, module)
          )
        );
      }
      return result;
    });
  }
  return {
    withModules,
    withModule: (viewer, module, operation) => withModules(viewer, [module], (states) => operation(states.get(module)))
  };
}
var MAX_RECEIPT_FACTS = 8;
var MAX_RECEIPT_SIZE = 4096;
function createAdminNewInformationService(deps) {
  const rawStore = deps.store ?? createDrizzleAdminNewInformationStore();
  const store = {
    withModule: (viewer, module, operation) => adminNewInformationDiagnosticStore((done) => rawStore.withModule(viewer, module, async (state) => {
      const result = await operation(state);
      done();
      return result;
    })),
    withModules: (viewer, modules, operation) => adminNewInformationDiagnosticStore((done) => rawStore.withModules(viewer, modules, async (states) => {
      const result = await operation(states);
      done();
      return result;
    }))
  };
  const now2 = deps.now ?? Date.now;
  const ttl = deps.receiptTtlMs ?? 12e4;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 3e5)
    throw new Error("INVALID_RECEIPT_TTL");
  const rawFence = deps.withViewerFence ?? ((viewer, operation) => withBusinessAuthorizationFence(
    { adminUserId: viewer.adminUserId },
    operation,
    adminNewInformationFenceDiagnostics
  ));
  const fence = (viewer, operation) => adminNewInformationDiagnosticStage("fence", async () => {
    let completedAt;
    try {
      const result = await rawFence(viewer, () => adminNewInformationDiagnosticStage("operation", async () => {
        const result2 = await operation();
        completedAt = performance.now();
        recordAdminNewInformationDiagnostic("cleanup", "begin", completedAt);
        return result2;
      }));
      if (completedAt !== void 0) recordAdminNewInformationDiagnostic("cleanup", "ok", completedAt);
      return result;
    } catch (error) {
      if (completedAt !== void 0) recordAdminNewInformationDiagnostic("cleanup", "error", completedAt, error);
      throw error;
    }
  });
  const secret = () => {
    const value = typeof deps.secret === "function" ? deps.secret() : deps.secret ?? process.env.JWT_SECRET ?? "";
    if (typeof value !== "string" || !value.trim()) throw unavailable();
    return createHmac("sha256", value).update("51dianzi/admin-new-information/receipt/v1").digest();
  };
  function sign(receipt) {
    return adminNewInformationDiagnosticSync("receipt", () => signReceipt(receipt));
  }
  function signReceipt(receipt) {
    const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
    const token = `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
    if (token.length > MAX_RECEIPT_SIZE) throw unavailable();
    return token;
  }
  function verify(token, viewer) {
    try {
      if (!nonempty(token, MAX_RECEIPT_SIZE)) return null;
      const parts = token.split(".");
      if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)))
        return null;
      const expected = createHmac("sha256", secret()).update(parts[0]).digest();
      const supplied = Buffer.from(parts[1], "base64url");
      if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied))
        return null;
      const receipt = JSON.parse(
        Buffer.from(parts[0], "base64url").toString("utf8")
      );
      const time = now2();
      if (!receipt || receipt.v !== 1 && receipt.v !== 2 || receipt.a !== viewer.adminUserId || receipt.sv !== viewer.sessionVersion || !ADMIN_NEW_INFORMATION_MODULES.includes(receipt.m) || !nonempty(receipt.id) || !nonempty(receipt.si) || !nonempty(receipt.sc) || receipt.filter !== void 0 && (typeof receipt.filter !== "string" || receipt.filter.length > 180) || !Number.isSafeInteger(receipt.iat) || !Number.isSafeInteger(receipt.exp) || receipt.iat > time || receipt.exp <= time || receipt.exp <= receipt.iat || receipt.exp - receipt.iat > ttl)
        return null;
      if (receipt.v === 1) return nonempty(receipt.ev) ? [receipt] : null;
      if (!Array.isArray(receipt.events) || receipt.events.length < 2 || receipt.events.length > MAX_RECEIPT_FACTS || !receipt.events.every((version) => nonempty(version)) || new Set(receipt.events).size !== receipt.events.length)
        return null;
      const { events, ...identity } = receipt;
      return events.map((ev) => ({ ...identity, v: 1, ev }));
    } catch {
      return null;
    }
  }
  async function scan(viewer, module, initialized) {
    let cursor;
    let snapshot;
    let scope;
    const cursors = /* @__PURE__ */ new Set();
    const all = [];
    for (let page = 0; page < 1e4; page++) {
      const reply = await adminNewInformationDiagnosticStage("list", async () => {
        const reply2 = await deps.source.list({ viewer, module, cursor, snapshot, baseline: { initialized } });
        if (!reply2 || reply2.available !== true)
          throw new SourceUnavailableError(reply2?.available === false ? reply2.reason : "temporary");
        adminNewInformationDiagnosticSync("events", () => assertScope(reply2.scope));
        return reply2;
      });
      if (!nonempty(reply.snapshot, 1024) || snapshot && snapshot !== reply.snapshot || scope && !sameScope(scope, reply.scope))
        throw unavailable();
      scope = reply.scope;
      snapshot = reply.snapshot;
      all.push(...adminNewInformationDiagnosticSync("events", () => validateEvents(reply.items)));
      if (reply.nextCursor == null) return { scope, rows: adminNewInformationDiagnosticSync("events", () => validateEvents(all)) };
      if (!nonempty(reply.nextCursor, 1024) || cursors.has(reply.nextCursor))
        throw unavailable();
      cursors.add(reply.nextCursor);
      cursor = reply.nextCursor;
    }
    throw unavailable();
  }
  async function diagnosticLookup(input) {
    return adminNewInformationDiagnosticStage("lookup", async () => {
      const reply = await deps.source.lookup(input);
      if (!reply || reply.available !== true) throw unavailable();
      adminNewInformationDiagnosticSync("events", () => assertScope(reply.scope));
      return reply;
    });
  }
  async function establish(viewer, module, state) {
    if (state.initialized) return;
    const baseline = await scan(viewer, module, false);
    for (const row of baseline.rows)
      if (row.historical !== false) state.seen.add(eventKey(row));
    state.initialized = true;
    state.lastSummary = { count: 0, available: true };
  }
  const service = {
    async summary(viewer) {
      adminNewInformationDiagnosticSync("viewer", () => assertViewer(viewer));
      const modules = {};
      for (const module of ADMIN_NEW_INFORMATION_MODULES) {
        await withAdminNewInformationDiagnosticLabels({ module }, async () => {
          let previous = {
            count: 0,
            available: false,
            lastKnown: false
          };
          try {
            adminNewInformationDiagnosticSync("secret", secret);
            modules[module] = await fence(
              viewer,
              () => store.withModule(viewer, module, async (state) => {
                previous = { ...state.lastSummary, available: false, lastKnown: state.initialized };
                const current = await scan(viewer, module, state.initialized);
                if (!state.initialized) {
                  for (const row of current.rows)
                    if (row.historical !== false) state.seen.add(eventKey(row));
                  state.initialized = true;
                }
                state.lastSummary = countEvents(
                  state,
                  current.rows,
                  current.scope
                );
                return state.lastSummary;
              })
            );
          } catch (error) {
            recordAdminNewInformationDiagnostic("request", "temporary", void 0, error);
            const reason = error instanceof SourceUnavailableError ? error.reason : "temporary";
            modules[module] = {
              ...previous,
              ...reason ? { reason } : {},
              ...reason === "denied" ? { lastKnown: false } : {}
            };
          }
        });
      }
      return { modules };
    },
    async unreadRefs(viewer, input) {
      adminNewInformationDiagnosticSync("viewer", () => assertViewer(viewer));
      const checked = adminNewInformationUnreadRefsSchema.parse(input);
      adminNewInformationDiagnosticSync("secret", secret);
      try {
        return await fence(
          viewer,
          () => store.withModule(viewer, checked.module, async (state) => {
            const current = await scan(viewer, checked.module, state.initialized);
            const effective = { ...state, seen: new Set(state.seen) };
            if (!state.initialized) {
              for (const row of current.rows)
                if (row.historical !== false) effective.seen.add(eventKey(row));
            }
            const unseen = current.rows.filter((row) => isNew(effective, row, current.scope));
            const candidates = Array.from(new Set(unseen.map((row) => row.id)));
            const refs = /* @__PURE__ */ new Set();
            if (checked.scope === void 0) {
              if (candidates.length > ADMIN_NEW_INFORMATION_MAX_UNREAD_REFS) throw unavailable();
              for (const ref of candidates) refs.add(ref);
            } else {
              const exact = new Set(unseen.map(eventKey));
              for (let offset = 0; offset < Math.max(1, candidates.length); offset += 100) {
                const batch = candidates.slice(offset, offset + 100);
                const reply = await diagnosticLookup({ viewer, module: checked.module, refs: batch, scope: checked.scope });
                if (!reply || reply.available !== true) throw unavailable();
                assertScope(reply.scope);
                if (!sameScope(current.scope, reply.scope)) throw unavailable();
                const allowed = new Set(batch);
                for (const row of adminNewInformationDiagnosticSync("events", () => validateEvents(reply.items))) {
                  if (allowed.has(row.id) && exact.has(eventKey(row)) && isNew(effective, row, reply.scope)) refs.add(row.id);
                }
                if (refs.size > ADMIN_NEW_INFORMATION_MAX_UNREAD_REFS) throw unavailable();
              }
            }
            return { refs: Array.from(refs).sort(), available: true };
          })
        );
      } catch (error) {
        recordAdminNewInformationDiagnostic("request", "temporary", void 0, error);
        throw unavailable();
      }
    },
    async inspect(viewer, input) {
      adminNewInformationDiagnosticSync("viewer", () => assertViewer(viewer));
      const checked = adminNewInformationInspectSchema.parse(input);
      adminNewInformationDiagnosticSync("secret", secret);
      if (!checked.refs.length) return { items: [] };
      try {
        return await fence(
          viewer,
          () => store.withModule(viewer, checked.module, async (state) => {
            if (state.initialized) await establish(viewer, checked.module, state);
            else await adminNewInformationDiagnosticStage("establish", () => establish(viewer, checked.module, state));
            const refs = Array.from(new Set(checked.refs));
            const reply = await diagnosticLookup({
              viewer,
              module: checked.module,
              refs,
              scope: checked.scope
            });
            if (!reply || reply.available !== true) throw unavailable();
            assertScope(reply.scope);
            const allowed = new Set(refs);
            const rows2 = adminNewInformationDiagnosticSync("events", () => validateEvents(reply.items)).filter(
              (row) => allowed.has(row.id)
            );
            const physicalRows = /* @__PURE__ */ new Map();
            for (const row of rows2) {
              const facts = physicalRows.get(row.id) ?? [];
              facts.push(row);
              physicalRows.set(row.id, facts);
            }
            const time = now2();
            return {
              items: Array.from(physicalRows, ([id, facts]) => {
                const unseen = facts.filter(
                  (row) => isNew(state, row, reply.scope)
                );
                const versions = (unseen.length ? unseen : facts).map((row) => row.version).sort();
                if (versions.length > MAX_RECEIPT_FACTS) throw unavailable();
                const identity = {
                  a: viewer.adminUserId,
                  sv: viewer.sessionVersion,
                  m: checked.module,
                  id,
                  si: reply.scope.identity,
                  sc: reply.scope.version,
                  ...checked.scope !== void 0 ? { filter: checked.scope } : {},
                  iat: time,
                  exp: time + ttl
                };
                return {
                  id,
                  // Presentation-only identity: stable under source ordering and
                  // NEVER used as a source lookup version or durable seen key.
                  version: facts.length === 1 ? facts[0].version : `compound:${createHash2("sha256").update(
                    JSON.stringify(facts.map((row) => row.version).sort())
                  ).digest("hex")}`,
                  isNew: unseen.length > 0,
                  receipt: sign(
                    versions.length === 1 ? { ...identity, v: 1, ev: versions[0] } : { ...identity, v: 2, events: versions }
                  )
                };
              })
            };
          })
        );
      } catch (error) {
        recordAdminNewInformationDiagnostic("request", "temporary", void 0, error);
        throw unavailable();
      }
    },
    async markDisplayed(viewer, input) {
      adminNewInformationDiagnosticSync("viewer", () => assertViewer(viewer));
      const checked = adminNewInformationMarkSchema.parse(input);
      adminNewInformationDiagnosticSync("secret", secret);
      const receipts = adminNewInformationDiagnosticSync("receipt", () => Array.from(new Set(checked.receipts)).flatMap((token) => {
        const facts = verify(token, viewer);
        if (!facts) throw unavailable();
        return facts;
      }));
      if (!receipts.length) return { marked: 0, accepted: 0 };
      const modules = ADMIN_NEW_INFORMATION_MODULES.filter(
        (module) => receipts.some((receipt) => receipt.m === module)
      );
      try {
        return await fence(
          viewer,
          () => store.withModules(viewer, modules, async (states) => {
            const pending = /* @__PURE__ */ new Map();
            const provenScopes = /* @__PURE__ */ new Map();
            for (const module of modules) {
              const selected = receipts.filter((receipt) => receipt.m === module);
              const state = states.get(module);
              if (!state.initialized) throw unavailable();
              const additions = /* @__PURE__ */ new Map();
              const groups = /* @__PURE__ */ new Map();
              for (const receipt of selected) {
                const key = JSON.stringify([
                  receipt.si,
                  receipt.sc,
                  receipt.filter
                ]);
                const group = groups.get(key) ?? [];
                group.push(receipt);
                groups.set(key, group);
              }
              for (const group of Array.from(groups.values())) {
                const first = group[0];
                const reply = await diagnosticLookup({
                  viewer,
                  module,
                  refs: Array.from(new Set(group.map((receipt) => receipt.id))),
                  scope: first.filter
                });
                if (!reply || reply.available !== true) throw unavailable();
                assertScope(reply.scope);
                if (reply.scope.identity !== first.si || reply.scope.version !== first.sc)
                  throw unavailable();
                const previousScope = provenScopes.get(module);
                if (previousScope && !sameScope(previousScope, reply.scope)) throw unavailable();
                provenScopes.set(module, reply.scope);
                const real = new Set(adminNewInformationDiagnosticSync("events", () => validateEvents(reply.items)).map(eventKey));
                for (const receipt of group) {
                  const key = eventKey({ id: receipt.id, version: receipt.ev });
                  if (receipt.exp <= now2() || !real.has(key))
                    throw unavailable();
                  if (!state.seen.has(key)) {
                    additions.set(
                      key,
                      Math.max(additions.get(key) ?? 0, receipt.exp)
                    );
                  }
                }
              }
              pending.set(module, additions);
            }
            const summaries = /* @__PURE__ */ new Map();
            for (const module of modules) {
              const state = states.get(module);
              const current = await scan(viewer, module, state.initialized);
              if (!sameScope(current.scope, provenScopes.get(module))) throw unavailable();
              const real = new Set(current.rows.map(eventKey));
              for (const receipt of receipts.filter((receipt2) => receipt2.m === module)) {
                if (!real.has(eventKey({ id: receipt.id, version: receipt.ev }))) throw unavailable();
              }
              const staged = { ...state, seen: new Set(state.seen) };
              for (const key of pending.get(module).keys()) staged.seen.add(key);
              summaries.set(module, countEvents(staged, current.rows, current.scope));
            }
            let marked = 0;
            const commitTime = now2();
            if (receipts.some((receipt) => receipt.exp <= commitTime))
              throw unavailable();
            for (const [module, additions] of Array.from(pending)) {
              const state = states.get(module);
              for (const key of Array.from(additions.keys())) {
                state.seen.add(key);
                marked++;
              }
              state.lastSummary = summaries.get(module);
            }
            return { marked, accepted: checked.receipts.length };
          })
        );
      } catch (error) {
        recordAdminNewInformationDiagnostic("request", "temporary", void 0, error);
        throw unavailable();
      }
    }
  };
  return {
    summary: (viewer) => runAdminNewInformationDiagnostic("summary", "all", () => service.summary(viewer)),
    unreadRefs: (viewer, input) => runAdminNewInformationDiagnostic("unreadRefs", input?.module, () => service.unreadRefs(viewer, input)),
    inspect: (viewer, input) => runAdminNewInformationDiagnostic("inspect", input?.module, () => service.inspect(viewer, input)),
    markDisplayed: (viewer, input) => runAdminNewInformationDiagnostic("markDisplayed", "all", () => service.markDisplayed(viewer, input))
  };
}

// work/51dianzi-platform--manager/server/routers/adminNewInformation.ts
function adminNewInformationViewerFromContext(ctx) {
  const account = ctx.adminAccount;
  if (!account || account.status !== "active" || !Number.isSafeInteger(account.id) || account.id <= 0 || !Number.isSafeInteger(account.sessionVersion) || account.sessionVersion < 1 || !ctx.user || ctx.user.role !== "admin" || ctx.user.id !== account.id || ctx.user.openId !== `local_admin:${account.id}`) {
    throw new TRPCError2({
      code: "UNAUTHORIZED",
      message: "\u8BF7\u4F7F\u7528\u6709\u6548\u7684\u672C\u5730\u540E\u53F0\u8D26\u53F7\u767B\u5F55"
    });
  }
  return { adminUserId: account.id, sessionVersion: account.sessionVersion };
}
function createAdminNewInformationRouter(service, native2 = { router, adminProcedure }) {
  const localProcedure = native2.adminProcedure.use(
    async ({ ctx, next }) => next({
      ctx: {
        ...ctx,
        newInformationViewer: adminNewInformationViewerFromContext(ctx)
      }
    })
  );
  const resolve = (ctx) => typeof service === "function" ? service(ctx) : service;
  async function safe(run) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof TRPCError2) throw error;
      throw new TRPCError2({
        code: "SERVICE_UNAVAILABLE",
        message: "\u65B0\u589E\u4FE1\u606F\u6838\u9A8C\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"
      });
    }
  }
  return native2.router({
    summary: localProcedure.query(
      ({ ctx }) => safe(() => resolve(ctx).summary(ctx.newInformationViewer))
    ),
    unreadRefs: localProcedure.input(adminNewInformationUnreadRefsSchema).query(
      ({ ctx, input }) => safe(() => resolve(ctx).unreadRefs(ctx.newInformationViewer, input))
    ),
    inspect: localProcedure.input(adminNewInformationInspectSchema).query(
      ({ ctx, input }) => safe(() => resolve(ctx).inspect(ctx.newInformationViewer, input))
    ),
    markDisplayed: localProcedure.input(adminNewInformationMarkSchema).mutation(
      ({ ctx, input }) => safe(() => resolve(ctx).markDisplayed(ctx.newInformationViewer, input))
    )
  });
}
function createAdminNewInformationRouterForSource(deps, native2) {
  return createAdminNewInformationRouter(
    (ctx) => createAdminNewInformationService({ ...deps, source: deps.source(ctx) }),
    native2
  );
}

// work/51dianzi-platform--manager/server/services/adminNewInformationSources.ts
init_schema();




// work/51dianzi-platform--manager/shared/adminPermissions.ts
var ADMIN_ROLES = [
  "super_admin",
  "operation",
  "merchant_mgr",
  "customer_svc",
  "risk_control",
  "finance",
  "auditor"
];
var ADMIN_PERMISSIONS = [
  "materials.read",
  "materials.write",
  "merchants.read",
  "merchants.write",
  "portalUsers.read",
  "portalUsers.manage",
  "messages.read",
  "messages.write",
  "orders.read",
  "analytics.read",
  /**
   * 官方渠道库存是后台自有域：不读取、不映射商户 ERP 权限。除 super_admin 外，
   * 只有员工级显式授权才可获得；团队成员/组长身份绝不自动附带这些模块权限。
   */
  "officialInventory.read",
  "officialInventory.write",
  "officialInventory.publish",
  "officialInventory.note",
  /** 官方团队配置是系统权限，只由真实 super_admin 在服务端认可，不能下放。 */
  "officialTeams.manage",
  /**
   * 后台业务网关权限。它们只允许经受控 BFF 访问主站企业领域服务，
   * 不等同于前台企业成员权限，且绝不能由角色默认权限自动取得。
   */
  "business.context.read",
  "business.inventory.read",
  "business.inventory.write",
  "business.inquiries.read",
  "business.inquiries.write",
  "business.customers.read",
  "business.customers.write",
  "business.procurement.read",
  "business.procurement.write",
  "business.users.read",
  "business.users.write",
  "business.orders.read",
  "business.orders.write",
  /** 维护本人个人信息与登录密码（「个人信息」菜单的准入依据） */
  "profile.manage",
  "admins.manage",
  /**
   * 查看异常日志（服务器错误、攻击探测、认证异常）。
   * 仅授予 super_admin：日志含访客 IP、UserAgent、错误堆栈等敏感信息，
   * 按最小权限原则不下放给销售角色（merchant_mgr）。
   */
  "logs.read"
];
var ROLE_PERMISSIONS = {
  super_admin: ADMIN_PERMISSIONS,
  operation: [
    "materials.read",
    "materials.write",
    "merchants.read",
    "merchants.write",
    "portalUsers.read",
    "portalUsers.manage",
    "messages.read",
    "messages.write",
    "orders.read",
    "analytics.read",
    "profile.manage"
  ],
  // 普通用户：仅商户管理、订单中心，并按销售权限限制可见数据范围
  merchant_mgr: [
    "merchants.read",
    "merchants.write",
    "orders.read",
    "profile.manage"
  ],
  customer_svc: [
    "merchants.read",
    "portalUsers.read",
    "portalUsers.manage",
    "messages.read",
    "messages.write",
    "orders.read",
    "profile.manage"
  ],
  risk_control: [
    "merchants.read",
    "merchants.write",
    "portalUsers.read",
    "portalUsers.manage",
    "orders.read",
    "profile.manage"
  ],
  finance: ["merchants.read", "orders.read", "profile.manage"],
  auditor: [
    "materials.read",
    "merchants.read",
    "portalUsers.read",
    "messages.read",
    "orders.read",
    "profile.manage"
  ]
};
function isAdminRole(value) {
  return typeof value === "string" && ADMIN_ROLES.includes(value);
}
function getAdminRolePermissions(role) {
  if (!isAdminRole(role)) return [];
  return ROLE_PERMISSIONS[role];
}
function isAdminPermission(value) {
  return typeof value === "string" && ADMIN_PERMISSIONS.includes(value);
}
function resolveAdminPermissions(role, userPermissions) {
  if (role === "super_admin") return ADMIN_PERMISSIONS;
  if (userPermissions && userPermissions.length > 0) {
    return userPermissions.filter(
      (permission) => permission !== "officialTeams.manage" && isAdminPermission(permission)
    );
  }
  return getAdminRolePermissions(role);
}
function hasAdminPermission(role, permission, userPermissions) {
  return resolveAdminPermissions(role, userPermissions).includes(permission);
}

// native-bridge:/home/ubuntu/work/51dianzi-platform--manager/server/businessAccess.ts
var { businessEnterpriseBindingFromMerchant, businessScopeAllows, getBusinessWorkbenchMerchantIds } = native;

// work/51dianzi-platform--manager/server/services/adminNewInformationSources.ts
var BUSINESS_SOURCES = {
  customers: [{ method: "customer.newInformationFacts", businessModule: "customers", prefix: "customer:" }],
  inventory: [{ method: "channelInventory.newInformationFacts", businessModule: "inventory", prefix: "channel-material:" }],
  reception: [{ method: "enterprise.inquiryNewInformationFacts", businessModule: "inquiries", prefix: "inquiry:" }],
  procurement: [{ method: "customerDemand.procurementNewInformationFacts", businessModule: "procurement", prefix: "demand:" }],
  inbound: [{ method: "inbound.newInformationFacts", businessModule: "inventory", prefix: "inbound:", entryWrite: true }],
  sales: [
    { method: "crmSalesOrder.newInformationFacts", businessModule: "orders", prefix: "crm-sales:" },
    { method: "order.sellerNewInformationFacts", businessModule: "orders", prefix: "order:" }
  ],
  mall: []
};
function digest2(value) {
  return createHash5("sha256").update(JSON.stringify(value)).digest("hex");
}
function positive(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
var SourceUnavailable = class extends Error {
  constructor(reason) {
    super("ADMIN_NEW_INFORMATION_SOURCE_UNAVAILABLE");
    this.reason = reason;
  }
};
function fail2(reason = "temporary") {
  throw new SourceUnavailable(reason);
}
function explicitlyDenied(error) {
  return !!error && typeof error === "object" && "code" in error && error.code === "FORBIDDEN";
}
function selector(scope) {
  if (scope === void 0 || scope === "") return void 0;
  if (/^[1-9]\d*$/.test(scope)) return `merchant:${scope}`;
  return scope;
}
function validFacts(raw, entry) {
  const facts = newInformationFactsResultSchema3.parse(raw);
  for (const row of facts.items) {
    if (!row.id.startsWith(entry.prefix) || !/^[1-9]\d*$/.test(row.id.slice(entry.prefix.length))) fail2();
    if (!Number.isFinite(Date.parse(row.occurredAt)) || row.historical !== new Date(row.occurredAt).toISOString() < ADMIN_NEW_INFORMATION_ACTIVATED_AT2 || row.actorKey != null && !row.actorKey.length || row.countKey !== void 0 && !row.countKey.length || row.children?.some((child) => !child.length)) fail2();
  }
  return facts;
}
function unionItems(proven) {
  const union = /* @__PURE__ */ new Map();
  for (const { facts } of proven) {
    for (const row of facts.items) {
      const key = JSON.stringify([row.id, row.version]);
      const previous = union.get(key);
      const normalized = {
        id: row.id,
        version: row.version,
        occurredAt: row.occurredAt,
        actorKey: row.actorKey ?? void 0,
        historical: row.historical,
        countKey: row.countKey
      };
      if (previous && (previous.occurredAt !== normalized.occurredAt || previous.actorKey !== normalized.actorKey || previous.historical !== normalized.historical || previous.countKey !== normalized.countKey)) fail2();
      union.set(key, {
        ...normalized,
        children: Array.from(/* @__PURE__ */ new Set([...previous?.children ?? [], ...row.children ?? []])).sort()
      });
    }
  }
  return Array.from(union.values()).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
}
async function prove(entries, inputFor) {
  const result = new Array(entries.length);
  let next = 0;
  const settled = await Promise.allSettled(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (next < entries.length) {
      const index2 = next++;
      const entry = entries[index2];
      await withAdminNewInformationDiagnosticLabels({ method: entry.method, sourceKind: entry.sourceKind, entry: index2 }, async () => {
        let raw;
        try {
          const started = performance.now();
          recordAdminNewInformationDiagnostic("entryRead", "begin", started);
          try {
            raw = await entry.read(newInformationFactsInputSchema.parse(inputFor(entry)));
            recordAdminNewInformationDiagnostic("entryRead", "ok", started);
          } catch (error) {
            recordAdminNewInformationDiagnostic("entryRead", explicitlyDenied(error) ? "denied" : "error", started, error);
            throw error;
          }
        } catch (error) {
          if (explicitlyDenied(error)) return;
          throw error;
        }
        result[index2] = { entry, facts: adminNewInformationDiagnosticSync("validFacts", () => validFacts(raw, entry)) };
      });
    }
  }));
  if (settled.some((row) => row.status === "rejected")) {
    for (const row of settled) if (row.status === "rejected")
      recordAdminNewInformationDiagnostic("allSettled", "error", void 0, row.reason);
    fail2();
  }
  recordAdminNewInformationDiagnostic("allSettled", "ok");
  return result.filter((row) => row !== void 0);
}
function createAdminNewInformationSourceForContext(context, deps = {}) {
  const loadDb = deps.getDb ?? getDb;
  const accountById = deps.getAdminUserById ?? getAdminUserById;
  const permissionsFor = deps.getAdminUserPermissions ?? getAdminUserPermissions;
  const bindingFor = deps.getActiveBusinessStaffBinding ?? getActiveBusinessStaffBinding;
  const scopeFor = deps.getActiveBusinessMerchantScope ?? getActiveBusinessMerchantScope;
  const merchantById = deps.getBusinessWorkbenchMerchantById ?? getBusinessWorkbenchMerchantById;
  const configuredIds = deps.configuredMerchantIds ?? getBusinessWorkbenchMerchantIds;
  const isArchived = deps.isAccountArchived ?? (async (database, adminUserId) => {
    const rows2 = await database.select({ id: adminStaffArchives.id }).from(adminStaffArchives).where(eq2(adminStaffArchives.adminUserId, adminUserId)).limit(1);
    return rows2.length > 0;
  });
  let businessReader;
  const businessFacts = deps.readBusinessFacts ?? (async (ctx, merchantId, method, input) => {
    businessReader ??= Promise.resolve().then(() => (init_businessRouter(), businessRouter_exports)).then((module) => module.readBusinessNewInformationFacts);
    const readBusinessNewInformationFacts2 = await businessReader;
    return readBusinessNewInformationFacts2(ctx, merchantId, method, input);
  });
  const mallFacts = deps.nativeMallFacts ?? (async (ctx, input) => {
    const [native2, access] = await Promise.all([
      Promise.resolve().then(() => (init_mall(), mall_exports)),
      Promise.resolve().then(() => (init_officialChannelAccess(), officialChannelAccess_exports))
    ]);
    const reader = native2.createMallNewInformationReader({
      getDb: loadDb,
      loadOfficialAccess: access.loadOfficialAccess,
      assertOfficialRecordAction: access.assertOfficialRecordAction,
      officialTeamPredicate: access.officialTeamPredicate
    });
    return reader.read(access.officialActorFromContext(ctx), input);
  });
  const orderFacts = deps.nativeOrderFacts ?? (async (input, codes) => {
    const { getPlatformOrderNewInformationFacts: getPlatformOrderNewInformationFacts2 } = await Promise.resolve().then(() => (init_platformOrderApi(), platformOrderApi_exports));
    return getPlatformOrderNewInformationFacts2(input, codes);
  });
  const salesCodes = deps.getAdminSalesStaffCodes ?? (async (ctx) => {
    if (!ctx.adminAccount) fail2();
    return ctx.adminAccount.adminRole === "super_admin" ? void 0 : getAdminUserSalesScopeCodes(ctx.adminAccount.id);
  });
  async function authorization(viewer, module) {
    if (!ADMIN_NEW_INFORMATION_MODULES.includes(module) || !positive(viewer.adminUserId) || !positive(viewer.sessionVersion) || !context.adminAccount || !context.user || context.user.role !== "admin" || context.user.id !== viewer.adminUserId || context.user.openId !== `local_admin:${viewer.adminUserId}` || context.adminAccount.id !== viewer.adminUserId || context.adminAccount.sessionVersion !== viewer.sessionVersion) fail2("denied");
    const database = await loadDb();
    if (!database) fail2();
    const account = await accountById(viewer.adminUserId);
    if (!account || account.id !== viewer.adminUserId || account.status !== "active" || account.sessionVersion !== viewer.sessionVersion || await isArchived(database, account.id)) fail2("denied");
    const permissions = await permissionsFor(account.id);
    const ctx = { ...context, adminAccount: account, adminPermissions: permissions };
    const authority = [account.id, account.sessionVersion, account.adminRole, [...permissions].sort()];
    const entries = [];
    if (module === "mall") {
      if (hasAdminPermission(account.adminRole, "officialInventory.read", permissions)) entries.push({
        method: "nativeMall.read",
        sourceKind: "nativeMall",
        selector: "native:mall",
        identity: ["native-official-mall", account.id],
        authority: ["native-official-mall"],
        prefix: "mall-material:",
        read: (input) => mallFacts(ctx, input)
      });
      return { entries, authority };
    }
    if (module === "sales" && hasAdminPermission(account.adminRole, "orders.read", permissions)) {
      const codes = await salesCodes(ctx);
      if (codes !== void 0 && (!Array.isArray(codes) || codes.some((code) => typeof code !== "string" || !/^[a-z0-9_-]{1,64}$/.test(code)))) fail2();
      const normalizedCodes = codes === void 0 ? void 0 : Array.from(new Set(codes)).sort();
      entries.push({
        method: "internalOrder.newInformationFacts",
        sourceKind: "nativeOrders",
        selector: "native:orders",
        identity: ["native-orders", account.id, normalizedCodes ?? "unrestricted"],
        authority: ["native-orders", normalizedCodes ?? "unrestricted"],
        prefix: "order:",
        read: (input) => orderFacts(input, normalizedCodes)
      });
    }
    const ids = Array.from(new Set(configuredIds())).sort((a, b) => a - b);
    if (ids.length > 32 || ids.some((id) => !positive(id))) fail2();
    if (!ids.length) return { entries, authority };
    const binding = await bindingFor(account.id);
    if (!binding) return { entries, authority };
    if (binding.adminUserId !== account.id || !positive(binding.frontUserId) || !positive(binding.bindingVersion)) fail2("denied");
    for (const merchantId of ids) {
      const scope = await scopeFor(account.id, merchantId);
      if (!scope) continue;
      if (scope.adminUserId !== account.id || scope.merchantId !== merchantId || !positive(scope.scopeVersion)) fail2("denied");
      const rules = BUSINESS_SOURCES[module].filter((rule) => {
        const officialRead = module === "inventory" && hasAdminPermission(account.adminRole, "officialInventory.read", permissions);
        return (businessScopeAllows(scope, rule.businessModule, "read") || officialRead) && (!rule.entryWrite || businessScopeAllows(scope, rule.businessModule, "write"));
      });
      if (!rules.length) continue;
      const merchant = await merchantById(merchantId);
      if (!merchant || merchant.crmStatus !== "enabled") continue;
      if (merchant.id !== merchantId) fail2("denied");
      const enterpriseBinding = businessEnterpriseBindingFromMerchant(merchant);
      for (const rule of rules) entries.push({
        method: rule.method,
        sourceKind: rule.method === "crmSalesOrder.newInformationFacts" ? "crmSales" : rule.method === "order.sellerNewInformationFacts" ? "sellerOrders" : "business",
        selector: `merchant:${merchantId}`,
        identity: ["business", merchantId, rule.method, binding.frontUserId, enterpriseBinding],
        authority: [binding.bindingVersion, scope.scopeVersion, [...scope.modulePermissions].sort()],
        prefix: rule.prefix,
        read: (input) => businessFacts(ctx, merchantId, rule.method, input)
      });
    }
    return { entries, authority };
  }
  function fullScope(viewer, module, authority, proven) {
    const identities = proven.map(({ entry, facts }) => digest2([entry.identity, facts.scope.identity])).sort();
    const versions = proven.map(({ entry, facts }) => digest2([
      entry.identity,
      entry.authority,
      facts.scope.identity,
      facts.scope.version
    ])).sort();
    return {
      identity: `admin:${viewer.adminUserId}:${module}:${digest2([ADMIN_NEW_INFORMATION_GENERATION, identities])}`,
      version: digest2([ADMIN_NEW_INFORMATION_GENERATION, viewer.sessionVersion, authority, versions]),
      actorKey: `admin:${viewer.adminUserId}`
    };
  }
  return {
    async list(input) {
      try {
        if (input.cursor !== void 0 || input.snapshot !== void 0) fail2();
        const { entries, authority } = await adminNewInformationDiagnosticStage("authorization", () => authorization(input.viewer, input.module), { module: input.module });
        const proven = await prove(entries, () => ({}));
        if (!proven.length) return { available: false, reason: "denied" };
        const scope = fullScope(input.viewer, input.module, authority, proven);
        const items = adminNewInformationDiagnosticSync("union", () => unionItems(proven));
        return {
          available: true,
          scope,
          items,
          snapshot: digest2([
            ADMIN_NEW_INFORMATION_GENERATION,
            scope,
            proven.map(({ entry, facts }) => [digest2(entry.identity), facts.snapshot]).sort(),
            items.map((row) => [row.id, row.version])
          ]),
          nextCursor: null
        };
      } catch (error) {
        recordAdminNewInformationDiagnostic("list", error instanceof SourceUnavailable && error.reason === "denied" ? "denied" : "temporary", void 0, error);
        return { available: false, reason: error instanceof SourceUnavailable ? error.reason : "temporary" };
      }
    },
    async lookup(input) {
      try {
        const refs = newInformationFactsInputSchema.parse({ refs: [...input.refs] }).refs;
        if (input.scope !== void 0 && (typeof input.scope !== "string" || input.scope.length > 180)) fail2();
        const filter = selector(input.scope);
        const { entries, authority } = await adminNewInformationDiagnosticStage("authorization", () => authorization(input.viewer, input.module), { module: input.module });
        const proven = await prove(entries, (entry) => ({ refs: refs.filter((ref) => ref.startsWith(entry.prefix)) }));
        if (!proven.length) return { available: false, reason: "denied" };
        const scope = fullScope(input.viewer, input.module, authority, proven);
        const allowed = new Set(refs);
        adminNewInformationDiagnosticSync("union", () => unionItems(proven));
        const selected = proven.filter(({ entry, facts }) => filter === void 0 || filter === entry.selector || filter === facts.scope.identity || filter === scope.identity);
        return { available: true, scope, items: adminNewInformationDiagnosticSync("union", () => unionItems(selected)).filter((row) => allowed.has(row.id)) };
      } catch (error) {
        recordAdminNewInformationDiagnostic("lookup", error instanceof SourceUnavailable && error.reason === "denied" ? "denied" : "temporary", void 0, error);
        return { available: false, reason: error instanceof SourceUnavailable ? error.reason : "temporary" };
      }
    }
  };
}

// work/51dianzi-platform--manager/admin.ts
init_businessRouter();
init_mall();
var newInformation = createAdminNewInformationRouterForSource({ source: createAdminNewInformationSourceForContext });


return {newInformation,createAdminNewInformationRouterForSource,createAdminNewInformationSourceForContext,createAdminNewInformationService,readBusinessNewInformationFacts,createMallNewInformationReader};
}
