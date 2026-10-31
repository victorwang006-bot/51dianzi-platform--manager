import fs from "node:fs";
import { AlipayRequestError, AlipaySdk } from "alipay-sdk";
import { ENV } from "../_core/env";

export const ALIPAY_PAYMENT_TIMEOUT_MINUTES = 5;
export const ALIPAY_SUCCESS_STATUSES = ["TRADE_SUCCESS", "TRADE_FINISHED"] as const;
export type AlipaySuccessStatus = (typeof ALIPAY_SUCCESS_STATUSES)[number];
export type AlipayTradeStatus =
  | "WAIT_BUYER_PAY"
  | "TRADE_CLOSED"
  | AlipaySuccessStatus
  | string;

export class AlipayConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlipayConfigurationError";
  }
}

export type AlipayPrecreateInput = {
  paymentNo: string;
  amount: string;
  subject: string;
  clientIp?: string | null;
};

export type AlipayPrecreateResult = {
  paymentNo: string;
  qrCode: string;
  traceId: string;
};

export type AlipayQueryResult = {
  paymentNo: string;
  tradeNo: string | null;
  tradeStatus: AlipayTradeStatus;
  totalAmount: string;
  buyerOpenId: string | null;
  traceId: string;
};

export type AlipayCloseResult = {
  paymentNo: string;
  tradeNo: string | null;
  traceId: string;
};

export type AlipayNotifySignatureContext = {
  rawBody: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
};

type AlipayNotifyVerifier = Pick<AlipaySdk, "rsaCheck" | "checkNotifySignV2">;

export function verifyAlipayNotifyWithSdk(
  sdk: AlipayNotifyVerifier,
  payload: Record<string, string>,
  context?: AlipayNotifySignatureContext,
) {
  const signature = context?.signature?.trim();
  const timestamp = context?.timestamp?.trim();
  const nonce = context?.nonce?.trim();
  const hasAnyV3Header = Boolean(signature || timestamp || nonce);

  if (hasAnyV3Header) {
    if (!signature || !timestamp || !nonce || !context?.rawBody) return false;
    const signContent = `${timestamp}\n${nonce}\n${context.rawBody}\n`;
    return sdk.rsaCheck(signContent, signature.replace(/ /g, "+"), "RSA2");
  }

  const formSignature = payload.sign?.replace(/ /g, "+");
  if (!formSignature) return false;
  return sdk.checkNotifySignV2({ ...payload, sign: formSignature });
}

export type AlipayGateway = {
  readonly appId: string;
  readonly sellerId: string;
  readonly notifyUrl: string;
  precreate(input: AlipayPrecreateInput): Promise<AlipayPrecreateResult>;
  query(paymentNo: string): Promise<AlipayQueryResult>;
  close(paymentNo: string): Promise<AlipayCloseResult>;
  verifyNotify(
    payload: Record<string, string>,
    context?: AlipayNotifySignatureContext,
  ): boolean;
};

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function readConfiguredText(raw: string, filePath: string, label: string) {
  if (filePath) {
    try {
      return fs.readFileSync(filePath, "utf8").trim();
    } catch {
      throw new AlipayConfigurationError(`${label}文件不可读取`);
    }
  }
  if (raw) return normalizePem(raw);
  throw new AlipayConfigurationError(`缺少${label}`);
}

