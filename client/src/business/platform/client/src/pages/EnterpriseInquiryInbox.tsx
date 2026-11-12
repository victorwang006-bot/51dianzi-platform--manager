import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2, MessageSquare } from "lucide-react";
import { AdminDataPanel, AdminFilterBar, AdminPage, AdminPageHeader } from "@/components/admin/UnifiedAdminPage";
import PlatformLayout from "../../../../BusinessContentFrame";
import { trpc } from "../../../../api/business-trpc";
import { formatBeijingDateTime } from "../../../shared/beijingTime";

type InboxStatus = "all" | "open" | "replied" | "closed";

const statusLabels: Record<InboxStatus, string> = {
  all: "全部",
  open: "待回复",
  replied: "已回复",
  closed: "已关闭",
};

const statusBadgeClass: Record<Exclude<InboxStatus, "all">, string> = {
  open: "border-amber-200 bg-amber-50 text-amber-800",
  replied: "border-blue-200 bg-blue-50 text-blue-700",
  closed: "border-slate-200 bg-slate-50 text-slate-600",
};

export default function EnterpriseInquiryInbox() {
  const d51Ready = usePageMemory();

  const [status, setStatus] = useRememberedState<InboxStatus>("status", "all");
  const [page, setPage] = useRememberedState("page", 1);
  const pageSize = 20;
  const enterpriseQuery = trpc.enterprise.me.useQuery(undefined, { retry: false });
  const permissionKeys = (enterpriseQuery.data?.permissionKeys ?? []) as readonly string[];
  const canReceive = Boolean(
    enterpriseQuery.data?.isOwner
      || permissionKeys.includes("inquiry.receive"),
  );
  const inboxQuery = useRestoringListQuery(trpc.enterprise.inquiryInbox.useQuery({ status, page, pageSize }, freshListOptions({
    enabled: canReceive,
    retry: false,
    refetchOnWindowFocus: true,
  }, d51Ready)));

  useEffect(() => {
    setPage(1);
  }, [status]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil((inboxQuery.data?.total ?? 0) / pageSize)), [inboxQuery.data?.total]);
  const rows = inboxQuery.data?.rows ?? [];
  const ownerView = enterpriseQuery.data?.isOwner ?? false;

  let content: React.ReactNode;
  if (enterpriseQuery.isLoading) {
    content = <LoadingState label="正在确认询价接待权限…" />;
  } else if (enterpriseQuery.isError) {
    content = <ErrorState message={`企业权限加载失败：${enterpriseQuery.error.message}`} />;
  } else if (!canReceive) {
    content = <AdminDataPanel className="border-amber-200 bg-amber-50 px-5 py-5 text-[12px] leading-6 text-amber-900" role="alert"><strong>您没有询价接待权限。</strong><p className="mt-1">请由企业所有者在“用户与权限”的原成员管理中明确授予“询价接待”权限。</p></AdminDataPanel>;
  } else if (inboxQuery.isLoading) {
    content = <LoadingState label="正在加载询价…" />;
  } else if (inboxQuery.isError) {
    content = <ErrorState message={`询价列表加载失败：${inboxQuery.error.message}`} />;
  } else if (!rows.length) {
    content = <AdminDataPanel className="px-5 py-14 text-center"><Inbox className="mx-auto size-8 text-[#9aabbc]" /><h2 className="mt-3 text-[15px] font-semibold text-[#233548]">暂无符合条件的询价</h2><p className="mt-1 text-[12px] text-[#7a8998]">新询价会在分配后显示在这里。</p></AdminDataPanel>;
  } else {
    content = <>
      <AdminDataPanel className="overflow-hidden" role="region" aria-labelledby="enterprise-inquiry-list-title">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] table-fixed text-left text-[12px]">
            <thead className="bg-[#fafcff] text-[11px] text-[#7a8998]">
              <tr>
                <th className="w-[20%] px-5 py-3 font-medium">型号 / 品牌</th>
                <th className="w-[11%] px-4 py-3 text-right font-medium">数量</th>
                <th className="w-[16%] px-4 py-3 font-medium">采购方</th>
                <th className="w-[13%] px-4 py-3 font-medium">状态</th>
                <th className="w-[18%] px-4 py-3 font-medium">更新时间</th>
                <th className="w-[22%] px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf1f5]">
              {rows.map(row => <tr key={row.id} className="align-middle">
                <td className="px-5 py-3"><div className="truncate font-medium text-[#233548]">{row.partNumber}</div><div className="mt-0.5 truncate text-[11px] text-[#7a8998]">{row.brand || "—"}</div></td>
                <td className="px-4 py-3 text-right tabular-nums text-[#526273]">{row.quantity}</td>
                <td className="px-4 py-3"><span className="block truncate text-[#526273]">{row.buyerName || "—"}</span></td>
                <td className="px-4 py-3"><InquiryStatus status={row.status as Exclude<InboxStatus, "all">} /></td>
                <td className="px-4 py-3 text-[11px] text-[#667788]">{formatBeijingDateTime(row.lastActivityAt || row.createdAt)}</td>
                <td className="px-4 py-3 text-right"><ReceptionLink conversationId={row.conversationId} /></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 p-4 md:hidden">
          {rows.map(row => <article key={row.id} className="rounded-md border border-[#e2e8ef] p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-[15px] font-semibold text-[#233548]">{row.partNumber}</h3><p className="mt-0.5 truncate text-[11px] text-[#7a8998]">{row.brand || "—"}</p></div><InquiryStatus status={row.status as Exclude<InboxStatus, "all">} /></div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
              <div><dt className="text-[11px] text-[#7a8998]">数量</dt><dd className="mt-0.5 text-right tabular-nums text-[#526273]">{row.quantity}</dd></div>
              <div><dt className="text-[11px] text-[#7a8998]">采购方</dt><dd className="mt-0.5 truncate text-[#526273]">{row.buyerName || "—"}</dd></div>
              <div className="col-span-2"><dt className="text-[11px] text-[#7a8998]">更新时间</dt><dd className="mt-0.5 text-[11px] text-[#526273]">{formatBeijingDateTime(row.lastActivityAt || row.createdAt)}</dd></div>
            </dl>
            <div className="mt-4 flex justify-end border-t border-[#edf1f5] pt-3"><ReceptionLink conversationId={row.conversationId} /></div>
          </article>)}
        </div>
      </AdminDataPanel>
      <Pagination page={page} totalPages={totalPages} total={inboxQuery.data?.total ?? 0} onPageChange={setPage} />
    </>;
  }

  return <PlatformLayout>
    <AdminPage className="w-full min-w-0" data-enterprise-inquiry-inbox>
      <AdminPageHeader
        list
        title={<span id="enterprise-inquiry-list-title">企业询价</span>}
        description={ownerView ? "查看企业当前分配给您的询价接待业务。" : "仅展示后端分配给您接待的询价。"}
        actions={canReceive ? <span className="rounded-full border border-[#d8e6f4] bg-[#f5f9fe] px-3 py-1 text-[11px] text-[#185fa5]">{ownerView ? "企业管理视图" : "我的接待询价"}</span> : null}
      />
      <AdminFilterBar role="tablist" aria-label="询价状态筛选">
        {(Object.keys(statusLabels) as InboxStatus[]).map(value => <button type="button" key={value} role="tab" aria-selected={status === value} onClick={() => setStatus(value)} className={`h-8 rounded-md border px-3 text-[12px] transition-colors ${status === value ? "border-[#88afd1] bg-[#edf5fe] font-medium text-[#185fa5]" : "border-[#e1e7ee] bg-white text-[#667788] hover:border-[#b9cee3]"}`}>{statusLabels[value]}</button>)}
      </AdminFilterBar>
      {content}
    </AdminPage>
  </PlatformLayout>;
}

