import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { InventoryConfirmation } from "./ChannelInventoryManagementPanel";
import { inventoryDefinitiveFailure, inventoryError, inventoryRequestId, type InventoryContext } from "./management";
import type { PublishFactoryMaterialInput, PublishFactoryMaterialResult } from "../../../../shared/channelFactoryPublication";

export type FactoryMaterialPublishInput = PublishFactoryMaterialInput;
export type FactoryMaterialPublishResult = PublishFactoryMaterialResult;
export type FactoryMaterialPublishRow = {
  id: number; revision: number; partNumber: string; brand: string;
  qty: number | null; price: string | null;
  // Missing server evidence fails closed; neither canEdit nor ownership is proof.
  canPublish?: boolean;
  publicationStatus?: "unpublished" | "published";
};
type PublishProps = {
  rows: readonly FactoryMaterialPublishRow[];
  context?: InventoryContext;
  scopeKey: string;
  authorized: boolean;
  available: boolean;
  proofReady: boolean;
  proofVersion?: number;
  isCurrent: () => boolean;
  onComplete: () => Promise<unknown>;
  onAuthorizationError: (error: unknown) => void;
};

export function factoryMaterialPublishDisabledReason(row: FactoryMaterialPublishRow, authorized: boolean) {
  if (row.publicationStatus === "published") return "该材料已发布";
  if (!authorized || row.canPublish !== true || row.publicationStatus !== "unpublished") return "当前账号没有该材料的发布权限";
  if (!Number.isSafeInteger(row.id) || row.id <= 0 || !Number.isSafeInteger(row.revision) || row.revision <= 0) return "材料版本无效，请刷新后重试";
  if (!row.partNumber.normalize("NFKC").trim() || !row.brand.trim()) return "请先补全有效型号和品牌";
  if (row.qty === null || !Number.isSafeInteger(row.qty) || row.qty <= 0 || row.qty > 2_147_483_647) return "请先填写有效的正整数可供数量";
  return undefined;
}

/** Decimal text is preserved; zero, negative and malformed prices are not public. */
export function factoryMaterialPublicPrice(price: string | null) {
  if (price === null || !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(price) || !/[1-9]/.test(price)) return undefined;
  return price;
}

/** One dialog per Host, not per row: an uncertain write retains its original snapshot. */
export function useFactoryMaterialPublish(props: PublishProps) {
  const authorityKey = JSON.stringify([props.scopeKey, props.context?.expectedEnterpriseId, props.context?.expectedActorUserId]);
  const [session, setSession] = useState<{ scopeKey: string; row: FactoryMaterialPublishRow } | null>(null);
  const [receipt, setReceipt] = useState<{ scopeKey: string; proofVersion?: number; result: FactoryMaterialPublishResult } | null>(null);
  const latest = useRef(props); latest.current = props;
  const active = session?.scopeKey === authorityKey && props.authorized && props.available && props.context ? session : null;
  const liveRow = active ? props.rows.find(row => row.id === active.row.id) : undefined;
  // A pending query is not a revocation. A fresh server denial is.
  const permissionRevoked = Boolean(active && props.proofReady && (!liveRow || liveRow.canPublish !== true));
  useEffect(() => {
    if (!active || permissionRevoked) setSession(null);
    if (receipt?.scopeKey !== authorityKey) setReceipt(null);
  }, [authorityKey, props.authorized, props.available, permissionRevoked, receipt?.scopeKey]);
  const current = () => JSON.stringify([latest.current.scopeKey, latest.current.context?.expectedEnterpriseId, latest.current.context?.expectedActorUserId]) === authorityKey
    && latest.current.available && latest.current.authorized && latest.current.isCurrent()
    && (!active || !latest.current.proofReady || latest.current.rows.some(row => row.id === active.row.id && row.canPublish === true));
  const action = (row: FactoryMaterialPublishRow) => {
    const published = row.publicationStatus === "published" || (receipt?.scopeKey === authorityKey && receipt.result.materialId === row.id
      && receipt.result.revision === row.revision && receipt.proofVersion === props.proofVersion);
    const reason = published ? "该材料已发布" : factoryMaterialPublishDisabledReason(row, props.authorized);
    return <button type="button" className="ci-inline-link" data-factory-publish-action disabled={Boolean(reason) || !props.available || !props.context || Boolean(active)} title={reason} onClick={() => {
      if (!current() || reason || !props.context) return;
      // Explicit allow-list: source/contact/internal-note data never enter the dialog.
      setSession({ scopeKey: authorityKey, row: { id: row.id, revision: row.revision, partNumber: row.partNumber, brand: row.brand,
        qty: row.qty, price: row.price, canPublish: row.canPublish, publicationStatus: row.publicationStatus } });
    }}>{published ? "已发布" : "发布"}</button>;
  };
  return {
    action,
    dialog: active && !permissionRevoked ? <FactoryMaterialPublishConfirmation key={`${active.scopeKey}:${active.row.id}`} row={active.row} context={props.context!} isCurrent={current}
      onCancel={() => setSession(null)} onAuthorizationError={props.onAuthorizationError} onPublished={result => {
        if (!current()) return;
        setReceipt({ scopeKey: authorityKey, proofVersion: props.proofVersion, result }); setSession(null);
        void props.onComplete();
      }} /> : null,
  };
}

