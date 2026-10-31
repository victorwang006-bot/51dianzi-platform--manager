import crypto from "node:crypto";
import { ENV } from "../_core/env";

/**
 * 快递100 实时快递查询网关。
 *
 * 只负责协议层：构造签名、发起请求、解析返回、把错误码翻译成可读信息。
 * 缓存与限流由上层的 logisticsService 负责，避免网关承担状态。
 *
 * 官方文档：https://api.kuaidi100.com/document/5f0ffb5ebc8da837cbd8aefc
 */

/** 单条物流轨迹 */
export type LogisticsTrace = {
  /** 轨迹描述 */
  context: string;
  /** 原始时间 */
  time: string;
  /** 格式化时间 */
  ftime: string;
  /** 物流状态名称（resultv2 >= 1 才有） */
  status?: string;
  /** 高级物流状态值（resultv2 >= 4 才有） */
  statusCode?: string;
  /** 行政区域名称 */
  areaName?: string;
  /** 当前地点 */
  location?: string;
};

export type LogisticsQueryResult = {
  /** 快递公司编码 */
  com: string;
  /** 运单号 */
  nu: string;
  /** 基础物流状态：0 在途 / 1 揽收 / 3 签收 等 */
  state: string;
  /** 轨迹列表，时间倒序（最新在前） */
  traces: LogisticsTrace[];
  /** 预计到达时间，仅 resultv2=8 且快递公司支持时返回 */
  arrivalTime?: string;
  /** 路由信息中的当前城市 */
  currentCity?: string;
};

/**
 * 快递100 业务错误。
 *
 * 与网络异常区分开：网络异常可以重试，而业务错误（如签名失败、余额不足）
 * 重试无意义，上层需要据此决定是否降级展示。
 */
export class Kuaidi100Error extends Error {
  constructor(
    readonly returnCode: string,
    message: string,
    /** 是否属于"重试可能成功"的临时性错误 */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "Kuaidi100Error";
  }
}

/** 错误码到用户可读信息的映射 */
const ERROR_MESSAGES: Record<string, { message: string; retryable: boolean }> = {
  "400": { message: "快递公司参数有误或账号余额不足", retryable: false },
  "408": { message: "收寄件人电话校验不通过，顺丰与中通需提供正确电话", retryable: false },
  "500": { message: "暂未查询到物流信息，请稍后再试", retryable: true },
  "501": { message: "快递100 服务异常", retryable: true },
  "502": { message: "快递100 服务繁忙", retryable: true },
  "503": { message: "快递100 签名校验失败，请检查授权配置", retryable: false },
  "601": { message: "快递100 账号单量已用尽，需要充值", retryable: false },
};

/** 网关是否已配置完整，未配置时上层应降级为只展示卖家录入的运单信息 */
export function isKuaidi100Configured(): boolean {
  return Boolean(
    ENV.kuaidi100Enabled && ENV.kuaidi100Key && ENV.kuaidi100Customer,
  );
}

type QueryInput = {
  /** 快递公司编码，全小写 */
  com: string;
  /** 运单号 */
  num: string;
  /** 收/寄件人电话，顺丰与中通必填 */
  phone?: string;
  /** 出发地，提高签收判断准确率 */
  from?: string;
  /** 目的地 */
  to?: string;
};

/**
 * 允许测试替换底层 fetch，避免单测真实打快递100 接口（既慢又会消耗单量）。
 */
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

let fetchImpl: FetchLike | null = null;

export function setKuaidi100FetchForTests(impl: FetchLike | null) {
  fetchImpl = impl;
}

function currentFetch(): FetchLike {
  if (fetchImpl) return fetchImpl;
  return globalThis.fetch as unknown as FetchLike;
}

/**
 * 计算签名。
 *
 * 顺序是 param + key + customer 直接拼接后取 MD5 再转大写。
 * 这里最关键的一点：用于签名的 param 字符串必须与实际提交的完全一致，
 * 连空格都不能差，否则快递100 会返回 503。因此调用方必须复用同一个字符串。
 */
