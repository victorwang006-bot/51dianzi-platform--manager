import {
  EmptyState,
  PageHeader,
  StatusBadge,
  alertSeverityMap,
  alertTypeMap,
  formatDateTime,
  formatMoney,
  orderStatusMap,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  ClipboardCheck,
  ShoppingCart,
  Store,
  Undo2,
} from "lucide-react";
import { Link } from "wouter";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="stat-card flex items-start gap-4">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold mt-0.5 tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function TodoCard({ label, count, path }: { label: string; count: number; path: string }) {
  return (
    <Link href={path}>
      <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-white hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${count > 0 ? "bg-red-500" : "bg-gray-300"}`} />
          <span className="text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-semibold ${count > 0 ? "text-red-600" : "text-muted-foreground"}`}>{count}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const { data: stats, isLoading: statsLoading } = trpc.dashboard.stats.useQuery();
  const { data: recentOrders, isLoading: ordersLoading } = trpc.dashboard.recentOrders.useQuery();
  const { data: recentAlerts, isLoading: alertsLoading } = trpc.dashboard.recentAlerts.useQuery();

  return (
    <DashboardLayout>
      <PageHeader
        title="数据看板"
        description="平台核心运营指标概览与待处理事项"
      />

      {/* 核心指标 */}
      {statsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {[1, 2].map(i => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <StatCard
            icon={Store}
            label="入驻商户数"
            value={stats?.totalMerchants ?? 0}
            sub={`待审核 ${stats?.pendingMerchants ?? 0} 家`}
            color="bg-indigo-50 text-indigo-600"
          />
          <StatCard
            icon={AlertTriangle}
            label="未处理告警"
            value={stats?.openAlerts ?? 0}
            color="bg-red-50 text-red-600"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 待处理事项 */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              待处理事项
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <TodoCard label="商户入驻待审核" count={stats?.pendingMerchants ?? 0} path="/merchants" />
            <TodoCard label="商品待审核" count={stats?.pendingReviews ?? 0} path="/products" />
            <TodoCard label="退款申请待处理" count={stats?.pendingRefunds ?? 0} path="/refunds" />
            <TodoCard label="告警待处置" count={stats?.openAlerts ?? 0} path="/alerts" />
          </CardContent>
        </Card>

        {/* 最新订单 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              最新订单
            </CardTitle>
            <Link href="/orders" className="text-xs text-primary hover:underline flex items-center gap-1">
              查看全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {ordersLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : !recentOrders || recentOrders.length === 0 ? (
              <EmptyState message="暂无订单数据" />
            ) : (
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>订单号</th>
                      <th>商品</th>
                      <th>金额</th>
                      <th>状态</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map(order => {
                      const st = orderStatusMap[order.status] ?? { label: order.status, style: "gray" as const };
                      return (
                        <tr key={order.id}>
                          <td className="font-mono text-xs">{order.orderNo}</td>
                          <td className="max-w-[180px] truncate">{order.productName ?? "-"}</td>
                          <td className="font-medium">{formatMoney(order.totalAmount)}</td>
                          <td><StatusBadge label={st.label} style={st.style} /></td>
                          <td className="text-muted-foreground text-xs">{formatDateTime(order.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 最新告警 */}
      <Card className="mt-6">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            最新告警
          </CardTitle>
          <Link href="/alerts" className="text-xs text-primary hover:underline flex items-center gap-1">
            查看全部 <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {alertsLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2].map(i => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : !recentAlerts || recentAlerts.length === 0 ? (
            <EmptyState message="暂无待处理告警" />
          ) : (
            <div className="divide-y divide-border">
              {recentAlerts.map(alert => {
                const sev = alertSeverityMap[alert.severity] ?? { label: alert.severity, style: "gray" as const };
                return (
                  <div key={alert.id} className="flex items-center gap-3 px-4 py-3">
                    <StatusBadge label={sev.label} style={sev.style} />
                    <span className="text-xs text-muted-foreground shrink-0">{alertTypeMap[alert.alertType]?.label ?? alert.alertType}</span>
                    <span className="text-sm truncate flex-1">{alert.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDateTime(alert.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
