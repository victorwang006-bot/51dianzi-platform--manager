import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getRateLimitStore } from "../rateLimitStore";

export const GUEST_QUERY_LIMIT = 5;
export const GUEST_QUERY_PENDING_TTL_MS = 2 * 60 * 1000;
export const GUEST_QUERY_GRANT_TTL_MS = 30 * 60 * 1000;
// Active grants keep their original action hash for begin idempotency. This
// timestamp is outside every legitimate reservation window and marks a grant
// whose one permitted main-data request has already been consumed.

/** MySQL TIMESTAMP in the deployment schema is second precision. */
export function guestGrantExpiresAt(now: Date = new Date()): Date {
  return new Date(Math.floor((now.getTime() + GUEST_QUERY_GRANT_TTL_MS) / 1_000) * 1_000);
}

export type GuestGrant = {
  grantId: string;
  identityHash: string;
  scopeHash: string;
  expiresAt: Date;
};

export type ReserveResult =
  | { kind: "active"; grant: GuestGrant }
  | { kind: "pending"; owned: boolean; grant: Pick<GuestGrant, "grantId" | "identityHash" | "scopeHash"> }
  | { kind: "exhausted" }
  | { kind: "identity_rate_limited" }
  | { kind: "action_scope_conflict" };

export interface GuestQueryRepository {
  reserve(input: {
    identityHash: string;
    scopeHash: string;
    actionHash: string;
    ipHash: string;
    now?: Date;
  }): Promise<ReserveResult>;
  commit(input: { grantId: string; identityHash: string; now?: Date }): Promise<GuestGrant | null>;
  readActiveGrant(input: {
    grantId: string;
    identityHash: string;
    scopeHash: string;
    now?: Date;
  }): Promise<GuestGrant | null>;
  consumeGrant(input: {
    grantId: string;
    identityHash: string;
    scopeHash: string;
    purpose?: "primary" | "reference";
    now?: Date;
  }): Promise<boolean>;
}

export function guestQueryHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function rowList<T>(result: unknown): T[] {
  return (result as [T[], unknown])?.[0] ?? [];
}

function affectedRows(result: unknown): number {
  return Number((result as [{ affectedRows?: number }, unknown])?.[0]?.affectedRows ?? 0);
}

function asDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function makeGrant(row: { grantId: unknown; identityHash: unknown; scopeHash: unknown; expiresAt: unknown }): GuestGrant | null {
  const expiresAt = asDate(row.expiresAt);
  if (!expiresAt || typeof row.grantId !== "string" || typeof row.identityHash !== "string" || typeof row.scopeHash !== "string") return null;
  return { grantId: row.grantId, identityHash: row.identityHash, scopeHash: row.scopeHash, expiresAt };
}

/**
 * The production store uses only the dedicated guest tables. If the database or
 * schema is unavailable, every precise visitor query is rejected; it never
 * falls back to a process-local allowance.
 */
