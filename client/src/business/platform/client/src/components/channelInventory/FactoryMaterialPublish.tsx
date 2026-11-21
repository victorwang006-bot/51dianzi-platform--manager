import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { InventoryConfirmation } from "./ChannelInventoryManagementPanel";
import {
  inventoryDefinitiveFailure,
  inventoryError,
  inventoryRequestId,
  type InventoryContext,
} from "./management";
import type {
  PublishFactoryMaterialInput,
  PublishFactoryMaterialResult,
} from "../../../../shared/channelFactoryPublication";
import { previewFactoryMaterialReceptionResultSchema } from "../../../../shared/channelFactoryPublication";

export type FactoryMaterialPublishInput = PublishFactoryMaterialInput;
export type FactoryMaterialPublishResult = PublishFactoryMaterialResult;
export type FactoryMaterialPublishRow = {
  id: number;
  revision: number;
  partNumber: string;
  brand: string;
  qty: number | null;
  price: string | null;
  // Missing server evidence fails closed; neither canEdit nor ownership is proof.
  canPublish?: boolean;
  publicationStatus?: "unpublished" | "published";
  reception?: {
    status: "ready" | "pending";
    recipientName: string | null;
    responsibilityVersion: number;
    reason?: string | null;
  };
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
  onAction?: (action: () => void) => void;
};

export function factoryMaterialPublishDisabledReason(
  row: FactoryMaterialPublishRow,
  authorized: boolean
) {
  if (row.publicationStatus === "published") return "该材料已发布";
  if (
    !authorized ||
    row.canPublish !== true ||
    row.publicationStatus !== "unpublished"
  )
    return "当前账号没有该材料的发布权限";
  if (
    !Number.isSafeInteger(row.id) ||
    row.id <= 0 ||
    !Number.isSafeInteger(row.revision) ||
    row.revision <= 0
  )
    return "材料版本无效，请刷新后重试";
  if (!row.partNumber.normalize("NFKC").trim() || !row.brand.trim())
    return "请先补全有效型号和品牌";
  if (
    row.qty === null ||
    !Number.isSafeInteger(row.qty) ||
    row.qty <= 0 ||
    row.qty > 2_147_483_647
  )
    return "请先填写有效的正整数可供数量";
  return undefined;
}

/** Display evidence only; never infer a recipient from factoryName or publish actor. */
export function factoryMaterialReceptionLabel(
  reception: FactoryMaterialPublishRow["reception"]
) {
  return reception?.status === "ready" &&
    typeof reception.recipientName === "string" &&
    reception.recipientName.trim() &&
    Number.isSafeInteger(reception.responsibilityVersion) &&
    reception.responsibilityVersion > 0
    ? `前台以51电子网工厂渠道接待展示，实际由${reception.recipientName.trim()}接待`
    : `前台以51电子网工厂渠道接待展示；接待待配置：${reception?.reason || "尚未核验可信企业、当前责任员工绑定与询价接待权限"}`;
}

/** Decimal text is preserved; zero, negative and malformed prices are not public. */
export function factoryMaterialPublicPrice(price: string | null) {
  if (
    price === null ||
    !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(price) ||
    !/[1-9]/.test(price)
  )
    return undefined;
  return price;
}

