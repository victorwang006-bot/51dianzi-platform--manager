/**
 * 千问 AI 市场参考价查询服务
 *
 * 通过阿里云百炼 Agent 1.0 应用 API 调用独立的“51电子网-AI渠道查价”智能体。
 * 智能体内部使用 qwen3.7-max + web-search-turbo，并由系统提示词约束为仅返回最终价格；
 * 服务端对最终单行价格文本做最小安全校验后直接返回，兼容纯数字价格。
 *
 * 运行保护：
 * - API Key 仅服务端读取，应用 ID 可由环境变量覆盖
 * - 每个型号均使用独立单轮请求，不传递 session_id
 * - 24 小时进程内按“应用 + 完整型号”缓存
 * - 同型号并发去重、每日调用上限、超时与失败降级
 */

const DEFAULT_PRICE_APP_ID = "a6980c2be174414a9efb41913fa9606d";
const DASHSCOPE_PRICE_APP_ID =
  process.env.DASHSCOPE_PRICE_APP_ID || DEFAULT_PRICE_APP_ID;
const DASHSCOPE_APPLICATION_ENDPOINT =
  process.env.DASHSCOPE_APPLICATION_ENDPOINT ||
  `https://dashscope.aliyuncs.com/api/v1/apps/${encodeURIComponent(DASHSCOPE_PRICE_APP_ID)}/completion`;
const CACHE_NAMESPACE = "ai-price-v12-success-only-contract-retry";
const NO_RELIABLE_QUOTE_REASON = "暂未检索到该型号的中国国内主要贸易渠道价格";
const CURRENCY_NOTE = "中国国内主要贸易渠道参考价";

/** 24 小时缓存 */
const CACHE_TTL = 24 * 60 * 60 * 1000;
/** 每日真实调用上限 */
const DAILY_LIMIT = Number(process.env.AI_PRICE_DAILY_LIMIT || 300);
/** 单次调用超时；Agent 1.0查价通常在数十秒内完成。 */
const REQUEST_TIMEOUT = 60000;
/** 仅对 HTTP 200 但缺少最终文本或违反单行价格契约的响应重试一次。 */
const MAX_CONTRACT_ATTEMPTS = 2;

export type AiPriceResult = {
  ok: boolean;
  /** 本结果对应的标准化型号；前端必须与当前查询型号核对后再展示 */
  partNumber: string | null;
  /** 百炼智能体最终返回的单行价格文本；通过安全校验后原样展示 */
  priceRange: string | null;
  /** 网站不展示模型思考过程；保留字段以兼容现有前端契约 */
  summary: string | null;
  /** 查询口径说明 */
  currencyNote: string | null;
  /** 结果生成时间（毫秒时间戳） */
  generatedAt: number;
  /** 是否来自缓存 */
  cached: boolean;
  /** 失败/限流时的用户可读原因 */
  reason: string | null;
};

type CacheEntry = { at: number; value: AiPriceResult };

type AiPriceAuditRecord = {
  at: number;
  partNumber: string;
  responseId: string | null;
  rawOutput: string | null;
  selectedPrice: string | null;
  accepted: boolean;
  reason: string | null;
};

const priceCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AiPriceResult>>();
const auditLog: AiPriceAuditRecord[] = [];

let dailyCount = 0;
let dailyDate = "";

