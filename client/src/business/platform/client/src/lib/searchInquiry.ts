import { createClientMessageId } from "./clientMessageId";

/**
 * 搜索/详情页 → 聊一聊 的询价意图传递。
 *
 * 意图通过 URL 参数传给 /chat，聊天页据此建会话并自动发出询价卡片。
 * 只传「商品坐标 + 用户填的数量 + 来源页」这类无法伪造获益的信息；
 * 买家身份、起订量、卖家在售量一律由服务端现查。
 */

/** 发起询价的页面，仅用于卡片上的来源提示 */
export type InquirySource = "search" | "detail" | "recommend" | "quote" | "data_hub" | "company";

const INQUIRY_SOURCES: InquirySource[] = ["search", "detail", "recommend", "quote", "data_hub", "company"];
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface SearchInquiryIntent {
  /** 旧链接兼容字段；新询价由服务端按库存负责人解析，不再依赖该值。 */
  userId?: number;
  /** 来源页当前已登录的买家；仅用于浏览器本地一次性意图，不能作为服务端身份。 */
  buyerUserId?: number;
  inventoryId: number;
  partNumber: string;
  /** 用户明确调整过的询价数量；未调整时为 null，进入聊天后再确认。 */
  qty: number | null;
  brand: string;
  pkg: string | null;
  /** 来源页；旧链接不带此参数，解析时为 undefined */
  source?: InquirySource;
  /**
   * 同一次点击的稳定幂等键。旧链接不带时仍可正常解析，聊天页再生成兼容键。
   * 新入口会在离开来源页前生成并写入 URL，因此新标签、刷新和重试均复用同一个 ID。
   */
  clientMessageId?: string;
}

function positiveInteger(value: string | null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function validClientMessageId(value: string | null) {
  const normalized = value?.trim() ?? "";
  return CLIENT_MESSAGE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

export function createSearchInquiryUrl(intent: SearchInquiryIntent) {
  const clientMessageId =
    validClientMessageId(intent.clientMessageId ?? null) ?? createClientMessageId("inq");
  const params = new URLSearchParams({
    inventoryId: String(intent.inventoryId),
    inquiryPart: intent.partNumber.trim(),
    inquiryBrand: intent.brand.trim(),
    inquiryId: clientMessageId,
  });
  // 仅来源页可为“新点击 + 当前买家”写入同源本地凭据；旧链接/存储失败不自动发。
  if (Number.isInteger(intent.buyerUserId) && (intent.buyerUserId ?? 0) > 0
    && Number.isInteger(intent.inventoryId) && intent.inventoryId > 0) {
    try {
      window.localStorage.setItem(`dianzi51-inquiry-intent:${clientMessageId}`, JSON.stringify({
        buyerUserId: intent.buyerUserId,
        inventoryId: intent.inventoryId,
        at: Date.now(),
      }));
      params.set("inquiryAuto", "1");
    } catch {
      // 未启用浏览器存储时仍允许打开聊天，但发送需在状态卡中手动确认。
    }
  }
  if (intent.qty != null) params.set("inquiryQty", String(intent.qty));
  if (intent.pkg?.trim()) params.set("inquiryPkg", intent.pkg.trim());
  if (intent.source) params.set("inquirySrc", intent.source);
  return `/chat?${params.toString()}`;
}

export function parseSearchInquiry(params: URLSearchParams): SearchInquiryIntent | null {
  const userId = positiveInteger(params.get("userId"));
  const inventoryId = positiveInteger(params.get("inventoryId"));
  const qty = positiveInteger(params.get("inquiryQty"));
  const partNumber = params.get("inquiryPart")?.trim() ?? "";
  const brand = params.get("inquiryBrand")?.trim() ?? "";
  const pkg = params.get("inquiryPkg")?.trim() || null;
  const clientMessageId = validClientMessageId(params.get("inquiryId"));
  /*
   * 来源是展示用的枚举，脏值直接丢弃而不是照搬：
   * 否则手改链接就能让卡片显示任意文案。
   */
  const rawSource = params.get("inquirySrc")?.trim() ?? "";
  const source = INQUIRY_SOURCES.includes(rawSource as InquirySource)
    ? (rawSource as InquirySource)
    : undefined;

  if (!inventoryId || !partNumber || !brand) return null;
  return {
    ...(userId ? { userId } : {}),
    inventoryId,
    partNumber,
    qty,
    brand,
    pkg,
    source,
    clientMessageId,
  };
}

export function buildInquiryKey(intent: SearchInquiryIntent) {
  return intent.clientMessageId ??
    `${intent.inventoryId}:${intent.partNumber}:${intent.qty ?? "pending"}`;
}

export function buildInquiryMessage(intent: SearchInquiryIntent) {
  const specification = [intent.brand, intent.pkg].filter(Boolean).join(" · ");
  const quantity = intent.qty == null
    ? "数量待确认"
    : `数量 ${intent.qty.toLocaleString("zh-CN")}片`;
  return `您好，我想询价 ${intent.partNumber}${specification ? `（${specification}）` : ""}，${quantity}。请告知价格、库存和交期。`;
}
