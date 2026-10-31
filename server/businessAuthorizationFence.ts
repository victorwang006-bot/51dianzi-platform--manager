import mysql from "mysql2/promise";

/**
 * Cross-service authorization linearization fence.
 *
 * The main Drizzle client must never retain one of its pooled connections while
 * a front-service RPC is outstanding.  This module therefore leases a separate,
 * bounded mysql2 connection solely for MySQL's database-global advisory locks.
 * MySQL releases these locks automatically if this process/connection dies.
 */
const MAX_FENCE_LEASES = 8;
const FENCE_LEASE_WAIT_MS = 12_000;
const FENCE_LOCK_WAIT_SECONDS = 10;
const FENCE_QUERY_TIMEOUT_MS = 11_000;

type FenceKey = {
  adminUserId: number;
  merchantId?: number;
};

let activeLeaseCount = 0;
const leaseWaiters: Array<() => void> = [];

function fenceError(code: string) {
  return new Error(code);
}

function assertFenceKey(key: FenceKey) {
  if (!Number.isSafeInteger(key.adminUserId) || key.adminUserId <= 0) {
    throw fenceError("BUSINESS_AUTHORIZATION_FENCE_ADMIN_INVALID");
  }
  if (key.merchantId !== undefined && (!Number.isSafeInteger(key.merchantId) || key.merchantId <= 0)) {
    throw fenceError("BUSINESS_AUTHORIZATION_FENCE_MERCHANT_INVALID");
  }
}

/**
 * All paths acquire the account fence before the optional exact-scope fence.
 * A binding revoke/rebind takes only the first key, thereby fencing every
 * merchant of that admin. Scope changes take both keys in the same order.
 */
export function businessAuthorizationFenceNames(key: FenceKey) {
  assertFenceKey(key);
  const names = [`business-auth:admin:${key.adminUserId}`];
  if (key.merchantId !== undefined) {
    names.push(`business-auth:scope:${key.adminUserId}:${key.merchantId}`);
  }
  return names;
}

async function reserveFenceLease(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let release: (() => void) | null = null;
    const waitTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const index = leaseWaiters.indexOf(grant);
      if (index >= 0) leaseWaiters.splice(index, 1);
      reject(fenceError("BUSINESS_AUTHORIZATION_FENCE_LEASE_TIMEOUT"));
    }, FENCE_LEASE_WAIT_MS);

    const grant = () => {
      if (settled) return;
      settled = true;
      clearTimeout(waitTimer);
      activeLeaseCount += 1;
      let released = false;
      release = () => {
        if (released) return;
        released = true;
        activeLeaseCount -= 1;
        const next = leaseWaiters.shift();
        if (next) next();
      };
      resolve(release);
    };

    if (activeLeaseCount < MAX_FENCE_LEASES) grant();
    else leaseWaiters.push(grant);
  });
}

async function acquireNamedLock(connection: mysql.Connection, name: string) {
  const [rows] = await connection.query(
    { sql: "SELECT GET_LOCK(?, ?) AS acquired", timeout: FENCE_QUERY_TIMEOUT_MS },
    [name, FENCE_LOCK_WAIT_SECONDS],
  );
  const first = Array.isArray(rows) ? rows[0] as { acquired?: unknown } | undefined : undefined;
  if (first?.acquired !== 1) {
    throw fenceError("BUSINESS_AUTHORIZATION_FENCE_BUSY");
  }
}

async function releaseNamedLock(connection: mysql.Connection, name: string) {
  await connection.query(
    { sql: "SELECT RELEASE_LOCK(?) AS released", timeout: FENCE_QUERY_TIMEOUT_MS },
    [name],
  );
}

/**
 * Runs one authorization-sensitive operation at a database-global
 * linearization point. The callback may use the ordinary Drizzle client: this
 * lease is intentionally a distinct connection and only carries named locks.
 */
export async function withBusinessAuthorizationFence<T>(
  key: FenceKey,
  operation: () => Promise<T>,
): Promise<T> {
  assertFenceKey(key);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw fenceError("BUSINESS_AUTHORIZATION_FENCE_DATABASE_UNAVAILABLE");

  const releaseLease = await reserveFenceLease();
  let connection: mysql.Connection | null = null;
  const acquired: string[] = [];
  let operationError: unknown = null;
  try {
    connection = await mysql.createConnection(databaseUrl);
    for (const name of businessAuthorizationFenceNames(key)) {
      await acquireNamedLock(connection, name);
      acquired.push(name);
    }
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let cleanupError: unknown = null;
    if (connection) {
      for (const name of acquired.reverse()) {
        try {
          await releaseNamedLock(connection, name);
        } catch (releaseError) {
          // Do not hide an authorization/command error. If the connection has
          // already failed, MySQL has released its advisory locks as well.
          if (!operationError && !cleanupError) cleanupError = releaseError;
        }
      }
      try {
        await connection.end();
      } catch (closeError) {
        if (!operationError && !cleanupError) cleanupError = closeError;
      }
    }
    releaseLease();
    if (cleanupError) throw cleanupError;
  }
}

export const businessAuthorizationFenceTestUtils = {
  businessAuthorizationFenceNames,
};
