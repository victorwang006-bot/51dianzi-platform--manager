import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQLWrapper } from "drizzle-orm";
import { adminUsers, passwordResetCodes } from "../drizzle/schema";
const io = vi.hoisted(() => ({ database: null as any }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: vi.fn(() => io.database) }));
import {
  createPasswordResetCode,
  getActivePasswordResetCode,
  consumePasswordResetCode,
  incrementResetCodeAttempts,
  markResetCodeUsed,
} from "./db";
const oldUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL =
  "mysql://fictional:fictional@invalid.local/fictional_never_connected";
afterAll(() => {
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
});
const dialect = new MySqlDialect();
const accountId = 998911;
const now = Date.now();
type Code = {
  id: number;
  adminUserId: number;
  target: string;
  channel: "sms" | "email";
  codeHash: string;
  usedAt: Date | null;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
};
const code = (
  id: number,
  target: string,
  overrides: Partial<Code> = {}
): Code => ({
  id,
  adminUserId: accountId,
  target,
  channel: "sms",
  codeHash: "fictional:654321",
  usedAt: null,
  attempts: 0,
  expiresAt: new Date(now + 300000),
  createdAt: new Date(now - 120000 + id),
  ...overrides,
});
function ordinary(target: string) {
  return (
    target !== "personal-auth:v1" &&
    !target.startsWith("personal-phone:v1:") &&
    !target.startsWith("personal-phone-verified:v1:")
  );
}
function hasIsolation(text: string) {
  return (
    /NOT\s*\(/.test(text) &&
    text.includes("= 'personal-auth:v1'") &&
    text.includes("LIKE 'personal-phone:v1:%'") &&
    text.includes("LIKE 'personal-phone-verified:v1:%'")
  );
}
class Fixture {
  account = {
    id: accountId,
    status: "active",
    passwordHash: "old-fictional",
    sessionVersion: 8,
  };
  codes: Code[] = [];
  calls: {
    operation: string;
    table: unknown;
    sql: string;
    params: unknown[];
  }[] = [];
  async transaction<T>(run: (tx: Fixture) => Promise<T>) {
    return run(this);
  }
  select() {
    return this.builder("select");
  }
  update(table: unknown) {
    return this.builder("update", table);
  }
  insert(table: unknown) {
    return {
      values: async (input: Partial<Code>) => {
        expect(table).toBe(passwordResetCodes);
        this.codes.push(
          code(this.codes.length + 100, input.target!, {
            ...input,
            createdAt: new Date(),
          })
        );
      },
    };
  }
  builder(operation: string, initialTable?: unknown) {
    let table = initialTable,
      where: SQLWrapper | undefined,
      values: any,
      limit = Infinity;
    const fixture = this;
    const query = {
      from(value: unknown) {
        table = value;
        return query;
      },
      where(value: SQLWrapper) {
        where = value;
        return query;
      },
      set(value: unknown) {
        values = value;
        return query;
      },
      orderBy() {
        return query;
      },
      limit(value: number) {
        limit = value;
        return query;
      },
      for() {
        return query;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown
      ) {
        return Promise.resolve()
          .then(() => {
            const compiled = dialect.sqlToQuery(where!.getSQL());
            fixture.calls.push({ operation, table, ...compiled });
            const text = compiled.sql;
            if (table === adminUsers) {
              if (operation === "update") {
                fixture.account.passwordHash = values.passwordHash;
                fixture.account.sessionVersion++;
                return undefined;
              }
              return [{ ...fixture.account }];
            }
            expect(table).toBe(passwordResetCodes);
            let selected = fixture.codes
              .filter(record => {
                let parameter = 0;
                const terms = [
                  ...text.matchAll(
                    /`password_reset_codes`\.`(\w+)`\s*(=|>|<)\s*\?/g
                  ),
                ];
                for (const term of terms) {
                  const value = compiled.params[parameter++];
                  const field = term[1] as keyof Code;
                  const actual = record[field];
                  if (term[2] === "=" && actual !== value) return false;
                  if (term[2] === ">" && Number(actual) <= Number(value))
                    return false;
                  if (term[2] === "<" && Number(actual) >= Number(value))
                    return false;
                }
                if (text.includes("`usedAt` is null") && record.usedAt !== null)
                  return false;
                if (hasIsolation(text) && !ordinary(record.target))
                  return false;
                if (text.includes("DATE_SUB(CURRENT_TIMESTAMP")) {
                  const interval = Number(
                    compiled.params[compiled.params.length - 1]
                  );
                  if (record.createdAt.getTime() < Date.now() - interval * 1000)
                    return false;
                }
                return true;
              })
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, limit);
            if (operation === "update") {
              for (const record of selected) {
                for (const [key, value] of Object.entries(values)) {
                  if (key === "attempts" && typeof value === "object")
                    record.attempts++;
                  else (record as any)[key] = value;
                }
              }
              return undefined;
            }
            return selected.map(record => ({ ...record }));
          })
          .then(resolve, reject);
      },
    };
    return query;
  }
}
let fixture: Fixture;
let security: Code[];
beforeEach(() => {
  fixture = new Fixture();
  // Every test runs exported product helpers against a fake Drizzle boundary, never a connection.
  // Preserve cached getDb identity between tests by forwarding all methods to the current fixture.
  if (!io.database)
    io.database = {
      transaction: (run: any) => fixture.transaction(run),
      select: (...args: any[]) => (fixture.select as any)(...args),
      update: (...args: any[]) => (fixture.update as any)(...args),
      insert: (...args: any[]) => (fixture.insert as any)(...args),
    };
  fixture.codes = [
    code(1, "13900000001"),
    code(2, "personal-phone:v1:fictional-ticket:13900000002:original:hash:8", {
      createdAt: new Date(),
    }),
    code(3, "personal-phone-verified:v1:13900000001:8", {
      usedAt: new Date(),
      createdAt: new Date(),
    }),
    code(4, "personal-auth:v1", {
      usedAt: new Date(),
      attempts: 4,
      createdAt: new Date(),
    }),
  ];
  security = fixture.codes.slice(1).map(record => ({ ...record }));
});
function expectSafe() {
  expect(fixture.codes.filter(record => !ordinary(record.target))).toEqual(
    security
  );
  const resetCalls = fixture.calls.filter(
    call => call.table === passwordResetCodes
  );
  expect(resetCalls.length).toBeGreaterThan(0);
  for (const call of resetCalls)
    expect(hasIsolation(call.sql), call.sql).toBe(true);
}
describe("ordinary password/username reset SQL purpose isolation (fictional DB)", () => {
  it("new personal phone ticket neither throttles ordinary reset send nor is invalidated by its bulk update", async () => {
    await expect(
      createPasswordResetCode({
        adminUserId: accountId,
        channel: "email",
        target: "owner@example.com",
        codeHash: "fictional:112233",
        expiresAt: new Date(now + 300000),
      })
    ).resolves.toEqual({ created: true });
    expect(fixture.codes[0].usedAt).toBeInstanceOf(Date);
    expect(fixture.codes.at(-1)?.target).toBe("owner@example.com");
    expectSafe();
  });
  it("ordinary resend still throttles across SMS/email and leaves phone ticket/security budget unchanged", async () => {
    fixture.codes[0].createdAt = new Date();
    await expect(
      createPasswordResetCode({
        adminUserId: accountId,
        channel: "email",
        target: "owner@example.com",
        codeHash: "fictional",
        expiresAt: new Date(now + 300000),
      })
    ).resolves.toEqual({ created: false, reason: "TOO_FREQUENT" });
    expect(fixture.codes).toHaveLength(4);
    expectSafe();
  });
  it("active ordinary helper returns old ordinary row, never latest unused personal phone ticket", async () => {
    expect((await getActivePasswordResetCode(accountId))?.id).toBe(1);
    expectSafe();
  });
  it("five wrong ordinary codes exhaust only old reset and do not select, decrement security budget or burn new phone ticket", async () => {
    const verifyCode = vi.fn(async () => false);
    for (let i = 0; i < 5; i++)
      expect(
        await consumePasswordResetCode({ adminUserId: accountId, verifyCode })
      ).toBe(i === 4 ? "ATTEMPTS_EXHAUSTED" : "INVALID");
    expect(fixture.codes[0].attempts).toBe(5);
    expect(verifyCode.mock.calls.map(call => (call as unknown[])[0])).toEqual(
      Array(5).fill("fictional:654321")
    );
    expect(
      await consumePasswordResetCode({ adminUserId: accountId, verifyCode })
    ).toBe("INVALID");
    expect(verifyCode).toHaveBeenCalledTimes(5);
    expectSafe();
  });
  it.each(["sms", "email"])(
    "ordinary %s password reset still consumes once and revokes password sessions",
    async channel => {
      fixture.codes[0].channel = channel;
      fixture.codes[0].target =
        channel === "sms" ? "13900000001" : "owner@example.com";
      const target = fixture.codes[0].target;
      expect(
        await consumePasswordResetCode({
          adminUserId: accountId,
          target,
          verifyCode: async () => true,
          newPasswordHash: "new-fictional",
        })
      ).toBe("CONSUMED");
      expect(fixture.account).toMatchObject({
        passwordHash: "new-fictional",
        sessionVersion: 9,
      });
      expect(
        await consumePasswordResetCode({
          adminUserId: accountId,
          target,
          verifyCode: async () => true,
        })
      ).toBe("INVALID");
      expectSafe();
    }
  );
  it("ordinary username recovery target consumes without changing password, while explicit personal-purpose target remains forbidden", async () => {
    expect(
      await consumePasswordResetCode({
        adminUserId: accountId,
        target: fixture.codes[0].target,
        verifyCode: async () => true,
      })
    ).toBe("CONSUMED");
    expect(fixture.account.sessionVersion).toBe(8);
    const verifyCode = vi.fn(async () => true);
    for (const record of security)
      expect(
        await consumePasswordResetCode({
          adminUserId: accountId,
          target: record.target,
          verifyCode,
        })
      ).toBe("INVALID");
    expect(verifyCode).not.toHaveBeenCalled();
    expectSafe();
  });
  it("legacy increment/mark support helpers cannot mutate any security purpose, including unused ones", async () => {
    fixture.codes[2].usedAt = null;
    fixture.codes[3].usedAt = null;
    security = fixture.codes.slice(1).map(record => ({ ...record }));
    for (const record of security) {
      await incrementResetCodeAttempts(record.id);
      await markResetCodeUsed(record.id);
    }
    await incrementResetCodeAttempts(1);
    expect(fixture.codes[0].attempts).toBe(1);
    await markResetCodeUsed(1);
    expect(fixture.codes[0].usedAt).toBeInstanceOf(Date);
    expectSafe();
  });
});
