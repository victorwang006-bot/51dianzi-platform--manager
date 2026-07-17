import {
  EmptyState,
  PageHeader,
  StatusBadge,
  formatDateTime,
  formatMoney,
  merchantStatusMap,
  productStatusMap,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
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
import { Building2, ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type ProductAction = "approve" | "reject" | "activate" | "deactivate" | "ban";

const actionLabels: Record<ProductAction, string> = {
  approve: "审核通过",
  reject: "审核拒绝",
  activate: "上架",
  deactivate: "下架",
  ban: "禁售",
};

export default function Products() {
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [actionTarget, setActionTarget] = useState<{ id: number; name: string; action: ProductAction } | null>(null);
  const [note, setNote] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapse = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.product.listByMerchant.useQuery({
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });

  const reviewMutation = trpc.product.review.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.product.listByMerchant.invalidate();
      utils.product.list.invalidate();
      utils.dashboard.stats.invalidate();
      setActionTarget(null);
      setNote("");
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  const doSearch = () => {
    setSearch(searchInput);
  };

  return (
    <DashboardLayout>
      <PageHeader title="商品与库存治理" description="按商户展示商品，聚焦每个商户将要上架的产品；支持审核、上下架与禁售处理" />

      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Input
              placeholder="搜索商品名称 / 型号 / 品牌"
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
          <Select value={status} onValueChange={v => setStatus(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending_review">待审核（将上架）</SelectItem>
              <SelectItem value="active">已上架</SelectItem>
              <SelectItem value="inactive">已下架</SelectItem>
              <SelectItem value="banned">已禁售</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : !groups || groups.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState message="暂无商品数据" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map(g => {
            const pendingCount = g.products.filter(p => p.status === "pending_review").length;
            const mst = g.merchantStatus ? merchantStatusMap[g.merchantStatus] : undefined;
            const groupKey = String(g.merchantId ?? "unknown");
            const isCollapsed = !!collapsed[groupKey];
            return (
              <Card key={groupKey}>
                <CardContent className="p-0">
                  <div
                    className={`flex flex-wrap items-center gap-3 px-4 py-3 bg-[#fafbfc] cursor-pointer select-none hover:bg-[#f0f4f9] transition-colors ${isCollapsed ? "rounded-xl" : "border-b rounded-t-xl"}`}
                    onClick={() => toggleCollapse(groupKey)}
                    title={isCollapsed ? "展开商品列表" : "收起商品列表"}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-primary shrink-0" />
                      {g.merchantId ? (
                        <Link
                          href={`/merchants/${g.merchantId}`}
                          className="font-medium text-primary hover:underline truncate"
                          onClick={e => e.stopPropagation()}
                        >
                          {g.companyName ?? "未知商户"}
                        </Link>
                      ) : (
                        <span className="font-medium truncate">未知商户</span>
                      )}
                      {g.merchantNo && <span className="text-xs text-muted-foreground font-mono">{g.merchantNo}</span>}
                      {mst && <StatusBadge label={mst.label} style={mst.style} />}
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      {pendingCount > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0">
                          {pendingCount} 款商品待审核上架
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">共 {g.products.length} 款商品</span>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
                      />
                    </div>
                  </div>
                  <div className={`overflow-x-auto ${isCollapsed ? "hidden" : ""}`}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>商品编号</th>
                          <th>名称 / 型号</th>
                          <th>品牌</th>
                          <th>单价</th>
                          <th>库存 / 锁定</th>
                          <th>等级</th>
                          <th>状态</th>
                          <th>创建时间</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.products.map(p => {
                          const st = productStatusMap[p.status] ?? { label: p.status, style: "gray" as const };
                          return (
                            <tr key={p.id}>
                              <td className="font-mono text-xs">{p.productNo}</td>
                              <td className="max-w-[200px]">
                                <p className="truncate font-medium">{p.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{p.model ?? ""}</p>
                              </td>
                              <td className="text-xs">{p.brand ?? "-"}</td>
                              <td className="font-medium">{formatMoney(p.price)}</td>
                              <td className="text-xs">
                                <span className="font-medium">{p.stockQty?.toLocaleString() ?? 0}</span>
                                {(p.lockedQty ?? 0) > 0 && (
                                  <span className="text-amber-600 ml-1">(锁 {p.lockedQty?.toLocaleString()})</span>
                                )}
                                <span className="text-muted-foreground ml-0.5">{p.unit}</span>
                              </td>
                              <td className="text-xs">{p.grade ?? "-"}</td>
                              <td><StatusBadge label={st.label} style={st.style} /></td>
                              <td className="text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</td>
                              <td>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {p.status === "pending_review" && (
                                    <>
                                      <Button size="sm" className="h-7 text-xs" onClick={() => setActionTarget({ id: p.id, name: p.name, action: "approve" })}>
                                        通过
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setActionTarget({ id: p.id, name: p.name, action: "reject" })}>
                                        拒绝
                                      </Button>
                                    </>
                                  )}
                                  {p.status === "active" && (
                                    <>
                                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActionTarget({ id: p.id, name: p.name, action: "deactivate" })}>
                                        下架
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setActionTarget({ id: p.id, name: p.name, action: "ban" })}>
                                        禁售
                                      </Button>
                                    </>
                                  )}
                                  {p.status === "inactive" && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActionTarget({ id: p.id, name: p.name, action: "activate" })}>
                                      上架
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={actionTarget !== null} onOpenChange={open => !open && setActionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionTarget ? actionLabels[actionTarget.action] : ""}</DialogTitle>
            <DialogDescription>
              目标商品：{actionTarget?.name}。此操作将被记录到审计日志。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={actionTarget?.action === "ban" ? "请填写禁售原因（必填）" : "请填写操作理由 / 备注（必填）"}
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
                reviewMutation.mutate({
                  id: actionTarget.id,
                  action: actionTarget.action,
                  note: actionTarget.action === "ban" ? undefined : note.trim(),
                  banReason: actionTarget.action === "ban" ? note.trim() : undefined,
                });
              }}
            >
              确认{actionTarget ? actionLabels[actionTarget.action] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
