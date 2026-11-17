import { useEffect, useId, useRef, useState } from "react";
import { selectableLot, type CompanyLot } from "./companyStockSales";

type Props = {
  lots: CompanyLot[];
  selectedIds: number[];
  onSelect: (lot: CompanyLot) => void;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onRetry?: () => void;
  keyword?: string;
  onKeywordChange?: (value: string) => void;
  onSearch?: () => void;
  onOpen?: () => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
};

/** Only displays the server's current page. A model is never a lot identity. */
export function CompanyLotPicker({
  lots,
  selectedIds,
  onSelect,
  loading,
  error,
  disabled,
  onRetry,
  keyword = "",
  onKeywordChange,
  onSearch,
  onOpen,
  page = 1,
  pageSize = 20,
  total = 0,
  onPageChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div
      ref={root}
      className="company-lot-picker"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          root.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        className="crm-btn company-lot-trigger"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(value => !value);
        }}
      >
        <span>
          选择公司库存批次
          {selectedIds.length ? ` · 已选 ${selectedIds.length}` : ""}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div
          id={id}
          className="company-lot-dropdown"
          aria-label="公司真实库存批次"
        >
          {onKeywordChange && onSearch ? (
            <div className="company-stock-toolbar company-lot-search">
              <input
                ref={search}
                className="crm-input"
                aria-label="搜索型号"
                placeholder="搜索型号、品牌或批次"
                value={keyword}
                onChange={event => onKeywordChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSearch();
                  }
                }}
              />
              <button
                type="button"
                className="crm-btn"
                disabled={loading}
                onClick={onSearch}
              >
                搜索
              </button>
            </div>
          ) : null}
          <div
            className="company-lot-options"
            role="group"
            aria-label="可售批次选项"
          >
            {loading ? (
              <p role="status">正在核验公司库存…</p>
            ) : error ? (
              <p role="alert">
                {error}
                {onRetry ? (
                  <button type="button" className="crm-btn" onClick={onRetry}>
                    重试
                  </button>
                ) : null}
              </p>
            ) : !lots.length ? (
              <p>暂无可售批次</p>
            ) : (
              lots.map(lot => (
                <div key={lot.lotId} data-company-lot={lot.lotId}>
                  <button
                    type="button"
                    className="company-lot-option"
                    disabled={
                      !selectableLot(lot) || selectedIds.includes(lot.lotId)
                    }
                    onClick={() => onSelect(lot)}
                  >
                    <span className="company-lot-identity">
                      <strong>{lot.partNumber}</strong>
                      <span>
                        {[lot.brand, lot.pkg].filter(Boolean).join(" / ") ||
                          "—"}
                      </span>
                      <span>
                        {lot.lotNumber || `批次 #${lot.lotId}`}
                        {lot.dc ? ` · DC ${lot.dc}` : ""}
                        {lot.location ? ` · ${lot.location}` : ""}
                      </span>
                    </span>
                    <span className="company-lot-quantity">
                      可售{" "}
                      {Number.isSafeInteger(lot.availableQty)
                        ? lot.availableQty
                        : "待核"}
                      <small>
                        {selectedIds.includes(lot.lotId) ? "已选" : "选择"}
                      </small>
                    </span>
                  </button>
                </div>
              ))
            )}
          </div>
          {onPageChange ? (
            <div className="company-lot-pagination">
              <span>
                共 {total} 个批次 · {page} / {pages}
              </span>
              <button
                type="button"
                className="crm-btn"
                disabled={page <= 1 || loading}
                onClick={() => onPageChange(page - 1)}
              >
                上一页
              </button>
              <button
                type="button"
                className="crm-btn"
                disabled={page >= pages || loading}
                onClick={() => onPageChange(page + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
