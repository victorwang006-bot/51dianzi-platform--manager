import * as React from "react";
import { usePageMemory, useRememberedState } from "../hooks/usePageMemory";
import { useCompanyStockScope } from "../components/companyStock/useCompanyStockSession";
import PlatformLayout from "../../../../BusinessContentFrame";
import { SalesOrdersContent } from "./CrmSalesOrders";
/** 仅供回归仍保留的旧版（客户嵌入）模型；正式工作台入口使用 BusinessSalesOrdersPage。 */
export default function LegacySalesOrdersTestHost() {
  const ready = usePageMemory();
  const scope = useCompanyStockScope();
  const state = {
    draftKeyword: useRememberedState("draftKeyword", ""),
    keyword: useRememberedState("keyword", ""),
    status: useRememberedState<"all" | "confirmed" | "cancelled">("status", "all"),
    page: useRememberedState("page", 1),
    selectedId: useRememberedState<number | null>("selectedId", null),
  };
  return <PlatformLayout><SalesOrdersContent key={scope.identityKey} ready={ready} state={state} /></PlatformLayout>;
}
