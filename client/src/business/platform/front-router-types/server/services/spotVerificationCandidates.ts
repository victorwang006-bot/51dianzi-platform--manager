import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { formatBeijingDateTime } from "../../../shared/beijingTime";
import {
  SPOT_VERIFICATION_VALID_DAYS,
  selectSpotInventoryCandidates,
  spotVerificationMatchFingerprint,
  spotVerificationSearchPartNumbers,
  spotVerificationRequiresExplicitSelection,
  type SpotInventoryMatch,
} from "../../../shared/spotInventoryVerification";
import { ENV } from "../_core/env";
import * as db from "../db";
import { storageDelete, storagePutPrivate } from "../storage";
import {
  HOURLY_LIMIT as LABEL_OCR_HOURLY_LIMIT,
  MATERIAL_LABEL_OCR_MODEL,
  MaterialLabelOcrError,
  isAcceptedSpotMarking,
  isMaterialLabelOcrAvailable,
  labelOcrRateLimited,
  recognizeMaterialLabel,
  refundLabelOcrQuota,
  type MaterialLabelOcrResult,
  type SpotMarkingSource,
} from "./materialLabelOcr";
import {
  SPOT_VERIFICATION_QUEUE_MESSAGE,
  queueSpotVerificationReview,
} from "./spotVerificationReview";
import {
  SpotVerificationSelectionTokenError,
  assertSpotVerificationSelectionTokenSecret,
  decodeSpotVerificationSelectionToken,
  encodeSpotVerificationSelectionToken,
  type SpotVerificationSelectionTokenPayload,
  type SpotVerificationSelectionTokenScope,
} from "../spotVerificationSelectionToken";

const MAX_INVENTORY_PHOTO_BYTES = 5 * 1024 * 1024;
const CANDIDATE_DB_LIMIT = 30;
const CANDIDATE_SELECTION_LIMIT = 5;

export type SpotStockVerificationScope = {
  dataOwnerUserId: number;
  enterpriseId: number;
  verifiedByUserId: number;
  /** Permission-scoped employees are restricted to this owner; admins pass undefined. */
  ownerUserId?: number;
};

export type PrepareSpotStockVerificationInput = {
  base64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  requestId: string;
};

export type ConfirmSpotStockVerificationInput = {
  token: string;
  inventoryId: number;
  base64: string;
  mimeType: PrepareSpotStockVerificationInput["mimeType"];
};

export type SpotInventoryCandidateRow = {
  id: number;
  partNumber: string;
  brand: string;
  dateCode: string | null;
  qtyOnSale: number;
  qtyStock: number;
  grade: string | null;
  source: string | null;
  warehouseAddress: string | null;
};

type ExistingVerificationRow = {
  inventoryId: number;
  inventoryPartNumber: string;
  recognizedPartNumber: string;
  matchRule: SpotInventoryMatch["rule"];
  verifiedAt: Date;
  expiresAt: Date;
  requestId: string;
  photoSha256: string;
  enterpriseId: number;
  verifiedByUserId: number;
};

type ExistingVerification =
  | { kind: "idempotent"; row: ExistingVerificationRow }
  | { kind: "request_conflict"; row: ExistingVerificationRow }
  | { kind: "duplicate_photo"; row: ExistingVerificationRow };

type CreateVerificationInput = {
  inventoryId: number;
  dataOwnerUserId: number;
  enterpriseId: number;
  verifiedByUserId: number;
  ownerUserId?: number;
  match: SpotInventoryMatch;
  photo: { key: string; sha256: string };
  requestId: string;
  modelName: string;
  verifiedAt: Date;
  expiresAt: Date;
  expectedFingerprint: string;
  expectedBrand: string;
  requireSelectedInventory: true;
  requireUniqueCandidate?: boolean;
};

type CreateVerificationResult =
  | {
      ok: true;
      idempotent: boolean;
      inventoryId: number;
      partNumber: string;
      recognizedPartNumber?: string;
      matchRule?: SpotInventoryMatch["rule"];
      verifiedAt: Date;
      expiresAt: Date;
    }
  | {
      ok: false;
      reason:
        | "database"
        | "inventory"
        | "inventory_changed"
        | "request_conflict"
        | "duplicate_photo";
    };

