import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ReactNode } from "react";

// ─── 状态徽章映射 ─────────────────────────────────────────────────────────────

type BadgeStyle = "success" | "warning" | "danger" | "info" | "gray";

const badgeClass: Record<BadgeStyle, string> = {
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
  gray: "badge-gray",
};

export function StatusBadge({ label, style }: { label: string; style: BadgeStyle }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${badgeClass[style]}`}>
      {label}
    </span>
  );
}

// 商户状态
export const merchantStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  draft: { label: "草稿", style: "gray" },
  pending: { label: "待审核", style: "warning" },
  supplement: { label: "待补件", style: "info" },
  approved: { label: "已入驻", style: "success" },
  suspended: { label: "已暂停", style: "danger" },
  terminated: { label: "已清退", style: "gray" },
};

export const agreementStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  unsigned: { label: "未签署", style: "gray" },
  signed: { label: "已签署", style: "success" },
  expired: { label: "已过期", style: "danger" },
};

// 商品状态
export const productStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  draft: { label: "草稿", style: "gray" },
  pending_review: { label: "待审核", style: "warning" },
  active: { label: "已上架", style: "success" },
  inactive: { label: "已下架", style: "gray" },
  banned: { label: "已禁售", style: "danger" },
};

// 订单状态
export const orderStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  pending_payment: { label: "待付款", style: "warning" },
  paid: { label: "已付款", style: "info" },
  processing: { label: "处理中", style: "info" },
  shipped: { label: "已发货", style: "info" },
  completed: { label: "已完成", style: "success" },
  cancelled: { label: "已取消", style: "gray" },
  refunding: { label: "退款中", style: "warning" },
  refunded: { label: "已退款", style: "gray" },
  abnormal: { label: "异常", style: "danger" },
};

// 退款状态
export const refundStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  pending: { label: "待审核", style: "warning" },
  reviewing: { label: "审核中", style: "info" },
  approved: { label: "已批准", style: "success" },
  rejected: { label: "已拒绝", style: "danger" },
  executing: { label: "执行中", style: "info" },
  completed: { label: "已完成", style: "success" },
  failed: { label: "失败", style: "danger" },
};

// 流水类型
export const flowTypeMap: Record<string, { label: string; style: BadgeStyle }> = {
  payment: { label: "支付", style: "success" },
  refund: { label: "退款", style: "warning" },
  platform_fee: { label: "平台服务费", style: "info" },
  settlement: { label: "结算", style: "info" },
  adjustment: { label: "调账", style: "gray" },
};

export const flowStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  pending: { label: "处理中", style: "warning" },
  success: { label: "成功", style: "success" },
  failed: { label: "失败", style: "danger" },
  cancelled: { label: "已取消", style: "gray" },
};

// 结算单状态
export const settlementStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  draft: { label: "草稿", style: "gray" },
  confirmed: { label: "已确认", style: "info" },
  paying: { label: "打款中", style: "warning" },
  paid: { label: "已打款", style: "success" },
  failed: { label: "打款失败", style: "danger" },
};

// 告警
export const alertTypeMap: Record<string, { label: string; style: BadgeStyle }> = {
  stuck_order: { label: "卡单超时", style: "warning" },
  order_stuck: { label: "卡单超时", style: "warning" },
  refund_abnormal: { label: "退款异常", style: "danger" },
  license_expiry: { label: "资质到期", style: "warning" },
  settlement_failed: { label: "结算失败", style: "danger" },
  risk_merchant: { label: "风险商户", style: "danger" },
  system_error: { label: "系统错误", style: "gray" },
  task_failed: { label: "任务失败", style: "danger" },
};

export const severityMap: Record<string, { label: string; style: BadgeStyle }> = {
  critical: { label: "严重", style: "danger" },
  warning: { label: "警告", style: "warning" },
  info: { label: "提示", style: "info" },
};

export const alertSeverityMap: Record<string, { label: string; style: BadgeStyle }> = {
  info: { label: "提示", style: "info" },
  warning: { label: "警告", style: "warning" },
  critical: { label: "严重", style: "danger" },
};

export const alertStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  open: { label: "待处理", style: "danger" },
  acknowledged: { label: "已确认", style: "warning" },
  resolved: { label: "已解决", style: "success" },
  ignored: { label: "已忽略", style: "gray" },
};

// 风控
export const riskLevelMap: Record<string, { label: string; style: BadgeStyle }> = {
  low: { label: "低风险", style: "success" },
  medium: { label: "中风险", style: "info" },
  high: { label: "高风险", style: "warning" },
  critical: { label: "极高风险", style: "danger" },
};

export const riskStatusMap: Record<string, { label: string; style: BadgeStyle }> = {
  pending: { label: "待复核", style: "warning" },
  reviewed: { label: "已复核", style: "info" },
  actioned: { label: "已处置", style: "success" },
  dismissed: { label: "已驳回", style: "gray" },
};

// 管理员角色
export const adminRoleMap: Record<string, string> = {
  super_admin: "超级管理员",
  operation: "平台运营",
  merchant_mgr: "商户管理",
  customer_svc: "客服/售后",
  risk_control: "风控审核",
  finance: "财务结算",
  auditor: "审计人员",
};

// ─── 页头 ─────────────────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── 分页 ─────────────────────────────────────────────────────────────────────

export function Pagination({ page, pageSize, total, onPageChange }: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between px-1 py-3">
      <p className="text-xs text-muted-foreground">
        共 {total} 条记录，第 {page} / {totalPages} 页
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          下一页
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── 空状态 ───────────────────────────────────────────────────────────────────

export function EmptyState({ message = "暂无数据" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <svg className="h-12 w-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── 金额格式化 ───────────────────────────────────────────────────────────────

export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return `¥${num.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