function InquiryStatus({ status }: { status: Exclude<InboxStatus, "all"> }) {
  const normalizedStatus = status in statusBadgeClass ? status : "open";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusBadgeClass[normalizedStatus]}`}>{statusLabels[normalizedStatus]}</span>;
}

function ReceptionLink({ conversationId }: { conversationId: number }) {
  // The conversation is opened by the original chat page; this is intentionally not a new chat UI.
  return <Link href={`/chat?conversationId=${encodeURIComponent(String(conversationId))}`} className="crm-btn crm-btn-primary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]"><MessageSquare className="size-3.5" />接待询价</Link>;
}

function LoadingState({ label }: { label: string }) {
  return <AdminDataPanel className="p-10 text-center text-[12px] text-[#7a8998]"><Loader2 className="mx-auto mb-2 size-5 animate-spin text-[#185fa5]" />{label}</AdminDataPanel>;
}

function ErrorState({ message }: { message: string }) {
  return <AdminDataPanel className="border-red-200 bg-red-50 p-5 text-[12px] text-red-700" role="alert"><AlertCircle className="mr-2 inline size-4" />{message}</AdminDataPanel>;
}

function Pagination({ page, totalPages, total, onPageChange }: { page: number; totalPages: number; total: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <AdminDataPanel><nav className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px] text-[#667788]" aria-label="询价分页"><span>共 {total} 条，第 {page}/{totalPages} 页</span><span className="flex gap-2"><button type="button" className="crm-btn h-8 px-3" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="size-3.5" />上一页</button><button type="button" className="crm-btn h-8 px-3" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页<ChevronRight className="size-3.5" /></button></span></nav></AdminDataPanel>;
}
