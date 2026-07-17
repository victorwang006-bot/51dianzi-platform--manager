import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateTime,
  formatMoney,
  orderStatusMap,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Search, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type OrderAction = "cancelled" | "abnormal" | "processing" | "completed";

const actionLabels: Record<OrderAction, string> = {
  cancelled: "取消订单",
  abnormal: "标记异常",
  processing: "恢复处理",
  completed: "标记完成",
};

export default function Orders() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [actionTarget, setActionTarget] = useState<{ id: number; orderNo: string; action: OrderAction } | null>(null);
  const [note, setNote] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.order.list.useQuery({
    page,
    pageSize: 20,
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });
  const { data: detail } = trpc.order.detail.useQuery(
    { id: detailId ?? 0 },
    { enabled: detailId !== null },
  );

  const updateMutation = trpc.order.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.order.list.invalidate();
      utils.order.detail.invalidate();
      utils.dashboard.stats.invalidate();
      setActionTarget(null);
      setNote("");
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  const analyzeMutation = trpc.risk.analyzeOrder.useMutation({
    onSuccess: res => {
      const levelMap: Record<string, string> = { low: "低风险", medium: "中风险", high: "高风险", critical: "极高风险" };
      toast.success(`智能风控分析完成：${levelMap[res.analysis.riskLevel] ?? res.analysis.riskLevel}，详情请前往智能风控页面查看`);
    },
    onError: err => toast.error(`分析失败：${err.message}`),
  });

  const doSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <DashboardLayout>
      <PageHeader title="订单中心" description="订单列表查询、状态追踪、异常标注与取消处理" />

      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Input
              placeholder="搜索订单号 / 买家 / 商品"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              className="max-w-xs"
            />
            <Button variant="outline" size="sm" onClick={doSearch}>
              <Search className="h-4 w-4 mr-1" />
              搜索
            </Button>
          </div>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending_payment">待付款</SelectItem>
              <SelectItem value="paid">已付款</SelectItem>
              <SelectItem value="processing">处理中</SelectItem>
              <SelectItem value="shipped">已发货</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
              <SelectItem value="refunding">退款中</SelectItem>
              <SelectItem value="abnormal">异常</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="暂无订单数据" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>订单号</th>
                      <th>买家</th>
                      <th>商品</th>
                      <th>数量</th>
                      <th>总金额</th>
                      <th>平台服务费</th>
                      <th>状态</th>
                      <th>异常标签</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(o => {
                      const st = orderStatusMap[o.status] ?? { label: o.status, style: "gray" as const };
                      return (
                        <tr key={o.id}>
                          <td>
                            <button className="font-mono text-xs text-primary hover:underline" onClick={() => setDetailId(o.id)}>
                              {o.orderNo}
                            </button>
                          </td>
                          <td className="text-xs">{o.buyerName ?? "-"}</td>
                          <td className="max-w-[180px] truncate text-xs">{o.productName ?? "-"}</td>
                          <td className="text-xs">{o.qty.toLocaleString()}</td>
                          <td className="font-medium">{formatMoney(o.totalAmount)}</td>
                          <td className="text-xs text-muted-foreground">{formatMoney(o.platformFee)}</td>
                          <td><StatusBadge label={st.label} style={st.style} /></td>
                          <td>
                            {o.abnormalTag ? (
                              <StatusBadge label={o.abnormalTag} style="danger" />
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</td>
                          <td>
                            <div className="flex items-center gap-1 flex-wrap">
                              {(o.status === "paid" || o.status === "processing" || o.status === "pending_payment") && (
                                <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setActionTarget({ id: o.id, orderNo: o.orderNo, action: "cancelled" })}>
                                  取消
                                </Button>
                              )}
                              {o.status !== "abnormal" && o.status !== "completed" && o.status !== "cancelled" && (
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActionTarget({ id: o.id, orderNo: o.orderNo, action: "abnormal" })}>
                                  标异常
                                </Button>
                              )}
                              {o.status === "abnormal" && (
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActionTarget({ id: o.id, orderNo: o.orderNo, action: "processing" })}>
                                  恢复
                                </Button>
                              )}
                              <Button
                                size="sm" variant="outline" className="h-7 text-xs"
                                disabled={analyzeMutation.isPending}
                                onClick={() => analyzeMutation.mutate({ orderId: o.id })}
                              >
                                <ShieldAlert className="h-3 w-3 mr-1" />
                                风控
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      {/* 操作对话框 */}
      <Dialog open={actionTarget !== null} onOpenChange={open => !open && setActionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionTarget ? actionLabels[actionTarget.action] : ""}</DialogTitle>
            <DialogDescription>
              目标订单：{actionTarget?.orderNo}。此操作将被记录到审计日志与订单状态流转记录。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="请填写操作理由 / 备注（必填）"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionTarget(null)}>取消</Button>
            <Button
              disabled={updateMutation.isPending || !note.trim()}
              onClick={() => {
                if (!actionTarget) return;
                updateMutation.mutate({ id: actionTarget.id, toStatus: actionTarget.action, note: note.trim() });
              }}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 订单详情与时间线 */}
      <Dialog open={detailId !== null} onOpenChange={open => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>订单详情</DialogTitle>
          </DialogHeader>
          {detail?.order ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">订单号</p><p className="font-mono text-xs">{detail.order.orderNo}</p></div>
                <div><p className="text-xs text-muted-foreground">买家</p><p>{detail.order.buyerName ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">商品</p><p className="truncate">{detail.order.productName ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">数量 × 单价</p><p>{detail.order.qty.toLocaleString()} × {formatMoney(detail.order.unitPrice)}</p></div>
                <div><p className="text-xs text-muted-foreground">总金额</p><p className="font-semibold text-primary">{formatMoney(detail.order.totalAmount)}</p></div>
                <div><p className="text-xs text-muted-foreground">平台服务费</p><p>{formatMoney(detail.order.platformFee)}</p></div>
                <div><p className="text-xs text-muted-foreground">支付时间</p><p className="text-xs">{formatDateTime(detail.order.paidAt)}</p></div>
                <div><p className="text-xs text-muted-foreground">发货时间</p><p className="text-xs">{formatDateTime(detail.order.shippedAt)}</p></div>
              </div>
              {detail.order.note && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">操作备注</p>
                  <p className="mt-1 text-xs">{detail.order.note}</p>
                </div>
              )}
              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground mb-3">状态流转时间线</p>
                {detail.logs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无流转记录</p>
                ) : (
                  <div className="space-y-0">
                    {detail.logs.map((log, idx) => (
                      <div key={log.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`h-2.5 w-2.5 rounded-full mt-1 shrink-0 ${idx === 0 ? "bg-primary" : "bg-gray-300"}`} />
                          {idx < detail.logs.length - 1 && <div className="w-px flex-1 bg-border my-0.5" />}
                        </div>
                        <div className="pb-4 min-w-0">
                          <p className="text-xs">
                            <span className="text-muted-foreground">{log.fromStatus ? `${orderStatusMap[log.fromStatus]?.label ?? log.fromStatus} → ` : ""}</span>
                            <span className="font-medium">{orderStatusMap[log.toStatus]?.label ?? log.toStatus}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDateTime(log.createdAt)} · {log.operatorName ?? "系统"}
                            {log.note && ` · ${log.note}`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Skeleton className="h-48" />
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
