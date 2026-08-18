/**
 * 商城订单状态，必须与前台 `ORDER_STATUSES` 保持全集一致。
 *
 * `refunded`（退款完成终态）与 `refund`（退款申请中）是两个状态：
 * 前台 schema 已说明两者合并会让订单停在 refund 后没有出口。
 * 后台曾漏掉 refunded，导致平台第一笔退款完成后订单管理页整页白屏。
 */
export type PlatformOrderStatus =
  | "pending"
  | "paid"
  | "shipped"
  | "done"
  | "refund"
  | "cancel"
  | "refunded";

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

/**
 * 销售可见范围（后台销售工号集合）。
 *
 * ⚠️ undefined 与 [] 含义相反，绝不可在任何中间层用
 * `?? []` 或 `|| undefined` 折叠：
 *   undefined → 不限制（超级管理员）
 *   []        → 什么都看不到（未分配范围的账号）
 * 前一种误写成后一种会让超管订单页变空，
 * 后一种误写成前一种则是全量越权。
 */
export type PlatformSalesScope = string[] | undefined;

export type PlatformOrderStats = {
  totalOrders: number;
  grossAmount: string;
  buyerCount: number;
  sellerCount: number;
  todayOrders: number;
  sevenDayOrders: number;
  /*
   * 用 Partial：商城只返回存在订单的状态键，不会把零订单状态补齐。
   * 声明为完整 Record 会让调用方误以为每个键都在，
   * 直接取值参与运算就会得到 NaN（而且 tsc 不报错）。
   */
  statusCounts: Partial<Record<PlatformOrderStatus, number>>;
  statusAmounts: Partial<Record<PlatformOrderStatus, string>>;
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
  /**
   * 买家工商名称。
   * 个人买家或尚未提交企业资料时为 null，展示层需回退到联系人名。
   */
  buyerCompanyName: string | null;
  /** 归属销售姓名（来自买家企业资料的 salesOwner） */
  buyerSalesOwner: string | null;
  /** 归属销售工号，权限归属的唯一依据 */
  buyerSalesOwnerCode: string | null;
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
  procedure: "stats" | "list" | "detail",
  input: Record<string, unknown>,
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const headers = { "content-type": "application/json", "x-portal-key": key };
  const body = JSON.stringify({ "0": { json: input } });
  const url = `${baseUrl}/api/trpc/internalOrder.${procedure}`;
  const response = await fetch(`${url}?batch=1&input=${encodeURIComponent(body)}`, {
    headers,
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

/*
 * 以下三个函数均显式接收销售范围并原样下传。
 *
 * salesStaffCodes 为 undefined 时不会出现在 JSON 中，前台即视为不限制；
 * 为 [] 时会如实传递，前台返回空集/全零。两种语义的区分完全依赖于此，
 * 因此这里不能对参数做任何默认值处理。
 */
export function getPlatformOrderStats(
  salesStaffCodes?: PlatformSalesScope,
  filters: Omit<PlatformOrderListInput, "page" | "pageSize"> = {},
) {
  return callPlatformOrder<PlatformOrderStats>("stats", {
    ...filters,
    ...(salesStaffCodes === undefined ? {} : { salesStaffCodes }),
  });
}

export function listPlatformOrders(
  input: PlatformOrderListInput,
  salesStaffCodes?: PlatformSalesScope,
) {
  return callPlatformOrder<{ rows: PlatformOrderListRow[]; total: number }>("list", {
    ...input,
    ...(salesStaffCodes === undefined ? {} : { salesStaffCodes }),
  });
}

export function getPlatformOrderDetail(
  orderId: number,
  salesStaffCodes?: PlatformSalesScope,
) {
  return callPlatformOrder<PlatformOrderDetail>("detail", {
    orderId,
    ...(salesStaffCodes === undefined ? {} : { salesStaffCodes }),
  });
}
