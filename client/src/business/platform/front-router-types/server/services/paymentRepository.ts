import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  calcSummary,
  genOrderNo,
  hasSellingPrice,
  normalizeLadder,
  round2,
  unitPriceOf,
  type DeliveryMethod,
} from "../../../shared/cartUtils";
import {
  addresses,
  cartItems,
  checkoutSessions,
  companies,
  inventories,
  orderItems,
  orders,
  orderContractRecords,
  orderTracks,
  paymentBatchOrders,
  paymentBatches,
  sellerPickupPoints,
  users,
  type PaymentBatch,
  type PaymentBatchStatus,
} from "../../drizzle/schema";
import { getDb, inventoryCheckoutFingerprint } from "../db";
import {
  ORDER_CONTRACT_TEMPLATE_VERSION,
  orderContractNo,
} from "../../../shared/orderContractPolicy";
import {
  resolveSupplierDisplayName,
  SUPPLIER_NAME_FALLBACK,
} from "../../../shared/supplierDisplayName";
import { resolveFlexiblePickupDetails } from "../../../shared/pickupPolicy";
import { stockChangeMessage } from "../../../shared/cartStock";
import {
  InventoryReservationError,
  reserveInventoryStock,
  restoreInventoryStockForOrders,
} from "./inventoryStock";

export class CheckoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutValidationError";
  }
}

function insertIdOf(result: unknown) {
  return Number((result as Array<{ insertId?: number }>)[0]?.insertId ?? 0);
}

function moneyToCents(value: string | number) {
  const normalized = typeof value === "number" ? value.toFixed(2) : value;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized.trim());
  if (!match) throw new Error("invalid money value");
  const cents = Number(match[2]) * 100 + Number((match[3] || "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

export type SellerDeliverySelection = {
  sellerId: number;
  method: DeliveryMethod;
  addressId?: number;
  pickupPointId?: number;
  contactName?: string;
  contactPhone?: string;
};

export type CreatedCheckoutOrder = {
  id: number;
  orderNo: string;
  sellerId: number;
  sellerName: string;
  total: number;
  deliveryMethod: DeliveryMethod;
  shippingFee: number;
  pickupPointName: string | null;
  pickupAddress: string | null;
  corpPayeeMode: "platform_legacy" | "seller_direct";
  payeeCompanyId: number | null;
  payeeAccountName: string | null;
  payeeAccountNumber: string | null;
  payeeBankName: string | null;
  payeeReviewedAt: Date | null;
};

export type ReservedCheckoutResult = {
  paymentBatchId: number | null;
  paymentNo: string;
  amount: string;
  orders: CreatedCheckoutOrder[];
  reused?: boolean;
};

function checkoutRequestHash(input: {
  payMethod: "corp" | CheckoutProvider;
  addressId?: number;
  note?: string;
  deliveryMethod?: DeliveryMethod;
  deliveries?: SellerDeliverySelection[];
  wechatTradeType?: "NATIVE" | "JSAPI";
}) {
  const deliveries = (input.deliveries || [])
    .map(selection => ({
      sellerId: selection.sellerId,
      method: selection.method,
      addressId: selection.addressId ?? null,
      pickupPointId: selection.pickupPointId ?? null,
      contactName: selection.contactName?.trim() || null,
      contactPhone: selection.contactPhone?.trim() || null,
    }))
    .sort((a, b) => a.sellerId - b.sellerId);
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        payMethod: input.payMethod,
        wechatTradeType: input.wechatTradeType ?? null,
        addressId: input.addressId ?? null,
        note: input.note?.trim() || null,
        deliveryMethod: input.deliveryMethod ?? "express",
        deliveries,
      }),
    )
    .digest("hex");
}

function isReservedCheckoutResult(value: unknown): value is ReservedCheckoutResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ReservedCheckoutResult>;
  return (
    (result.paymentBatchId === null || Number.isInteger(result.paymentBatchId)) &&
    typeof result.paymentNo === "string" &&
    typeof result.amount === "string" &&
    Array.isArray(result.orders) &&
    result.orders.every(order =>
      Boolean(order) &&
      Number.isInteger(order.id) &&
      typeof order.orderNo === "string" &&
      Number.isInteger(order.sellerId) &&
      typeof order.total === "number",
    )
  );
}

export type PaymentBatchWithRemaining = PaymentBatch & {
  remainingSeconds: number;
};

const remainingSecondsExpression = sql<number>`
  GREATEST(0, TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, ${paymentBatches.expiresAt}))
`;

function withRemainingSeconds(
  batch: PaymentBatch,
  remainingSeconds: unknown,
): PaymentBatchWithRemaining {
  const parsed = Number(remainingSeconds);
  return {
    ...batch,
    remainingSeconds: Number.isFinite(parsed) ? Math.max(0, Math.min(300, parsed)) : 0,
  };
}

export type CheckoutProvider = "alipay" | "wechat";

