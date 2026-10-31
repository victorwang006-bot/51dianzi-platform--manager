import { useCallback, useMemo, useRef, useState } from "react";
import { trpc } from "../../../../api/business-trpc";
import {
  INVENTORY_SIMPLE_IMPORT_POLICY_VERSION,
  prepareSimplifiedInventoryImportRows,
  type SimplifiedImportPreparedRows,
  type SimplifiedInventoryColumnMapping,
  type SimplifiedInventoryImportRow,
  type SimplifiedImportRawDisplaySnapshot,
} from "../lib/simplifiedInventoryImport";
import type {
  InventoryRejectedImportRow,
} from "../lib/inventoryExcelMapping";
import type { InventoryImportFixedValues } from "../../../shared/inventoryUploadLimits";
import { splitInventoryPreviewRowsByUtf8 } from "../lib/inventoryImportUploadPlan";

export type InventoryPreviewAction = "new" | "update" | "conflict";
export type InventoryPreviewItem = {
  sourceRowNumber: number;
  action: InventoryPreviewAction;
  expectedFingerprint: string;
  reason?: string;
};

export type SimplifiedInventoryStageRow = SimplifiedInventoryImportRow & {
  preserveBlankFields: true;
  clearFields: string[];
  importPolicyVersion: typeof INVENTORY_SIMPLE_IMPORT_POLICY_VERSION;
  expectedFingerprint: string;
};

type SimplifiedInventoryPreviewRequestRow = Omit<
  SimplifiedInventoryStageRow,
  "expectedFingerprint" | "sourceRowNumber"
> & {
  sourceRowNumber: number;
};

export type SimplifiedImportSubmissionPayload = {
  /** Version-guarded, valid rows. */
  validRows: SimplifiedInventoryStageRow[];
  /** Original values plus validationError, including preview conflicts. */
  rejectedRows: InventoryRejectedImportRow[];
  /** Both groups, in original Excel row order, for stageBatch. */
  payloadRows: (SimplifiedInventoryStageRow | InventoryRejectedImportRow)[];
  summary: { newRows: number; updateRows: number; conflictRows: number };
  normalizedCount: number;
};

export type SimplifiedPreviewRunResult =
  | { ok: true; payload: SimplifiedImportSubmissionPayload }
  | { ok: false; error: string };

type UseSimplifiedInventoryImportArgs = {
  rawRows: readonly (readonly unknown[])[];
  headers: readonly string[];
  mapping: SimplifiedInventoryColumnMapping;
  fixedValues: InventoryImportFixedValues;
  taxIncluded: boolean;
  sourceRowNumbers?: readonly number[];
};

function hasExpectedFingerprint(
  action: InventoryPreviewAction,
  value: unknown,
): value is string {
  return action === "new"
    ? value === "new"
    : typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function readPreviewItems(value: unknown, expectedRows: readonly SimplifiedInventoryPreviewRequestRow[]) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) {
    throw new Error("预览返回不完整，请直接重试上传；不会提交库存");
  }
  const items = (value as { items: unknown[] }).items;
  if (items.length !== expectedRows.length) {
    throw new Error("预览返回不完整，请直接重试上传；不会提交库存");
  }
  const expectedSourceNumbers = new Set(expectedRows.map(row => row.sourceRowNumber));
  const parsed: InventoryPreviewItem[] = [];
  for (const raw of items) {
    const item = raw as Partial<InventoryPreviewItem>;
    if (
      typeof item.sourceRowNumber !== "number" ||
      !expectedSourceNumbers.delete(item.sourceRowNumber) ||
      !["new", "update", "conflict"].includes(item.action ?? "")
    ) {
      throw new Error("预览行标识或数据版本异常，请直接重试上传；不会提交库存");
    }
    const action = item.action as InventoryPreviewAction;
    if (!hasExpectedFingerprint(action, item.expectedFingerprint)) {
      throw new Error("预览行标识或数据版本异常，请直接重试上传；不会提交库存");
    }
    parsed.push({
      sourceRowNumber: item.sourceRowNumber,
      action,
      expectedFingerprint: item.expectedFingerprint,
      reason: typeof item.reason === "string" ? item.reason : undefined,
    });
  }
  if (expectedSourceNumbers.size > 0) {
    throw new Error("预览缺少部分行，请直接重试上传；不会提交库存");
  }
  return parsed;
}

function conflictRejectedRow(
  rawDisplay: SimplifiedImportRawDisplaySnapshot,
  reason: string,
): InventoryRejectedImportRow & { qtyStock?: string } {
  return {
    ...rawDisplay,
    validationError: reason.slice(0, 255),
  };
}

