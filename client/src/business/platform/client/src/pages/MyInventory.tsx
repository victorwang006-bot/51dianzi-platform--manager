import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import PlatformLayout from "../../../../BusinessContentFrame";
import { Button } from "../components/ui/button";
import { AdminPage, AdminPageHeader, AdminFilterBar, AdminDataPanel } from "@/components/admin/UnifiedAdminPage";
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
import "./MyInventory.css";

const toolbarActionClass =
  "inventory-control min-w-[60px] border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900";

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
      <AdminPage className="my-inventory-page">
      <AdminPageHeader
        title="我的库存"
        description="管理在售与已下架库存；下架后可编辑并重新上架"
        actions={
        <div className="inventory-header-actions flex flex-wrap items-center gap-2">
          <Button
            size="default"
            variant="outline"
            data-testid="inventory-refresh-button"
            className="inventory-control bg-white text-[#185FA5] border-[#185FA5]/40 hover:bg-[#f0f4ff] hover:text-[#185FA5]"
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
            <SelectTrigger className="inventory-control w-[124px] bg-white">
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
                size="default"
                variant="outline"
                data-testid="inventory-more-actions"
                className="inventory-control min-w-[112px] justify-between border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50"
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
            <Button size="default" className="inventory-control bg-[#185FA5] hover:bg-[#0C447C]">
              发布库存
            </Button>
          </Link>
        </div>
        }
      >
        <p
          className="inventory-caption mt-1"
          data-testid="inventory-refresh-hint"
        >
          最近刷新：
          {formatBeijingDateTime(refreshStatus?.lastRefreshedAt) || "—"}
          {refreshStatus && !refreshStatus.canRefresh && nextAllowedText
            ? ` · 下次可刷新：${nextAllowedText}`
            : ""}
        </p>
      </AdminPageHeader>

      {/* 搜索与批量操作：同级操作保持统一尺寸和视觉层级 */}
      <AdminFilterBar className="inventory-filterbar">
        <Input
          placeholder="搜索型号"
          value={pnInput}
          onChange={e => setPnInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && applyFilter()}
          className="inventory-control w-[180px] bg-white"
        />
        <Input
          placeholder="搜索品牌"
          value={brandInput}
          onChange={e => setBrandInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && applyFilter()}
          className="inventory-control w-[160px] bg-white"
        />
        <Select value={catInput} onValueChange={setCatInput}>
          <SelectTrigger className="inventory-control w-[124px] bg-white">
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
              size="default"
              variant="outline"
              className="inventory-control min-w-[124px] justify-between border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50"
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
            size="default"
            variant="outline"
            className={toolbarActionClass}
            onClick={applyFilter}
          >
            筛选
          </Button>
          <Button
            size="default"
            variant="outline"
            className={toolbarActionClass}
            disabled={!canResetFilter}
            onClick={resetFilter}
          >
            重置
          </Button>
          <Button
            size="default"
            variant="outline"
            data-testid="inventory-multi-select-button"
            aria-pressed={multiSelectMode}
            className={
              multiSelectMode
                ? "inventory-control min-w-[60px] border-[#185FA5] bg-[#185FA5] px-3 text-white shadow-none hover:bg-[#0C447C] hover:text-white"
                : toolbarActionClass
            }
            onClick={toggleMultiSelectMode}
          >
            {multiSelectMode ? "完成" : "批量设置"}
          </Button>
        </div>
      </AdminFilterBar>

      {multiSelectMode && (
        <div
          data-testid="inventory-bulk-action-bar"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#b9d2e8] bg-[#f5f9fd] px-3 py-2"
        >
          <span className="admin-cell-secondary font-medium text-[#12324a]">
            已选 {selectedIds.size} 条 ·{" "}
            {hasAppliedFilter ? "当前筛选结果本页" : "当前页"}共{" "}
            {currentPageItems.length} 条
          </span>
          <Button
            size="default"
            variant="outline"
            className="inventory-control bg-white"
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
            size="default"
            variant="outline"
            className="inventory-control bg-white text-amber-700 border-amber-300 hover:bg-amber-50 hover:text-amber-800"
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
            size="default"
            variant="outline"
            className="inventory-control bg-white text-[#185FA5] border-[#b9d2e8] hover:bg-[#f5f9fd] hover:text-[#185FA5]"
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
            size="default"
            variant="outline"
            className="inventory-control bg-white text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
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
                <SelectTrigger className="inventory-control w-[170px] bg-white">
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
                size="default"
                variant="outline"
                className="inventory-control bg-white text-[#185FA5]"
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
              className="inventory-control ml-auto px-2 text-slate-600 hover:text-foreground"
              onClick={clearPageSelection}
            >
              取消选择
            </button>
          )}
        </div>
      )}

      <AdminDataPanel className="inventory-card min-w-0 max-w-full p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-14 text-center">
            <div className="text-2xl">📦</div>
            <div className="admin-cell-primary font-medium mt-2.5">
              {hasAppliedFilter
                ? "无符合筛选条件的库存"
                : statusFilter === "published"
                  ? "暂无已发布库存"
                  : statusFilter === "offshelf"
                    ? "暂无已下架库存"
                    : "暂无库存"}
            </div>
            <div className="admin-cell-secondary mt-1.5">
              {hasAppliedFilter
                ? "尝试调整筛选条件或点击「重置」"
                : "前往「发布库存」录入并发布库存条目"}
            </div>
          </div>
        ) : (
          <Table
            className={`admin-table-readable inventory-table table-fixed ${multiSelectMode ? "inventory-table-selectable" : ""}`}
            containerClassName="inventory-table-scroll"
          >
            <colgroup>
              {multiSelectMode && <col className="inventory-selection-column" />}
              <col />
              <col className="inventory-quantity-column" />
              <col className="inventory-quantity-column" />
              <col className="inventory-price-column" />
              <col className="inventory-owner-column" />
              <col className="inventory-status-column" />
              <col className="inventory-actions-column" />
            </colgroup>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                {multiSelectMode && (
                  <TableHead className="inventory-selection-cell sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_#e2e8f0]">
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
                  className="inventory-model-cell sticky z-20 bg-slate-50 shadow-[1px_0_0_#e2e8f0]"
                >
                  型号 / 品牌
                </TableHead>
                <TableHead className="inventory-numeric-cell">
                  现货库存
                </TableHead>
                <TableHead className="inventory-numeric-cell">
                  订货库存
                </TableHead>
                <TableHead className="inventory-numeric-cell">
                  单价
                </TableHead>
                <TableHead>
                  负责人
                </TableHead>
                <TableHead>
                  状态
                </TableHead>
                <TableHead className="inventory-actions-cell sticky right-0 z-30 bg-slate-50 text-right">
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
                    className={`inventory-data-row ${
                      bulkFailures[item.id]
                        ? "bg-red-50/60"
                        : selectedIds.has(item.id)
                          ? "bg-[#f5f9fd]"
                          : ""
                    }`} data-page-memory-row={String(item.id)}
                  >
                    {multiSelectMode && (
                      <TableCell
                        className={`inventory-selection-cell sticky left-0 z-20 shadow-[1px_0_0_#e2e8f0] ${
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
                      className={`inventory-model-cell sticky z-10 shadow-[1px_0_0_#e2e8f0] ${
                        bulkFailures[item.id]
                          ? "bg-red-50"
                          : selectedIds.has(item.id)
                            ? "bg-[#f5f9fd]"
                            : "bg-white"
                      }`}
                    >
                      <div
                        className="admin-cell-primary truncate font-medium"
                        title={item.partNumber}
                      >
                        {item.partNumber}
                      </div>
                      <div
                        className="admin-cell-secondary mt-0.5 truncate"
                        title={item.brand}
                      >
                        {item.brand || "—"}
                      </div>
                      {bulkFailures[item.id] && (
                        <div className="inventory-failure mt-1 max-w-[300px] whitespace-normal rounded bg-red-100 px-1.5 py-1 font-normal text-red-700">
                          操作失败：{bulkFailures[item.id]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="inventory-numeric-cell">
                      <div className="admin-cell-primary font-medium tabular-nums">
                        {formatInventoryQuantity(quantityDisplay.spotQuantity)}
                      </div>
                    </TableCell>
                    <TableCell className="inventory-numeric-cell">
                      <div className="admin-cell-primary font-medium tabular-nums">
                        {formatInventoryQuantity(quantityDisplay.orderQuantity)}
                      </div>
                    </TableCell>
                    <TableCell className="inventory-numeric-cell">
                      <div className="admin-cell-primary font-medium tabular-nums">
                        {item.priceEx != null ? `¥${item.priceEx}` : "面议"}
                      </div>
                      {item.priceEx != null && (
                        <div className="admin-cell-secondary mt-0.5">
                          {item.taxIncluded === false ? "未税价" : "含税价"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell
                      className="admin-cell-primary truncate"
                      title={
                        ownerNames.get(Number(item.ownerUserId)) ||
                        `用户${item.ownerUserId}`
                      }
                    >
                      {ownerNames.get(Number(item.ownerUserId)) ||
                        `用户${item.ownerUserId}`}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={`text-[10px] ${statusDotClass(item.status)}`}
                            aria-hidden="true"
                          >
                            ●
                          </span>
                          <span className="admin-cell-primary font-medium">
                            {statusLabel(item.status)}
                          </span>
                          {item.status === "published" && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="admin-cell-secondary">
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
                              className="inventory-status-note max-w-[210px] truncate text-red-600"
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
                            <span className="inventory-status-note max-w-[210px] whitespace-normal text-amber-700">
                              库存售罄，请补充数量后重新上架
                            </span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell className={`inventory-actions-cell sticky right-0 z-20 text-right ${
                      bulkFailures[item.id]
                        ? "bg-red-50"
                        : selectedIds.has(item.id)
                          ? "bg-[#f5f9fd]"
                          : "bg-white"
                    }`}>
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
                              className="admin-row-action inventory-row-action rounded-none text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            >
                              编辑
                            </Button>
                          </Link>
                        )}
                        {item.status === "published" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="admin-row-action inventory-row-action rounded-none text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
                            className="admin-row-action inventory-row-action rounded-none text-[#185FA5] hover:bg-[#f5f9fd] hover:text-[#185FA5]"
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
                          className="admin-row-action inventory-row-action rounded-none text-destructive hover:bg-destructive/5 hover:text-destructive"
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
      </AdminDataPanel>

      {filtered.length > 0 && (
        <div className="inventory-caption inventory-pagination flex flex-wrap items-center justify-between gap-2">
          <span>
            共 {listResult?.total ?? 0} 条 · 每页最多{" "}
            {INVENTORY_BULK_ACTION_LIMIT} 条
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="default"
              variant="outline"
              className="inventory-control bg-white"
              disabled={page <= 1 || bulkPending}
              onClick={() => goToPage(page - 1)}
            >
              上一页
            </Button>
            <span className="min-w-[64px] text-center">
              第 {page} / {pageCount} 页
            </span>
            <Button
              size="default"
              variant="outline"
              className="inventory-control bg-white"
              disabled={page >= pageCount || bulkPending}
              onClick={() => goToPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
      </AdminPage>
    </PlatformLayout>
  );
}
