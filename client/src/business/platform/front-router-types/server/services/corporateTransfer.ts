export const CORPORATE_TRANSFER_ACCOUNT = Object.freeze({
  accountName: "深圳市智捷创芯信息科技有限公司",
  accountNumber: "755986250510001",
  bankName: "招商银行股份有限公司深圳上步支行",
});

export type CorpPayeeMode = "platform_legacy" | "seller_direct";

export type CorporateTransferOrder = {
  id?: number;
  orderNo: string;
  sellerId?: number;
  sellerName?: string;
  total: number;
  corpPayeeMode?: CorpPayeeMode | null;
  payeeCompanyId?: number | null;
  payeeAccountName?: string | null;
  payeeAccountNumber?: string | null;
  payeeBankName?: string | null;
  payeeReviewedAt?: Date | string | null;
};

function requiredText(value: string | null | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`订单缺少${label}快照，请联系客服核查`);
  return normalized;
}

/**
 * 构造单张卖家订单的付款指引。
 *
 * 新订单必须使用下单时固化的卖家账户快照；历史订单仍按当时展示的平台账户处理，
 * 不能用卖家今天的账户反向覆盖历史付款责任。
 */
export function buildCorporateTransferDetails(order: CorporateTransferOrder) {
  const mode: CorpPayeeMode = order.corpPayeeMode ?? "platform_legacy";
  const sellerName = order.sellerName?.trim() || "订单卖家";
  if (mode === "seller_direct") {
    const accountName = requiredText(order.payeeAccountName, "收款账户名称");
    const accountNumber = requiredText(order.payeeAccountNumber, "收款账号");
    const bankName = requiredText(order.payeeBankName, "收款开户行");
    return {
      orderId: order.id ?? null,
      sellerId: order.sellerId ?? null,
      sellerName,
      payeeMode: mode,
      payeeCompanyId: order.payeeCompanyId ?? null,
      payeeReviewedAt: order.payeeReviewedAt ?? null,
      accountName,
      accountNumber,
      bankName,
      orderNos: [order.orderNo],
      transferReference: order.orderNo,
      total: Number(Number(order.total).toFixed(2)),
      notice: `本订单货款由卖家“${sellerName}”直接收取。请核对收款户名与订单卖家一致，并在转账附言中填写订单号。`,
    };
  }

  return {
    orderId: order.id ?? null,
    sellerId: order.sellerId ?? null,
    sellerName,
    payeeMode: mode,
    payeeCompanyId: null,
    payeeReviewedAt: null,
    ...CORPORATE_TRANSFER_ACCOUNT,
    orderNos: [order.orderNo],
    transferReference: order.orderNo,
    total: Number(Number(order.total).toFixed(2)),
    notice:
      "该订单创建时使用平台对公账户，请按原收款信息付款；如信息不一致，请先联系客服核实。",
  };
}

export function buildCorporateTransferPayments(
  orders: CorporateTransferOrder[]
) {
  const payments = orders.map(buildCorporateTransferDetails);
  return {
    payments,
    sellerCount: new Set(payments.map(payment => payment.sellerId)).size,
    total: Number(
      payments.reduce((sum, payment) => sum + payment.total, 0).toFixed(2)
    ),
    notice:
      payments.length > 1
        ? `本次生成 ${payments.length} 张卖家订单，请按每张订单显示的收款账户分别转账。`
        : "本次仅有一张卖家订单，请按该订单显示的收款账户转账。",
  };
}

export type CorporateTransferDetails = ReturnType<
  typeof buildCorporateTransferDetails
>;
export type CorporateTransferPayments = ReturnType<
  typeof buildCorporateTransferPayments
>;
