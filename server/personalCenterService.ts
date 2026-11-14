import { createHash, randomInt, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQLWrapper } from "drizzle-orm";
import type { AdminUser } from "../drizzle/schema";
import * as db from "./db";
import { hashPassword, verifyPassword } from "./adminAuth";
import { isSmsConfigured, sendSmsCode } from "./sms";
import type { TrpcContext } from "./_core/context";
import {
  businessScopeAllows,
  getBusinessWorkbenchMerchantIds,
  requireBusinessAdminAccount,
} from "./businessAccess";
import { readBusinessPersonalPerformance } from "./businessRouter";
import {
  personalPerformanceResultSchema,
  type PersonalPerformanceResult,
} from "../client/src/business/platform/shared/personalPerformance";

export type PersonalSqlExecutor = {
  execute(query: SQLWrapper): Promise<unknown>;
};
export type PersonalDatabase = PersonalSqlExecutor & {
  transaction<T>(run: (tx: PersonalSqlExecutor) => Promise<T>): Promise<T>;
};
export type PersonalCenterDependencies = {
  database(): Promise<PersonalDatabase | null>;
  verify(plain: string, hash: string): Promise<boolean>;
  hash(plain: string): Promise<string>;
  smsConfigured(): boolean;
  send(phone: string, code: string): Promise<{ ok: boolean }>;
};
const defaults: PersonalCenterDependencies = {
  database: async () => await db.getDb(),
  verify: verifyPassword,
  hash: hashPassword,
  smsConfigured: isSmsConfigured,
  send: sendSmsCode,
};
const AUTH_TARGET = "personal-auth:v1";
const PHONE_PREFIX = "personal-phone:v1:";
const VERIFIED_PREFIX = "personal-phone-verified:v1:";
const rows = <T>(value: unknown): T[] => (value as [T[], unknown])[0];
const affected = (value: unknown) =>
  Number((value as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "账号密码、会话或原绑定已变化，请重新登录后操作",
  });
export function normalizePersonalPhone(value: string) {
  const phone = value.trim().replace(/^(?:\+86|0086)/, "");
  if (!/^1[3-9]\d{9}$/.test(phone))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请输入中国大陆11位手机号",
    });
  return phone;
}
const equivalentPhone = (value: string | null) =>
  value?.trim().replace(/^(?:\+86|0086)/, "") ?? "";
