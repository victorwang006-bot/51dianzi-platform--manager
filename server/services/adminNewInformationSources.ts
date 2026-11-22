import { createHash } from "node:crypto";
import {
  adminNewInformationDiagnosticStage, adminNewInformationDiagnosticSync,
  withAdminNewInformationDiagnosticLabels, recordAdminNewInformationDiagnostic,
  type DiagnosticMethod, type DiagnosticSourceKind,
} from "./adminNewInformationDiagnostics";
import { eq } from "drizzle-orm";
import { adminStaffArchives } from "../../drizzle/schema";
import {
  ADMIN_NEW_INFORMATION_MODULES,
  type AdminNewInformationModule,
  type AdminNewInformationUnavailableReason,
} from "../../shared/adminNewInformation";
import {
  ADMIN_NEW_INFORMATION_ACTIVATED_AT,
  ADMIN_NEW_INFORMATION_GENERATION,
  newInformationFactsInputSchema,
  newInformationFactsResultSchema,
  type NewInformationFactsResult,
} from "../../shared/adminNewInformationFacts";
import { hasAdminPermission } from "../../shared/adminPermissions";
import type { TrpcContext } from "../_core/context";
import * as db from "../db";
import {
  businessEnterpriseBindingFromMerchant,
  businessScopeAllows,
  getBusinessWorkbenchMerchantIds,
  type BusinessModule,
} from "../businessAccess";
import type { BusinessNewInformationReadMethod } from "../businessRouter";
import type {
  AdminNewInformationEvent,
  AdminNewInformationScope,
  AdminNewInformationSource,
  AdminNewInformationViewer,
} from "./adminNewInformation";

export type AdminNewInformationFactsInput = { refs?: string[] };
/** Server-only native/runtime ABI. Never exposed as procedure input or credentials.
 * Readers MUST recheck live authority and return one complete stable read (no pages).
 * All callbacks run INSIDE the notification core's account authorization fence;
 * none may acquire that named lock again or use a normal business router caller.
 */
export interface AdminNewInformationSourceDependencies {
  getDb?: typeof db.getDb;
  getAdminUserById?: typeof db.getAdminUserById;
  getAdminUserPermissions?: typeof db.getAdminUserPermissions;
  isAccountArchived?: (database: NonNullable<Awaited<ReturnType<typeof db.getDb>>>, adminUserId: number) => Promise<boolean>;
  getActiveBusinessStaffBinding?: typeof db.getActiveBusinessStaffBinding;
  getActiveBusinessMerchantScope?: typeof db.getActiveBusinessMerchantScope;
  getBusinessWorkbenchMerchantById?: typeof db.getBusinessWorkbenchMerchantById;
  configuredMerchantIds?: () => readonly number[];
  readBusinessFacts?: (
    ctx: TrpcContext,
    merchantId: number,
    method: BusinessNewInformationReadMethod,
    input: AdminNewInformationFactsInput,
  ) => Promise<unknown>;
  /** Native officialMall reader with original DB/grant/team transaction ABI. No merchant/staff. */
  nativeMallFacts?: (ctx: TrpcContext, input: AdminNewInformationFactsInput) => Promise<unknown>;
  /** Fixed internalOrder.newInformationFacts bridge; never SELECT main-site orders here. */
  nativeOrderFacts?: (input: AdminNewInformationFactsInput, salesStaffCodes: string[] | undefined) => Promise<unknown>;
  /** Only invoked after validating a current concrete local account + orders.read. */
  getAdminSalesStaffCodes?: (ctx: TrpcContext) => Promise<string[] | undefined>;
}