export type SpotVerificationDependencies = {
  cookieSecret: () => string;
  now: () => Date;
  isOcrAvailable: () => boolean;
  isOcrRateLimited: (dataOwnerUserId: number) => boolean;
  refundOcrQuota: (dataOwnerUserId: number) => void;
  recognize: (base64: string) => Promise<MaterialLabelOcrResult>;
  modelName: string;
  findVerification: (input: {
    enterpriseId: number;
    verifiedByUserId: number;
    requestId: string;
    photoSha256: string;
  }) => Promise<ExistingVerification | null>;
  listCandidateRows: (
    dataOwnerUserId: number,
    enterpriseId: number,
    ownerUserId: number | undefined,
    partNumbers: string[]
  ) => Promise<SpotInventoryCandidateRow[]>;
  putPrivate: (
    key: string,
    image: Buffer,
    mimeType: PrepareSpotStockVerificationInput["mimeType"]
  ) => Promise<{ key: string }>;
  deletePrivate: (key: string) => Promise<unknown>;
  queueReview: (input: {
    enterpriseId: number;
    dataOwnerUserId: number;
    submittedByUserId: number;
    inventoryId?: number | null;
    recognizedPartNumber: string;
    inventoryPartNumber?: string | null;
    markingSource: SpotMarkingSource;
    photoKey: string;
    photoSha256: string;
    requestId: string;
  }) => Promise<{ queued: true; reviewId: number; partNumber: string }>;
  createVerification: (
    input: CreateVerificationInput
  ) => Promise<CreateVerificationResult>;
};

const defaultDependencies: SpotVerificationDependencies = {
  cookieSecret: () => ENV.cookieSecret,
  now: () => new Date(),
  isOcrAvailable: isMaterialLabelOcrAvailable,
  isOcrRateLimited: labelOcrRateLimited,
  refundOcrQuota: refundLabelOcrQuota,
  recognize: recognizeMaterialLabel,
  modelName: MATERIAL_LABEL_OCR_MODEL,
  findVerification: input =>
    db.findSpotInventoryVerification(
      input
    ) as Promise<ExistingVerification | null>,
  listCandidateRows: (
    dataOwnerUserId,
    enterpriseId,
    ownerUserId,
    partNumbers
  ) =>
    db.listSpotInventoryCandidateRows(
      dataOwnerUserId,
      enterpriseId,
      ownerUserId,
      partNumbers
    ) as Promise<SpotInventoryCandidateRow[]>,
  putPrivate: storagePutPrivate,
  deletePrivate: storageDelete,
  queueReview: queueSpotVerificationReview,
  createVerification: input =>
    db.createSpotInventoryVerification(
      input
    ) as Promise<CreateVerificationResult>,
};

function fail(code: TRPCError["code"], message: string): never {
  throw new TRPCError({ code, message });
}

function invalidScope(scope: SpotStockVerificationScope): boolean {
  return (
    [scope.dataOwnerUserId, scope.enterpriseId, scope.verifiedByUserId].some(
      value => !Number.isSafeInteger(value) || value <= 0
    ) ||
    (scope.ownerUserId !== undefined &&
      (!Number.isSafeInteger(scope.ownerUserId) || scope.ownerUserId <= 0))
  );
}

function assertScope(scope: SpotStockVerificationScope): void {
  if (invalidScope(scope)) fail("FORBIDDEN", "核验权限已失效，请重新进入页面");
}

function tokenScope(
  scope: SpotStockVerificationScope
): SpotVerificationSelectionTokenScope {
  return {
    dataOwnerUserId: scope.dataOwnerUserId,
    enterpriseId: scope.enterpriseId,
    verifiedByUserId: scope.verifiedByUserId,
    ownerUserId: scope.ownerUserId ?? null,
  };
}

function sameScope(
  expected: SpotVerificationSelectionTokenScope,
  actual: SpotStockVerificationScope
): boolean {
  const current = tokenScope(actual);
  return (
    expected.dataOwnerUserId === current.dataOwnerUserId &&
    expected.enterpriseId === current.enterpriseId &&
    expected.verifiedByUserId === current.verifiedByUserId &&
    expected.ownerUserId === current.ownerUserId
  );
}

