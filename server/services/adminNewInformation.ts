import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  ADMIN_NEW_INFORMATION_MODULES,
  adminNewInformationInspectSchema,
  adminNewInformationMarkSchema,
  type AdminNewInformationInspection,
  type AdminNewInformationModule,
  type AdminNewInformationModuleSummary,
  type AdminNewInformationRow,
  type AdminNewInformationSummary,
  type AdminNewInformationUnavailableReason,
} from "../../shared/adminNewInformation";
import {
  adminNewInformationStates,
  adminNewInformationSeen,
} from "../../drizzle/adminNewInformationSchema";
import { getDb, withBusinessAuthorizationFence } from "../db";

/** Server-authenticated local admin account; never the front-site ctx.user actor. */
export type AdminNewInformationViewer = {
  adminUserId: number;
  sessionVersion: number;
};
/** Entire current module authorization, including binding/grant revisions. No PII. */
export type AdminNewInformationScope = {
  identity: string;
  version: string;
  /** A server-proven employee principal, not an admin ID/front user ID guessed by the client. */
  actorKey?: string | null;
};
export type AdminNewInformationEvent = AdminNewInformationRow & {
  /** Stable server-defined subroute keys. One event can appear in several subroutes. */
  children?: readonly string[];
  /** Server-only classification from stored creation/first-submit/assignment time.
   * New providers must use ADMIN_NEW_INFORMATION_ACTIVATED_AT from the shared
   * facts contract and explicitly set false for post-activation events. Undefined
   * retains the legacy initial-snapshot baseline behavior; never use scan time.
   */
  historical?: boolean;
  /** Server-only counting identity (e.g. reception conversation ID), never a seen key. */
  countKey?: string;
};
type SourceUnavailable = { available: false; reason?: AdminNewInformationUnavailableReason };
export type AdminNewInformationRead =
  | SourceUnavailable
  | {
      available: true;
      scope: AdminNewInformationScope;
      items: readonly AdminNewInformationEvent[];
    };
export type AdminNewInformationListRead =
  | SourceUnavailable
  | {
      available: true;
      scope: AdminNewInformationScope;
      items: readonly AdminNewInformationEvent[];
      /** Nonempty opaque token for a stable complete snapshot, retained across all pages. */
      snapshot: string;
      nextCursor?: string | null;
    };
export interface AdminNewInformationSource {
  /**
   * Recheck local account/session and live module/resource permission on EVERY call.
   * Enumerate ALL currently authorized records, not a UI page. Pages must belong to
   * a stable snapshot: a new event after snapshot capture must appear on the next
   * scan, never be retroactively inserted into an initial baseline page. Throw or
   * return available:false on partial data, missing tables/RPC failure/denial.
   * id is a namespace-scoped RECORD identity; version identifies its immutable
   * creation/assignment event (including monotonic assignment revision). Product
   * edits must not change it; reassigning back must create a new event version.
   */
  list(input: {
    viewer: AdminNewInformationViewer;
    module: AdminNewInformationModule;
    cursor?: string;
    snapshot?: string;
    /** Notification state only; providers still query real authorized sources. */
    baseline?: { initialized: boolean };
  }): Promise<AdminNewInformationListRead>;
  /**
   * Query REAL currently authorized records for exact refs; no client metadata.
   * Return only active creation/assignment events. scope is a requested filter,
   * never proof of authorization. The reply scope fingerprints the current full
   * authorization, and must match list for the same viewer/module.
   */
  lookup(input: {
    viewer: AdminNewInformationViewer;
    module: AdminNewInformationModule;
    refs: readonly string[];
    scope?: string;
  }): Promise<AdminNewInformationRead>;
}
export type AdminNewInformationState = {
  initialized: boolean;
  /** SHA-256 of [record scoped ID, immutable event version]; no business DTOs. */
  seen: Set<string>;
  lastSummary: AdminNewInformationModuleSummary;
};
export interface AdminNewInformationStore {
  /** Serialize account/module operations across instances; commit ALL or roll back. */
  withModule<T>(
    viewer: AdminNewInformationViewer,
    module: AdminNewInformationModule,
    operation: (state: AdminNewInformationState) => Promise<T>
  ): Promise<T>;
  /** A displayed batch must not partially clear if another source/group fails. */
  withModules<T>(
    viewer: AdminNewInformationViewer,
    modules: readonly AdminNewInformationModule[],
    operation: (
      states: Map<AdminNewInformationModule, AdminNewInformationState>
    ) => Promise<T>
  ): Promise<T>;
}
export type AdminNewInformationDeps = {
  source: AdminNewInformationSource;
  store?: AdminNewInformationStore;
  /** Existing server secret; omitted uses JWT_SECRET. Never returned/logged. */
  secret?: string | (() => string);
  now?: () => number;
  receiptTtlMs?: number;
  /** Same linearization fence used by account/binding/grant revocation paths. */
  withViewerFence?: <T>(
    viewer: AdminNewInformationViewer,
    operation: () => Promise<T>
  ) => Promise<T>;
};
export type AdminNewInformationInspectInput = {
  module: AdminNewInformationModule;
  refs: string[];
  scope?: string;
};
export type AdminNewInformationMarkResult = {
  /** Distinct exact id+version facts newly written; may exceed accepted for a compound row. */
  marked: number;
  /** Original input row-receipt count, including duplicates, only after ALL facts pass. */
  accepted: number;
};
export interface AdminNewInformationService {
  summary(
    viewer: AdminNewInformationViewer
  ): Promise<AdminNewInformationSummary>;
  inspect(
    viewer: AdminNewInformationViewer,
    input: AdminNewInformationInspectInput
  ): Promise<AdminNewInformationInspection>;
  markDisplayed(
    viewer: AdminNewInformationViewer,
    input: { receipts: string[] }
  ): Promise<AdminNewInformationMarkResult>;
}