type EntryRule = {
  method: BusinessNewInformationReadMethod;
  businessModule: BusinessModule;
  prefix: string;
  /** Original inbound page entry requires write, despite the facts RPC being read-only. */
  entryWrite?: boolean;
};
const BUSINESS_SOURCES: Record<AdminNewInformationModule, readonly EntryRule[]> = {
  customers: [{ method: "customer.newInformationFacts", businessModule: "customers", prefix: "customer:" }],
  inventory: [{ method: "channelInventory.newInformationFacts", businessModule: "inventory", prefix: "channel-material:" }],
  reception: [{ method: "enterprise.inquiryNewInformationFacts", businessModule: "inquiries", prefix: "inquiry:" }],
  procurement: [{ method: "customerDemand.procurementNewInformationFacts", businessModule: "procurement", prefix: "demand:" }],
  inbound: [{ method: "inbound.newInformationFacts", businessModule: "inventory", prefix: "inbound:", entryWrite: true }],
  sales: [
    { method: "crmSalesOrder.newInformationFacts", businessModule: "orders", prefix: "crm-sales:" },
    { method: "order.sellerNewInformationFacts", businessModule: "orders", prefix: "order:" },
  ],
  mall: [],
};
type Entry = {
  method: DiagnosticMethod;
  sourceKind: DiagnosticSourceKind;
  selector: string;
  identity: unknown;
  authority: unknown;
  prefix: string;
  read: (input: AdminNewInformationFactsInput) => Promise<unknown>;
};
type ProvenEntry = { entry: Entry; facts: NewInformationFactsResult };
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
class SourceUnavailable extends Error {
  constructor(readonly reason: AdminNewInformationUnavailableReason) {
    super("ADMIN_NEW_INFORMATION_SOURCE_UNAVAILABLE");
  }
}
function fail(reason: AdminNewInformationUnavailableReason = "temporary"): never {
  // Deliberately no source error text, SQL, PII, service credentials or stack in replies.
  throw new SourceUnavailable(reason);
}
function explicitlyDenied(error: unknown): boolean {
  // NOT_FOUND can mean an undeployed fixed RPC, not proof of grant revocation.
  // Network/timeout/rate-limit/malformed facts never become a successful empty source.
  return !!error && typeof error === "object" && "code" in error && error.code === "FORBIDDEN";
}
function selector(scope: string | undefined): string | undefined {
  if (scope === undefined || scope === "") return undefined;
  if (/^[1-9]\d*$/.test(scope)) return `merchant:${scope}`;
  return scope;
}
function validFacts(raw: unknown, entry: Entry): NewInformationFactsResult {
  const facts = newInformationFactsResultSchema.parse(raw);
  for (const row of facts.items) {
    if (!row.id.startsWith(entry.prefix) || !/^[1-9]\d*$/.test(row.id.slice(entry.prefix.length))) fail();
    if (!Number.isFinite(Date.parse(row.occurredAt)) ||
        row.historical !== (new Date(row.occurredAt).toISOString() < ADMIN_NEW_INFORMATION_ACTIVATED_AT) ||
        (row.actorKey != null && !row.actorKey.length) ||
        (row.countKey !== undefined && !row.countKey.length) ||
        row.children?.some(child => !child.length)) fail();
  }
  return facts;
}
function unionItems(proven: readonly ProvenEntry[]): AdminNewInformationEvent[] {
  const union = new Map<string, AdminNewInformationEvent>();
  for (const { facts } of proven) {
    for (const row of facts.items) {
      const key = JSON.stringify([row.id, row.version]);
      const previous = union.get(key);
      const normalized = {
        id: row.id, version: row.version, occurredAt: row.occurredAt,
        actorKey: row.actorKey ?? undefined,
        historical: row.historical,
        countKey: row.countKey,
      };
      if (previous && (previous.occurredAt !== normalized.occurredAt ||
          previous.actorKey !== normalized.actorKey || previous.historical !== normalized.historical ||
          previous.countKey !== normalized.countKey)) fail();
      // Merge aliases only for the exact canonical physical record + immutable event.
      // No front creator ID is converted to an admin key. Only source-stored native
      // admin provenance can match the module scope's admin:<localId> for self-seen.
      union.set(key, {
        ...normalized,
        children: Array.from(new Set([...(previous?.children ?? []), ...(row.children ?? [])])).sort(),
      });
    }
  }
  return Array.from(union.values()).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
}
/** Small bounded fan-out; no root/API boot imports or per-module chat/context queries. */
async function prove(entries: readonly Entry[], inputFor: (entry: Entry) => AdminNewInformationFactsInput): Promise<ProvenEntry[]> {
  const result: Array<ProvenEntry | undefined> = new Array(entries.length);
  let next = 0;
  const settled = await Promise.allSettled(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (next < entries.length) {
      const index = next++;
      const entry = entries[index];
      await withAdminNewInformationDiagnosticLabels({ method: entry.method, sourceKind: entry.sourceKind, entry: index }, async () => {
        let raw: unknown;
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
        // Parsing errors, available:false and unknown pagination flags are not denials.
        result[index] = { entry, facts: adminNewInformationDiagnosticSync("validFacts", () => validFacts(raw, entry)) };
      });
    }
  }));
  // Fail only AFTER all issued RPCs finish. Returning on Promise.all's first
  // rejection would release the core fence while another reader is still running.
  if (settled.some(row => row.status === "rejected")) {
    for (const row of settled) if (row.status === "rejected")
      recordAdminNewInformationDiagnostic("allSettled", "error", undefined, row.reason);
    fail();
  }
  recordAdminNewInformationDiagnostic("allSettled", "ok");
  return result.filter((row): row is ProvenEntry => row !== undefined);
}