function assertPrepareInput(
  input: PrepareSpotStockVerificationInput,
  image: Buffer
): void {
  if (
    !input ||
    typeof input.base64 !== "string" ||
    !input.base64.length ||
    input.base64.length > Math.ceil(MAX_INVENTORY_PHOTO_BYTES * 1.4) + 128 ||
    !["image/jpeg", "image/png", "image/webp"].includes(input.mimeType) ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(input.requestId) ||
    !Buffer.isBuffer(image) ||
    image.length === 0 ||
    image.length > MAX_INVENTORY_PHOTO_BYTES
  ) {
    fail("BAD_REQUEST", "核验照片参数无效");
  }
}

function assertConfirmInput(
  input: ConfirmSpotStockVerificationInput,
  image: Buffer
): void {
  if (
    !input ||
    typeof input.token !== "string" ||
    !Number.isSafeInteger(input.inventoryId) ||
    typeof input.base64 !== "string" ||
    !input.base64.length ||
    input.base64.length > Math.ceil(MAX_INVENTORY_PHOTO_BYTES * 1.4) + 128 ||
    !["image/jpeg", "image/png", "image/webp"].includes(input.mimeType) ||
    !Buffer.isBuffer(image) ||
    image.length === 0 ||
    image.length > MAX_INVENTORY_PHOTO_BYTES
  ) {
    fail("BAD_REQUEST", "核验选择参数无效");
  }
}

function asSha256(image: Buffer): string {
  return createHash("sha256").update(image).digest("hex");
}

function assertConfirmedPhoto(
  payload: SpotVerificationSelectionTokenPayload,
  image: Buffer,
  mimeType: PrepareSpotStockVerificationInput["mimeType"]
): void {
  if (
    !Buffer.isBuffer(image) ||
    image.length === 0 ||
    image.length > MAX_INVENTORY_PHOTO_BYTES ||
    mimeType !== payload.mimeType ||
    asSha256(image) !== payload.photoSha256
  ) {
    fail("CONFLICT", "核验照片与本次选择不一致，请重新拍摄");
  }
}

function canonicalPhotoKey(
  photoSha256: string,
  mimeType: PrepareSpotStockVerificationInput["mimeType"]
): string {
  const extension =
    mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return `inventory-spot-verifications/${photoSha256}.${extension}`;
}

function successResponse(input: {
  inventoryId: number;
  partNumber: string;
  recognizedPartNumber: string;
  matchRule: SpotInventoryMatch["rule"];
  verifiedAt: Date;
  expiresAt: Date;
}) {
  return {
    success: true as const,
    inventoryId: input.inventoryId,
    partNumber: input.partNumber,
    recognizedPartNumber: input.recognizedPartNumber,
    matchRule: input.matchRule,
    verifiedAt: formatBeijingDateTime(input.verifiedAt),
    expiresAt: formatBeijingDateTime(input.expiresAt),
    validDays: SPOT_VERIFICATION_VALID_DAYS,
  };
}

function assertPreviousIsInScope(
  previous: ExistingVerification,
  scope: SpotStockVerificationScope
): void {
  if (
    previous.row.enterpriseId !== scope.enterpriseId ||
    previous.row.verifiedByUserId !== scope.verifiedByUserId
  ) {
    fail("FORBIDDEN", "核验权限已失效，请重新进入页面");
  }
}

async function existingSuccess(
  dependencies: SpotVerificationDependencies,
  previous: ExistingVerification,
  scope: SpotStockVerificationScope
) {
  assertPreviousIsInScope(previous, scope);
  // An actor can switch from enterprise-wide access to a single owner after the initial success.
  // Do not return the historical inventory unless the current scoped reader still exposes that ID.
  const visibleRows = await dependencies.listCandidateRows(
    scope.dataOwnerUserId,
    scope.enterpriseId,
    scope.ownerUserId,
    spotVerificationSearchPartNumbers(previous.row.recognizedPartNumber)
  );
  if (
    !visibleRows
      .slice(0, CANDIDATE_DB_LIMIT)
      .some(row => row.id === previous.row.inventoryId)
  ) {
    fail("FORBIDDEN", "核验选择与当前权限范围不一致");
  }
  return successResponse({
    inventoryId: previous.row.inventoryId,
    partNumber: previous.row.inventoryPartNumber,
    recognizedPartNumber: previous.row.recognizedPartNumber,
    matchRule: previous.row.matchRule,
    verifiedAt: previous.row.verifiedAt,
    expiresAt: previous.row.expiresAt,
  });
}

