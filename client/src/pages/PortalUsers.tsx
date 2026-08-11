import { useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CalendarPlus,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  Users,
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

const PAGE_SIZE = 20;

const dateTime = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

export default function PortalUsers() {
  const [page, setPage] = useState(1);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
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

  const submitSearch = () => {
    setPage(1);
    setKeyword(draftKeyword.trim());
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              统计前台注册用户，并按后台权威开通状态区分普通用户与ERP用户。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void Promise.all([query.refetch(), statsQuery.refetch()])}
            disabled={isRefreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div><p className="text-sm text-muted-foreground">注册用户</p><p className="mt-2 text-2xl font-semibold">{stats?.totalUsers ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">前台真实注册账号</p></div>
              <div className="rounded-full bg-blue-50 p-3 text-blue-600"><Users className="h-5 w-5" /></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div><p className="text-sm text-muted-foreground">普通用户</p><p className="mt-2 text-2xl font-semibold">{stats?.ordinaryUsers ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">尚未开通ERP</p></div>
              <div className="rounded-full bg-slate-100 p-3 text-slate-600"><UserRound className="h-5 w-5" /></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div><p className="text-sm text-muted-foreground">ERP用户</p><p className="mt-2 text-2xl font-semibold">{stats?.erpUsers ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">后台已开通并绑定</p></div>
              <div className="rounded-full bg-emerald-50 p-3 text-emerald-600"><Building2 className="h-5 w-5" /></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div><p className="text-sm text-muted-foreground">今日注册</p><p className="mt-2 text-2xl font-semibold">{stats?.todayRegistered ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">自然日新增账号</p></div>
              <div className="rounded-full bg-violet-50 p-3 text-violet-600"><CalendarPlus className="h-5 w-5" /></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div><p className="text-sm text-muted-foreground">近7日活跃</p><p className="mt-2 text-2xl font-semibold">{stats?.sevenDayActive ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">最近7×24小时登录</p></div>
              <div className="rounded-full bg-amber-50 p-3 text-amber-600"><Activity className="h-5 w-5" /></div>
            </CardContent>
          </Card>
        </div>

        {statsQuery.error && (
          <Card><CardContent className="p-4 text-sm text-destructive">用户统计暂不可用：{statsQuery.error.message}</CardContent></Card>
        )}

        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 md:flex-row">
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>联系方式</TableHead>
                      <TableHead>企业</TableHead>
                      <TableHead>用户类型</TableHead>
                      <TableHead>登录方式</TableHead>
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
                        <TableCell>{user.loginMethod || "—"}</TableCell>
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
    </DashboardLayout>
  );
}
