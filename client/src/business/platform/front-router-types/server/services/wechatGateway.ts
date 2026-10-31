import fs from "node:fs";
import net from "node:net";
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  randomBytes,
  X509Certificate,
} from "node:crypto";
import { ENV } from "../_core/env";

export const WECHAT_PAYMENT_TIMEOUT_MINUTES = 5;

/** 微信支付官方 API v3 网关，生产环境不允许指向其他地址。 */
const DEFAULT_WECHAT_ENDPOINT = "https://api.mch.weixin.qq.com";

/** 应答验签允许的最大时钟偏差，与微信官方建议保持一致。 */
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/** 单次 API 调用超时，避免下单接口被微信侧慢响应拖死。 */
const REQUEST_TIMEOUT_MS = 8_000;

/** 微信支付交易状态。 */
export type WechatTradeState =
  | "SUCCESS"
  | "REFUND"
  | "NOTPAY"
  | "CLOSED"
  | "REVOKED"
  | "USERPAYING"
  | "PAYERROR"
  | string;

export class WechatConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WechatConfigurationError";
  }
}

export class WechatRequestError extends Error {
  code: string;
  httpStatus: number | null;
  requestId: string | null;

  constructor(
    code: string,
    message: string,
    options?: { httpStatus?: number | null; requestId?: string | null },
  ) {
    super(message);
    this.name = "WechatRequestError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? null;
    this.requestId = options?.requestId ?? null;
  }
}

export type WechatPrecreateInput = {
  paymentNo: string;
  amount: string;
  subject: string;
  clientIp?: string | null;
};

export type WechatPrecreateResult = {
  paymentNo: string;
  qrCode: string;
  requestId: string | null;
};

export type WechatJsapiPrepayInput = {
  paymentNo: string;
  amount: string;
  subject: string;
  /**
   * 付款人在**本小程序**下的 openid。
   *
   * JSAPI 下单强制要求此参数，且 openid 与 appid 必须同属一个小程序；
   * 用其他应用的 openid 会报 PARAM_ERROR。
   */
  payerOpenid: string;
  clientIp?: string | null;
  /** 支付有效期（秒）；不传则沿用扫码支付的 5 分钟 */
  expiresInSeconds?: number;
};

/**
 * JSAPI 下单结果：可直接交给 wx.requestPayment 的五个参数。
 *
 * 注意字段名大小写：微信小程序 API 要求 timeStamp / nonceStr / paySign
 * 这种驼峰形式（与服务端 v3 接口的下划线形式不同），
 * 写错大小写的表现是支付面板直接不弹且无报错。
 */
export type WechatJsapiPrepayResult = {
  paymentNo: string;
  appId: string;
  timeStamp: string;
  nonceStr: string;
  /** 固定为 `prepay_id=xxx` 格式 */
  package: string;
  signType: "RSA";
  paySign: string;
  requestId: string | null;
};

export type WechatQueryResult = {
  appId: string;
  mchId: string;
  paymentNo: string;
  transactionId: string | null;
  tradeType: string | null;
  tradeState: WechatTradeState;
  totalCents: number | null;
  currency: string | null;
  successTime: Date | null;
  requestId: string | null;
};

export type WechatCloseResult = {
  paymentNo: string;
  requestId: string | null;
};

/**
 * 微信退款状态。
 * SUCCESS 退款成功 / CLOSED 退款关闭 / PROCESSING 退款处理中 / ABNORMAL 退款异常。
 * ABNORMAL 需要人工介入（通常是商户余额不足或收款账户异常），不能自动重试。
 */
export type WechatRefundStatus = "SUCCESS" | "CLOSED" | "PROCESSING" | "ABNORMAL" | string;

export type WechatRefundInput = {
  /** 我方退款单号，作为 out_refund_no；同号重复提交微信不会二次退款 */
  refundNo: string;
  /** 原支付单号（我方 out_trade_no） */
  paymentNo: string;
  /** 本次退款金额，元，最多两位小数 */
  refundAmount: string;
  /** 原订单总金额，元；微信要求必须与原单一致，否则报 PARAM_ERROR */
  totalAmount: string;
  reason?: string | null;
};

