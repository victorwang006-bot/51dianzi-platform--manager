import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateTime,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { trpc } from "@/lib/trpc";
import { Search } from "lucide-react";
import { useState } from "react";

const modules = ["商户管理", "商品管理", "订单中心", "售后退款", "财务账本", "告警中心", "智能风控", "权限管理"];

type AuditLogItem = {
  id: number;
  operatorName: string | null;
  operatorRole: string | null;
  action: string;
  module: string | null;
  targetType: string | null;
  targetId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  result: string;
  note: string | null;
  createdAt: Date;
};

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const [module, setModule] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [detail, setDetail] = useState<AuditLogItem | null>(null);

  const { data, isLoading } = trpc.auditLog.list.useQuery({
    page,
    pageSize: 20,
    module: module === "all" ? undefined : module,
    search: search || undefined,
  });

  const doSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <DashboardLayout>
      <PageHeader title="审计中心" description="完整操作日志记录、敏感数据访问追踪与管理员操作变更记录" />

      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Input
              placeholder="搜索操作 / 操作人"
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
          <Select value={module} onValueChange={v => { setModule(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="全部模块" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模块</SelectItem>
              {modules.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
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
            <EmptyState message="暂无审计日志" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作人</th>
                      <th>模块</th>
                      <th>操作</th>
                      <th>目标</th>
                      <th>结果</th>
                      <th>备注</th>
                      <th>详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(log => (
                      <tr key={log.id}>
                        <td className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                        <td className="text-xs">
                          <p className="font-medium">{log.operatorName ?? "系统"}</p>
                          <p className="text-muted-foreground">{log.operatorRole ?? ""}</p>
                        </td>
                        <td className="text-xs">{log.module ?? "-"}</td>
                        <td className="text-xs font-medium">{log.action}</td>
                        <td className="font-mono text-xs text-muted-foreground">
                          {log.targetType ? `${log.targetType}#${log.targetId}` : "-"}
                        </td>
                        <td>
                          <StatusBadge
                            label={log.result === "success" ? "成功" : log.result === "failed" ? "失败" : "已拦截"}
                            style={log.result === "success" ? "success" : "danger"}
                          />
                        </td>
                        <td className="max-w-[200px] truncate text-xs text-muted-foreground">{log.note ?? "-"}</td>
                        <td>
                          {(log.beforeValue || log.afterValue) ? (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDetail(log as AuditLogItem)}>
                              变更详情
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={detail !== null} onOpenChange={open => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>变更详情</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">操作</p>
                <p>{detail.module} · {detail.action}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">变更前</p>
                  <pre className="text-xs bg-muted rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                    {detail.beforeValue ? JSON.stringify(detail.beforeValue, null, 2) : "无记录"}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">变更后</p>
                  <pre className="text-xs bg-muted rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                    {detail.afterValue ? JSON.stringify(detail.afterValue, null, 2) : "无记录"}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
