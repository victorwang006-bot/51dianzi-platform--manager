import { useMemo, useState } from "react";
import { Activity, BarChart3, Eye, RefreshCw, UserCheck, Users } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

type RangeDays = 7 | 30 | 90;
const number = new Intl.NumberFormat("zh-CN");

const sourceLabels: Record<string, string> = {
  direct: "直接访问",
  internal: "站内跳转",
  search: "搜索引擎",
  wechat: "微信",
  external: "外部链接",
};
const deviceLabels: Record<string, string> = { mobile: "手机", desktop: "电脑", tablet: "平板" };

function pathLabel(path: string) {
  if (path === "/") return "首页";
  if (path === "/search") return "搜索结果";
  if (path.startsWith("/product/")) return "商品详情";
  if (path.startsWith("/company/")) return "公司详情";
  if (path === "/chat") return "聊一聊";
  if (path === "/account") return "个人中心";
  if (path === "/recommendations") return "今日推荐";
  if (path === "/data-hub") return "数据通";
  return path;
}

function Metric({ label, value, hint, icon: Icon }: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Eye;
}) {
  return (
    <Card className="p-4 shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
          <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
        </div>
        <span className="rounded-lg bg-blue-50 p-2 text-blue-600"><Icon className="h-4 w-4" /></span>
      </div>
    </Card>
  );
}

function Distribution({ title, rows, max }: {
  title: string;
  rows: Array<{ key: string; label: string; visitors: number }>;
  max: number;
}) {
  return (
    <Card className="p-4 shadow-none">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3">
        {rows.map(row => (
          <div key={row.key}>
            <div className="flex justify-between text-xs text-slate-600"><span>{row.label}</span><span>{number.format(row.visitors)}</span></div>
            <div className="mt-1 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.max(3, row.visitors / max * 100)}%` }} />
            </div>
          </div>
        ))}
        {rows.length === 0 ? <p className="py-4 text-center text-xs text-slate-400">暂无数据</p> : null}
      </div>
    </Card>
  );
}

export default function Analytics() {
  const [days, setDays] = useState<RangeDays>(30);
  const query = trpc.analytics.overview.useQuery({ days }, { refetchOnWindowFocus: true });
  const data = query.data;
  const summary = data?.summary;
  const sourceRows = useMemo(() => (data?.sources || []).map(item => ({
    key: item.source,
    label: sourceLabels[item.source] || item.source,
    visitors: item.visitors,
  })), [data?.sources]);
  const deviceRows = useMemo(() => (data?.devices || []).map(item => ({
    key: item.deviceType,
    label: deviceLabels[item.deviceType] || item.deviceType,
    visitors: item.visitors,
  })), [data?.devices]);
  const sourceMax = Math.max(1, ...sourceRows.map(item => item.visitors));
  const deviceMax = Math.max(1, ...deviceRows.map(item => item.visitors));

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-600" />
              <h1 className="text-2xl font-semibold text-slate-900">运营数据</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">统计商城网站访问、游客、注册和活跃用户，仅后台可查看。</p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 30, 90].map(value => (
              <Button key={value} size="sm" variant={days === value ? "default" : "outline"} onClick={() => setDays(value as RangeDays)}>
                近{value}天
              </Button>
            ))}
            <Button size="icon" variant="outline" aria-label="刷新" onClick={() => query.refetch()}>
              <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <Card className="p-16 text-center text-sm text-slate-400">正在加载运营数据…</Card>
        ) : query.error ? (
          <Card className="border-red-200 bg-red-50 p-8 text-center text-sm text-red-600">加载失败：{query.error.message}</Card>
        ) : summary ? (
          <>
            <Card className="border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shadow-none">
              <span className="font-medium">数据口径：</span>
              访问、访客和活跃用户从 {data.firstEventAt || "统计功能上线时"} 开始累计；
              注册总数、今日新增和近{days}天新增来自完整用户表，可追溯历史注册。
            </Card>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Metric label="页面浏览量 PV" value={number.format(summary.pageViews)} hint={`近${days}天页面打开次数`} icon={Eye} />
              <Metric label="访客数 UV" value={number.format(summary.visitors)} hint="同一浏览器去重" icon={Users} />
              <Metric label="访问会话" value={number.format(summary.sessions)} hint="浏览会话去重" icon={Activity} />
              <Metric label="未登录访客" value={number.format(summary.guestVisitors)} hint="至少一次未登录访问" icon={Users} />
              <Metric label="登录用户" value={number.format(summary.loggedInUsers)} hint="采集期内访问商城的账号" icon={UserCheck} />
              <Metric label="注册用户总数" value={number.format(summary.totalUsers)} hint="商城全部注册账号" icon={Users} />
              <Metric label="今日新增注册" value={number.format(summary.todayRegistered)} hint="完整用户表·北京时间" icon={UserCheck} />
              <Metric label={`${days}天新增注册`} value={number.format(summary.rangeRegistered)} hint="完整用户表" icon={UserCheck} />
              <Metric label="7日活跃用户" value={number.format(summary.sevenDayActive)} hint="采集开始后的近7日访问" icon={Activity} />
              <Metric label="30日活跃用户" value={number.format(summary.thirtyDayActive)} hint="采集开始后的近30日访问" icon={Activity} />
            </div>

            <Card className="p-4 shadow-none">
              <div className="flex flex-wrap justify-between gap-2">
                <div><h2 className="text-sm font-semibold">访问趋势</h2><p className="mt-0.5 text-xs text-slate-400">PV为页面打开次数，UV为去重访客数</p></div>
                <span className="text-xs text-slate-400">{data.firstEventAt ? `数据始于 ${data.firstEventAt}` : "上线后开始累计"}</span>
              </div>
              <div className="mt-4 h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.daily} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7ebef" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={value => String(value).slice(5)} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="pageViews" name="PV" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="visitors" name="UV" stroke="#d97706" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
              <Card className="overflow-hidden shadow-none">
                <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">热门页面</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-2 text-left">页面</th><th className="px-4 py-2 text-right">PV</th><th className="px-4 py-2 text-right">UV</th></tr></thead>
                    <tbody>
                      {data.topPages.map(item => <tr key={item.path} className="border-t"><td className="px-4 py-2.5"><span className="font-medium">{pathLabel(item.path)}</span><span className="ml-2 text-xs text-slate-400">{item.path}</span></td><td className="px-4 py-2.5 text-right">{number.format(item.pageViews)}</td><td className="px-4 py-2.5 text-right">{number.format(item.visitors)}</td></tr>)}
                      {data.topPages.length === 0 ? <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400">暂无访问数据</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="space-y-4">
                <Distribution title="访问来源" rows={sourceRows} max={sourceMax} />
                <Distribution title="设备分布" rows={deviceRows} max={deviceMax} />
              </div>
            </div>

            <p className="text-xs text-slate-400">访问明细保留{data.retentionDays}天；统计从功能上线后开始，不追溯历史访问。</p>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