/** One dialog per Host, not per row: an uncertain write retains its original snapshot. */
export function useFactoryMaterialPublish(props: PublishProps) {
  const authorityKey = JSON.stringify([
    props.scopeKey,
    props.context?.expectedEnterpriseId,
    props.context?.expectedActorUserId,
  ]);
  const [session, setSession] = useState<{
    scopeKey: string;
    row: FactoryMaterialPublishRow;
    mode: "publish" | "unpublish" | "preview";
  } | null>(null);
  const [receipt, setReceipt] = useState<{
    scopeKey: string;
    proofVersion?: number;
    result: FactoryMaterialPublishResult;
  } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const active =
    session?.scopeKey === authorityKey &&
    props.authorized &&
    props.available &&
    props.context
      ? session
      : null;
  const liveRow = active
    ? props.rows.find(row => row.id === active.row.id)
    : undefined;
  // A pending query is not a revocation. A fresh server denial is.
  const permissionRevoked = Boolean(
    active && props.proofReady && (!liveRow || liveRow.canPublish !== true)
  );
  useEffect(() => {
    if (!active || permissionRevoked) setSession(null);
    if (receipt?.scopeKey !== authorityKey) setReceipt(null);
  }, [
    authorityKey,
    props.authorized,
    props.available,
    permissionRevoked,
    receipt?.scopeKey,
  ]);
  const current = () =>
    JSON.stringify([
      latest.current.scopeKey,
      latest.current.context?.expectedEnterpriseId,
      latest.current.context?.expectedActorUserId,
    ]) === authorityKey &&
    latest.current.available &&
    latest.current.authorized &&
    latest.current.isCurrent() &&
    (!active ||
      !latest.current.proofReady ||
      latest.current.rows.some(
        row => row.id === active.row.id && row.canPublish === true
      ));
  const open = (row: FactoryMaterialPublishRow, mode: "publish" | "unpublish" | "preview") => {
    if (!current() || !props.context || row.canPublish !== true) return;
    // A list hint is never reception evidence. Query only after selecting a row.
    const action = () => {
      if (!current() || !latest.current.proofReady || !latest.current.rows.some(item => item.id === row.id && item.revision === row.revision && item.canPublish === true)) return;
      setSession({ scopeKey: authorityKey, mode, row: {
        id: row.id, revision: row.revision, partNumber: row.partNumber,
        brand: row.brand, qty: row.qty, price: row.price,
        canPublish: row.canPublish, publicationStatus: row.publicationStatus,
      } });
    };
    props.onAction ? props.onAction(action) : action();
  };
  const status = (row: FactoryMaterialPublishRow) => {
    return receipt?.scopeKey === authorityKey &&
        receipt.result.materialId === row.id &&
        receipt.result.revision === row.revision &&
        receipt.proofVersion === props.proofVersion
      ? receipt.result.status : row.publicationStatus;
  };
  const action = (row: FactoryMaterialPublishRow) => {
    const published = status(row) === "published";
    const reason = published
      ? !props.authorized || row.canPublish !== true ? "当前账号没有该材料的上下架权限" : undefined
      : factoryMaterialPublishDisabledReason(row, props.authorized);
    return (
      <React.Fragment>
      <button
        type="button"
        className="ci-inline-link"
        data-factory-publish-action
        disabled={
          Boolean(reason) ||
          !props.available ||
          !props.context ||
          Boolean(active)
        }
        title={reason}
        onClick={() => {
          if (!current() || reason || !props.context) return;
          open({ ...row, publicationStatus: published ? "published" : "unpublished" }, published ? "unpublish" : "publish");
        }}
      >
        {published ? "下架" : "上架"}
      </button>
      {published ? <a className="ci-inline-link" data-factory-view-front
        href={`https://51dianzi.com/search?q=${encodeURIComponent(row.partNumber)}&brand=${encodeURIComponent(row.brand)}`}
        target="_blank" rel="noopener noreferrer">查看前台</a> : null}
      </React.Fragment>
    );
  };
  const previewAction = (row: FactoryMaterialPublishRow) => status(row) === "published" && props.authorized && row.canPublish === true
    ? <button type="button" className="ci-inline-link" data-factory-reception-action
        disabled={!props.available || !props.context || Boolean(active)}
        onClick={() => open({ ...row, publicationStatus: "published" }, "preview")}>接待预览</button>
    : <React.Fragment />;
  return {
    action, previewAction, status,
    dialog:
      active && !permissionRevoked ? (
        <FactoryMaterialPublishConfirmation
          key={`${active.scopeKey}:${active.row.id}`}
          row={active.row}
          mode={active.mode}
          context={props.context!}
          isCurrent={current}
          onCancel={() => setSession(null)}
          onAuthorizationError={props.onAuthorizationError}
          onPublished={result => {
            if (!current()) return;
            setReceipt({
              scopeKey: authorityKey,
              proofVersion: props.proofVersion,
              result,
            });
            setSession(null);
            void props.onComplete();
          }}
        />
      ) : null,
  };
}

