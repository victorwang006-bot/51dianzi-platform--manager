import {
  createHmac as emailChangeCreateHmac,
  randomBytes as emailChangeRandomBytes,
  timingSafeEqual as emailChangeTimingSafeEqual,
} from "node:crypto";
import {
  and as emailChangeAnd,
  eq as emailChangeEq,
  ne as emailChangeNe,
  sql as emailChangeSql,
} from "drizzle-orm";
import {
  accountSecurityEvents,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { verifyPassword } from "../password";
import {
  consumeSecurityCode,
  issueSecurityCode,
  maskTarget,
  type ResetChannel,
  type SecurityAuditContext,
  type SecurityCodePurpose,
} from "../passwordReset";

const EMAIL_CHANGE_TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_CURRENT_PASSWORD_FAILURES = 5;

export type EmailChangeIdentityChannel = "email" | "phone" | null;
export type EmailChangeMethod = "emailCode" | "currentPassword" | "phoneCode";

export type EmailChangeStatus = {
  hasPassword: boolean;
  hasVerifiedEmail: boolean;
  identityChannel: EmailChangeIdentityChannel;
  maskedIdentityTarget: string | null;
};

type EmailChangeAccount = {
  id: number;
  email: string | null;
  pendingEmail: string | null;
  emailVerifiedAt: Date | null;
  phone: string | null;
  passwordHash: string | null;
  sessionVersion: number;
  loginDisabled: boolean;
};

type EmailChangeAuditEvent = {
  userId: number;
  eventType: string;
  channel?: ResetChannel;
  audit?: SecurityAuditContext;
  success?: boolean;
};

/**
 * Narrow transaction surface deliberately kept separate from Drizzle. It lets the
 * behavioral tests exercise the same state machine with an in-memory VM/mock store,
 * while production still uses row locks and MySQL unique constraints below.
 */
export type EmailChangeTransaction = {
  /** 原始 Drizzle transaction；验证码消费必须在此同一事务内锁行和写失败次数。 */
  rawSecurityCodeTransaction?: unknown;
  lockAccount(userId: number): Promise<EmailChangeAccount | null>;
  findOtherEmailOwnerForUpdate(email: string, userId: number): Promise<{ id: number } | null>;
  setPendingEmail(userId: number, email: string): Promise<void>;
  promoteEmail(userId: number, email: string): Promise<void>;
  countRecentEvents(userId: number, eventType: string): Promise<number>;
  recordEvent(event: EmailChangeAuditEvent): Promise<void>;
};

export type EmailChangeStore = {
  getAccount(userId: number): Promise<EmailChangeAccount | null>;
  transaction<T>(callback: (tx: EmailChangeTransaction) => Promise<T>): Promise<T>;
};

type CodeIssuer = (
  userId: number,
  purpose: SecurityCodePurpose,
  channel: ResetChannel,
  audit?: SecurityAuditContext,
  options?: { expectedTarget?: string },
) => Promise<{ maskedTarget: string; expiresInSeconds: number; devCode?: string }>;

type CodeConsumer = (
  tx: unknown,
  input: {
    userId: number;
    purpose: SecurityCodePurpose;
    channel: ResetChannel;
    target: string;
    code: string;
  },
) => Promise<boolean>;

export type EmailChangeDependencies = {
  store: EmailChangeStore;
  issueCode: CodeIssuer;
  consumeCode: CodeConsumer;
  verifyCurrentPassword: (password: string, passwordHash: string) => boolean;
};

type EmailChangeTicketPayload = {
  version: 1;
  use: "email-change";
  userId: number;
  sessionVersion: number;
  oldVerifiedEmail: string | null;
  /** HMAC(旧可信邮箱 + emailVerifiedAt)，同地址重新验证也会使旧票据失效。 */
  oldVerifiedAtState: string | null;
  hadPassword: boolean;
  /** HMAC(passwordHash)；不把密码散列本身暴露给可读的签名票据。 */
  passwordState: string;
  pendingEmail: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function ticketSecret(): string {
  const configured = process.env.JWT_SECRET || process.env.COOKIE_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境缺少邮箱换绑票据签名密钥");
  }
  return "email-change-ticket-dev-secret";
}

function emailChangeSign(encodedPayload: string): string {
  return emailChangeCreateHmac("sha256", ticketSecret()).update(encodedPayload).digest("base64url");
}

function emailChangeNormalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() || "";
  return normalized || null;
}

