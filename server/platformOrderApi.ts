export type PlatformOrderStatus = "pending" | "paid" | "shipped" | "done" | "refund" | "cancel";

export type PlatformOrderListInput = {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: PlatformOrderStatus;
  buyerId?: number;
  sellerId?: number;
  createdFrom?: number;
  createdTo?: number;
};

export type PlatformOrderListRow = {
  id: number;
  orderNo: string;
  batchId: number | null;
  batchSeq: number | null;
  batchNo: string | null;
  buyerId: number;
  buyerName: string | null;
  buyerUsername: string | null;
  sellerId: number;
  sellerName: string;
  status: PlatformOrderStatus;
  totalAmount: string;
  payMethod: "corp" | "alipay" | "wechat";
  receiver: string;
  receiverPhone: string;
  expressCo: string | null;
  expressNo: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type PlatformOrderDetail = {
  order: PlatformOrderListRow & Record<string, unknown> & {
    batchTotalAmount: string | null;
    batchCreatedAt: Date | string | null;
    receiverAddress: string;
    amountEx: string;
    taxAmount: string;
    shippingFee: string;
    note: string | null;
    statusNote: string | null;
  };
  items: Array<{
    id: number;
    materialCode: string | null;
    partNumber: string;
    brand: string;
    pkg: string | null;
    qty: number;
    unit: string;
    unitPrice: string;
    subtotal: string;
  }>;
  tracks: Array<{ id: number; content: string; createdAt: Date | string }>;
  siblings: Array<{
    id: number;
    orderNo: string;
    batchSeq: number | null;
    sellerId: number;
    sellerName: string;
    status: PlatformOrderStatus;
    totalAmount: string;
  }>;
};

type BatchResponse<T> = Array<{
  result?: { data?: { json?: T } | T };
  error?: { json?: { message?: string }; message?: string };
}>;

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接商城订单服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接商城订单服务");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}

async function callPlatformOrder<T>(
  procedure: "list" | "detail" | "transition",
  input: Record<string, unknown>,
  method: "query" | "mutation",
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const headers = { "content-type": "application/json", "x-portal-key": key };
  const body = JSON.stringify({ "0": { json: input } });
  const url = `${baseUrl}/api/trpc/internalOrder.${procedure}`;
  const response = method === "query"
    ? await fetch(`${url}?batch=1&input=${encodeURIComponent(body)}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
    : await fetch(`${url}?batch=1`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
  const payload = await response.json().catch(() => null) as BatchResponse<T> | null;
  const first = payload?.[0];
  if (!response.ok || first?.error) {
    const message = first?.error?.json?.message || first?.error?.message || `商城订单服务返回 ${response.status}`;
    throw new Error(message);
  }
  const data = first?.result?.data;
  if (!data) throw new Error("商城订单服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as T;
}

export function listPlatformOrders(input: PlatformOrderListInput) {
  return callPlatformOrder<{ rows: PlatformOrderListRow[]; total: number }>("list", input, "query");
}

export function getPlatformOrderDetail(orderId: number) {
  return callPlatformOrder<PlatformOrderDetail>("detail", { orderId }, "query");
}

export function transitionPlatformOrder(input: {
  orderId: number;
  action: "markPaid" | "cancel" | "ship" | "complete";
  operator: string;
  reason?: string;
  expressCo?: string;
  expressNo?: string;
}) {
  return callPlatformOrder<{ ok: true }>("transition", input, "mutation");
}
