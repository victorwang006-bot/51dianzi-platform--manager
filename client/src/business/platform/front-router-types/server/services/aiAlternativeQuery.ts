/**
 * 百炼 AI 型号替代查询服务
 *
 * 通过独立 Agent 1.0 应用调用“51电子网-AI型号替代”智能体。
 * 智能体负责候选数量、兼容点、差异风险及参数、可靠性和供货情况；
 * 网站仅识别约定的独立无资料状态，正常报告不重排、不补足、不打分。
 *
 * 网站只承担传输与运行保护：
 * - API Key 仅服务端读取，APP_ID 可由环境变量覆盖
 * - 每次发送标准化完整型号与输出约定，不传 session_id
 * - 检查 HTTP 成功、output.text 存在且非空
 * - 同型号并发去重、短期缓存、每日调用上限与请求超时
 */

const DEFAULT_ALTERNATIVE_APP_ID = "039e93d5f05946bc9eab0e9873631026";
const DASHSCOPE_ALTERNATIVE_APP_ID =
  process.env.DASHSCOPE_ALTERNATIVE_APP_ID || DEFAULT_ALTERNATIVE_APP_ID;
const DASHSCOPE_ALTERNATIVE_APP_ENDPOINT =
  process.env.DASHSCOPE_ALTERNATIVE_APP_ENDPOINT ||
  `https://dashscope.aliyuncs.com/api/v1/apps/${encodeURIComponent(DASHSCOPE_ALTERNATIVE_APP_ID)}/completion`;
const CACHE_NAMESPACE = "ai-alternative-agent-material-status-v2";
const CACHE_TTL = Number(process.env.AI_ALTERNATIVE_CACHE_TTL_MS || 30 * 60 * 1000);
const REQUEST_TIMEOUT = Number(process.env.AI_ALTERNATIVE_REQUEST_TIMEOUT_MS || 120000);
const DAILY_LIMIT = Number(process.env.AI_ALTERNATIVE_DAILY_LIMIT || 120);

export type AiAlternativeResult = {
  ok: boolean;
  partNumber: string;
  generatedAt: number;
  cached: boolean;
  /** not_found 仅表示本次智能体无法确认原物料资料，不代表全球不存在。 */
  materialStatus: "available" | "not_found" | "unknown";
  /** 百炼智能体最终 output.text；成功时原样返回，不做 trim 或内容变换。 */
  rawText: string | null;
  /** 失败、限流或超时时的用户可读原因；失败时不生成任何替代候选。 */
  reason: string | null;
};

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

type CacheEntry = { at: number; value: AiAlternativeResult };
type AlternativeAuditRecord = {
  at: number;
  partNumber: string;
  appId: string;
  responseId: string | null;
  rawOutput: string | null;
  accepted: boolean;
  reason: string | null;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AiAlternativeResult>>();
const auditLog: AlternativeAuditRecord[] = [];
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

export function __resetAiAlternativeStateForTest(opts?: { dailyCount?: number }) {
  cache.clear();
  inflight.clear();
  auditLog.length = 0;
  dailyDate = todayKey();
  dailyCount = opts?.dailyCount ?? 0;
}

export function __getAiAlternativeAuditForTest() {
  return auditLog.map(item => ({ ...item }));
}

function appendAudit(record: Omit<AlternativeAuditRecord, "at">) {
  auditLog.push({ at: Date.now(), ...record });
  if (auditLog.length > 100) auditLog.shift();
}

function fail(partNumber: string, reason: string): AiAlternativeResult {
  return {
    ok: false,
    partNumber,
    generatedAt: Date.now(),
    cached: false,
    materialStatus: "unknown",
    rawText: null,
    reason,
  };
}

function normalizePartNumber(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9][A-Z0-9+._\-/]{2,99}$/.test(normalized)) return null;
  return normalized;
}

