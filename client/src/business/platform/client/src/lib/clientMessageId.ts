const DEFAULT_PREFIX = "msg";
const MAX_PREFIX_LENGTH = 16;

function normalizedPrefix(prefix: string) {
  const value = prefix.replace(/[^A-Za-z0-9_-]/g, "").slice(0, MAX_PREFIX_LENGTH);
  return value || DEFAULT_PREFIX;
}

function getCryptoApi() {
  return typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
}

function randomHex(byteLength: number) {
  const cryptoApi = getCryptoApi();
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = new Uint8Array(byteLength);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /*
   * 极旧浏览器或受限 WebView 可能连 getRandomValues 都没有。
   * 这里的 ID 只用于请求幂等，不承担认证或签名用途；时间戳叠加两段随机值
   * 足以避免同一用户的消息键碰撞，同时不能因兼容性问题让整个聊天页崩溃。
   */
  return `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`
    .padEnd(byteLength * 2, "0")
    .slice(0, byteLength * 2);
}

/**
 * 生成不超过服务端 64 字符限制的客户端消息幂等键。
 *
 * 支持 randomUUID 的浏览器使用标准 UUID；旧浏览器退回到
 * 时间戳 + 随机字节，任何分支都不会因 API 缺失抛出 TypeError。
 */
export function createClientMessageId(prefix = DEFAULT_PREFIX) {
  const safePrefix = normalizedPrefix(prefix);
  const cryptoApi = getCryptoApi();
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${safePrefix}-${cryptoApi.randomUUID()}`;
  }

  return `${safePrefix}-${Date.now().toString(36)}-${randomHex(12)}`;
}
