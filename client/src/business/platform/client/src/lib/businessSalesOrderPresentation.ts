import {
  CRM_SALES_ORDER_STATUS_LABELS,
  CRM_SALES_PAYMENT_STATUS_LABELS,
  CRM_SALES_SHIPMENT_STATUS_LABELS,
  decimalToScaled,
  scaledToDecimal,
  type SalesOrderSummary,
  type SalesOrderDetail,
} from "../../../shared/crmSalesOrders";

export const BUSINESS_RECEIVER_MISSING = "未录入";
export const BUSINESS_AFTERSALE_MISSING = "尚未接入售后记录";
export const BUSINESS_READ_SCOPE_ERROR =
  "响应与当前客户或订单不一致，已停止展示与导出，请刷新重试。";
export type BusinessOrderExportMetadata = {
  receiver: string;
  receiverPhone: string;
  receiverAddress: string;
  afterSales: string;
};
export type BusinessOrderExportMetadataReader = (
  rows: readonly SalesOrderDetail[],
  guard: BusinessReadGuard
) => Promise<Map<number, BusinessOrderExportMetadata>>;
export type BusinessOrderFilters = {
  keyword: string;
  status?: "confirmed" | "cancelled";
  customerId?: number;
};
export type BusinessReadGuard = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};
export type BusinessOrderPage = { items: SalesOrderSummary[]; total: number };
export type BusinessOrderReaders = {
  list: (
    input: BusinessOrderFilters & { page: number; pageSize: number },
    signal: AbortSignal
  ) => Promise<BusinessOrderPage>;
  get: (
    input: { id: number; customerId?: number },
    signal: AbortSignal
  ) => Promise<SalesOrderDetail>;
};

