import { selectableLot, type CompanyLot } from "./companyStockSales";
export function CompanyLotPicker({
  lots,
  selectedIds,
  onSelect,
  loading,
  error,
  onRetry,
}: {
  lots: CompanyLot[];
  selectedIds: number[];
  onSelect: (lot: CompanyLot) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="company-stock-scroll">
      <table className="company-stock-table" aria-label="公司真实库存批次">
        <thead>
          <tr>
            <th>型号 / 品牌 / 封装</th>
            <th>DC / 批次</th>
            <th>仓位 / 入库单</th>
            <th className="numeric">可售数量</th>
            <th className="numeric">选择</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5}>正在核验公司库存…</td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={5} role="alert">
                {error}{" "}
                {onRetry ? (
                  <button type="button" className="crm-btn" onClick={onRetry}>
                    重试
                  </button>
                ) : null}
              </td>
            </tr>
          ) : !lots.length ? (
            <tr>
              <td colSpan={5}>无可售批次，历史待核库存不可选择</td>
            </tr>
          ) : (
            lots.map(lot => (
              <tr key={lot.lotId} data-company-lot={lot.lotId}>
                <td>
                  <div className="crm-sales-orders-model">{lot.partNumber}</div>
                  <div className="admin-cell-secondary">
                    {[lot.brand, lot.pkg].filter(Boolean).join(" / ") || "—"}
                  </div>
                </td>
                <td>
                  <div>{lot.dc || "—"}</div>
                  <div className="admin-cell-secondary">
                    {lot.lotNumber || `批次 #${lot.lotId}`}
                  </div>
                </td>
                <td>
                  <div>{lot.location || "—"}</div>
                  <div className="admin-cell-secondary">
                    入库 #{lot.inboundOrderId}
                  </div>
                </td>
                <td className="numeric">
                  {Number.isSafeInteger(lot.availableQty)
                    ? lot.availableQty
                    : "待核"}
                </td>
                <td className="numeric">
                  <button
                    type="button"
                    className="crm-btn"
                    disabled={
                      !selectableLot(lot) || selectedIds.includes(lot.lotId)
                    }
                    onClick={() => onSelect(lot)}
                  >
                    {selectedIds.includes(lot.lotId) ? "已选" : "选择"}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
