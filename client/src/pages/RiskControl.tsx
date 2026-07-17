import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateTime,
  riskLevelMap,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { BrainCircuit, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const riskStatusMap: Record<string, { label: string; style: "info" | "success" | "warning" | "gray" }> = {
  pending: { label: "待复核", style: "warning" },
  reviewed: { label: "已复核", style: "info" },
  actioned: { label: "已处置", style: "success" },
  dismissed: { label: "已驳回", style: "gray" },
};

function AnalyzeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [targetType, setTargetType] = useState<"order" | "merchant">("order");
  const [targetId, setTargetId] = useState<string>("");

  const utils = trpc.useUtils();
  const { data: orders } = trpc.order.list.useQuery({ page: 1, pageSize: 50 }, { enabled: open && targetType === "order" });
  const { data: merchants } = trpc.merchant.list.useQuery({ page: 1, pageSize: 100 }, { enabled: open && targetType === "merchant" });

  const orderMutation = trpc.risk.analyzeOrder.useMutation({
    onSuccess: res => {
      const lv = riskLevelMap[res.analysis?.riskLevel]?.label ?? res.analysis?.riskLevel;
      toast.success(`分析完成，风险等级：${lv}`);
      utils.risk.list.invalidate();
      onOpenChange(false);
      setTargetId("");
    },
    onError: err => toast.error(`分析失败：${err.message}`),
  });
  const merchantMutation = trpc.risk.analyzeMerchant.useMutation({
    onSuccess: res => {
      const lv = riskLevelMap[res.analysis?.riskLevel]?.label ?? res.analysis?.riskLevel;
      toast.success(`分析完成，风险等级：${lv}`);
      utils.risk.list.invalidate();
      onOpenChange(false);
      setTargetId("");
    },
    onError: err => toast.error(`分析失败：${err.message}`),
  });

  const isPending = orderMutation.isPending || merchantMutation.isPending;

  const startAnalyze = () => {
    const id = parseInt(targetId, 10);
    if (!id) return;
    if (targetType === "order") orderMutation.mutate({ orderId: id });
    else merchantMutation.mutate({ merchantId: id });
  };

  return (
    <Dialog open={open} onOpenChange={v => !isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            发起智能风控分析
          </DialogTitle>
          <DialogDescription>
            系统将调用大语言模型对所选对象的交易数据、状态记录进行深度分析，自动生成风险摘要与处置建议。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={targetType} onValueChange={v => { setTargetType(v as "order" | "merchant"); setTargetId(""); }}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order">分析订单</SelectItem>
              <SelectItem value="merchant">分析商户</SelectItem>
            </SelectContent>
          </Select>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger>
              <SelectValue placeholder={targetType === "order" ? "选择订单" : "选择商户"} />
            </SelectTrigger>
            <SelectContent>
              {targetType === "order"
                ? orders?.data.map(o => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.orderNo} · ¥{o.totalAmount} · {o.buyerName ?? "未知买家"}
                    </SelectItem>
                  ))
                : merchants?.data.map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.companyName}（{m.merchantNo}）
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>取消</Button>
          <Button onClick={startAnalyze} disabled={!targetId || isPending}>
            {isPending ? (
              <>
                <Sparkles className="h-4 w-4 mr-1 animate-pulse" />
                AI 分析中，请稍候...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                开始分析
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RiskControl() {
  const [page, setPage] = useState(1);
  const [riskLevel, setRiskLevel] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.risk.list.useQuery({
    page,
    pageSize: 10,
    riskLevel: riskLevel === "all" ? undefined : riskLevel,
    status: status === "all" ? undefined : status,
  });

  const updateMutation = trpc.risk.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.risk.list.invalidate();
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  return (
    <DashboardLayout>
      <PageHeader
        title="智能风控"
        description="接入大语言模型对异常订单与可疑商户行为进行智能分析，自动生成风险摘要与处置建议"
        actions={
          <Button onClick={() => setAnalyzeOpen(true)}>
            <BrainCircuit className="h-4 w-4 mr-1" />
            发起智能分析
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <Select value={riskLevel} onValueChange={v => { setRiskLevel(v); setPage(1); }}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="风险等级" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部等级</SelectItem>
              <SelectItem value="critical">极高风险</SelectItem>
              <SelectItem value="high">高风险</SelectItem>
              <SelectItem value="medium">中风险</SelectItem>
              <SelectItem value="low">低风险</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="处理状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">待复核</SelectItem>
              <SelectItem value="reviewed">已复核</SelectItem>
              <SelectItem value="actioned">已处置</SelectItem>
              <SelectItem value="dismissed">已驳回</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : !data || data.data.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState message="暂无风控分析记录，点击右上角「发起智能分析」开始" />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-4">
            {data.data.map(r => {
              const lv = riskLevelMap[r.riskLevel] ?? { label: r.riskLevel, style: "gray" as const };
              const st = riskStatusMap[r.status] ?? { label: r.status, style: "gray" as const };
              return (
                <Card key={r.id}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ShieldAlert className={`h-4 w-4 ${
                          r.riskLevel === "critical" || r.riskLevel === "high" ? "text-red-500" : r.riskLevel === "medium" ? "text-amber-500" : "text-green-600"
                        }`} />
                        {r.targetType === "order" ? "订单" : "商户"}风控分析 · {r.targetType}#{r.targetId}
                        <StatusBadge label={lv.label} style={lv.style} />
                        <StatusBadge label={st.label} style={st.style} />
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">风险摘要</p>
                      <p className="text-sm leading-relaxed">{r.riskSummary}</p>
                    </div>
                    <div className="bg-muted/60 rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">AI 处置建议</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line">{r.suggestions}</p>
                    </div>
                    {r.status === "pending" && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: r.id, status: "reviewed" })}>
                          标记已复核
                        </Button>
                        <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: r.id, status: "actioned" })}>
                          已处置
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: r.id, status: "dismissed" })}>
                          驳回
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="mt-4">
            <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />
          </div>
        </>
      )}

      <AnalyzeDialog open={analyzeOpen} onOpenChange={setAnalyzeOpen} />
    </DashboardLayout>
  );
}
