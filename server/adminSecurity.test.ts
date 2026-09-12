import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalAdminUsername, normalizeAdminUsername } from "../shared/adminUsername";
import { toAdminUserDto } from "./adminUserDto";

const dbMocks = vi.hoisted(() => ({
  getAdminUserByUsername: vi.fn(),
  touchAdminUserLogin: vi.fn(),
  consumePasswordResetCode: vi.fn(),
  getAdminUsersByPhone: vi.fn(),
  getAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
}));
vi.mock("./db", () => dbMocks);

import {
  createLocalAdminSessionToken,
  hashPassword,
  loginWithPassword,
  recoverUsernameWithCode,
  resetPasswordWithCode,
} from "./adminAuth";
import { sdk } from "./_core/sdk";
import { isCurrentLocalAdminSession } from "./_core/context";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

afterEach(() => vi.clearAllMocks());

const now = new Date("2026-01-01T00:00:00.000Z");
const account = {
  id: 42,
  userId: 42,
  username: "Admin.User",
  usernameCanonical: "admin.user",
  displayName: "管理员",
  email: "admin@example.com",
  phone: "13900000000",
  passwordHash: "",
  adminRole: "super_admin" as const,
  status: "active" as const,
  sessionVersion: 7,
  mfaEnabled: false,
  lastLoginAt: null,
  createdAt: now,
  updatedAt: now,
};

function responseCapture() {
  const cookies: Record<string, string> = {};
  return {
    cookies,
    res: { cookie: (name: string, value: string) => { cookies[name] = value; } } as unknown as Response,
  };
}