export type WechatRefundResult = {
  refundNo: string;
  /** 微信退款单号 */
  providerRefundId: string;
  transactionId: string | null;
  status: WechatRefundStatus;
  refundCents: number | null;
  totalCents: number | null;
  successTime: Date | null;
  requestId: string | null;
};

export type WechatSignatureHeaders = {
  serial?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
};

export type WechatNotifyResource = {
  algorithm: string;
  ciphertext: string;
  nonce: string;
  associated_data?: string;
  original_type: string;
};

export type WechatNotifyEnvelope = {
  id: string;
  create_time?: string;
  event_type: string;
  resource_type?: string;
  summary?: string;
  resource: WechatNotifyResource;
};

export type WechatGateway = {
  /** Native 扫码支付使用的 AppID。 */
  readonly appId: string;
  /** 小程序 JSAPI 支付使用的 AppID。 */
  readonly miniProgramAppId: string;
  readonly mchId: string;
  readonly notifyUrl: string;
  readonly merchantSerialNo: string;
  readonly publicKeyId: string;
  precreate(input: WechatPrecreateInput): Promise<WechatPrecreateResult>;
  /** 小程序 JSAPI 下单；与 precreate 是两个不同的微信接口，不可互代 */
  jsapiPrepay(input: WechatJsapiPrepayInput): Promise<WechatJsapiPrepayResult>;
  query(paymentNo: string): Promise<WechatQueryResult>;
  close(paymentNo: string): Promise<WechatCloseResult>;
  refund(input: WechatRefundInput): Promise<WechatRefundResult>;
  queryRefund(refundNo: string): Promise<WechatRefundResult>;
  verifySignature(rawBody: string, headers: WechatSignatureHeaders): boolean;
  decryptNotify(envelope: WechatNotifyEnvelope): Record<string, unknown>;
};

function readConfiguredText(raw: string, filePath: string, label: string) {
  if (filePath) {
    try {
      return fs.readFileSync(filePath, "utf8").trim();
    } catch {
      throw new WechatConfigurationError(`${label}文件不可读取`);
    }
  }
  if (raw) return raw.replace(/\\n/g, "\n").trim();
  throw new WechatConfigurationError(`缺少${label}`);
}

/** 回调地址必须与后端实际注册的路由完全一致，否则微信通知会打空。 */
function validateNotifyUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WechatConfigurationError("WECHAT_PAY_NOTIFY_URL 不是有效 URL");
  }
  if (ENV.isProduction && parsed.protocol !== "https:") {
    throw new WechatConfigurationError("生产环境微信支付通知地址必须使用 HTTPS");
  }
  if (parsed.pathname !== "/api/payments/wechat/notify") {
    throw new WechatConfigurationError(
      "微信支付通知地址必须为 /api/payments/wechat/notify",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new WechatConfigurationError("微信支付通知地址不能包含查询参数或片段");
  }
}

/** 微信商品描述不接受部分符号，统一清洗并限制长度。 */
function normalizeSubject(subject: string) {
  const normalized = subject
    .replace(/[\\/=&#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return normalized || "51电子网采购订单";
}

function moneyToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new WechatRequestError("INVALID_AMOUNT", "微信支付金额格式无效");
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1) {
    throw new WechatRequestError("INVALID_AMOUNT", "微信支付金额必须大于 0");
  }
  return cents;
}

/** Native 下单要求真实终端 IP；生产环境拿不到就直接拒绝，避免风控拦单。 */
function normalizeClientIp(clientIp?: string | null) {
  const value = clientIp?.replace(/^::ffff:/, "").trim() || "";
  if (!net.isIP(value)) {
    if (ENV.isProduction) {
      throw new WechatRequestError("INVALID_CLIENT_IP", "无法获取有效的付款终端 IP");
    }
    return "127.0.0.1";
  }
  return value;
}