function candidateFingerprint(
  row: SpotInventoryCandidateRow,
  matchKind: "exact" | "packaging"
): string {
  return spotVerificationMatchFingerprint(
    {
      partNumber: row.partNumber,
      qtyOnSale: row.qtyOnSale,
      qtyStock: row.qtyStock,
      dateCode: row.dateCode,
      grade: row.grade,
      source: row.source,
      warehouseAddress: row.warehouseAddress,
      brand: row.brand,
    },
    matchKind
  );
}

function candidateRowsForRecognition(
  recognizedPartNumber: string,
  rows: SpotInventoryCandidateRow[]
) {
  // The DB must cap at 30; slicing here means a faulty adapter can never make us search unbounded data.
  const boundedRows = rows.slice(0, CANDIDATE_DB_LIMIT);
  const byId = new Map(boundedRows.map(row => [row.id, row]));
  const matches = selectSpotInventoryCandidates(
    recognizedPartNumber,
    boundedRows.map(row => ({
      id: row.id,
      partNumber: row.partNumber,
      brand: row.brand,
    })),
    CANDIDATE_SELECTION_LIMIT
  );
  // A 30-row result may have reached the SQL limit, so it can never establish unique exactness.
  return {
    matches,
    byId,
    queryLimitReached: rows.length >= CANDIDATE_DB_LIMIT,
  };
}

function inventoryChanged(): never {
  fail("CONFLICT", "库存状态已变化，请重新核验");
}

function handleCreateFailure(
  result: Extract<CreateVerificationResult, { ok: false }>
): never {
  if (result.reason === "duplicate_photo") {
    fail("CONFLICT", "这张照片已核验过，请重新拍摄");
  }
  if (result.reason === "inventory" || result.reason === "inventory_changed") {
    inventoryChanged();
  }
  if (result.reason === "request_conflict") {
    fail("CONFLICT", "本次核验已失效，请重新拍摄");
  }
  fail("INTERNAL_SERVER_ERROR", "数据库不可用");
}

function tokenFailure(error: unknown): never {
  if (error instanceof SpotVerificationSelectionTokenError) {
    fail(
      error.reason === "unavailable" ? "PRECONDITION_FAILED" : "CONFLICT",
      error.message
    );
  }
  throw error;
}

/**
 * The selection stage never invokes OCR. It re-reads a small, scope-filtered inventory subset,
 * validates the token snapshot, and asks the DB transaction to repeat those checks under lock.
 */
async function discardPrivateUpload(
  dependencies: SpotVerificationDependencies,
  key: string
): Promise<void> {
  // The storage helper assigns a fresh collision suffix, so this can never delete a prior record's key.
  await dependencies.deletePrivate(key).catch(() => undefined);
}

/**
 * Revalidates the scoped inventory snapshot before looking up an existing verification. An existing
 * matching selection returns without an upload; a newly uploaded object is compensated on every
 * non-success path so only a committed verification can retain it.
 */
