import { createHash } from "node:crypto";
import { ENV } from "../_core/env";
import {
  countWaybillOcrSince,
  getWaybillOcrRecordByHash,
  recordWaybillOcr,
} from "../db";
import {
  guessExpressCompanies,
  bestExpressGuess,
  type WaybillGuess,
} from "../../../shared/waybillPatterns";
import {
  Kuaidi100OcrError,
  isKuaidi100OcrConfigured,
  recognizeWaybillImage,
  type OcrRecognizeResult,
} from "./kuaidi100OcrGateway";

/**
 * 面单 OCR 业务层。
 *
 * 网关只管协议，这一层负责三件网关不该管的事：
 *
 * 1. **防重复扣费**：面单 OCR 是实时扣费产品，同一张图重复识别就是重复花钱。
 *    以图片内容哈希去重，命中则直接返回历史结果。
 * 2. **频率约束**：即使去重，不同图片的批量上传仍会持续扣费，
 *    因此对单个用户的时间窗内识别次数设上限。
 * 3. **补齐快递公司**：OCR 只返回运单号，快递公司需要本地规则推断。
 */

/** 单用户每小时允许的真实识别次数上限 */
const HOURLY_LIMIT = 60;

export type WaybillOcrView = {
  /** 运单号 */
  waybill: string;
  /**
   * 推断出的唯一快递公司；置信度不足时为 null，
   * 此时界面必须要求用户从 candidates 中选择。
   */
  expressCode: string | null;
  /** 快递公司候选列表，按置信度降序 */
  candidates: WaybillGuess[];
  /** 收件人信息，可用于核对地址是否与订单一致 */
  receiver: OcrRecognizeResult["receiver"];
  /** 寄件人信息 */
  sender: OcrRecognizeResult["sender"];
  /** 条形码，已去重 */
  barcodes: string[];
  /** 业务类型 */
  expType: string;
  /**
   * 结果是否来自历史记录。
   * true 表示本次未产生费用，界面可据此提示"该图片此前已识别"。
   */
  cached: boolean;
  /** 快递100 任务 ID，对账用 */
  taskId: string;
};

export class WaybillOcrDisabledError extends Error {
  constructor() {
    super("面单识别服务未启用");
    this.name = "WaybillOcrDisabledError";
  }
}

export class WaybillOcrRateLimitError extends Error {
  constructor(readonly limit: number) {
    super(`面单识别过于频繁，每小时上限 ${limit} 次，请稍后再试`);
    this.name = "WaybillOcrRateLimitError";
  }
}

/** 面单识别是否可用，供前端决定是否展示上传入口 */
export function isWaybillOcrAvailable(): boolean {
  return isKuaidi100OcrConfigured();
}

/**
 * 归一化前端传入的图片数据。
 *
 * 前端用 `FileReader.readAsDataURL` 得到的字符串带 `data:image/png;base64,` 头，
 * 而快递100 明确要求去头，否则返回 `400 图片base64格式错误`。
 * 这里统一在服务端剥离，前端传原样或去头都能工作，减少前后端约定出错的可能。
 */
function normalizeBase64(input: string): string {
  const trimmed = input.trim();
  const commaIndex = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && commaIndex > 0) {
    return trimmed.slice(commaIndex + 1).trim();
  }
  return trimmed;
}

function toView(
  result: OcrRecognizeResult,
  cached: boolean,
  presetExpressCode?: string | null,
): WaybillOcrView {
  const candidates = guessExpressCompanies(result.waybill);
  // 历史记录里已经存过推断结果时优先沿用，保证同一张图两次识别的展示一致
  const best = presetExpressCode ?? bestExpressGuess(result.waybill)?.code ?? null;
  return {
    waybill: result.waybill,
    expressCode: best,
    candidates,
    receiver: result.receiver,
    sender: result.sender,
    barcodes: result.barcodes,
    expType: result.expType,
    cached,
    taskId: result.taskId,
  };
}

/**
 * 识别一张面单图片。
 *
 * @param imageBase64 图片 base64，可带或不带 data URI 头
 * @param userId 发起识别的用户，用于频率约束与责任追溯
 */
export async function recognizeWaybill(
  imageBase64: string,
  userId: number,
): Promise<WaybillOcrView> {
  if (!isKuaidi100OcrConfigured()) {
    throw new WaybillOcrDisabledError();
  }

  const image = normalizeBase64(imageBase64);
  if (!image) {
    throw new Kuaidi100OcrError("EMPTY_IMAGE", "未提供面单图片", false);
  }

  // base64 长度换算原始字节数：每 4 个字符对应 3 字节
  const approxBytes = Math.floor((image.length * 3) / 4);
  if (approxBytes > ENV.kuaidi100OcrMaxBytes) {
    const limitMb = (ENV.kuaidi100OcrMaxBytes / 1024 / 1024).toFixed(1);
    throw new Kuaidi100OcrError(
      "IMAGE_TOO_LARGE",
      `面单图片超过 ${limitMb}MB，请压缩后重新上传`,
      false,
    );
  }

  const imageHash = createHash("sha256").update(image, "utf8").digest("hex");

  // 去重检查必须在调用网关之前：命中即省下一次实时扣费
  const existing = await getWaybillOcrRecordByHash(imageHash);
  if (existing) {
    try {
      const payload = JSON.parse(existing.payload) as OcrRecognizeResult;
      return toView(payload, true, existing.expressCode ?? null);
    } catch {
      // 历史记录损坏时不阻塞用户，继续走真实识别覆盖掉坏数据
    }
  }

  // 频率约束放在去重之后：重复上传同一张图不应计入配额，因为它并不产生费用
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await countWaybillOcrSince(userId, since);
  if (recent >= HOURLY_LIMIT) {
    throw new WaybillOcrRateLimitError(HOURLY_LIMIT);
  }

  const result = await recognizeWaybillImage({ imageBase64: image });
  const guess = bestExpressGuess(result.waybill);

  // 落库失败不应让用户白丢一次已扣费的识别结果，因此吞掉写库异常只记日志
  try {
    await recordWaybillOcr({
      imageHash,
      waybill: result.waybill,
      expressCode: guess?.code ?? null,
      payload: JSON.stringify(result),
      taskId: result.taskId || null,
      userId,
    });
  } catch (error) {
    console.error(
      "[WaybillOcr] 识别结果落库失败，本次结果仍返回给用户：",
      error instanceof Error ? error.message : error,
    );
  }

  return toView(result, false, guess?.code ?? null);
}
