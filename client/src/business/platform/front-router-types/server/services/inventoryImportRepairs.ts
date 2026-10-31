// @ts-nocheck -- Same runtime is SQL/permission/DOM integration-tested by the incremental release.
import { createHash } from "node:crypto";

/**
 * Runtime added to the already-verified server bundle.  It deliberately uses
 * the original import task creator/stager/finalizer supplied by the bundle;
 * this module never writes to inventories directly.
 */
const REPAIR_PREFIX = "repair_";
const CLEAR_BATCH_SOURCE_PREFIX = "repair-clear:";
const ACTIVE_JOB_STATUSES = new Set(["staging", "queued", "running", "paused"]);
const TERMINAL_SOURCE_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const CLEAR_LOCK_SKIP_MESSAGES = new Set([
  "导入任务不存在",
  "只有原任务创建人可以修正或补发该行",
  "该行不是待修正的未成功行",
]);
const FIELD_LABELS = {
  partNumber: "型号",
  brand: "品牌",
  category: "分类",
  pkg: "封装",
  dateCode: "生产周期",
  qtyOnSale: "上架数量",
  qtyStock: "实际库存",
  priceEx: "单价",
  taxIncluded: "价格类型",
  moq: "MOQ",
  spq: "SPQ",
  leadTime: "交期",
  warehouseAddress: "仓库地址",
  rohs: "RoHS",
  note: "物料备注",
};

function rowsOf(result) {
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : result;
  }
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

