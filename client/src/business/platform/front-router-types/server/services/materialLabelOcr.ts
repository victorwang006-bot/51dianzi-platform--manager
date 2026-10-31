/**
 * 物料标签识别（拍标签只提取料号）。
 *
 * 2026-08-27 起按产品要求只识别 `partNumber`。品牌、数量、批号、封装
 * 不再要求视觉模型抽取，也不再返回建议值；旧字段仍以 null 返回，保证
 * 已发布的小程序版本读取结果时保持兼容。
 *
 * ## 为什么使用阿里云百炼视觉模型
 *
 * 营业执照走 `@alicloud/ocr-api20210707` 是因为营业执照版式固定，
 * 专用 OCR 能直接返回字段级结果。但元器件标签**没有固定版式**：
 * ST 卷带盘标签、Intel 纸箱标签、NXP 编带标签的布局差异极大。
 * 因此使用百炼多模态模型做图片理解与结构化信息抽取，并复用生产环境
 * 已有的 `DASHSCOPE_API_KEY`；不再依赖外部 ECS 上缺失的 Forge 凭据。
 *
 * ## 实测依据（2026-08-19，生产真实标签 3 张）
 *
 * 料号 3/3 逐字符准确：
 *   STM8S003F3P6TR / 5CEBA7F23C7N / TJA1042T/3/1
 * 两个不同厂商的视觉模型结论完全一致。
 *
 * 但**两个字段不可自动回填**，这是核对数据库真实值才发现的：
 *
 * | 字段 | 标签上印的 | 商家实际填的 |
 * |---|---|---|
 * | 品牌 | STMicroelectronics | ST |
 * | 批号 | GK251UVY（Trace Code） | 22+ |
 *
 * 批号尤其危险：标签印的是厂商追溯码/周批号，
 * 而行业惯例填年份格式 `22+`，**两者语义完全不同**。
 * 直接回填等于污染数据，且这种污染事后极难识别与清理。
 *
 * 故本服务的产出定位是**建议值**，由用户逐字段确认后回填，
 * 沿用面单识别已确立的原则（识别结果须经用户确认，不自动提交）。
 */
import { createHash } from "node:crypto";

/** 现货核验只接受印刷标签或器件激光丝印。 */
export const SPOT_MARKING_SOURCES = [
  "printed",
  "laser",
  "handwritten",
  "screen",
  "unknown",
] as const;
export type SpotMarkingSource = (typeof SPOT_MARKING_SOURCES)[number];
export const SPOT_VERIFICATION_REJECT_HANDWRITTEN_MESSAGE = "请拍原厂标签或器件丝印，手写无效";

export function isAcceptedSpotMarking(source: unknown): source is "printed" | "laser" {
  return source === "printed" || source === "laser";
}

export type LabelFieldSuggestion = {
  /** 识别到的原始值（未做任何改写，便于用户核对标签） */
  raw: string;
  /** 归一化后的建议值；无法归一化时与 raw 相同 */
  suggested: string;
  /**
   * 是否可直接回填表单。
   *
   * false 表示必须由用户确认或手工填写 —— 不是「置信度低」的意思，
   * 而是该字段的标签语义与业务语义本就不同（如批号）。
   */
  autofill: boolean;
  /** 不可自动回填时，向用户解释原因 */
  hint?: string;
};

export type MaterialLabelOcrResult = {
  partNumber: LabelFieldSuggestion | null;
  brand: LabelFieldSuggestion | null;
  quantity: LabelFieldSuggestion | null;
  dateCode: LabelFieldSuggestion | null;
  packaging: LabelFieldSuggestion | null;
  /** 模型自评置信度 0~1，仅作参考，不用于放行判断 */
  confidence: number;
  /** 是否命中缓存（保留既有接口字段） */
  cached: boolean;
  /** 料号介质：现货核验只接受 printed / laser */
  markingSource: SpotMarkingSource;
};


export class MaterialLabelOcrError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MaterialLabelOcrError";
  }
}

