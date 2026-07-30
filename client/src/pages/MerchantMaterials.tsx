import DashboardLayout from "@/components/DashboardLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, Boxes, CloudOff, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const statusLabels: Record<string, { label: string; className: string }> = {
  published: { label: "已发布", className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" },
  draft: { label: "待发布", className: "bg-amber-100 text-amber-700 hover:bg-amber-100" },
  offshelf: { label: "已下架", className: "bg-slate-200 text-slate-600 hover:bg-slate-200" },
};

function formatPrice(v: string | null) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `¥${n.toFixed(4).replace(/\.?0+$/, "")}`;
}

function formatTime(v: Date | string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

export default function MerchantMaterials() {
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<"published" | "draft" | "offshelf" | "all">("published");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [offshelfTarget, setOffshelfTarget] = useState<{ id: number; partNumber: string; companyName: string | null } | null>(null);

  const utils = trpc.useUtils();
  const listQuery = trpc.platformMaterial.list.useQuery(
    { keyword: keyword || undefined, status, page, pageSize },
    { placeholderData: prev => prev },
  );

  const offshelfMutation = trpc.platformMaterial.offshelf.useMutation({
    onSuccess: () => {
      toast.success("已下架，该物料已回到前台\"待发布\"列表");
      setOffshelfTarget(null);
      utils.platformMaterial.list.invalidate();
    },
    onError: err => {
      toast.error(err.message || "下架失败");
    },
  });

  const data = listQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSearch = () => {
    setKeyword(searchInput.trim());
    setPage(1);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Boxes className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">客户物料管理</h1>
            <p className="text-sm text-muted-foreground">
              查看商户在前台发布的芯片物料，可执行下架操作；下架后物料回到前台"待发布"列表，商户修改后可重新发布
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">物料列表</CardTitle>
            <CardDescription>
              共 {total} 条{keyword ? `（关键词：${keyword}）` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="搜索型号 / 品牌 / 企业名称"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
                />
              </div>
              <Select value={status} onValueChange={v => { setStatus(v as typeof status); setPage(1); }}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">已发布</SelectItem>
                  <SelectItem value="draft">待发布</SelectItem>
                  <SelectItem value="offshelf">已下架</SelectItem>
                  <SelectItem value="all">全部状态</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleSearch} disabled={listQuery.isFetching}>
                {listQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "搜索"}
              </Button>
              {keyword && (
                <Button variant="ghost" onClick={() => { setSearchInput(""); setKeyword(""); setPage(1); }}>
                  清除
                </Button>
              )}
            </div>

            {listQuery.isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> 加载中…
              </div>
            ) : data && !data.available ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <CloudOff className="h-10 w-10 text-muted-foreground/60" />
                <p className="font-medium">前台物料数据库暂不可用</p>
                <p className="text-sm text-muted-foreground max-w-md">
                  此功能需要访问前台（51电子网）数据库，仅在生产环境可用。开发预览环境无法连接前台库，属正常现象。
                </p>
              </div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">暂无物料数据</div>
            ) : (
              <>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>企业名称</TableHead>
                        <TableHead>型号</TableHead>
                        <TableHead>品牌</TableHead>
                        <TableHead>封装</TableHead>
                        <TableHead className="text-right">在售数量</TableHead>
                        <TableHead className="text-right">含税价</TableHead>
                        <TableHead>发布时间</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(item => {
                        const st = statusLabels[item.status] ?? { label: item.status, className: "" };
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="max-w-[220px]">
                              <div className="truncate font-medium">{item.companyName || "—"}</div>
                              {item.creditCode && (
                                <div className="text-xs text-muted-foreground truncate">{item.creditCode}</div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{item.partNumber}</TableCell>
                            <TableCell>{item.brand || "—"}</TableCell>
                            <TableCell>{item.pkg || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{item.qtyOnSale?.toLocaleString() ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatPrice(item.priceIncl)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatTime(item.publishedAt)}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={st.className}>{st.label}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {item.status === "published" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                                  onClick={() => setOffshelfTarget({ id: item.id, partNumber: item.partNumber, companyName: item.companyName })}
                                >
                                  <ArrowDownToLine className="h-3.5 w-3.5 mr-1" /> 下架
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>第 {page} / {totalPages} 页，共 {total} 条</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1 || listQuery.isFetching} onClick={() => setPage(p => p - 1)}>
                        上一页
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages || listQuery.isFetching} onClick={() => setPage(p => p + 1)}>
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!offshelfTarget} onOpenChange={open => { if (!open) setOffshelfTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认下架该物料？</AlertDialogTitle>
            <AlertDialogDescription>
              {offshelfTarget && (
                <>
                  即将下架 <span className="font-mono font-medium text-foreground">{offshelfTarget.partNumber}</span>
                  {offshelfTarget.companyName ? `（${offshelfTarget.companyName}）` : ""}。
                  下架后该物料将从前台搜索结果中移除，回到商户的"待发布物料"列表，商户修改后可重新发布。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={offshelfMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={offshelfMutation.isPending}
              onClick={e => {
                e.preventDefault();
                if (offshelfTarget) offshelfMutation.mutate({ id: offshelfTarget.id });
              }}
            >
              {offshelfMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              确认下架
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
