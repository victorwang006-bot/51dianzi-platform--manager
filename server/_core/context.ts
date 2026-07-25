import { COOKIE_NAME } from "@shared/const";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { AdminUser, User } from "../../drizzle/schema";
import { parseLocalAdminId } from "../adminAuth";
import * as db from "../db";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** 账号密码登录的后台账号（admin_users 表）；未使用本地登录时为 null */
  adminAccount: AdminUser | null;
};

function extractSessionToken(
  req: CreateExpressContextOptions["req"]
): string | null {
  const cookieHeader = req.headers.cookie ?? "";
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let adminAccount: AdminUser | null = null;

  // 1) 优先识别本地账号密码登录会话（openId 前缀 local_admin:）
  try {
    const token = extractSessionToken(opts.req);
    if (token) {
      const session = await sdk.verifySession(token);
      if (session) {
        const localId = parseLocalAdminId(session.openId);
        if (localId !== null) {
          const account = await db.getAdminUserById(localId);
          if (account && account.status === "active") {
            adminAccount = account;
            // 将本地账号映射为兼容的 User 形状，业务代码 ctx.user.role === "admin" 依旧成立
            user = {
              id: account.id,
              openId: session.openId,
              name: account.displayName || account.username,
              email: account.email,
              loginMethod: "password",
              role: "admin",
              createdAt: account.createdAt,
              updatedAt: account.updatedAt,
              lastSignedIn: account.lastLoginAt ?? account.createdAt,
            } satisfies User;
          }
        }
      }
    }
  } catch {
    adminAccount = null;
    user = null;
  }

  // 2) 回退到 Manus OAuth 会话（保留兼容）
  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    adminAccount,
  };
}