/**
 * 图片体积上限。
 *
 * 与面单识别同口径（按 base64 长度换算真实字节数）。
 * 手机直拍常见 3~8MB，故要求小程序端先压缩至最长边 1600px ——
 * 该值来自面单识别的既有经验，实测足够识别标签文字。
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** 百炼视觉模型及 OpenAI 兼容接口均允许通过环境变量覆盖。 */
const MODEL = process.env.DASHSCOPE_OCR_MODEL?.trim() || "qwen3.8-flash";
export const MATERIAL_LABEL_OCR_MODEL = MODEL;
const DASHSCOPE_OCR_ENDPOINT =
  process.env.DASHSCOPE_OCR_ENDPOINT ||
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const REQUEST_TIMEOUT_MS = Number(
  process.env.DASHSCOPE_OCR_TIMEOUT_MS || 10_000
);
/** 最多重试一次；总等待约 20.5 秒，必须低于小程序 OCR 专用 25 秒超时。 */
const MAX_UPSTREAM_ATTEMPTS = 2;

/**
 * 单用户每小时识别次数上限。
 *
 * **不复用 `dailyQuota`（每日 500 次搜索/BOM 共用账本）**，理由：
 * 搜索查询成本几乎为零，而每次识别都调用 LLM 实际产生费用。
 * 若共用账本，商家发布 50 个物料就吃掉 10% 搜索额度 ——
 * 而发布库存恰是平台希望商家多做的事，等于惩罚正向行为。
 * 反之若只靠那 500 次约束，则一人每天可调 500 次付费识别，
 * 成本敞口过大。故单独设更严的小时级配额，与面单 OCR 同思路。
 *
 * **已知局限**：计数器为进程内内存，与 `dailyQuota` 同构。
 * 线上 4 实例 cluster 使实际阈值被放大约 4 倍（120 → 约 480）。
 * 本功能涉及真实费用，此敞口在接入 Redis 前客观存在，
 * 不要误以为限流是精确的。
 */
export const HOURLY_LIMIT = 120;

type HourBucket = { count: number; hour: string };
const hourBuckets = new Map<number, HourBucket>();

function hourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** 记一次识别并判断是否超限；true 表示应拒绝 */
export function labelOcrRateLimited(
  userId: number,
  now: Date = new Date()
): boolean {
  const hour = hourKey(now);
  const bucket = hourBuckets.get(userId);
  if (!bucket || bucket.hour !== hour) {
    hourBuckets.set(userId, { count: 1, hour });
    return 1 > HOURLY_LIMIT;
  }
  bucket.count += 1;
  return bucket.count > HOURLY_LIMIT;
}

/** 回退一次计数（命中缓存或未真实调用时，不应扣额度） */
export function refundLabelOcrQuota(
  userId: number,
  now: Date = new Date()
): void {
  const bucket = hourBuckets.get(userId);
  if (bucket && bucket.hour === hourKey(now) && bucket.count > 0)
    bucket.count -= 1;
}

/** 清理非当前小时的账本，防内存膨胀 */
setInterval(
  () => {
    const hour = hourKey(new Date());
    hourBuckets.forEach((b, id) => {
      if (b.hour !== hour) hourBuckets.delete(id);
    });
  },
  30 * 60 * 1000
).unref?.();

/** 测试辅助：清空限流账本 */
export function __resetLabelOcrQuota() {
  hourBuckets.clear();
}

/**
 * 同步配置门禁。模型目录健康检查由 availability 接口及上线探针执行，
 * 不在每次拍照前增加一次网络等待。明确模型失效时短期闭合门禁。
 */
export function isMaterialLabelOcrAvailable(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY?.trim()) &&
    !(ocrHealthCache && ocrHealthCache.keyHash === healthKey() && ocrHealthCache.expiresAt > Date.now() &&
      ["model_missing", "unauthorized"].includes(ocrHealthCache.status));
}

export type MaterialLabelOcrHealth = {
  enabled: boolean;
  status: "ready" | "not_configured" | "model_missing" | "unauthorized" | "unknown";
  model: string;
};
let ocrHealthCache: { status: MaterialLabelOcrHealth["status"]; expiresAt: number; keyHash: string } | undefined;
let ocrHealthPending: Promise<MaterialLabelOcrHealth> | undefined;
const healthKey = () => createHash("sha256").update(process.env.DASHSCOPE_API_KEY?.trim() || "").digest("hex");