function unavailable() {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "新增信息核验暂不可用，请稍后重试",
  });
}
class SourceUnavailableError extends Error {
  constructor(readonly reason?: AdminNewInformationUnavailableReason) {
    super("ADMIN_NEW_INFORMATION_SOURCE_UNAVAILABLE");
  }
}
function assertViewer(viewer: AdminNewInformationViewer) {
  if (
    !viewer ||
    !Number.isSafeInteger(viewer.adminUserId) ||
    viewer.adminUserId <= 0 ||
    !Number.isSafeInteger(viewer.sessionVersion) ||
    viewer.sessionVersion <= 0
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请使用有效的本地后台账号登录",
    });
  }
}
function nonempty(value: unknown, max = 180): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function assertScope(scope: AdminNewInformationScope) {
  if (
    !scope ||
    !nonempty(scope.identity) ||
    !nonempty(scope.version) ||
    (scope.actorKey != null && !nonempty(scope.actorKey))
  )
    throw unavailable();
}
function eventKey(
  event: Pick<AdminNewInformationEvent, "id" | "version">
): string {
  return createHash("sha256")
    .update(JSON.stringify([event.id, event.version]))
    .digest("hex");
}
function validateEvents(
  items: readonly AdminNewInformationEvent[]
): AdminNewInformationEvent[] {
  if (!Array.isArray(items)) throw unavailable();
  const unique = new Map<string, AdminNewInformationEvent>();
  for (const row of items as readonly AdminNewInformationEvent[]) {
    if (
      !row ||
      !nonempty(row.id) ||
      !nonempty(row.version) ||
      !nonempty(row.occurredAt, 64) ||
      !Number.isFinite(Date.parse(row.occurredAt)) ||
      (row.actorKey != null && !nonempty(row.actorKey)) ||
      (row.historical !== undefined && typeof row.historical !== "boolean") ||
      (row.countKey !== undefined && !nonempty(row.countKey)) ||
      (row.children !== undefined &&
        (!Array.isArray(row.children) ||
          !row.children.every((child: unknown) => nonempty(child))))
    )
      throw unavailable();
    const key = eventKey(row);
    const previous = unique.get(key);
    if (
      previous &&
      (previous.actorKey !== row.actorKey ||
        previous.occurredAt !== row.occurredAt ||
        previous.historical !== row.historical ||
        previous.countKey !== row.countKey)
    ) {
      // A provider must not silently return contradictory identities/versions.
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
        new Set([...(previous?.children ?? []), ...(row.children ?? [])])
      ),
    });
  }
  return Array.from(unique.values());
}
function sameScope(
  a: AdminNewInformationScope,
  b: AdminNewInformationScope
): boolean {
  return (
    a.identity === b.identity &&
    a.version === b.version &&
    a.actorKey === b.actorKey
  );
}
function isNew(
  state: AdminNewInformationState,
  row: AdminNewInformationEvent,
  scope: AdminNewInformationScope
) {
  // Own creation may be treated as seen, but the source row is never hidden.
  return (
    row.historical !== true &&
    !state.seen.has(eventKey(row)) &&
    !(scope.actorKey && row.actorKey === scope.actorKey)
  );
}
function countEvents(
  state: AdminNewInformationState,
  rows: AdminNewInformationEvent[],
  scope: AdminNewInformationScope
) {
  const ids = new Set<string>();
  const children = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const child of row.children ?? [])
      if (!children.has(child)) children.set(child, new Set());
    if (!isNew(state, row, scope)) continue;
    // Keep the counting namespace distinct from physical IDs; seen remains id+version.
    const countKey = JSON.stringify(
      row.countKey === undefined ? ["id", row.id] : ["count", row.countKey]
    );
    ids.add(countKey);
    for (const child of row.children ?? []) children.get(child)!.add(countKey);
  }
  return {
    count: ids.size,
    available: true,
    ...(children.size
      ? {
          children: Object.fromEntries(
            Array.from(children).map(([key, values]) => [key, values.size])
          ),
        }
      : {}),
  } satisfies AdminNewInformationModuleSummary;
}

