import { COOKIE_NAME, LEGACY_COOKIE_NAME } from "../../shared/const";

export type SessionCookieCandidate = {
  name: typeof COOKIE_NAME | typeof LEGACY_COOKIE_NAME;
  value: string;
};

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 保留请求头中所有同名会话 Cookie，而不是像通用 cookie.parse 那样只取第一个。
 * 新版本 Cookie 优先；同一名称存在多个值时逐一验签，直到找到有效会话。
 */
export function getSessionCookieCandidates(
  cookieHeader: string | undefined,
): SessionCookieCandidate[] {
  if (!cookieHeader) return [];

  const pairs = cookieHeader
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const separator = part.indexOf("=");
      if (separator < 1) return null;
      return {
        name: part.slice(0, separator).trim(),
        value: decodeCookieValue(part.slice(separator + 1).trim()),
      };
    })
    .filter((pair): pair is { name: string; value: string } => Boolean(pair?.value));

  const orderedNames = [COOKIE_NAME, LEGACY_COOKIE_NAME] as const;
  const seen = new Set<string>();
  const result: SessionCookieCandidate[] = [];
  for (const name of orderedNames) {
    for (const pair of pairs) {
      if (pair.name !== name || seen.has(pair.value)) continue;
      seen.add(pair.value);
      result.push({ name, value: pair.value });
    }
  }
  return result;
}
