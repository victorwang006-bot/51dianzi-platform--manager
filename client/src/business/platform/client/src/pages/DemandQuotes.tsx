import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../../../api/business-trpc";
import PlatformLayout from "../../../../BusinessContentFrame";
import ProcurementWorkspaceNav from "../components/customerDemands/ProcurementWorkspaceNav";
import ChatActionButton from "../components/ChatActionButton";

/**
 * ERP - 采购工作台 - 收到的公开需求报价页
 * 我发布的需求收到的全部报价列表，报价栏支持"聊一聊"按钮直达与报价方的会话
 * 样式、字体、字号、布局与 CRM 其他模块保持一致
 */

type QuoteRow = {
  id: number;
  demandId: number;
  supplierId: number;
  price: string;
  qtyAvailable: number;
  leadTime: string | null;
  note: string | null;
  createdAt: Date;
  partNumber: string;
  brand: string | null;
  category: string;
  demandQty: number;
  demandQtyUnit: string;
  targetPrice: string | null;
  demandStatus: "open" | "closed";
  supplierName: string;
};

const PAGE_SIZE = 10;

function fmtDateTime(d: Date | string) {
  const date = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export default function DemandQuotes() {
  const [, navigate] = useLocation();
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");
  const [page, setPage] = useState(1);

  const {
    data: quotes = [],
    isLoading,
    isError,
    error,
    refetch,
  } = trpc.demand.receivedQuotes.useQuery();

  const filtered = useMemo(() => {
    const list = quotes as QuoteRow[];
    if (!kw.trim()) return list;
    const k = kw.trim().toLowerCase();
    return list.filter(
      q =>
        q.partNumber.toLowerCase().includes(k) ||
        q.supplierName.toLowerCase().includes(k)
    );
  }, [quotes, kw]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <PlatformLayout>
      <div className="mb-3"><h1 className="text-lg font-semibold text-slate-800">采购工作台</h1></div>
      <ProcurementWorkspaceNav active="quotes" />
      <div className="bg-white rounded-lg border border-[#eee]">
        {/* 工具栏 */}
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-[#f0f0f0]">
          <input
            className="crm-input w-[200px]"
            placeholder="搜索型号 / 报价供应商"
            value={kwInput}
            onChange={e => setKwInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                setKw(kwInput);
                setPage(1);
              }
            }}
          />
          <button
            className="crm-btn crm-btn-up"
            onClick={() => {
              setKw(kwInput);
              setPage(1);
            }}>
            筛选
          </button>
          <button
            className="crm-btn"
            onClick={() => {
              setKwInput("");
              setKw("");
              setPage(1);
            }}>
            重置
          </button>
          <div className="ml-auto text-[12px] text-[#888]">
            共 {filtered.length} 条报价
          </div>
        </div>

        {/* 报价表格 */}
        <div className="overflow-x-auto">
          <table className="crm-table">
            <thead>
              <tr>
                <th>报价时间</th>
                <th>需求型号</th>
                <th>品牌</th>
                <th>需求数量</th>
                <th>目标单价</th>
                <th>报价供应商</th>
                <th>报价单价</th>
                <th>可供数量</th>
                <th>交期</th>
                <th>报价备注</th>
                <th>需求状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="text-center text-[#888] py-8">
                    加载中...
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center">
                    <p className="text-sm text-red-700">报价数据加载失败：{error.message}</p>
                    <button
                      type="button"
                      className="crm-btn crm-btn-sm mt-3"
                      onClick={() => void refetch()}
                    >
                      重新加载
                    </button>
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center text-[#888] py-8">
                    暂无收到的报价，先到「发布需求」发布采购需求
                  </td>
                </tr>
              ) : (
                pageRows.map(q => (
                  <tr key={q.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(q.createdAt)}</td>
                    <td className="font-medium text-[#185FA5]">{q.partNumber}</td>
                    <td>{q.brand || "—"}</td>
                    <td>
                      {q.demandQty.toLocaleString("zh-CN")} {q.demandQtyUnit}
                    </td>
                    <td>
                      {q.targetPrice
                        ? `￥${Number(q.targetPrice).toFixed(2)}`
                        : "面议"}
                    </td>
                    {/* 2026-08-17 自营平权：移除自营内联高亮，与其他商家同一渲染 */}
                    <td>
                      {q.supplierName}
                    </td>
                    <td className="font-medium text-[#A32D2D]">
                      ￥{Number(q.price).toFixed(2)}
                    </td>
                    <td>{q.qtyAvailable.toLocaleString("zh-CN")}</td>
                    <td>{q.leadTime || "—"}</td>
                    <td className="max-w-[160px] truncate" title={q.note || ""}>
                      {q.note || "—"}
                    </td>
                    <td>
                      {q.demandStatus === "open" ? (
                        <span className="crm-badge crm-badge-on">询价中</span>
                      ) : (
                        <span className="crm-badge crm-badge-void">已关闭</span>
                      )}
                    </td>
                    <td>
                      <ChatActionButton onClick={() => navigate(`/chat?userId=${q.supplierId}`)}>
                        聊一聊
                      </ChatActionButton>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-end gap-2 p-4">
            <button
              className="crm-btn crm-btn-sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}>
              上一页
            </button>
            <span className="text-[12px] text-[#888]">
              {page} / {totalPages}
            </span>
            <button
              className="crm-btn crm-btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}>
              下一页
            </button>
          </div>
        )}
      </div>
    </PlatformLayout>
  );
}