function phoneProof(account: AdminUser, phone: string, ticketId: string) {
  return `${PHONE_PREFIX}${ticketId}:${phone}:${digest(account.phone ?? "")}:${digest(account.passwordHash ?? "")}:${account.sessionVersion}`;
}
function publicProfile(account: AdminUser, verified: boolean) {
  return {
    username: account.username,
    displayName: account.displayName ?? "",
    email: account.email ?? "",
    phone: account.phone ?? "",
    adminRole: account.adminRole,
    phoneBinding: verified
      ? ("verified_by_current_ticket" as const)
      : ("legacy_unverified" as const),
  };
}
export function createPersonalCenterService(
  deps: PersonalCenterDependencies = defaults
) {
  async function database() {
    const database = await deps.database();
    if (!database)
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "账户安全存储暂不可用",
      });
    return database;
  }
  async function current(
    executor: PersonalSqlExecutor,
    session: AdminUser,
    lock = false
  ) {
    const account = rows<AdminUser>(
      await executor.execute(sql`SELECT a.* FROM admin_users a
      WHERE a.id = ${session.id} ${lock ? sql`FOR UPDATE` : sql``}`)
    )[0];
    if (
      !account ||
      account.status !== "active" ||
      account.sessionVersion !== session.sessionVersion
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "登录状态已失效，请重新登录",
      });
    }
    const archived = rows<{ id: number }>(
      await executor.execute(
        sql`SELECT id FROM admin_staff_archives WHERE adminUserId = ${session.id} LIMIT 1`
      )
    );
    if (archived.length)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "登录状态已失效，请重新登录",
      });
    return account;
  }
  /** Persistent account-local password attempt budget. Used rows are intentional:
   * public reset-code invalidation cannot reset this 15-minute security window. */
  async function authenticated(session: AdminUser, plain: string) {
    const database = await thisDatabase();
    const result = await database.transaction(async tx => {
      const account = await current(tx, session, true);
      let guard = rows<{ id: number; attempts: number }>(
        await tx.execute(sql`SELECT id, attempts FROM password_reset_codes
        WHERE adminUserId = ${session.id} AND target = ${AUTH_TARGET}
        AND createdAt >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE) ORDER BY id DESC LIMIT 1 FOR UPDATE`)
      )[0];
      if (!guard) {
        const inserted = await tx.execute(sql`INSERT INTO password_reset_codes
          (adminUserId, channel, target, codeHash, expiresAt, usedAt, attempts)
          VALUES (${session.id}, 'sms', ${AUTH_TARGET}, ${await deps.hash(randomUUID())},
          DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE), CURRENT_TIMESTAMP, 0)`);
        guard = {
          id: Number((inserted as [{ insertId: number }, unknown])[0].insertId),
          attempts: 0,
        };
      }
      if (guard.attempts >= 5) return { error: "LIMIT" as const };
      if (
        !account.passwordHash ||
        !(await deps.verify(plain, account.passwordHash))
      ) {
        await tx.execute(
          sql`UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ${guard.id}`
        );
        return { error: "PASSWORD" as const };
      }
      return { account };
    });
    if ("error" in result)
      throw new TRPCError({
        code: result.error === "LIMIT" ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED",
        message:
          result.error === "LIMIT"
            ? "原密码验证失败过多，请15分钟后重试"
            : "原密码错误",
      });
    return result.account;
  }
  // Separate alias keeps the helper callable without accidental this-binding.
  const thisDatabase = database;
  return {
    async profile(session: AdminUser) {
      const database = await thisDatabase();
      const account = await current(database, session);
      const receipt = rows<{ id: number }>(
        await database.execute(sql`SELECT id FROM password_reset_codes
        WHERE adminUserId = ${session.id} AND target = ${`${VERIFIED_PREFIX}${account.phone ?? ""}:${account.sessionVersion}`}
        AND usedAt IS NOT NULL LIMIT 1`)
      );
      return publicProfile(account, receipt.length > 0);
    },
    async updateProfile(
      session: AdminUser,
      input: { displayName: string; email: string }
    ) {
      const database = await thisDatabase();
      await current(database, session);
      // Existing lifecycle is retained for name -> sales identity projection. No phone/grant is writable here.
      await db.updateAdminUser(session.id, {
        displayName: input.displayName,
        email: input.email.toLowerCase() || null,
        actorAdminUserId: session.id,
      });
      return this.profile(session);
    },
    async changePassword(
      session: AdminUser,
      input: { oldPassword: string; newPassword: string }
    ) {
      const account = await authenticated(session, input.oldPassword);
      if (await deps.verify(input.newPassword, account.passwordHash!))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "新密码不能与当前密码相同",
        });
      const newHash = await deps.hash(input.newPassword);
      const database = await thisDatabase();
      await database.transaction(async tx => {
        const latest = await current(tx, session, true);
        // Credential-only lifecycle transition: no role/status/sales scope rewriting.
        // CAS plus sessionVersion+1 is the same local-JWT revocation primitive as db.updateAdminUser.
        const result =
          await tx.execute(sql`UPDATE admin_users SET passwordHash = ${newHash}, sessionVersion = sessionVersion + 1,
          updatedAt = CURRENT_TIMESTAMP WHERE id = ${account.id} AND status = 'active'
          AND passwordHash = ${account.passwordHash} AND sessionVersion = ${account.sessionVersion}`);
        if (affected(result) !== 1) throw conflict();
        // Carry only the already-consumed proof for the unchanged, current phone/version.
        // Legacy rows and older/revoked receipts never become verified through a password change.
        if (latest.phone === account.phone)
          await tx.execute(sql`UPDATE password_reset_codes
            SET target = ${`${VERIFIED_PREFIX}${account.phone ?? ""}:${account.sessionVersion + 1}`}
            WHERE adminUserId = ${account.id} AND target = ${`${VERIFIED_PREFIX}${account.phone ?? ""}:${account.sessionVersion}`}
            AND usedAt IS NOT NULL`);
      });
      return { success: true as const, requiresRelogin: true as const };
    },
    async requestPhoneCode(
      session: AdminUser,
      input: { oldPassword: string; phone: string }
    ) {
      const phone = normalizePersonalPhone(input.phone);
      const account = await authenticated(session, input.oldPassword);
      if (!deps.smsConfigured())
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "短信服务未配置，暂不能验证绑定手机号",
        });
      const ticketId = randomUUID();
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      // Purpose-bound bcrypt input cannot be consumed by the public password/username recovery routes.
      const codeHash = await deps.hash(`${ticketId}:${code}`);
      const target = phoneProof(account, phone, ticketId);
      const database = await thisDatabase();
      await database.transaction(async tx => {
        const latest = await current(tx, session, true);
        if (
          latest.passwordHash !== account.passwordHash ||
          latest.phone !== account.phone
        )
          throw conflict();
        if (equivalentPhone(latest.phone) === phone) {
          const receipt = rows<{ id: number }>(
            await tx.execute(sql`SELECT id FROM password_reset_codes
              WHERE adminUserId = ${latest.id} AND target = ${`${VERIFIED_PREFIX}${latest.phone ?? ""}:${latest.sessionVersion}`}
              AND usedAt IS NOT NULL LIMIT 1 FOR UPDATE`)
          );
          if (receipt.length)
            throw new TRPCError({ code: "BAD_REQUEST", message: "当前手机号已验证，无需重复绑定" });
        }
        const recent = rows<{ id: number }>(
          await tx.execute(sql`SELECT id FROM password_reset_codes WHERE adminUserId = ${account.id}
          AND (target LIKE ${`${PHONE_PREFIX}%`} OR target LIKE ${`${VERIFIED_PREFIX}%`})
          AND createdAt >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 60 SECOND) LIMIT 1 FOR UPDATE`)
        );
        if (recent.length)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "发送过于频繁，请1分钟后重试",
          });
        const daily = rows<{ total: number }>(
          await tx.execute(sql`SELECT COUNT(*) AS total FROM password_reset_codes WHERE adminUserId = ${account.id}
          AND (target LIKE ${`${PHONE_PREFIX}%`} OR target LIKE ${`${VERIFIED_PREFIX}%`})
          AND createdAt >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)`)
        )[0];
        if (Number(daily?.total ?? 0) >= 10)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "今日手机号验证发送次数已达上限",
          });
        const occupied = rows<{ id: number }>(
          await tx.execute(sql`SELECT id FROM admin_users WHERE id <> ${account.id}
          AND TRIM(phone) IN (${phone}, ${`+86${phone}`}, ${`0086${phone}`}) LIMIT 1`)
        );
        if (occupied.length)
          throw new TRPCError({
            code: "CONFLICT",
            message: "该手机号不可绑定，请使用其他号码",
          });
        await tx.execute(sql`UPDATE password_reset_codes SET usedAt = CURRENT_TIMESTAMP WHERE adminUserId = ${account.id}
          AND target LIKE ${`${PHONE_PREFIX}%`} AND usedAt IS NULL`);
        // Reserve a disabled ticket before network delivery; crashed/failed sends cannot leave a usable code.
        await tx.execute(sql`INSERT INTO password_reset_codes (adminUserId, channel, target, codeHash, expiresAt, usedAt, attempts)
          VALUES (${account.id}, 'sms', ${target}, ${codeHash}, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE), CURRENT_TIMESTAMP, 0)`);
      });
      let sent = false;
      try {
        sent = (await deps.send(phone, code)).ok;
      } catch {
        /* Provider detail must not cross this boundary. */
      }
      if (!sent)
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "验证码发送失败，请稍后重试",
        });
      await database.transaction(async tx => {
        const latest = await current(tx, session, true);
        if (
          latest.phone !== account.phone ||
          latest.passwordHash !== account.passwordHash
        )
          throw conflict();
        // A slower earlier send cannot reactivate a ticket superseded by a newer request.
        const latestTicket = rows<{ target: string }>(
          await tx.execute(sql`SELECT target FROM password_reset_codes WHERE adminUserId = ${account.id}
          AND (target LIKE ${`${PHONE_PREFIX}%`} OR target LIKE ${`${VERIFIED_PREFIX}%`}) ORDER BY id DESC LIMIT 1 FOR UPDATE`)
        )[0];
        if (latestTicket?.target !== target) throw conflict();
        const activated =
          await tx.execute(sql`UPDATE password_reset_codes SET usedAt = NULL WHERE adminUserId = ${account.id}
          AND target = ${target} AND expiresAt > CURRENT_TIMESTAMP AND attempts = 0`);
        if (affected(activated) !== 1)
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "验证码发送超时，请重新获取",
          });
      });
      return {
        success: true as const,
        ticketId,
        maskedPhone: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
        expiresInSeconds: 300,
        retryAfterSeconds: 60,
      };
    },
    async bindPhone(
      session: AdminUser,
      input: {
        oldPassword: string;
        phone: string;
        ticketId: string;
        code: string;
      }
    ) {
      const phone = normalizePersonalPhone(input.phone);
      const account = await authenticated(session, input.oldPassword);
      const target = phoneProof(account, phone, input.ticketId);
      const database = await thisDatabase();
      const outcome = await database.transaction(async tx => {
        // No unique phone index exists. Lock the account set in lifecycle-compatible order,
        // then all remaining rows: two simultaneous binds cannot both pass conflict checks.
        // No other account fields escape this service; no schema migration is required.
        await tx.execute(
          sql`SELECT id FROM admin_users WHERE adminRole = 'super_admin' AND status = 'active' ORDER BY id FOR UPDATE`
        );
        const accounts = rows<{ id: number; phone: string | null }>(
          await tx.execute(
            sql`SELECT id, phone FROM admin_users ORDER BY id FOR UPDATE`
          )
        );
        const latest = await current(tx, session);
        if (
          latest.passwordHash !== account.passwordHash ||
          latest.phone !== account.phone
        )
          throw conflict();
        const ticket = rows<{
          id: number;
          codeHash: string;
          attempts: number;
          valid: number;
        }>(
          await tx.execute(sql`SELECT id, codeHash, attempts,
          (expiresAt > CURRENT_TIMESTAMP) AS valid FROM password_reset_codes WHERE adminUserId = ${account.id}
          AND target = ${target} AND channel = 'sms' AND usedAt IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`)
        )[0];
        if (!ticket || Number(ticket.valid) !== 1) return "INVALID" as const;
        if (ticket.attempts >= 5) return "LIMIT" as const;
        if (
          !(await deps.verify(
            `${input.ticketId}:${input.code}`,
            ticket.codeHash
          ))
        ) {
          await tx.execute(
            sql`UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ${ticket.id} AND usedAt IS NULL`
          );
          return ticket.attempts + 1 >= 5
            ? ("LIMIT" as const)
            : ("INVALID" as const);
        }
        if (
          accounts.some(
            other =>
              Number(other.id) !== account.id &&
              equivalentPhone(other.phone) === phone
          )
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "该手机号不可绑定，请使用其他号码",
          });
        }
        const changed =
          await tx.execute(sql`UPDATE admin_users SET phone = ${phone}, sessionVersion = sessionVersion + 1,
          updatedAt = CURRENT_TIMESTAMP WHERE id = ${account.id} AND status = 'active' AND passwordHash = ${account.passwordHash}
          AND sessionVersion = ${account.sessionVersion} AND phone <=> ${account.phone}`);
        if (affected(changed) !== 1) throw conflict();
        const consumed =
          await tx.execute(sql`UPDATE password_reset_codes SET usedAt = CURRENT_TIMESTAMP,
          target = ${`${VERIFIED_PREFIX}${phone}:${account.sessionVersion + 1}`} WHERE id = ${ticket.id} AND usedAt IS NULL AND attempts = ${ticket.attempts}`);
        if (affected(consumed) !== 1) throw conflict();
        return "OK" as const;
      });
      if (outcome !== "OK")
        throw new TRPCError({
          code: outcome === "LIMIT" ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
          message:
            outcome === "LIMIT"
              ? "验证码尝试次数已达上限，请重新获取"
              : "验证码错误或已失效，请重新获取",
        });
      return { success: true as const, phone, requiresRelogin: true as const };
    },
  };
}
export const personalCenterService = createPersonalCenterService();

