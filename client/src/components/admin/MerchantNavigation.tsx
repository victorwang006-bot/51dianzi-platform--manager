import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAdminPageMemory, useAdminRememberedState, sourcePageEntry } from "@/hooks/useAdminPageMemory";
import { pageMemoryContext, navigateAdjacentMerchant } from "@/lib/adminPageMemory";

const secondary: React.CSSProperties = { height: 30, padding: "0 9px", border: "1px solid #e2e8f0", borderRadius: 6, background: "white", color: "#475569", fontSize: 12 };
const field: React.CSSProperties = { ...secondary, width: 54, padding: "0 5px", textAlign: "center" };
export function MerchantPagination({ page, pageSize, total, onPageChange, onPageSizeChange }: {
  page: number; pageSize: number; total: number; onPageChange: (page: number) => void; onPageSizeChange?: (size: number) => void;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const [jump, setJump] = useState(String(page));
  const [error, setError] = useState("");
  useEffect(() => { setJump(String(page)); setError(""); }, [page]);
  const go = (value: number) => { if (Number.isSafeInteger(value) && value >= 1 && value <= last) { setError(""); onPageChange(value); } };
  const submit = () => {
    if (!/^\d+$/.test(jump.trim()) || Number(jump) < 1 || Number(jump) > last) { setError(`请输入1至${last}之间的整数页码`); return; }
    go(Number(jump));
  };
  const start = Math.max(1, Math.min(page - 2, last - 4));
  const pages = Array.from({ length: Math.min(last, 5) }, (_, i) => start + i);
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 4px" }}>
    <span style={{ color: "#64748b", fontSize: 12 }} aria-live="polite">共 {total} 条记录，第 {page} / {last} 页</span>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {onPageSizeChange && <select aria-label="每页条数" value={pageSize} style={{ ...secondary, padding: "0 4px" }} onChange={e => onPageSizeChange(Number(e.target.value))}>{[20, 50, 100].map(n => <option key={n} value={n}>{n}条/页</option>)}</select>}
      <button type="button" style={secondary} disabled={page <= 1} onClick={() => go(1)}>首页</button>
      <button type="button" style={secondary} disabled={page <= 1} onClick={() => go(page - 1)}>上一页</button>
      {start > 1 && <span style={{ color: "#94a3b8", fontSize: 12 }}>…</span>}
      {pages.map(n => <button key={n} type="button" aria-label={`第${n}页`} aria-current={page === n ? "page" : undefined} style={{ ...secondary, minWidth: 30, ...(page === n ? { borderColor: "#bfdbfe", background: "#eff6ff", color: "#185fa5", fontWeight: 600 } : {}) }} onClick={() => go(n)}>{n}</button>)}
      {start + pages.length - 1 < last && <span style={{ color: "#94a3b8", fontSize: 12 }}>…</span>}
      <button type="button" style={secondary} disabled={page >= last} onClick={() => go(page + 1)}>下一页</button>
      <button type="button" style={secondary} disabled={page >= last} onClick={() => go(last)}>末页</button>
      <label style={{ fontSize: 12, color: "#64748b", marginLeft: 4 }}>跳至 <input aria-label="跳转页码" inputMode="numeric" value={jump} style={field} onChange={e => setJump(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} /> 页</label>
      <button type="button" style={secondary} onClick={submit}>跳转</button>
      {error && <span role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>{error}</span>}
    </div>
  </div>;
}

function sourceInput(source: NonNullable<ReturnType<typeof sourcePageEntry>>) {
  const p = new URL(source.url, window.location.origin).searchParams;
  const state = source.state as Record<string, any>;
  const size = Number(p.get("pageSize") || state.pageSize || 20);
  const created = state.createdAtFilter || { preset: "all" };
  const salesOwnerCode = p.get("salesOwnerCode") || state.salesOwnerFilter || "all";
  return {
    page: (() => { const raw = p.get("page"); const n = raw && /^\d{1,7}$/.test(raw) ? Number(raw) : Number(state.page || 1); return Number.isSafeInteger(n) && n > 0 ? n : 1; })(),
    pageSize: [20, 50, 100].includes(size) ? size : 20,
    search: p.get("search") || state.search || undefined,
    salesOwnerCode: salesOwnerCode === "all" ? undefined : salesOwnerCode,
    createdAtPreset: created.preset === "all" ? undefined : created.preset,
    createdFrom: created.preset === "custom" ? created.from : undefined,
    createdTo: created.preset === "custom" ? created.to : undefined,
  };
}
export function MerchantSequentialNavigation({ merchantId }: { merchantId: number }) {
  const ready = useAdminPageMemory();
  const [, navigate] = useLocation();
  const source = sourcePageEntry();
  const validSource = source && /^\/merchants\/?(?:\?|$)/.test(source.url) ? source : null;
  const initial = validSource ? sourceInput(validSource) : { page: 1, pageSize: 20 };
  const [page, setPage] = useAdminRememberedState("navigationPage", initial.page);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();
  const context = pageMemoryContext();
  const current = useRef(context); current.current = context;
  const originalSource = useRef(validSource?.id);
  const pending = useRef(false);
  useEffect(() => {
    if (originalSource.current !== validSource?.id) { originalSource.current = validSource?.id; setPage(initial.page); setNotice(""); }
  }, [validSource?.id]);
  const query = trpc.merchant.list.useQuery({ ...initial, page } as any, { enabled: ready && !!validSource, staleTime: 0, refetchOnMount: "always" });
  const rows = query.data?.data ?? [];
  const index = rows.findIndex((x: any) => Number(x.id) === merchantId);
  const last = Math.max(1, Math.ceil((query.data?.total ?? 0) / initial.pageSize));
  const locked = !ready || !validSource || busy || query.isFetching || query.isError || index < 0;
  const move = async (step: number) => {
    if (locked || pending.current) return;
    pending.current = true; setBusy(true); setNotice("");
    const atStart = context;
    try {
      let next = rows[index + step] as any;
      let nextPage = page;
      if (!next) {
        nextPage = page + step;
        if (nextPage < 1 || nextPage > last) return;
        const fresh = await utils.merchant.list.fetch({ ...initial, page: nextPage } as any, { staleTime: 0 });
        next = step > 0 ? fresh.data[0] : fresh.data[fresh.data.length - 1];
      }
      if (current.current !== atStart) return;
      if (!next?.id) { setNotice("列表已变化，请返回原列表重新选择"); return; }
      setPage(nextPage);
      // Replace this detail entry; the memory core preserves its original list parent.
      navigateAdjacentMerchant(navigate, `/merchants/${next.id}`, nextPage);
    } catch { if (current.current === atStart) setNotice("相邻企业读取失败，请重试或返回原列表"); }
    finally { pending.current = false; setBusy(false); }
  };
  if (!validSource) return null;
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
    <button type="button" style={secondary} disabled={locked || (page <= 1 && index === 0)} onClick={() => void move(-1)}>上一家</button>
    <button type="button" style={secondary} disabled={locked || (page >= last && index === rows.length - 1)} onClick={() => void move(1)}>下一家</button>
    <span style={{ fontSize: 12, color: "#64748b" }}>按原筛选连续查看 · 返回仍回第{initial.page}页{page !== initial.page ? ` · 当前查看第${page}页` : ""}</span>
    {(notice || (index < 0 && query.data && !query.isFetching ? "当前企业已不在原筛选中，请返回原列表" : "")) && <span role="status" style={{ color: "#b45309", fontSize: 12 }}>{notice || "当前企业已不在原筛选中，请返回原列表"}</span>}
  </div>;
}
