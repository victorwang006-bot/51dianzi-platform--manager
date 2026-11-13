import { useEffect, useRef, useState } from "react";
import type {
  SalesOrderSummary,
  SalesOrderDetail,
} from "../../../shared/crmSalesOrders";
import {
  assertBusinessReadCurrent,
  buildBusinessOrdersCsv,
  createBusinessOrderReadLimiter,
  type BusinessOrderExportMetadataReader,
  collectBusinessOrderDetails,
  collectBusinessOrderSummaries,
  downloadBusinessOrdersCsv,
  sumBusinessOrderAmounts,
  type BusinessOrderFilters,
  type BusinessOrderReaders,
} from "../lib/businessSalesOrderPresentation";

type ReadState<T> = { key: string; data?: T; error?: string };
export type BusinessPresentationInput = {
  /** BFF-proven actor/enterprise/binding + authorization revision, never local customer metadata. */
  identity: string;
  verified: boolean;
  page: number;
  filters: BusinessOrderFilters;
  rows: SalesOrderSummary[] | undefined;
  total: number | undefined;
  readRevision?: number;
  readers: BusinessOrderReaders;
  onReadError: (error: unknown) => void;
  readExportMetadata?: BusinessOrderExportMetadataReader;
};
export function useBusinessSalesOrderPresentation(
  input: BusinessPresentationInput
) {
  const filterKey = JSON.stringify([input.identity, input.filters]);
  const rowRevision =
    input.rows
      ?.map(row => `${row.id}:${row.customerId}:${row.version}`)
      .join(",") ?? "";
  const key = JSON.stringify([
    filterKey,
    input.page,
    rowRevision,
    input.total,
    input.readRevision,
  ]);
  const active =
    input.verified && input.rows !== undefined && input.total !== undefined;
  const current = useRef({ key, active });
  current.current = { key, active };
  const alive = useRef(true);
  const readers = useRef(input.readers);
  readers.current = input.readers;
  const queue = useRef(createBusinessOrderReadLimiter(3));
  const limitedReaders = useRef<BusinessOrderReaders>({
    list: (request, signal) => {
      const frozen = readers.current;
      return queue.current(() => frozen.list(request, signal), signal);
    },
    get: (request, signal) => {
      const frozen = readers.current;
      return queue.current(() => frozen.get(request, signal), signal);
    },
  });
  const metadataReader = useRef(input.readExportMetadata);
  metadataReader.current = input.readExportMetadata;
  const errorHandler = useRef(input.onReadError);
  errorHandler.current = input.onReadError;
  const [revision, setRevision] = useState(0);
  const [details, setDetails] = useState<
    ReadState<Map<number, SalesOrderDetail>>
  >({ key: "" });
  const [aggregate, setAggregate] = useState<
    ReadState<{ total: number; amount: string }>
  >({ key: "" });
  const [selection, setSelection] = useState<{ key: string; ids: Set<number> }>(
    { key: "", ids: new Set() }
  );
  const [exportState, setExportState] = useState<{
    key: string;
    busy: boolean;
    message: string;
  }>({ key: "", busy: false, message: "" });
  const exporting = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      exporting.current?.abort();
    };
  }, []);
  const isCurrent = (snapshot: string) =>
    alive.current && current.current.active && current.current.key === snapshot;
  useEffect(() => {
    exporting.current?.abort();
    exporting.current = null;
    setSelection({ key, ids: new Set() });
    setExportState({ key, busy: false, message: "" });
  }, [key, active]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const guard = { signal: abort.signal, isCurrent: () => isCurrent(key) };
    const frozenReaders = limitedReaders.current;
    setDetails({ key });
    void collectBusinessOrderDetails(frozenReaders, input.rows!, guard)
      .then(rows => {
        if (guard.isCurrent() && !abort.signal.aborted)
          setDetails({ key, data: new Map(rows.map(row => [row.id, row])) });
      })
      .catch(error => {
        if (!guard.isCurrent() || abort.signal.aborted) return;
        errorHandler.current(error);
        abort.abort();
        setDetails({
          key,
          error: error instanceof Error ? error.message : "商品与物流读取失败",
        });
      });
    return () => abort.abort();
  }, [key, active, revision]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const guard = { signal: abort.signal, isCurrent: () => isCurrent(key) };
    setAggregate({ key });
    void collectBusinessOrderSummaries(
      limitedReaders.current,
      input.filters,
      guard,
      input.total
    )
      .then(rows => {
        const amount = sumBusinessOrderAmounts(rows);
        if (guard.isCurrent() && !abort.signal.aborted)
          setAggregate({ key, data: { total: rows.length, amount } });
      })
      .catch(error => {
        if (!guard.isCurrent() || abort.signal.aborted) return;
        errorHandler.current(error);
        abort.abort();
        setAggregate({
          key,
          error: error instanceof Error ? error.message : "全筛选统计失败",
        });
      });
    return () => abort.abort();
  }, [key, active, revision]);
  const selectedIds =
    active && selection.key === key ? selection.ids : new Set<number>();
  const toggle = (id: number) => {
    if (!active || !input.rows?.some(row => row.id === id) || exporting.current)
      return;
    setSelection(previous => {
      const ids = new Set(previous.key === key ? previous.ids : []);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { key, ids };
    });
  };
  const toggleAll = () => {
    if (!active || !input.rows || exporting.current) return;
    setSelection({
      key,
      ids:
        input.rows.length > 0 &&
        input.rows.every(row => selectedIds.has(row.id))
          ? new Set()
          : new Set(input.rows.map(row => row.id)),
    });
  };
  const exportOrders = async () => {
    if (!isCurrent(key) || exporting.current) return;
    const abort = new AbortController();
    exporting.current = abort;
    const guard = {
      signal: abort.signal,
      isCurrent: () => isCurrent(key) && exporting.current === abort,
    };
    const frozenReaders = limitedReaders.current;
    const frozenMetadataReader = metadataReader.current;
    const selected = input.rows!.filter(row => selectedIds.has(row.id));
    const filters = { ...input.filters };
    setExportState({
      key,
      busy: true,
      message: "正在读取完整范围，完成前不会生成文件。",
    });
    try {
      const summaries = selected.length
        ? selected
        : await collectBusinessOrderSummaries(
            frozenReaders,
            filters,
            guard,
            input.total
          );
      const rows = await collectBusinessOrderDetails(
        frozenReaders,
        summaries,
        guard
      );
      if (filters.status && rows.some(row => row.status !== filters.status))
        throw new Error("订单状态已变化，请重新筛选后导出。");
      const metadata = frozenMetadataReader
        ? await frozenMetadataReader(rows, guard)
        : undefined;
      assertBusinessReadCurrent(guard);
      const csv = buildBusinessOrdersCsv(rows, metadata);
      assertBusinessReadCurrent(guard);
      downloadBusinessOrdersCsv(
        csv,
        `业务订单-${selected.length ? `选中${selected.length}` : "当前筛选全部"}.csv`
      );
      setExportState({
        key,
        busy: false,
        message: `已导出 ${rows.length} 条${selected.length ? "选中订单" : "当前筛选订单"}。`,
      });
    } catch (error) {
      if (!guard.isCurrent() || abort.signal.aborted) return;
      errorHandler.current(error);
      setExportState({
        key,
        busy: false,
        message: `导出失败，未生成文件：${error instanceof Error ? error.message : "读取失败"}`,
      });
    } finally {
      if (exporting.current === abort) {
        exporting.current = null;
        abort.abort();
      }
    }
  };
  const cancelExport = () => {
    exporting.current?.abort();
    exporting.current = null;
    setExportState({ key, busy: false, message: "已取消导出，未生成文件。" });
  };
  return {
    details: active && details.key === key ? details.data : undefined,
    detailsError: active && details.key === key ? details.error : undefined,
    aggregate: active && aggregate.key === key ? aggregate.data : undefined,
    aggregateError:
      active && aggregate.key === key ? aggregate.error : undefined,
    selectedIds,
    toggle,
    toggleAll,
    exportBusy: active && exportState.key === key && exportState.busy,
    exportMessage: active && exportState.key === key ? exportState.message : "",
    exportOrders,
    cancelExport,
    retry: () => setRevision(value => value + 1),
  };
}