/** 单次应用请求的输出约定；不增加额外调用、检索或工具动作。 */
export function buildAiAlternativePrompt(partNumber: string) {
  return `查询完整器件型号：${partNumber.trim().toUpperCase()}

本次型号替代输出约定：
1. 先确认原物料的功能、关键参数与封装资料。若无法确认这些原物料资料，最终回复必须且只能是：暂无物料信息。不要输出标题、替代型号、命名猜测或可能原因，也不要声称该物料全球不存在。
2. 原物料资料可确认时，按原报告格式提供替代分析；先满足功能、关键参数与封装，再结合可靠性及供货稳定性推荐。不以品牌或系列知名度、名气、市场认可为推荐或排序依据，不做评分。推荐理由不得使用龙头、市场主流、市场占有率、生态完善、应用案例丰富等品牌声誉替代表述；只说明可确认的器件兼容点、器件级可靠性依据及供货状况，不确定的可靠性或供货情况须标明待核实。
3. 有原物料资料但没有可靠替代型号，说明暂无可靠替代及必要核对项，不得输出“暂无物料信息”。
4. 不新增检索、插件或额外接口；不得编造原物料参数或替代候选。`;
}

/** 只接受整个回复的精确空态，不从正常报告中的否定语句推断无资料。 */
export function isAlternativeMaterialNotFound(text: string): boolean {
  return text.trim() === "暂无物料信息";
}

/**
 * 只读取应用 API 的最终 output.text。
 * trim 仅用于判断是否为空，成功时返回原始字符串本身，保证内容零修改。
 */
export function extractAlternativeAgentText(body: ApplicationApiBody): string | null {
  const text = body.output?.text;
  return typeof text === "string" && text.trim().length > 0 ? text : null;
}

async function callAlternativeAgent(partNumber: string): Promise<AiAlternativeResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return fail(partNumber, "AI 型号替代服务未配置");
  if (!checkAndBumpDaily()) {
    return fail(partNumber, "今日 AI 型号替代查询次数已达上限，请明天再试");
  }

  try {
    const res = await fetch(DASHSCOPE_ALTERNATIVE_APP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: { prompt: buildAiAlternativePrompt(partNumber) },
        parameters: {},
        debug: {},
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[aiAlternativeQuery] Agent API ${res.status}: ${text.slice(0, 300)}`);
      return fail(partNumber, "AI 型号替代服务暂时不可用");
    }

    const body = (await res.json()) as ApplicationApiBody;
    const rawText = extractAlternativeAgentText(body);
    const responseId = body.request_id ?? null;
    if (!rawText) {
      appendAudit({
        partNumber,
        appId: DASHSCOPE_ALTERNATIVE_APP_ID,
        responseId,
        rawOutput: null,
        accepted: false,
        reason: "智能体应用未返回最终文本",
      });
      return fail(partNumber, "百炼智能体未返回结果，请稍后重试");
    }

    const modelId = body.usage?.models?.[0]?.model_id ?? "qwen3.7-max";
    appendAudit({
      partNumber,
      appId: DASHSCOPE_ALTERNATIVE_APP_ID,
      responseId,
      rawOutput: rawText,
      accepted: true,
      reason: null,
    });
    console.info(
      `[aiAlternativeQuery] 智能体查询成功: appId=${DASHSCOPE_ALTERNATIVE_APP_ID}, model=${modelId}, part=${partNumber}, responseId=${responseId ?? "<missing>"}, outputLength=${rawText.length}`,
    );
    return {
      ok: true,
      partNumber,
      generatedAt: Date.now(),
      cached: false,
      materialStatus: isAlternativeMaterialNotFound(rawText) ? "not_found" : "available",
      rawText,
      reason: null,
    };
  } catch (error) {
    console.error("[aiAlternativeQuery] 智能体调用失败:", error);
    return fail(partNumber, "AI 型号替代查询超时或网络异常，请稍后重试");
  }
}

/**
 * 查询百炼型号替代智能体（短期缓存 + 同型号并发去重 + 每日上限）。
 * 服务永不抛错，也不会在百炼失败时生成本地候选。
 */
export async function queryAiAlternatives(partNumber: string): Promise<AiAlternativeResult> {
  const normalizedPartNumber = normalizePartNumber(partNumber);
  if (!normalizedPartNumber) return fail(partNumber.trim().toUpperCase(), "型号格式无效");

  const key = `${CACHE_NAMESPACE}:${DASHSCOPE_ALTERNATIVE_APP_ID}:${normalizedPartNumber}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...cached.value, cached: true };
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = callAlternativeAgent(normalizedPartNumber)
    .then(result => {
      if (result.ok) {
        if (cache.size > 300) {
          const oldest = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) cache.delete(oldest[0]);
        }
        cache.set(key, { at: Date.now(), value: result });
      }
      return result;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}