export class MysqlGuestQueryRepository implements GuestQueryRepository {
  async reserve(input: {
    identityHash: string;
    scopeHash: string;
    actionHash: string;
    ipHash: string;
    now?: Date;
  }): Promise<ReserveResult> {
    const db = await getDb();
    if (!db) throw new Error("Guest query wallet unavailable");
    const now = input.now ?? new Date();
    const staleBefore = new Date(now.getTime() - GUEST_QUERY_PENDING_TTL_MS);
    const wallets = rowList<{ identityHash: string }>(await db.execute(sql`
      SELECT identityHash FROM guest_query_wallets WHERE identityHash = ${input.identityHash}
    `));
    if (!wallets[0]) {
      // Atomic shared abuse counter; office visitors still have independent wallets.
      const created = await getRateLimitStore().increment(`guest-mint:${input.ipHash}`, 30 * 60 * 1000);
      if (created > 25) return { kind: "identity_rate_limited" };
      // Autocommit finishes INSERT IGNORE's duplicate shared lock before the
      // transaction takes an exclusive wallet lock, avoiding lock upgrades.
      await db.execute(sql`
        INSERT IGNORE INTO guest_query_wallets (identityHash, createdIpHash, used, pending, createdAt, updatedAt)
        VALUES (${input.identityHash}, ${input.ipHash}, 0, 0, NOW(), NOW())
      `);
    }
    return db.transaction(async tx => {
      // INSERT IGNORE makes first-cookie races harmless; this is the actual
      // serialization point for reserve/commit/refund on one wallet.
      await tx.execute(sql`SELECT identityHash FROM guest_query_wallets WHERE identityHash = ${input.identityHash} FOR UPDATE`);
      // A worker crash must not permanently consume a reservation. This cleanup
      // happens while the per-identity wallet row is locked.
      await tx.execute(sql`
        DELETE FROM guest_query_grants
         WHERE identityHash = ${input.identityHash} AND state = 'pending' AND reservedAt < ${staleBefore}
      `);
      await tx.execute(sql`
        UPDATE guest_query_wallets
           SET pending = (SELECT COUNT(*) FROM guest_query_grants
                           WHERE identityHash = ${input.identityHash} AND state = 'pending'),
               updatedAt = NOW()
         WHERE identityHash = ${input.identityHash}
      `);

      const byAction = rowList<{ grantId: string; state: string; scopeHash: string; expiresAt: unknown }>(await tx.execute(sql`
        SELECT grantId, state, scopeHash, expiresAt FROM guest_query_grants
         WHERE identityHash = ${input.identityHash} AND actionHash = ${input.actionHash}
         ORDER BY id DESC LIMIT 1 FOR UPDATE
      `));
      if (byAction[0]?.state === "active") {
        if (byAction[0].scopeHash !== input.scopeHash) return { kind: "action_scope_conflict" };
        const grant = makeGrant({ ...byAction[0], identityHash: input.identityHash });
        if (grant && grant.expiresAt > now) return { kind: "active", grant };
        // An action id is a one-shot idempotency key, not an allowance reset.
        // Do not attempt another insert against its durable unique key.
        return { kind: "action_scope_conflict" };
      }
      if (byAction[0]?.state === "pending") {
        if (byAction[0].scopeHash !== input.scopeHash) return { kind: "action_scope_conflict" };
        // The caller may commit this short-lived pending row if its first
        // network response was lost; only one commit will increment the wallet.
        return { kind: "pending", owned: false, grant: { grantId: byAction[0].grantId, identityHash: input.identityHash, scopeHash: byAction[0].scopeHash } };
      }

      const wallet = rowList<{ used: unknown; pending: unknown }>(await tx.execute(sql`
        SELECT used, pending FROM guest_query_wallets WHERE identityHash = ${input.identityHash} FOR UPDATE
      `))[0];
      if (!wallet) throw new Error("Guest query wallet disappeared");
      if (Number(wallet.used) + Number(wallet.pending) >= GUEST_QUERY_LIMIT) return { kind: "exhausted" };

      const grantId = randomBytes(24).toString("base64url");
      await tx.execute(sql`
        INSERT INTO guest_query_grants
          (grantId, identityHash, scopeHash, actionHash, state, reservedAt, createdAt, updatedAt)
        VALUES (${grantId}, ${input.identityHash}, ${input.scopeHash}, ${input.actionHash}, 'pending', NOW(), NOW(), NOW())
      `);
      await tx.execute(sql`
        UPDATE guest_query_wallets SET pending = pending + 1, updatedAt = NOW()
         WHERE identityHash = ${input.identityHash}
      `);
      return { kind: "pending", owned: true, grant: { grantId, identityHash: input.identityHash, scopeHash: input.scopeHash } };
    });
  }

