import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Building2, CalendarDays, CircleDollarSign, Loader2, RefreshCw, Search, ShoppingCart, Users } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDatabaseBeijingDateTime } from "@/lib/beijingTime";
import { trpc } from "@/lib/trpc";

const statusMeta = {
  pending: { label: "待付款", className: "bg-amber-100 text-amber-800" },
  paid: { label: "待发货", className: "bg-blue-100 text-blue-800" },
  shipped: { label: "已发货", className: "bg-violet-100 text-violet-800" },
  done: { label: "已完成", className: "bg-emerald-100 text-emerald-800" },
  refund: { label: "退款/售后", className: "bg-rose-100 text-rose-800" },
  cancel: { label: "已取消", className: "bg-slate-100 text-slate-700" },
} as const;

const payMethodLabels = { corp: "对公转账", alipay: "支付宝", wechat: "微信支付" } as const;
const money = (value: string | number | null | undefined) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateTime = (value: Date | string | null | undefined) =>
  formatDatabaseBeijingDateTime(value, "—", true);

function OrderStatus({ status }: { status: keyof typeof statusMeta }) {
  const meta = statusMeta[status];
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

function OrderList() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | keyof typeof statusMeta>("all");
  const input = useMemo(() => ({
    page,
    pageSize: 20,
    keyword: keyword || undefined,
    status: status === "all" ? undefined : status,
  }), [keyword, page, status]);
  const query = trpc.order.list.useQuery(input, { retry: 1 });
  const statsQuery = trpc.order.stats.useQuery(undefined, { retry: 1 });
  const stats = statsQuery.data;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));
  const isRefreshing = query.isFetching || statsQuery.isFetching;

  const submitSearch = () => {
    setPage(1);
    setKeyword(draftKeyword.trim());
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">订单管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">统一汇总平台用户订单，统计、列表与详情均来自商城唯一订单事实源。</p>
          </div>
          <Button variant="outline" onClick={() => void Promise.all([query.refetch(), statsQuery.refetch()])} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />刷新
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
          <Card><CardContent className="flex min-h-[88px] items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">订单总数</p><div className="mt-1 flex flex-wrap items-baseline gap-x-2"><p className="text-xl font-semibold tabular-nums">{stats?.totalOrders ?? "—"}</p><span className="text-[11px] text-muted-foreground">今日 {stats?.todayOrders ?? "—"}</span></div></div><div className="shrink-0 rounded-lg bg-blue-50 p-2 text-blue-600"><ShoppingCart className="h-4 w-4" /></div></CardContent></Card>
          <Card><CardContent className="flex min-h-[88px] items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">订单总额</p><p className="mt-1 break-all text-lg font-semibold tracking-tight tabular-nums sm:text-xl">{stats ? money(stats.grossAmount) : "—"}</p></div><div className="shrink-0 rounded-lg bg-emerald-50 p-2 text-emerald-600"><CircleDollarSign className="h-4 w-4" /></div></CardContent></Card>
          <Card><CardContent className="flex min-h-[88px] items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">近7日订单</p><p className="mt-1 text-xl font-semibold tabular-nums">{stats?.sevenDayOrders ?? "—"}</p></div><div className="shrink-0 rounded-lg bg-violet-50 p-2 text-violet-600"><CalendarDays className="h-4 w-4" /></div></CardContent></Card>
          <Card><CardContent className="flex min-h-[88px] items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">交易用户</p><div className="mt-1 flex flex-wrap items-baseline gap-x-2"><p className="text-xl font-semibold tabular-nums">{stats?.buyerCount ?? "—"}</p><span className="text-[11px] text-muted-foreground">供应商 {stats?.sellerCount ?? "—"}</span></div></div><div className="shrink-0 rounded-lg bg-amber-50 p-2 text-amber-600"><Users className="h-4 w-4" /></div></CardContent></Card>
        </div>

        <Card><CardContent className="flex flex-wrap items-center gap-2 p-3">
          <span className="mr-2 text-sm font-medium">订单状态统计</span>
          {Object.entries(statusMeta).map(([value, meta]) => <button key={value} type="button" className={`rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-primary ${status === value ? "border-primary bg-primary/5" : "border-border"}`} onClick={() => { setStatus(value as keyof typeof statusMeta); setPage(1); }}>{meta.label} <span className="font-semibold">{stats?.statusCounts[value as keyof typeof statusMeta] ?? "—"}</span></button>)}
          {statsQuery.error && <span className="text-sm text-destructive">统计暂不可用：{statsQuery.error.message}</span>}
        </CardContent></Card>

        <Card>
          <CardContent className="flex flex-col gap-2 p-3 md:flex-row">
            <div className="flex flex-1 gap-2">
              <Input
                value={draftKeyword}
                onChange={event => setDraftKeyword(event.target.value)}
                onKeyDown={event => event.key === "Enter" && submitSearch()}
                placeholder="订单号、买家、供应商、收货人或手机号"
              />
              <Button onClick={submitSearch}><Search className="mr-2 h-4 w-4" />搜索</Button>
            </div>
            <Select value={status} onValueChange={value => { setStatus(value as typeof status); setPage(1); }}>
              <SelectTrigger className="w-full md:w-44"><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {Object.entries(statusMeta).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>{meta.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {query.isLoading ? (
              <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : query.error ? (
              <div className="p-10 text-center">
                <p className="font-medium text-destructive">商城订单服务暂不可用</p>
                <p className="mt-2 text-sm text-muted-foreground">{query.error.message}</p>
                <Button className="mt-4" variant="outline" onClick={() => query.refetch()}>重试</Button>
              </div>
            ) : !query.data?.rows.length ? (
              <div className="p-12 text-center text-sm text-muted-foreground">没有符合条件的真实订单</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>订单</TableHead><TableHead>买家</TableHead><TableHead>供应商</TableHead>
                    <TableHead>状态</TableHead><TableHead className="text-right">金额</TableHead>
                    <TableHead>下单时间</TableHead><TableHead className="text-right">详情</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {query.data.rows.map(order => (
                      <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${order.id}`)}>
                        <TableCell>
                          <Link href={`/orders/${order.id}`} onClick={event => event.stopPropagation()} className="font-mono text-sm font-semibold text-primary hover:underline">{order.orderNo}</Link>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {order.batchNo ? `父单 ${order.batchNo} · 子单 ${String(order.batchSeq).padStart(2, "0")}` : "历史 DZ 订单"}
                          </div>
                        </TableCell>
                        <TableCell>{order.buyerName || order.buyerUsername || `用户 ${order.buyerId}`}</TableCell>
                        <TableCell>{order.sellerName}</TableCell>
                        <TableCell><OrderStatus status={order.status} /></TableCell>
                        <TableCell className="text-right font-medium">{money(order.totalAmount)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{dateTime(order.createdAt)}</TableCell>
                        <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={event => { event.stopPropagation(); navigate(`/orders/${order.id}`); }}>查看详情</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {query.data?.total ?? 0} 条</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
            <span>{page} / {pageCount}</span>
            <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>下一页</Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function OrderDetail({ orderId }: { orderId: number }) {
  const query = trpc.order.detail.useQuery({ orderId }, { retry: 1 });
  const data = query.data;

  if (query.isLoading) return <DashboardLayout><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div></DashboardLayout>;
  if (query.error || !data) return (
    <DashboardLayout><div className="p-6"><Link href="/orders"><Button variant="ghost"><ArrowLeft className="mr-2 h-4 w-4" />返回订单管理</Button></Link><Card className="mt-4"><CardContent className="p-10 text-center text-destructive">{query.error?.message || "订单不存在"}</CardContent></Card></div></DashboardLayout>
  );

  const order = data.order;
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 sm:p-6">
        <div>
          <Link href="/orders"><Button variant="ghost" className="-ml-3"><ArrowLeft className="mr-2 h-4 w-4" />返回订单管理</Button></Link>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><h1 className="font-mono text-xl font-semibold">{order.orderNo}</h1><OrderStatus status={order.status} /></div><p className="mt-1 text-sm text-muted-foreground">{order.batchNo ? `父订单 ${order.batchNo} · 第 ${String(order.batchSeq).padStart(2, "0")} 张子订单` : "历史 DZ 订单（无父批次）"}</p></div>
            <div className="text-left sm:text-right"><div className="text-2xl font-semibold">{money(order.totalAmount)}</div><div className="text-xs text-muted-foreground">{dateTime(order.createdAt)}</div></div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" />交易信息</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>买家：{order.buyerName || order.buyerUsername || `用户 ${order.buyerId}`} <span className="text-muted-foreground">（用户ID {order.buyerId}）</span></p><p>供应商：{order.sellerName} <span className="text-muted-foreground">（用户ID {order.sellerId}）</span></p><p>支付方式：{payMethodLabels[order.payMethod]}</p><p>未税 {money(order.amountEx)} · 税额 {money(order.taxAmount)} · 运费 {money(order.shippingFee)}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">收货与物流</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{order.receiver} · {order.receiverPhone}</p><p className="text-muted-foreground">{order.receiverAddress}</p><p>{order.expressCo && order.expressNo ? `${order.expressCo} · ${order.expressNo}` : "尚未发货"}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">备注</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{order.note || "无买家备注"}</p>{order.statusNote && <p className="text-muted-foreground">状态说明：{order.statusNote}</p>}</CardContent></Card>
        </div>

        {data.siblings.length > 1 && <Card><CardHeader><CardTitle className="text-base">同一父订单的子订单</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{data.siblings.map(item => <Link key={item.id} href={`/orders/${item.id}`}><div className={`rounded-lg border p-3 transition-colors hover:bg-muted ${item.id === orderId ? "border-primary bg-primary/5" : ""}`}><div className="flex items-center justify-between gap-2"><span className="font-mono text-sm">{item.orderNo}</span><OrderStatus status={item.status} /></div><div className="mt-2 flex justify-between text-sm text-muted-foreground"><span>{item.sellerName}</span><span>{money(item.totalAmount)}</span></div></div></Link>)}</CardContent></Card>}

        <Card><CardHeader><CardTitle className="text-base">商品项</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><Table><TableHeader><TableRow><TableHead>物料</TableHead><TableHead>品牌/封装</TableHead><TableHead className="text-right">数量</TableHead><TableHead className="text-right">单价</TableHead><TableHead className="text-right">小计</TableHead></TableRow></TableHeader><TableBody>{data.items.map(item => <TableRow key={item.id}><TableCell><div className="font-medium">{item.partNumber}</div><div className="text-xs text-muted-foreground">{item.materialCode || "无平台物料码"}</div></TableCell><TableCell>{item.brand}{item.pkg ? ` / ${item.pkg}` : ""}</TableCell><TableCell className="text-right">{item.qty.toLocaleString()} {item.unit}</TableCell><TableCell className="text-right">{money(item.unitPrice)}</TableCell><TableCell className="text-right font-medium">{money(item.subtotal)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>

        <Card><CardHeader><CardTitle className="text-base">状态轨迹</CardTitle></CardHeader><CardContent>{data.tracks.length ? <div className="space-y-4">{data.tracks.map(track => <div key={track.id} className="relative border-l-2 border-primary/30 pl-4"><div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" /><p className="text-sm">{track.content}</p><p className="mt-1 text-xs text-muted-foreground">{dateTime(track.createdAt)}</p></div>)}</div> : <p className="text-sm text-muted-foreground">暂无轨迹</p>}</CardContent></Card>
      </div>
    </DashboardLayout>
  );
}

export default function Orders() {
  const [, params] = useRoute<{ id: string }>("/orders/:id");
  const orderId = params?.id ? Number(params.id) : null;
  if (orderId && Number.isSafeInteger(orderId) && orderId > 0) return <OrderDetail orderId={orderId} />;
  return <OrderList />;
}
