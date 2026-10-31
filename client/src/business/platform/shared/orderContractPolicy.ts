export const ORDER_CONTRACT_TEMPLATE_VERSION = "51dianzi-sales-contract-v10";
export const ORDER_CONTRACT_TITLE = "销售合同";

export function orderContractNo(orderNo: string) {
  return `HT-${orderNo}`;
}
