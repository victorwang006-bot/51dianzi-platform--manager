import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import mysql, { type RowDataPacket } from "mysql2/promise";

const LOCK_TIMEOUT_SECONDS = 8;
const MYSQL_CONNECT_TIMEOUT_MS = 8_000;
const MYSQL_QUERY_TIMEOUT_MS = 8_000;
const HK_REGISTRATION_IDENTIFIER = /^HK:\d{8}$/;

export type LedgerStatus = "reserved" | "accepted" | "local-complete";
type LedgerRow = RowDataPacket & {
  registrationIdentifier: string;
  ownerUserId: number | string;
  submissionId: string;
  payloadHash: string;
  status: LedgerStatus;
};

export type HongKongSubmissionInput = {
  userId: number;
  registrationIdentifier: string;
  /** Used only to derive the durable payload hash; it is never persisted or logged here. */
  payload: unknown;
};

/** The two fields which must be forwarded to the remote idempotent endpoint. */
export type HongKongSubmissionRemoteContext = {
  submissionId: string;
  payloadHash: string;
};

/**
 * The remote adapter can mark a confirmed remote acceptance before it writes local fields.
 * This function deliberately closes over ledger keys only: no application payload is exposed.
 */
export type HongKongSubmissionContext = HongKongSubmissionRemoteContext & {
  /** Existing status only for an identical payload replay; null for a newly reserved submission. */
  previousStatus: LedgerStatus | null;
  markRemoteAccepted: () => Promise<void>;
};

function invalidInput(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw invalidInput("香港申请内容格式无效");
      return JSON.stringify(value);
    case "object": {
      if (ancestors.has(value)) throw invalidInput("香港申请内容不能包含循环引用");
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map(item => canonicalJson(item, ancestors)).join(",")}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw invalidInput("香港申请内容格式无效");
        }
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object)
          .sort()
          .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key], ancestors)}`)
          .join(",")}}`;
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw invalidInput("香港申请内容格式无效");
  }
}

function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function normalizeInput(input: HongKongSubmissionInput): {
  userId: number;
  registrationIdentifier: string;
  payloadHash: string;
} {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw invalidInput("申请账号无效");
  }
  const registrationIdentifier = input.registrationIdentifier.trim();
  if (!HK_REGISTRATION_IDENTIFIER.test(registrationIdentifier)) {
    throw invalidInput("香港企业标识必须为 HK: 加 8 位商业登记号码 BRN");
  }
  return { userId: input.userId, registrationIdentifier, payloadHash: payloadHash(input.payload) };
}

/**
 * Named locks belong to a MySQL session, so this deliberately uses a dedicated mysql2
 * connection instead of the Drizzle/getDb pool. Both names remain well below MySQL's
 * 64-character lock-name limit. Sorting makes every contender acquire them in one order.
 */
function lockNames(userId: number, registrationIdentifier: string): string[] {
  const identityDigest = createHash("sha256").update(registrationIdentifier).digest("hex").slice(0, 32);
  return [
    `hk-application-user-${userId}`,
    `hk-application-identity-${identityDigest}`,
  ].sort((left, right) => left.localeCompare(right));
}