function isPhone(value: string | null | undefined): value is string {
  return Boolean(value && /^1[3-9]\d{9}$/.test(value));
}

function verifiedEmail(account: EmailChangeAccount): string | null {
  return account.emailVerifiedAt ? emailChangeNormalizeEmail(account.email) : null;
}

function passwordState(account: EmailChangeAccount): string {
  return emailChangeCreateHmac("sha256", ticketSecret())
    .update(account.passwordHash || "no-current-password")
    .digest("base64url");
}

function oldVerifiedAtState(account: EmailChangeAccount): string | null {
  const oldEmail = verifiedEmail(account);
  if (!oldEmail || !account.emailVerifiedAt) return null;
  return emailChangeCreateHmac("sha256", ticketSecret())
    .update(`${oldEmail}\u0000${account.emailVerifiedAt.getTime()}`)
    .digest("base64url");
}

function statusForAccount(account: EmailChangeAccount): EmailChangeStatus {
  const oldVerifiedEmail = verifiedEmail(account);
  if (oldVerifiedEmail) {
    return {
      hasPassword: Boolean(account.passwordHash),
      hasVerifiedEmail: true,
      identityChannel: "email",
      maskedIdentityTarget: maskTarget(oldVerifiedEmail, "email"),
    };
  }
  if (account.passwordHash) {
    return {
      hasPassword: true,
      hasVerifiedEmail: false,
      identityChannel: null,
      maskedIdentityTarget: null,
    };
  }
  if (isPhone(account.phone)) {
    return {
      hasPassword: false,
      hasVerifiedEmail: false,
      identityChannel: "phone",
      maskedIdentityTarget: maskTarget(account.phone, "phone"),
    };
  }
  return {
    hasPassword: false,
    hasVerifiedEmail: false,
    identityChannel: null,
    maskedIdentityTarget: null,
  };
}

function assertEligible(account: EmailChangeAccount): void {
  // protectedProcedure already authenticates the primary account. Re-checking the
  // locked row prevents an already-suspended account from finishing a started flow.
  if (account.loginDisabled) throw new Error("账号已被暂停使用，请联系客服");
}

function assertTicketMatches(
  payload: EmailChangeTicketPayload,
  account: EmailChangeAccount,
  userId: number,
  pendingEmail: string,
): void {
  if (
    payload.userId !== userId
    || payload.sessionVersion !== account.sessionVersion
    || payload.oldVerifiedEmail !== verifiedEmail(account)
    || payload.oldVerifiedAtState !== oldVerifiedAtState(account)
    || payload.hadPassword !== Boolean(account.passwordHash)
    || payload.passwordState !== passwordState(account)
    || payload.pendingEmail !== pendingEmail
    || emailChangeNormalizeEmail(account.pendingEmail) !== pendingEmail
  ) {
    throw new Error("邮箱换绑验证已失效，请重新开始");
  }
}