/** Default production factory; browser provides no module/source/actor choice here.
 * Core list/lookup supply the fixed module. Authorization is freshly loaded on EVERY
 * call under its already-held account fence, including lookup of an empty ref list.
 * No authorization/fact cache survives a call. Immutable source snapshots only.
 */
export function createAdminNewInformationSourceForContext(
  context: TrpcContext,
  deps: AdminNewInformationSourceDependencies = {},
): AdminNewInformationSource {
  const loadDb = deps.getDb ?? db.getDb;
  const accountById = deps.getAdminUserById ?? db.getAdminUserById;
  const permissionsFor = deps.getAdminUserPermissions ?? db.getAdminUserPermissions;
  const bindingFor = deps.getActiveBusinessStaffBinding ?? db.getActiveBusinessStaffBinding;
  const scopeFor = deps.getActiveBusinessMerchantScope ?? db.getActiveBusinessMerchantScope;
  const merchantById = deps.getBusinessWorkbenchMerchantById ?? db.getBusinessWorkbenchMerchantById;
  const configuredIds = deps.configuredMerchantIds ?? getBusinessWorkbenchMerchantIds;
  const isArchived = deps.isAccountArchived ?? (async (database, adminUserId) => {
    const rows = await database.select({ id: adminStaffArchives.id }).from(adminStaffArchives)
      .where(eq(adminStaffArchives.adminUserId, adminUserId)).limit(1);
    return rows.length > 0;
  });
  // Memoize only code loading, NEVER account/scope/facts or a caller context.
  let businessReader: Promise<typeof import("../businessRouter")["readBusinessNewInformationFacts"]> | undefined;
  const businessFacts = deps.readBusinessFacts ?? (async (ctx, merchantId, method, input) => {
    // Internal parent entry skips ONLY the already-held notification named fence;
    // original merchant/binding/fine source authorization is still mandatory.
    businessReader ??= import("../businessRouter").then(module => module.readBusinessNewInformationFacts);
    const readBusinessNewInformationFacts = await businessReader;
    return readBusinessNewInformationFacts(ctx, merchantId, method, input);
  });
  const mallFacts = deps.nativeMallFacts ?? (async (ctx, input) => {
    const [native, access] = await Promise.all([
      import("./adminNewInformationSources/mall"), import("./officialChannelAccess"),
    ]);
    const reader = native.createMallNewInformationReader({
      getDb: loadDb, loadOfficialAccess: access.loadOfficialAccess,
      assertOfficialRecordAction: access.assertOfficialRecordAction,
      officialTeamPredicate: access.officialTeamPredicate,
    });
    // Native mall adds its own original RR row-lock transaction, NOT an account
    // named-lock wrapper. It does not accept merchant/front staff/stock arguments.
    return reader.read(access.officialActorFromContext(ctx), input);
  });
  const orderFacts = deps.nativeOrderFacts ?? (async (input, codes) => {
    const { getPlatformOrderNewInformationFacts } = await import("../platformOrderApi");
    return getPlatformOrderNewInformationFacts(input, codes);
  });
  const salesCodes = deps.getAdminSalesStaffCodes ?? (async (ctx: TrpcContext) => {
    if (!ctx.adminAccount) fail();
    // Exact original getAdminSalesStaffCodes LOCAL path, without its OAuth-unlimited
    // compatibility branch or importing root routers merely for a private helper.
    return ctx.adminAccount.adminRole === "super_admin"
      ? undefined : db.getAdminUserSalesScopeCodes(ctx.adminAccount.id);
  });

  async function authorization(viewer: AdminNewInformationViewer, module: AdminNewInformationModule) {
    if (!ADMIN_NEW_INFORMATION_MODULES.includes(module) || !positive(viewer.adminUserId) ||
        !positive(viewer.sessionVersion) || !context.adminAccount || !context.user ||
        context.user.role !== "admin" || context.user.id !== viewer.adminUserId ||
        context.user.openId !== `local_admin:${viewer.adminUserId}` ||
        context.adminAccount.id !== viewer.adminUserId ||
        context.adminAccount.sessionVersion !== viewer.sessionVersion) fail("denied");
    // Existing db helpers return null/[] when getDb is absent; do NOT let those
    // convenience defaults turn storage failure into a valid revoked/empty scope.
    const database = await loadDb();
    if (!database) fail();
    const account = await accountById(viewer.adminUserId);
    if (!account || account.id !== viewer.adminUserId || account.status !== "active" ||
        account.sessionVersion !== viewer.sessionVersion || await isArchived(database, account.id)) fail("denied");
    const permissions = await permissionsFor(account.id);
    const ctx: TrpcContext = { ...context, adminAccount: account, adminPermissions: permissions };
    const authority = [account.id, account.sessionVersion, account.adminRole, [...permissions].sort()];
    const entries: Entry[] = [];
    if (module === "mall") {
      if (hasAdminPermission(account.adminRole, "officialInventory.read", permissions)) entries.push({
        method: "nativeMall.read", sourceKind: "nativeMall",
        selector: "native:mall", identity: ["native-official-mall", account.id],
        authority: ["native-official-mall"], prefix: "mall-material:", read: input => mallFacts(ctx, input),
      });
      return { entries, authority };
    }
    if (module === "sales" && hasAdminPermission(account.adminRole, "orders.read", permissions)) {
      const codes = await salesCodes(ctx);
      if (codes !== undefined && (!Array.isArray(codes) || codes.some(code =>
          typeof code !== "string" || !/^[a-z0-9_-]{1,64}$/.test(code)))) fail();
      const normalizedCodes = codes === undefined ? undefined : Array.from(new Set(codes)).sort();
      entries.push({
        method: "internalOrder.newInformationFacts", sourceKind: "nativeOrders",
        selector: "native:orders", identity: ["native-orders", account.id, normalizedCodes ?? "unrestricted"],
        authority: ["native-orders", normalizedCodes ?? "unrestricted"],
        prefix: "order:", read: input => orderFacts(input, normalizedCodes),
      });
    }
    const ids = Array.from(new Set(configuredIds())).sort((a, b) => a - b);
    if (ids.length > 32 || ids.some(id => !positive(id))) fail();
    if (!ids.length) return { entries, authority };
    const binding = await bindingFor(account.id);
    // Revoked/unbound employees never disable independent native sales or mall.
    if (!binding) return { entries, authority };
    if (binding.adminUserId !== account.id || !positive(binding.frontUserId) || !positive(binding.bindingVersion)) fail("denied");
    for (const merchantId of ids) {
      const scope = await scopeFor(account.id, merchantId);
      if (!scope) continue;
      if (scope.adminUserId !== account.id || scope.merchantId !== merchantId || !positive(scope.scopeVersion)) fail("denied");
      const rules = BUSINESS_SOURCES[module].filter(rule => {
        const officialRead = module === "inventory" &&
          hasAdminPermission(account.adminRole, "officialInventory.read", permissions);
        return (businessScopeAllows(scope, rule.businessModule, "read") || officialRead) &&
          (!rule.entryWrite || businessScopeAllows(scope, rule.businessModule, "write"));
      });
      if (!rules.length) continue;
      const merchant = await merchantById(merchantId);
      if (!merchant || merchant.crmStatus !== "enabled") continue;
      if (merchant.id !== merchantId) fail("denied");
      // The existing binding validator is authoritative, not a browser merchant
      // header, owner string or native backend sales-owner scope.
      const enterpriseBinding = businessEnterpriseBindingFromMerchant(merchant);
      for (const rule of rules) entries.push({
        method: rule.method, sourceKind: rule.method === "crmSalesOrder.newInformationFacts" ? "crmSales" : rule.method === "order.sellerNewInformationFacts" ? "sellerOrders" : "business",
        selector: `merchant:${merchantId}`,
        identity: ["business", merchantId, rule.method, binding.frontUserId, enterpriseBinding],
        authority: [binding.bindingVersion, scope.scopeVersion, [...scope.modulePermissions].sort()],
        prefix: rule.prefix,
        read: input => businessFacts(ctx, merchantId, rule.method, input),
      });
    }
    return { entries, authority };
  }
  function fullScope(viewer: AdminNewInformationViewer, module: AdminNewInformationModule,
    authority: unknown, proven: readonly ProvenEntry[]): AdminNewInformationScope {
    const identities = proven.map(({ entry, facts }) => digest([entry.identity, facts.scope.identity])).sort();
    const versions = proven.map(({ entry, facts }) => digest([
      entry.identity, entry.authority, facts.scope.identity, facts.scope.version,
    ])).sort();
    return {
      identity: `admin:${viewer.adminUserId}:${module}:${digest([ADMIN_NEW_INFORMATION_GENERATION, identities])}`,
      version: digest([ADMIN_NEW_INFORMATION_GENERATION, viewer.sessionVersion, authority, versions]),
      actorKey: `admin:${viewer.adminUserId}`,
    };
  }
  return {
    async list(input) {
      try {
        // This provider emits ONE complete snapshot, never a UI first page.
        if (input.cursor !== undefined || input.snapshot !== undefined) fail();
        const { entries, authority } = await adminNewInformationDiagnosticStage("authorization", () => authorization(input.viewer, input.module), { module: input.module });
        const proven = await prove(entries, () => ({}));
        if (!proven.length) return { available: false, reason: "denied" };
        const scope = fullScope(input.viewer, input.module, authority, proven);
        const items = adminNewInformationDiagnosticSync("union", () => unionItems(proven));
        return {
          available: true, scope, items,
          snapshot: digest([ADMIN_NEW_INFORMATION_GENERATION, scope,
            proven.map(({ entry, facts }) => [digest(entry.identity), facts.snapshot]).sort(),
            items.map(row => [row.id, row.version])]),
          nextCursor: null,
        };
      } catch (error) {
        recordAdminNewInformationDiagnostic("list", error instanceof SourceUnavailable && error.reason === "denied" ? "denied" : "temporary", undefined, error);
        return { available: false, reason: error instanceof SourceUnavailable ? error.reason : "temporary" };
      }
    },
    async lookup(input) {
      try {
        const refs = newInformationFactsInputSchema.parse({ refs: [...input.refs] }).refs!;
        if (input.scope !== undefined && (typeof input.scope !== "string" || input.scope.length > 180)) fail();
        const filter = selector(input.scope);
        const { entries, authority } = await adminNewInformationDiagnosticStage("authorization", () => authorization(input.viewer, input.module), { module: input.module });
        // Query exact refs under EVERY currently legal source's own SQL authority.
        // Empty/foreign namespaces still recheck grants using refs:[]. The client
        // selector filters ONLY the final items; it never reduces the authority
        // union or lets conflicting alias metadata escape cross-source validation.
        // This is at most 100 metadata refs per source, not an all-record lookup.
        const proven = await prove(entries, entry => ({ refs: refs.filter(ref => ref.startsWith(entry.prefix)) }));
        if (!proven.length) return { available: false, reason: "denied" };
        const scope = fullScope(input.viewer, input.module, authority, proven);
        const allowed = new Set(refs);
        adminNewInformationDiagnosticSync("union", () => unionItems(proven)); // Fail closed even for contradictory unselected aliases.
        const selected = proven.filter(({ entry, facts }) => filter === undefined || filter === entry.selector ||
          filter === facts.scope.identity || filter === scope.identity);
        return { available: true, scope, items: adminNewInformationDiagnosticSync("union", () => unionItems(selected)).filter(row => allowed.has(row.id)) };
      } catch (error) {
        recordAdminNewInformationDiagnostic("lookup", error instanceof SourceUnavailable && error.reason === "denied" ? "denied" : "temporary", undefined, error);
        return { available: false, reason: error instanceof SourceUnavailable ? error.reason : "temporary" };
      }
    },
  };
}
