import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

export type RateLimitStore = {
  increment(key: string, windowMs: number, now?: number, amount?: number): Promise<number>;
  reset?(): Promise<void> | void;
};

/** A dependency failure that permits the documented bounded local fallback. */
export class RateLimitStoreUnavailableError extends Error {
  constructor(message = "shared rate-limit store unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "RateLimitStoreUnavailableError";
  }
}

const TRANSIENT_MYSQL_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_CON_COUNT_ERROR",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_SERVER_SHUTDOWN",
  "ER_TOO_MANY_USER_CONNECTIONS",
]);

/** Only operational connectivity/capacity failures may use the local fallback. */
export function isTransientRateLimitDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; fatal?: unknown };
  if (typeof candidate.code === "string" && TRANSIENT_MYSQL_CODES.has(candidate.code)) return true;
  if (candidate.fatal === true) return true;
  return typeof candidate.message === "string" && /queue limit reached|pool is closed/i.test(candidate.message);
}

type Bucket = { count: number; expiresAt: number };

/**
 * Bounded fixed-window storage used in development, tests, and as the narrow
 * production outage fallback. A full map must never become an attacker-owned
 * memory allocation: new keys are denied until expired entries can be pruned.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private nextPruneAt = 0;

  constructor(private readonly maxBuckets = 10_000) {}

  async increment(key: string, windowMs: number, now = Date.now(), amount = 1): Promise<number> {
    if (!key || !Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new RangeError("invalid rate-limit key, window, or amount");
    }
    const existing = this.buckets.get(key);
    if (existing) {
      if (now >= existing.expiresAt) {
        this.buckets.set(key, { count: amount, expiresAt: now + windowMs });
        return amount;
      }
      existing.count += amount;
      return existing.count;
    }

    this.pruneExpired(now);
    if (this.buckets.size >= this.maxBuckets) {
      // The caller treats this as exceeded, protecting availability without
      // allocating one permanent bucket per spoofed source address.
      return Number.MAX_SAFE_INTEGER;
    }
    this.buckets.set(key, { count: amount, expiresAt: now + windowMs });
    return amount;
  }

  private pruneExpired(now: number): void {
    if (now < this.nextPruneAt && this.buckets.size < this.maxBuckets) return;
    this.buckets.forEach((bucket, key) => {
      if (now >= bucket.expiresAt) this.buckets.delete(key);
    });
    this.nextPruneAt = now + 30_000;
  }

  reset(): void {
    this.buckets.clear();
    this.nextPruneAt = 0;
  }
}

/**
 * Uses the existing production MySQL service, so all PM2 cluster workers share
 * the normal limiter state without adding a separate cache deployment.
 */
export class MySqlRateLimitStore implements RateLimitStore {
  private pool: Pool | null = null;
  private lastCleanupAt = 0;