/** 免费目录检查；目录故障不阻断实际识别，只有明确缺失/鉴权失败才禁用。 */
export async function checkMaterialLabelOcrHealth(): Promise<MaterialLabelOcrHealth> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  const result = (status: MaterialLabelOcrHealth["status"]): MaterialLabelOcrHealth => ({
    enabled: Boolean(apiKey) && !["model_missing", "unauthorized", "not_configured"].includes(status),
    status, model: MODEL,
  });
  if (!apiKey) return result("not_configured");
  const keyHash = healthKey();
  if (ocrHealthCache?.keyHash === keyHash && ocrHealthCache.expiresAt > Date.now()) return result(ocrHealthCache.status);
  if (ocrHealthPending) return ocrHealthPending;
  ocrHealthPending = (async () => {
    let status: MaterialLabelOcrHealth["status"] = "unknown";
    try {
      const endpoint = new URL(DASHSCOPE_OCR_ENDPOINT);
      if (!endpoint.pathname.endsWith("/chat/completions")) return result(status);
      endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions$/, "/models");
      const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 401 || response.status === 403) status = "unauthorized";
      else if (response.ok) {
        const body = await response.json() as { data?: Array<{ id?: string }> };
        if (Array.isArray(body.data)) status = body.data.some(row => row.id === MODEL) ? "ready" : "model_missing";
      }
    } catch {
      // A catalog timeout is not proof that the inference endpoint is down.
    }
    ocrHealthCache = { status, expiresAt: Date.now() + (status === "unknown" ? 15_000 : 60_000), keyHash };
    return result(status);
  })();
  try { return await ocrHealthPending; } finally { ocrHealthPending = undefined; }
}

/**
 * 品牌别名归一化。
 *
 * 标签印的是完整法定名（STMicroelectronics），
 * 而库内是简称且写法不统一（NXP / NXP(恩智浦)、INTEL / intel）。
 * 直接写入会加剧品牌字段混乱，故在此收敛到库内主流写法。
 *
 * 只收录**实测确认过**的映射，不做模糊猜测：
 * 猜错品牌比留空更糟，因为用户容易一眼扫过就确认提交。
 */
const BRAND_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^st\s*microelectronics$|^stmicro/i, "ST"],
  [/^nxp(\s+semiconductors?)?$/i, "NXP"],
  [/^intel(\s+corporation)?$/i, "INTEL"],
  [/^texas\s+instruments$|^ti$/i, "TI"],
  [/^infineon(\s+technologies)?$/i, "Infineon"],
  [/^microchip(\s+technology)?$/i, "Microchip"],
  [/^on\s*semiconductor$|^onsemi$/i, "onsemi"],
  [/^analog\s+devices$|^adi$/i, "ADI"],
  [/^renesas(\s+electronics)?$/i, "Renesas"],
  [/^toshiba$/i, "Toshiba"],
  [/^rohm(\s+semiconductor)?$/i, "ROHM"],
  [/^murata(\s+manufacturing)?$/i, "Murata"],
  [/^samsung(\s+electro-?mechanics)?$/i, "Samsung"],
  [/^yageo$/i, "YAGEO"],
  [/^vishay$/i, "Vishay"],
  [/^diodes(\s+incorporated)?$/i, "Diodes"],
  [/^espressif(\s+systems)?$/i, "Espressif"],
  [/^winbond(\s+electronics)?$/i, "Winbond"],
  [/^gigadevice$/i, "GigaDevice"],
  [/^altera$/i, "Altera"],
];

export function normalizeBrand(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(trimmed)) return canonical;
  }
  return trimmed;
}

/**
 * 把标签上的周批号尝试转成行业年份格式。
 *
 * 标签常见 `2319`（19 年第 23 周？还是 23 年第 19 周？）——
 * **这个歧义无法从数字本身消解**，不同厂商编码规则不同。
 * 故本函数只处理能明确判断的形式，其余一律返回空，
 * 由用户自行填写。宁可不填，也不能填错年份 ——
 * 年份直接影响器件价值判断，填错等同于以次充好。
 */
export function guessDateCode(raw: string): string {
  const trimmed = raw.trim();
  // 已是行业格式（22+ / 22+23+）则直接采用
  if (/^\d{2}\+(\d{2}\+)*$/.test(trimmed)) return trimmed;
  // 四位纯数字的年周码歧义无解，不猜
  return "";
}