type ConfirmationProps = {
  row: FactoryMaterialPublishRow; context: InventoryContext;
  isCurrent: () => boolean; onCancel: () => void;
  onPublished: (result: FactoryMaterialPublishResult) => void;
  onAuthorizationError: (error: unknown) => void;
};
/** Only mounted after the first click, so legacy transport mocks need no new hook. */
export function FactoryMaterialPublishConfirmation(props: ConfirmationProps) {
  const mutation = trpc.channelInventory.publishFactoryMaterial.useMutation();
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const frozen = useRef<FactoryMaterialPublishInput | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props); latest.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; frozen.current = null; }; }, []);
  const current = () => mounted.current && latest.current.isCurrent();
  const confirm = async () => {
    if (!current() || busyRef.current || factoryMaterialPublishDisabledReason(props.row, true)) return;
    frozen.current ??= { materialId: props.row.id, expectedRevision: props.row.revision, requestId: inventoryRequestId(),
      expectedEnterpriseId: props.context.expectedEnterpriseId, expectedActorUserId: props.context.expectedActorUserId };
    const payload = frozen.current;
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      const result = await mutation.mutateAsync(payload);
      if (!current()) return;
      if (result.materialId !== payload.materialId || result.status !== "published" || typeof result.publicId !== "string" || !/^ocp_[a-f0-9]{32}$/.test(result.publicId)
        || !Number.isSafeInteger(result.revision) || result.revision !== payload.expectedRevision) throw new Error("发布返回结果无效，尚未确认发布成功。");
      frozen.current = null;
      props.onPublished(result);
    } catch (error) {
      if (!current()) return;
      // Preserve UUID/CAS until cancellation. Definite rejection may close/reconfirm;
      // uncertain commits and malformed receipts must retry the exact original request.
      setLocked(!inventoryDefinitiveFailure(error)); setMessage(inventoryError(error, "发布结果尚未确认。"));
      props.onAuthorizationError(error);
    } finally { busyRef.current = false; if (current()) setBusy(false); }
  };
  const price = factoryMaterialPublicPrice(props.row.price);
  return <InventoryConfirmation title="确认发布材料" busy={busy} locked={locked} onCancel={props.onCancel} onConfirm={() => void confirm()} confirmLabel="确认发布">
    <p>以下材料将公开展示。不会公开渠道来源、联系人或内部备注。</p>
    <dl className="ci-publish-preview">
      <div><dt>型号</dt><dd>{props.row.partNumber}</dd></div>
      <div><dt>品牌</dt><dd>{props.row.brand}</dd></div>
      <div><dt>可供数量</dt><dd>{props.row.qty?.toLocaleString("zh-CN")}</dd></div>
      {price ? <div><dt>报价 CNY</dt><dd>¥{price}</dd></div> : null}
    </dl>
    {message ? <p className="ci-error" role="alert">{message}</p> : null}
  </InventoryConfirmation>;
}