/** Two newly-empty admin metadata tables; no DDL at runtime, no business writes. */
export function createDrizzleAdminNewInformationStore(
  loadDb: typeof getDb = getDb
): AdminNewInformationStore {
  async function withModules<T>(
    viewer: AdminNewInformationViewer,
    modules: readonly AdminNewInformationModule[],
    operation: (
      states: Map<AdminNewInformationModule, AdminNewInformationState>
    ) => Promise<T>
  ): Promise<T> {
    const db = await loadDb();
    if (!db) throw unavailable();
    const ordered = ADMIN_NEW_INFORMATION_MODULES.filter(module =>
      modules.includes(module)
    );
    return db.transaction(async tx => {
      const states = new Map<
        AdminNewInformationModule,
        AdminNewInformationState
      >();
      const originals = new Map<AdminNewInformationModule, Set<string>>();
      for (const module of ordered) {
        // The unique account/module row is also the cross-instance initialization lock.
        await tx
          .insert(adminNewInformationStates)
          .values({ adminUserId: viewer.adminUserId, module })
          .onDuplicateKeyUpdate({ set: { module } });
        const where = and(
          eq(adminNewInformationStates.adminUserId, viewer.adminUserId),
          eq(adminNewInformationStates.module, module)
        );
        const [stored] = await tx
          .select()
          .from(adminNewInformationStates)
          .where(where)
          .for("update");
        if (!stored) throw unavailable();
        const seenRows = await tx
          .select({ eventKey: adminNewInformationSeen.eventKey })
          .from(adminNewInformationSeen)
          .where(
            and(
              eq(adminNewInformationSeen.adminUserId, viewer.adminUserId),
              eq(adminNewInformationSeen.module, module)
            )
          );
        const original = new Set(seenRows.map(row => row.eventKey));
        const state: AdminNewInformationState = {
          initialized: stored.initialized === 1,
          seen: new Set(original),
          lastSummary: {
            count: stored.lastCount,
            available: true,
            ...(stored.lastChildren ? { children: stored.lastChildren } : {}),
          },
        };
        states.set(module, state);
        originals.set(module, original);
      }
      const result = await operation(states);
      for (const module of ordered) {
        const state = states.get(module)!;
        const original = originals.get(module)!;
        const additions = Array.from(state.seen).filter(
          key => !original.has(key)
        );
        for (let offset = 0; offset < additions.length; offset += 100) {
          await tx
            .insert(adminNewInformationSeen)
            .values(
              additions.slice(offset, offset + 100).map(key => ({
                adminUserId: viewer.adminUserId,
                module,
                eventKey: key,
              }))
            )
            .onDuplicateKeyUpdate({ set: { module } });
        }
        await tx
          .update(adminNewInformationStates)
          .set({
            initialized: state.initialized ? 1 : 0,
            lastCount: state.lastSummary.count,
            lastChildren: state.lastSummary.children ?? null,
          })
          .where(
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
    withModule: (viewer, module, operation) =>
      withModules(viewer, [module], states => operation(states.get(module)!)),
  };
}

type ReceiptIdentity = {
  a: number;
  sv: number;
  m: AdminNewInformationModule;
  id: string;
  si: string;
  sc: string;
  filter?: string;
  iat: number;
  exp: number;
};
type Receipt = ReceiptIdentity & { v: 1; ev: string };
/** A flat, fully signed array for ONE physical row; never recursively packed tokens. */
type CompoundReceipt = ReceiptIdentity & { v: 2; events: string[] };
const MAX_RECEIPT_FACTS = 8;
const MAX_RECEIPT_SIZE = 4096;
export function createAdminNewInformationService(
  deps: AdminNewInformationDeps
): AdminNewInformationService {
  const store = deps.store ?? createDrizzleAdminNewInformationStore();
  const now = deps.now ?? Date.now;
  const ttl = deps.receiptTtlMs ?? 120_000;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 300_000)
    throw new Error("INVALID_RECEIPT_TTL");
  const fence =
    deps.withViewerFence ??
    (<T>(viewer: AdminNewInformationViewer, operation: () => Promise<T>) =>
      withBusinessAuthorizationFence(
        { adminUserId: viewer.adminUserId },
        operation
      ));
  const secret = () => {
    const value =
      typeof deps.secret === "function"
        ? deps.secret()
        : (deps.secret ?? process.env.JWT_SECRET ?? "");
    if (typeof value !== "string" || !value.trim()) throw unavailable();
    return createHmac("sha256", value)
      .update("51dianzi/admin-new-information/receipt/v1")
      .digest();
  };
  function sign(receipt: Receipt | CompoundReceipt): string {
    const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
    const token = `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
    if (token.length > MAX_RECEIPT_SIZE) throw unavailable();
    return token;
  }
  function verify(
    token: string,
    viewer: AdminNewInformationViewer
  ): Receipt[] | null {
    try {
      if (!nonempty(token, MAX_RECEIPT_SIZE)) return null;
      const parts = token.split(".");
      if (
        parts.length !== 2 ||
        !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))
      )
        return null;
      const expected = createHmac("sha256", secret()).update(parts[0]).digest();
      const supplied = Buffer.from(parts[1], "base64url");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(expected, supplied)
      )
        return null;
      const receipt: Receipt | CompoundReceipt = JSON.parse(
        Buffer.from(parts[0], "base64url").toString("utf8")
      );
      const time = now();
      if (
        !receipt ||
        (receipt.v !== 1 && receipt.v !== 2) ||
        receipt.a !== viewer.adminUserId ||
        receipt.sv !== viewer.sessionVersion ||
        !ADMIN_NEW_INFORMATION_MODULES.includes(receipt.m) ||
        !nonempty(receipt.id) ||
        !nonempty(receipt.si) ||
        !nonempty(receipt.sc) ||
        (receipt.filter !== undefined &&
          (typeof receipt.filter !== "string" ||
            receipt.filter.length > 180)) ||
        !Number.isSafeInteger(receipt.iat) ||
        !Number.isSafeInteger(receipt.exp) ||
        receipt.iat > time ||
        receipt.exp <= time ||
        receipt.exp <= receipt.iat ||
        receipt.exp - receipt.iat > ttl
      )
        return null;
      if (receipt.v === 1) return nonempty(receipt.ev) ? [receipt] : null;
      if (
        !Array.isArray(receipt.events) ||
        receipt.events.length < 2 ||
        receipt.events.length > MAX_RECEIPT_FACTS ||
        !receipt.events.every(version => nonempty(version)) ||
        new Set(receipt.events).size !== receipt.events.length
      )
        return null;
      // Flatten only signed versions, not tokens/objects or the row's current events.
      const { events, ...identity } = receipt;
      return events.map(ev => ({ ...identity, v: 1, ev }));
    } catch {
      return null;
    }
  }
  async function scan(
    viewer: AdminNewInformationViewer,
    module: AdminNewInformationModule,
    initialized: boolean
  ) {
    let cursor: string | undefined;
    let snapshot: string | undefined;
    let scope: AdminNewInformationScope | undefined;
    const cursors = new Set<string>();
    const all: AdminNewInformationEvent[] = [];
    // A nonterminating/partial source must never initialize a baseline.
    for (let page = 0; page < 10_000; page++) {
      const reply = await deps.source.list({
        viewer,
        module,
        cursor,
        snapshot,
        baseline: { initialized },
      });
      if (!reply || reply.available !== true)
        throw new SourceUnavailableError(reply?.available === false ? reply.reason : "temporary");
      assertScope(reply.scope);
      if (
        !nonempty(reply.snapshot, 1024) ||
        (snapshot && snapshot !== reply.snapshot) ||
        (scope && !sameScope(scope, reply.scope))
      )
        throw unavailable();
      scope = reply.scope;
      snapshot = reply.snapshot;
      all.push(...validateEvents(reply.items));
      if (reply.nextCursor == null) return { scope, rows: validateEvents(all) };
      if (!nonempty(reply.nextCursor, 1024) || cursors.has(reply.nextCursor))
        throw unavailable();
      cursors.add(reply.nextCursor);
      cursor = reply.nextCursor;
    }
    throw unavailable();
  }
  async function establish(
    viewer: AdminNewInformationViewer,
    module: AdminNewInformationModule,
    state: AdminNewInformationState
  ) {
    if (state.initialized) return;
    const baseline = await scan(viewer, module, false);
    for (const row of baseline.rows)
      if (row.historical !== false) state.seen.add(eventKey(row));
    state.initialized = true;
    state.lastSummary = { count: 0, available: true };
  }
  return {
    async summary(viewer) {
      assertViewer(viewer);
      const modules = {} as AdminNewInformationSummary["modules"];
      for (const module of ADMIN_NEW_INFORMATION_MODULES) {
        let previous: AdminNewInformationModuleSummary = {
          count: 0,
          available: false,
          lastKnown: false,
        };
        try {
          secret(); // No secret means no initialization or receipt-capable operation.
          modules[module] = await fence(viewer, () =>
            store.withModule(viewer, module, async state => {
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
          // Preserve the last proven count when the source failed; never report a
          // successful empty result or delete existing seen/baseline metadata.
          // Legacy available:false without reason remains conservatively hidden.
          const reason = error instanceof SourceUnavailableError ? error.reason : "temporary";
          modules[module] = {
            ...previous,
            ...(reason ? { reason } : {}),
            ...(reason === "denied" ? { lastKnown: false } : {}),
          };
        }
      }
      return { modules };
    },
    async inspect(viewer, input) {
      assertViewer(viewer);
      const checked = adminNewInformationInspectSchema.parse(input);
      secret();
      if (!checked.refs.length) return { items: [] };
      try {
        return await fence(viewer, () =>
          store.withModule(viewer, checked.module, async state => {
            // A row lookup is never enough to baseline a module or a UI page.
            await establish(viewer, checked.module, state);
            const refs = Array.from(new Set(checked.refs));
            const reply = await deps.source.lookup({
              viewer,
              module: checked.module,
              refs,
              scope: checked.scope,
            });
            if (!reply || reply.available !== true) throw unavailable();
            assertScope(reply.scope);
            const allowed = new Set(refs);
            const rows = validateEvents(reply.items).filter(row =>
              allowed.has(row.id)
            );
            const physicalRows = new Map<string, AdminNewInformationEvent[]>();
            for (const row of rows) {
              const facts = physicalRows.get(row.id) ?? [];
              facts.push(row);
              physicalRows.set(row.id, facts);
            }
            const time = now();
            return {
              items: Array.from(physicalRows, ([id, facts]) => {
                const unseen = facts.filter(row =>
                  isNew(state, row, reply.scope)
                );
                // Preserve legacy receipts for single/non-new rows. New compound
                // rows acknowledge exactly inspected unseen facts, not a Map-last winner.
                const versions = (unseen.length ? unseen : facts)
                  .map(row => row.version)
                  .sort();
                if (versions.length > MAX_RECEIPT_FACTS) throw unavailable();
                const identity: ReceiptIdentity = {
                  a: viewer.adminUserId,
                  sv: viewer.sessionVersion,
                  m: checked.module,
                  id,
                  si: reply.scope.identity,
                  sc: reply.scope.version,
                  ...(checked.scope !== undefined
                    ? { filter: checked.scope }
                    : {}),
                  iat: time,
                  exp: time + ttl,
                };
                return {
                  id,
                  // Presentation-only identity: stable under source ordering and
                  // NEVER used as a source lookup version or durable seen key.
                  version:
                    facts.length === 1
                      ? facts[0].version
                      : `compound:${createHash("sha256")
                          .update(
                            JSON.stringify(facts.map(row => row.version).sort())
                          )
                          .digest("hex")}`,
                  isNew: unseen.length > 0,
                  receipt: sign(
                    versions.length === 1
                      ? { ...identity, v: 1, ev: versions[0] }
                      : { ...identity, v: 2, events: versions }
                  ),
                };
              }),
            };
          })
        );
      } catch {
        throw unavailable();
      }
    },
    async markDisplayed(viewer, input) {
      assertViewer(viewer);
      const checked = adminNewInformationMarkSchema.parse(input);
      secret();
      const receipts = Array.from(new Set(checked.receipts)).flatMap(token => {
        const facts = verify(token, viewer);
        if (!facts) throw unavailable();
        return facts;
      });
      if (!receipts.length) return { marked: 0, accepted: 0 };
      const modules = ADMIN_NEW_INFORMATION_MODULES.filter(module =>
        receipts.some(receipt => receipt.m === module)
      );
      try {
        // Authorization mutation and this live recheck/commit share the same fence.
        return await fence(viewer, () =>
          store.withModules(viewer, modules, async states => {
            const pending = new Map<
              AdminNewInformationModule,
              Map<string, number>
            >();
            for (const module of modules) {
              const selected = receipts.filter(receipt => receipt.m === module);
              const state = states.get(module)!;
              if (!state.initialized) throw unavailable();
              const additions = new Map<string, number>();
              const groups = new Map<string, Receipt[]>();
              for (const receipt of selected) {
                const key = JSON.stringify([
                  receipt.si,
                  receipt.sc,
                  receipt.filter,
                ]);
                const group = groups.get(key) ?? [];
                group.push(receipt);
                groups.set(key, group);
              }
              // Validate every module/group before writing ANY submitted event.
              for (const group of Array.from(groups.values())) {
                const first = group[0];
                const reply = await deps.source.lookup({
                  viewer,
                  module,
                  refs: Array.from(new Set(group.map(receipt => receipt.id))),
                  scope: first.filter,
                });
                if (!reply || reply.available !== true) throw unavailable();
                assertScope(reply.scope);
                if (
                  reply.scope.identity !== first.si ||
                  reply.scope.version !== first.sc
                )
                  throw unavailable();
                const real = new Set(validateEvents(reply.items).map(eventKey));
                for (const receipt of group) {
                  const key = eventKey({ id: receipt.id, version: receipt.ev });
                  // Check expiry again after potentially slow permission/source IO.
                  if (receipt.exp <= now() || !real.has(key))
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
            let marked = 0;
            const commitTime = now();
            // Even already-seen receipts must remain valid at the batch linearization point.
            if (receipts.some(receipt => receipt.exp <= commitTime))
              throw unavailable();
            for (const [module, additions] of Array.from(pending)) {
              const state = states.get(module)!;
              for (const key of Array.from(additions.keys())) {
                state.seen.add(key);
                marked++;
              }
            }
            return { marked, accepted: checked.receipts.length };
          })
        );
      } catch {
        throw unavailable();
      }
    },
  };
}
