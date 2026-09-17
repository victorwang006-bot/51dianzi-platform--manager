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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTimeWithSeconds } from "@shared/beijingTime";
import {
  ArrowDownToLine,
  ChevronDown,
  CloudOff,
  Download,
  ImageIcon,
  Loader2,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const statusLabels: Record<string, { label: string; className: string }> = {
  published: { label: "已发布", className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" },
  draft: { label: "待发布", className: "bg-amber-100 text-amber-700 hover:bg-amber-100" },
  offshelf: { label: "已下架", className: "bg-slate-200 text-slate-600 hover:bg-slate-200" },
};

type MaterialItem = {
  id: number;
  partNumber: string;
  brand: string | null;
  pkg: string | null;
  photos: unknown;
  qtyOnSale: number | null;
  priceIncl: string | null;
  userId?: number | null;
  userName: string | null;
  userPhone: string | null;
  publishedAt: Date | string | null;
  status: string;
  offshelfBy?: string | null;
  offshelfReason?: string | null;
};

type Publisher = {
  id: string;
  label: string;
};

type MaterialListResult = {
  available?: boolean;
  items?: MaterialItem[];
  total?: number;
  publishers?: unknown[];
};

function formatPrice(value: string | null) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return `¥${number.toFixed(4).replace(/\.?0+$/, "")}`;
}

// 物料发布时间固定北京时间，避免运营与商户核对上架时点时产生分歧。
function formatTime(value: Date | string | null) {
  if (!value) return "—";
  return formatBeijingDateTimeWithSeconds(value) || "—";
}

function parsePhotos(photos: unknown): { url?: string; name?: string }[] {
  if (!photos) return [];
  if (Array.isArray(photos)) return photos as { url?: string; name?: string }[];
  if (typeof photos === "string") {
    try {
      const parsed = JSON.parse(photos);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizePublishers(values: unknown[] | undefined): Publisher[] {
  return (values ?? []).flatMap(value => {
    if (typeof value === "string" || typeof value === "number") {
      return [{ id: String(value), label: String(value) }];
    }
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const id = row.id ?? row.userId ?? row.value;
    if (typeof id !== "number" && typeof id !== "string") return [];
    const name = row.name ?? row.userName ?? row.label;
    const phone = typeof row.phone === "string" ? row.phone : typeof row.userPhone === "string" ? row.userPhone : "";
    return [{ id: String(id), label: `${typeof name === "string" && name ? name : `用户 ${id}`}${phone ? ` · ${phone}` : ""}` }];
  });
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 商户详情中的前台物料库存。所有写操作仍由服务端按销售范围复核。 */
export default function MerchantMaterialPanel({ merchantId, creditCode }: { merchantId: number; creditCode: string }) {
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<"published" | "draft" | "offshelf" | "all">("published");
  const [publisherId, setPublisherId] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [offshelfTarget, setOffshelfTarget] = useState<{ id: number; partNumber: string } | null>(null);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [publisherDialogOpen, setPublisherDialogOpen] = useState(false);
  const [publisherBulkUserId, setPublisherBulkUserId] = useState("");
  const [offshelfReason, setOffshelfReason] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const pageSize = 10;
  const utils = trpc.useUtils();

  const platformMaterialApi = trpc.platformMaterial as unknown as Record<string, any>;
  const listQuery = platformMaterialApi.list.useQuery(
    {
      creditCode,
      keyword: keyword || undefined,
      status,
      publisherUserId: publisherId === "all" ? undefined : Number(publisherId),
      page,
      pageSize,
    },
    { placeholderData: (previous: unknown) => previous },
  ) as {
    data?: MaterialListResult;
    isLoading: boolean;
    isFetching: boolean;
  };

  const offshelfMutation = platformMaterialApi.offshelf.useMutation({
    onSuccess: () => {
      toast.success("已下架，该物料已进入前台\u201c已下架\u201d列表，商户将看到下架原因");
      setOffshelfTarget(null);
      setOffshelfReason("");
      void utils.platformMaterial.list.invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "下架失败"),
  }) as { mutate: (input: Record<string, unknown>) => void; isPending: boolean };

  const bulkOffshelfMutation = platformMaterialApi.bulkOffshelf.useMutation() as {
    mutateAsync: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    isPending: boolean;
  };
  const publisherPreviewQuery = platformMaterialApi.publisherOffshelfPreview.useQuery(
    {
      merchantId,
      publisherUserId: publisherBulkUserId ? Number(publisherBulkUserId) : 1,
    },
    { enabled: publisherDialogOpen && Boolean(publisherBulkUserId), retry: false },
  ) as {
    data?: { publisherUserId: number; publisherName: string | null; publishedCount: number };
    isLoading: boolean;
    isError: boolean;
    error?: { message?: string };
  };
  const publisherOffshelfMutation = platformMaterialApi.bulkOffshelfByPublisher.useMutation() as {
    mutateAsync: (input: Record<string, unknown>) => Promise<{ affected?: number }>;
    isPending: boolean;
  };
  const data = listQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const publishers = useMemo(() => normalizePublishers(data?.publishers), [data?.publishers]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageIds = items.map(item => item.id);
  const selectedOnPage = pageIds.filter(id => selectedIds.has(id));
  const allPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const somePageSelected = selectedOnPage.length > 0 && !allPageSelected;
  const selectedCount = selectedIds.size;
  const selectedBulkPublisher = publishers.find(publisher => publisher.id === publisherBulkUserId) ?? null;

  const clearSelection = () => setSelectedIds(new Set());
  const resetPageAndSelection = () => {
    setPage(1);
    clearSelection();
  };

  const handleSearch = () => {
    setKeyword(searchInput.trim());
    resetPageAndSelection();
  };

  const changePage = (nextPage: number) => {
    setPage(nextPage);
    clearSelection();
  };

  const toggleAllOnPage = () => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkOffshelf = async () => {
    const reason = offshelfReason.trim();
    if (!reason) return toast.error("请填写统一下架原因");
    const ids = Array.from(selectedIds);
    if (!ids.length || bulkOffshelfMutation.isPending) return;
    try {
      const result = await bulkOffshelfMutation.mutateAsync({ ids, reason });
      const results = Array.isArray(result.results) ? result.results as Record<string, unknown>[] : [];
      const failures = results.filter(item => item.success !== true);
      const failedIds = new Set(failures.map(item => Number(item.id)).filter(Number.isFinite));
      setSelectedIds(failedIds);
      setBatchDialogOpen(false);
      setOffshelfReason("");
      await utils.platformMaterial.list.invalidate();
      if (failedIds.size > 0) {
        const details = failures.slice(0, 3).map(item => `ID ${item.id}：${item.error ?? "下架失败"}`).join("；");
        toast.warning(`批量下架完成，${ids.length - failedIds.size} 条成功、${failedIds.size} 条失败`, { description: `${details}${failures.length > 3 ? "；其余失败项已保留勾选" : ""}` });
      } else {
        toast.success(`已下架 ${ids.length} 条物料`);
      }
    } catch (error) {
      toast.error("批量下架失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    }
  };

  const exportSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || isExporting) return;
    setIsExporting(true);
    try {
      const result = await utils.platformMaterial.exportSelected.fetch({ ids });
      downloadCsv(result.csv, result.filename);
      toast.success(`已导出 ${ids.length} 条选中物料`);
    } catch (error) {
      toast.error("导出失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setIsExporting(false);
    }
  };

  const openPublisherBulkDialog = () => {
    setOffshelfReason("");
    setPublisherBulkUserId(publisherId === "all" ? "" : publisherId);
    setPublisherDialogOpen(true);
  };

  const bulkOffshelfPublisher = async () => {
    const reason = offshelfReason.trim();
    if (!reason) return toast.error("请填写统一下架原因");
    if (!publisherBulkUserId) return toast.error("请选择发布人");
    if (publisherOffshelfMutation.isPending) return;
    try {
      const result = await publisherOffshelfMutation.mutateAsync({
        merchantId,
        publisherUserId: Number(publisherBulkUserId),
        reason,
      });
      setPublisherDialogOpen(false);
      setPublisherBulkUserId("");
      setOffshelfReason("");
      clearSelection();
      await utils.platformMaterial.list.invalidate();
      toast.success(`已下架 ${Number(result.affected ?? 0)} 条物料`);
    } catch (error) {
      toast.error("按发布人批量下架失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border bg-white text-[13px]" data-merchant-material-panel>
      <div className="border-b px-4 py-3">
        <h2 className="text-[15px] font-semibold">物料库存</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">共 {total} 条；下架后进入前台“已下架”列表，商户修改后可重新上架。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/15 px-4 py-3">
        <div className="relative min-w-[180px] flex-1 md:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" placeholder="搜索型号 / 品牌" value={searchInput} onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") handleSearch(); }} />
        </div>
        <Select value={status} onValueChange={value => { setStatus(value as typeof status); resetPageAndSelection(); }}>
          <SelectTrigger className="h-8 w-[126px] text-xs"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent><SelectItem value="published">已发布</SelectItem><SelectItem value="draft">待发布</SelectItem><SelectItem value="offshelf">已下架</SelectItem><SelectItem value="all">全部状态</SelectItem></SelectContent>
        </Select>
        <Select value={publisherId} onValueChange={value => { setPublisherId(value); resetPageAndSelection(); }}>
          <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="发布人筛选"><SelectValue placeholder="全部发布人" /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部发布人</SelectItem>{publishers.map(publisher => <SelectItem key={publisher.id} value={publisher.id}>{publisher.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" className="h-8 text-xs" onClick={handleSearch} disabled={listQuery.isFetching}>{listQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "搜索"}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 text-xs" data-material-bulk-menu>
              批量操作 <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={selectedCount === 0} variant="destructive" onSelect={() => { setOffshelfReason(""); setBatchDialogOpen(true); }}>
              <ArrowDownToLine /> 下架选中物料{selectedCount ? `（${selectedCount}条）` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={openPublisherBulkDialog}>
              <ArrowDownToLine /> 下架该发布人的全部库存
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={selectedCount === 0 || isExporting} onSelect={() => void exportSelected()}>
              <Download /> 导出选中物料
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {keyword ? <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setSearchInput(""); setKeyword(""); resetPageAndSelection(); }}>清除</Button> : null}
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2.5" data-material-bulk-actions>
          <span className="text-xs font-medium text-primary">已选择 {selectedCount} 条</span>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearSelection}>取消选择</Button>
        </div>
      ) : null}

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…</div>
      ) : data && !data.available ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center"><CloudOff className="h-9 w-9 text-muted-foreground/60" /><p className="font-medium">前台物料数据库暂不可用</p><p className="max-w-md text-xs text-muted-foreground">开发预览环境可能无法连接前台库，请在生产网络环境重试。</p></div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">该商户暂无物料数据</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="min-w-[1160px]">
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-10">
                    <Checkbox checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false} onCheckedChange={toggleAllOnPage} aria-label="全选当前页物料" />
                  </TableHead>
                  <TableHead>型号</TableHead><TableHead>品牌</TableHead><TableHead>封装</TableHead><TableHead>实拍图</TableHead><TableHead className="text-right">在售数量</TableHead><TableHead className="text-right">含税价</TableHead><TableHead>发布人</TableHead><TableHead>发布时间</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{items.map(item => {
                const style = statusLabels[item.status] ?? { label: item.status, className: "" };
                const photos = parsePhotos(item.photos);
                const firstPhoto = photos.find(photo => photo.url);
                return (
                  <TableRow key={item.id} data-state={selectedIds.has(item.id) ? "selected" : undefined}>
                    <TableCell><Checkbox checked={selectedIds.has(item.id)} onCheckedChange={() => toggleOne(item.id)} aria-label={`选择物料 ${item.partNumber}`} /></TableCell>
                    <TableCell className="font-mono text-sm">{item.partNumber}</TableCell><TableCell>{item.brand || "—"}</TableCell><TableCell>{item.pkg || "—"}</TableCell>
                    <TableCell>{firstPhoto?.url ? <a href={firstPhoto.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline"><ImageIcon className="h-3.5 w-3.5" /> 查看{photos.length > 1 ? `(${photos.length})` : ""}</a> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.qtyOnSale?.toLocaleString() ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{formatPrice(item.priceIncl)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{item.userName || "—"}{item.userPhone ? <span className="block text-xs text-muted-foreground">{item.userPhone}</span> : null}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(item.publishedAt)}</TableCell>
                    <TableCell><Badge variant="secondary" className={style.className}>{style.label}</Badge>{item.status === "offshelf" && item.offshelfBy === "admin" && item.offshelfReason ? <span className="mt-1 block max-w-[160px] truncate text-xs text-red-600" title={item.offshelfReason}>平台下架：{item.offshelfReason}</span> : null}</TableCell>
                    <TableCell className="text-right">{item.status === "published" ? <Button size="sm" variant="outline" className="h-7 border-red-200 text-xs text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => { setOffshelfReason(""); setOffshelfTarget({ id: item.id, partNumber: item.partNumber }); }}><ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> 下架</Button> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                );
              })}</TableBody>
            </Table>
          </div>
          {totalPages > 1 ? <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground"><span>第 {page} / {totalPages} 页，共 {total} 条</span><div className="flex gap-2"><Button variant="outline" size="sm" className="h-8" disabled={page <= 1 || listQuery.isFetching} onClick={() => changePage(page - 1)}>上一页</Button><Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages || listQuery.isFetching} onClick={() => changePage(page + 1)}>下一页</Button></div></div> : null}
        </>
      )}

      <AlertDialog open={Boolean(offshelfTarget)} onOpenChange={open => { if (!open) { setOffshelfTarget(null); setOffshelfReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认下架该物料？</AlertDialogTitle><AlertDialogDescription>{offshelfTarget ? <>即将下架 <span className="font-mono font-medium text-foreground">{offshelfTarget.partNumber}</span>。下架后该物料将从前台搜索结果中移除，进入商户的“已下架”列表，商户修改后可重新上架。</> : null}</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-1.5"><label className="text-sm font-medium">下架原因 <span className="text-red-600">*</span><span className="ml-1 text-xs font-normal text-muted-foreground">（将展示给商户，≤255字）</span></label><Textarea placeholder="例如：图片与型号不符，请更换实拍图" value={offshelfReason} onChange={event => setOffshelfReason(event.target.value)} maxLength={255} rows={3} /></div>
          <AlertDialogFooter><AlertDialogCancel disabled={offshelfMutation.isPending}>取消</AlertDialogCancel><AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={offshelfMutation.isPending || !offshelfReason.trim()} onClick={event => { event.preventDefault(); if (!offshelfReason.trim()) return toast.error("请填写下架原因"); if (offshelfTarget) offshelfMutation.mutate({ id: offshelfTarget.id, reason: offshelfReason.trim() }); }}>{offshelfMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}确认下架</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDialogOpen} onOpenChange={open => { if (!bulkOffshelfMutation.isPending) { setBatchDialogOpen(open); if (!open) setOffshelfReason(""); } }}>
        <AlertDialogContent data-bulk-offshelf-dialog>
          <AlertDialogHeader><AlertDialogTitle>批量下架 {selectedCount} 条物料？</AlertDialogTitle><AlertDialogDescription>将对所有选中物料使用同一原因。已不是发布状态或不在当前商户范围内的物料会失败，失败项将保留勾选。</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-1.5"><label className="text-sm font-medium">统一下架原因 <span className="text-red-600">*</span></label><Textarea autoFocus value={offshelfReason} onChange={event => setOffshelfReason(event.target.value)} maxLength={255} rows={3} placeholder="请填写将展示给商户的下架原因" /></div>
          <AlertDialogFooter><AlertDialogCancel disabled={bulkOffshelfMutation.isPending}>取消</AlertDialogCancel><AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={bulkOffshelfMutation.isPending || !offshelfReason.trim()} onClick={event => { event.preventDefault(); void bulkOffshelf(); }}>{bulkOffshelfMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}确认批量下架</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={publisherDialogOpen} onOpenChange={open => { if (!publisherOffshelfMutation.isPending) { setPublisherDialogOpen(open); if (!open) { setPublisherBulkUserId(""); setOffshelfReason(""); } } }}>
        <AlertDialogContent data-publisher-bulk-offshelf-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>下架该发布人的全部库存？</AlertDialogTitle>
            <AlertDialogDescription>
              {!publisherBulkUserId
                ? "请选择发布人，系统将先核对其已发布库存数量。"
                : publisherPreviewQuery.isLoading
                ? "正在核对该发布人的已发布库存…"
                : publisherPreviewQuery.isError
                  ? `无法读取库存数量：${publisherPreviewQuery.error?.message || "请稍后重试"}`
                  : <>即将下架 <span className="font-medium text-foreground">{selectedBulkPublisher?.label || `用户 ${publisherBulkUserId}`}</span> 在当前商户下的 <span className="font-medium text-foreground">{publisherPreviewQuery.data?.publishedCount ?? 0}</span> 条已发布库存。已下架、草稿和其他用户库存不受影响。</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">发布人 <span className="text-red-600">*</span></label>
            <Select value={publisherBulkUserId} onValueChange={setPublisherBulkUserId}>
              <SelectTrigger aria-label="批量下架发布人"><SelectValue placeholder="请选择发布人" /></SelectTrigger>
              <SelectContent>{publishers.map(publisher => <SelectItem key={publisher.id} value={publisher.id}>{publisher.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">统一下架原因 <span className="text-red-600">*</span></label><Textarea value={offshelfReason} onChange={event => setOffshelfReason(event.target.value)} maxLength={255} rows={3} placeholder="请填写将展示给商户的下架原因" /></div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publisherOffshelfMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={!publisherBulkUserId || publisherOffshelfMutation.isPending || publisherPreviewQuery.isLoading || publisherPreviewQuery.isError || !publisherPreviewQuery.data?.publishedCount || !offshelfReason.trim()} onClick={event => { event.preventDefault(); void bulkOffshelfPublisher(); }}>
              {publisherOffshelfMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}确认全部下架
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