type ConfirmationProps = {
  row: FactoryMaterialPublishRow;
  mode?: "publish" | "unpublish" | "preview";
  context: InventoryContext;
  isCurrent: () => boolean;
  onCancel: () => void;
  onPublished: (result: FactoryMaterialPublishResult) => void;
  onAuthorizationError: (error: unknown) => void;
};
/** Only mounted after the first click, so legacy transport mocks need no new hook. */
export function FactoryMaterialPublishConfirmation(props: ConfirmationProps) {
  const mutation = trpc.channelInventory.publishFactoryMaterial.useMutation();
  const preview = trpc.channelInventory.previewFactoryMaterialReception.useQuery({
    materialId: props.row.id, expectedRevision: props.row.revision,
    expectedEnterpriseId: props.context.expectedEnterpriseId,
    expectedActorUserId: props.context.expectedActorUserId,
  }, { staleTime: 0, gcTime: 0, refetchOnMount: "always", refetchOnWindowFocus: false,
    retry: false, trpc: { abortOnUnmount: true } });
  const evidence = previewFactoryMaterialReceptionResultSchema.safeParse(preview.data);
  const previewVerified = !preview.isFetching && !preview.error && evidence.success;
  const mode = props.mode ?? (props.row.publicationStatus === "published" ? "preview" : "publish");
  const readOnly = mode === "preview";
  const unpublish = mode === "unpublish";
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const frozen = useRef<FactoryMaterialPublishInput | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      frozen.current = null;
    };
  }, []);
  const current = () => mounted.current && latest.current.isCurrent();
  const confirm = async () => {
    if (
      !current() ||
      busyRef.current ||
      readOnly ||
      (!unpublish && !previewVerified && !locked) ||
      (!unpublish && factoryMaterialPublishDisabledReason(props.row, true)) ||
      (unpublish && (!props.row.canPublish || props.row.publicationStatus !== "published" || !Number.isSafeInteger(props.row.revision) || props.row.revision <= 0))
    )
      return;
    frozen.current ??= {
      materialId: props.row.id,
      expectedRevision: props.row.revision,
      requestId: inventoryRequestId(),
      expectedEnterpriseId: props.context.expectedEnterpriseId,
      expectedActorUserId: props.context.expectedActorUserId,
      ...(unpublish ? { published: false } : {}),
    };
    const payload = frozen.current;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await mutation.mutateAsync(payload);
      if (!current()) return;
      if (
        result.materialId !== payload.materialId ||
        result.status !== (payload.published === false ? "unpublished" : "published") ||
        typeof result.publicId !== "string" ||
        !/^ocp_[a-f0-9]{32}$/.test(result.publicId) ||
        !Number.isSafeInteger(result.revision) ||
        result.revision !== payload.expectedRevision
      )
        throw new Error("上下架返回结果无效，尚未确认操作成功。");
      frozen.current = null;
      props.onPublished(result);
    } catch (error) {
      if (!current()) return;
      // Preserve UUID/CAS until cancellation. Definite rejection may close/reconfirm;
      // uncertain commits and malformed receipts must retry the exact original request.
      setLocked(!inventoryDefinitiveFailure(error));
      setMessage(inventoryError(error, "发布结果尚未确认。"));
      props.onAuthorizationError(error);
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  };
  const price = factoryMaterialPublicPrice(props.row.price);
  return (
    <InventoryConfirmation
      title={readOnly ? "材料接待预览" : unpublish ? "确认下架材料" : "确认上架材料"}
      busy={busy}
      locked={locked}
      disabled={!readOnly && !unpublish && !previewVerified && !locked}
      onCancel={props.onCancel}
      onConfirm={() => { if (readOnly) props.onCancel(); else void confirm(); }}
      confirmLabel={readOnly ? "关闭" : unpublish ? "确认下架" : "确认上架"}
    >
      <p>{unpublish ? "下架后，以下材料不再展示在前台渠道库存；原库存、上传文件和历史询价保留。" : readOnly ? "以下材料已公开展示。" : "以下材料将公开展示。"}不会公开渠道来源、联系人或内部备注。</p>
      <p data-factory-reception-preview>
        {preview.isFetching
          ? "51电子网工厂渠道接待：正在核验当前实际接待员工…"
          : factoryMaterialReceptionLabel(previewVerified && evidence.success ? evidence.data.reception : undefined)}
      </p>
      {preview.error || (!preview.isFetching && !evidence.success) ? (
        <p className="ci-error" role="alert">接待证据未能核验，请关闭后重试；不能据此确认询价可投递。</p>
      ) : null}
      <p>
        品牌不改变真实卖方企业；管理员代操作不会成为接待人。缺少接待配置时仅可展示，前台询价不显示投递成功；已有分工与旧询价不随发布改派。
      </p>
      {!readOnly ? <p>首次发布完成后请点击“接待预览”重新核验；发布成功不代表接待配置已完成，预览不会创建询价或更新发布内容。</p> : null}
      <dl className="ci-publish-preview">
        <div>
          <dt>型号</dt>
          <dd>{props.row.partNumber}</dd>
        </div>
        <div>
          <dt>品牌</dt>
          <dd>{props.row.brand}</dd>
        </div>
        <div>
          <dt>可供数量</dt>
          <dd>{props.row.qty?.toLocaleString("zh-CN")}</dd>
        </div>
        {price ? (
          <div>
            <dt>报价 CNY</dt>
            <dd>¥{price}</dd>
          </div>
        ) : null}
      </dl>
      {message ? (
        <p className="ci-error" role="alert">
          {message}
        </p>
      ) : null}
    </InventoryConfirmation>
  );
}