function validatePaymentNo(paymentNo: string) {
  if (!/^[0-9A-Za-z_-]{6,32}$/.test(paymentNo)) {
    throw new WechatRequestError("INVALID_PAYMENT_NO", "微信支付单号格式无效");
  }
}

/**
 * 退款单号格式校验。微信 out_refund_no 仅允许字母、数字、下划线、中划线，
 * 最长 64 位。本地先拦下非法格式，避免白白消耗一次退款请求。
 */
function validateRefundNo(refundNo: string) {
  if (!/^[0-9A-Za-z_-]{6,64}$/.test(refundNo)) {
    throw new WechatRequestError("INVALID_REFUND_NO", "微信退款单号格式无效");
  }
}

/**
 * 退款应答归一化。
 *
 * 退款是异步的：提交成功只表示微信已受理，最终结果要靠回调或查询。
 * 因此这里不把 PROCESSING 当错误，但必须拿到微信退款单号（refund_id），
 * 否则后续无法对账与查询。
 */
export function normalizeWechatRefundResult(
  input: Record<string, any>,
  requestedRefundNo: string,
  requestId: string | null,
): WechatRefundResult {
  validateRefundNo(requestedRefundNo);

  const providerRefundId = typeof input.refund_id === "string" ? input.refund_id.trim() : "";
  const refundNo = typeof input.out_refund_no === "string" ? input.out_refund_no.trim() : "";
  const status = typeof input.status === "string" ? input.status.trim() : "";

  if (!providerRefundId || !refundNo || !status) {
    throw new WechatRequestError(
      "INVALID_REFUND_RESPONSE",
      "微信退款应答缺少退款单号或状态",
      { requestId },
    );
  }

  // 应答的退款单号必须与请求一致。不一致意味着应答被串改或错位，
  // 若直接采信，会把可能属于其他退款单的结果写到当前退款单上。
  if (refundNo !== requestedRefundNo) {
    throw new WechatRequestError(
      "REFUND_NO_MISMATCH",
      "微信退款应答的退款单号与请求不一致",
      { requestId },
    );
  }

  const transactionId =
    typeof input.transaction_id === "string" ? input.transaction_id.trim() : null;

  let refundCents: number | null = null;
  let totalCents: number | null = null;
  if (input.amount && typeof input.amount === "object" && !Array.isArray(input.amount)) {
    const amount = input.amount as Record<string, unknown>;
    if (Number.isSafeInteger(amount.refund)) refundCents = Number(amount.refund);
    if (Number.isSafeInteger(amount.total)) totalCents = Number(amount.total);
  }

  const successTimeRaw = typeof input.success_time === "string" ? input.success_time.trim() : "";
  const successTime = successTimeRaw ? new Date(successTimeRaw) : null;

  return {
    refundNo,
    providerRefundId,
    transactionId,
    status,
    refundCents,
    totalCents,
    successTime: successTime && !Number.isNaN(successTime.getTime()) ? successTime : null,
    requestId,
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new WechatRequestError("INVALID_WECHAT_RESPONSE", "微信支付返回了无效 JSON");
  }
}

/**
 * 查单响应归一化。未支付时微信可能不返回金额/交易号等字段，
 * 因此可选字段只在"存在但无效"时报错，避免把正常的待支付状态误判为异常。
 */
