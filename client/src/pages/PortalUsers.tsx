import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTimeWithSeconds } from "@shared/beijingTime";

const PAGE_SIZE = 20;

// 注册与登录时间固定北京时间，便于排查异常登录时点。
const dateTime = (value: Date | string | null | undefined) =>
  value ? formatBeijingDateTimeWithSeconds(value) || "—" : "—";

const registrationChannel = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "未知";
  if (["local", "password"].includes(normalized)) return "网站注册";
  if (["wechat_miniprogram", "wechat_mini_program", "miniprogram"].includes(normalized)) {
    return "微信小程序";
  }
  if (["wechat", "wechat_oauth", "wechat_web"].includes(normalized)) return "微信渠道";
  if (["oauth", "manus"].includes(normalized)) return "第三方登录";
  return "其他渠道";
};

export default function PortalUsers() {
  const [page, setPage] = useState(1);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const input = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    keyword: keyword || undefined,
  }), [keyword, page]);
  const query = trpc.frontendUser.list.useQuery(input, { retry: 1 });
  const statsQuery = trpc.frontendUser.stats.useQuery(undefined, { retry: 1 });
  const stats = statsQuery.data;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));
  const isRefreshing = query.isFetching || statsQuery.isFetching;
  const summaryItems = [
    { label: "注册用户", value: stats?.totalUsers ?? "—" },
    { label: "普通用户", value: stats?.ordinaryUsers ?? "—" },
    { label: "ERP用户", value: stats?.erpUsers ?? "—" },
    { label: "今日注册", value: stats?.todayRegistered ?? "—" },
    { label: "近7日活跃", value: stats?.sevenDayActive ?? "—" },
  ];

  const getTableScrollElement = () =>
    tableRegionRef.current?.querySelector<HTMLElement>('[data-slot="table-container"]') ?? null;

  useLayoutEffect(() => {
    const tableScrollElement = getTableScrollElement();
    const topScrollElement = topScrollRef.current;
    if (!tableScrollElement || !topScrollElement) {
      setTableScrollWidth(0);
      setHasHorizontalOverflow(false);
      return;
    }

    let syncing = false;
    const measure = () => {
      const nextWidth = tableScrollElement.scrollWidth;
      setTableScrollWidth(nextWidth);
      setHasHorizontalOverflow(nextWidth > tableScrollElement.clientWidth + 1);
      topScrollElement.scrollLeft = tableScrollElement.scrollLeft;
    };
    const syncTopScroll = () => {
      if (syncing) return;
      syncing = true;
      topScrollElement.scrollLeft = tableScrollElement.scrollLeft;
      syncing = false;
    };
    const syncTableScroll = () => {
      if (syncing) return;
      syncing = true;
      tableScrollElement.scrollLeft = topScrollElement.scrollLeft;
      syncing = false;
    };

    tableScrollElement.addEventListener("scroll", syncTopScroll, { passive: true });
    topScrollElement.addEventListener("scroll", syncTableScroll, { passive: true });
    window.addEventListener("resize", measure);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    resizeObserver?.observe(tableScrollElement);
    measure();

    return () => {
      tableScrollElement.removeEventListener("scroll", syncTopScroll);
      topScrollElement.removeEventListener("scroll", syncTableScroll);
      window.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
    };
  }, [query.data?.rows.length]);

  const submitSearch = () => {
    setPage(1);
    setKeyword(draftKeyword.trim());
  };

  const scrollTableBy = (distance: number) => {
    getTableScrollElement()?.scrollBy({ left: distance, behavior: "smooth" });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              统计前台注册用户，并按后台权威开通状态区分普通用户与ERP用户。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void Promise.all([query.refetch(), statsQuery.refetch()])}
            disabled={isRefreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>

        <div
          aria-label="用户统计摘要"
          className="flex flex-wrap items-center gap-x-7 gap-y-2 border-y py-2 text-sm"
        >
          {summaryItems.map(item => (
            <div key={item.label} className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-muted-foreground">{item.label}</span>
              <strong className="text-base font-semibold text-foreground">{item.value}</strong>
            </div>
          ))}
        </div>

        {statsQuery.error && (
          <Card><CardContent className="p-3 text-sm text-destructive">用户统计暂不可用：{statsQuery.error.message}</CardContent></Card>
        )}

        <Card>
          <CardContent className="p-3">
            <div className="flex flex-1 gap-2">
              <Input
                value={draftKeyword}
                onChange={event => setDraftKeyword(event.target.value)}
                onKeyDown={event => event.key === "Enter" && submitSearch()}
                placeholder="用户名、姓名、手机号、邮箱或企业名称"
              />
              <Button onClick={submitSearch}><Search className="mr-2 h-4 w-4" />搜索</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {query.isLoading ? (
              <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : query.error ? (
              <div className="p-10 text-center">
                <p className="font-medium text-destructive">前台用户服务暂不可用</p>
                <p className="mt-2 text-sm text-muted-foreground">{query.error.message}</p>
                <Button className="mt-4" variant="outline" onClick={() => query.refetch()}>重试</Button>
              </div>
            ) : !query.data?.rows.length ? (
              <div className="p-12 text-center text-sm text-muted-foreground">没有符合条件的前台注册用户</div>
            ) : (
              <div ref={tableRegionRef} className="portal-user-table">
                <div
                  className={`${hasHorizontalOverflow ? "flex" : "hidden"} items-center gap-2 border-b bg-muted/25 px-3 py-2`}
                  aria-hidden={!hasHorizontalOverflow}
                >
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">左右拖动查看全部字段</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label="向左移动用户表格"
                      onClick={() => scrollTableBy(-360)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div
                      ref={topScrollRef}
                      className="portal-user-top-scroll h-[16px] min-w-0 flex-1 overflow-x-auto"
                      role="region"
                      aria-label="用户表格横向滚动"
                      tabIndex={0}
                    >
                      <div style={{ width: Math.max(tableScrollWidth, 1), height: 1 }} />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label="向右移动用户表格"
                      onClick={() => scrollTableBy(360)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                <Table className="min-w-[1320px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>联系方式</TableHead>
                      <TableHead>企业</TableHead>
                      <TableHead>用户类型</TableHead>
                      <TableHead>注册渠道</TableHead>
                      <TableHead>注册时间</TableHead>
                      <TableHead>最近登录</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.rows.map(user => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="font-medium">{user.name || user.username || `用户 ${user.id}`}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{user.username || "未设置用户名"} · ID {user.id}</div>
                        </TableCell>
                        <TableCell>
                          <div>{user.phone || "—"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{user.email || "未填写邮箱"}</div>
                        </TableCell>
                        <TableCell>
                          <div>{user.companyName || "—"}</div>
                          {user.creditCode && <div className="mt-1 text-xs text-muted-foreground">{user.creditCode}</div>}
                        </TableCell>
                        <TableCell>
                          {user.userType === "erp"
                            ? <Badge className="bg-emerald-100 text-emerald-800">ERP用户</Badge>
                            : <Badge variant="secondary">普通用户</Badge>}
                        </TableCell>
                        <TableCell>{registrationChannel(user.loginMethod)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{dateTime(user.createdAt)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{dateTime(user.lastSignedIn)}</TableCell>
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

      <style>{`
        .portal-user-table [data-slot="table-container"] {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .portal-user-table [data-slot="table-container"]::-webkit-scrollbar {
          display: none;
        }
        .portal-user-top-scroll {
          scrollbar-color: #6f8fa8 #dce7ef;
          scrollbar-width: auto;
        }
        .portal-user-top-scroll::-webkit-scrollbar {
          height: 14px;
        }
        .portal-user-top-scroll::-webkit-scrollbar-track {
          border-radius: 999px;
          background: #dce7ef;
        }
        .portal-user-top-scroll::-webkit-scrollbar-thumb {
          min-width: 72px;
          border: 2px solid #dce7ef;
          border-radius: 999px;
          background: #6f8fa8;
        }
        .portal-user-top-scroll::-webkit-scrollbar-thumb:hover {
          background: #476f8f;
        }
      `}</style>
    </DashboardLayout>
  );
}