  async commit(input: { grantId: string; identityHash: string; now?: Date }): Promise<GuestGrant | null> {
    const db = await getDb();
    if (!db) throw new Error("Guest query wallet unavailable");
    const now = input.now ?? new Date();
    // Keep the value byte-for-byte stable after a TIMESTAMP(0) DB round trip;
    // the same Date is signed into the authorization token after commit.
    const expiresAt = guestGrantExpiresAt(now);
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT identityHash FROM guest_query_wallets WHERE identityHash = ${input.identityHash} FOR UPDATE`);
      const rows = rowList<{ scopeHash: string; state: string }>(await tx.execute(sql`
        SELECT scopeHash, state FROM guest_query_grants
         WHERE grantId = ${input.grantId} AND identityHash = ${input.identityHash} LIMIT 1 FOR UPDATE
      `));
      if (!rows[0] || rows[0].state !== "pending") return null;
      await tx.execute(sql`
        UPDATE guest_query_grants SET state = 'active', expiresAt = ${expiresAt}, updatedAt = NOW()
         WHERE grantId = ${input.grantId} AND identityHash = ${input.identityHash} AND state = 'pending'
      `);
      await tx.execute(sql`
        UPDATE guest_query_wallets SET used = used + 1, pending = GREATEST(0, pending - 1), updatedAt = NOW()
         WHERE identityHash = ${input.identityHash}
      `);
      return { grantId: input.grantId, identityHash: input.identityHash, scopeHash: rows[0].scopeHash, expiresAt };
    });
  }

  async readActiveGrant(input: { grantId: string; identityHash: string; scopeHash: string; now?: Date }): Promise<GuestGrant | null> {
    const db = await getDb();
    if (!db) throw new Error("Guest query wallet unavailable");
    const now = input.now ?? new Date();
    const rows = rowList<{ grantId: unknown; identityHash: unknown; scopeHash: unknown; expiresAt: unknown }>(await db.execute(sql`
      SELECT grantId, identityHash, scopeHash, expiresAt FROM guest_query_grants
       WHERE grantId = ${input.grantId} AND identityHash = ${input.identityHash}
         AND scopeHash = ${input.scopeHash} AND state = 'active' AND expiresAt > ${now}
       LIMIT 1
    `));
    return rows[0] ? makeGrant(rows[0]) : null;
  }

  async consumeGrant(input: { grantId: string; identityHash: string; scopeHash: string; purpose?: "primary" | "reference"; now?: Date }): Promise<boolean> {
    const db = await getDb();
    if (!db) throw new Error("Guest query wallet unavailable");
    const now = input.now ?? new Date();
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT identityHash FROM guest_query_wallets WHERE identityHash = ${input.identityHash} FOR UPDATE`);
      const rows = rowList<{ reservedAt: unknown }>(await tx.execute(sql`
        SELECT reservedAt FROM guest_query_grants
         WHERE grantId = ${input.grantId} AND identityHash = ${input.identityHash}
           AND scopeHash = ${input.scopeHash} AND state = 'active' AND expiresAt > ${now}
         LIMIT 1 FOR UPDATE
      `));
      const reservedAt = rows[0] && asDate(rows[0].reservedAt);
      if (!reservedAt) return false;
      const next = nextConsumptionMarker(reservedAt, input.purpose ?? "primary");
      if (!next) return false;
      const updated = await tx.execute(sql`
        UPDATE guest_query_grants
           SET reservedAt = ${next}, updatedAt = NOW()
         WHERE grantId = ${input.grantId} AND identityHash = ${input.identityHash}
           AND scopeHash = ${input.scopeHash} AND state = 'active'
           AND reservedAt = ${reservedAt}
      `);
      return affectedRows(updated) === 1;
    });
  }
}

type InMemoryRow = GuestGrant & { actionHash: string; state: "pending" | "active"; reservedAt: number };
/** Test-only repository; it is opt-in and is never selected by production code. */
export class InMemoryGuestQueryRepository implements GuestQueryRepository {
  private wallets = new Map<string, { used: number; ipHash: string; createdAt: number }>();
  private grants = new Map<string, InMemoryRow>();