function normalizeSubject(subject: string) {
  const normalized = subject
    .replace(/[\/=&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return normalized || "51电子网采购订单";
}

function validateNotifyUrl(url: string, mode: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AlipayConfigurationError("ALIPAY_NOTIFY_URL 不是有效 URL");
  }
  if (mode === "production" && parsed.protocol !== "https:") {
    throw new AlipayConfigurationError("生产环境支付宝通知地址必须使用 HTTPS");
  }
  if (!parsed.pathname.startsWith("/api/")) {
    throw new AlipayConfigurationError("支付宝通知地址必须位于 /api/ 路径下");
  }
}

export function isAlipaySuccessStatus(status: string): status is AlipaySuccessStatus {
  return (ALIPAY_SUCCESS_STATUSES as readonly string[]).includes(status);
}

export function safeAlipayError(error: unknown) {
  if (error instanceof AlipayRequestError) {
    return {
      code: error.code || "ALIPAY_REQUEST_ERROR",
      message: error.message.slice(0, 240),
      traceId: error.traceId || null,
      httpStatus: error.responseHttpStatus || null,
    };
  }
  if (error instanceof AlipayConfigurationError) {
    return {
      code: "ALIPAY_CONFIGURATION_ERROR",
      message: error.message.slice(0, 240),
      traceId: null,
      httpStatus: null,
    };
  }
  return {
    code: "ALIPAY_UNKNOWN_ERROR",
    message: error instanceof Error ? error.message.slice(0, 240) : "支付宝调用失败",
    traceId: null,
    httpStatus: null,
  };
}

let gatewaySingleton: AlipayGateway | null = null;

function createBrowserTestGateway(): AlipayGateway {
  const trades = new Map<
    string,
    { amount: string; createdAt: number; status: AlipayTradeStatus; tradeNo: string }
  >();
  const autoPayAfterMs = Math.max(0, Number(process.env.ALIPAY_E2E_AUTO_PAY_AFTER_MS || 0));
  return {
    appId: "2021000000000000",
    sellerId: "2088000000000000",
    notifyUrl: "http://127.0.0.1/api/payments/alipay/notify",
    async precreate(input) {
      const tradeNo = `20260806${input.paymentNo.slice(-16)}`;
      trades.set(input.paymentNo, {
        amount: input.amount,
        createdAt: Date.now(),
        status: "WAIT_BUYER_PAY",
        tradeNo,
      });
      return {
        paymentNo: input.paymentNo,
        qrCode: `https://qr.alipay.test/${input.paymentNo}`,
        traceId: "browser-test-precreate",
      };
    },
    async query(paymentNo) {
      const trade = trades.get(paymentNo);
      if (!trade) {
        throw new AlipayRequestError("trade not exist", { code: "ACQ.TRADE_NOT_EXIST" });
      }
      if (
        autoPayAfterMs > 0 &&
        trade.status === "WAIT_BUYER_PAY" &&
        Date.now() - trade.createdAt >= autoPayAfterMs
      ) {
        trade.status = "TRADE_SUCCESS";
      }
      return {
        paymentNo,
        tradeNo: trade.status === "WAIT_BUYER_PAY" ? null : trade.tradeNo,
        tradeStatus: trade.status,
        totalAmount: trade.amount,
        buyerOpenId: null,
        traceId: "browser-test-query",
      };
    },
    async close(paymentNo) {
      const trade = trades.get(paymentNo);
      if (trade) trade.status = "TRADE_CLOSED";
      return {
        paymentNo,
        tradeNo: trade?.tradeNo || null,
        traceId: "browser-test-close",
      };
    },
    verifyNotify() {
      return false;
    },
  };
}

export function resetAlipayGatewayForTests() {
  gatewaySingleton = null;
}

export function setAlipayGatewayForTests(gateway: AlipayGateway) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("支付宝测试网关仅允许在 NODE_ENV=test 时注入");
  }
  gatewaySingleton = gateway;
}