async function confirmWithPayload(
  dependencies: SpotVerificationDependencies,
  scope: SpotStockVerificationScope,
  payload: SpotVerificationSelectionTokenPayload,
  inventoryId: number,
  image: Buffer,
  mimeType: PrepareSpotStockVerificationInput["mimeType"] = payload.mimeType,
  requireUniqueCandidate = false
) {
  if (!Number.isSafeInteger(inventoryId) || inventoryId <= 0) {
    fail("BAD_REQUEST", "请选择可核验的库存");
  }
  assertConfirmedPhoto(payload, image, mimeType);
  if (!sameScope(payload.scope, scope)) {
    fail("FORBIDDEN", "核验选择与当前权限范围不一致");
  }

  const selected = payload.candidates.find(
    candidate => candidate.id === inventoryId
  );
  if (!selected) fail("FORBIDDEN", "所选库存不在本次核验范围内");

  const rows = await dependencies.listCandidateRows(
    scope.dataOwnerUserId,
    scope.enterpriseId,
    scope.ownerUserId,
    spotVerificationSearchPartNumbers(payload.recognizedPartNumber)
  );
  const { matches, byId, queryLimitReached } = candidateRowsForRecognition(
    payload.recognizedPartNumber,
    rows
  );
  if (requireUniqueCandidate && (queryLimitReached || matches.length !== 1)) {
    inventoryChanged();
  }
  const row = byId.get(selected.id);
  const currentMatch = matches.find(match => match.inventoryId === selected.id);
  if (
    !row ||
    !currentMatch ||
    row.partNumber !== selected.partNumber ||
    row.brand !== selected.brand ||
    candidateFingerprint(row, selected.matchKind) !== selected.fingerprint ||
    currentMatch.matchKind !== selected.matchKind ||
    currentMatch.rule !== selected.matchKind ||
    currentMatch.inventoryPartNumber !== selected.partNumber
  ) {
    inventoryChanged();
  }

  // This check follows the fresh scope/fingerprint check, so a retry cannot revive a hidden or
  // changed inventory. It occurs before private persistence to keep cancel/expiry/retry upload-free.
  const previous = await dependencies.findVerification({
    enterpriseId: scope.enterpriseId,
    verifiedByUserId: scope.verifiedByUserId,
    requestId: payload.requestId,
    photoSha256: payload.photoSha256,
  });
  if (previous) {
    if (previous.kind === "idempotent") {
      assertPreviousIsInScope(previous, scope);
      if (previous.row.inventoryId !== selected.id) {
        fail("CONFLICT", "本次核验已失效，请重新拍摄");
      }
      return existingSuccess(dependencies, previous, scope);
    }
    if (previous.kind === "request_conflict") {
      assertPreviousIsInScope(previous, scope);
      fail("CONFLICT", "本次核验已失效，请重新拍摄");
    }
    fail("CONFLICT", "这张照片已核验过，请重新拍摄");
  }

  // storagePutPrivate creates its own random suffix; only this returned key is eligible for cleanup.
  const stored = await dependencies.putPrivate(
    canonicalPhotoKey(payload.photoSha256, payload.mimeType),
    image,
    payload.mimeType
  );
  let created: CreateVerificationResult;
  try {
    created = await dependencies.createVerification({
      inventoryId: selected.id,
      dataOwnerUserId: scope.dataOwnerUserId,
      enterpriseId: scope.enterpriseId,
      verifiedByUserId: scope.verifiedByUserId,
      ...(scope.ownerUserId === undefined
        ? {}
        : { ownerUserId: scope.ownerUserId }),
      match: currentMatch,
      photo: { key: stored.key, sha256: payload.photoSha256 },
      requestId: payload.requestId,
      modelName: payload.modelName,
      verifiedAt: dependencies.now(),
      expiresAt: new Date(
        dependencies.now().getTime() +
          SPOT_VERIFICATION_VALID_DAYS * 24 * 60 * 60 * 1000
      ),
      expectedFingerprint: selected.fingerprint,
      expectedBrand: selected.brand,
      requireSelectedInventory: true,
      ...(requireUniqueCandidate ? { requireUniqueCandidate: true } : {}),
    });
  } catch (error) {
    await discardPrivateUpload(dependencies, stored.key);
    const code = (error as { code?: unknown } | undefined)?.code;
    if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
      inventoryChanged();
    }
    if ((error as { code?: unknown } | undefined)?.code !== "ER_DUP_ENTRY")
      throw error;
    const raced = await dependencies.findVerification({
      enterpriseId: scope.enterpriseId,
      verifiedByUserId: scope.verifiedByUserId,
      requestId: payload.requestId,
      photoSha256: payload.photoSha256,
    });
    if (raced?.kind === "idempotent") {
      assertPreviousIsInScope(raced, scope);
      if (raced.row.inventoryId === selected.id) {
        return existingSuccess(dependencies, raced, scope);
      }
    }
    fail("CONFLICT", "这张照片已核验过，请重新拍摄");
  }

  if (!created.ok) {
    await discardPrivateUpload(dependencies, stored.key);
    handleCreateFailure(created);
  }
  if (created.idempotent) {
    await discardPrivateUpload(dependencies, stored.key);
  }
  if (created.inventoryId !== selected.id) {
    fail("CONFLICT", "本次核验已失效，请重新拍摄");
  }
  return successResponse({
    inventoryId: created.inventoryId,
    partNumber: created.partNumber,
    recognizedPartNumber:
      created.recognizedPartNumber ?? payload.recognizedPartNumber,
    matchRule: created.matchRule ?? currentMatch.rule,
    verifiedAt: created.verifiedAt,
    expiresAt: created.expiresAt,
  });
}