  async reserve(input: { identityHash: string; scopeHash: string; actionHash: string; ipHash: string; now?: Date }): Promise<ReserveResult> {
    const now = input.now?.getTime() ?? Date.now();
    let wallet = this.wallets.get(input.identityHash);
    if (!wallet) {
      const newAtIp = Array.from(this.wallets.values()).filter(row => row.ipHash === input.ipHash && row.createdAt >= now - 30 * 60 * 1000).length;
      if (newAtIp >= 25) return { kind: "identity_rate_limited" };
      wallet = { used: 0, ipHash: input.ipHash, createdAt: now };
      this.wallets.set(input.identityHash, wallet);
    }
    for (const [id, row] of Array.from(this.grants.entries())) if (row.identityHash === input.identityHash && row.state === "pending" && row.reservedAt < now - GUEST_QUERY_PENDING_TTL_MS) this.grants.delete(id);
    const action = Array.from(this.grants.values()).find(row => row.identityHash === input.identityHash && row.actionHash === input.actionHash);
    if (action && action.scopeHash !== input.scopeHash) return { kind: "action_scope_conflict" };
    if (action?.state === "active" && action.expiresAt.getTime() > now) return { kind: "active", grant: action };
    if (action?.state === "pending") return { kind: "pending", owned: false, grant: action };
    if (action) return { kind: "action_scope_conflict" };
    const pending = Array.from(this.grants.values()).filter(row => row.identityHash === input.identityHash && row.state === "pending").length;
    if (wallet.used + pending >= GUEST_QUERY_LIMIT) return { kind: "exhausted" };
    const grantId = randomBytes(24).toString("base64url");
    const grant: InMemoryRow = { grantId, identityHash: input.identityHash, scopeHash: input.scopeHash, actionHash: input.actionHash, state: "pending", reservedAt: now, expiresAt: new Date(0) };
    this.grants.set(grantId, grant);
    return { kind: "pending", owned: true, grant };
  }

  async commit(input: { grantId: string; identityHash: string; now?: Date }): Promise<GuestGrant | null> {
    const row = this.grants.get(input.grantId);
    const wallet = this.wallets.get(input.identityHash);
    if (!row || !wallet || row.identityHash !== input.identityHash || row.state !== "pending") return null;
    row.state = "active";
    row.expiresAt = guestGrantExpiresAt(input.now ?? new Date());
    wallet.used += 1;
    return row;
  }

  async readActiveGrant(input: { grantId: string; identityHash: string; scopeHash: string; now?: Date }): Promise<GuestGrant | null> {
    const row = this.grants.get(input.grantId);
    return row && row.state === "active" && row.identityHash === input.identityHash && row.scopeHash === input.scopeHash && row.expiresAt.getTime() > (input.now?.getTime() ?? Date.now()) ? row : null;
  }

  async consumeGrant(input: { grantId: string; identityHash: string; scopeHash: string; purpose?: "primary" | "reference"; now?: Date }): Promise<boolean> {
    const row = this.grants.get(input.grantId);
    const now = input.now?.getTime() ?? Date.now();
    if (
      !row || row.state !== "active" || row.identityHash !== input.identityHash
      || row.scopeHash !== input.scopeHash || row.expiresAt.getTime() <= now
    ) return false;
    const next = nextConsumptionMarker(new Date(row.reservedAt), input.purpose ?? "primary");
    if (!next) return false;
    row.reservedAt = next.getTime();
    return true;
  }

  snapshot(identityHash: string) {
    const wallet = this.wallets.get(identityHash);
    return { used: wallet?.used ?? 0, pending: Array.from(this.grants.values()).filter(row => row.identityHash === identityHash && row.state === "pending").length };
  }
}

/** Active rows reuse reservation timestamps as a bounded two-purpose bitmap.
 * Year 2000 = primary consumed, 2001 = reference consumed, 2002 = both.
 * Mid-year sentinels tolerate DB/driver timezone offsets; pending reservations
 * still carry real timestamps. actionHash remains intact for issuance retries.
 */
function nextConsumptionMarker(current: Date, purpose: "primary" | "reference"): Date | null {
  const year = current.getUTCFullYear();
  const mask = year >= 2010 ? 0 : year === 2000 ? 1 : year === 2001 ? 2 : year === 2002 ? 3 : -1;
  const bit = purpose === "primary" ? 1 : 2;
  if (mask < 0 || (mask & bit)) return null;
  const next = mask | bit;
  return new Date(`${next === 1 ? 2000 : next === 2 ? 2001 : 2002}-06-01T00:00:00.000Z`);
}
