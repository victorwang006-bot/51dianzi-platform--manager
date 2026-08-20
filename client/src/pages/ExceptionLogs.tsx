import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
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
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type ExceptionCategory,
  type ExceptionSeverity,
} from "@shared/exceptionRules";

const PAGE_SIZE = 50;

/** 时间统一北京时间到秒，排查异常必须精确到秒。 */
const dateTime = (value: Date | string | null | undefined) =>
  value ? formatBeijingDateTimeWithSeconds(value) || "—" : "—";

const CATEGORY_OPTIONS: { value: ExceptionCategory | ""; label: string }[] = [
  { value: "", label: "全部类型" },
  { value: "attack_probe", label: CATEGORY_LABELS.attack_probe },
  { value: "server_error", label: CATEGORY_LABELS.server_error },
  { value: "integration", label: CATEGORY_LABELS.integration },
  { value: "auth_failure", label: CATEGORY_LABELS.auth_failure },
  { value: "rate_limit", label: CATEGORY_LABELS.rate_limit },
  { value: "slow_request", label: CATEGORY_LABELS.slow_request },
];

const RANGE_OPTIONS = [
  { value: 1, label: "近 1 小时" },
  { value: 24, label: "近 24 小时" },
  { value: 24 * 7, label: "近 7 天" },
  { value: 24 * 30, label: "近 30 天" },
];

const severityStyle: Record<ExceptionSeverity, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-slate-50 text-slate-600 border-slate-200",
};

