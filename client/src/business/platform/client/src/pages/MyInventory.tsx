import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import PlatformLayout from "../../../../BusinessContentFrame";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Link } from "wouter";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { CATEGORIES } from "../../../shared/options";
import { formatBeijingDateTime } from "../../../shared/beijingTime";
import { INVENTORY_BULK_ACTION_LIMIT } from "../../../shared/inventoryBulk";
import {
  formatInventoryQuantity,
  inventoryQuantityDisplay,
} from "../lib/inventoryQuantityDisplay";

const toolbarActionClass =
  "h-8 min-w-[60px] border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900";

/**
 * 我的库存：在售与已下架库存列表视图，支持搜索筛选、编辑、重新上架、下架和删除。
 *
 * 列表按「最近一次变动」倒序（服务端 listInventories 控制），
 * 因此编辑重新发布后的条目会自动排到前列。
 */
export default function MyInventory() {
  const d51Ready = usePageMemory();

  const requestedStatus = new URLSearchParams(window.location.search).get(
    "status"
  );
  const [statusFilter, setStatusFilter] = useRememberedState<
    "published" | "offshelf" | "all"
  >("statusFilter",
    requestedStatus === "offshelf" || requestedStatus === "all"
      ? requestedStatus
      : "published"
  );
  // 搜索栏（还原原型 toolbar）：输入条件后点击「筛选」生效
  const [pnInput, setPnInput] = useRememberedState("pnInput", "");
  const [brandInput, setBrandInput] = useRememberedState("brandInput", "");
  const [catInput, setCatInput] = useRememberedState("catInput", "all");
  const [applied, setApplied] = useRememberedState<{
    pn: string;
    brand: string;
    cat: string;
  }>("applied", { pn: "", brand: "", cat: "all" });
  const [page, setPage] = useRememberedState("page", 1);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkFailures, setBulkFailures] = useState<Record<number, string>>({});
  const [nextOwnerUserId, setNextOwnerUserId] = useState("");
  const utils = trpc.useUtils();

  const { data: listResult, isLoading } = useRestoringListQuery(trpc.inventory.listPaged.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    partNumber: applied.pn || undefined,
    brand: applied.brand || undefined,
    category: applied.cat === "all" ? undefined : applied.cat,
    page,
    pageSize: INVENTORY_BULK_ACTION_LIMIT,
  }, freshListOptions({}, d51Ready)));
  const items = listResult?.items ?? [];
  const enterpriseQuery = trpc.enterprise.me.useQuery();
  const assignmentOptionsQuery = trpc.inventory.assignmentOptions.useQuery();
  const assignmentOptions = assignmentOptionsQuery.data ?? [];
  const ownerNames = useMemo(
    () =>
      new Map(assignmentOptions.map(option => [option.userId, option.name])),
    [assignmentOptions]
  );
  const canAssign = enterpriseQuery.data?.permissions.manageMembers ?? false;

  const filtered = items;
  const pageCount = listResult?.pageCount ?? 1;
  const currentPageItems = items;
  const currentPageIds = useMemo(
    () => currentPageItems.map(item => item.id),
    [currentPageItems]
  );
  const currentPageIdKey = currentPageIds.join(",");
  const allCurrentPageSelected =
    currentPageIds.length > 0 &&
    currentPageIds.every(id => selectedIds.has(id));
  const selectedRows = currentPageItems.filter(item =>
    selectedIds.has(item.id)
  );
  const selectedPublishedCount = selectedRows.filter(
    item => item.status === "published"
  ).length;
  const hasAppliedFilter = Boolean(
    applied.pn || applied.brand || applied.cat !== "all"
  );
  const canResetFilter = Boolean(
    pnInput || brandInput || catInput !== "all" || hasAppliedFilter
  );

  useEffect(() => {
    if (listResult && listResult.page !== page) setPage(listResult.page);
  }, [listResult?.page, page]);

  useEffect(() => {
    const available = new Set(currentPageIds);
    setSelectedIds(current => {
      const next = new Set(Array.from(current).filter(id => available.has(id)));
      return next.size === current.size ? current : next;
    });
    setBulkFailures(current => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => available.has(Number(id)))
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [currentPageIdKey]);

  const clearPageSelection = () => {
    setSelectedIds(new Set());
    setBulkFailures({});
  };

  const applyFilter = () => {
    setApplied({
      pn: pnInput.trim(),
      brand: brandInput.trim(),
      cat: catInput,
    });
    setPage(1);
    clearPageSelection();
  };

  const resetFilter = () => {
    setPnInput("");
    setBrandInput("");
    setCatInput("all");
    setApplied({ pn: "", brand: "", cat: "all" });
    setPage(1);
    clearPageSelection();
  };

  const invalidate = () =>
    Promise.all([
      utils.inventory.list.invalidate(),
      utils.inventory.refreshStatus.invalidate(),
    ]);

  // 库存刷新状态：决定按钮是否可点与提示文案
  const refreshStatusQuery = trpc.inventory.refreshStatus.useQuery();
  const refreshStatus = refreshStatusQuery.data;
  const nextAllowedText = refreshStatus?.nextAllowedAt
    ? formatBeijingDateTime(refreshStatus.nextAllowedAt)
    : null;

  const refreshMutation = trpc.inventory.refreshPublished.useMutation({
    onSuccess: result => {
      // 列表与刷新状态必须一并失效，否则按钮仍显示可点
      Promise.all([
        utils.inventory.list.invalidate(),
        utils.inventory.refreshStatus.invalidate(),
      ]);
      toast.success(`已刷新${result.refreshedCount}条已发布库存`, {
        description: "搜索页将显示本次库存确认日期，24小时后可再次刷新",
      });
    },
    onError: e => {
      // 冷却报错时同步最新状态，便于展示准确的下次可刷新时间
      utils.inventory.refreshStatus.invalidate();
      toast.error(e.message);
    },
  });

  const offshelfMutation = trpc.inventory.offshelf.useMutation({
    onSuccess: () => {
      setStatusFilter("offshelf");
      setPage(1);
      void invalidate();
      toast.success("已下架", {
        description: "该型号已移入「已下架」列表，可编辑后重新上架",
      });
    },
    onError: e => toast.error(e.message),
  });

  const publishMutation = trpc.inventory.publish.useMutation({
    onSuccess: result => {
      if (!result.success) {
        toast.error("重新上架失败", { description: result.message });
        return;
      }
      setStatusFilter("published");
      setPage(1);
      void invalidate();
      toast.success("已重新上架", { description: "买家现在可检索到该型号" });
    },
    onError: e => toast.error(e.message),
  });

  const removeMutation = trpc.inventory.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("已删除");
    },
    onError: e => toast.error(e.message),
  });

  const allVisibilityMutation =
    trpc.inventory.setAllCompanyCatalogVisibility.useMutation({
      onSuccess: async result => {
        await utils.invalidate();
        toast.success(
          result.visible
            ? "全部库存已设为全部可见"
            : "全部库存已设为仅搜索可见",
          {
            description: result.visible
              ? `已更新 ${result.updatedCount} 条已发布库存；搜索和公司详情页均可见`
              : `已更新 ${result.updatedCount} 条已发布库存；仅匹配型号搜索可见，公司详情页不展示物料`,
          }
        );
      },
      onError: e => toast.error(e.message),
    });

  const allOffshelfMutation = trpc.inventory.offshelfAllPublished.useMutation({
    onSuccess: async result => {
      clearPageSelection();
      setMultiSelectMode(false);
      setStatusFilter("offshelf");
      setPage(1);
      await invalidate();
      toast.success(`已下架 ${result.updatedCount} 条库存`, {
        description: "已移入「已下架」列表，可编辑后重新上架",
      });
    },
    onError: e => toast.error("全部下架失败", { description: e.message }),
  });

  const applyBulkResult = (
    action: "下架" | "删除" | "设为仅搜索可见" | "设为全部可见",
    result: {
      successCount: number;
      failedCount: number;
      failures: Array<{ id: number; message?: string }>;
    }
  ) => {
    const failures = Object.fromEntries(
      result.failures.map(item => [
        item.id,
        item.message ?? `${action}失败，请刷新后重试`,
      ])
    );
    setBulkFailures(failures);
    setSelectedIds(new Set(result.failures.map(item => item.id)));
    if (action === "设为仅搜索可见" || action === "设为全部可见") {
      void utils.invalidate();
    } else {
      void invalidate();
    }

    if (result.failedCount > 0) {
      toast.warning(
        `成功${action} ${result.successCount} 条，失败 ${result.failedCount} 条`,
        {
          description:
            result.failures[0]?.message ?? "失败条目已保留选中，可处理后重试",
        }
      );
    } else {
      toast.success(`已${action} ${result.successCount} 条库存`);
    }
  };

  const bulkOffshelfMutation = trpc.inventory.bulkOffshelf.useMutation({
    onSuccess: result => {
      applyBulkResult("下架", result);
      if (result.successCount > 0 && result.failedCount === 0) {
        setStatusFilter("offshelf");
        setPage(1);
      }
    },
    onError: e => toast.error(e.message),
  });

  const bulkRemoveMutation = trpc.inventory.bulkRemove.useMutation({
    onSuccess: result => applyBulkResult("删除", result),
    onError: e => toast.error(e.message),
  });

  const bulkVisibilityMutation =
    trpc.inventory.bulkSetCompanyCatalogVisibility.useMutation({
      onSuccess: result =>
        applyBulkResult(
          result.visible ? "设为全部可见" : "设为仅搜索可见",
          result
        ),
      onError: e => toast.error(e.message),
    });

  const reassignMutation = trpc.inventory.reassign.useMutation({
    onSuccess: async result => {
      toast.success(`已分配 ${result.reassignedCount} 条库存`, {
        description:
          result.transferredInquiryCount > 0
            ? `同时转交 ${result.transferredInquiryCount} 条未结询价`
            : "后续询价将发给新负责人",
      });
      clearPageSelection();
      await utils.inventory.list.invalidate();
    },
    onError: error =>
      toast.error("库存分配失败", { description: error.message }),
  });

  const bulkPending =
    bulkOffshelfMutation.isPending ||
    bulkRemoveMutation.isPending ||
    bulkVisibilityMutation.isPending ||
    reassignMutation.isPending;

  const toggleMultiSelectMode = () => {
    setMultiSelectMode(current => !current);
    clearPageSelection();
  };

  const toggleItemSelection = (id: number, selected: boolean) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
    setBulkFailures(current => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const toggleCurrentPage = (selected: boolean) => {
    setSelectedIds(selected ? new Set(currentPageIds) : new Set());
    setBulkFailures({});
  };

  const goToPage = (nextPage: number) => {
    setPage(Math.min(pageCount, Math.max(1, nextPage)));
    clearPageSelection();
  };

  const confirmBulkOffshelf = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const message =
      `确认下架选中的 ${ids.length} 条库存吗？\n\n` +
      "下架后，这些库存将立即停止在搜索、询价和下单页面展示，并移入「已下架」列表，可编辑后重新上架。";
    if (confirm(message)) bulkOffshelfMutation.mutate({ ids });
  };

  const confirmBulkRemove = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const message =
      `确认永久删除选中的 ${ids.length} 条库存吗？\n\n` +
      "删除后库存记录无法恢复；既有订单记录不会删除。若库存与现有业务记录关联，系统会保留该条并反馈失败，建议改为下架。";
    if (confirm(message)) bulkRemoveMutation.mutate({ ids });
  };

  const confirmBulkVisibility = (visible: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const action = visible ? "设为全部可见" : "设为仅搜索可见";
    const impact = visible
      ? "恢复后，这些库存会重新出现在公司主页、普通搜索与推荐入口。"
      : "隐藏后，这些库存不会出现在公司主页、普通搜索、模糊联想和推荐中；输入完整型号仍可搜索，并可正常询价和下单。";
    if (
      confirm(`确认将选中的 ${ids.length} 条库存${action}吗？\n\n${impact}`)
    ) {
      bulkVisibilityMutation.mutate({ ids, visible });
    }
  };

  const confirmAllVisibility = (visible: boolean) => {
    const action = visible ? "全部可见" : "仅搜索可见";
    const impact = visible
      ? "设置后，全部已发布库存可在搜索结果和公司详情页展示。"
      : "设置后，全部已发布库存仅在匹配型号搜索时展示；公司仍可被搜索，但公司详情页不展示这些物料。";
    if (confirm(`确认将全部已发布库存设为“${action}”吗？\n\n${impact}`)) {
      allVisibilityMutation.mutate({ visible });
    }
  };

  const confirmAllOffshelf = () => {
    const count = refreshStatus?.publishedCount ?? 0;
    if (count <= 0 || allOffshelfMutation.isPending) return;
    const message =
      `确认下架全部 ${count} 条已发布库存吗？\n\n` +
      "下架后将立即停止在搜索、数据通、企业主页、询价和下单页面展示。已有订单和历史聊天不会删除，库存之后可以重新上架。";
    if (confirm(message)) allOffshelfMutation.mutate();
  };

  const statusLabel = (status: string) => {
    if (status === "published") return "已发布";
    if (status === "offshelf") return "已下架";
    return "草稿";
  };

  const statusDotClass = (status: string) => {
    if (status === "published") return "text-emerald-500";
    if (status === "offshelf") return "text-slate-400";
    return "text-amber-500";
  };

  return (
    <PlatformLayout>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold">我的库存</h1>
          <p className="text-xs text-muted-foreground mt-1">
            管理在售与已下架库存；下架后可编辑并重新上架
          </p>
          <p
            className="text-[11px] text-muted-foreground mt-1"
            data-testid="inventory-refresh-hint"
          >
            最近刷新：
            {formatBeijingDateTime(refreshStatus?.lastRefreshedAt) || "—"}
            {refreshStatus && !refreshStatus.canRefresh && nextAllowedText
              ? ` · 下次可刷新：${nextAllowedText}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="inventory-refresh-button"
            className="h-8 bg-white text-[#185FA5] border-[#185FA5]/40 hover:bg-[#f0f4ff] hover:text-[#185FA5]"
            disabled={
              refreshMutation.isPending ||
              refreshStatusQuery.isLoading ||
              !refreshStatus?.canRefresh
            }
            title={
              refreshStatus?.canRefresh
                ? "确认全部已发布库存仍然有效"
                : nextAllowedText
                  ? `下次可刷新：${nextAllowedText}`
                  : "暂无已发布库存可刷新"
            }
            onClick={() => {
              // 二次确认：24 小时只能刷一次，误点无法撤回
              if (
                confirm(
                  `确认刷新全部${refreshStatus?.publishedCount ?? 0}条已发布库存吗？此操作仅更新库存确认日期，不修改价格和数量。`
                )
              ) {
                refreshMutation.mutate();
              }
            }}
          >
            {refreshMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            一键刷新库存
          </Button>
          <Select
            value={statusFilter}
            onValueChange={v => {
              setStatusFilter(v as "published" | "offshelf" | "all");
              setPage(1);
              clearPageSelection();
            }}
          >
            <SelectTrigger className="w-[116px] h-8 text-xs bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="published">已发布</SelectItem>
              <SelectItem value="offshelf">已下架</SelectItem>
              <SelectItem value="all">全部</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="inventory-more-actions"
                className="h-8 min-w-[104px] justify-between border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50"
                disabled={allOffshelfMutation.isPending}
              >
                {allOffshelfMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                更多操作
                <ChevronDown className="ml-2 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                data-testid="inventory-offshelf-all"
                disabled={(refreshStatus?.publishedCount ?? 0) <= 0}
                onClick={confirmAllOffshelf}
                className="text-red-600 focus:bg-red-50 focus:text-red-700"
              >
                全部下架
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link href="/publish">
            <Button size="sm" className="bg-[#185FA5] hover:bg-[#0C447C] h-8">
              发布库存
            </Button>
          </Link>
        </div>
      </div>

      {/* 搜索与批量操作：同级操作保持统一尺寸和视觉层级 */}
      <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg border border-slate-200 bg-white p-2">
        <Input
          placeholder="搜索型号"
          value={pnInput}
          onChange={e => setPnInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && applyFilter()}
          className="w-[150px] h-8 text-xs bg-white"
        />
        <Input
          placeholder="搜索品牌"
          value={brandInput}
          onChange={e => setBrandInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && applyFilter()}
          className="w-[140px] h-8 text-xs bg-white"
        />
        <Select value={catInput} onValueChange={setCatInput}>
          <SelectTrigger className="w-[112px] h-8 text-xs bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 min-w-[116px] justify-between border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50"
              disabled={allVisibilityMutation.isPending}
            >
              {allVisibilityMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              展示状态
              <ChevronDown className="ml-2 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem onClick={() => confirmAllVisibility(true)}>
              全部可见
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => confirmAllVisibility(false)}>
              仅搜索可见
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div
          className="inline-flex items-center gap-1.5"
          data-testid="inventory-toolbar-actions"
        >
          <Button
            size="sm"
            variant="outline"
            className={toolbarActionClass}
            onClick={applyFilter}
          >
            筛选
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={toolbarActionClass}
            disabled={!canResetFilter}
            onClick={resetFilter}
          >
            重置
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="inventory-multi-select-button"
            aria-pressed={multiSelectMode}
            className={
              multiSelectMode
                ? "h-8 min-w-[60px] border-[#185FA5] bg-[#185FA5] px-3 text-xs text-white shadow-none hover:bg-[#0C447C] hover:text-white"
                : toolbarActionClass
            }
            onClick={toggleMultiSelectMode}
          >
            {multiSelectMode ? "完成" : "批量设置"}
          </Button>
        </div>
      </div>

      {multiSelectMode && (
        <div
          data-testid="inventory-bulk-action-bar"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#b9d2e8] bg-[#f5f9fd] px-3 py-2"
        >
          <span className="text-xs font-medium text-[#12324a]">
            已选 {selectedIds.size} 条 ·{" "}
            {hasAppliedFilter ? "当前筛选结果本页" : "当前页"}共{" "}
            {currentPageItems.length} 条
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 bg-white text-xs"
            disabled={
              bulkPending ||
              selectedIds.size === 0 ||
              selectedPublishedCount === 0
            }
            onClick={confirmBulkOffshelf}
          >
            {bulkOffshelfMutation.isPending && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            批量下架
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 bg-white text-xs text-amber-700 border-amber-300 hover:bg-amber-50 hover:text-amber-800"
            disabled={
              bulkPending ||
              selectedIds.size === 0 ||
              selectedPublishedCount === 0
            }
            onClick={() => confirmBulkVisibility(false)}
          >
            {bulkVisibilityMutation.isPending && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            设为仅搜索可见
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 bg-white text-xs text-[#185FA5] border-[#b9d2e8] hover:bg-[#f5f9fd] hover:text-[#185FA5]"
            disabled={
              bulkPending ||
              selectedIds.size === 0 ||
              selectedPublishedCount === 0
            }
            onClick={() => confirmBulkVisibility(true)}
          >
            设为全部可见
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 bg-white text-xs text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
            disabled={bulkPending || selectedIds.size === 0}
            onClick={confirmBulkRemove}
          >
            {bulkRemoveMutation.isPending && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            批量删除
          </Button>
          {canAssign && assignmentOptions.length > 0 ? (
            <>
              <Select
                value={nextOwnerUserId}
                onValueChange={setNextOwnerUserId}
              >
                <SelectTrigger className="h-7 w-[150px] bg-white text-xs">
                  <SelectValue placeholder="选择负责人" />
                </SelectTrigger>
                <SelectContent>
                  {assignmentOptions.map(option => (
                    <SelectItem
                      key={option.userId}
                      value={String(option.userId)}
                    >
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7 bg-white text-xs text-[#185FA5]"
                disabled={
                  bulkPending || selectedIds.size === 0 || !nextOwnerUserId
                }
                onClick={() => {
                  const nextOwner = Number(nextOwnerUserId);
                  if (!nextOwner) return;
                  reassignMutation.mutate({
                    ids: Array.from(selectedIds),
                    nextOwnerUserId: nextOwner,
                    reason: "企业管理员在库存列表批量分配",
                    expectedVersions: Object.fromEntries(
                      selectedRows.map(row => [
                        String(row.id),
                        row.ownershipVersion,
                      ])
                    ),
                  });
                }}
              >
                {reassignMutation.isPending && (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                )}
                分配
              </Button>
            </>
          ) : null}
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              onClick={clearPageSelection}
            >
              取消选择
            </button>
          )}
        </div>
      )}

      <Card className="p-0 overflow-hidden gap-0">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-14 text-center">
            <div className="text-2xl">📦</div>
            <div className="text-sm font-medium mt-2.5">
              {hasAppliedFilter
                ? "无符合筛选条件的库存"
                : statusFilter === "published"
                  ? "暂无已发布库存"
                  : statusFilter === "offshelf"
                    ? "暂无已下架库存"
                    : "暂无库存"}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">
              {hasAppliedFilter
                ? "尝试调整筛选条件或点击「重置」"
                : "前往「发布库存」录入并发布库存条目"}
            </div>
          </div>
        ) : (
          <Table className="table-fixed min-w-[760px]">
            <colgroup>
              {multiSelectMode && <col className="w-[4%]" />}
              <col className="w-[28%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                {multiSelectMode && (
                  <TableHead className="sticky left-0 z-30 h-8 w-9 bg-slate-50 px-2 shadow-[1px_0_0_#e2e8f0]">
                    <Checkbox
                      aria-label="全选当前页库存"
                      checked={
                        allCurrentPageSelected
                          ? true
                          : selectedIds.size > 0
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={value =>
                        toggleCurrentPage(value === true)
                      }
                    />
                  </TableHead>
                )}
                <TableHead
                  className={`sticky z-20 h-8 bg-slate-50 px-2 text-[11px] text-slate-500 shadow-[1px_0_0_#e2e8f0] ${multiSelectMode ? "left-9" : "left-0"}`}
                >
                  型号 / 品牌
                </TableHead>
                <TableHead className="h-8 px-2 text-[11px] text-slate-500">
                  现货库存
                </TableHead>
                <TableHead className="h-8 px-2 text-[11px] text-slate-500">
                  订货库存
                </TableHead>
                <TableHead className="h-8 px-2 text-[11px] text-slate-500">
                  单价
                </TableHead>
                <TableHead className="h-8 px-2 text-[11px] text-slate-500">
                  负责人
                </TableHead>
                <TableHead className="h-8 px-2 text-[11px] text-slate-500">
                  状态
                </TableHead>
                <TableHead className="h-8 whitespace-nowrap px-2 text-right text-[11px] text-slate-500">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentPageItems.map(item => {
                const quantityDisplay = inventoryQuantityDisplay(item);
                return (
                  <TableRow
                    key={item.id}
                    className={`h-14 ${
                      bulkFailures[item.id]
                        ? "bg-red-50/60"
                        : selectedIds.has(item.id)
                          ? "bg-[#f5f9fd]"
                          : ""
                    }`} data-page-memory-row={String(item.id)}
                  >
                    {multiSelectMode && (
                      <TableCell
                        className={`sticky left-0 z-20 w-9 px-2 py-1.5 shadow-[1px_0_0_#e2e8f0] ${
                          bulkFailures[item.id]
                            ? "bg-red-50"
                            : selectedIds.has(item.id)
                              ? "bg-[#f5f9fd]"
                              : "bg-white"
                        }`}
                      >
                        <Checkbox
                          aria-label={`选择 ${item.partNumber}`}
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={value =>
                            toggleItemSelection(item.id, value === true)
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell
                      className={`sticky z-10 px-2 py-1.5 text-[12px] shadow-[1px_0_0_#e2e8f0] ${multiSelectMode ? "left-9" : "left-0"} ${
                        bulkFailures[item.id]
                          ? "bg-red-50"
                          : selectedIds.has(item.id)
                            ? "bg-[#f5f9fd]"
                            : "bg-white"
                      }`}
                    >
                      <div
                        className="truncate font-semibold text-slate-800"
                        title={item.partNumber}
                      >
                        {item.partNumber}
                      </div>
                      <div
                        className="mt-0.5 truncate text-[11px] text-muted-foreground"
                        title={item.brand}
                      >
                        {item.brand || "—"}
                      </div>
                      {bulkFailures[item.id] && (
                        <div className="mt-1 max-w-[300px] rounded bg-red-100 px-1.5 py-1 text-[11px] font-normal leading-4 text-red-700">
                          操作失败：{bulkFailures[item.id]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-[12px]">
                      <div className="font-medium tabular-nums text-slate-800">
                        {formatInventoryQuantity(quantityDisplay.spotQuantity)}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-[12px]">
                      <div className="font-medium tabular-nums text-slate-800">
                        {formatInventoryQuantity(quantityDisplay.orderQuantity)}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-[12px]">
                      <div className="font-medium tabular-nums text-slate-800">
                        {item.priceEx != null ? `¥${item.priceEx}` : "面议"}
                      </div>
                      {item.priceEx != null && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {item.taxIncluded === false ? "未税价" : "含税价"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell
                      className="truncate px-2 py-1.5 text-[12px] text-muted-foreground"
                      title={
                        ownerNames.get(Number(item.ownerUserId)) ||
                        `用户${item.ownerUserId}`
                      }
                    >
                      {ownerNames.get(Number(item.ownerUserId)) ||
                        `用户${item.ownerUserId}`}
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600">
                          <span
                            className={`text-[10px] ${statusDotClass(item.status)}`}
                            aria-hidden="true"
                          >
                            ●
                          </span>
                          <span className="font-medium text-slate-700">
                            {statusLabel(item.status)}
                          </span>
                          {item.status === "published" && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span>
                                {item.companyCatalogVisible
                                  ? "全部可见"
                                  : "仅搜索可见"}
                              </span>
                            </>
                          )}
                        </div>
                        {item.status === "offshelf" &&
                          item.offshelfBy === "admin" && (
                            <span
                              className="max-w-[190px] truncate text-[11px] text-red-600"
                              title={item.offshelfReason || undefined}
                            >
                              平台下架
                              {item.offshelfReason
                                ? `：${item.offshelfReason}`
                                : ""}
                            </span>
                          )}
                        {item.status === "offshelf" &&
                          item.offshelfBy === "system" &&
                          item.offshelfReason === "sold_out" && (
                            <span className="max-w-[190px] text-[11px] leading-4 text-amber-700">
                              库存售罄，请补充数量后重新上架
                            </span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center whitespace-nowrap divide-x divide-slate-200">
                        {/*
                          编辑入口：在售条目可直接修改并重新发布，无需先下架。
                          以往要改已发布商品只能先下架（期间从搜索结果消失）
                          再到待发布列表编辑，等于为改一个价格牺牲曝光。

                          放在最前：编辑是日常高频操作，而下架与删除低频且影响大。
                          用 Link 包裹：与本页「发布库存」按钮的跳转方式保持一致。
                        */}
                        {(item.status === "published" ||
                          item.status === "offshelf") && (
                          <Link href={`/publish/${item.id}/edit`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 rounded-none px-2 text-[11px] text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            >
                              编辑
                            </Button>
                          </Link>
                        )}
                        {item.status === "published" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-none px-2 text-[11px] text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            disabled={offshelfMutation.isPending}
                            onClick={() => {
                              if (
                                confirm(
                                  `确认下架「${item.partNumber}」吗？\n\n下架后将立即停止在搜索、询价和下单页面展示，并移入「已下架」列表，可编辑后重新上架。`
                                )
                              ) {
                                offshelfMutation.mutate({ id: item.id });
                              }
                            }}
                          >
                            下架
                          </Button>
                        )}
                        {item.status === "offshelf" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-none px-2 text-[11px] text-[#185FA5] hover:bg-[#f5f9fd] hover:text-[#185FA5]"
                            disabled={publishMutation.isPending}
                            onClick={() => {
                              if (
                                confirm(
                                  `确认重新上架「${item.partNumber}」吗？\n\n上架后买家即可检索、询价和下单。`
                                )
                              ) {
                                publishMutation.mutate({ id: item.id });
                              }
                            }}
                          >
                            {publishMutation.isPending && (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            )}
                            上架
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-none px-2 text-[11px] text-destructive hover:bg-destructive/5 hover:text-destructive"
                          disabled={removeMutation.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `确认永久删除「${item.partNumber}」吗？\n\n删除后库存记录无法恢复；既有订单记录不会删除。若有关联业务记录，删除可能失败，建议改为下架。`
                              )
                            ) {
                              removeMutation.mutate({ id: item.id });
                            }
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {filtered.length > 0 && (
        <div className="mt-3 mb-8 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            共 {listResult?.total ?? 0} 条 · 每页最多{" "}
            {INVENTORY_BULK_ACTION_LIMIT} 条
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 bg-white text-xs"
              disabled={page <= 1 || bulkPending}
              onClick={() => goToPage(page - 1)}
            >
              上一页
            </Button>
            <span className="min-w-[64px] text-center">
              第 {page} / {pageCount} 页
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 bg-white text-xs"
              disabled={page >= pageCount || bulkPending}
              onClick={() => goToPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </PlatformLayout>
  );
}