export function getAlipayGateway(): AlipayGateway {
  if (gatewaySingleton) return gatewaySingleton;
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.ALIPAY_E2E_FAKE_GATEWAY === "true"
  ) {
    gatewaySingleton = createBrowserTestGateway();
    return gatewaySingleton;
  }
  if (!ENV.alipayEnabled) {
    throw new AlipayConfigurationError("支付宝支付尚未启用");
  }

  const mode = ENV.alipayMode === "sandbox" ? "sandbox" : "production";
  if (!ENV.alipayAppId.trim()) throw new AlipayConfigurationError("缺少 ALIPAY_APP_ID");
  if (!ENV.alipaySellerId.trim()) throw new AlipayConfigurationError("缺少 ALIPAY_SELLER_ID");
  if (!ENV.alipayNotifyUrl.trim()) throw new AlipayConfigurationError("缺少 ALIPAY_NOTIFY_URL");
  validateNotifyUrl(ENV.alipayNotifyUrl.trim(), mode);

  const keyType = ENV.alipayKeyType === "PKCS1" ? "PKCS1" : "PKCS8";
  const privateKey = readConfiguredText(
    ENV.alipayPrivateKey,
    ENV.alipayPrivateKeyPath,
    "支付宝应用私钥",
  );
  const certPaths = [
    ENV.alipayAppCertPath,
    ENV.alipayPublicCertPath,
    ENV.alipayRootCertPath,
  ];
  const certMode = certPaths.every(Boolean);
  if (certPaths.some(Boolean) && !certMode) {
    throw new AlipayConfigurationError("证书模式必须同时配置应用证书、支付宝公钥证书和支付宝根证书");
  }

  const endpoint =
    ENV.alipayEndpoint.trim() ||
    (mode === "sandbox"
      ? "https://openapi-sandbox.dl.alipaydev.com"
      : "https://openapi.alipay.com");
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new AlipayConfigurationError("ALIPAY_ENDPOINT 不是有效 URL");
  }
  if (endpointUrl.protocol !== "https:") {
    throw new AlipayConfigurationError("支付宝网关必须使用 HTTPS");
  }
  if (mode === "production" && endpointUrl.origin !== "https://openapi.alipay.com") {
    throw new AlipayConfigurationError("生产环境仅允许支付宝官方 OpenAPI 网关");
  }

  const sdk = new AlipaySdk({
    appId: ENV.alipayAppId.trim(),
    privateKey,
    keyType,
    signType: "RSA2",
    endpoint,
    timeout: 8_000,
    camelcase: false,
    ...(certMode
      ? {
          appCertPath: ENV.alipayAppCertPath,
          alipayPublicCertPath: ENV.alipayPublicCertPath,
          alipayRootCertPath: ENV.alipayRootCertPath,
        }
      : {
          alipayPublicKey: readConfiguredText(
            ENV.alipayPublicKey,
            ENV.alipayPublicKeyPath,
            "支付宝公钥",
          ),
        }),
  });

  gatewaySingleton = {
    appId: ENV.alipayAppId.trim(),
    sellerId: ENV.alipaySellerId.trim(),
    notifyUrl: ENV.alipayNotifyUrl.trim(),

    async precreate(input) {
      const result = await sdk.curl<{
        out_trade_no?: string;
        qr_code?: string;
      }>("POST", "/v3/alipay/trade/precreate", {
        query: { notify_url: ENV.alipayNotifyUrl.trim() },
        body: {
          out_trade_no: input.paymentNo,
          total_amount: input.amount,
          subject: normalizeSubject(input.subject),
          product_code: "FACE_TO_FACE_PAYMENT",
          timeout_express: `${ALIPAY_PAYMENT_TIMEOUT_MINUTES}m`,
          qr_code_timeout_express: `${ALIPAY_PAYMENT_TIMEOUT_MINUTES}m`,
          ...(input.clientIp
            ? { business_params: { mc_create_trade_ip: input.clientIp } }
            : {}),
        },
      });
      const paymentNo = result.data.out_trade_no || input.paymentNo;
      const qrCode = result.data.qr_code;
      if (!qrCode) throw new Error("支付宝未返回二维码");
      return { paymentNo, qrCode, traceId: result.traceId };
    },

    async query(paymentNo) {
      const result = await sdk.curl<{
        out_trade_no: string;
        trade_no?: string;
        trade_status: string;
        total_amount: string;
        buyer_open_id?: string;
      }>("POST", "/v3/alipay/trade/query", {
        body: { out_trade_no: paymentNo },
      });
      return {
        paymentNo: result.data.out_trade_no || paymentNo,
        tradeNo: result.data.trade_no || null,
        tradeStatus: result.data.trade_status,
        totalAmount: result.data.total_amount,
        buyerOpenId: result.data.buyer_open_id || null,
        traceId: result.traceId,
      };
    },

    async close(paymentNo) {
      const result = await sdk.curl<{
        out_trade_no?: string;
        trade_no?: string;
      }>("POST", "/v3/alipay/trade/close", {
        body: { out_trade_no: paymentNo },
      });
      return {
        paymentNo: result.data.out_trade_no || paymentNo,
        tradeNo: result.data.trade_no || null,
        traceId: result.traceId,
      };
    },

    verifyNotify(payload, context) {
      return verifyAlipayNotifyWithSdk(sdk, payload, context);
    },
  };

  return gatewaySingleton;
}
