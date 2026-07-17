import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  alertStatusMap,
  alertTypeMap,
  formatDateTime,
  severityMap,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Bell, CheckCircle2, Clock, RadarIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Alerts() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("open");
  const [severity, setSeverity] = useState<string>("all");
  const [alertType, setAlertType] = useState<string>("all");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.alert.list.useQuery({
    page,
    pageSize: 20,
    status: status === "all" ? undefined : status,
    severity: severity === "all" ? undefined : severity,
    alertType: alertType === "all" ? undefined : alertType,
  });

  const { data: openData } = trpc.alert.list.useQuery({ page: 1, pageSize: 1, status: "open" });
  const { data: ackData } = trpc.alert.list.useQuery({ page: 1, pageSize: 1, status: "acknowledged" });
  const { data: resolvedData } = trpc.alert.list.useQuery({ page: 1, pageSize: 1, status: "resolved" });

  const updateMutation = trpc.alert.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.alert.list.invalidate();
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  const scanMutation = trpc.alert.scan.useMutation({
    onSuccess: res => {
      if (res.createdCount > 0) {
        toast.success(`巡检完成，新增 ${res.createdCount} 条告警并已通知负责人`);
      } else {
        toast.success("巡检完成，未发现新的异常项");
      }
      utils.alert.list.invalidate();
    },
    onError: err => toast.error(`巡检失败：${err.message}`),
  });

  const summaryCards = [
    { icon: Bell, label: "待处理告警", value: openData?.total ?? 0, color: "bg-red-50 text-red-600" },
    { icon: Clock, label: "已确认处理中", value: ackData?.total ?? 0, color: "bg-amber-50 text-amber-600" },
    { icon: CheckCircle2, label: "已解决", value: resolvedData?.total ?? 0, color: "bg-green-50 text-green-600" },
  ];

  return (
    <DashboardLayout>
      <PageHeader
        title="任务与告警中心"
        description="待办事项汇总、失败任务提醒、资质到期预警与异常卡单提示。严重告警将自动通知平台运营负责人。"
        actions={
          <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
            <RadarIcon className={`h-4 w-4 mr-1 ${scanMutation.isPending ? "animate-spin" : ""}`} />
            {scanMutation.isPending ? "巡检中..." : "一键巡检"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {summaryCards.map(c => (
          <div key={c.label} className="stat-card flex items-start gap-4">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${c.color}`}>
              <c.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-xl font-semibold mt-0.5">{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="open">待处理</SelectItem>
              <SelectItem value="acknowledged">已确认</SelectItem>
              <SelectItem value="resolved">已解决</SelectItem>
              <SelectItem value="ignored">已忽略</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={v => { setSeverity(v); setPage(1); }}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="严重程度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部级别</SelectItem>
              <SelectItem value="critical">严重</SelectItem>
              <SelectItem value="warning">警告</SelectItem>
              <SelectItem value="info">提示</SelectItem>
            </SelectContent>
          </Select>
          <Select value={alertType} onValueChange={v => { setAlertType(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="告警类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="order_stuck">卡单超时</SelectItem>
              <SelectItem value="refund_abnormal">退款异常</SelectItem>
              <SelectItem value="license_expiry">资质到期</SelectItem>
              <SelectItem value="settlement_failed">结算失败</SelectItem>
              <SelectItem value="risk_merchant">风控风险</SelectItem>
              <SelectItem value="task_failed">任务失败</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="当前没有符合条件的告警" />
          ) : (
            <>
              <div className="divide-y divide-border">
                {data.data.map(a => {
                  const sev = severityMap[a.severity] ?? { label: a.severity, style: "gray" as const };
                  const tp = alertTypeMap[a.alertType] ?? { label: a.alertType, style: "gray" as const };
                  const st = alertStatusMap[a.status] ?? { label: a.status, style: "gray" as const };
                  return (
                    <div key={a.id} className="p-4 flex items-start gap-3 hover:bg-muted/40 transition-colors">
                      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                        a.severity === "critical" ? "bg-red-50 text-red-600" : a.severity === "warning" ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                      }`}>
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{a.title}</p>
                          <StatusBadge label={sev.label} style={sev.style} />
                          <StatusBadge label={tp.label} style={tp.style} />
                          <StatusBadge label={st.label} style={st.style} />
                        </div>
                        {a.content && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.content}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDateTime(a.createdAt)}
                          {a.relatedType && ` · 关联 ${a.relatedType}#${a.relatedId}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {a.status === "open" && (
                          <>
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={updateMutation.isPending}
                              onClick={() => updateMutation.mutate({ id: a.id, status: "acknowledged" })}>
                              确认
                            </Button>
                            <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending}
                              onClick={() => updateMutation.mutate({ id: a.id, status: "resolved" })}>
                              解决
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={updateMutation.isPending}
                              onClick={() => updateMutation.mutate({ id: a.id, status: "ignored" })}>
                              忽略
                            </Button>
                          </>
                        )}
                        {a.status === "acknowledged" && (
                          <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending}
                            onClick={() => updateMutation.mutate({ id: a.id, status: "resolved" })}>
                            标记解决
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
