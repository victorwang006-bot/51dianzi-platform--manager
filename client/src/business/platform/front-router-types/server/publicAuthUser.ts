import type { User } from "../drizzle/schema";

export type PublicAuthUser = Omit<
  User,
  "passwordHash" | "sessionVersion" | "passwordChangedAt" | "emailVerifiedAt"
> & {
  hasPassword: boolean;
  emailVerified: boolean;
};

/** 登录接口传入已验证用户时，返回值必定非空。 */
export function toPublicAuthUser(user: User): PublicAuthUser;
/** auth.me在匿名请求时允许返回null。 */
export function toPublicAuthUser(user: null): null;
/** auth.me的请求上下文在编译期是User|null。 */
export function toPublicAuthUser(user: User | null): PublicAuthUser | null;
/**
 * 只向浏览器返回当前用户可见字段，永不暴露 passwordHash。
 * 登录接口与 auth.me 共用同一结构，前端可在登录成功后立即写入认证缓存。
 */
export function toPublicAuthUser(user: User | null): PublicAuthUser | null {
  if (!user) return null;
  const {
    passwordHash,
    sessionVersion: _sessionVersion,
    passwordChangedAt: _passwordChangedAt,
    emailVerifiedAt,
    ...publicUser
  } = user;
  return {
    ...publicUser,
    hasPassword: Boolean(passwordHash),
    emailVerified: Boolean(emailVerifiedAt),
  };
}
