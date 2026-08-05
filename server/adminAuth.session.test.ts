import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getAdminUserByUsername: vi.fn(),
  touchAdminUserLogin: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

import {
  createLocalAdminSessionToken,
  hashPassword,
  LOCAL_ADMIN_SESSION_APP_ID,
  loginWithPassword,
  parseLocalAdminId,
} from "./adminAuth";
import { sdk } from "./_core/sdk";

const originalAppId = process.env.VITE_APP_ID;

afterEach(() => {
  vi.clearAllMocks();
  if (originalAppId === undefined) {
    delete process.env.VITE_APP_ID;
  } else {
    process.env.VITE_APP_ID = originalAppId;
  }
});

describe("local admin session", () => {
  it("remains verifiable when the optional OAuth app id is not configured", async () => {
    process.env.VITE_APP_ID = "";

    const token = await createLocalAdminSessionToken({
      id: 42,
      username: "operation-admin",
      displayName: "运营管理员",
    });

    const session = await sdk.verifySession(token);

    expect(session).toEqual({
      openId: "local_admin:42",
      appId: LOCAL_ADMIN_SESSION_APP_ID,
      name: "运营管理员",
    });
    expect(parseLocalAdminId(session?.openId ?? "")).toBe(42);
  });

  it("uses the username when the display name is empty", async () => {
    const token = await createLocalAdminSessionToken({
      id: 7,
      username: "fallback-admin",
      displayName: null,
    });

    await expect(sdk.verifySession(token)).resolves.toMatchObject({
      openId: "local_admin:7",
      appId: LOCAL_ADMIN_SESSION_APP_ID,
      name: "fallback-admin",
    });
  });

  it("writes a cookie whose token remains valid for the next auth.me request", async () => {
    process.env.VITE_APP_ID = "";
    const password = "ValidPass@123";
    const account = {
      id: 23,
      userId: 23,
      username: "login-admin",
      displayName: "登录管理员",
      email: "admin@example.com",
      phone: null,
      passwordHash: await hashPassword(password),
      adminRole: "operation" as const,
      status: "active" as const,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    dbMocks.getAdminUserByUsername.mockResolvedValue(account);
    dbMocks.touchAdminUserLogin.mockResolvedValue(undefined);

    const cookie = vi.fn();
    const req = {
      protocol: "http",
      headers: {},
    } as Request;
    const res = { cookie } as unknown as Response;

    const result = await loginWithPassword(req, res, account.username, password);

    expect(result).not.toHaveProperty("passwordHash");
    expect(dbMocks.getAdminUserByUsername).toHaveBeenCalledWith(account.username);
    expect(dbMocks.touchAdminUserLogin).toHaveBeenCalledWith(account.id);
    expect(cookie).toHaveBeenCalledTimes(1);

    const [cookieName, token, options] = cookie.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(cookieName).toBe(COOKIE_NAME);
    expect(options).toMatchObject({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: ONE_YEAR_MS,
    });

    await expect(sdk.verifySession(token)).resolves.toEqual({
      openId: "local_admin:23",
      appId: LOCAL_ADMIN_SESSION_APP_ID,
      name: "登录管理员",
    });
  });
});