async function query(executor, statement) {
  return rowsOf(await executor.execute(statement));
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function safeJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isClearMarked(value) {
  const corrected = value && typeof value === "object" && "correctedJson" in value
    ? safeJson(value.correctedJson, null)
    : safeJson(value, null);
  return corrected?._cleared === true || corrected?._cleared === 1 || corrected?._cleared === "true";
}

function publicCorrection(value) {
  const corrected = safeJson(value, null);
  if (!corrected) return null;
  const { _cleared, _clearRequestId, ...publicFields } = corrected;
  return publicFields;
}

function clearBatchSourceId(scope) {
  const hash = digest(`${CLEAR_BATCH_SOURCE_PREFIX}${scope.scopeKey}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanCorrection(row, rowNumber) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("修正内容必须是单行字段对象");
  }
  let serialised;
  try {
    serialised = JSON.stringify(row);
  } catch {
    throw new Error("修正内容无法保存，请检查字段格式");
  }
  if (!serialised || Buffer.byteLength(serialised, "utf8") > 8192) {
    throw new Error("修正行数据超过安全上限，请删除无关内容后重试");
  }
  const clean = safeJson(serialised);
  if (!clean) throw new Error("修正内容必须是单行字段对象");
  // These are protocol-only source fields.  They cannot be supplied by an editor.
  delete clean.sourceRowNumber;
  delete clean.validationError;
  delete clean._cleared;
  delete clean._clearRequestId;
  // Keep the legacy database field internally, but never accept a separately
  // editable physical-stock quantity from a client.
  delete clean.qtyStock;
  clean.qtyStock = clean.qtyOnSale;
  clean.sourceRowNumber = rowNumber;
  return clean;
}

function validationMessage(schema, row) {
  const normalized = { ...row, qtyStock: row?.qtyOnSale };
  if (normalized.qtyOnSale === 0) {
    return { ok: false, message: "数量为0，不能上架，请填写真实库存数量", data: null };
  }
  const parsed = schema.safeParse(normalized);
  if (parsed.success) {
    return { ok: true, message: null, data: { ...parsed.data, qtyStock: parsed.data.qtyOnSale } };
  }
  const message = parsed.error.issues.slice(0, 3).map(issue => {
    const field = String(issue.path?.[0] ?? "");
    const label = FIELD_LABELS[field] ?? "数据";
    if (issue.code === "invalid_type") return `${label}格式有误`;
    return `${label}：${issue.message}`;
  }).join("；") || "修正内容未通过校验";
  return { ok: false, message: message.slice(0, 255), data: null };
}

function requireScope(ctx) {
  const userId = Number(ctx?.user?.id);
  const enterpriseId = Number(ctx?.enterprisePermissionScope?.enterprise?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(enterpriseId) || enterpriseId <= 0) {
    throw new Error("当前企业上下文无效");
  }
  const member = ctx.enterprisePermissionScope.member;
  const canAccessEnterpriseJobs = Boolean(
    ctx.enterprisePermissionScope.isOwner || member?.inventoryDataScope === "enterprise",
  );
  const scope = {
    userId,
    enterpriseId,
    canAccessEnterpriseJobs,
    expectedDataOwnerUserId: nullableNumber(ctx.enterprisePermissionScope.dataOwnerUserId),
    expectedEffectiveUserId: nullableNumber(ctx.effectiveUserId),
    scopeKey: `${userId}:${enterpriseId}`,
  };
  return scope;
}

/**
 * Clear is deliberately narrower than list visibility and wider than canEdit.
 * It is re-evaluated against authoritative rows in the clear transaction so a
 * transferred owner, revoked member, or removed permission cannot use a stale
 * request context to clear another creator's exception.
 */
function canDismissSource(scope, access, job) {
  return access.canUsePublish
    && Number(job?.dataOwnerUserId) === Number(access.dataOwnerUserId)
    && (access.canDismissAll || Number(job?.createdByUserId) === scope.userId)
    && TERMINAL_SOURCE_JOB_STATUSES.has(String(job?.status ?? job?.jobStatus ?? ""));
}

function deriveDismissAccess(scope, enterprise, member, keys) {
  const permissionKeys = new Set(keys);
  const dataOwnerUserId = nullableNumber(enterprise?.crmDataOwnerUserId);
  const validIdentity = Number(enterprise?.id) === scope.enterpriseId
    && Number(member?.enterpriseId) === scope.enterpriseId
    && Number(member?.userId) === scope.userId
    && String(member?.status) === "active"
    && dataOwnerUserId !== null && dataOwnerUserId > 0
    && dataOwnerUserId === scope.expectedDataOwnerUserId;
  const isAuthoritativeOwner = validIdentity
    && Number(enterprise?.superAdminUserId) === scope.userId
    && String(member?.role) === "super_admin";
  const isMaintenanceAdmin = validIdentity && String(member?.role) === "admin"
    && String(member?.inventoryDataScope) === "enterprise"
    && permissionKeys.has("inventory.manage");
  return {
    dataOwnerUserId,
    canDismissAll: isAuthoritativeOwner || isMaintenanceAdmin,
    canUsePublish: validIdentity && (isAuthoritativeOwner || permissionKeys.has("inventory.publish")),
  };
}

async function readDismissAccess(executor, deps, scope, lock = false) {
  const suffix = lock ? deps.sql` FOR UPDATE` : deps.sql``;
  const enterprises = await query(executor, deps.sql`
    SELECT id, superAdminUserId, crmDataOwnerUserId
      FROM enterprises
     WHERE id = ${scope.enterpriseId}
     LIMIT 1${suffix}
  `);
  const enterprise = enterprises[0];
  if (!enterprise) throw new Error("当前企业身份已失效，不能清空");
  if (scope.expectedDataOwnerUserId === null || scope.expectedDataOwnerUserId <= 0
    || Number(enterprise.crmDataOwnerUserId) !== scope.expectedDataOwnerUserId
    || scope.expectedEffectiveUserId !== scope.expectedDataOwnerUserId) {
    throw new Error("当前企业归属已变化，请刷新");
  }

  const members = await query(executor, deps.sql`
    SELECT id, enterpriseId, userId, role, status, inventoryDataScope
      FROM enterprise_members
     WHERE enterpriseId = ${scope.enterpriseId} AND userId = ${scope.userId}
     LIMIT 1${suffix}
  `);
  const member = members[0];
  if (!member || String(member.status) !== "active") {
    throw new Error("当前企业成员身份已失效，不能清空");
  }

  // Lock the precise permission rows before deciding administrator authority.
  // Owner authority is tied to the authoritative enterprise field, not role.
  const permissionRows = await query(executor, deps.sql`
    SELECT permissionKey
      FROM enterprise_member_permissions
     WHERE enterpriseMemberId = ${member.id}
     ${suffix}
  `);
  return deriveDismissAccess(scope, enterprise, member,
    permissionRows.map(row => String(row.permissionKey)));
}

function toRepairStatus(row) {
  if (isClearMarked(row)) return "cleared";
  const childStatus = row.childJobStatus ? String(row.childJobStatus) : null;
  const childInventoryId = nullableNumber(row.childInventoryId);
  const repairInventoryId = nullableNumber(row.repairInventoryId);
  if (childInventoryId !== null || repairInventoryId !== null) return "success";
  if (childStatus && ACTIVE_JOB_STATUSES.has(childStatus)) return "queued";
  if (childStatus === "completed" || childStatus === "failed" || childStatus === "cancelled") return "error";
  const status = String(row.repairStatus ?? "");
  return ["pending", "ready", "queued", "success", "error", "existing", "cleared"].includes(status)
    ? status
    : "pending";
}

/**
 * The exception queue is not an inventory search. A source row exits it only
 * when its original result exists, a repair is soft-cleared, or this repair has
 * an explicit success record. In particular, merely finding a same-model
 * inventory must never hide a pending repair: it may still be a legitimate
 * upsert. The guarded-existing branch is the bounded worker success proof
 * established by childState.
 *
 * Keep this alias-based predicate shared by list, total, export and the clear
 * candidate snapshot. That prevents the UI badge from disagreeing with the
 * transaction which writes clear markers.
 */
function handledRepairSql(deps) {
  return deps.sql`
    (
      rp.inventoryId IS NOT NULL
      OR childResult.inventoryId IS NOT NULL
      OR (
        COALESCE(childStage.status, '') = 'success'
        AND COALESCE(childVersion.guardKind, '') = 'existing'
        AND childVersion.inventoryId IS NOT NULL
      )
      OR (
        COALESCE(rp.status, '') IN ('success', 'existing')
        AND (child.status IS NULL OR child.status NOT IN ('staging', 'queued', 'running', 'paused'))
      )
    )
  `;
}

function visibleExceptionSql(deps) {
  return deps.sql`
    originalResult.inventoryId IS NULL
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(rp.correctedJson, '$._cleared')), '0') NOT IN ('true', '1')
    AND COALESCE(rp.status, '') <> 'cleared'
    AND NOT ${handledRepairSql(deps)}
  `;
}

function workerRawForEditor(raw) {
  const normalised = { ...raw };
  for (const field of ["qtyOnSale", "qtyStock", "priceEx", "moq", "spq"]) {
    if (normalised[field] !== null && normalised[field] !== undefined && normalised[field] !== "") {
      const numeric = Number(normalised[field]);
      if (Number.isFinite(numeric)) normalised[field] = numeric;
    }
  }
  for (const field of ["taxIncluded", "rohs"]) {
    if (normalised[field] === 1 || normalised[field] === "1") normalised[field] = true;
    if (normalised[field] === 0 || normalised[field] === "0") normalised[field] = false;
  }
  return normalised;
}

function toItem(scopeKey, userId, row) {
  const parsedRaw = safeJson(row.rawJson, {});
  const raw = String(row.sourceKind) === "worker_error" ? workerRawForEditor(parsedRaw) : parsedRaw;
  const corrected = publicCorrection(row.correctedJson);
  const status = toRepairStatus(row);
  const inventoryId = nullableNumber(row.childInventoryId) ?? nullableNumber(row.repairInventoryId);
  const sourceError = String(row.sourceErrorMessage ?? "未成功处理，请修正后补发");
  const repairError = row.repairErrorMessage ? String(row.repairErrorMessage) : null;
  const childError = row.childErrorMessage ? String(row.childErrorMessage) : null;
  const errorMessage = status === "error"
    ? (childError || repairError || sourceError)
    : (repairError || sourceError);
  return {
    scopeKey,
    jobId: String(row.jobId),
    rowNumber: Number(row.rowNumber),
    fileName: String(row.fileName),
    jobStatus: String(row.jobStatus),
    partNumber: String(raw.partNumber ?? row.partNumber ?? ""),
    brand: String(raw.brand ?? row.brand ?? ""),
    originalQuantity: raw.qtyOnSale === undefined || raw.qtyOnSale === null
      ? String(row.qtyOnSale ?? "")
      : String(raw.qtyOnSale),
    raw,
    corrected,
    revision: Number(row.revision ?? 0),
    status,
    errorMessage,
    canEdit: Number(row.createdByUserId) === userId && !["queued", "success", "existing", "cleared"].includes(status),
    repairJobId: row.repairJobId ? String(row.repairJobId) : null,
    inventoryId,
  };
}

function assertDependencies(deps) {
  const required = [
    "importInventoryRouter", "inventoryPublishProcedure", "z", "TRPCError", "getDb", "sql",
    "importRowSchema", "clones",
  ];
  for (const key of required) {
    if (!deps?.[key]) throw new Error(`库存导入待修正运行时缺少依赖：${key}`);
  }
  for (const key of ["create", "stage", "finalize"]) {
    if (typeof deps.clones[key] !== "function") {
      throw new Error(`库存导入待修正运行时缺少事务克隆：${key}`);
    }
  }
}

function throwBusiness(deps, error) {
  if (error instanceof deps.TRPCError) throw error;
  const message = error instanceof Error ? error.message : "库存导入待修正操作失败";
  const known = /修正|补发|导入任务|请求号|当前企业|安全上限|最多|暂存|批次|任务创建人|只有|不完整|已结束|不存在|库存|权限|数量|清空|清除/.test(message);
  if (!known) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    console.error(`[inventory-import-repair] route failure code=${code}`);
    throw new deps.TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "库存导入待修正服务暂时不可用，请稍后重试" });
  }
  const code = /不存在|不是待修正/.test(message)
    ? "NOT_FOUND"
    : /清空|清除/.test(message)
      ? "PRECONDITION_FAILED"
    : /版本冲突|已有|已成功|不能再次|正在排队|请求号已用于|只能由原任务创建人/.test(message)
      ? "CONFLICT"
      : /数量为0|校验|安全上限|最多|超出|不完整|请先保存/.test(message)
        ? "BAD_REQUEST"
        : "PRECONDITION_FAILED";
  throw new deps.TRPCError({ code, message });
}

async function readRepair(tx, deps, jobId, rowNumber, lock = false) {
  const suffix = lock ? deps.sql` FOR UPDATE` : deps.sql``;
  const rows = await query(tx, deps.sql`
    SELECT id, sourceJobId, sourceRowNumber, enterpriseId, sourceCreatedByUserId,
           sourceDataOwnerUserId, correctedJson, revision, status, repairJobId,
           repairRequestId, errorMessage, inventoryId
      FROM inventory_import_repairs
     WHERE sourceJobId = ${jobId} AND sourceRowNumber = ${rowNumber}${suffix}
  `);
  return rows[0] ?? null;
}

async function readAudit(tx, deps, jobId, rowNumber, action, requestId, lock = false) {
  const suffix = lock ? deps.sql` FOR UPDATE` : deps.sql``;
  const rows = await query(tx, deps.sql`
    SELECT id, revision, correctedJson, repairJobId, outcome
      FROM inventory_import_repair_audits
     WHERE sourceJobId = ${jobId}
       AND sourceRowNumber = ${rowNumber}
       AND action = ${action}
       AND requestId = ${requestId}
     LIMIT 1${suffix}
  `);
  return rows[0] ?? null;
}

async function lockSource(tx, deps, scope, jobId, rowNumber, requireCreator = true) {
  const jobs = await query(tx, deps.sql`
    SELECT id, enterpriseId, dataOwnerUserId, createdByUserId, ownerUserId,
           fileName, fileHash, manifestHash, saveAs, status
      FROM inventory_import_jobs
     WHERE id = ${jobId} AND enterpriseId = ${scope.enterpriseId}
     FOR UPDATE
  `);
  const job = jobs[0];
  if (!job) throw new Error("导入任务不存在");
  if (requireCreator && Number(job.createdByUserId) !== scope.userId) {
    throw new Error("只有原任务创建人可以修正或补发该行");
  }
  const rejected = await query(tx, deps.sql`
    SELECT rawRow, errorMessage
      FROM inventory_import_rejected
     WHERE jobId = ${jobId} AND enterpriseId = ${scope.enterpriseId} AND rowNumber = ${rowNumber}
     LIMIT 1
     FOR UPDATE
  `);
  if (rejected[0]) {
    return {
      job,
      raw: safeJson(rejected[0].rawRow, {}),
      sourceErrorMessage: String(rejected[0].errorMessage ?? "单行校验失败"),
    };
  }
  const staged = await query(tx, deps.sql`
    SELECT partNumber, brand, category, pkg, dateCode, qtyOnSale, qtyStock, priceEx,
           taxIncluded, moq, spq, leadTime, warehouseAddress, rohs, note, errorMessage
      FROM inventory_import_staging
     WHERE jobId = ${jobId} AND enterpriseId = ${scope.enterpriseId}
       AND rowNumber = ${rowNumber} AND status = 'error'
     LIMIT 1
     FOR UPDATE
  `);
  if (!staged[0]) throw new Error("该行不是待修正的未成功行");
  const row = staged[0];
  return {
    job,
    raw: {
      partNumber: row.partNumber,
      brand: row.brand,
      category: row.category,
      pkg: row.pkg,
      dateCode: row.dateCode,
      qtyOnSale: nullableNumber(row.qtyOnSale) ?? row.qtyOnSale,
      qtyStock: nullableNumber(row.qtyStock) ?? row.qtyStock,
      priceEx: row.priceEx === null || row.priceEx === undefined ? undefined : Number(row.priceEx),
      taxIncluded: Boolean(row.taxIncluded),
      moq: nullableNumber(row.moq),
      spq: nullableNumber(row.spq),
      leadTime: row.leadTime,
      warehouseAddress: row.warehouseAddress,
      rohs: Boolean(row.rohs),
      note: row.note,
    },
    sourceErrorMessage: String(row.errorMessage ?? "后台处理失败"),
  };
}

async function assertNoOriginalResult(tx, deps, jobId, rowNumber) {
  const rows = await query(tx, deps.sql`
    SELECT inventoryId FROM inventory_import_results
     WHERE jobId = ${jobId} AND rowNumber = ${rowNumber}
     LIMIT 1 FOR UPDATE
  `);
  if (rows[0]) throw new Error("该原始行已产生库存，请在原库存中处理，不能补发");
}

async function childState(tx, deps, repairJobId, rowNumber, enterpriseId) {
  if (!repairJobId) return { job: null, inventoryId: null, stagingStatus: null, errorMessage: null };
  const rows = await query(tx, deps.sql`
    SELECT j.id, j.status,
           s.status AS stagingStatus, s.errorMessage AS stagingErrorMessage,
           COALESCE(
             r.inventoryId,
             CASE WHEN s.status = 'success' AND v.guardKind = 'existing' THEN v.inventoryId ELSE NULL END
           ) AS inventoryId
      FROM inventory_import_jobs j
      LEFT JOIN inventory_import_staging s
        ON s.jobId = j.id AND s.enterpriseId = ${enterpriseId} AND s.rowNumber = ${rowNumber}
      LEFT JOIN inventory_import_results r ON r.jobId = j.id AND r.rowNumber = ${rowNumber}
      LEFT JOIN inventory_import_row_versions v ON v.jobId = j.id AND v.rowNumber = ${rowNumber}
     WHERE j.id = ${repairJobId} AND j.enterpriseId = ${enterpriseId}
     LIMIT 1 FOR UPDATE
  `);
  const row = rows[0];
  if (!row) return { job: null, inventoryId: null, stagingStatus: null, errorMessage: null };
  return {
    job: { id: String(row.id), status: String(row.status) },
    inventoryId: nullableNumber(row.inventoryId),
    stagingStatus: row.stagingStatus ? String(row.stagingStatus) : null,
    errorMessage: row.stagingErrorMessage ? String(row.stagingErrorMessage) : null,
  };
}

async function assertNoBlockingHistoricalAttempt(tx, deps, jobId, rowNumber, enterpriseId) {
  const attempts = await query(tx, deps.sql`
    SELECT repairJobId
      FROM inventory_import_repair_audits
     WHERE sourceJobId = ${jobId}
       AND sourceRowNumber = ${rowNumber}
       AND enterpriseId = ${enterpriseId}
       AND repairJobId IS NOT NULL
     FOR UPDATE
  `);
  for (const attempt of attempts) {
    const state = await childState(tx, deps, attempt.repairJobId, rowNumber, enterpriseId);
    if (state.inventoryId !== null) {
      throw new Error("该修正行已产生库存，请在原库存中处理，不能覆盖保存");
    }
    if (state.job && ACTIVE_JOB_STATUSES.has(state.job.status)) {
      throw new Error("该修正行正在排队处理，不能覆盖保存");
    }
  }
}

async function writeAudit(tx, deps, input) {
  await query(tx, deps.sql`
    INSERT INTO inventory_import_repair_audits
      (sourceJobId, sourceRowNumber, enterpriseId, actorUserId, action, revision,
       requestId, correctedJson, repairJobId, outcome, errorMessage)
    VALUES
      (${input.sourceJobId}, ${input.sourceRowNumber}, ${input.enterpriseId}, ${input.actorUserId},
       ${input.action}, ${input.revision}, ${input.requestId}, ${input.correctedJson},
       ${input.repairJobId}, ${input.outcome}, ${input.errorMessage})
  `);
}

async function getListRows(db, deps, scope, input, rowNumber = null, options = {}) {
  const jobId = input.jobId ?? null;
  const page = Math.max(1, Number(input.page ?? 1));
  const pageLimit = Math.min(options.maxLimit ?? 50, Math.max(1, Number(input.limit ?? 20)));
  const limit = options.take ?? pageLimit;
  const offset = (page - 1) * pageLimit;
  const onlyRow = rowNumber ?? 0;
  const visibility = scope.canAccessEnterpriseJobs ? 1 : 0;
  const exportOnly = options.exportOnly ? 1 : 0;
  const rows = await query(db, deps.sql`
    WITH scoped_jobs AS (
      SELECT id, enterpriseId, fileName, status, createdByUserId, dataOwnerUserId, createdAt
        FROM inventory_import_jobs
       WHERE enterpriseId = ${scope.enterpriseId}
         AND (${visibility} = 1 OR createdByUserId = ${scope.userId})
         AND (${jobId} IS NULL OR id = ${jobId})
         AND LEFT(clientRequestId, 7) <> 'repair_'
    ), source_rows AS (
      SELECT 'rejected' AS sourceKind, r.jobId, r.rowNumber, r.rawRow AS rawJson,
             r.errorMessage AS sourceErrorMessage, NULL AS partNumber, NULL AS brand, NULL AS qtyOnSale
        FROM inventory_import_rejected r
        INNER JOIN scoped_jobs j ON j.id = r.jobId AND r.enterpriseId = j.enterpriseId
      UNION ALL
      SELECT 'worker_error' AS sourceKind, s.jobId, s.rowNumber,
             JSON_OBJECT(
               'partNumber', s.partNumber, 'brand', s.brand, 'category', s.category,
               'pkg', s.pkg, 'dateCode', s.dateCode, 'qtyOnSale', s.qtyOnSale,
               'qtyStock', s.qtyStock, 'priceEx', s.priceEx, 'taxIncluded', s.taxIncluded,
               'moq', s.moq, 'spq', s.spq, 'leadTime', s.leadTime,
               'warehouseAddress', s.warehouseAddress, 'rohs', s.rohs, 'note', s.note
             ) AS rawJson,
             s.errorMessage AS sourceErrorMessage, s.partNumber, s.brand, s.qtyOnSale
        FROM inventory_import_staging s
        INNER JOIN scoped_jobs j ON j.id = s.jobId AND s.enterpriseId = j.enterpriseId
       WHERE s.status = 'error'
    )
    SELECT src.sourceKind, src.jobId, src.rowNumber, src.rawJson, src.sourceErrorMessage, src.partNumber, src.brand, src.qtyOnSale,
           j.fileName, j.status AS jobStatus, j.createdByUserId, j.dataOwnerUserId,
           rp.correctedJson, rp.revision, rp.status AS repairStatus, rp.repairJobId,
           rp.errorMessage AS repairErrorMessage, rp.inventoryId AS repairInventoryId,
           child.status AS childJobStatus,
           COALESCE(
             childResult.inventoryId,
             CASE WHEN childStage.status = 'success' AND childVersion.guardKind = 'existing' THEN childVersion.inventoryId ELSE NULL END
           ) AS childInventoryId,
           childStage.errorMessage AS childErrorMessage
      FROM source_rows src
      INNER JOIN inventory_import_jobs j ON j.id = src.jobId AND j.enterpriseId = ${scope.enterpriseId}
      LEFT JOIN inventory_import_results originalResult
        ON originalResult.jobId = src.jobId AND originalResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_repairs rp
        ON rp.sourceJobId = CONVERT(src.jobId USING utf8mb4) COLLATE utf8mb4_unicode_ci
       AND rp.sourceRowNumber = src.rowNumber
       AND rp.enterpriseId = j.enterpriseId
      LEFT JOIN inventory_import_jobs child
        ON CONVERT(child.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = rp.repairJobId
       AND child.enterpriseId = j.enterpriseId
      LEFT JOIN inventory_import_results childResult
        ON childResult.jobId = child.id
       AND childResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_staging childStage
        ON childStage.jobId = child.id
       AND childStage.enterpriseId = j.enterpriseId
       AND childStage.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_row_versions childVersion
        ON childVersion.jobId = child.id
       AND childVersion.rowNumber = src.rowNumber
     WHERE ${visibleExceptionSql(deps)}
       AND (${onlyRow} = 0 OR src.rowNumber = ${onlyRow})
       AND (${exportOnly} = 0 OR (
         rp.inventoryId IS NULL
         AND COALESCE(
           childResult.inventoryId,
           CASE WHEN childStage.status = 'success' AND childVersion.guardKind = 'existing' THEN childVersion.inventoryId ELSE NULL END
         ) IS NULL
         AND (child.status IS NULL OR child.status NOT IN ('staging', 'queued', 'running', 'paused'))
         AND (
           child.status IN ('completed', 'failed', 'cancelled')
           OR COALESCE(rp.status, 'pending') IN ('pending', 'ready', 'error')
         )
       ))
     ORDER BY j.createdAt DESC, j.id DESC, src.rowNumber ASC
     LIMIT ${rowNumber === null ? limit : 1} OFFSET ${rowNumber === null ? offset : 0}
  `);
  return rows;
}

async function countListRows(db, deps, scope, jobId) {
  const visibility = scope.canAccessEnterpriseJobs ? 1 : 0;
  const rows = await query(db, deps.sql`
    WITH scoped_jobs AS (
      SELECT id, enterpriseId
        FROM inventory_import_jobs
       WHERE enterpriseId = ${scope.enterpriseId}
         AND (${visibility} = 1 OR createdByUserId = ${scope.userId})
         AND (${jobId} IS NULL OR id = ${jobId})
         AND LEFT(clientRequestId, 7) <> 'repair_'
    ), source_rows AS (
        SELECT r.jobId, r.rowNumber
          FROM inventory_import_rejected r
          INNER JOIN scoped_jobs j ON j.id = r.jobId AND r.enterpriseId = j.enterpriseId
        UNION ALL
        SELECT s.jobId, s.rowNumber
          FROM inventory_import_staging s
          INNER JOIN scoped_jobs j ON j.id = s.jobId AND s.enterpriseId = j.enterpriseId
         WHERE s.status = 'error'
    )
    SELECT COUNT(*) AS total
      FROM source_rows src
      INNER JOIN scoped_jobs j ON j.id = src.jobId
      LEFT JOIN inventory_import_results originalResult
        ON originalResult.jobId = src.jobId AND originalResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_repairs rp
        ON rp.sourceJobId = CONVERT(src.jobId USING utf8mb4) COLLATE utf8mb4_unicode_ci
       AND rp.sourceRowNumber = src.rowNumber
       AND rp.enterpriseId = j.enterpriseId
      LEFT JOIN inventory_import_jobs child
        ON CONVERT(child.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = rp.repairJobId
       AND child.enterpriseId = j.enterpriseId
      LEFT JOIN inventory_import_results childResult
        ON childResult.jobId = child.id
       AND childResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_staging childStage
        ON childStage.jobId = child.id
       AND childStage.enterpriseId = j.enterpriseId
       AND childStage.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_row_versions childVersion
        ON childVersion.jobId = child.id
       AND childVersion.rowNumber = src.rowNumber
     WHERE ${visibleExceptionSql(deps)}
  `);
  return Number(rows[0]?.total ?? 0);
}

async function getOneDto(db, deps, scope, jobId, rowNumber) {
  const rows = await getListRows(db, deps, scope, { jobId, page: 1, limit: 1 }, rowNumber);
  const row = rows[0];
  if (!row) throw new Error("该行不是待修正的未成功行");
  return toItem(scope.scopeKey, scope.userId, row);
}

async function readClearBatchAudit(tx, deps, scope, requestId, lock = false) {
  const suffix = lock ? deps.sql` FOR UPDATE` : deps.sql``;
  const rows = await query(tx, deps.sql`
    SELECT id, correctedJson, outcome
      FROM inventory_import_repair_audits
     WHERE sourceJobId = ${clearBatchSourceId(scope)}
       AND sourceRowNumber = 0
       AND enterpriseId = ${scope.enterpriseId}
       AND actorUserId = ${scope.userId}
       AND action = 'clear'
       AND requestId = ${requestId}
     LIMIT 1${suffix}
  `);
  return rows[0] ?? null;
}

async function listClearCandidateIds(tx, deps, scope, dismissAccess) {
  const canDismissAll = dismissAccess.canDismissAll ? 1 : 0;
  const rows = await query(tx, deps.sql`
    WITH scoped_jobs AS (
      SELECT id, enterpriseId, createdByUserId, dataOwnerUserId, status
        FROM inventory_import_jobs
       WHERE enterpriseId = ${scope.enterpriseId}
         AND status IN ('completed', 'failed', 'cancelled')
         AND dataOwnerUserId = ${dismissAccess.dataOwnerUserId}
         AND (${canDismissAll} = 1 OR createdByUserId = ${scope.userId})
         AND LEFT(clientRequestId, 7) <> 'repair_'
    ), source_rows AS (
      SELECT r.jobId, r.rowNumber
        FROM inventory_import_rejected r
        INNER JOIN scoped_jobs j ON j.id = r.jobId AND r.enterpriseId = j.enterpriseId
      UNION ALL
      SELECT s.jobId, s.rowNumber
        FROM inventory_import_staging s
        INNER JOIN scoped_jobs j ON j.id = s.jobId AND s.enterpriseId = j.enterpriseId
       WHERE s.status = 'error'
    )
    SELECT src.jobId, src.rowNumber, j.createdByUserId, j.dataOwnerUserId, j.status AS jobStatus
      FROM source_rows src
      INNER JOIN scoped_jobs j ON j.id = src.jobId AND j.enterpriseId = ${scope.enterpriseId}
      LEFT JOIN inventory_import_results originalResult
        ON originalResult.jobId = src.jobId AND originalResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_repairs rp
        ON rp.sourceJobId = CONVERT(src.jobId USING utf8mb4) COLLATE utf8mb4_unicode_ci
       AND rp.sourceRowNumber = src.rowNumber
       AND rp.enterpriseId = ${scope.enterpriseId}
      LEFT JOIN inventory_import_jobs child
        ON CONVERT(child.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = rp.repairJobId
       AND child.enterpriseId = ${scope.enterpriseId}
      LEFT JOIN inventory_import_results childResult
        ON childResult.jobId = child.id
       AND childResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_staging childStage
        ON childStage.jobId = child.id
       AND childStage.enterpriseId = ${scope.enterpriseId}
       AND childStage.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_row_versions childVersion
        ON childVersion.jobId = child.id
       AND childVersion.rowNumber = src.rowNumber
     WHERE ${visibleExceptionSql(deps)}
     ORDER BY src.jobId ASC, src.rowNumber ASC
     LIMIT 10001
     FOR UPDATE
  `);
  return rows;
}

async function lockedChildAttempts(tx, deps, repair, jobId, rowNumber, enterpriseId) {
  const attempts = await query(tx, deps.sql`
    SELECT repairJobId
      FROM inventory_import_repair_audits
     WHERE sourceJobId = ${jobId}
       AND sourceRowNumber = ${rowNumber}
       AND enterpriseId = ${enterpriseId}
       AND repairJobId IS NOT NULL
     FOR UPDATE
  `);
  const repairJobIds = new Set();
  if (repair?.repairJobId) repairJobIds.add(String(repair.repairJobId));
  for (const attempt of attempts) repairJobIds.add(String(attempt.repairJobId));
  const states = [];
  for (const repairJobId of repairJobIds) {
    states.push({ repairJobId, state: await childState(tx, deps, repairJobId, rowNumber, enterpriseId) });
  }
  return states;
}

async function countClearRemainingReasons(tx, deps, scope, dismissAccess) {
  const visibility = scope.canAccessEnterpriseJobs ? 1 : 0;
  const canDismissAll = dismissAccess.canDismissAll ? 1 : 0;
  const rows = await query(tx, deps.sql`
    WITH scoped_jobs AS (
      SELECT id, enterpriseId, status, createdByUserId, dataOwnerUserId
        FROM inventory_import_jobs
       WHERE enterpriseId = ${scope.enterpriseId}
         AND (${visibility} = 1 OR createdByUserId = ${scope.userId})
         AND LEFT(clientRequestId, 7) <> 'repair_'
    ), source_rows AS (
      SELECT r.jobId, r.rowNumber
        FROM inventory_import_rejected r
        INNER JOIN scoped_jobs j ON j.id = r.jobId AND r.enterpriseId = j.enterpriseId
      UNION ALL
      SELECT s.jobId, s.rowNumber
        FROM inventory_import_staging s
        INNER JOIN scoped_jobs j ON j.id = s.jobId AND s.enterpriseId = j.enterpriseId
       WHERE s.status = 'error'
    ), historical_child_flags AS (
      SELECT a.sourceJobId, a.sourceRowNumber,
             MAX(CASE WHEN historicalChild.status IN ('staging', 'queued', 'running', 'paused') THEN 1 ELSE 0 END) AS hasActiveChild,
             MAX(CASE WHEN historicalChild.id IS NULL THEN 1 ELSE 0 END) AS hasMissingOrForeignChild,
             MAX(CASE WHEN historicalResult.inventoryId IS NOT NULL
                       OR (historicalStage.status = 'success'
                           AND historicalVersion.guardKind = 'existing'
                           AND historicalVersion.inventoryId IS NOT NULL)
                      THEN 1 ELSE 0 END) AS hasSuccessfulChild
        FROM inventory_import_repair_audits a
        LEFT JOIN inventory_import_jobs historicalChild
          ON CONVERT(historicalChild.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = a.repairJobId
         AND historicalChild.enterpriseId = ${scope.enterpriseId}
        LEFT JOIN inventory_import_results historicalResult
          ON historicalResult.jobId = historicalChild.id AND historicalResult.rowNumber = a.sourceRowNumber
        LEFT JOIN inventory_import_staging historicalStage
          ON historicalStage.jobId = historicalChild.id
         AND historicalStage.enterpriseId = ${scope.enterpriseId}
         AND historicalStage.rowNumber = a.sourceRowNumber
        LEFT JOIN inventory_import_row_versions historicalVersion
          ON historicalVersion.jobId = historicalChild.id AND historicalVersion.rowNumber = a.sourceRowNumber
       WHERE a.enterpriseId = ${scope.enterpriseId} AND a.repairJobId IS NOT NULL
       GROUP BY a.sourceJobId, a.sourceRowNumber
    )
    SELECT COUNT(*) AS remainingRows,
           COALESCE(SUM(CASE
             WHEN j.dataOwnerUserId <> ${dismissAccess.dataOwnerUserId}
               OR (${canDismissAll} = 0 AND j.createdByUserId <> ${scope.userId})
             THEN 1 ELSE 0 END), 0) AS permissionRows,
           COALESCE(SUM(CASE
             WHEN j.dataOwnerUserId = ${dismissAccess.dataOwnerUserId}
              AND (${canDismissAll} = 1 OR j.createdByUserId = ${scope.userId})
              AND (j.status IN ('staging', 'queued', 'running', 'paused')
                   OR child.status IN ('staging', 'queued', 'running', 'paused')
                   OR COALESCE(historical_child_flags.hasActiveChild, 0) = 1)
             THEN 1 ELSE 0 END), 0) AS processingRows
      FROM source_rows src
      INNER JOIN scoped_jobs j ON j.id = src.jobId AND j.enterpriseId = ${scope.enterpriseId}
      LEFT JOIN inventory_import_results originalResult
        ON originalResult.jobId = src.jobId AND originalResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_repairs rp
        ON rp.sourceJobId = CONVERT(src.jobId USING utf8mb4) COLLATE utf8mb4_unicode_ci
       AND rp.sourceRowNumber = src.rowNumber
       AND rp.enterpriseId = j.enterpriseId
      LEFT JOIN inventory_import_jobs child
        ON CONVERT(child.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = rp.repairJobId
       AND child.enterpriseId = j.enterpriseId
      LEFT JOIN inventory_import_results childResult
        ON childResult.jobId = child.id AND childResult.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_staging childStage
        ON childStage.jobId = child.id
       AND childStage.enterpriseId = j.enterpriseId
       AND childStage.rowNumber = src.rowNumber
      LEFT JOIN inventory_import_row_versions childVersion
        ON childVersion.jobId = child.id AND childVersion.rowNumber = src.rowNumber
      LEFT JOIN historical_child_flags
        ON historical_child_flags.sourceJobId = CONVERT(src.jobId USING utf8mb4) COLLATE utf8mb4_unicode_ci
       AND historical_child_flags.sourceRowNumber = src.rowNumber
     WHERE ${visibleExceptionSql(deps)}
  `);
  const row = rows[0] ?? {};
  const remainingRows = Number(row.remainingRows ?? 0);
  const permissionRows = Number(row.permissionRows ?? 0);
  const processingRows = Number(row.processingRows ?? 0);
  return {
    remainingRows,
    remainingReasons: {
      permissionRows,
      processingRows,
      protectedRows: remainingRows - permissionRows - processingRows,
    },
  };
}

async function clearRepairs(deps, ctx, input) {
  const scope = requireScope(ctx);
  const db = await deps.getDb();
  if (!db) throw new Error("数据库不可用");
  return db.transaction(async tx => {
    // Lock authoritative entitlement before the receipt or any repair row. This
    // serializes membership revocation and ownership/data-owner handoffs ahead
    // of a clear request, instead of trusting the request context snapshot.
    const dismissAccess = await readDismissAccess(tx, deps, scope, true);
    if (!dismissAccess.canUsePublish) throw new Error("当前库存发布权限已失效，不能清空");
    // The unique audit key is the request lock.  The no-op update preserves an
    // existing receipt; it never lets a caller overwrite another scope's audit.
    await query(tx, deps.sql`
      INSERT INTO inventory_import_repair_audits
        (sourceJobId, sourceRowNumber, enterpriseId, actorUserId, action, revision,
         requestId, correctedJson, repairJobId, outcome, errorMessage)
      VALUES
        (${clearBatchSourceId(scope)}, 0, ${scope.enterpriseId}, ${scope.userId}, 'clear', 0,
         ${input.requestId}, ${JSON.stringify({ _clearBatch: true })}, NULL, 'processing', NULL)
      ON DUPLICATE KEY UPDATE id = id
    `);
    const batchAudit = await readClearBatchAudit(tx, deps, scope, input.requestId, true);
    if (!batchAudit) throw new Error("清空请求与当前企业或用户不匹配");
    if (String(batchAudit.outcome) !== "processing") {
      const receipt = safeJson(batchAudit.correctedJson, {});
      const remainingRows = nullableNumber(receipt.remainingRows);
      const reasons = safeJson(receipt.remainingReasons, null);
      const reasonValues = reasons
        ? [reasons.permissionRows, reasons.processingRows, reasons.protectedRows]
        : [];
      const validReasons = reasons && reasonValues.every(value => Number.isSafeInteger(value) && value >= 0)
        && remainingRows !== null && reasonValues.reduce((sum, value) => sum + value, 0) === remainingRows;
      return {
        scopeKey: scope.scopeKey,
        clearedRows: Number(receipt.clearedRows ?? 0),
        skippedRows: Number(receipt.skippedRows ?? 0),
        // Older receipts predate this field. Return null rather than recalculate
        // against later uploads and falsely present a changing count as replayed.
        remainingRows: remainingRows !== null && remainingRows >= 0 ? remainingRows : null,
        remainingReasons: validReasons
          ? {
            permissionRows: reasons.permissionRows,
            processingRows: reasons.processingRows,
            protectedRows: reasons.protectedRows,
          }
          : null,
        idempotent: true,
      };
    }

    let clearedRows = 0;
    let skippedRows = 0;
    const candidates = await listClearCandidateIds(tx, deps, scope, dismissAccess);
    if (candidates.length > 10000) {
      throw new Error("本次最多清空10000条问题行，请稍后重试");
    }
    for (const candidate of candidates) {
      const jobId = String(candidate.jobId);
      const rowNumber = Number(candidate.rowNumber);
      let source;
      try {
        // Re-lock and re-read every mutable entity after the candidate snapshot.
        // Save/submit retain their creator-only lockSource default; clear has
        // already proved its separate canDismiss authorization above.
        source = await lockSource(tx, deps, scope, jobId, rowNumber, false);
      } catch (error) {
        // Only lockSource's exact stale-source business outcomes can be skipped.
        // SQL faults must abort so the transaction rolls back every prior marker/audit.
        if (!(error instanceof Error) || !CLEAR_LOCK_SKIP_MESSAGES.has(error.message)) throw error;
        skippedRows += 1;
        continue;
      }
      if (!canDismissSource(scope, dismissAccess, source.job)) {
        skippedRows += 1;
        continue;
      }
      const original = await query(tx, deps.sql`
        SELECT inventoryId FROM inventory_import_results
         WHERE jobId = ${jobId} AND rowNumber = ${rowNumber}
         LIMIT 1 FOR UPDATE
      `);
      if (original[0]) {
        skippedRows += 1;
        continue;
      }
      const repair = await readRepair(tx, deps, jobId, rowNumber, true);
      if (repair && (Number(repair.enterpriseId) !== scope.enterpriseId
        || Number(repair.sourceDataOwnerUserId) !== Number(source.job.dataOwnerUserId)
        || Number(repair.sourceCreatedByUserId) !== Number(source.job.createdByUserId))) {
        // A corrupt/foreign pointer is not authority to modify another record.
        skippedRows += 1;
        continue;
      }
      if (isClearMarked(repair) || String(repair?.status ?? "") === "cleared") {
        skippedRows += 1;
        continue;
      }
      const childAttempts = await lockedChildAttempts(tx, deps, repair, jobId, rowNumber, scope.enterpriseId);
      const currentState = repair?.repairJobId
        ? (childAttempts.find(attempt => attempt.repairJobId === String(repair.repairJobId))?.state
          ?? { job: null, inventoryId: null, stagingStatus: null, errorMessage: null })
        : { job: null, inventoryId: null, stagingStatus: null, errorMessage: null };
      // A missing state is deliberately protected: it is an orphan or foreign
      // child reference, neither of which can prove it is safe to clear.
      if (childAttempts.some(({ state }) => !state.job
        || state.inventoryId !== null
        || (state.job && ACTIVE_JOB_STATUSES.has(state.job.status)))) {
        skippedRows += 1;
        continue;
      }
      const status = toRepairStatus({
        repairStatus: repair?.status,
        repairInventoryId: repair?.inventoryId,
        childJobStatus: currentState.job?.status,
        childInventoryId: currentState.inventoryId,
      });
      if (!["pending", "ready", "error"].includes(status)) {
        skippedRows += 1;
        continue;
      }

      const markerJson = JSON.stringify({ _cleared: true, _clearRequestId: input.requestId });
      if (repair) {
        await query(tx, deps.sql`
          UPDATE inventory_import_repairs
             SET correctedJson = JSON_SET(
               COALESCE(correctedJson, JSON_OBJECT()),
               '$._cleared', CAST(1 AS UNSIGNED),
               '$._clearRequestId', ${input.requestId}
             )
           WHERE id = ${repair.id}
        `);
      } else {
        await query(tx, deps.sql`
          INSERT INTO inventory_import_repairs
            (sourceJobId, sourceRowNumber, enterpriseId, sourceCreatedByUserId, sourceDataOwnerUserId,
             correctedJson, revision, status, errorMessage)
          VALUES
            (${jobId}, ${rowNumber}, ${scope.enterpriseId}, ${source.job.createdByUserId},
             ${source.job.dataOwnerUserId}, ${markerJson}, 0, 'pending', NULL)
        `);
      }
      await writeAudit(tx, deps, {
        sourceJobId: jobId,
        sourceRowNumber: rowNumber,
        enterpriseId: scope.enterpriseId,
        actorUserId: scope.userId,
        action: "clear",
        revision: Number(repair?.revision ?? 0),
        requestId: input.requestId,
        correctedJson: markerJson,
        repairJobId: null,
        outcome: "cleared",
        errorMessage: null,
      });
      clearedRows += 1;
    }

    // Same transaction and shared visibility predicate as repairList/countListRows.
    // Read-only rows are classified as permissionRows rather than mislabeled as
    // processing; source/current/historical active work is processingRows.
    const { remainingRows, remainingReasons } = await countClearRemainingReasons(tx, deps, scope, dismissAccess);
    await query(tx, deps.sql`
      UPDATE inventory_import_repair_audits
         SET correctedJson = ${JSON.stringify({ _clearBatch: true, clearedRows, skippedRows, remainingRows, remainingReasons })},
             outcome = 'cleared', errorMessage = NULL
       WHERE id = ${batchAudit.id}
    `);
    return { scopeKey: scope.scopeKey, clearedRows, skippedRows, remainingRows, remainingReasons, idempotent: false };
  });
}

async function saveRepair(deps, ctx, input) {
  const scope = requireScope(ctx);
  const db = await deps.getDb();
  if (!db) throw new Error("数据库不可用");
  await db.transaction(async tx => {
    const source = await lockSource(tx, deps, scope, input.jobId, input.rowNumber);
    await assertNoOriginalResult(tx, deps, input.jobId, input.rowNumber);
    const corrected = cleanCorrection(input.row, input.rowNumber);
    const serialised = JSON.stringify(corrected);
    const replay = await readAudit(tx, deps, input.jobId, input.rowNumber, "save", input.requestId, true);
    if (replay) {
      const replayJson = safeJson(replay.correctedJson);
      if (Number(replay.revision) !== input.revision + 1
        || stableStringify(replayJson) !== stableStringify(corrected)) {
        throw new Error("请求号已用于不同修正内容，请刷新后重新保存");
      }
      return;
    }
    const repair = await readRepair(tx, deps, input.jobId, input.rowNumber, true);
    if (repair && (Number(repair.enterpriseId) !== scope.enterpriseId
      || Number(repair.sourceDataOwnerUserId) !== Number(source.job.dataOwnerUserId)
      || Number(repair.sourceCreatedByUserId) !== Number(source.job.createdByUserId))) {
      throw new Error("修正记录归属异常，请联系管理员");
    }
    if (isClearMarked(repair) || String(repair?.status ?? "") === "cleared") {
      throw new Error("该问题行已清空，不能再次保存或补发");
    }
    await assertNoBlockingHistoricalAttempt(tx, deps, input.jobId, input.rowNumber, scope.enterpriseId);
    if (repair && ["success", "existing"].includes(String(repair.status))) {
      throw new Error("该修正行已有处理结果，不能覆盖保存");
    }
    if (repair && String(repair.status) === "queued" && !repair.repairJobId) {
      throw new Error("该修正行状态异常，请刷新后联系平台管理员");
    }
    const currentRevision = Number(repair?.revision ?? 0);
    if (input.revision !== currentRevision) throw new Error("修正版本冲突，请刷新后重新编辑");
    const verdict = validationMessage(deps.importRowSchema, corrected);
    const nextRevision = currentRevision + 1;
    const nextStatus = verdict.ok ? "ready" : "pending";
    if (!repair) {
      await query(tx, deps.sql`
        INSERT INTO inventory_import_repairs
          (sourceJobId, sourceRowNumber, enterpriseId, sourceCreatedByUserId, sourceDataOwnerUserId,
           correctedJson, revision, status, errorMessage)
        VALUES
          (${input.jobId}, ${input.rowNumber}, ${scope.enterpriseId}, ${source.job.createdByUserId},
           ${source.job.dataOwnerUserId}, ${serialised}, ${nextRevision}, ${nextStatus}, ${verdict.message})
      `);
    } else {
      await query(tx, deps.sql`
        UPDATE inventory_import_repairs
           SET correctedJson = ${serialised}, revision = ${nextRevision}, status = ${nextStatus},
               errorMessage = ${verdict.message}, repairJobId = NULL, repairRequestId = NULL, inventoryId = NULL
         WHERE id = ${repair.id}
      `);
    }
    await writeAudit(tx, deps, {
      sourceJobId: input.jobId,
      sourceRowNumber: input.rowNumber,
      enterpriseId: scope.enterpriseId,
      actorUserId: scope.userId,
      action: "save",
      revision: nextRevision,
      requestId: input.requestId,
      correctedJson: serialised,
      repairJobId: null,
      outcome: nextStatus,
      errorMessage: verdict.message,
    });
  });
  return getOneDto(db, deps, scope, input.jobId, input.rowNumber);
}

async function submitRepair(deps, ctx, input) {
  const scope = requireScope(ctx);
  const db = await deps.getDb();
  if (!db) throw new Error("数据库不可用");
  return db.transaction(async tx => {
    const source = await lockSource(tx, deps, scope, input.jobId, input.rowNumber);
    await assertNoOriginalResult(tx, deps, input.jobId, input.rowNumber);
    const replay = await readAudit(tx, deps, input.jobId, input.rowNumber, "submit", input.requestId, true);
    const repair = await readRepair(tx, deps, input.jobId, input.rowNumber, true);
    if (repair && (Number(repair.enterpriseId) !== scope.enterpriseId
      || Number(repair.sourceDataOwnerUserId) !== Number(source.job.dataOwnerUserId)
      || Number(repair.sourceCreatedByUserId) !== Number(source.job.createdByUserId))) {
      throw new Error("修正记录归属异常，请联系管理员");
    }
    if (isClearMarked(repair) || String(repair?.status ?? "") === "cleared") {
      throw new Error("该问题行已清空，不能再次保存或补发");
    }
    if (replay) {
      const state = replay.repairJobId
        ? await childState(tx, deps, replay.repairJobId, input.rowNumber, scope.enterpriseId)
        : { job: null, inventoryId: null, stagingStatus: null, errorMessage: null };
      const status = state.inventoryId !== null ? "success"
        : state.job && ACTIVE_JOB_STATUSES.has(state.job.status) ? "queued"
          : String(replay.outcome ?? "error");
      return {
        scopeKey: scope.scopeKey,
        jobId: String(replay.repairJobId ?? input.jobId),
        status,
        idempotent: true,
      };
    }
    if (!repair || !repair.correctedJson) throw new Error("请先保存修正内容后再补发");
    if (input.revision !== Number(repair.revision)) throw new Error("修正版本冲突，请刷新后重新提交");
    const prior = await childState(tx, deps, repair.repairJobId, input.rowNumber, scope.enterpriseId);
    if (prior.inventoryId !== null) {
      await query(tx, deps.sql`
        UPDATE inventory_import_repairs
           SET status = 'success', inventoryId = ${prior.inventoryId}, errorMessage = NULL
         WHERE id = ${repair.id}
      `);
      throw new Error("该修正行已成功处理，不能再次补发");
    }
    if (prior.job && ACTIVE_JOB_STATUSES.has(prior.job.status)) {
      return {
        scopeKey: scope.scopeKey,
        jobId: prior.job.id,
        status: "queued",
        idempotent: true,
      };
    }
    await assertNoBlockingHistoricalAttempt(tx, deps, input.jobId, input.rowNumber, scope.enterpriseId);
    if (String(repair.status) === "success" || String(repair.status) === "existing") {
      throw new Error("该修正行已有处理结果，不能再次补发");
    }
    const corrected = cleanCorrection(safeJson(repair.correctedJson), input.rowNumber);
    const verdict = validationMessage(deps.importRowSchema, corrected);
    if (!verdict.ok || !verdict.data) {
      await query(tx, deps.sql`
        UPDATE inventory_import_repairs
           SET status = 'pending', errorMessage = ${verdict.message}
         WHERE id = ${repair.id}
      `);
      throw new Error(`修正内容未通过校验：${verdict.message}`);
    }
    const normalizedPart = String(verdict.data.partNumber).normalize("NFKC").trim().toUpperCase();
    const existing = await query(tx, deps.sql`
      SELECT id, status FROM inventories
       WHERE enterpriseId = ${scope.enterpriseId}
         AND userId = ${source.job.dataOwnerUserId}
         AND partNumberNormalized = ${normalizedPart}
         AND status IN ('draft', 'published')
       ORDER BY id ASC
       LIMIT 1 FOR UPDATE
    `);
    if (existing[0]) {
      throw new Error("该型号已有待发布或已发布库存，请在原库存中处理，不能补发");
    }
    const correctedJson = JSON.stringify(corrected);
    const requestId = `${REPAIR_PREFIX}${input.requestId}`;
    const contentHash = digest(stableStringify(corrected));
    const created = await deps.clones.create({
      enterpriseId: scope.enterpriseId,
      dataOwnerUserId: Number(source.job.dataOwnerUserId),
      createdByUserId: scope.userId,
      ownerUserId: Number(source.job.ownerUserId),
      clientRequestId: requestId,
      fileName: `修正-${String(source.job.fileName).slice(0, 240)}`,
      fileHash: contentHash,
      manifestHash: digest(`${input.jobId}:${input.rowNumber}:${Number(repair.revision)}:${contentHash}`),
      totalRows: 1,
      saveAs: String(source.job.saveAs) === "draft" ? "draft" : "published",
    }, tx);
    const repairJobId = String(created.job.id);
    const staged = await deps.clones.stage({
      jobId: repairJobId,
      enterpriseId: scope.enterpriseId,
      actorUserId: scope.userId,
      batchIndex: 0,
      startRow: 1,
      rows: [verdict.data],
    }, tx);
    const finalized = await deps.clones.finalize({
      jobId: repairJobId,
      enterpriseId: scope.enterpriseId,
      actorUserId: scope.userId,
    }, tx);
    if (String(finalized.job.status) !== "queued") {
      throw new Error("修正子任务未能进入后台队列");
    }
    await query(tx, deps.sql`
      UPDATE inventory_import_repairs
         SET status = 'queued', repairJobId = ${repairJobId}, repairRequestId = ${input.requestId},
             errorMessage = NULL, inventoryId = NULL
       WHERE id = ${repair.id}
    `);
    await writeAudit(tx, deps, {
      sourceJobId: input.jobId,
      sourceRowNumber: input.rowNumber,
      enterpriseId: scope.enterpriseId,
      actorUserId: scope.userId,
      action: "submit",
      revision: Number(repair.revision),
      requestId: input.requestId,
      correctedJson,
      repairJobId,
      outcome: "queued",
      errorMessage: null,
    });
    return {
      scopeKey: scope.scopeKey,
      jobId: repairJobId,
      status: "queued",
      idempotent: Boolean(created.idempotent || staged.idempotent || finalized.idempotent),
    };
  });
}

/**
 * Adds repair endpoints to the existing importInventory router.  The original
 * procedures and import protocol remain unchanged.
 */
export function installInventoryImportRepairs(deps) {
  assertDependencies(deps);
  const { z, inventoryPublishProcedure } = deps;
  const jobId = z.string().uuid();
  const rowNumber = z.number().int().min(2);
  const requestId = z.string().uuid();
  const procedures = {
    repairList: inventoryPublishProcedure
      .input(z.object({
        jobId: jobId.optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      }).optional())
      .query(async ({ ctx, input }) => {
        try {
          const scope = requireScope(ctx);
          const db = await deps.getDb();
          if (!db) throw new Error("数据库不可用");
          const safeInput = input ?? { page: 1, limit: 20 };
          const items = (await getListRows(db, deps, scope, safeInput)).map(row => toItem(scope.scopeKey, scope.userId, row));
          const total = await countListRows(db, deps, scope, safeInput.jobId ?? null);
          const page = Number(safeInput.page ?? 1);
          const limit = Number(safeInput.limit ?? 20);
          return { scopeKey: scope.scopeKey, items, total, page, pageCount: Math.ceil(total / limit) };
        } catch (error) {
          throwBusiness(deps, error);
        }
      }),
    repairExport: inventoryPublishProcedure
      .input(z.object({
        page: z.number().int().min(1).max(100).default(1),
        limit: z.number().int().min(1).max(2000).default(1000),
      }).optional())
      .query(async ({ ctx, input }) => {
        try {
          const scope = requireScope(ctx);
          const db = await deps.getDb();
          if (!db) throw new Error("数据库不可用");
          const safeInput = input ?? { page: 1, limit: 1000 };
          const page = Number(safeInput.page ?? 1);
          const limit = Number(safeInput.limit ?? 1000);
          const rows = await getListRows(db, deps, scope, safeInput, null, {
            maxLimit: 2001,
            take: limit + 1,
            exportOnly: true,
          });
          const hasMore = rows.length > limit;
          const items = rows.slice(0, limit).map(row => toItem(scope.scopeKey, scope.userId, row));
          return {
            scopeKey: scope.scopeKey,
            items,
            page,
            limit,
            hasMore,
            nextPage: hasMore && page < 100 ? page + 1 : null,
          };
        } catch (error) {
          throwBusiness(deps, error);
        }
      }),
    repairClear: inventoryPublishProcedure
      .input(z.object({ requestId }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await clearRepairs(deps, ctx, input);
        } catch (error) {
          throwBusiness(deps, error);
        }
      }),
    repairSave: inventoryPublishProcedure
      .input(z.object({
        jobId,
        rowNumber,
        revision: z.number().int().min(0),
        requestId,
        row: z.record(z.string(), z.unknown()),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await saveRepair(deps, ctx, input);
        } catch (error) {
          throwBusiness(deps, error);
        }
      }),
    repairSubmit: inventoryPublishProcedure
      .input(z.object({
        jobId,
        rowNumber,
        revision: z.number().int().min(0),
        requestId,
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await submitRepair(deps, ctx, input);
        } catch (error) {
          throwBusiness(deps, error);
        }
      }),
  };
  const definition = deps.importInventoryRouter?._def;
  const procedureTarget = definition?.procedures;
  const recordTarget = definition?.record;
  if (!procedureTarget || !recordTarget) throw new Error("无法注册库存导入待修正路由");
  for (const [name, procedure] of Object.entries(procedures)) {
    if (procedureTarget[name] || recordTarget[name]) {
      throw new Error(`库存导入待修正路由已存在：${name}`);
    }
    // tRPC v11 flattens nested HTTP paths from _def.record.  Keep the
    // corresponding procedure map in sync for direct callers and introspection.
    recordTarget[name] = procedure;
    procedureTarget[name] = procedure;
  }
  // Release observation only: emitted once per router installation, never per
  // API request, and carries no customer or exception-row data.
  console.info(`[inventory-import-repairs] exception-clear-dismiss-v1 installed pid=${process.pid}`);
  return procedures;
}