describe("administrator security boundaries", () => {
  it("allow-lists admin responses and never serializes passwordHash/sessionVersion", () => {
    const dto = toAdminUserDto({ ...account, passwordHash: "$2b$secret" });
    expect(dto).toEqual(expect.objectContaining({ id: account.id, username: account.username }));
    expect(dto).not.toHaveProperty("passwordHash");
    expect(dto).not.toHaveProperty("sessionVersion");
  });

  it("normalizes whitespace and makes canonical collisions explicit", () => {
    expect(normalizeAdminUsername("  Admin.User  ")).toBe("Admin.User");
    expect(canonicalAdminUsername("  Admin.User  ")).toBe("admin.user");
    expect(canonicalAdminUsername("ADMIN.USER")).toBe("admin.user");
    expect(normalizeAdminUsername("   ")).toBe("");
  });

  it("registers the account-security schema and runs an idempotent migration before deployment switch", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const deploy = readFileSync("deploy/deploy-admin.sh", "utf8");
    const runner = readFileSync("scripts/apply-admin-account-security-schema.mjs", "utf8");
    const migration = journal.entries.find(entry => entry.tag === "0021_admin_account_security");
    expect(migration).toMatchObject({ idx: 19, tag: "0021_admin_account_security" });
    expect(migration?.when).toBeGreaterThan(1785976729575);
    expect(readFileSync("drizzle/0021_admin_account_security.sql", "utf8")).toContain(
      "admin_users_username_canonical_unique",
    );
    expect(runner).toContain("SELECT GET_LOCK(?, 30)");
    expect(runner).toContain("GROUP BY LOWER(TRIM(username))");
    expect(runner).toContain("ADD COLUMN `sessionVersion` int NOT NULL DEFAULT 1");
    expect(runner).toContain("admin_users_username_canonical_unique");
    expect(deploy).toContain('test -f "$REL/scripts/apply-admin-account-security-schema.mjs"');
    expect(deploy).toContain('node "$REL/scripts/apply-admin-account-security-schema.mjs"');
    expect(deploy.indexOf("apply-admin-account-security-schema.mjs")).toBeLessThan(
      deploy.indexOf('echo "=== 5. 原子切换软链 ==="'),
    );
  });

  it("signs the database session version and login lookup is trim-normalized", async () => {
    process.env.JWT_SECRET = "test-session-secret";
    const password = "ValidPass@123";
    dbMocks.getAdminUserByUsername.mockResolvedValue({ ...account, passwordHash: await hashPassword(password) });
    dbMocks.touchAdminUserLogin.mockResolvedValue(undefined);
    const { res, cookies } = responseCapture();

    const result = await loginWithPassword(
      { protocol: "https", headers: {} } as Request,
      res,
      "  Admin.User  ",
      password,
    );

    expect(dbMocks.getAdminUserByUsername).toHaveBeenCalledWith("Admin.User");
    expect(result).not.toHaveProperty("passwordHash");
    expect(result).not.toHaveProperty("sessionVersion");
    await expect(sdk.verifySession(cookies.app_session_id)).resolves.toMatchObject({
      openId: "local_admin:42",
      sessionVersion: 7,
    });
  });

  it("produces distinct versioned JWTs, enabling context to reject revoked old tokens", async () => {
    process.env.JWT_SECRET = "test-session-secret";
    const oldToken = await createLocalAdminSessionToken({
      id: 42,
      username: "Admin.User",
      sessionVersion: 7,
    });
    const newToken = await createLocalAdminSessionToken({
      id: 42,
      username: "Admin.User",
      sessionVersion: 8,
    });
    const [oldSession, newSession] = await Promise.all([sdk.verifySession(oldToken), sdk.verifySession(newToken)]);
    expect(oldSession?.sessionVersion).toBe(7);
    expect(newSession?.sessionVersion).toBe(8);
    expect(oldSession?.sessionVersion).not.toBe(8);
  });

  it("accepts only the exact current session version, so password/status revocation invalidates old JWTs", () => {
    expect(isCurrentLocalAdminSession(account, { sessionVersion: 7 })).toBe(true);
    expect(isCurrentLocalAdminSession(account, { sessionVersion: 8 })).toBe(false);
    expect(isCurrentLocalAdminSession(account, {})).toBe(false); // pre-migration local JWT
    expect(isCurrentLocalAdminSession({ ...account, status: "disabled" }, { sessionVersion: 7 })).toBe(false);
  });

  it("admin.list and adminUser.create expose only allow-listed account fields", async () => {
    const superContext: TrpcContext = {
      user: {
        id: 1, openId: "local_admin:1", name: "root", email: null, loginMethod: "password", role: "admin",
        createdAt: now, updatedAt: now, lastSignedIn: now,
      },
      adminAccount: { ...account, id: 1, adminRole: "super_admin", passwordHash: null },
      adminPermissions: [],
      req: { headers: {}, protocol: "https" } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    dbMocks.getAdminUsers.mockResolvedValue({ data: [toAdminUserDto({ ...account, passwordHash: "$2b$hidden" })], total: 1 });
    dbMocks.createAdminUser.mockResolvedValue(toAdminUserDto({ ...account, passwordHash: "$2b$hidden" }));
    const caller = appRouter.createCaller(superContext);

    const list = await caller.admin.list({ page: 1, pageSize: 20 });
    const created = await caller.adminUser.create({
      username: " safe-user ", displayName: null, email: null, phone: null,
      adminRole: "operation", salesStaffCodes: [], password: "InitialPass123!",
    });

    expect(list.data[0]).not.toHaveProperty("passwordHash");
    expect(created).not.toHaveProperty("passwordHash");
    expect(created).not.toHaveProperty("sessionVersion");
    expect(dbMocks.createAdminUser).toHaveBeenCalledWith(expect.objectContaining({ username: "safe-user" }));
  });

  it("maps a single successful concurrent reset-code consume to one success and rejects the loser", async () => {
    dbMocks.getAdminUserByUsername.mockResolvedValue({ ...account, passwordHash: "$2b$unused" });
    dbMocks.consumePasswordResetCode
      .mockResolvedValueOnce("CONSUMED")
      .mockResolvedValueOnce("INVALID");

    const [first, second] = await Promise.allSettled([
      resetPasswordWithCode(" Admin.User ", "654321", "NewPass@123"),
      resetPasswordWithCode("Admin.User", "654321", "NewPass@123"),
    ]);

    expect([first, second].filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect([first, second].filter(result => result.status === "rejected")).toHaveLength(1);
    expect(dbMocks.consumePasswordResetCode).toHaveBeenCalledTimes(2);
  });

  it("maps exhausted attempts atomically to rate-limit behavior for username recovery", async () => {
    dbMocks.consumePasswordResetCode.mockResolvedValue("ATTEMPTS_EXHAUSTED");
    // Recovery first resolves its active account set from the specialized lookup.
    // Importing the mocked module lets the unit test document the one transaction result boundary.
    const mocked = await import("./db");
    vi.mocked(mocked.getAdminUsersByPhone).mockResolvedValue([{ ...account, passwordHash: null }]);

    await expect(recoverUsernameWithCode("sms", account.phone!, "000000")).rejects.toThrow("验证码错误次数过多");
  });
});
