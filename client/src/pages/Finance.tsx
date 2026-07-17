import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  flowStatusMap,
  flowTypeMap,
  formatDateTime,
  formatMoney,
  settlementStatusMap,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Banknote, FileSpreadsheet, Landmark, Receipt, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function SummaryCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="stat-card flex items-start gap-4">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold mt-0.5 tracking-tight">{value}</p>
      </div>
    </div>
  );
}

function FlowsTab() {
  const [page, setPage] = useState(1);
  const [flowType, setFlowType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading } = trpc.finance.flows.useQuery({
    page,
    pageSize: 20,
    flowType: flowType === "all" ? undefined : flowType,
    search: search || undefined,
  });

  const doSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <>
      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Input
              placeholder="搜索流水号 / 订单号"
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
          <Select value={flowType} onValueChange={v => { setFlowType(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="payment">支付</SelectItem>
              <SelectItem value="refund">退款</SelectItem>
              <SelectItem value="platform_fee">平台服务费</SelectItem>
              <SelectItem value="settlement">结算</SelectItem>
              <SelectItem value="adjustment">调账</SelectItem>
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
            <EmptyState message="暂无流水记录" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>流水号</th>
                      <th>类型</th>
                      <th>关联订单</th>
                      <th>金额</th>
                      <th>支付渠道</th>
                      <th>状态</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(f => {
                      const tp = flowTypeMap[f.flowType] ?? { label: f.flowType, style: "gray" as const };
                      const st = flowStatusMap[f.status] ?? { label: f.status, style: "gray" as const };
                      const isNegative = f.flowType === "refund" || f.flowType === "settlement";
                      return (
                        <tr key={f.id}>
                          <td className="font-mono text-xs">{f.flowNo}</td>
                          <td><StatusBadge label={tp.label} style={tp.style} /></td>
                          <td className="font-mono text-xs text-muted-foreground">{f.orderNo ?? "-"}</td>
                          <td className={`font-medium ${isNegative ? "text-red-600" : "text-green-700"}`}>
                            {isNegative ? "-" : "+"}{formatMoney(f.amount)}
                          </td>
                          <td className="text-xs">{f.channel ?? "-"}</td>
                          <td><StatusBadge label={st.label} style={st.style} /></td>
                          <td className="text-xs text-muted-foreground">{formatDateTime(f.createdAt)}</td>
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
    </>
  );
}

function SettlementsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [genOpen, setGenOpen] = useState(false);
  const [genMerchantId, setGenMerchantId] = useState<string>("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.finance.settlements.useQuery({
    page,
    pageSize: 20,
    status: status === "all" ? undefined : status,
  });
  const { data: merchants } = trpc.merchant.list.useQuery({ page: 1, pageSize: 100, status: "approved" });

  const generateMutation = trpc.finance.generateSettlement.useMutation({
    onSuccess: res => {
      toast.success(`结算单已生成：${res.settlementNo}，应结金额 ${formatMoney(res.netAmount)}`);
      utils.finance.settlements.invalidate();
      setGenOpen(false);
      setGenMerchantId("");
    },
    onError: err => toast.error(`生成失败：${err.message}`),
  });

  const updateMutation = trpc.finance.updateSettlement.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.finance.settlements.invalidate();
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  return (
    <>
      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="confirmed">已确认</SelectItem>
              <SelectItem value="paying">打款中</SelectItem>
              <SelectItem value="paid">已打款</SelectItem>
              <SelectItem value="failed">打款失败</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setGenOpen(true)}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            生成结算单
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="暂无结算单" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>结算单号</th>
                      <th>商户</th>
                      <th>订单数</th>
                      <th>交易总额</th>
                      <th>平台服务费</th>
                      <th>应结金额</th>
                      <th>状态</th>
                      <th>生成时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(s => {
                      const st = settlementStatusMap[s.status] ?? { label: s.status, style: "gray" as const };
                      return (
                        <tr key={s.id}>
                          <td className="font-mono text-xs">{s.settlementNo}</td>
                          <td className="max-w-[180px] truncate text-xs">{s.merchantName ?? `商户#${s.merchantId}`}</td>
                          <td className="text-xs">{s.orderCount}</td>
                          <td className="font-medium">{formatMoney(s.totalAmount)}</td>
                          <td className="text-xs text-muted-foreground">{formatMoney(s.feeAmount)}</td>
                          <td className="font-semibold text-primary">{formatMoney(s.netAmount)}</td>
                          <td><StatusBadge label={st.label} style={st.style} /></td>
                          <td className="text-xs text-muted-foreground">{formatDateTime(s.createdAt)}</td>
                          <td>
                            <div className="flex items-center gap-1 flex-wrap">
                              {s.status === "draft" && (
                                <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: s.id, action: "confirm" })}>
                                  确认
                                </Button>
                              )}
                              {s.status === "confirmed" && (
                                <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: s.id, action: "pay" })}>
                                  发起打款
                                </Button>
                              )}
                              {s.status === "paying" && (
                                <>
                                  <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: s.id, action: "paid" })}>
                                    打款成功
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: s.id, action: "fail" })}>
                                    打款失败
                                  </Button>
                                </>
                              )}
                              {s.status === "failed" && (
                                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: s.id, action: "pay" })}>
                                  重新打款
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
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      {/* 生成结算单 */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>生成结算单</DialogTitle>
            <DialogDescription>
              系统将汇总所选商户所有已完成且未结算的订单，自动计算交易总额、平台服务费与应结金额。
            </DialogDescription>
          </DialogHeader>
          <Select value={genMerchantId} onValueChange={setGenMerchantId}>
            <SelectTrigger>
              <SelectValue placeholder="选择商户" />
            </SelectTrigger>
            <SelectContent>
              {merchants?.data.map(m => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.companyName}（{m.merchantNo}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>取消</Button>
            <Button
              disabled={!genMerchantId || generateMutation.isPending}
              onClick={() => generateMutation.mutate({ merchantId: parseInt(genMerchantId, 10) })}
            >
              {generateMutation.isPending ? "生成中..." : "确认生成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Finance() {
  const { data: summary, isLoading: summaryLoading } = trpc.finance.summary.useQuery();

  return (
    <DashboardLayout>
      <PageHeader title="财务账本与对账" description="支付流水查询、平台服务费统计、商户应收管理与结算单生成" />

      {summaryLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard icon={Banknote} label="支付流水总额" value={formatMoney(summary?.totalPayment)} color="bg-green-50 text-green-600" />
          <SummaryCard icon={Receipt} label="平台服务费收入" value={formatMoney(summary?.totalPlatformFee)} color="bg-blue-50 text-blue-600" />
          <SummaryCard icon={Landmark} label="商户应结余额" value={formatMoney(summary?.pendingSettlement)} color="bg-indigo-50 text-indigo-600" />
          <SummaryCard icon={FileSpreadsheet} label="累计退款金额" value={formatMoney(summary?.totalRefund)} color="bg-amber-50 text-amber-600" />
        </div>
      )}

      <Tabs defaultValue="flows">
        <TabsList className="mb-4">
          <TabsTrigger value="flows">支付流水</TabsTrigger>
          <TabsTrigger value="settlements">结算单管理</TabsTrigger>
        </TabsList>
        <TabsContent value="flows">
          <FlowsTab />
        </TabsContent>
        <TabsContent value="settlements">
          <SettlementsTab />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