export function normalizeWechatQueryResult(
  input: Record<string, any>,
  requestedPaymentNo: string,
  requestId: string | null,
): WechatQueryResult {
  validatePaymentNo(requestedPaymentNo);

  const appId = typeof input.appid === "string" ? input.appid.trim() : "";
  const mchId = typeof input.mchid === "string" ? input.mchid.trim() : "";
  const paymentNo = typeof input.out_trade_no === "string" ? input.out_trade_no.trim() : "";
  const tradeState = typeof input.trade_state === "string" ? input.trade_state.trim() : "";

  if (!appId || !mchId || !paymentNo || !tradeState) {
    throw new WechatRequestError(
      "INVALID_QUERY_IDENTITY",
      "微信支付查单缺少AppID、商户号、订单号或交易状态",
      { requestId },
    );
  }

  const transactionId =
    typeof input.transaction_id === "string" ? input.transaction_id.trim() : null;
  if (input.transaction_id !== undefined && !transactionId) {
    throw new WechatRequestError("INVALID_QUERY_TRANSACTION_ID", "微信支付查单交易号无效", {
      requestId,
    });
  }

  const tradeType = typeof input.trade_type === "string" ? input.trade_type.trim() : null;
  if (input.trade_type !== undefined && !tradeType) {
    throw new WechatRequestError("INVALID_QUERY_TRADE_TYPE", "微信支付查单交易类型无效", {
      requestId,
    });
  }

  let totalCents: number | null = null;
  let currency: string | null = null;
  if (input.amount !== undefined) {
    if (!input.amount || typeof input.amount !== "object" || Array.isArray(input.amount)) {
      throw new WechatRequestError("INVALID_QUERY_AMOUNT", "微信支付查单金额无效", {
        requestId,
      });
    }
    const amount = input.amount as Record<string, unknown>;
    if (amount.total !== undefined) {
      if (!Number.isSafeInteger(amount.total) || Number(amount.total) < 1) {
        throw new WechatRequestError("INVALID_QUERY_AMOUNT", "微信支付查单金额无效", {
          requestId,
        });
      }
      totalCents = Number(amount.total);
    }
    if (amount.currency !== undefined) {
      currency = typeof amount.currency === "string" ? amount.currency.trim() : null;
      if (!currency) {
        throw new WechatRequestError("INVALID_QUERY_CURRENCY", "微信支付查单币种无效", {
          requestId,
        });
      }
    }
  }

  const successTimeRaw = typeof input.success_time === "string" ? input.success_time.trim() : "";
  const successTime = successTimeRaw ? new Date(successTimeRaw) : null;

  return {
    appId,
    mchId,
    paymentNo,
    transactionId,
    tradeType,
    tradeState,
    totalCents,
    currency,
    successTime: successTime && !Number.isNaN(successTime.getTime()) ? successTime : null,
    requestId,
  };
}

function responseHeaders(response: Response): WechatSignatureHeaders {
  return {
    serial: response.headers.get("wechatpay-serial") || undefined,
    signature: response.headers.get("wechatpay-signature") || undefined,
    timestamp: response.headers.get("wechatpay-timestamp") || undefined,
    nonce: response.headers.get("wechatpay-nonce") || undefined,
  };
}

/**
 * 微信支付应答/回调验签。
 * 序列号必须等于配置的公钥 ID（公钥模式），时间戳偏差超过 5 分钟视为重放。
 */
