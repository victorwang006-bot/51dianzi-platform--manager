import { useState } from "react";
import { trpc } from "../../../../api/business-trpc";
import { LOGISTICS_STATE_META } from "../../../shared/expressCompanies";

/**
 * 物流轨迹弹窗：展示快递100 实时查询结果。
 *
 * 与「订单动态」区分开：订单动态是平台内部状态流转记录，
 * 这里是承运商回传的真实运输轨迹，两者信息来源与用途都不同，
 * 因此并列展示而非合并成一个列表。
 */

const TONE_STYLE: Record<string, { dot: string; text: string; badge: string }> = {
  transit: {
    dot: "bg-[#2b7fd4]",
    text: "text-[#2b7fd4]",
    badge: "bg-[#eaf3fc] text-[#2b7fd4]",
  },
  pickup: {
    dot: "bg-[#7a5af8]",
    text: "text-[#7a5af8]",
    badge: "bg-[#f1eefe] text-[#7a5af8]",
  },
  delivering: {
    dot: "bg-[#e79a2b]",
    text: "text-[#e79a2b]",
    badge: "bg-[#fdf3e4] text-[#c47f16]",
  },
  signed: {
    dot: "bg-[#3B6D11]",
    text: "text-[#3B6D11]",
    badge: "bg-[#EAF3DE] text-[#3B6D11]",
  },
  problem: {
    dot: "bg-[#d24b4b]",
    text: "text-[#d24b4b]",
    badge: "bg-[#fbebeb] text-[#d24b4b]",
  },
};

function toneOf(state: string) {
  const tone = LOGISTICS_STATE_META[state]?.tone ?? "transit";
  return TONE_STYLE[tone] ?? TONE_STYLE.transit;
}

type Props = {
  orderId: number;
  orderNo: string;
  onClose: () => void;
};

export default function LogisticsDialog({ orderId, orderNo, onClose }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.order.logistics.useQuery(
    { orderId },
    // 物流数据本身受服务端缓存保护，这里不再叠加前端轮询，
    // 避免用户切换标签页时反复请求。
    { refetchOnWindowFocus: false, retry: false },
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await utils.order.logistics.invalidate({ orderId });
      await utils.order.logistics.fetch({ orderId, forceRefresh: true });
    } finally {
      setRefreshing(false);
    }
  };

  const tone = data ? toneOf(data.state) : TONE_STYLE.transit;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-[520px] max-w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-[16px] font-bold text-[#222]">物流轨迹</h3>
            <div className="text-[12px] text-[#888] mt-0.5">订单 {orderNo}</div>
          </div>
          {data?.state && (
            <span className={`crm-badge ${tone.badge}`}>{data.stateLabel}</span>
          )}
        </div>

        {isLoading && (
          <div className="py-8 text-center text-[13px] text-[#888]">
            正在向承运商查询…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-[#f0d6d6] bg-[#fdf5f5] px-3 py-2 text-[12px] text-[#b04b4b]">
            {error.message}
          </div>
        )}

        {data && (
          <>
            <div className="mb-4 rounded-md border border-[#eee] bg-[#fafafa] px-3 py-2.5 text-[12px] leading-6 text-[#666]">
              <div className="flex justify-between">
                <span>承运商</span>
                <span className="text-[#333]">{data.companyName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>运单号</span>
                <span className="text-[#333] font-mono">{data.expressNo || "—"}</span>
              </div>
              {data.currentCity && (
                <div className="flex justify-between">
                  <span>当前位置</span>
                  <span className="text-[#333]">{data.currentCity}</span>
                </div>
              )}
              {data.arrivalTime && (
                <div className="flex justify-between">
                  <span>预计到达</span>
                  <span className="text-[#333]">{data.arrivalTime}</span>
                </div>
              )}
              {data.queriedAt && (
                <div className="flex justify-between">
                  <span>更新时间</span>
                  <span className="text-[#999]">
                    {new Date(data.queriedAt)
                      .toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
                      .replace(/\//g, "-")}
                    {data.source === "cache" && "（缓存）"}
                  </span>
                </div>
              )}
            </div>

            {data.notice && (
              <div className="mb-4 rounded-md border border-[#dbe8f3] bg-[#f5f9fd] px-3 py-2 text-[12px] leading-5 text-[#54718a]">
                {data.notice}
              </div>
            )}

            {data.traces.length > 0 ? (
              <div className="max-h-80 overflow-y-auto space-y-3.5 pl-4 border-l border-[#eee] ml-1">
                {data.traces.map((t, i) => (
                  <div key={`${t.time}-${i}`} className="relative">
                    <span
                      className={`absolute -left-[21.5px] top-1.5 h-2 w-2 rounded-full ${
                        i === 0 ? `${tone.dot} ring-2 ring-[#f0f0f0]` : "bg-[#ddd]"
                      }`}
                    />
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] ${i === 0 ? tone.text : "text-[#999]"}`}
                      >
                        {t.ftime || t.time}
                      </span>
                      {t.status && i === 0 && (
                        <span className="text-[11px] text-[#999]">{t.status}</span>
                      )}
                    </div>
                    <div
                      className={`text-[13px] mt-0.5 leading-5 ${
                        i === 0 ? "text-[#333] font-medium" : "text-[#888]"
                      }`}
                    >
                      {t.context}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-[13px] text-[#999]">
                暂无轨迹信息
              </div>
            )}
          </>
        )}

        <div className="flex justify-between items-center mt-5">
          <button
            className="crm-btn crm-btn-sm"
            onClick={handleRefresh}
            disabled={refreshing || isLoading}
          >
            {refreshing ? "刷新中…" : "刷新轨迹"}
          </button>
          <button className="crm-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
