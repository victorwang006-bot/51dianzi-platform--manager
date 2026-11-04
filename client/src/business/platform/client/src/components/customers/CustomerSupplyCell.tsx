import React from "react";
import { CustomerSupplyAction } from "./CustomerSupplyAction";
import type { SupplySummary } from "./customerSupply";

type Props = { summary?: SupplySummary; canWrite: boolean; archived: boolean; loading: boolean; failed: boolean;
  needsIndustry?: boolean; onCompleteProfile?: () => void; onRetry?: () => void;
  onUpload: () => void; onViewStock: (channelId: number) => void };
export function CustomerSupplyCell({ summary, canWrite, archived, loading, failed, needsIndustry, onCompleteProfile, onRetry, onUpload, onViewStock }: Props) {
  const canUpload = canWrite && !archived && !failed && !loading && !needsIndustry && summary?.canUpload === true;
  const channelId = summary?.channelId;
  const canView = !failed && summary?.canViewStock === true && Number.isSafeInteger(channelId) && (channelId ?? 0) > 0;
  const reason = archived ? "该客户已归档" : failed ? "供应库存权限读取失败，请重试"
    : loading ? "正在核验供应库存权限" : needsIndustry ? "客户缺少合法所属行业，请先在客户档案补全资料"
    : !summary ? "供应库存权限尚未确认" : !canUpload ? summary.disabledReason || "当前账号没有上传权限" : undefined;
  const count = summary?.materialCount;
  return <div className="customer-list-supply-actions">
    <CustomerSupplyAction className="customer-list-supply-upload" disabledReason={reason} onClick={onUpload}>上传物料表</CustomerSupplyAction>
    {needsIndustry && onCompleteProfile ? <CustomerSupplyAction onClick={onCompleteProfile}>补全客户档案</CustomerSupplyAction> : null}
    {failed && onRetry ? <CustomerSupplyAction disabledReason={loading ? "正在重新读取供应库存权限" : undefined} onClick={onRetry}>重试供应库存</CustomerSupplyAction> : null}
    {canView ? <CustomerSupplyAction className="customer-list-supply-view" onClick={() => onViewStock(channelId!)}>查看库存{Number.isSafeInteger(count) && (count ?? -1) >= 0 ? `（${count}）` : ""}</CustomerSupplyAction> : null}
  </div>;
}
