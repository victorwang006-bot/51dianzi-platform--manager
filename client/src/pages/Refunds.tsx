import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateTime,
  formatMoney,
  refundStatusMap,
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
import { FileImage, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type RefundAction = "approve" | "reject" | "execute" | "complete" | "fail";

const actionLabels: Record<RefundAction, string> = {
  approve: "审核通过",
  reject: "审核拒绝",
  execute: "执行退款",
  complete: "标记完成",
  fail: "标记失败",
};

export default function Refunds() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [actionTarget, setActionTarget] = useState<{ id: number; refundNo: string; action: RefundAction } | null>(null);
  const [note, setNote] = useState("");
  const [evidenceTarget, setEvidenceTarget] = useState<{ refundNo: string; urls: string[] } | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.refund.list.useQuery({
    page,
    pageSize: 20,
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });

  const reviewMutation = trpc.refund.review.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.refund.list.invalidate();
      utils.dashboard.stats.invalidate();
      setActionTarget(null);
      setNote("");
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  const doSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <DashboardLayout>
      <PageHeader title="售后与退款管理" description="退款申请审核、证据查看、退款执行与状态追踪" />

      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Input
              placeholder="搜索退款单号 / 订单号"
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
              <SelectItem value="pending">待审核</SelectItem>
              <SelectItem value="approved">已批准</SelectItem>
              <SelectItem value="rejected">已拒绝</SelectItem>
              <SelectItem value="executing">执行中</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
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
            <EmptyState message="暂无退款申请" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>退款单号</th>
                      <th>关联订单</th>
                      <th>退款金额</th>
                      <th>退款原因</th>
                      <th>证据</th>
                      <th>状态</th>
                      <th>申请时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(r => {
                      const st = refundStatusMap[r.status] ?? { label: r.status, style: "gray" as const };
                      const evidences = (r.evidenceUrls as string[] | null) ?? [];
                      return (
                        <tr key={r.id}>
                          <td className="font-mono text-xs">{r.refundNo}</td>
                          <td className="font-mono text-xs text-muted-foreground">{r.orderNo ?? "-"}</td>
                          <td className="font-medium text-red-600">{formatMoney(r.refundAmount)}</td>
                          <td className="max-w-[200px] truncate text-xs">{r.refundReason ?? "-"}</td>
                          <td>
                            {evidences.length > 0 ? (
                              <Button
                                size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => setEvidenceTarget({ refundNo: r.refundNo, urls: evidences })}
                              >
                                <FileImage className="h-3 w-3 mr-1" />
                                {evidences.length} 份
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">无</span>
                            )}
                          </td>
                          <td><StatusBadge label={st.label} style={st.style} /></td>
                          <td className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                          <td>
                            <div className="flex items-center gap-1 flex-wrap">
                              {r.status === "pending" && (
                                <>
                                  <Button size="sm" className="h-7 text-xs" onClick={() => setActionTarget({ id: r.id, refundNo: r.refundNo, action: "approve" })}>
                                    通过
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setActionTarget({ id: r.id, refundNo: r.refundNo, action: "reject" })}>
                                    拒绝
                                  </Button>
                                </>
                              )}
                              {r.status === "approved" && (
                                <Button size="sm" className="h-7 text-xs" onClick={() => setActionTarget({ id: r.id, refundNo: r.refundNo, action: "execute" })}>
                                  执行退款
                                </Button>
                              )}
                              {r.status === "executing" && (
                                <>
                                  <Button size="sm" className="h-7 text-xs" onClick={() => setActionTarget({ id: r.id, refundNo: r.refundNo, action: "complete" })}>
                                    完成
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setActionTarget({ id: r.id, refundNo: r.refundNo, action: "fail" })}>
                                    失败
                                  </Button>
                                </>
                              )}
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
              目标退款单：{actionTarget?.refundNo}。此操作将被记录到审计日志。
              {actionTarget?.action === "fail" && " 标记失败将自动触发退款异常告警并通知平台负责人。"}
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
              disabled={reviewMutation.isPending || !note.trim()}
              onClick={() => {
                if (!actionTarget) return;
                reviewMutation.mutate({ id: actionTarget.id, action: actionTarget.action, note: note.trim() });
              }}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 证据查看 */}
      <Dialog open={evidenceTarget !== null} onOpenChange={open => !open && setEvidenceTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>退款证据（{evidenceTarget?.refundNo}）</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {evidenceTarget?.urls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                <img src={url} alt={`证据 ${i + 1}`} className="w-full h-40 object-cover" loading="lazy" />
                <p className="text-xs text-center py-1.5 text-muted-foreground">证据 {i + 1}（点击查看原图）</p>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