function createTicket(account: EmailChangeAccount, pendingEmail: string): string {
  const payload: EmailChangeTicketPayload = {
    version: 1,
    use: "email-change",
    userId: account.id,
    sessionVersion: account.sessionVersion,
    oldVerifiedEmail: verifiedEmail(account),
    oldVerifiedAtState: oldVerifiedAtState(account),
    hadPassword: Boolean(account.passwordHash),
    passwordState: passwordState(account),
    pendingEmail,
    issuedAt: Date.now(),
    expiresAt: Date.now() + EMAIL_CHANGE_TICKET_TTL_MS,
    nonce: emailChangeRandomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${emailChangeSign(encoded)}`;
}

/** Verifies signature and syntax only; account/session/pending state is checked under a row lock. */
export function verifyEmailChangeTicket(ticket: string): EmailChangeTicketPayload {
  const [encoded, suppliedSignature, extra] = ticket.split(".");
  if (!encoded || !suppliedSignature || extra) {
    throw new Error("邮箱换绑验证已失效，请重新开始");
  }
  const expectedSignature = emailChangeSign(encoded);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !emailChangeTimingSafeEqual(supplied, expected)) {
    throw new Error("邮箱换绑验证已失效，请重新开始");
  }

  let payload: EmailChangeTicketPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("邮箱换绑验证已失效，请重新开始");
  }
  if (
    payload.version !== 1
    || payload.use !== "email-change"
    || !Number.isSafeInteger(payload.userId)
    || payload.userId <= 0
    || !Number.isSafeInteger(payload.sessionVersion)
    || payload.sessionVersion < 0
    || (payload.oldVerifiedAtState !== null && (
      typeof payload.oldVerifiedAtState !== "string" || payload.oldVerifiedAtState.length < 32
    ))
    || typeof payload.hadPassword !== "boolean"
    || typeof payload.passwordState !== "string"
    || payload.passwordState.length < 32
    || typeof payload.issuedAt !== "number"
    || !Number.isFinite(payload.issuedAt)
    || typeof payload.expiresAt !== "number"
    || !Number.isFinite(payload.expiresAt)
    || payload.expiresAt <= Date.now()
    || payload.expiresAt - payload.issuedAt > EMAIL_CHANGE_TICKET_TTL_MS + 1_000
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.pendingEmail)
    || (payload.oldVerifiedEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.oldVerifiedEmail))
    || typeof payload.nonce !== "string"
    || payload.nonce.length < 16
  ) {
    throw new Error("邮箱换绑验证已失效，请重新开始");
  }
  return {
    ...payload,
    pendingEmail: payload.pendingEmail.trim().toLowerCase(),
    oldVerifiedEmail: emailChangeNormalizeEmail(payload.oldVerifiedEmail),
  };
}

function allowedMethod(account: EmailChangeAccount, method: EmailChangeMethod): boolean {
  const status = statusForAccount(account);
  if (status.hasVerifiedEmail) {
    return method === "emailCode" || (method === "currentPassword" && status.hasPassword);
  }
  if (status.hasPassword) return method === "currentPassword";
  return status.identityChannel === "phone" && method === "phoneCode";
}

function identityChannelForMethod(method: EmailChangeMethod): ResetChannel {
  return method === "currentPassword" ? "email" : method === "emailCode" ? "email" : "phone";
}

function methodUnavailableMessage(account: EmailChangeAccount): string {
  const status = statusForAccount(account);
  if (status.hasVerifiedEmail) return "请使用已验证旧邮箱验证码或当前登录密码完成身份验证";
  if (status.hasPassword) return "首次设置邮箱请使用当前登录密码完成身份验证";
  if (status.identityChannel === "phone") return "请使用当前绑定手机号验证码完成身份验证";
  return "当前账号没有可用的邮箱换绑身份验证方式，请联系客服";
}

export function createDrizzleEmailChangeStore(
  resolveDatabase: () => Promise<any> = getDb,
): EmailChangeStore {
  return {
    async getAccount(userId) {
      const db = await resolveDatabase();
      if (!db) throw new Error("数据库不可用");
      const rows = await db.select().from(users).where(emailChangeEq(users.id, userId)).limit(1);
      return rows[0] || null;
    },
    async transaction(callback) {
      const db = await resolveDatabase();
      if (!db) throw new Error("数据库不可用");
      return db.transaction(async (dbTransaction: any) => {
        const tx: EmailChangeTransaction = {
          rawSecurityCodeTransaction: dbTransaction,
          async lockAccount(userId) {
            const rows = await dbTransaction
              .select()
              .from(users)
              .where(emailChangeEq(users.id, userId))
              .limit(1)
              .for("update");
            return rows[0] || null;
          },
          async findOtherEmailOwnerForUpdate(email, userId) {
            const rows = await dbTransaction
              .select({ id: users.id })
              .from(users)
              .where(emailChangeAnd(emailChangeEq(users.email, email), emailChangeNe(users.id, userId)))
              .limit(1)
              .for("update");
            return rows[0] || null;
          },
          async setPendingEmail(userId, email) {
            await dbTransaction
              .update(users)
              .set({ pendingEmail: email })
              .where(emailChangeEq(users.id, userId));
          },
          async promoteEmail(userId, email) {
            await dbTransaction
              .update(users)
              .set({
                email,
                pendingEmail: null,
                emailVerifiedAt: emailChangeSql`NOW()` as any,
              })
              .where(emailChangeEq(users.id, userId));
          },
          async countRecentEvents(userId, eventType) {
            const rows = await dbTransaction
              .select({ total: emailChangeSql<number>`COUNT(*)` })
              .from(accountSecurityEvents)
              .where(emailChangeAnd(
                emailChangeEq(accountSecurityEvents.userId, userId),
                emailChangeEq(accountSecurityEvents.eventType, eventType),
                emailChangeSql`${accountSecurityEvents.createdAt} >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
              ));
            return Number(rows[0]?.total || 0);
          },
          async recordEvent(event) {
            await dbTransaction.insert(accountSecurityEvents).values({
              userId: event.userId,
              eventType: event.eventType,
              channel: event.channel ?? null,
              clientType: event.audit?.clientType ?? "unknown",
              ipHash: event.audit?.ipHash ?? null,
              userAgent: event.audit?.userAgent ?? null,
              success: event.success ?? true,
            });
          },
        };
        return callback(tx);
      });
    },
  };
}