function normalizeBase64(input: string): string {
  const trimmed = input.trim();
  const commaIndex = trimmed.indexOf(",");
  // 前端 FileReader.readAsDataURL 会带 data:image/...;base64, 头。
  // 统一在服务端剥离，前端传原样或去头都能工作，减少前后端约定出错。
  if (trimmed.startsWith("data:") && commaIndex > 0) {
    return trimmed.slice(commaIndex + 1).trim();
  }
  return trimmed;
}

export function imageHashOf(imageBase64: string): string {
  return createHash("sha256")
    .update(normalizeBase64(imageBase64), "utf8")
    .digest("hex");
}

const PROMPT = [
  "你是电子元器件仓储标签识别助手。只识别图中最主要的产品料号。",
  "",
  "要求：",
  "1. 料号必须逐字符照抄，包括所有连字符、斜杠和后缀（如 -TR、/3/1）。",
  "2. 绝不要补全、缩写或纠正你认为的拼写错误；一个字符之差就是不同器件。",
  "3. 若图中有多个标签或多个型号，只取最主要、字号最大的那个。",
  "4. 无法确认时将 partNumber 填空字符串，不要猜测。",
  "5. 不要识别品牌、数量、生产周期、封装或其他字段。",
  "6. markingSource 只能取 printed、laser、handwritten、screen、unknown 之一。",
  "   printed=原厂/包装印刷标签；laser=器件本体激光或丝印；handwritten=手写、便签、白纸；screen=屏幕或截图；看不清则 unknown。",
  "7. 只输出合法 JSON，不要输出 Markdown 或额外说明。",
  "JSON 字段固定为：partNumber、confidence、markingSource。",
  "partNumber 必须是字符串；confidence 必须是 0 到 1 的数字；markingSource 必须是上述枚举。",
].join("\n");

type RawLabelFields = {
  partNumber?: unknown;
  brand?: unknown;
  quantity?: unknown;
  dateCode?: unknown;
  packaging?: unknown;
  confidence?: unknown;
  markingSource?: unknown;
};

type DashScopeChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  request_id?: string;
  code?: string;
  message?: string;
};

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

function extractDashScopeContent(body: DashScopeChatResponse): string {
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (!part || typeof part !== "object") return "";
        const value = (part as { text?: unknown }).text;
        return typeof value === "string" ? value : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * JSON Object 模式正常应直接返回 JSON；这里仍兼容偶发的 Markdown 包裹，
 * 但绝不从任意自然语言中猜字段，避免把解释文字误当识别结果。
 */
export function parseLabelJson(rawText: string): RawLabelFields {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start)
      throw new Error("No JSON object in response");
    parsed = JSON.parse(stripped.slice(start, end + 1));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Response is not a JSON object");
  }
  return parsed as RawLabelFields;
}

