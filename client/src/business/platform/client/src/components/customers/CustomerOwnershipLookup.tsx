import { useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { customerOwnershipQuerySchema } from "../../../../shared/customerOwnership";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { trpc } from "../../../../../api/business-trpc";

export function CustomerOwnershipLookup({ companyName, disabled = false }: { companyName: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const query = trpc.customer.ownershipSearch.useQuery({ companyName: submitted }, {
    enabled: open && submitted.length >= 2,
    retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false,
  });
  const validate = (value: string) => {
    const checked = customerOwnershipQuerySchema.safeParse({ companyName: value });
    if (!checked.success) { toast.error(checked.error.issues[0]?.message ?? "请输入客户公司名称"); return null; }
    return checked.data.companyName;
  };
  const begin = () => {
    const name = validate(companyName);
    if (!name) { document.querySelector<HTMLInputElement>('[data-customer-field="name"]')?.focus(); return; }
    setDraft(name); setSubmitted(name); setOpen(true);
  };
  const search = () => {
    const name = validate(draft);
    if (!name) return;
    if (name === submitted) void query.refetch(); else setSubmitted(name);
  };
  const changed = draft.trim() !== submitted;
  return <>
    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 border-slate-300 bg-white px-2 text-xs shadow-none" disabled={disabled} onClick={begin}>
      查询归属
    </Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setSubmitted(""); }}>
      <DialogContent className="max-w-xl gap-3 p-4 sm:p-5" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); if (!query.isFetching) search(); } }}>
        <DialogHeader>
          <DialogTitle className="text-base">客户归属查询</DialogTitle>
          <DialogDescription className="text-xs">仅查询本企业ERP客户。按公司名称核对归属，不查询51平台后台销售归属。</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input aria-label="查询公司名称" maxLength={128} className="h-8 min-w-0 text-xs" placeholder="输入客户公司名称，建议填写全称" value={draft} onChange={event => setDraft(event.target.value)} />
          <Button type="button" className="h-8 shrink-0 px-3 text-xs" disabled={query.isFetching} onClick={search}><Search className="mr-1 h-3.5 w-3.5" />查询</Button>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto" aria-live="polite" data-testid="ownership-results">
          {changed ? <p className="py-4 text-center text-xs text-slate-500">名称已修改，请重新查询。</p>
            : query.isFetching ? <p className="py-4 text-center text-xs text-slate-500">正在查询客户归属…</p>
            : query.isError ? <p className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{query.error.message || "查询失败，请重试"}</p>
            : query.data ? <>
              {query.data.matches.length === 0 && <p className="rounded border border-dashed p-4 text-xs text-slate-600">未查到匹配记录。请核对公司全称；这不代表客户未被开发，保存时仍会执行查重。</p>}
              {query.data.matches.map((match, index) => <div key={`${index}-${match.companyName}`} className="rounded border border-slate-200 p-3 text-xs" data-testid="ownership-match">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words font-medium text-slate-800">{match.companyName}</p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${match.matchType === "exact" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{match.matchType === "exact" ? "同名记录" : "相近名称"}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                  <span>负责人：{match.ownerName}</span><span>{match.ownership === "mine" ? "我的客户" : "同事客户"}</span><span>{match.archived ? "已归档" : "已登记"}</span>
                  {match.viewableCustomerId !== null && <a className="ml-auto text-xs text-[#185FA5] hover:underline" href={`/customers/${match.viewableCustomerId}`} target="_blank" rel="noopener noreferrer" title="在新页面查看，保留当前录入内容">查看详情</a>}
                </div>
              </div>)}
              {query.data.hasMore && <p className="text-xs text-amber-700">仅展示前20条匹配，请输入公司全称缩小范围。</p>}
            </> : null}
        </div>
        <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">相近名称不一定是同一客户，请人工核对。不展示电话、邮箱、地址和跟进内容，也不会自动认领或转移客户。</p>
      </DialogContent>
    </Dialog>
  </>;
}
