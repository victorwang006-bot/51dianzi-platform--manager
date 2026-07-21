import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  agreementStatusMap,
  formatDateTime,
  merchantStatusMap,
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
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type ReviewAction = "approve" | "reject" | "supplement" | "suspend" | "terminate" | "reactivate";

const actionLabels: Record<ReviewAction, string> = {
  approve: "审核通过",
  reject: "审核拒绝",
  supplement: "要求补件",
  suspend: "暂停商户",
  terminate: "清退商户",
  reactivate: "恢复商户",
};

export default function Merchants() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [reviewTarget, setReviewTarget] = useState<{ id: number; name: string; action: ReviewAction } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.merchant.list.useQuery({
    page,
    pageSize: 20,
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });
  const { data: detail } = trpc.merchant.detail.useQuery(
    { id: detailId ?? 0 },
    { enabled: detailId !== null },
  );

  const reviewMutation = trpc.merchant.review.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.merchant.list.invalidate();
      setReviewTarget(null);
      setReviewNote("");
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  const doSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <DashboardLayout>
      <PageHeader title="商户管理" description="商户入驻审核、资质管理、协议状态与结算账户配置" />

      {/* 筛选栏 */}
      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Input
              placeholder="搜索公司名称 / 商户编号"
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
              <SelectItem value="supplement">待补件</SelectItem>
              <SelectItem value="approved">已入驻</SelectItem>
              <SelectItem value="suspended">已暂停</SelectItem>
              <SelectItem value="terminated">已清退</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* 列表 */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="暂无商户数据" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>商户编号</th>
                      <th>公司名称</th>
                      <th>联系人</th>
                      <th>状态</th>
                      <th>协议</th>
                      <th>资质到期</th>
                      <th>入驻时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(m => {
                      const st = merchantStatusMap[m.status] ?? { label: m.status, style: "gray" as const };
                      const ag = agreementStatusMap[m.agreementStatus] ?? { label: m.agreementStatus, style: "gray" as const };
                      const licenseExpiringSoon = m.licenseExpiry && new Date(m.licenseExpiry).getTime() - Date.now() < 30 * 86400_000;
                      return (
                        <tr key={m.id}>
                          <td className="font-mono text-xs">{m.merchantNo}</td>
                          <td className="max-w-[220px]">
                            <Link href={`/merchants/${m.id}`} className="text-primary hover:underline text-left truncate block max-w-full">
                              {m.companyName}
                            </Link>
                          </td>
                          <td>
                            <div className="text-xs">
                              <p>{m.contactName ?? "-"}</p>
                              <p className="text-muted-foreground">{m.contactPhone ?? ""}</p>
                            </div>
                          </td>
                          <td><StatusBadge label={st.label} style={st.style} /></td>
                          <td><StatusBadge label={ag.label} style={ag.style} /></td>
                          <td className={`text-xs ${licenseExpiringSoon ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                            {m.licenseExpiry ? formatDateTime(m.licenseExpiry).split(" ")[0] : "-"}
                          </td>
                          <td className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                          <td>
                            <div className="flex items-center gap-1 flex-wrap">
                              {(m.status === "pending" || m.status === "supplement") && (
                                <>
                                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => setReviewTarget({ id: m.id, name: m.companyName, action: "approve" })}>
                                    通过
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewTarget({ id: m.id, name: m.companyName, action: "supplement" })}>
                                    补件
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setReviewTarget({ id: m.id, name: m.companyName, action: "reject" })}>
                                    拒绝
                                  </Button>
                                </>
                              )}
                              {m.status === "approved" && (
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewTarget({ id: m.id, name: m.companyName, action: "suspend" })}>
                                  暂停
                                </Button>
                              )}
                              {m.status === "suspended" && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewTarget({ id: m.id, name: m.companyName, action: "reactivate" })}>
                                    恢复
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setReviewTarget({ id: m.id, name: m.companyName, action: "terminate" })}>
                                    清退
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

      {/* 审核对话框 */}
      <Dialog open={reviewTarget !== null} onOpenChange={open => !open && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewTarget ? actionLabels[reviewTarget.action] : ""}</DialogTitle>
            <DialogDescription>
              目标商户：{reviewTarget?.name}。此操作将被记录到审计日志。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="请填写操作理由 / 备注（必填）"
            value={reviewNote}
            onChange={e => setReviewNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>取消</Button>
            <Button
              disabled={reviewMutation.isPending || !reviewNote.trim()}
              onClick={() => {
                if (!reviewTarget) return;
                reviewMutation.mutate({ id: reviewTarget.id, action: reviewTarget.action, note: reviewNote.trim() });
              }}
            >
              确认{reviewTarget ? actionLabels[reviewTarget.action] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 商户详情 */}
      <Dialog open={detailId !== null} onOpenChange={open => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>商户详情</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">商户编号</p><p className="font-mono">{detail.merchantNo}</p></div>
                <div><p className="text-xs text-muted-foreground">公司名称</p><p>{detail.companyName}</p></div>
                <div><p className="text-xs text-muted-foreground">联系人</p><p>{detail.contactName ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">联系电话</p><p>{detail.contactPhone ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">邮箱</p><p>{detail.contactEmail ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">营业执照号</p><p className="font-mono">{detail.businessLicense ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">资质到期日</p><p>{detail.licenseExpiry ? formatDateTime(detail.licenseExpiry).split(" ")[0] : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">佣金费率</p><p>{detail.commissionRate ? `${(parseFloat(detail.commissionRate) * 100).toFixed(2)}%` : "-"}</p></div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground mb-2">结算账户</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">开户行</p><p>{detail.settlementBank ?? "-"}</p></div>
                  <div><p className="text-xs text-muted-foreground">账户名</p><p>{detail.settlementAccountName ?? "-"}</p></div>
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">账号</p><p className="font-mono">{detail.settlementAccount ?? "-"}</p></div>
                </div>
              </div>
              {detail.reviewNote && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">最近审核备注</p>
                  <p className="mt-1">{detail.reviewNote}</p>
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-48" />
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