const categoryStyle: Record<ExceptionCategory, string> = {
  attack_probe: "bg-red-50 text-red-700 border-red-200",
  server_error: "bg-orange-50 text-orange-700 border-orange-200",
  integration: "bg-purple-50 text-purple-700 border-purple-200",
  auth_failure: "bg-amber-50 text-amber-700 border-amber-200",
  rate_limit: "bg-blue-50 text-blue-700 border-blue-200",
  slow_request: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function ExceptionLogs() {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<ExceptionCategory | "">("");
  const [withinHours, setWithinHours] = useState(24);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const input = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      category: category || undefined,
      withinHours,
      search: keyword || undefined,
      ipAddress: ipFilter || undefined,
    }),
    [page, category, withinHours, keyword, ipFilter],
  );

  const query = trpc.exceptionLogs.list.useQuery(input, { retry: 1 });
  const statsQuery = trpc.exceptionLogs.stats.useQuery(undefined, { retry: 1 });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isRefreshing = query.isFetching || statsQuery.isFetching;

  // 态势卡片：按类别汇总近 24 小时
  const stats = statsQuery.data;
  const summary = useMemo(() => {
    const map = new Map<string, number>();
    (stats?.last24h ?? []).forEach(item => {
      map.set(item.category, (map.get(item.category) ?? 0) + item.count);
    });
    return [
      { key: "attack_probe", label: "攻击探测", value: map.get("attack_probe") ?? 0, danger: true },
      { key: "server_error", label: "服务器错误", value: map.get("server_error") ?? 0, danger: true },
      { key: "integration", label: "外部服务故障", value: map.get("integration") ?? 0, danger: true },
      { key: "auth_failure", label: "认证异常", value: map.get("auth_failure") ?? 0, danger: false },
      { key: "slow_request", label: "慢请求", value: map.get("slow_request") ?? 0, danger: false },
    ];
  }, [stats]);

  const resetToFirstPage = () => setPage(1);

  const applyKeyword = () => {
    setKeyword(draftKeyword.trim());
    resetToFirstPage();
  };

  const clearFilters = () => {
    setCategory("");
    setKeyword("");
    setDraftKeyword("");
    setIpFilter("");
    setWithinHours(24);
    resetToFirstPage();
  };

  const hasFilter = Boolean(category || keyword || ipFilter) || withinHours !== 24;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">异常日志</h1>
            <p className="mt-1 text-sm text-slate-500">
              自动记录服务器错误、攻击探测、认证异常与外部服务故障。日志保留 30 天，超期自动清理。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void query.refetch();
              void statsQuery.refetch();
            }}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            刷新
          </Button>
        </div>

        {/* 近 24 小时态势 */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {summary.map(item => (
            <Card key={item.key}>
              <CardContent className="p-4">
                <div className="text-xs text-slate-500">{item.label}</div>
                <div
                  className={`mt-1 text-2xl font-semibold ${
                    item.value > 0 && item.danger ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {item.value}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">近 24 小时</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 高频攻击源 */}
        {stats?.topIps && stats.topIps.length > 0 && (
          <Card className="border-red-100 bg-red-50/40">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-800">
                <ShieldAlert className="h-4 w-4" />
                近 7 天高频攻击来源
              </div>
              <div className="flex flex-wrap gap-2">
                {stats.topIps.map(ip => (
                  <button
                    key={ip.ipAddress}
                    type="button"
                    onClick={() => {
                      setIpFilter(ip.ipAddress);
                      setCategory("");
                      setWithinHours(24 * 7);
                      resetToFirstPage();
                    }}
                    className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 transition hover:bg-red-100"
                    title="点击查看该 IP 的全部行为"
                  >
                    <span className="font-mono">{ip.ipAddress}</span>
                    <span className="ml-1.5 text-red-500">{ip.count} 次</span>
                    {ip.ipOrigin && <span className="ml-1.5 text-slate-500">{ip.ipOrigin}</span>}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 筛选区 */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex items-center gap-2">
              <Input
                value={draftKeyword}
                onChange={e => setDraftKeyword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applyKeyword()}
                placeholder="搜索摘要 / 路径 / IP"
                className="w-64"
              />
              <Button size="sm" variant="outline" onClick={applyKeyword}>
                <Search className="mr-1.5 h-4 w-4" />
                搜索
              </Button>
            </div>

            <select
              value={category}
              onChange={e => {
                setCategory(e.target.value as ExceptionCategory | "");
                resetToFirstPage();
              }}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              {CATEGORY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              value={withinHours}
              onChange={e => {
                setWithinHours(Number(e.target.value));
                resetToFirstPage();
              }}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              {RANGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {ipFilter && (
              <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-700">
                IP: <span className="font-mono">{ipFilter}</span>
                <button
                  type="button"
                  onClick={() => {
                    setIpFilter("");
                    resetToFirstPage();
                  }}
                  className="ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}

            {hasFilter && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                清除筛选
              </Button>
            )}

            <div className="ml-auto text-sm text-slate-500">共 {total} 条</div>
          </CardContent>
        </Card>

        {/* 列表 */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">时间</TableHead>
                  <TableHead className="w-[110px]">类型</TableHead>
                  <TableHead className="w-[70px]">级别</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead className="w-[130px]">来源 IP</TableHead>
                  <TableHead className="w-[70px]">状态码</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-slate-400">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                )}
                {!query.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-slate-400">
                      <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                      所选范围内没有异常记录
                    </TableCell>
                  </TableRow>
                )}
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-slate-600">
                        {dateTime(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={categoryStyle[row.category as ExceptionCategory]}
                        >
                          {CATEGORY_LABELS[row.category as ExceptionCategory] ?? row.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={severityStyle[row.severity as ExceptionSeverity]}
                        >
                          {SEVERITY_LABELS[row.severity as ExceptionSeverity] ?? row.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-0">
                        <div className="truncate text-sm text-slate-800" title={row.summary}>
                          {row.summary}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {row.ipAddress ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {row.statusCode ?? "—"}
                      </TableCell>
                    </TableRow>
                    {expandedId === row.id && (
                      <TableRow key={`${row.id}-detail`}>
                        <TableCell colSpan={6} className="bg-slate-50 text-xs">
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 md:grid-cols-2">
                            <Field label="完整路径" value={row.path} mono />
                            <Field label="请求方法" value={row.method} />
                            <Field label="来源" value={row.source === "portal" ? "前台网站" : "管理后台"} />
                            <Field
                              label="耗时"
                              value={row.durationMs != null ? `${row.durationMs} 毫秒` : null}
                            />
                            <Field label="用户" value={row.userName} />
                            <Field label="指纹" value={row.fingerprint} mono />
                            <Field label="User-Agent" value={row.userAgent} wide />
                            {row.detail != null && (
                              <div className="md:col-span-2">
                                <dt className="text-slate-500">详情</dt>
                                <dd className="mt-0.5">
                                  <pre className="overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-slate-700">
                                    {JSON.stringify(row.detail, null, 2)}
                                  </pre>
                                </dd>
                              </div>
                            )}
                          </dl>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* 分页 */}
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-slate-600">
              第 {page} / {pageCount} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Field({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  wide?: boolean;
}) {
  if (!value) return null;
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-all text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
