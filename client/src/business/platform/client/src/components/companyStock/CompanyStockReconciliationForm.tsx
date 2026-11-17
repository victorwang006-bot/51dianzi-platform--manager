import { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "./useCompanyStockSession";
import {
  companyStockReconcileSchema,
  type CompanyStockReconciliationCandidate,
  type CompanyStockReconcileInput,
} from "../../../../shared/companyStock";
import { requestId } from "./companyStockSales";

export function CompanyStockReconciliationForm(
  props: Parameters<typeof CompanyStockReconciliationSession>[0]
) {
  const scope = useCompanyStockScope();
  return (
    <CompanyStockReconciliationSession
      key={`${scope.identityKey}:${props.candidate.id}`}
      {...props}
      enabled={props.enabled && scope.ready}
    />
  );
}
function CompanyStockReconciliationSession({
  candidate,
  enabled,
  onSaved,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: {
  candidate: CompanyStockReconciliationCandidate;
  enabled: boolean;
  onSaved: () => void;
  onCancel: () => void;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const session = useCompanyStockSession(enabled);
  const [remainingQty, setRemainingQty] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState<CompanyStockReconcileInput | null>(
    null
  );
  const keys = useRef(new Map<string, string>());
  const busy = useRef(false);
  const mutation = trpc.inbound.reconcileCompanyStock.useMutation({
    onSuccess: () => {
      if (session.isWritable()) onSaved();
    },
    onError: failure => {
      if (!session.isWritable()) return;
      setError(failure.message || "核对结果未确认，请重试原请求");
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
  const dirty = Boolean(
    remainingQty || reason || confirmed || uncertain || mutation.isPending
  );
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(mutation.isPending);
  }, [mutation.isPending, onBusyChange]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange]
  );
  const submit = () => {
    if (
      !session.isWritable() ||
      busy.current ||
      candidate.status !== "pending_reconciliation"
    )
      return;
    try {
      let payload = uncertain;
      if (!payload) {
        if (!/^\d+$/.test(remainingQty.trim()))
          throw new Error("请填写真实盘点剩余数量（可为0）");
        payload = companyStockReconcileSchema.parse({
          id: candidate.id,
          remainingQty: Number(remainingQty),
          reason: reason.trim(),
          ownershipConfirmed: confirmed,
          expectedMovementVersion: candidate.expectedMovementVersion,
          clientRequestId: requestId().replace(/_/g, "-").slice(0, 64),
        });
        const key = JSON.stringify({ ...payload, clientRequestId: undefined });
        if (!keys.current.has(key))
          keys.current.set(key, requestId().replace(/_/g, "-").slice(0, 64));
        payload.clientRequestId = keys.current.get(key)!;
      }
      setError("");
      setUncertain(payload);
      busy.current = true;
      mutation.mutate(payload);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "请检查盘点数量及说明"
      );
    }
  };
  const locked = !enabled || mutation.isPending || Boolean(uncertain);
  return (
    <div className="space-y-2">
      <p>
        {candidate.slipNo} · {candidate.partNumber} ·{" "}
        {[candidate.brand, candidate.pkg, candidate.dc, candidate.location]
          .filter(Boolean)
          .join(" / ")}
      </p>
      <p className="admin-cell-secondary">
        公司型号账 {candidate.currentQty} · 已核对批次剩余{" "}
        {candidate.assignedRemainingQty}
      </p>
      <label className="block">
        真实盘点剩余数量
        <input
          className="crm-input w-full"
          aria-label="真实盘点剩余数量"
          placeholder="不按原入库数量预填"
          inputMode="numeric"
          value={remainingQty}
          disabled={locked}
          onChange={e => setRemainingQty(e.target.value)}
        />
      </label>
      <label className="block">
        盘点与归属说明
        <textarea
          className="crm-input w-full"
          aria-label="盘点与归属说明"
          maxLength={500}
          value={reason}
          disabled={locked}
          onChange={e => setReason(e.target.value)}
        />
      </label>
      <label className="company-stock-toolbar">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={locked}
          onChange={e => setConfirmed(e.target.checked)}
        />
        已盘点并确认该批次剩余属于当前公司库存
      </label>
      <p className="admin-cell-secondary">
        只核对批次，不重复增加库存账或变更付款、财务归属。
      </p>
      {error ? (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="crm-btn"
          disabled={mutation.isPending}
          onClick={onCancel}
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
            ? "核对中…"
            : uncertain
              ? "确认核对结果"
              : "确认核对库存"}
        </button>
      </div>
    </div>
  );
}
