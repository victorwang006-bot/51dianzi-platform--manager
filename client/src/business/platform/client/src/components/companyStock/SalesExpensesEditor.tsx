import { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "./useCompanyStockSession";
import { expenseInput, requestId, serverMoney } from "./companyStockSales";
import type {
  SalesOrderExpensesInput,
  SalesExpenseEvent,
} from "../../../../shared/crmSalesOrders";

export function SalesExpensesEditor(
  props: Parameters<typeof SalesExpensesSession>[0]
) {
  const scope = useCompanyStockScope();
  return (
    <SalesExpensesSession
      key={`${scope.identityKey}:${props.orderId}`}
      {...props}
      enabled={props.enabled && scope.ready}
    />
  );
}
function SalesExpensesSession({
  orderId,
  version,
  amount: savedAmount,
  history = [],
  enabled,
  onSaved,
  onDirtyChange,
}: {
  orderId: number;
  version: number;
  amount?: string;
  history?: SalesExpenseEvent[];
  enabled: boolean;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const session = useCompanyStockSession(enabled);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(savedAmount ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState<SalesOrderExpensesInput | null>(
    null
  );
  const keys = useRef(new Map<string, string>());
  const busy = useRef(false);
  const mutation = trpc.crmSalesOrder.updateSalesExpenses.useMutation({
    onSuccess: () => {
      if (!session.isWritable()) return;
      setEditing(false);
      setNote("");
      setUncertain(null);
      setError("");
      keys.current.clear();
      onSaved();
    },
    onError: failure => {
      if (!session.isWritable()) return;
      setError(failure.message || "费用保存结果未确认，请重试原请求");
      if (
        [
          "BAD_REQUEST",
          "FORBIDDEN",
          "UNAUTHORIZED",
          "NOT_FOUND",
          "CONFLICT",
        ].includes(failure.data?.code ?? "")
      )
        setUncertain(null);
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  useEffect(() => {
    if (!editing) setAmount(savedAmount ?? "");
  }, [savedAmount, editing]);
  const dirty = Boolean(
    editing &&
      (amount !== (savedAmount ?? "") ||
        note ||
        uncertain ||
        mutation.isPending)
  );
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const submit = () => {
    if (!session.isWritable() || busy.current) return;
    try {
      const payload = uncertain ?? {
        id: orderId,
        version,
        requestId: "",
        ...expenseInput(amount, note),
      };
      if (!uncertain) {
        const key = JSON.stringify({ ...payload, requestId: undefined });
        if (!keys.current.has(key)) keys.current.set(key, requestId());
        payload.requestId = keys.current.get(key)!;
      }
      setUncertain(payload);
      setError("");
      busy.current = true;
      mutation.mutate(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "费用无效");
    }
  };
  const cancel = () => {
    if (
      mutation.isPending ||
      (dirty && !window.confirm("费用尚未保存，确认放弃？"))
    )
      return;
    setEditing(false);
    setNote("");
    setUncertain(null);
    setError("");
  };
  return (
    <details className="crm-sales-orders-fold">
      <summary>销售费用 {serverMoney(savedAmount)}</summary>
      {enabled && !editing ? (
        <button
          type="button"
          className="crm-btn"
          onClick={() => setEditing(true)}
        >
          填写 / 修改费用
        </button>
      ) : null}
      {editing ? (
        <>
          <div className="sales-expenses-editor">
            <input
              className="crm-input numeric"
              aria-label="本单销售费用金额"
              inputMode="decimal"
              value={amount}
              disabled={!enabled || mutation.isPending || Boolean(uncertain)}
              onChange={e => setAmount(e.target.value)}
            />
            <textarea
              className="crm-input"
              aria-label="本单销售费用说明"
              placeholder="费用说明（必填）"
              maxLength={500}
              disabled={!enabled || mutation.isPending || Boolean(uncertain)}
              value={note}
              onChange={e => setNote(e.target.value)}
            />
            <button
              type="button"
              className="crm-btn"
              disabled={mutation.isPending}
              onClick={cancel}
            >
              取消
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              disabled={!enabled || mutation.isPending}
              onClick={submit}
            >
              {mutation.isPending
                ? "保存中…"
                : uncertain
                  ? "确认保存结果"
                  : "保存费用"}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-red-600">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
      {history.map(event => (
        <div key={event.id} className="admin-cell-secondary">
          {event.createdAt} · {serverMoney(event.previousAmount)} →{" "}
          {serverMoney(event.amount)} · {event.note}
        </div>
      ))}
    </details>
  );
}
