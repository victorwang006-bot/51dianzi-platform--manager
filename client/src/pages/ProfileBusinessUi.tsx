import { Button } from "@/components/ui/button";
import { decimalAmount } from "./profileModel";
import "./ProfileBusiness.css";

export function BusinessAmount({ label, amount, note, unavailableLabel = "暂无数据" }: {
  label: string;
  amount: string | null;
  note: string;
  unavailableLabel?: string;
}) {
  return <div className="pc-stat"><span>{label}</span>
    <strong>{amount === null ? unavailableLabel : decimalAmount(amount)}</strong><small>{note}</small>
  </div>;
}

export function BusinessPagination({ label, page, pageSize, total, fetching, onPage }: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  fetching: boolean;
  onPage(page: number): void;
}) {
  return <div className="pc-pagination" aria-label={`${label}分页`}>
    <span>共 {total} 笔 · 第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页</span>
    <Button size="sm" variant="outline" aria-label={`${label}上一页`}
      disabled={page <= 1 || fetching} onClick={() => onPage(Math.max(1, page - 1))}>上一页</Button>
    <Button size="sm" variant="outline" aria-label={`${label}下一页`}
      disabled={page * pageSize >= total || fetching} onClick={() => onPage(page + 1)}>下一页</Button>
  </div>;
}

export function BusinessStatus({ children, pending = false }: {
  children: React.ReactNode;
  pending?: boolean;
}) {
  return <span className={`pc-business-status${pending ? " pc-business-status--pending" : ""}`}>{children}</span>;
}