async function createReservedCheckout(input: {
  buyerId: number;
  checkoutToken?: string;
  addressId?: number;
  note?: string;
  payMethod: "corp" | CheckoutProvider;
  deliveryMethod?: DeliveryMethod;
  deliveries?: SellerDeliverySelection[];
  paymentNo?: string;
  expiresInSeconds?: number;
  provider?: CheckoutProvider;
  wechatTradeType?: "NATIVE" | "JSAPI";
}) {
  const isOnlinePayment = input.payMethod === "alipay" || input.payMethod === "wechat";
  const legacyDeliveryMethod: DeliveryMethod = input.deliveryMethod ?? "express";
  const sellerSplitDelivery = Array.isArray(input.deliveries) && input.deliveries.length > 0;
  const requestHash = checkoutRequestHash(input);
  if (
    isOnlinePayment &&
    (!input.paymentNo ||
      !input.provider ||
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds! < 1 ||
      input.expiresInSeconds! > 3600)
  ) {
    throw new Error("支付有效期配置无效");
  }
  if (input.provider === "wechat" && !input.wechatTradeType) {
    throw new Error("微信支付交易类型缺失");
  }
  if (input.provider !== "wechat" && input.wechatTradeType) {
    throw new Error("非微信支付不能设置微信交易类型");
  }
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  try {
    return await db.transaction(async tx => {
    let checkoutSessionId = 0;
    let checkoutSnapshots: Array<{
      cartItemId: number;
      inventoryId: number;
      qty: number;
      inventoryFingerprint: string;
    }> = [];
    if (input.checkoutToken) {
      const [checkoutSession] = await tx
        .select()
        .from(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.token, input.checkoutToken),
            eq(checkoutSessions.buyerId, input.buyerId),
          ),
        )
        .limit(1)
        .for("update");
      if (!checkoutSession) throw new CheckoutValidationError("结算信息已失效，请重新确认");
      if (
        (checkoutSession.requestHash && checkoutSession.requestHash !== requestHash) ||
        (checkoutSession.payMethod && checkoutSession.payMethod !== input.payMethod)
      ) {
        throw new CheckoutValidationError("本次结算信息已变化，请重新确认");
      }
      if (checkoutSession.status === "completed" && checkoutSession.response) {
        if (!isReservedCheckoutResult(checkoutSession.response)) {
          throw new Error("结算幂等记录无效");
        }
        return { ...checkoutSession.response, reused: true };
      }
      if (checkoutSession.status !== "prepared") {
        throw new CheckoutValidationError(
          checkoutSession.status === "processing"
            ? "订单正在提交，请稍后到订单中心查看"
            : checkoutSession.failureMessage || "结算信息已失效，请重新确认",
        );
      }
      if (new Date(checkoutSession.expiresAt).getTime() <= Date.now()) {
        await tx
          .update(checkoutSessions)
          .set({ status: "failed", failureMessage: "结算已过期" })
          .where(eq(checkoutSessions.id, checkoutSession.id));
        throw new CheckoutValidationError("结算已过期，请重新确认");
      }
      checkoutSessionId = Number(checkoutSession.id);
      checkoutSnapshots = Array.isArray(checkoutSession.items) ? checkoutSession.items : [];
      if (checkoutSnapshots.length === 0) {
        throw new CheckoutValidationError("结算信息已失效，请重新确认");
      }
      await tx
        .update(checkoutSessions)
        .set({
          status: "processing",
          requestHash,
          payMethod: input.payMethod,
          failureMessage: null,
        })
        .where(eq(checkoutSessions.id, checkoutSession.id));
    }
    if (isOnlinePayment) {
      const [existingBatch] = await tx
        .select({ id: paymentBatches.id })
        .from(paymentBatches)
        .where(eq(paymentBatches.paymentNo, input.paymentNo!))
        .limit(1)
        .for("update");
      if (existingBatch) throw new Error("支付号冲突，请重试");
    }

    const [buyerPartyRow] = await tx
      .select({
        userId: users.id,
        userName: users.name,
        username: users.username,
        companyName: companies.companyName,
        creditCode: companies.creditCode,
        legalPerson: companies.legalPerson,
        regAddress: companies.regAddress,
        reviewStatus: companies.reviewStatus,
      })
      .from(users)
      .leftJoin(companies, eq(companies.userId, users.id))
      .where(eq(users.id, input.buyerId))
      .limit(1);
    if (!buyerPartyRow) throw new CheckoutValidationError("买家账号不存在");
    const buyerCompanyApproved = buyerPartyRow.reviewStatus === "approved";
    const buyerParty = {
      name:
        (buyerCompanyApproved ? buyerPartyRow.companyName?.trim() : "") ||
        buyerPartyRow.userName?.trim() ||
        buyerPartyRow.username?.trim() ||
        `用户#${input.buyerId}`,
      creditCode: buyerCompanyApproved ? buyerPartyRow.creditCode?.trim() || null : null,
      address: buyerCompanyApproved ? buyerPartyRow.regAddress?.trim() || null : null,
      legalPerson: buyerCompanyApproved ? buyerPartyRow.legalPerson?.trim() || null : null,
    };

    const checkoutCartIds = checkoutSnapshots.map(item => Number(item.cartItemId));
    const selectedCart = await tx
      .select()
      .from(cartItems)
      .where(
        input.checkoutToken
          ? and(eq(cartItems.userId, input.buyerId), inArray(cartItems.id, checkoutCartIds))
          : and(eq(cartItems.userId, input.buyerId), eq(cartItems.checked, true)),
      )
      .for("update");
    if (selectedCart.length === 0) throw new CheckoutValidationError("没有待结算的商品");
    if (input.checkoutToken) {
      const snapshotById = new Map(checkoutSnapshots.map(item => [Number(item.cartItemId), item]));
      const changed =
        selectedCart.length !== checkoutSnapshots.length ||
        selectedCart.some(item => {
          const snapshot = snapshotById.get(Number(item.id));
          return (
            !snapshot ||
            Number(snapshot.inventoryId) !== Number(item.inventoryId) ||
            Number(snapshot.qty) !== Number(item.qty)
          );
        });
      if (changed) throw new CheckoutValidationError("商品信息已变化，请重新确认");
    }

    const inventoryIds = Array.from(new Set(selectedCart.map(item => item.inventoryId))).sort(
      (a, b) => a - b,
    );
    const lockedInventories = await tx
      .select()
      .from(inventories)
      .where(inArray(inventories.id, inventoryIds))
      .for("update");
    if (lockedInventories.length !== new Set(inventoryIds).size) {
      throw new CheckoutValidationError("部分商品已不存在，请刷新购物车后重试");
    }
    if (input.checkoutToken) {
      const inventoryById = new Map(lockedInventories.map(item => [Number(item.id), item]));
      const termsChanged = checkoutSnapshots.some(snapshot => {
        const inventory = inventoryById.get(Number(snapshot.inventoryId));
        return (
          !inventory ||
          inventoryCheckoutFingerprint({
            priceEx: inventory.priceEx,
            taxIncluded: inventory.taxIncluded,
            ladderPrices: inventory.ladderPrices,
            moq: inventory.moq,
            status: inventory.status,
          }) !== snapshot.inventoryFingerprint
        );
      });
      if (termsChanged) throw new CheckoutValidationError("商品价格或交易信息已变化，请重新确认");
    }

    const sellerIds = Array.from(new Set(lockedInventories.map(item => item.userId)));
    const deliveryBySeller = new Map<number, SellerDeliverySelection>();
    if (sellerSplitDelivery) {
      for (const selection of input.deliveries || []) {
        if (deliveryBySeller.has(selection.sellerId)) {
          throw new CheckoutValidationError("同一卖家不能重复设置配送方式");
        }
        deliveryBySeller.set(selection.sellerId, selection);
      }
      if (
        deliveryBySeller.size !== sellerIds.length ||
        sellerIds.some(sellerId => !deliveryBySeller.has(sellerId)) ||
        Array.from(deliveryBySeller.keys()).some(sellerId => !sellerIds.includes(sellerId))
      ) {
        throw new CheckoutValidationError("配送信息已变化，请刷新购物车");
      }
    } else {
      if (!input.addressId) throw new CheckoutValidationError("请先添加并选择收货地址");
      for (const sellerId of sellerIds) {
        deliveryBySeller.set(sellerId, {
          sellerId,
          method: legacyDeliveryMethod,
          addressId: input.addressId,
        });
      }
    }

    const addressIds = Array.from(
      new Set(
        Array.from(deliveryBySeller.values())
          .filter(selection => selection.method === "express" || !sellerSplitDelivery)
          .map(selection => selection.addressId || input.addressId)
          .filter((id): id is number => Number.isInteger(id)),
      ),
    );
    const addressRows = addressIds.length
      ? await tx
          .select()
          .from(addresses)
          .where(and(inArray(addresses.id, addressIds), eq(addresses.userId, input.buyerId)))
      : [];
    const addressById = new Map(addressRows.map(address => [address.id, address]));
    if (addressRows.length !== addressIds.length) {
      throw new CheckoutValidationError("收货地址不存在，请重新选择");
    }

    const pickupPointIds = Array.from(
      new Set(
        Array.from(deliveryBySeller.values())
          .filter(selection => selection.method === "pickup" && sellerSplitDelivery)
          .map(selection => selection.pickupPointId)
          .filter((id): id is number => Number.isInteger(id)),
      ),
    );
    const pickupPointRows = pickupPointIds.length
      ? await tx
          .select()
          .from(sellerPickupPoints)
          .where(
            and(
              inArray(sellerPickupPoints.id, pickupPointIds),
              eq(sellerPickupPoints.enabled, true),
            ),
          )
      : [];
    const pickupPointById = new Map(pickupPointRows.map(point => [point.id, point]));

    const sellerRows = await tx
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(inArray(users.id, sellerIds));
    /*
     * 订单快照的卖家名必须与全站同口径（见 shared/supplierDisplayName.ts）。
     * 早期此处只查 users 表、不查 companies，导致下单时写入的是卖家个人姓名（如 victor），
     * 而订单名一旦落库就是历史快照，事后无法随企业资料更新而纠正。
     */
    const sellerCompanyRows = await tx
      .select({
        id: companies.id,
        userId: companies.userId,
        companyName: companies.companyName,
        creditCode: companies.creditCode,
        legalPerson: companies.legalPerson,
        regAddress: companies.regAddress,
        bankAccountName: companies.bankAccountName,
        bankAccountNumber: companies.bankAccountNumber,
        bankName: companies.bankName,
        reviewStatus: companies.reviewStatus,
        reviewedAt: companies.reviewedAt,
      })
      .from(companies)
      .where(inArray(companies.userId, sellerIds));
    const companyByUserId = new Map(sellerCompanyRows.map(row => [row.userId, row]));
    const companyNameByUserId = new Map(
      sellerCompanyRows.map(row => [row.userId, row.companyName]),
    );
    const sellerNameById = new Map(
      sellerRows.map(seller => [
        seller.id,
        resolveSupplierDisplayName({
          companyName: companyNameByUserId.get(seller.id),
          userName: seller.name,
          username: seller.username,
        }),
      ]),
    );

    const checkoutRows = selectedCart.map(cart => {
      const inventory = lockedInventories.find(item => item.id === cart.inventoryId);
      if (!inventory || inventory.status !== "published") {
        throw new CheckoutValidationError("部分商品已下架，请刷新购物车后重试");
      }
      if (!hasSellingPrice(inventory.priceEx, inventory.ladderPrices)) {
        throw new CheckoutValidationError(
          `商品「${inventory.partNumber}」价格面议，无法直接下单`,
        );
      }
      if (cart.qty <= 0 || inventory.qtyOnSale < cart.qty) {
        throw new CheckoutValidationError(
          stockChangeMessage(inventory.partNumber, inventory.qtyOnSale),
        );
      }
      const ladder = normalizeLadder(inventory.ladderPrices, inventory.priceEx, inventory.moq);
      return {
        cart,
        inventory,
        sellerName: sellerNameById.get(inventory.userId) || SUPPLIER_NAME_FALLBACK,
        unitPrice: unitPriceOf(ladder, cart.qty),
      };
    });

    /* 同一公司不同员工负责的库存拆成独立订单，避免履约任务落到错误员工。 */
    const bySellerAndHandler = new Map<string, typeof checkoutRows>();
    for (const row of checkoutRows) {
      const handlerUserId = Number(row.inventory.ownerUserId || row.inventory.userId);
      const groupKey = `${row.inventory.userId}:${handlerUserId}`;
      const sellerRowsForOrder = bySellerAndHandler.get(groupKey) || [];
      sellerRowsForOrder.push(row);
      bySellerAndHandler.set(groupKey, sellerRowsForOrder);
    }

    const handlerIds = Array.from(
      new Set(lockedInventories.map(item => Number(item.ownerUserId || item.userId))),
    );
    const handlerRows = handlerIds.length
      ? await tx
          .select({ id: users.id, name: users.name, username: users.username })
          .from(users)
          .where(inArray(users.id, handlerIds))
      : [];
    const handlerNameById = new Map(
      handlerRows.map(handler => [
        handler.id,
        handler.name?.trim() || handler.username?.trim() || `用户${handler.id}`,
      ]),
    );

    const preparedOrders = [] as Array<{
      orderNo: string;
      sellerId: number;
      sellerName: string;
      handlerUserId: number;
      handlerName: string;
      rows: typeof checkoutRows;
      summary: ReturnType<typeof calcSummary>;
      payee: {
        companyId: number;
        accountName: string;
        accountNumber: string;
        bankName: string;
        reviewedAt: Date | null;
      } | null;
      sellerParty: {
        name: string;
        creditCode: string | null;
        address: string | null;
        legalPerson: string | null;
      };
      delivery: {
        method: DeliveryMethod;
        receiver: string;
        phone: string;
        address: string;
        pickupPoint: {
          id: number | null;
          name: string;
          address: string;
          contactName: string;
          contactPhone: string;
          businessHours: string | null;
        } | null;
      };
    }>;
    for (const rows of Array.from(bySellerAndHandler.values())) {
      const sellerId = Number(rows[0].inventory.userId);
      const handlerUserId = Number(rows[0].inventory.ownerUserId || sellerId);
      let orderNo = "";
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = genOrderNo();
        const [duplicate] = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.orderNo, candidate))
          .limit(1);
        if (!duplicate) {
          orderNo = candidate;
          break;
        }
      }
      if (!orderNo) throw new Error("订单号生成失败，请重试");
      const sellerName = rows[0].sellerName;
      const company = companyByUserId.get(sellerId);
      let payee: (typeof preparedOrders)[number]["payee"] = null;
      if (input.payMethod === "corp") {
        const accountName = company?.bankAccountName?.trim();
        const accountNumber = company?.bankAccountNumber?.trim();
        const bankName = company?.bankName?.trim();
        if (
          !company ||
          company.reviewStatus !== "approved" ||
          !company.companyName?.trim() ||
          !accountName ||
          !accountNumber ||
          !bankName
        ) {
          throw new CheckoutValidationError(
            `卖家“${sellerName}”尚未完成对公收款账户审核，请改用在线支付或移除该卖家商品`,
          );
        }
        payee = {
          companyId: company.id,
          accountName,
          accountNumber,
          bankName,
          reviewedAt: company.reviewedAt,
        };
      }
      const sellerCompanyApproved = company?.reviewStatus === "approved";
      const selection = deliveryBySeller.get(sellerId)!;
      let delivery: (typeof preparedOrders)[number]["delivery"];
      if (selection.method === "pickup" && sellerSplitDelivery) {
        const pickupPoint = selection.pickupPointId
          ? pickupPointById.get(selection.pickupPointId)
          : undefined;
        if (selection.pickupPointId && (!pickupPoint || pickupPoint.sellerId !== sellerId)) {
          throw new CheckoutValidationError(`卖家“${sellerName}”的甲方自提信息无效，请重新确认`);
        }
        const pickupDelivery = resolveFlexiblePickupDetails({
          contactName: selection.contactName,
          contactPhone: selection.contactPhone,
          pickupPoint,
        });
        if (!pickupDelivery) {
          throw new CheckoutValidationError(`卖家“${sellerName}”的甲方自提信息无效，请重新确认`);
        }
        delivery = pickupDelivery;
      } else {
        const addressId = selection.addressId || input.addressId;
        const address = addressId ? addressById.get(addressId) : undefined;
        if (!address) throw new CheckoutValidationError("请先添加并选择收货地址");
        delivery = {
          method: selection.method,
          receiver: address.receiver,
          phone: address.phone,
          address: `${address.region} ${address.detail}`,
          pickupPoint: null,
        };
      }
      preparedOrders.push({
        orderNo,
        sellerId,
        sellerName,
        handlerUserId,
        handlerName: handlerNameById.get(handlerUserId) || sellerName,
        rows,
        summary: calcSummary(
          rows.map(row => ({ qty: row.cart.qty, unitPrice: row.unitPrice })),
          delivery.method,
        ),
        payee,
        delivery,
        sellerParty: {
          name: (sellerCompanyApproved ? company?.companyName?.trim() : "") || sellerName,
          creditCode: sellerCompanyApproved ? company?.creditCode?.trim() || null : null,
          address: sellerCompanyApproved ? company?.regAddress?.trim() || null : null,
          legalPerson: sellerCompanyApproved ? company?.legalPerson?.trim() || null : null,
        },
      });
    }

    const totalCents = preparedOrders.reduce(
      (sum, order) => sum + Math.round(order.summary.total * 100),
      0,
    );
    if (totalCents < 1) throw new CheckoutValidationError("订单金额无效");

    let paymentBatchId = 0;
    if (isOnlinePayment) {
      const batchInsert = await tx.insert(paymentBatches).values({
        paymentNo: input.paymentNo!,
        buyerId: input.buyerId,
        provider: input.provider!,
        wechatTradeType: input.wechatTradeType,
        // 二级商户尚未完成渠道进件，当前在线支付仍明确走平台商户。
        routingMode: "platform_legacy",
        sellerId: null,
        subMerchantId: null,
        status: "creating",
        amount: centsToMoney(totalCents),
        currency: "CNY",
        expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${input.expiresInSeconds!} SECOND)`,
      });
      paymentBatchId = insertIdOf(batchInsert);
      if (!paymentBatchId) throw new Error("支付批次创建失败");
    }

    const createdOrders: CreatedCheckoutOrder[] = [];
    for (const prepared of preparedOrders) {
      const orderInsert = await tx.insert(orders).values({
        orderNo: prepared.orderNo,
        buyerId: input.buyerId,
        sellerId: prepared.sellerId,
        sellerName: prepared.sellerName,
        handlerUserId: prepared.handlerUserId,
        handlerNameSnapshot: prepared.handlerName,
        status: "pending",
        amountEx: prepared.summary.amountEx.toFixed(2),
        taxAmount: prepared.summary.tax.toFixed(2),
        shippingFee: prepared.summary.shipping.toFixed(2),
        totalAmount: prepared.summary.total.toFixed(2),
        payMethod: input.payMethod,
        deliveryMethod: prepared.delivery.method,
        deliveryPlanMode: sellerSplitDelivery ? "seller_split" : "legacy_global",
        note: input.note || null,
        receiver: prepared.delivery.receiver,
        receiverPhone: prepared.delivery.phone,
        receiverAddress: prepared.delivery.address,
        pickupPointId: prepared.delivery.pickupPoint?.id ?? null,
        pickupPointName: prepared.delivery.pickupPoint?.name ?? null,
        pickupAddress: prepared.delivery.pickupPoint?.address ?? null,
        pickupContact: prepared.delivery.pickupPoint?.contactName ?? null,
        pickupPhone: prepared.delivery.pickupPoint?.contactPhone ?? null,
        pickupBusinessHours: prepared.delivery.pickupPoint?.businessHours ?? null,
        corpPayeeMode: input.payMethod === "corp" ? "seller_direct" : "platform_legacy",
        payeeCompanyId: prepared.payee?.companyId ?? null,
        payeeAccountName: prepared.payee?.accountName ?? null,
        payeeAccountNumber: prepared.payee?.accountNumber ?? null,
        payeeBankName: prepared.payee?.bankName ?? null,
        payeeReviewedAt: prepared.payee?.reviewedAt ?? null,
      });
      const orderId = insertIdOf(orderInsert);
      if (!orderId) throw new Error("订单创建失败");

      await tx.insert(orderContractRecords).values({
        orderId,
        contractNo: orderContractNo(prepared.orderNo),
        templateVersion: ORDER_CONTRACT_TEMPLATE_VERSION,
        buyerName: buyerParty.name,
        buyerCreditCode: buyerParty.creditCode,
        buyerAddress: buyerParty.address,
        buyerLegalPerson: buyerParty.legalPerson,
        sellerName: prepared.sellerParty.name,
        sellerCreditCode: prepared.sellerParty.creditCode,
        sellerAddress: prepared.sellerParty.address,
        sellerLegalPerson: prepared.sellerParty.legalPerson,
        payeeAccountName: prepared.payee?.accountName ?? null,
        payeeAccountNumber: prepared.payee?.accountNumber ?? null,
        payeeBankName: prepared.payee?.bankName ?? null,
      });

      await tx.insert(orderItems).values(
        prepared.rows.map(row => ({
          orderId,
          inventoryId: row.inventory.id,
          partNumber: row.inventory.partNumber,
          brand: row.inventory.brand,
          pkg: row.inventory.pkg,
          prodYear: row.inventory.prodYear,
          params: row.inventory.note?.slice(0, 250) ?? null,
          unit: "颗",
          qty: row.cart.qty,
          unitPrice: row.unitPrice.toFixed(4),
          subtotal: round2(row.unitPrice * row.cart.qty).toFixed(2),
        })),
      );
      await tx.insert(orderTracks).values({
        orderId,
        content:
          input.payMethod === "corp"
            ? `订单已提交，等待向卖家“${prepared.sellerName}”的对公账户转账`
            : input.payMethod === "wechat"
              ? "订单已提交，等待微信付款（5 分钟内有效）"
              : "订单已提交，等待支付宝付款（5 分钟内有效）",
      });
      if (paymentBatchId) {
        await tx.insert(paymentBatchOrders).values({ paymentBatchId, orderId });
      }
      createdOrders.push({
        id: orderId,
        orderNo: prepared.orderNo,
        sellerId: prepared.sellerId,
        sellerName: prepared.sellerName,
        total: prepared.summary.total,
        deliveryMethod: prepared.delivery.method,
        shippingFee: prepared.summary.shipping,
        pickupPointName: prepared.delivery.pickupPoint?.name ?? null,
        pickupAddress: prepared.delivery.pickupPoint?.address ?? null,
        corpPayeeMode: input.payMethod === "corp" ? "seller_direct" : "platform_legacy",
        payeeCompanyId: prepared.payee?.companyId ?? null,
        payeeAccountName: prepared.payee?.accountName ?? null,
        payeeAccountNumber: prepared.payee?.accountNumber ?? null,
        payeeBankName: prepared.payee?.bankName ?? null,
        payeeReviewedAt: prepared.payee?.reviewedAt ?? null,
      });
    }

    await reserveInventoryStock(
      tx,
      checkoutRows.map(row => ({ inventoryId: row.inventory.id, qty: row.cart.qty })),
    );
    await tx
      .delete(cartItems)
      .where(
        and(
          eq(cartItems.userId, input.buyerId),
          inArray(
            cartItems.id,
            selectedCart.map(item => item.id),
          ),
        ),
      );

      const checkoutResult: ReservedCheckoutResult = {
        paymentBatchId,
        paymentNo: input.paymentNo ?? "",
        amount: centsToMoney(totalCents),
        orders: createdOrders,
      };
      if (checkoutSessionId) {
        await tx
          .update(checkoutSessions)
          .set({ status: "completed", response: checkoutResult, failureMessage: null })
          .where(eq(checkoutSessions.id, checkoutSessionId));
      }
      return checkoutResult;
    });
  } catch (error) {
    if (error instanceof InventoryReservationError) {
      const [inventory] = await db
        .select({ partNumber: inventories.partNumber, qtyOnSale: inventories.qtyOnSale })
        .from(inventories)
        .where(eq(inventories.id, error.inventoryId))
        .limit(1);
      throw new CheckoutValidationError(
        stockChangeMessage(inventory?.partNumber || "商品", Number(inventory?.qtyOnSale ?? 0)),
      );
    }
    throw error;
  }
}

export function createAlipayCheckout(input: {
  buyerId: number;
  checkoutToken?: string;
  addressId?: number;
  note?: string;
  deliveryMethod?: DeliveryMethod;
  deliveries?: SellerDeliverySelection[];
  paymentNo: string;
  expiresInSeconds: number;
}) {
  return createReservedCheckout({ ...input, provider: "alipay", payMethod: "alipay" });
}

export function createWechatCheckout(input: {
  buyerId: number;
  checkoutToken?: string;
  addressId?: number;
  note?: string;
  deliveryMethod?: DeliveryMethod;
  deliveries?: SellerDeliverySelection[];
  paymentNo: string;
  expiresInSeconds: number;
  wechatTradeType: "NATIVE" | "JSAPI";
}) {
  return createReservedCheckout({ ...input, provider: "wechat", payMethod: "wechat" });
}

export function createCorpCheckout(input: {
  buyerId: number;
  checkoutToken?: string;
  addressId?: number;
  note?: string;
  deliveryMethod?: DeliveryMethod;
  deliveries?: SellerDeliverySelection[];
}) {
  return createReservedCheckout({ ...input, payMethod: "corp" });
}

export async function activatePaymentBatch(input: {
  paymentBatchId: number;
  paymentNo: string;
  qrCode: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const [batch] = await tx
      .select()
      .from(paymentBatches)
      .where(eq(paymentBatches.id, input.paymentBatchId))
      .limit(1)
      .for("update");
    if (!batch || batch.paymentNo !== input.paymentNo) throw new Error("支付批次不存在");
    if (batch.status !== "creating" && batch.status !== "waiting") {
      throw new Error("支付批次当前不可激活");
    }
    await tx
      .update(paymentBatches)
      .set({ status: "waiting", qrCode: input.qrCode, failureCode: null, failureMessage: null })
      .where(eq(paymentBatches.id, batch.id));
    const [activated] = await tx
      .select({ batch: paymentBatches, remainingSeconds: remainingSecondsExpression })
      .from(paymentBatches)
      .where(eq(paymentBatches.id, batch.id))
      .limit(1);
    if (!activated) throw new Error("支付批次不存在");
    return withRemainingSeconds(activated.batch, activated.remainingSeconds);
  });
}

export async function getPaymentBatchByNo(paymentNo: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ batch: paymentBatches, remainingSeconds: remainingSecondsExpression })
    .from(paymentBatches)
    .where(eq(paymentBatches.paymentNo, paymentNo))
    .limit(1);
  return row ? withRemainingSeconds(row.batch, row.remainingSeconds) : null;
}

export async function getPaymentBatchForBuyer(paymentNo: string, buyerId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ batch: paymentBatches, remainingSeconds: remainingSecondsExpression })
    .from(paymentBatches)
    .where(and(eq(paymentBatches.paymentNo, paymentNo), eq(paymentBatches.buyerId, buyerId)))
    .limit(1);
  return row ? withRemainingSeconds(row.batch, row.remainingSeconds) : null;
}

export async function getPaymentBatchForOrder(orderId: number, buyerId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ batch: paymentBatches, remainingSeconds: remainingSecondsExpression })
    .from(paymentBatchOrders)
    .innerJoin(paymentBatches, eq(paymentBatchOrders.paymentBatchId, paymentBatches.id))
    .where(and(eq(paymentBatchOrders.orderId, orderId), eq(paymentBatches.buyerId, buyerId)))
    .limit(1);
  return row ? withRemainingSeconds(row.batch, row.remainingSeconds) : null;
}

export async function getPaymentBatchOrders(paymentBatchId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ order: orders })
    .from(paymentBatchOrders)
    .innerJoin(orders, eq(paymentBatchOrders.orderId, orders.id))
    .where(eq(paymentBatchOrders.paymentBatchId, paymentBatchId));
}

export async function updatePaymentBatchFailure(input: {
  paymentBatchId: number;
  status: Extract<PaymentBatchStatus, "failed" | "manual_review" | "waiting">;
  code: string;
  message: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .update(paymentBatches)
    .set({
      status: input.status,
      failureCode: input.code.slice(0, 64),
      failureMessage: input.message.slice(0, 255),
    })
    .where(eq(paymentBatches.id, input.paymentBatchId));
}

export async function claimPaymentBatchQuery(input: {
  paymentNo: string;
  buyerId?: number;
  minIntervalMs?: number;
  force?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const conditions = [eq(paymentBatches.paymentNo, input.paymentNo)];
    if (input.buyerId !== undefined) conditions.push(eq(paymentBatches.buyerId, input.buyerId));
    const [row] = await tx
      .select({ batch: paymentBatches, remainingSeconds: remainingSecondsExpression })
      .from(paymentBatches)
      .where(and(...conditions))
      .limit(1)
      .for("update");
    if (!row) return null;
    const batch = withRemainingSeconds(row.batch, row.remainingSeconds);
    const minIntervalMs = input.minIntervalMs ?? 3_000;
    if (
      !input.force &&
      batch.lastQueryAt &&
      Date.now() - batch.lastQueryAt.getTime() < minIntervalMs
    ) {
      return { batch, claimed: false as const };
    }
    await tx
      .update(paymentBatches)
      .set({ lastQueryAt: new Date() })
      .where(eq(paymentBatches.id, batch.id));
    return { batch: { ...batch, lastQueryAt: new Date() }, claimed: true as const };
  });
}

export async function markPaymentBatchPaid(input: {
  paymentNo: string;
  providerTradeNo: string;
  providerStatus: string;
  totalAmount: string;
  notifyId?: string | null;
  paidAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  return db.transaction(async tx => {
    const [batch] = await tx
      .select()
      .from(paymentBatches)
      .where(eq(paymentBatches.paymentNo, input.paymentNo))
      .limit(1)
      .for("update");
    if (!batch) return { outcome: "not_found" as const, batch: null };

    if (moneyToCents(batch.amount) !== moneyToCents(input.totalAmount)) {
      await tx
        .update(paymentBatches)
        .set({
          status: "manual_review",
          providerStatus: input.providerStatus,
          failureCode: "AMOUNT_MISMATCH",
          failureMessage: "支付宝通知金额与本地支付批次金额不一致",
          notifyId: input.notifyId || batch.notifyId,
        })
        .where(eq(paymentBatches.id, batch.id));
      return { outcome: "manual_review" as const, batch };
    }

    if (batch.status === "paid") {
      if (batch.providerTradeNo && batch.providerTradeNo !== input.providerTradeNo) {
        await tx
          .update(paymentBatches)
          .set({
            status: "manual_review",
            failureCode: "TRADE_NO_MISMATCH",
            failureMessage: "同一支付批次收到不同支付宝交易号",
          })
          .where(eq(paymentBatches.id, batch.id));
        return { outcome: "manual_review" as const, batch };
      }
      await tx
        .update(paymentBatches)
        .set({
          providerTradeNo: batch.providerTradeNo || input.providerTradeNo,
          providerStatus: input.providerStatus,
          notifyId: input.notifyId || batch.notifyId,
          paidAt: batch.paidAt || input.paidAt || new Date(),
        })
        .where(eq(paymentBatches.id, batch.id));
      return { outcome: "already_paid" as const, batch };
    }

    if (["closed", "failed", "manual_review"].includes(batch.status)) {
      await tx
        .update(paymentBatches)
        .set({
          status: "manual_review",
          providerTradeNo: input.providerTradeNo,
          providerStatus: input.providerStatus,
          notifyId: input.notifyId || batch.notifyId,
          failureCode: "LATE_PAYMENT",
          failureMessage: "已关闭或异常支付批次收到成功结果",
        })
        .where(eq(paymentBatches.id, batch.id));
      return { outcome: "manual_review" as const, batch };
    }

    const [tradeConflict] = await tx
      .select({ id: paymentBatches.id })
      .from(paymentBatches)
      .where(eq(paymentBatches.providerTradeNo, input.providerTradeNo))
      .limit(1)
      .for("update");
    if (tradeConflict && tradeConflict.id !== batch.id) {
      await tx
        .update(paymentBatches)
        .set({
          status: "manual_review",
          failureCode: "DUPLICATE_PROVIDER_TRADE_NO",
          failureMessage: "支付宝交易号已绑定其他支付批次",
        })
        .where(eq(paymentBatches.id, batch.id));
      return { outcome: "manual_review" as const, batch };
    }

    const links = await tx
      .select({ orderId: paymentBatchOrders.orderId })
      .from(paymentBatchOrders)
      .where(eq(paymentBatchOrders.paymentBatchId, batch.id));
    const orderIds = links.map(link => link.orderId);
    const linkedOrders = orderIds.length
      ? await tx.select().from(orders).where(inArray(orders.id, orderIds)).for("update")
      : [];
    if (!linkedOrders.length || linkedOrders.some(order => !["pending", "paid"].includes(order.status))) {
      await tx
        .update(paymentBatches)
        .set({
          status: "manual_review",
          providerTradeNo: input.providerTradeNo,
          providerStatus: input.providerStatus,
          failureCode: "ORDER_STATE_CONFLICT",
          failureMessage: "关联订单状态与支付成功结果冲突",
        })
        .where(eq(paymentBatches.id, batch.id));
      return { outcome: "manual_review" as const, batch };
    }

    const paidAt = input.paidAt || new Date();
    await tx
      .update(paymentBatches)
      .set({
        status: "paid",
        providerTradeNo: input.providerTradeNo,
        providerStatus: input.providerStatus,
        notifyId: input.notifyId || batch.notifyId,
        paidAt,
        failureCode: null,
        failureMessage: null,
      })
      .where(eq(paymentBatches.id, batch.id));

    for (const order of linkedOrders) {
      if (order.status === "paid") continue;
      await tx
        .update(orders)
        .set({ status: "paid", paidAt })
        .where(and(eq(orders.id, order.id), eq(orders.status, "pending")));
      await tx.insert(orderTracks).values({
        orderId: order.id,
        content: "支付宝付款成功，等待卖家发货",
      });
    }
    return { outcome: "paid" as const, batch: { ...batch, status: "paid" as const, paidAt } };
  });
}

export async function markPaymentBatchClosed(input: {
  paymentNo: string;
  providerStatus: string;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  return db.transaction(async tx => {
    const [batch] = await tx
      .select()
      .from(paymentBatches)
      .where(eq(paymentBatches.paymentNo, input.paymentNo))
      .limit(1)
      .for("update");
    if (!batch) return { outcome: "not_found" as const };
    if (batch.status === "paid") return { outcome: "already_paid" as const };
    if (batch.status === "closed") return { outcome: "already_closed" as const };
    if (batch.status === "manual_review" || batch.status === "failed") {
      return { outcome: "manual_review" as const };
    }

    const links = await tx
      .select({ orderId: paymentBatchOrders.orderId })
      .from(paymentBatchOrders)
      .where(eq(paymentBatchOrders.paymentBatchId, batch.id));
    const orderIds = links.map(link => link.orderId);
    const linkedOrders = orderIds.length
      ? await tx.select().from(orders).where(inArray(orders.id, orderIds)).for("update")
      : [];
    if (linkedOrders.some(order => order.status === "paid")) {
      await tx
        .update(paymentBatches)
        .set({
          status: "manual_review",
          providerStatus: input.providerStatus,
          failureCode: "ORDER_ALREADY_PAID",
          failureMessage: "关单时发现关联订单已付款",
        })
        .where(eq(paymentBatches.id, batch.id));
      return { outcome: "manual_review" as const };
    }

    const pendingOrderIds = linkedOrders
      .filter(order => order.status === "pending")
      .map(order => order.id);
    if (pendingOrderIds.length) {
      await restoreInventoryStockForOrders(tx, pendingOrderIds);
      for (const orderId of pendingOrderIds) {
        await tx
          .update(orders)
          .set({ status: "cancel", statusNote: input.reason.slice(0, 255) })
          .where(and(eq(orders.id, orderId), eq(orders.status, "pending")));
        await tx.insert(orderTracks).values({
          orderId,
          content: input.reason.slice(0, 255),
        });
      }
    }

    await tx
      .update(paymentBatches)
      .set({
        status: "closed",
        providerStatus: input.providerStatus,
        closedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      })
      .where(eq(paymentBatches.id, batch.id));
    return { outcome: "closed" as const };
  });
}

export async function claimNextExpiredPaymentBatch(provider?: CheckoutProvider) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const staleClaimBefore = new Date(now.getTime() - 2 * 60_000);
  const claimableStatus = or(
    inArray(paymentBatches.status, ["creating", "waiting"]),
    and(
      eq(paymentBatches.status, "closing"),
      or(
        isNull(paymentBatches.lastQueryAt),
        lte(paymentBatches.lastQueryAt, staleClaimBefore),
      ),
    ),
  );
  return db.transaction(async tx => {
    const [batch] = await tx
      .select()
      .from(paymentBatches)
      .where(
        and(
          claimableStatus,
          sql`${paymentBatches.expiresAt} <= CURRENT_TIMESTAMP`,
          ...(provider ? [eq(paymentBatches.provider, provider)] : []),
        ),
      )
      .orderBy(asc(paymentBatches.expiresAt), asc(paymentBatches.id))
      .limit(1)
      .for("update");
    if (!batch) return null;
    const claimedAt = new Date();
    await tx
      .update(paymentBatches)
      .set({ status: "closing", lastQueryAt: claimedAt })
      .where(and(eq(paymentBatches.id, batch.id), claimableStatus));
    return withRemainingSeconds(
      { ...batch, status: "closing" as const, lastQueryAt: claimedAt },
      0,
    );
  });
}

export async function restorePaymentBatchForRetry(input: {
  paymentBatchId: number;
  code: string;
  message: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .update(paymentBatches)
    .set({
      status: "waiting",
      failureCode: input.code.slice(0, 64),
      failureMessage: input.message.slice(0, 255),
    })
    .where(and(eq(paymentBatches.id, input.paymentBatchId), eq(paymentBatches.status, "closing")));
}

export async function countPaymentBatchesByStatus(status: PaymentBatchStatus) {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(paymentBatches)
    .where(eq(paymentBatches.status, status));
  return Number(row?.count ?? 0);
}

export function serializePaymentBatch(
  batch: PaymentBatch & { remainingSeconds?: number },
) {
  return {
    paymentNo: batch.paymentNo,
    status: batch.status,
    amount: batch.amount,
    currency: batch.currency,
    qrCode: batch.status === "waiting" ? batch.qrCode : null,
    expiresAt: batch.expiresAt,
    remainingSeconds: Math.max(0, Math.min(300, Number(batch.remainingSeconds ?? 0))),
    paidAt: batch.paidAt,
    closedAt: batch.closedAt,
    failureCode: batch.failureCode,
  };
}

export async function updatePaymentProviderStatus(input: {
  paymentBatchId: number;
  providerStatus: string;
  providerTradeNo?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .update(paymentBatches)
    .set({
      providerStatus: input.providerStatus.slice(0, 32),
      ...(input.providerTradeNo ? { providerTradeNo: input.providerTradeNo } : {}),
      failureCode: null,
      failureMessage: null,
    })
    .where(eq(paymentBatches.id, input.paymentBatchId));
}

export async function getPaymentBatchesForOrderIds(orderIds: number[], buyerId: number) {
  const db = await getDb();
  if (!db || orderIds.length === 0) return [];
  return db
    .select({ orderId: paymentBatchOrders.orderId, batch: paymentBatches })
    .from(paymentBatchOrders)
    .innerJoin(paymentBatches, eq(paymentBatchOrders.paymentBatchId, paymentBatches.id))
    .where(
      and(
        inArray(paymentBatchOrders.orderId, orderIds),
        eq(paymentBatches.buyerId, buyerId),
      ),
    );
}