export function createSpotStockVerificationService(
  overrides: Partial<SpotVerificationDependencies> = {}
) {
  const dependencies: SpotVerificationDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  async function prepare(
    scope: SpotStockVerificationScope,
    input: PrepareSpotStockVerificationInput,
    image: Buffer
  ) {
    assertScope(scope);
    assertPrepareInput(input, image);
    // Fail closed before quota usage, OCR, or private object persistence if cluster-safe token crypto is absent.
    try {
      assertSpotVerificationSelectionTokenSecret(dependencies.cookieSecret());
    } catch (error) {
      tokenFailure(error);
    }
    if (!dependencies.isOcrAvailable()) {
      fail("PRECONDITION_FAILED", "现货核验暂不可用，请稍后再试");
    }

    const photoSha256 = asSha256(image);
    const previous = await dependencies.findVerification({
      enterpriseId: scope.enterpriseId,
      verifiedByUserId: scope.verifiedByUserId,
      requestId: input.requestId,
      photoSha256,
    });
    if (previous?.kind === "request_conflict") {
      assertPreviousIsInScope(previous, scope);
      fail("CONFLICT", "本次核验已失效，请重新拍摄");
    }
    if (previous?.kind === "duplicate_photo") {
      fail("CONFLICT", "这张照片已核验过，请重新拍摄");
    }
    if (previous?.kind === "idempotent")
      return existingSuccess(dependencies, previous, scope);

    if (dependencies.isOcrRateLimited(scope.dataOwnerUserId)) {
      fail(
        "TOO_MANY_REQUESTS",
        `拍照核验过于频繁，每小时上限 ${LABEL_OCR_HOURLY_LIMIT} 次`
      );
    }

    let ocr: MaterialLabelOcrResult;
    try {
      ocr = await dependencies.recognize(input.base64);
    } catch (error) {
      dependencies.refundOcrQuota(scope.dataOwnerUserId);
      if (error instanceof MaterialLabelOcrError)
        fail("BAD_REQUEST", error.message);
      throw error;
    }

    const recognizedPartNumber = ocr.partNumber?.suggested?.trim() || "";
    if (!recognizedPartNumber) {
      fail("BAD_REQUEST", "未识别到料号，请拍清标签后重试");
    }

    const rows = await dependencies.listCandidateRows(
      scope.dataOwnerUserId,
      scope.enterpriseId,
      scope.ownerUserId,
      spotVerificationSearchPartNumbers(recognizedPartNumber)
    );
    const { matches, byId, queryLimitReached } = candidateRowsForRecognition(
      recognizedPartNumber,
      rows
    );

    // Non-printed/screen/unknown images remain in the existing human-review path. Only a sole exact
    // candidate is attached to the review; packages and ambiguity can never give a green label.
    if (!isAcceptedSpotMarking(ocr.markingSource)) {
      const onlyExact =
        matches.length === 1 && matches[0]?.matchKind === "exact"
          ? matches[0]
          : undefined;
      const stored = await dependencies.putPrivate(
        canonicalPhotoKey(photoSha256, input.mimeType),
        image,
        input.mimeType
      );
      let queued: { queued: true; reviewId: number; partNumber: string };
      try {
        queued = await dependencies.queueReview({
          enterpriseId: scope.enterpriseId,
          dataOwnerUserId: scope.dataOwnerUserId,
          submittedByUserId: scope.verifiedByUserId,
          inventoryId: onlyExact?.inventoryId ?? null,
          recognizedPartNumber,
          inventoryPartNumber: onlyExact?.inventoryPartNumber ?? null,
          markingSource: ocr.markingSource,
          photoKey: stored.key,
          photoSha256,
          requestId: input.requestId,
        });
      } catch (error) {
        await discardPrivateUpload(dependencies, stored.key);
        throw error;
      }
      return {
        success: false as const,
        queued: true as const,
        partNumber: queued.partNumber,
        recognizedPartNumber,
        message: SPOT_VERIFICATION_QUEUE_MESSAGE,
      };
    }

    if (!matches.length) {
      fail("BAD_REQUEST", "未找到匹配库存，请拍清料号后重试");
    }

    // Accepted selections persist no private object until the selected inventory has been
    // revalidated at confirmation time. Expired/cancelled selections therefore leave no orphan.
    const payloadBase = {
      scope: tokenScope(scope),
      mimeType: input.mimeType,
      photoSha256,
      requestId: input.requestId,
      recognizedPartNumber,
      markingSource: ocr.markingSource,
      modelName: dependencies.modelName,
      candidates: matches.map(match => {
        const row = byId.get(match.inventoryId);
        if (!row) throw new Error("spot verification candidate row missing");
        return {
          id: match.inventoryId,
          partNumber: row.partNumber,
          brand: row.brand,
          fingerprint: candidateFingerprint(row, match.matchKind),
          matchKind: match.matchKind,
        };
      }),
    };

    // A sole exact or brand-validated packaging candidate follows the one-step flow.
    // Both still use the same scoped revalidation/transaction as an explicit selection.
    if (
      !queryLimitReached &&
      matches.length === 1 &&
      !spotVerificationRequiresExplicitSelection(
        matches[0].inventoryPartNumber,
        byId.get(matches[0].inventoryId)?.brand
      ) &&
      (matches[0]?.matchKind === "exact" || matches[0]?.matchKind === "packaging")
    ) {
      const now = dependencies.now();
      const directPayload: SpotVerificationSelectionTokenPayload = {
        ...payloadBase,
        v: 1,
        iat: now.getTime(),
        exp: now.getTime() + 10 * 60 * 1000,
      };
      return confirmWithPayload(
        dependencies,
        scope,
        directPayload,
        matches[0].inventoryId,
        image,
        input.mimeType,
        true
      );
    }

    let token: string;
    let tokenExpiresAt: number;
    try {
      const now = dependencies.now();
      token = encodeSpotVerificationSelectionToken(payloadBase, {
        secret: dependencies.cookieSecret(),
        now,
      });
      tokenExpiresAt = now.getTime() + 10 * 60 * 1000;
    } catch (error) {
      tokenFailure(error);
    }

    return {
      success: false as const,
      selectionRequired: true as const,
      token,
      recognizedPartNumber,
      expiresAt: new Date(tokenExpiresAt).toISOString(),
      candidates: matches.map(match => {
        const row = byId.get(match.inventoryId);
        if (!row) throw new Error("spot verification candidate row missing");
        return {
          inventoryId: match.inventoryId,
          partNumber: row.partNumber,
          brand: row.brand,
          dateCode: row.dateCode,
          qtyOnSale: row.qtyOnSale,
          matchKind: match.matchKind,
        };
      }),
    };
  }

  async function confirm(
    scope: SpotStockVerificationScope,
    input: ConfirmSpotStockVerificationInput,
    image: Buffer
  ) {
    assertScope(scope);
    assertConfirmInput(input, image);
    let payload: SpotVerificationSelectionTokenPayload;
    try {
      payload = decodeSpotVerificationSelectionToken(input.token, {
        secret: dependencies.cookieSecret(),
        now: dependencies.now(),
      });
    } catch (error) {
      tokenFailure(error);
    }
    return confirmWithPayload(
      dependencies,
      scope,
      payload!,
      input.inventoryId,
      image,
      input.mimeType
    );
  }

  return { prepare, confirm };
}

const defaultService = createSpotStockVerificationService();

export function prepareSpotStockVerification(
  scope: SpotStockVerificationScope,
  input: PrepareSpotStockVerificationInput,
  image: Buffer
) {
  return defaultService.prepare(scope, input, image);
}

export function confirmSpotStockVerification(
  scope: SpotStockVerificationScope,
  input: ConfirmSpotStockVerificationInput,
  image: Buffer
) {
  return defaultService.confirm(scope, input, image);
}