export async function getPersonalPerformance(
  ctx: TrpcContext,
  input: {
    month: string;
    merchantId?: number;
    page?: number;
    pageSize?: number;
  }
): Promise<PersonalPerformanceResult> {
  const account = requireBusinessAdminAccount(ctx);
  const unavailable = (reason: string): PersonalPerformanceResult => ({
    status: "unavailable",
    month: input.month,
    currency: "CNY",
    currencyLabel: "人民币（含税）",
    timezone: "Asia/Shanghai",
    reason,
  });
  try {
    if (!(await db.getActiveBusinessStaffBinding(account.id)))
      return unavailable("尚未绑定有效的业务员工主体，无法读取本人业绩");
    const allowed = getBusinessWorkbenchMerchantIds();
    const scopes = (
      await db.listActiveBusinessMerchantScopes(account.id)
    ).filter(
      scope =>
        allowed.includes(scope.merchantId) &&
        businessScopeAllows(scope, "orders", "read") &&
        businessScopeAllows(scope, "customers", "read")
    );
    const merchantId =
      input.merchantId ??
      (scopes.length === 1 ? scopes[0].merchantId : undefined);
    if (!merchantId || !scopes.some(scope => scope.merchantId === merchantId))
      return unavailable("未获本人业务业绩读取范围，或需要选择已授权的商户");
    const result = await readBusinessPersonalPerformance(ctx, merchantId, {
      month: input.month,
      page: input.page,
      pageSize: input.pageSize,
    });
    const parsed = personalPerformanceResultSchema.safeParse(result);
    if (!parsed.success || parsed.data.month !== input.month)
      return unavailable("业绩来源返回口径无法核实，暂不可用");
    if (
      parsed.data.status === "available" &&
      (parsed.data.page !== (input.page ?? 1) ||
        parsed.data.pageSize !== (input.pageSize ?? 10) ||
        parsed.data.total !== parsed.data.orderCount ||
        parsed.data.items.length > parsed.data.pageSize)
    )
      return unavailable("业绩分页返回范围无法核实，暂不可用");
    return parsed.data;
  } catch {
    return unavailable(
      "本人业务业绩暂不可用，请确认当前业务绑定、销售权限及服务配置"
    );
  }
}