function signOf(param: string): string {
  return crypto
    .createHash("md5")
    .update(param + ENV.kuaidi100Key + ENV.kuaidi100Customer, "utf8")
    .digest("hex")
    .toUpperCase();
}

export async function queryLogistics(input: QueryInput): Promise<LogisticsQueryResult> {
  if (!isKuaidi100Configured()) {
    throw new Kuaidi100Error("NOT_CONFIGURED", "快递查询服务未配置", false);
  }

  const num = input.num.trim();
  if (num.length < 6 || num.length > 32) {
    throw new Kuaidi100Error("INVALID_NUM", "运单号长度需在 6 到 32 位之间", false);
  }

  const paramObj: Record<string, string> = {
    com: input.com.trim().toLowerCase(),
    num,
    // resultv2=4 才会返回高级状态名与状态值，界面需要据此显示"已揽收/派件中"等
    resultv2: "4",
    order: "desc",
  };
  if (input.phone?.trim()) paramObj.phone = input.phone.trim();
  if (input.from?.trim()) paramObj.from = input.from.trim();
  if (input.to?.trim()) paramObj.to = input.to.trim();

  // 用 JSON.stringify 生成紧凑字符串，签名与提交共用此变量
  const param = JSON.stringify(paramObj);

  const body = new URLSearchParams({
    customer: ENV.kuaidi100Customer,
    sign: signOf(param),
    param,
  }).toString();

  let raw: string;
  try {
    const resp = await currentFetch()(ENV.kuaidi100Endpoint, {
      method: "POST",
      // 必须是表单编码，用 JSON 提交会被判为格式错误直接返回 400
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    raw = await resp.text();
    if (!resp.ok) {
      throw new Kuaidi100Error(
        String(resp.status),
        `快递100 返回 HTTP ${resp.status}`,
        resp.status >= 500,
      );
    }
  } catch (error) {
    if (error instanceof Kuaidi100Error) throw error;
    // 网络层异常一律视为可重试，交由上层决定是否降级
    throw new Kuaidi100Error(
      "NETWORK",
      `调用快递100 失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Kuaidi100Error("PARSE", "快递100 返回内容无法解析", true);
  }

  // 失败与成功的返回结构不同：失败带 returnCode 且 result=false，
  // 成功带 status="200"。必须优先判断失败结构，否则会把错误当成空轨迹。
  if (parsed.result === false || parsed.returnCode) {
    const code = String(parsed.returnCode ?? "UNKNOWN");
    const known = ERROR_MESSAGES[code];
    throw new Kuaidi100Error(
      code,
      known?.message ?? String(parsed.message ?? "快递查询失败"),
      known?.retryable ?? false,
    );
  }

  const status = String(parsed.status ?? "");
  if (status !== "200") {
    const known = ERROR_MESSAGES[status];
    throw new Kuaidi100Error(
      status || "UNKNOWN",
      known?.message ?? String(parsed.message ?? "快递查询失败"),
      known?.retryable ?? false,
    );
  }

  const rawData = Array.isArray(parsed.data) ? parsed.data : [];
  const traces: LogisticsTrace[] = rawData.map(item => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      context: String(row.context ?? ""),
      time: String(row.time ?? ""),
      ftime: String(row.ftime ?? row.time ?? ""),
      status: row.status ? String(row.status) : undefined,
      statusCode: row.statusCode ? String(row.statusCode) : undefined,
      areaName: row.areaName ? String(row.areaName) : undefined,
      location: row.location ? String(row.location) : undefined,
    };
  });

  const routeInfo = (parsed.routeInfo ?? null) as
    | { cur?: { name?: string } }
    | null;

  return {
    com: String(parsed.com ?? paramObj.com),
    nu: String(parsed.nu ?? num),
    state: String(parsed.state ?? "0"),
    traces,
    arrivalTime: parsed.arrivalTime ? String(parsed.arrivalTime) : undefined,
    currentCity: routeInfo?.cur?.name ? String(routeInfo.cur.name) : undefined,
  };
}