async function reserveSubmission(
  connection: Awaited<ReturnType<typeof mysql.createConnection>>,
  input: { userId: number; registrationIdentifier: string; payloadHash: string },
): Promise<{ submissionId: string; payloadHash: string; previousStatus: LedgerStatus | null }> {
  let transactionOpen = false;
  try {
    await connection.beginTransaction();
    transactionOpen = true;
    const [existing] = await connection.execute<LedgerRow[]>(
      { sql: `SELECT registrationIdentifier, ownerUserId, submissionId, payloadHash, status
         FROM hk_submission_ledger
        WHERE registrationIdentifier = ?
        LIMIT 1
        FOR UPDATE`, timeout: MYSQL_QUERY_TIMEOUT_MS },
      [input.registrationIdentifier],
    );
    const row = existing[0];

    if (row && Number(row.ownerUserId) !== input.userId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该香港商业登记号码已由其他账号提交申请",
      });
    }

    let submissionId: string;
    let previousStatus: LedgerStatus | null = null;
    if (row && row.payloadHash === input.payloadHash) {
      submissionId = row.submissionId;
      previousStatus = row.status;
    } else if (row) {
      submissionId = randomUUID();
      await connection.execute(
        { sql: `UPDATE hk_submission_ledger
            SET submissionId = ?, payloadHash = ?, status = 'reserved', updatedAt = CURRENT_TIMESTAMP
          WHERE registrationIdentifier = ? AND ownerUserId = ?`, timeout: MYSQL_QUERY_TIMEOUT_MS },
        [submissionId, input.payloadHash, input.registrationIdentifier, input.userId],
      );
    } else {
      submissionId = randomUUID();
      await connection.execute(
        { sql: `INSERT INTO hk_submission_ledger
          (registrationIdentifier, ownerUserId, submissionId, payloadHash, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'reserved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, timeout: MYSQL_QUERY_TIMEOUT_MS },
        [input.registrationIdentifier, input.userId, submissionId, input.payloadHash],
      );
    }

    await connection.commit();
    transactionOpen = false;
    return { submissionId, payloadHash: input.payloadHash, previousStatus };
  } catch (error) {
    if (transactionOpen) await connection.rollback().catch(() => undefined);
    throw error;
  }
}

async function markRemoteAccepted(
  connection: Awaited<ReturnType<typeof mysql.createConnection>>,
  input: { userId: number; registrationIdentifier: string; submissionId: string; payloadHash: string },
): Promise<void> {
  // Preserve local-complete on a replay; a retry may observe a remote idempotent acceptance.
  await connection.execute(
    { sql: `UPDATE hk_submission_ledger
        SET status = CASE WHEN status = 'local-complete' THEN status ELSE 'accepted' END,
            updatedAt = CURRENT_TIMESTAMP
      WHERE registrationIdentifier = ? AND ownerUserId = ? AND submissionId = ? AND payloadHash = ?`, timeout: MYSQL_QUERY_TIMEOUT_MS },
    [input.registrationIdentifier, input.userId, input.submissionId, input.payloadHash],
  );
}

async function markLocalComplete(
  connection: Awaited<ReturnType<typeof mysql.createConnection>>,
  input: { userId: number; registrationIdentifier: string; submissionId: string; payloadHash: string },
): Promise<void> {
  await connection.execute(
    { sql: `UPDATE hk_submission_ledger
        SET status = 'local-complete', updatedAt = CURRENT_TIMESTAMP
      WHERE registrationIdentifier = ? AND ownerUserId = ? AND submissionId = ? AND payloadHash = ?`, timeout: MYSQL_QUERY_TIMEOUT_MS },
    [input.registrationIdentifier, input.userId, input.submissionId, input.payloadHash],
  );
}

/**
 * Reserve a local, durable HK submission identity before invoking a remote endpoint.
 *
 * A caller should forward `submissionId` and `payloadHash` to its remote idempotency
 * endpoint. Once that endpoint has accepted the request, it may call
 * `context.markRemoteAccepted()` before writing local pending fields. If the callback
 * fails, no completion update occurs: a newly reserved claim remains `reserved` for
 * the next retry and continues to use the same remote submission ID.
 */
export async function withHongKongSubmission<T>(
  input: HongKongSubmissionInput,
  execute: (context: HongKongSubmissionContext) => Promise<T>,
): Promise<T> {
  const normalized = normalizeInput(input);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "企业资料服务暂不可用" });
  }

  // Read DATABASE_URL at call time only. The dedicated connection owns the session locks.
  // mysql2's runtime accepts `uri` while preserving all URL connection options.
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    connectTimeout: MYSQL_CONNECT_TIMEOUT_MS,
  } as unknown as import("mysql2").ConnectionOptions);
  const acquiredLocks: string[] = [];
  const deadline = Date.now() + LOCK_TIMEOUT_SECONDS * 1_000;

  try {
    for (const lockName of lockNames(normalized.userId, normalized.registrationIdentifier)) {
      // Do not round up: both acquisitions together must never wait beyond the
      // one eight-second deadline.
      const remainingSeconds = Math.floor((deadline - Date.now()) / 1_000);
      if (remainingSeconds <= 0) {
        throw new TRPCError({ code: "CONFLICT", message: "香港申请正在处理中，请稍后重试" });
      }
      const [rows] = await connection.query<RowDataPacket[]>(
        { sql: "SELECT GET_LOCK(?, ?) AS acquired", timeout: Math.min(MYSQL_QUERY_TIMEOUT_MS, remainingSeconds * 1_000) },
        [lockName, Math.min(LOCK_TIMEOUT_SECONDS, remainingSeconds)],
      );
      if (Number(rows[0]?.acquired ?? 0) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "香港申请正在处理中，请稍后重试" });
      }
      acquiredLocks.push(lockName);
    }

    const reservation = await reserveSubmission(connection, normalized);
    const context: HongKongSubmissionContext = {
      ...reservation,
      markRemoteAccepted: () => markRemoteAccepted(connection, {
        ...normalized,
        ...reservation,
      }),
    };
    const result = await execute(context);
    await markLocalComplete(connection, { ...normalized, ...reservation });
    return result;
  } finally {
    for (const lockName of acquiredLocks.reverse()) {
      await connection.query(
        { sql: "SELECT RELEASE_LOCK(?)", timeout: MYSQL_QUERY_TIMEOUT_MS },
        [lockName],
      ).catch(() => undefined);
    }
    await connection.end().catch(() => undefined);
  }
}