/** Exported for isolated regression: no React state or network is involved. */
export function buildSimplifiedPreviewPayload(
  prepared: SimplifiedImportPreparedRows,
  previewItems: readonly InventoryPreviewItem[],
): SimplifiedImportSubmissionPayload {
  const previewByRow = new Map(
    previewItems.map(item => [item.sourceRowNumber, item]),
  );
  const summary = { newRows: 0, updateRows: 0, conflictRows: 0 };
  const validRows: SimplifiedInventoryStageRow[] = [];
  const rejectedByRow = new Map(
    prepared.rejectedRows.map(row => [row.sourceRowNumber, row]),
  );

  for (const row of prepared.rows) {
    const preview = previewByRow.get(row.sourceRowNumber ?? 0);
    if (!preview) {
      throw new Error("预览缺少部分行，请直接重试上传；不会提交库存");
    }
    if (preview.action === "conflict") {
      summary.conflictRows += 1;
      const sourceRowNumber = row.sourceRowNumber ?? 0;
      const rawDisplay = prepared.rawDisplayBySourceRow.get(sourceRowNumber);
      if (!rawDisplay) {
        throw new Error("预览冲突缺少原始显示行，请直接重试上传；不会提交库存");
      }
      rejectedByRow.set(
        sourceRowNumber,
        conflictRejectedRow(
          rawDisplay,
          preview.reason || "当前库存匹配冲突，已保留到待发布",
        ),
      );
      continue;
    }
    if (!hasExpectedFingerprint(preview.action, preview.expectedFingerprint)) {
      throw new Error("预览缺少数据版本，请直接重试上传；不会提交库存");
    }
    if (preview.action === "new") summary.newRows += 1;
    else summary.updateRows += 1;
    validRows.push({
      ...row,
      // Do not remove this V3 protection even though the preview is invisible.
      preserveBlankFields: true,
      clearFields: [],
      importPolicyVersion: INVENTORY_SIMPLE_IMPORT_POLICY_VERSION,
      expectedFingerprint: preview.expectedFingerprint,
    });
  }

  const rejectedRows = Array.from(rejectedByRow.values()).sort(
    (left, right) => left.sourceRowNumber - right.sourceRowNumber,
  );
  const payloadRows = [...validRows, ...rejectedRows].sort(
    (left, right) => (left.sourceRowNumber ?? 0) - (right.sourceRowNumber ?? 0),
  );
  return {
    validRows,
    rejectedRows,
    payloadRows,
    summary,
    normalizedCount: prepared.normalizedCount,
  };
}

/**
 * A lightweight UI-facing workflow. `runPreview` always returns the exact
 * payload it constructed, so callers can stage it immediately instead of
 * reading a potentially stale React state value after await.
 */
export function useSimplifiedInventoryImport(args: UseSimplifiedInventoryImportArgs) {
  const previewMutation = trpc.importInventory.previewRows.useMutation();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewProgress, setPreviewProgress] = useState(0);
  const runIdRef = useRef(0);

  const prepared = useMemo(
    () =>
      prepareSimplifiedInventoryImportRows({
        rawRows: args.rawRows,
        headers: args.headers,
        mapping: args.mapping,
        fixedValues: args.fixedValues,
        taxIncluded: args.taxIncluded,
        sourceRowNumbers: args.sourceRowNumbers,
      }),
    [
      args.fixedValues,
      args.headers,
      args.mapping,
      args.rawRows,
      args.sourceRowNumbers,
      args.taxIncluded,
    ],
  );
  const inputSignature = useMemo(
    () =>
      JSON.stringify({
        headers: args.headers,
        mapping: args.mapping,
        fixedValues: args.fixedValues,
        taxIncluded: args.taxIncluded,
        rows: prepared.payloadRows,
      }),
    [args.fixedValues, args.headers, args.mapping, args.taxIncluded, prepared.payloadRows],
  );
  const signatureRef = useRef(inputSignature);
  signatureRef.current = inputSignature;

  const runPreview = useCallback(async (): Promise<SimplifiedPreviewRunResult> => {
    if (args.headers.length === 0 || prepared.payloadRows.length === 0) {
      return { ok: false, error: "请先选择包含数据的 Excel 文件" };
    }
    const thisSignature = inputSignature;
    const thisRun = ++runIdRef.current;
    setPreviewBusy(true);
    setPreviewError("");
    setPreviewProgress(0);
    try {
      // All-local problem rows still create a task so their raw values and
      // validationError are saved to the unified pending-publish workflow.
      if (prepared.rows.length === 0) {
        const payload = buildSimplifiedPreviewPayload(prepared, []);
        return { ok: true, payload };
      }
      const items: InventoryPreviewItem[] = [];
      let completed = 0;
      const previewRows: SimplifiedInventoryPreviewRequestRow[] = prepared.rows.map(row => {
        const sourceRowNumber = row.sourceRowNumber;
        if (
          typeof sourceRowNumber !== "number"
          || !Number.isSafeInteger(sourceRowNumber)
          || sourceRowNumber < 2
        ) {
          throw new Error("预览行号无效，请重新选择 Excel 文件");
        }
        return {
          ...row,
          sourceRowNumber,
          preserveBlankFields: true,
          clearFields: [],
          importPolicyVersion: INVENTORY_SIMPLE_IMPORT_POLICY_VERSION,
          // The server receives no client-created fingerprint on preview.
        };
      });
      for (const chunk of splitInventoryPreviewRowsByUtf8(
        previewRows,
      )) {
        const response = await previewMutation.mutateAsync({ rows: chunk });
        if (runIdRef.current !== thisRun || signatureRef.current !== thisSignature) {
          return { ok: false, error: "文件或表头已变化，请再次点击上传" };
        }
        items.push(...readPreviewItems(response, chunk));
        completed += chunk.length;
        setPreviewProgress(completed);
      }
      const payload = buildSimplifiedPreviewPayload(prepared, items);
      return { ok: true, payload };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "后台预览失败，请直接重试上传；不会提交库存";
      if (runIdRef.current === thisRun) setPreviewError(message);
      return { ok: false, error: message };
    } finally {
      if (runIdRef.current === thisRun) setPreviewBusy(false);
    }
  }, [args.headers.length, inputSignature, prepared, previewMutation]);

  return {
    prepared,
    previewBusy: previewBusy || previewMutation.isPending,
    previewError,
    previewProgress,
    runPreview,
  };
}