export function verifyWechatpaySignature(input: {
  rawBody: string;
  headers: WechatSignatureHeaders;
  publicKeyPem: string;
  expectedPublicKeyId: string;
  nowSeconds?: number;
}) {
  const serial = input.headers.serial?.trim();
  const signature = input.headers.signature?.trim();
  const timestamp = input.headers.timestamp?.trim();
  const nonce = input.headers.nonce?.trim();

  if (!serial || !signature || !timestamp || !nonce) return false;
  if (serial !== input.expectedPublicKeyId) return false;
  if (!/^\d{10}$/.test(timestamp)) return false;

  const timestampSeconds = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${timestamp}\n${nonce}\n${input.rawBody}\n`);
    verifier.end();
    return verifier.verify(input.publicKeyPem, signature, "base64");
  } catch {
    return false;
  }
}

/** 回调报文使用 AEAD_AES_256_GCM 加密，密钥为商户 API v3 密钥。 */
export function decryptWechatNotifyResource(
  resource: WechatNotifyResource,
  apiV3Key: string,
): Record<string, unknown> {
  if (resource.algorithm !== "AEAD_AES_256_GCM") {
    throw new WechatRequestError("UNSUPPORTED_ALGORITHM", "不支持的微信回调加密算法");
  }
  if (!/^[A-Za-z0-9]{32}$/.test(apiV3Key)) {
    throw new WechatConfigurationError("API v3 密钥格式无效");
  }
  try {
    const encrypted = Buffer.from(resource.ciphertext, "base64");
    if (encrypted.length <= 16) throw new Error("ciphertext too short");
    const authTag = encrypted.subarray(encrypted.length - 16);
    const ciphertext = encrypted.subarray(0, encrypted.length - 16);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(apiV3Key, "utf8"),
      Buffer.from(resource.nonce, "utf8"),
    );
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8"));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    return parseJsonObject(plaintext);
  } catch (error) {
    if (error instanceof WechatRequestError) throw error;
    throw new WechatRequestError("NOTIFY_DECRYPT_FAILED", "微信支付回调解密失败");
  }
}

/** 对外只暴露脱敏错误码与截断信息，避免把凭据或堆栈带到接口响应里。 */
export function safeWechatError(error: unknown) {
  if (error instanceof WechatRequestError) {
    return {
      code: error.code,
      message: error.message.slice(0, 240),
      requestId: error.requestId,
      httpStatus: error.httpStatus,
    };
  }
  if (error instanceof WechatConfigurationError) {
    return {
      code: "WECHAT_CONFIGURATION_ERROR",
      message: error.message.slice(0, 240),
      requestId: null,
      httpStatus: null,
    };
  }
  return {
    code: "WECHAT_UNKNOWN_ERROR",
    message: error instanceof Error ? error.message.slice(0, 240) : "微信支付调用失败",
    requestId: null,
    httpStatus: null,
  };
}

let gatewaySingleton: WechatGateway | null = null;

/** 仅供测试使用：清空网关单例缓存。 */
export function resetWechatGatewayForTests() {
  gatewaySingleton = null;
}

/** 仅供测试使用：注入假网关，避免测试真实调用微信接口。 */
export function setWechatGatewayForTests(gateway: WechatGateway) {
  gatewaySingleton = gateway;
}

export function getWechatGateway(): WechatGateway {
  if (gatewaySingleton) return gatewaySingleton;

  if (!ENV.wechatPayEnabled) {
    throw new WechatConfigurationError("微信支付尚未启用");
  }

  const appId = ENV.wechatPayNativeAppId.trim();
  /**
   * 小程序支付专用 AppID。
   *
   * JSAPI 下单要求 appid 与付款人 openid 同属一个小程序，
   * 否则微信报 PARAM_ERROR。
   *
   * 当前生产两个环境变量取值相同（均为小程序「51电子网」的 AppID），
   * 但不能依赖这个巧合：若日后有人把 Native AppID 改成
   * 公众号或网站应用的，JSAPI 会突然全线失败，
   * 而报错来自微信侧的 PARAM_ERROR，极难定位到根因。
   * 故在此显式取值并校验。
   */
  const miniProgramAppId = ENV.wechatPayMiniProgramAppId.trim() || appId;
  const mchId = ENV.wechatPayMchId.trim();
  const notifyUrl = ENV.wechatPayNotifyUrl.trim();
  const merchantSerialNo = ENV.wechatPayMerchantSerialNo.trim().toUpperCase();
  const publicKeyId = ENV.wechatPayPublicKeyId.trim();

  if (!/^wx[0-9A-Za-z]{16}$/.test(appId)) {
    throw new WechatConfigurationError("WECHAT_PAY_NATIVE_APP_ID 格式无效");
  }
  if (!/^wx[0-9A-Za-z]{16}$/.test(miniProgramAppId)) {
    throw new WechatConfigurationError("WECHAT_PAY_MINIPROGRAM_APP_ID 格式无效");
  }
  if (!/^\d{8,16}$/.test(mchId)) {
    throw new WechatConfigurationError("WECHAT_PAY_MCH_ID 格式无效");
  }
  if (!notifyUrl) throw new WechatConfigurationError("缺少 WECHAT_PAY_NOTIFY_URL");
  validateNotifyUrl(notifyUrl);
  if (!/^[0-9A-F]{20,64}$/.test(merchantSerialNo)) {
    throw new WechatConfigurationError("商户 API 证书序列号格式无效");
  }
  if (!/^PUB_KEY_ID_[0-9A-Za-z]+$/.test(publicKeyId)) {
    throw new WechatConfigurationError("微信支付公钥 ID 格式无效");
  }

  const merchantPrivateKey = readConfiguredText(
    ENV.wechatPayMerchantPrivateKey,
    ENV.wechatPayMerchantPrivateKeyPath,
    "微信商户私钥",
  );
  const merchantCertificate = readConfiguredText(
    ENV.wechatPayMerchantCertificate,
    ENV.wechatPayMerchantCertificatePath,
    "微信商户 API 证书",
  );
  const wechatpayPublicKey = readConfiguredText(
    ENV.wechatPayPublicKey,
    ENV.wechatPayPublicKeyPath,
    "微信支付公钥",
  );
  const apiV3Key = readConfiguredText(
    ENV.wechatPayApiV3Key,
    ENV.wechatPayApiV3KeyPath,
    "微信 API v3 密钥",
  );

  if (!/^[A-Za-z0-9]{32}$/.test(apiV3Key)) {
    throw new WechatConfigurationError("微信 API v3 密钥必须为 32 位字母数字组合");
  }

  // 私钥与证书必须成对：证书序列号要与配置一致，且两者公钥逐字节相同。
  // 这能在启动阶段就拦住"换了证书忘了换私钥"这类最难排查的线上故障。
  try {
    const privateKey = createPrivateKey(merchantPrivateKey);
    const certificate = new X509Certificate(merchantCertificate);
    const serial = certificate.serialNumber.toUpperCase();
    if (serial !== merchantSerialNo) {
      throw new WechatConfigurationError("商户证书序列号与配置不一致");
    }
    const privatePublic = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    const certificatePublic = certificate.publicKey.export({ type: "spki", format: "der" });
    if (!Buffer.from(privatePublic).equals(Buffer.from(certificatePublic))) {
      throw new WechatConfigurationError("商户私钥与商户 API 证书不匹配");
    }
    createPublicKey(wechatpayPublicKey);
  } catch (error) {
    if (error instanceof WechatConfigurationError) throw error;
    throw new WechatConfigurationError("微信支付证书或公钥不可解析");
  }

  const endpoint = ENV.wechatPayEndpoint.trim() || DEFAULT_WECHAT_ENDPOINT;
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new WechatConfigurationError("WECHAT_PAY_ENDPOINT 不是有效 URL");
  }
  if (endpointUrl.protocol !== "https:") {
    throw new WechatConfigurationError("微信支付网关必须使用 HTTPS");
  }
  if (ENV.isProduction && endpointUrl.origin !== DEFAULT_WECHAT_ENDPOINT) {
    throw new WechatConfigurationError("生产环境仅允许微信支付官方 API 网关");
  }

  const verifySignature = (rawBody: string, headers: WechatSignatureHeaders) =>
    verifyWechatpaySignature({
      rawBody,
      headers,
      publicKeyPem: wechatpayPublicKey,
      expectedPublicKeyId: publicKeyId,
    });

  async function request(
    method: "GET" | "POST",
    pathWithQuery: string,
    body?: Record<string, unknown>,
  ) {
    const bodyText = body ? JSON.stringify(body) : "";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");

    const sign = createSign("RSA-SHA256");
    sign.update(`${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${bodyText}\n`);
    sign.end();
    const signature = sign.sign(merchantPrivateKey, "base64");

    const authorization =
      `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",` +
      `timestamp="${timestamp}",serial_no="${merchantSerialNo}",signature="${signature}"`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref();

    let response: Response;
    try {
      response = await fetch(`${endpointUrl.origin}${pathWithQuery}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          // 明确要求微信支付以当前公钥签名应答，避免平台证书/公钥模式歧义。
          "Wechatpay-Serial": publicKeyId,
          ...(body ? { "Content-Type": "application/json" } : {}),
          "User-Agent": "51dianzi-wechatpay/1.0",
        },
        ...(body ? { body: bodyText } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const code =
        error instanceof Error && error.name === "AbortError"
          ? "WECHAT_TIMEOUT"
          : "WECHAT_NETWORK_ERROR";
      throw new WechatRequestError(code, "微信支付网络请求失败");
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await response.text();
    const requestId = response.headers.get("request-id");

    // 先验签再解析：未通过验签的报文一律不进入业务逻辑，防止伪造应答。
    if (!verifySignature(rawBody, responseHeaders(response))) {
      throw new WechatRequestError("INVALID_WECHAT_SIGNATURE", "微信支付响应验签失败", {
        httpStatus: response.status,
        requestId,
      });
    }

    const parsed = parseJsonObject(rawBody);
    if (!response.ok) {
      throw new WechatRequestError(
        (parsed.code as string) || "WECHAT_API_ERROR",
        (parsed.message as string) || "微信支付接口调用失败",
        { httpStatus: response.status, requestId },
      );
    }
    return { data: parsed, requestId };
  }

  gatewaySingleton = {
    appId,
    miniProgramAppId,
    mchId,
    notifyUrl,
    merchantSerialNo,
    publicKeyId,

    async precreate(input: WechatPrecreateInput): Promise<WechatPrecreateResult> {
      validatePaymentNo(input.paymentNo);
      const total = moneyToCents(input.amount);
      const expireAt = new Date(Date.now() + WECHAT_PAYMENT_TIMEOUT_MINUTES * 60_000);

      const result = await request("POST", "/v3/pay/transactions/native", {
        appid: appId,
        mchid: mchId,
        description: normalizeSubject(input.subject),
        out_trade_no: input.paymentNo,
        time_expire: expireAt.toISOString(),
        notify_url: notifyUrl,
        amount: { total, currency: "CNY" },
        scene_info: { payer_client_ip: normalizeClientIp(input.clientIp) },
      });

      const qrCode = typeof result.data.code_url === "string" ? result.data.code_url.trim() : "";
      if (!qrCode.startsWith("weixin://")) {
        throw new WechatRequestError("MISSING_CODE_URL", "微信支付未返回有效二维码");
      }
      return { paymentNo: input.paymentNo, qrCode, requestId: result.requestId };
    },

    /**
     * 小程序 JSAPI 下单。
     *
     * ## 与 Native 扫码支付是两个不同接口
     *
     * Native 返回二维码 code_url，JSAPI 返回 prepay_id，
     * 接口路径、必传参数、返回形式均不同，不可互代。
     *
     * ## 为何要对 prepay_id 做二次签名
     *
     * 拿到 prepay_id 后**必须**用商户私钥再签一次，
     * 小程序的 wx.requestPayment 验证的是这个 paySign。
     * 漏掉这一步的表现是**支付面板根本不弹、且前端无任何报错**，
     * 排查时极容易误判成小程序端调用写错。
     *
     * 签名串的四行内容与顺序由微信确定，不能调整：
     * appId \n timeStamp \n nonceStr \n package \n
     */
    async jsapiPrepay(input: WechatJsapiPrepayInput): Promise<WechatJsapiPrepayResult> {
      validatePaymentNo(input.paymentNo);
      const total = moneyToCents(input.amount);
      const payerOpenid = input.payerOpenid.trim();
      if (!payerOpenid) {
        throw new WechatRequestError("MISSING_PAYER_OPENID", "缺少付款人 openid，无法发起小程序支付");
      }

      const ttlSeconds =
        input.expiresInSeconds && input.expiresInSeconds > 0
          ? input.expiresInSeconds
          : WECHAT_PAYMENT_TIMEOUT_MINUTES * 60;
      const expireAt = new Date(Date.now() + ttlSeconds * 1000);

      const result = await request("POST", "/v3/pay/transactions/jsapi", {
        appid: miniProgramAppId,
        mchid: mchId,
        description: normalizeSubject(input.subject),
        out_trade_no: input.paymentNo,
        time_expire: expireAt.toISOString(),
        notify_url: notifyUrl,
        amount: { total, currency: "CNY" },
        payer: { openid: payerOpenid },
        scene_info: { payer_client_ip: normalizeClientIp(input.clientIp) },
      });

      const prepayId =
        typeof result.data.prepay_id === "string" ? result.data.prepay_id.trim() : "";
      if (!prepayId) {
        throw new WechatRequestError("MISSING_PREPAY_ID", "微信支付未返回有效的预下单标识");
      }

      const timeStamp = String(Math.floor(Date.now() / 1000));
      const nonceStr = randomBytes(16).toString("hex");
      const packageValue = `prepay_id=${prepayId}`;

      /*
       * 签名用的 appId 必须与下单时传的 appid 一致，
       * 也必须与小程序实际 AppID 一致，否则验签不过、面板不弹。
       */
      const paySigner = createSign("RSA-SHA256");
      paySigner.update(`${miniProgramAppId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
      paySigner.end();
      const paySign = paySigner.sign(merchantPrivateKey, "base64");

      return {
        paymentNo: input.paymentNo,
        appId: miniProgramAppId,
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: "RSA",
        paySign,
        requestId: result.requestId,
      };
    },

    async query(paymentNo: string): Promise<WechatQueryResult> {
      validatePaymentNo(paymentNo);
      const path =
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(paymentNo)}` +
        `?mchid=${encodeURIComponent(mchId)}`;
      const result = await request("GET", path);
      return normalizeWechatQueryResult(result.data, paymentNo, result.requestId);
    },

    async close(paymentNo: string): Promise<WechatCloseResult> {
      validatePaymentNo(paymentNo);
      const result = await request(
        "POST",
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(paymentNo)}/close`,
        { mchid: mchId },
      );
      return { paymentNo, requestId: result.requestId };
    },

    /**
     * 发起退款。
     *
     * 关于 amount.total：微信要求传入的是**原交易总金额**，而非本单金额。
     * 本平台一个支付批次可能含多张拆分订单，退单张订单时就是部分退款，
     * total 必须是整个批次的金额，否则微信直接报 PARAM_ERROR。
     *
     * 幂等保证：同一 out_refund_no 重复提交，微信不会二次退款，
     * 而是返回原退款单的当前结果。这是防重复退款的最后一道保险。
     */
    async refund(input: WechatRefundInput): Promise<WechatRefundResult> {
      validateRefundNo(input.refundNo);
      validatePaymentNo(input.paymentNo);

      const refundCents = moneyToCents(input.refundAmount);
      const totalCents = moneyToCents(input.totalAmount);
      if (refundCents > totalCents) {
        throw new WechatRequestError(
          "REFUND_EXCEEDS_TOTAL",
          "退款金额不得大于原交易金额",
        );
      }

      const result = await request("POST", "/v3/refund/domestic/refunds", {
        out_trade_no: input.paymentNo,
        out_refund_no: input.refundNo,
        // 退款原因会展示给付款方，清洗后限长，避免特殊字符导致接口报错
        ...(input.reason
          ? { reason: input.reason.replace(/[\\/=&#]/g, " ").trim().slice(0, 80) }
          : {}),
        amount: { refund: refundCents, total: totalCents, currency: "CNY" },
      });

      return normalizeWechatRefundResult(result.data, input.refundNo, result.requestId);
    },

    /** 按我方退款单号查询退款结果，用于回调丢失时的兜底对账。 */
    async queryRefund(refundNo: string): Promise<WechatRefundResult> {
      validateRefundNo(refundNo);
      const result = await request(
        "GET",
        `/v3/refund/domestic/refunds/${encodeURIComponent(refundNo)}`,
      );
      return normalizeWechatRefundResult(result.data, refundNo, result.requestId);
    },

    verifySignature,

    decryptNotify(envelope: WechatNotifyEnvelope) {
      return decryptWechatNotifyResource(envelope.resource, apiV3Key);
    },
  };

  return gatewaySingleton;
}
