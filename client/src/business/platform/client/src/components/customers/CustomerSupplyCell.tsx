import React from "react";
import type { SupplySummary } from "./customerSupply";

type Props = { summary?: SupplySummary; canWrite: boolean; archived: boolean; loading: boolean; failed: boolean;
  needsIndustry?: boolean; onCompleteProfile?: () => void;
  onUpload: () => void; onViewStock: (channelId: number) => void };
export function CustomerSupplyCell({ summary, canWrite, archived, loading, failed, needsIndustry, onCompleteProfile, onUpload, onViewStock }: Props) {
  const canUpload = canWrite && !archived && !failed && !needsIndustry && summary?.canUpload === true;
  const channelId = summary?.channelId;
  const canView = !failed && summary?.canViewStock === true && Number.isSafeInteger(channelId) && (channelId ?? 0) > 0;
  const reason = needsIndustry ? "客户缺少合法所属行业，请先在客户档案补全资料" : archived ? "该客户已归档" : failed ? "供应库存权限读取失败，请刷新后重试"
    : loading || !summary ? "正在核验供应库存权限" : !canUpload ? summary.disabledReason || "当前账号没有上传权限" : undefined;
  const count = summary?.materialCount;
  return <div className="customer-list-supply-actions">
    <button type="button" className="customer-list-supply-upload" disabled={!canUpload} title={reason} onClick={onUpload}>上传物料表</button>
    {needsIndustry && onCompleteProfile ? <button type="button" className="customer-list-supply-view" onClick={onCompleteProfile}>补全客户档案</button> : null}
    {canView ? <button type="button" className="customer-list-supply-view" onClick={() => onViewStock(channelId!)}>查看库存{Number.isSafeInteger(count) && (count ?? -1) >= 0 ? `（${count}）` : ""}</button> : null}
  </div>;
}