  constructor(private readonly databaseUrl: string) {}

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        uri: this.databaseUrl,
        connectionLimit: 4,
        connectTimeout: 2_000,
        enableKeepAlive: true,
        waitForConnections: true,
        // Bound requests waiting for a failed/saturated database. Once full,
        // callers immediately enter the bounded local fallback instead of
        // accumulating unbounded promises in every PM2 process.
        queueLimit: 100,
      });
    }
    return this.pool;
  }

  async increment(key: string, windowMs: number, now = Date.now(), amount = 1): Promise<number> {
    if (!key || key.length > 191 || !Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new RangeError("invalid rate-limit key, window, or amount");
    }
    const cutoff = now - windowMs;
    try {
      const pool = this.getPool();
      // LAST_INSERT_ID(expr) is connection-scoped. Running the upsert and read
      // on one leased connection yields this increment's exact atomic result,
      // without a later concurrent hit causing premature rejection.
      const connection = await pool.getConnection();
      let count: number;
      try {
        await connection.execute(
          {
            sql: `INSERT INTO api_rate_limit_buckets (bucketKey, windowStartMs, hitCount)
                  VALUES (?, ?, LAST_INSERT_ID(?))
                  ON DUPLICATE KEY UPDATE
                    hitCount = LAST_INSERT_ID(IF(windowStartMs <= ?, VALUES(hitCount), hitCount + VALUES(hitCount))),
                    windowStartMs = IF(windowStartMs <= ?, VALUES(windowStartMs), windowStartMs)`,
            timeout: 2_000,
          },
          [key, now, amount, cutoff, cutoff],
        );
        const [rows] = await connection.query<Array<RowDataPacket & { hitCount: number | string }>>({
          sql: "SELECT LAST_INSERT_ID() AS hitCount",
          timeout: 2_000,
        });
        count = Number(rows[0]?.hitCount);
      } finally {
        connection.release();
      }
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new RateLimitStoreUnavailableError("shared rate-limit result invalid");
      }
      this.cleanupExpiredBuckets(now);
      return count;
    } catch (error) {
      if (error instanceof RateLimitStoreUnavailableError) throw error;
      if (isTransientRateLimitDbError(error)) {
        throw new RateLimitStoreUnavailableError("shared rate-limit query failed", { cause: error });
      }
      throw error;
    }
  }

  private cleanupExpiredBuckets(now: number): void {
    if (now - this.lastCleanupAt < 5 * 60 * 1000) return;
    this.lastCleanupAt = now;
    // Best effort only. The index in the migration keeps this bounded cleanup
    // cheap, and an outage here must not turn a successful increment into one.
    void this.getPool()
      .execute("DELETE FROM api_rate_limit_buckets WHERE updatedAt < NOW() - INTERVAL 2 DAY LIMIT 1000")
      .catch(() => undefined);
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end();
  }
}

class UnavailableRateLimitStore implements RateLimitStore {
  constructor(private readonly reason: string) {}

  async increment(): Promise<number> {
    throw new RateLimitStoreUnavailableError(this.reason);
  }
}

/**
 * Availability degradation is explicit: MySQL remains authoritative while it
 * works; a temporary failure uses only a bounded per-worker limit. Nginx adds
 * a shared emergency edge cap, so this avoids a site-wide 503 while retaining
 * abuse resistance rather than failing fully open.
 */
export class ResilientRateLimitStore implements RateLimitStore {
  private lastFallbackLogAt: number | null = null;

  constructor(
    private readonly shared: RateLimitStore,
    private readonly fallback: RateLimitStore,
    private readonly warn: (message: string) => void = message => console.warn(message),
  ) {}

  async increment(key: string, windowMs: number, now = Date.now(), amount = 1): Promise<number> {
    try {
      return await this.shared.increment(key, windowMs, now, amount);
    } catch (error) {
      if (!(error instanceof RateLimitStoreUnavailableError)) throw error;
      if (this.lastFallbackLogAt === null || now - this.lastFallbackLogAt >= 60_000) {
        this.lastFallbackLogAt = now;
        this.warn("[rate-limit] shared MySQL unavailable; using bounded local fallback with Nginx emergency cap");
      }
      return this.fallback.increment(key, windowMs, now, amount);
    }
  }

  async reset(): Promise<void> {
    await this.shared.reset?.();
    await this.fallback.reset?.();
  }
}

let strictSharedStore: RateLimitStore;

function defaultRateLimitStore(): RateLimitStore {
  if (process.env.NODE_ENV === "production") {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    const shared = databaseUrl
      ? new MySqlRateLimitStore(databaseUrl)
      : new UnavailableRateLimitStore("DATABASE_URL is required for production rate limiting");
    strictSharedStore = shared;
    return new ResilientRateLimitStore(shared, new InMemoryRateLimitStore());
  }
  strictSharedStore = new InMemoryRateLimitStore();
  return strictSharedStore;
}

let activeStore: RateLimitStore = defaultRateLimitStore();

export function getRateLimitStore(): RateLimitStore {
  return activeStore;
}

/** Exact commercial reads must fail closed rather than use a per-worker fallback. */
export function getStrictSharedRateLimitStore(): RateLimitStore {
  return strictSharedStore;
}

/** Test-only dependency injection; call __resetRateLimitStoreForTests afterwards. */
export function __setRateLimitStoreForTests(store: RateLimitStore): void {
  activeStore = store;
}

export function __setStrictSharedRateLimitStoreForTests(store: RateLimitStore): void {
  strictSharedStore = store;
}

export function __resetRateLimitStoreForTests(): void {
  activeStore = defaultRateLimitStore();
}