export function assertBusinessReadCurrent(guard: BusinessReadGuard) {
  if (guard.signal.aborted || !guard.isCurrent())
    throw new Error("读取已取消或身份已变化，未生成文件。");
}
export function assertBusinessOrderSummary(
  row: SalesOrderSummary,
  filters: BusinessOrderFilters
) {
  if (
    !row ||
    !Number.isSafeInteger(row.id) ||
    row.id <= 0 ||
    !Number.isSafeInteger(row.customerId) ||
    row.customerId <= 0 ||
    (filters.customerId !== undefined &&
      row.customerId !== filters.customerId) ||
    (filters.status !== undefined && row.status !== filters.status)
  )
    throw new Error(BUSINESS_READ_SCOPE_ERROR);
  decimalToScaled(row.totalAmount);
}
export function assertBusinessOrderDetail(
  detail: SalesOrderDetail,
  order: Pick<SalesOrderSummary, "id" | "customerId">
) {
  if (
    !detail ||
    detail.id !== order.id ||
    detail.customerId !== order.customerId ||
    !Array.isArray(detail.items) ||
    !Array.isArray(detail.shipments)
  )
    throw new Error(BUSINESS_READ_SCOPE_ERROR);
}
/** Bounded reads; every worker stops on a failed sibling. Never returns partial data. */
export async function businessMapLimited<T, R>(
  values: readonly T[],
  read: (value: T) => Promise<R>,
  guard: BusinessReadGuard,
  concurrency = 3
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && cursor < values.length) {
      assertBusinessReadCurrent(guard);
      const index = cursor++;
      try {
        results[index] = await read(values[index]);
        assertBusinessReadCurrent(guard);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(Math.max(2, Math.min(4, concurrency)), values.length),
      },
      worker
    )
  );
  assertBusinessReadCurrent(guard);
  return results;
}
/** All pages of the applied filter, not the currently visible page. Offset drift fails closed. */
export async function collectBusinessOrderSummaries(
  readers: BusinessOrderReaders,
  filters: BusinessOrderFilters,
  guard: BusinessReadGuard,
  expectedTotal?: number
) {
  const pageSize = 50;
  const readPage = async (page: number) => {
    assertBusinessReadCurrent(guard);
    const result = await readers.list(
      { ...filters, page, pageSize },
      guard.signal
    );
    assertBusinessReadCurrent(guard);
    if (
      !result ||
      !Array.isArray(result.items) ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0
    )
      throw new Error(BUSINESS_READ_SCOPE_ERROR);
    result.items.forEach(row => assertBusinessOrderSummary(row, filters));
    return result;
  };
  const first = await readPage(1);
  if (expectedTotal !== undefined && first.total !== expectedTotal)
    throw new Error("筛选结果数量已变化，请刷新后重新统计或导出。");
  const pageCount = Math.ceil(first.total / pageSize);
  if (pageCount > 100000) throw new Error("筛选范围过大，请缩小范围后重试。");
  const rest = await businessMapLimited(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => i + 2),
    readPage,
    guard
  );
  const pages = [first, ...rest];
  pages.forEach((result, index) => {
    const expectedLength = Math.max(
      0,
      Math.min(pageSize, first.total - index * pageSize)
    );
    if (result.total !== first.total || result.items.length !== expectedLength)
      throw new Error("筛选结果在读取期间变化，未生成文件，请刷新后重试。");
  });
  const rows = pages.flatMap(result => result.items);
  if (new Set(rows.map(row => row.id)).size !== rows.length)
    throw new Error("分页结果存在重复订单，未生成文件，请刷新后重试。");
  assertBusinessReadCurrent(guard);
  return rows;
}
export async function collectBusinessOrderDetails(
  readers: BusinessOrderReaders,
  rows: readonly SalesOrderSummary[],
  guard: BusinessReadGuard
) {
  return businessMapLimited(
    rows,
    async order => {
      const detail = await readers.get(
        { id: order.id, customerId: order.customerId },
        guard.signal
      );
      assertBusinessReadCurrent(guard);
      assertBusinessOrderDetail(detail, order);
      // Export the latest exact order snapshot, never splice a stale amount with new items.
      assertBusinessOrderSummary(detail, { keyword: "" });
      return detail;
    },
    guard
  );
}
export function sumBusinessOrderAmounts(
  rows: readonly Pick<SalesOrderSummary, "totalAmount">[]
) {
  return scaledToDecimal(
    rows.reduce((sum, row) => sum + decimalToScaled(row.totalAmount), BigInt(0))
  );
}
export function businessOrderItemText(detail: Pick<SalesOrderDetail, "items">) {
  return detail.items
    .map(
      item =>
        `${item.partNumber} · ${[item.brand, item.pkg].filter(Boolean).join(" / ")} · ${item.orderedQty}${item.qtyUnit || "个"} × ${item.unitPrice}（含税）`
    )
    .join("\n");
}
export function businessOrderShipmentText(
  detail: Pick<SalesOrderDetail, "shipments">
) {
  return (
    detail.shipments
      .map(shipment =>
        shipment.deliveryMethod === "pickup"
          ? "上门自提"
          : `${shipment.expressCo || BUSINESS_RECEIVER_MISSING} · ${shipment.expressNo || BUSINESS_RECEIVER_MISSING}`
      )
      .join("\n") || "未录入物流"
  );
}
/** Reuses the project's quoted-cell / Blob CSV convention, with spreadsheet formula neutralization. */
export function businessCsvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f\u007f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function buildBusinessOrdersCsv(
  rows: readonly SalesOrderDetail[],
  metadata?: ReadonlyMap<number, BusinessOrderExportMetadata>
) {
  if (
    metadata &&
    rows.some(row => {
      const fields = metadata.get(row.id);
      return (
        !fields ||
        [
          fields.receiver,
          fields.receiverPhone,
          fields.receiverAddress,
          fields.afterSales,
        ].some(value => typeof value !== "string")
      );
    })
  )
    throw new Error("收货或售后记录读取不完整，未生成文件。");
  const header = [
    "订单号",
    "录入时间",
    "客户",
    "收货人",
    "收货电话",
    "收货地址",
    "需求号",
    "项目",
    "商品明细",
    "含税金额（元）",
    "配送 / 物流",
    "订单状态",
    "收款状态",
    "已收金额（元）",
    "月结金额（元）",
    "出货状态",
    "售后记录",
  ];
  const cells = rows.map(row => [
    row.orderNumber,
    row.createdAt,
    row.customerName,
    metadata?.get(row.id)?.receiver ?? BUSINESS_RECEIVER_MISSING,
    metadata?.get(row.id)?.receiverPhone ?? BUSINESS_RECEIVER_MISSING,
    metadata?.get(row.id)?.receiverAddress ?? BUSINESS_RECEIVER_MISSING,
    row.demandNo,
    row.projectName,
    businessOrderItemText(row),
    scaledToDecimal(decimalToScaled(row.totalAmount)),
    businessOrderShipmentText(row),
    CRM_SALES_ORDER_STATUS_LABELS[row.status],
    CRM_SALES_PAYMENT_STATUS_LABELS[row.paymentStatus],
    scaledToDecimal(decimalToScaled(row.paidAmount)),
    scaledToDecimal(decimalToScaled(row.monthlyAmount)),
    CRM_SALES_SHIPMENT_STATUS_LABELS[row.shipmentStatus],
    metadata?.get(row.id)?.afterSales ?? BUSINESS_AFTERSALE_MISSING,
  ]);
  return (
    "\ufeff" +
    [header, ...cells]
      .map(row => row.map(businessCsvCell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
export function downloadBusinessOrdersCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

/** One shared queue per mounted presentation caps list/get/export reads together.
 * Abort prevents a queued old generation from issuing any request. */
export function createBusinessOrderReadLimiter(concurrency = 3) {
  const limit = Math.max(2, Math.min(4, concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    while (active < limit && queue.length) queue.shift()!();
  };
  return function run<T>(
    read: () => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) {
          reject(new Error("读取已取消"));
          pump();
          return;
        }
        active++;
        void Promise.resolve()
          .then(() => {
            if (signal.aborted) throw new Error("读取已取消");
            return read();
          })
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      };
      const cancel = () => {
        const index = queue.indexOf(start);
        if (index >= 0) {
          queue.splice(index, 1);
          reject(new Error("读取已取消"));
        }
      };
      if (signal.aborted) {
        reject(new Error("读取已取消"));
        return;
      }
      signal.addEventListener("abort", cancel, { once: true });
      queue.push(start);
      pump();
    });
  };
}
