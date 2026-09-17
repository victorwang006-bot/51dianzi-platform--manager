import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTime } from "@shared/beijingTime";
import { ChevronLeft, ChevronRight, History, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

type OperationRecord = {
  id: number | string;
  action: string;
  actorName: string;
  target: string;
  reason: string;
  occurredAt: Date | string | null;
  result: string | null;
};

type OperationResult = {
  available?: boolean;
  items?: unknown[];
  records?: unknown[];
  total?: number;
};

function toRecord(value: unknown, index: number): OperationRecord {
  const row = (value ?? {}) as Record<string, unknown>;
  const actor = row.actor && typeof row.actor === "object" ? row.actor as Record<string, unknown> : null;
  const target = row.target && typeof row.target === "object" ? row.target as Record<string, unknown> : null;
  return {
    id: typeof row.id === "number" || typeof row.id === "string" ? row.id : `record-${index}`,
    action: String(row.actionLabel ?? row.eventLabel ?? row.action ?? row.eventType ?? "操作"),
    actorName: String(row.actorName ?? actor?.displayName ?? actor?.name ?? "系统"),
    target: String(row.targetName ?? target?.displayName ?? target?.name ?? row.targetType ?? "当前商户"),
    reason: String(row.reason ?? row.note ?? row.description ?? "—"),
    occurredAt: row.time instanceof Date || typeof row.time === "string"
      ? row.time
      : row.occurredAt instanceof Date || typeof row.occurredAt === "string"
        ? row.occurredAt
      : row.createdAt instanceof Date || typeof row.createdAt === "string"
        ? row.createdAt
        : null,
    result: typeof row.result === "string" ? row.result : null,
  };
}

function resultLabel(result: string | null) {
  if (!result) return "—";
  if (["success", "succeeded"].includes(result)) return "成功";
  if (["failed", "failure"].includes(result)) return "失败";
  return result;
}

export default function MerchantOperationRecordsPanel({ merchantId }: { merchantId: number }) {
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const merchantApi = trpc.merchant as unknown as Record<string, any>;
  const recordsQuery = merchantApi.operationRecords.useQuery(
    { merchantId, page, pageSize },
    { placeholderData: (previous: unknown) => previous, retry: false },
  ) as {
    data?: OperationResult;
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    error?: { message?: string };
  };
  const records = useMemo(
    () => ((recordsQuery.data?.items ?? recordsQuery.data?.records ?? []) as unknown[]).map(toRecord),
    [recordsQuery.data],
  );
  const total = recordsQuery.data?.total ?? records.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="overflow-hidden rounded-lg border bg-white text-[13px]" data-merchant-operation-records>
      <div className="border-b px-4 py-3">
        <h2 className="text-[15px] font-semibold">操作记录</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">展示当前商户资料与后台管理操作，敏感前后值不会在此显示。</p>
      </div>

      {recordsQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在加载操作记录…</div>
      ) : recordsQuery.isError ? (
        <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">操作记录加载失败：{recordsQuery.error?.message || "请稍后重试"}</div>
      ) : recordsQuery.data?.available === false ? (
        <div className="py-12 text-center text-muted-foreground">操作记录数据源暂不可用。</div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground"><History className="mb-2 h-7 w-7 opacity-40" /> 暂无操作记录</div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block" data-responsive-record-table>
            <Table className="min-w-[780px]">
              <TableHeader><TableRow className="bg-muted/30"><TableHead>时间</TableHead><TableHead>操作</TableHead><TableHead>操作人</TableHead><TableHead>对象</TableHead><TableHead>原因 / 说明</TableHead><TableHead>结果</TableHead></TableRow></TableHeader>
              <TableBody>{records.map(record => (
                <TableRow key={record.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{record.occurredAt ? formatBeijingDateTime(record.occurredAt) : "—"}</TableCell>
                  <TableCell className="font-medium">{record.action}</TableCell>
                  <TableCell>{record.actorName}</TableCell>
                  <TableCell>{record.target}</TableCell>
                  <TableCell className="max-w-[320px] break-words text-muted-foreground">{record.reason}</TableCell>
                  <TableCell><Badge variant={record.result === "failed" ? "destructive" : "outline"}>{resultLabel(record.result)}</Badge></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
          <div className="space-y-4 p-4 md:hidden" data-responsive-record-timeline>
            {records.map(record => (
              <article key={record.id} className="relative border-l-2 border-primary/20 pl-4">
                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{record.action}</h3><Badge variant={record.result === "failed" ? "destructive" : "outline"}>{resultLabel(record.result)}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{record.occurredAt ? formatBeijingDateTime(record.occurredAt) : "—"} · {record.actorName}</p>
                <p className="mt-2 break-words text-[13px]">{record.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">对象：{record.target}</p>
              </article>
            ))}
          </div>
        </>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
          <span>第 {page} / {totalPages} 页，共 {total} 条</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={page <= 1 || recordsQuery.isFetching} onClick={() => setPage(current => current - 1)}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
            <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages || recordsQuery.isFetching} onClick={() => setPage(current => current + 1)}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
