import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  authenticateRequest: vi.fn(),
  getAdminUserById: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    verifySession: mocks.verifySession,
    authenticateRequest: mocks.authenticateRequest,
  },
}));

vi.mock("./db", () => ({
  getAdminUserById: mocks.getAdminUserById,
}));

import { createContext } from "./_core/context";

function makeOptions(headers: Record<string, string> = {}) {
  return {
    req: { headers },
    res: {},
  } as unknown as CreateExpressContextOptions;
}

describe("admin createContext authentication noise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not invoke authentication for an anonymous request", async () => {
    const context = await createContext(makeOptions());

    expect(context.user).toBeNull();
    expect(context.adminAccount).toBeNull();
    expect(mocks.verifySession).not.toHaveBeenCalled();
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it("verifies an invalid credential only once and does not retry full authentication", async () => {
    mocks.verifySession.mockResolvedValue(null);

    const context = await createContext(
      makeOptions({ authorization: "Bearer invalid-session" })
    );

    expect(context.user).toBeNull();
    expect(mocks.verifySession).toHaveBeenCalledTimes(1);
    expect(mocks.verifySession).toHaveBeenCalledWith("invalid-session");
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it("reuses the verified non-local session for OAuth authentication", async () => {
    const verified = { openId: "oauth-user", appId: "app", name: "OAuth 用户" };
    const now = new Date();
    const authenticated = {
      id: 9,
      openId: "oauth-user",
      name: "OAuth 用户",
      email: null,
      loginMethod: "oauth",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    };
    mocks.verifySession.mockResolvedValue(verified);
    mocks.authenticateRequest.mockResolvedValue(authenticated);
    const options = makeOptions({ authorization: "Bearer signed-session" });

    const context = await createContext(options);

    expect(mocks.verifySession).toHaveBeenCalledTimes(1);
    expect(mocks.authenticateRequest).toHaveBeenCalledWith(options.req, {
      token: "signed-session",
      session: verified,
    });
    expect(context.user).toEqual(authenticated);
  });

  it("does not fall back to OAuth for a disabled local admin session", async () => {
    mocks.verifySession.mockResolvedValue({
      openId: "local_admin:42",
      appId: "local-admin",
      name: "停用管理员",
    });
    mocks.getAdminUserById.mockResolvedValue({
      id: 42,
      status: "disabled",
    });

    const context = await createContext(
      makeOptions({ authorization: "Bearer local-session" })
    );

    expect(context.user).toBeNull();
    expect(mocks.getAdminUserById).toHaveBeenCalledWith(42);
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });
});
