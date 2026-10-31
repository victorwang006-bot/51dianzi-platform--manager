import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const WECHAT_REBIND_TICKET_TTL_MS = 10 * 60 * 1000;
const TICKET_VERSION = "v1";
const INVALID_TICKET_MESSAGE = "换绑验证已失效，请重新开始";

type WechatRebindTicketPayload = {
  version: 1;
  userId: number;
  oldOpenid: string;
  newOpenid: string;
  newUnionId: string | null;
  expiresAt: number;
};

function encryptionKey(): Buffer {
  const configuredSecret = process.env.JWT_SECRET || process.env.COOKIE_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new Error("微信换绑暂不可用，请稍后再试");
  }
  const secret = configuredSecret || "wechat-rebind-ticket-dev-secret";
  return createHash("sha256").update(secret).digest();
}

function validWechatId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/**
 * 票据使用 AES-256-GCM 加密并认证，而不是只做签名。
 * openid 属于可追踪用户的敏感标识，不能放在客户端可解码的明文载荷里。
 */
export function createWechatRebindTicket(
  input: Omit<WechatRebindTicketPayload, "version" | "expiresAt">,
): string {
  if (
    !Number.isInteger(input.userId)
    || input.userId <= 0
    || !validWechatId(input.oldOpenid)
    || !validWechatId(input.newOpenid)
    || input.oldOpenid === input.newOpenid
    || (input.newUnionId !== null && !validWechatId(input.newUnionId))
  ) {
    throw new Error(INVALID_TICKET_MESSAGE);
  }

  const payload: WechatRebindTicketPayload = {
    ...input,
    version: 1,
    expiresAt: Date.now() + WECHAT_REBIND_TICKET_TTL_MS,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    TICKET_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function verifyWechatRebindTicket(ticket: string): WechatRebindTicketPayload {
  try {
    const [version, ivText, ciphertextText, tagText, extra] = ticket.split(".");
    if (version !== TICKET_VERSION || !ivText || !ciphertextText || !tagText || extra) {
      throw new Error(INVALID_TICKET_MESSAGE);
    }
    const iv = Buffer.from(ivText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error(INVALID_TICKET_MESSAGE);
    }

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as WechatRebindTicketPayload;
    if (
      payload.version !== 1
      || !Number.isInteger(payload.userId)
      || payload.userId <= 0
      || !validWechatId(payload.oldOpenid)
      || !validWechatId(payload.newOpenid)
      || payload.oldOpenid === payload.newOpenid
      || (payload.newUnionId !== null && !validWechatId(payload.newUnionId))
      || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt <= Date.now()
    ) {
      throw new Error(INVALID_TICKET_MESSAGE);
    }
    return payload;
  } catch {
    throw new Error(INVALID_TICKET_MESSAGE);
  }
}

export const WECHAT_REBIND_TICKET_TTL_SECONDS =
  WECHAT_REBIND_TICKET_TTL_MS / 1000;