async function callDashScopeVision(image: string): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new MaterialLabelOcrError(
      "OCR_NOT_CONFIGURED",
      "标签识别服务尚未配置，请手工填写"
    );
  }

  let lastError = new MaterialLabelOcrError("OCR_UPSTREAM_ERROR", "识别服务异常，请稍后再试");
  for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(DASHSCOPE_OCR_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${image}` },
                },
                { type: "text", text: PROMPT },
              ],
            },
          ],
          response_format: { type: "json_object" },
          enable_thinking: false,
          temperature: 0,
          max_tokens: 160,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        const body = (await response.json()) as DashScopeChatResponse;
        const content = extractDashScopeContent(body);
        ocrHealthCache = { status: "ready", expiresAt: Date.now() + 60_000, keyHash: healthKey() };
        console.info(
          `[MaterialLabelOcr] success time=${new Date().toISOString()} model=${MODEL} requestId=${body.request_id || response.headers.get("x-request-id") || "<missing>"} elapsedMs=${Date.now() - startedAt}`
        );
        return content;
      }

      const errorBody = await response.json().catch(() => ({})) as { error?: { code?: string }; code?: string; request_id?: string };
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      const code = response.status === 404 ? "OCR_MODEL_UNAVAILABLE" :
        response.status === 401 || response.status === 403 ? "OCR_AUTH_ERROR" :
        response.status === 429 ? "OCR_RATE_LIMITED" :
        response.status === 408 || response.status === 504 ? "OCR_TIMEOUT" : "OCR_UPSTREAM_ERROR";
      lastError = new MaterialLabelOcrError(code,
        code === "OCR_RATE_LIMITED" ? "识别服务繁忙，请稍后再试" :
        code === "OCR_TIMEOUT" ? "识别超时，请稍后重试" : "识别服务异常，请稍后再试");
      if (code === "OCR_MODEL_UNAVAILABLE" || code === "OCR_AUTH_ERROR") {
        ocrHealthCache = { status: code === "OCR_MODEL_UNAVAILABLE" ? "model_missing" : "unauthorized", expiresAt: Date.now() + 60_000, keyHash: healthKey() };
      }
      console.error(
        `[MaterialLabelOcr] failure time=${new Date().toISOString()} model=${MODEL} status=${response.status} code=${code} upstreamCode=${String(errorBody.error?.code || errorBody.code || "unknown").slice(0, 80)} requestId=${String(errorBody.request_id || response.headers.get("x-request-id") || "<missing>").slice(0, 120)} attempt=${attempt} elapsedMs=${Date.now() - startedAt}`
      );
      if (!retryable) throw lastError;
    } catch (error) {
      if (error instanceof MaterialLabelOcrError) throw error;
      const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      lastError = new MaterialLabelOcrError(timedOut ? "OCR_TIMEOUT" : "OCR_UPSTREAM_ERROR",
        timedOut ? "识别超时，请稍后重试" : "识别服务异常，请稍后再试");
      console.error(
        `[MaterialLabelOcr] failure time=${new Date().toISOString()} model=${MODEL} code=${lastError.code} attempt=${attempt} elapsedMs=${Date.now() - startedAt}`
      );
    }

    if (attempt < MAX_UPSTREAM_ATTEMPTS) {
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 把模型原始输出整理为带回填策略的建议结构 */
export function buildSuggestions(
  raw: RawLabelFields,
  cached: boolean
): MaterialLabelOcrResult {
  const partNumber = text(raw.partNumber);
  const confidenceValue =
    typeof raw.confidence === "number" ? raw.confidence : 0;
  const markingSource = SPOT_MARKING_SOURCES.includes(raw.markingSource as SpotMarkingSource)
    ? (raw.markingSource as SpotMarkingSource)
    : "unknown";

  return {
    partNumber: partNumber
      ? { raw: partNumber, suggested: partNumber, autofill: true }
      : null,
    // 旧字段保留为 null，兼容尚未升级的小程序和网页调用方。
    brand: null,
    quantity: null,
    dateCode: null,
    packaging: null,
    confidence: Math.max(0, Math.min(1, confidenceValue)),
    cached,
    markingSource,
  };
}

/**
 * 识别一张物料标签。
 *
 * @param imageBase64 图片 base64，可带或不带 data URI 头
 */
export async function recognizeMaterialLabel(
  imageBase64: string
): Promise<MaterialLabelOcrResult> {
  const image = normalizeBase64(imageBase64);
  if (!image) {
    throw new MaterialLabelOcrError("EMPTY_IMAGE", "未提供标签图片");
  }
  // base64 长度换算原始字节数：每 4 个字符对应 3 字节
  const approxBytes = Math.floor((image.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    const limitMb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1);
    throw new MaterialLabelOcrError(
      "IMAGE_TOO_LARGE",
      `标签图片超过 ${limitMb}MB，请压缩后重试`
    );
  }

  const rawText = await callDashScopeVision(image);
  if (!rawText.trim()) {
    throw new MaterialLabelOcrError(
      "OCR_EMPTY_RESPONSE",
      "未能识别标签内容，请换个角度重拍"
    );
  }

  let parsed: RawLabelFields;
  try {
    parsed = parseLabelJson(rawText);
  } catch {
    /*
     * JSON Object 模式理论上会返回合法 JSON；仍保留防御性处理，且不把
     * 上游原始内容抛给用户，避免模型内部输出或标签隐私泄露到界面。
     */
    console.error(`[MaterialLabelOcr] failure time=${new Date().toISOString()} model=${MODEL} code=OCR_BAD_RESPONSE`);
    throw new MaterialLabelOcrError(
      "OCR_BAD_RESPONSE",
      "标签识别结果解析失败，请重试或手工填写"
    );
  }

  const suggestions = buildSuggestions(parsed, false);
  if (!suggestions.partNumber) {
    throw new MaterialLabelOcrError(
      "PART_NUMBER_NOT_FOUND",
      "未能从标签中识别出料号，请确认拍摄清晰或手工填写"
    );
  }
  return suggestions;
}