/** 将包装器还原为同一条 Drizzle transaction，禁止把验证码消费移到事务外。 */
export async function consumeEmailChangeSecurityCode(
  transaction: unknown,
  input: {
    userId: number;
    purpose: SecurityCodePurpose;
    channel: ResetChannel;
    target: string;
    code: string;
  },
  consumer: CodeConsumer = consumeSecurityCode as CodeConsumer,
): Promise<boolean> {
  const rawTransaction = (transaction as EmailChangeTransaction | null)?.rawSecurityCodeTransaction;
  if (!rawTransaction || typeof (rawTransaction as { select?: unknown }).select !== "function") {
    throw new Error("邮箱换绑验证码事务不可用");
  }
  return consumer(rawTransaction, input);
}

const productionDependencies: EmailChangeDependencies = {
  store: createDrizzleEmailChangeStore(),
  issueCode: issueSecurityCode,
  consumeCode: consumeEmailChangeSecurityCode,
  verifyCurrentPassword: verifyPassword,
};

export function createEmailChangeService(dependencies: EmailChangeDependencies) {
  async function getStatus(userId: number): Promise<EmailChangeStatus> {
    const account = await dependencies.store.getAccount(userId);
    if (!account) throw new Error("用户不存在");
    assertEligible(account);
    return statusForAccount(account);
  }

  async function sendIdentityCode(userId: number, audit?: SecurityAuditContext) {
    const status = await getStatus(userId);
    if (!status.identityChannel) {
      throw new Error(status.hasPassword
        ? "请使用当前登录密码完成身份验证"
        : "当前账号没有可用的邮箱换绑身份验证方式，请联系客服");
    }
    const issued = await dependencies.issueCode(
      userId,
      "emailChangeIdentity",
      status.identityChannel,
      audit,
    );
    return { ...issued, identityChannel: status.identityChannel };
  }

  async function start(
    input: {
      userId: number;
      email: string;
      method: EmailChangeMethod;
      code?: string;
      currentPassword?: string;
      audit?: SecurityAuditContext;
    },
  ) {
    const target = emailChangeNormalizeEmail(input.email);
    if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      throw new Error("请输入有效的邮箱地址");
    }

    const staged = await dependencies.store.transaction(async tx => {
      const account = await tx.lockAccount(input.userId);
      if (!account) throw new Error("用户不存在");
      assertEligible(account);
      if (!allowedMethod(account, input.method)) throw new Error(methodUnavailableMessage(account));
      if (emailChangeNormalizeEmail(account.email) === target) throw new Error("新邮箱不能与当前邮箱相同");
      if (await tx.findOtherEmailOwnerForUpdate(target, input.userId)) {
        throw new Error("该邮箱已绑定其他账号");
      }

      if (input.method === "currentPassword") {
        const failures = await tx.countRecentEvents(input.userId, "email_change_failed_current");
        if (failures >= MAX_CURRENT_PASSWORD_FAILURES) {
          throw new Error("当前密码验证失败次数过多，请稍后再试或使用旧邮箱验证码");
        }
        if (!account.passwordHash || !input.currentPassword || !dependencies.verifyCurrentPassword(input.currentPassword, account.passwordHash)) {
          await tx.recordEvent({
            userId: input.userId,
            eventType: "email_change_failed_current",
            audit: input.audit,
            success: false,
          });
          return { ok: false as const, reason: "password" as const };
        }
      } else {
        const channel = identityChannelForMethod(input.method);
        const identityTarget = channel === "email" ? verifiedEmail(account) : account.phone;
        if (!identityTarget || !input.code) throw new Error(methodUnavailableMessage(account));
        const verified = await dependencies.consumeCode(tx, {
          userId: input.userId,
          purpose: "emailChangeIdentity",
          channel,
          target: identityTarget,
          code: input.code,
        });
        if (!verified) {
          await tx.recordEvent({
            userId: input.userId,
            eventType: "email_change_failed_code",
            channel,
            audit: input.audit,
            success: false,
          });
          return { ok: false as const, reason: "code" as const };
        }
      }

      await tx.setPendingEmail(input.userId, target);
      return { ok: true as const, account: { ...account, pendingEmail: target } };
    });

    if (!staged.ok) {
      throw new Error(staged.reason === "password" ? "当前密码不正确" : "验证码错误或已失效，请重新获取");
    }

    // This deliberately happens after the identity transaction. A delivery failure
    // leaves only an untrusted pendingEmail and never upgrades users.email.
    const issued = await dependencies.issueCode(
      input.userId,
      "verifyEmail",
      "email",
      input.audit,
      { expectedTarget: target },
    );
    return {
      success: true as const,
      maskedTarget: issued.maskedTarget,
      expiresInSeconds: issued.expiresInSeconds,
      devCode: issued.devCode,
      emailChangeTicket: createTicket(staged.account, target),
    };
  }

  async function resend(
    input: { userId: number; email: string; emailChangeTicket: string; audit?: SecurityAuditContext },
  ) {
    const target = emailChangeNormalizeEmail(input.email);
    if (!target) throw new Error("邮箱换绑验证已失效，请重新开始");
    const ticket = verifyEmailChangeTicket(input.emailChangeTicket);
    await dependencies.store.transaction(async tx => {
      const account = await tx.lockAccount(input.userId);
      if (!account) throw new Error("用户不存在");
      assertEligible(account);
      assertTicketMatches(ticket, account, input.userId, target);
    });
    const issued = await dependencies.issueCode(
      input.userId,
      "verifyEmail",
      "email",
      input.audit,
      { expectedTarget: target },
    );
    return {
      success: true as const,
      maskedTarget: issued.maskedTarget,
      expiresInSeconds: issued.expiresInSeconds,
      devCode: issued.devCode,
    };
  }

  async function confirm(
    input: {
      userId: number;
      email: string;
      code: string;
      emailChangeTicket: string;
      audit?: SecurityAuditContext;
    },
  ) {
    const target = emailChangeNormalizeEmail(input.email);
    if (!target) throw new Error("邮箱换绑验证已失效，请重新开始");
    const ticket = verifyEmailChangeTicket(input.emailChangeTicket);
    const result = await dependencies.store.transaction(async tx => {
      const account = await tx.lockAccount(input.userId);
      if (!account) throw new Error("用户不存在");
      assertEligible(account);
      assertTicketMatches(ticket, account, input.userId, target);
      const verified = await dependencies.consumeCode(tx, {
        userId: input.userId,
        purpose: "verifyEmail",
        channel: "email",
        target,
        code: input.code,
      });
      if (!verified) {
        await tx.recordEvent({
          userId: input.userId,
          eventType: "email_change_failed_target_code",
          channel: "email",
          audit: input.audit,
          success: false,
        });
        return { ok: false as const };
      }
      if (await tx.findOtherEmailOwnerForUpdate(target, input.userId)) {
        throw new Error("该邮箱已绑定其他账号");
      }
      await tx.promoteEmail(input.userId, target);
      await tx.recordEvent({
        userId: input.userId,
        eventType: "email_changed",
        channel: "email",
        audit: input.audit,
      });
      return { ok: true as const };
    });
    if (!result.ok) throw new Error("验证码错误或已失效，请重新获取");
    return { success: true as const, email: maskTarget(target, "email"), verified: true as const };
  }

  return { getStatus, sendIdentityCode, start, resend, confirm };
}

const productionService = createEmailChangeService(productionDependencies);

export const getEmailChangeStatus = productionService.getStatus;
export const sendEmailChangeIdentityCode = productionService.sendIdentityCode;
export const startEmailChange = productionService.start;
export const resendEmailChangeCode = productionService.resend;
export const confirmEmailChange = productionService.confirm;
export const EMAIL_CHANGE_TICKET_TTL_SECONDS = EMAIL_CHANGE_TICKET_TTL_MS / 1000;