function todayKey() {
  return new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function checkAndBumpDaily(): boolean {
  const today = todayKey();
  if (dailyDate !== today) {
    dailyDate = today;
    dailyCount = 0;
  }
  if (dailyCount >= DAILY_LIMIT) return false;
  dailyCount += 1;
  return true;
}

/** 仅测试用：重置限流与缓存状态 */
export function __resetAiPriceStateForTest(opts?: { dailyCount?: number }) {
  priceCache.clear();
  inflight.clear();
  auditLog.length = 0;
  dailyDate = todayKey();
  dailyCount = opts?.dailyCount ?? 0;
}

/** 仅测试用：读取当前每日计数 */
export function __getAiPriceDailyCountForTest() {
  return { dailyDate, dailyCount, dailyLimit: DAILY_LIMIT };
}

/** 仅测试用：读取服务端内部审计记录；生产路由不暴露该数据。 */
export function __getAiPriceAuditForTest() {
  return auditLog.map(item => ({ ...item }));
}

function appendAudit(record: Omit<AiPriceAuditRecord, "at">) {
  auditLog.push({ at: Date.now(), ...record });
  if (auditLog.length > 100) auditLog.shift();
}

function fail(reason: string, partNumber: string | null = null): AiPriceResult {
  return {
    ok: false,
    partNumber,
    priceRange: null,
    summary: null,
    currencyNote: null,
    generatedAt: Date.now(),
    cached: false,
    reason,
  };
}

function noReliableQuote(partNumber: string): AiPriceResult {
  return {
    ok: false,
    partNumber,
    priceRange: null,
    summary: null,
    currencyNote: null,
    generatedAt: Date.now(),
    cached: false,
    reason: NO_RELIABLE_QUOTE_REASON,
  };
}

/** 系统规则已固化在百炼智能体中，网站每次只发送标准化完整型号。 */
export function buildAiPricePrompt(partNumber: string) {
  return partNumber.trim().toUpperCase();
}

type ApplicationApiBody = {
  request_id?: string;
  output?: {
    finish_reason?: string;
    session_id?: string;
    text?: string;
  };
  usage?: {
    models?: Array<{
      model_id?: string;
      input_tokens?: number;
      output_tokens?: number;
    }>;
  };
};

/** 只读取智能体应用最终 output.text；不使用 session_id 延续会话。 */
export function extractFinalResponseText(body: ApplicationApiBody): string | null {
  const text = body.output?.text?.trim();
  return text || null;
}

const NO_QUOTE_RE = /暂无(?:可靠)?报价|暂无(?:可靠)?价格|无法(?:核实|确认|查询)|未(?:查询|检索)到|无(?:可靠)?报价/i;
const MAX_DIRECT_PRICE_LENGTH = 64;

/**
 * 百炼智能体已经负责只输出最终价格，网站不再二次改写价格内容。
 * 这里只做最小安全校验：必须是含数字的单行短文本，且不能是“无报价”结果。
 * 通过后原样返回，因此 `26.02`、`¥26.02`、`26.02元/颗` 与价格区间均可展示。
 */
export function extractDisplayPrice(finalText: string): string | null {
  const priceText = finalText.trim();
  if (!priceText || priceText.length > MAX_DIRECT_PRICE_LENGTH) return null;
  if (/\r|\n/.test(priceText)) return null;
  if (NO_QUOTE_RE.test(priceText)) return null;
  if (!/\d/.test(priceText)) return null;
  return priceText;
}

async function callPriceAgent(partNumber: string, attempt = 1): Promise<AiPriceResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return fail("AI 查价服务未配置", partNumber);

  if (!checkAndBumpDaily()) {
    return fail("今日 AI 查价次数已达上限，请明天再试", partNumber);
  }

  try {
    const res = await fetch(DASHSCOPE_APPLICATION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: { prompt: buildAiPricePrompt(partNumber) },
        parameters: {},
        debug: {},
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[aiPriceQuery] Agent API ${res.status}: ${text.slice(0, 300)}`);
      return fail("AI 查价服务暂时不可用", partNumber);
    }

    const body = (await res.json()) as ApplicationApiBody;
    const finalText = extractFinalResponseText(body);
    const responseId = body.request_id ?? null;
    if (!finalText) {
      appendAudit({
        partNumber,
        responseId,
        rawOutput: null,
        selectedPrice: null,
        accepted: false,
        reason: "智能体应用未返回最终文本",
      });
      console.error(
        `[aiPriceQuery] 智能体应用未返回最终文本: part=${partNumber}, responseId=${responseId ?? "<missing>"}`,
      );
      if (attempt < MAX_CONTRACT_ATTEMPTS) {
        console.warn(
          `[aiPriceQuery] 最终文本缺失，当前请求内重试: part=${partNumber}, attempt=${attempt + 1}`,
        );
        return callPriceAgent(partNumber, attempt + 1);
      }
      return noReliableQuote(partNumber);
    }

    const selectedPrice = extractDisplayPrice(finalText);
    if (!selectedPrice) {
      const explicitNoQuote = NO_QUOTE_RE.test(finalText);
      appendAudit({
        partNumber,
        responseId,
        rawOutput: finalText,
        selectedPrice: null,
        accepted: false,
        reason: "最终文本不符合单行价格直返契约",
      });
      console.error(
        `[aiPriceQuery] 最终文本不符合单行价格直返契约: part=${partNumber}, responseId=${responseId ?? "<missing>"}`,
      );
      if (!explicitNoQuote && attempt < MAX_CONTRACT_ATTEMPTS) {
        console.warn(
          `[aiPriceQuery] 最终文本违反契约，当前请求内重试: part=${partNumber}, attempt=${attempt + 1}`,
        );
        return callPriceAgent(partNumber, attempt + 1);
      }
      return noReliableQuote(partNumber);
    }

    const modelId = body.usage?.models?.[0]?.model_id ?? "qwen3.7-max";
    appendAudit({
      partNumber,
      responseId,
      rawOutput: finalText,
      selectedPrice,
      accepted: true,
      reason: null,
    });
    console.info(
      `[aiPriceQuery] 智能体查询成功: appId=${DASHSCOPE_PRICE_APP_ID}, model=${modelId}, part=${partNumber}, responseId=${responseId ?? "<missing>"}, selectedPrice=${selectedPrice}`,
    );
    return {
      ok: true,
      partNumber,
      priceRange: selectedPrice,
      summary: null,
      currencyNote: CURRENCY_NOTE,
      generatedAt: Date.now(),
      cached: false,
      reason: null,
    };
  } catch (err) {
    console.error("[aiPriceQuery] 智能体调用失败:", err);
    return fail("AI 查价请求超时或网络异常，请稍后重试", partNumber);
  }
}

/**
 * 查询型号 AI 市场参考价（带 24h 缓存 + 并发去重 + 每日上限）。
 * 永不抛错。
 */
export async function queryAiMarketPrice(partNumber: string): Promise<AiPriceResult> {
  const normalizedPartNumber = partNumber.trim().toUpperCase();
  if (!normalizedPartNumber) return fail("型号不能为空");
  const key = `${CACHE_NAMESPACE}:${DASHSCOPE_PRICE_APP_ID}:${normalizedPartNumber}`;

  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...cached.value, cached: true };
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = callPriceAgent(normalizedPartNumber)
    .then(result => {
      // 只缓存成功结果。模型空文本、格式漂移或“未检索到”都可能是临时状态，禁止形成24小时假阴性。
      if (result.ok) {
        if (priceCache.size > 500) {
          const oldest = Array.from(priceCache.entries()).sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) priceCache.delete(oldest[0]);
        }
        priceCache.set(key, { at: Date.now(), value: result });
      }
      return result;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}
