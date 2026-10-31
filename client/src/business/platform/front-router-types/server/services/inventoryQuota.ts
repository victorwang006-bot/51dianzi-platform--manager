import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { enterprises, enterpriseInventoryQuotas } from "../../drizzle/schema";
import {
  INVENTORY_PUBLISHED_ROW_LIMIT,
  INVENTORY_PUBLISHED_ROW_LIMIT_MAX,
} from "../../../shared/inventorySafetyLimits";
import {
  INVENTORY_IMPORT_DAILY_ROW_LIMIT_MAX,
  INVENTORY_IMPORT_DEFAULT_DAILY_ROW_LIMIT,
} from "../../../shared/inventoryImport";

/**
 * 企业库存额度只由数据库中 enterpriseId + dataOwnerUserId 的绑定决定。
 * 调用方只能传入已经由服务端权限上下文得到的企业与稳定数据归属；绝不接收客户端额度。
 */
export type InventoryQuota = {
  publishedRowLimit: number;
  dailyImportRowLimit: number;
  source: "default" | "enterprise";
};

export type InventoryQuotaProjection = {
  /** enterprises.id = requested enterpriseId and crmDataOwnerUserId = requested owner. */
  enterpriseBindingMatches: boolean;
  /** Same CRM owner must resolve to exactly one enterprise before an exception may apply. */
  enterpriseCountForDataOwner: number;
  quota: {
    enterpriseId: number;
    dataOwnerUserId: number;
    publishedRowLimit: number;
    dailyImportRowLimit: number;
    enabled: boolean;
  } | null;
};

export type InventoryQuotaEnvironment = {
  /**
   * Existing setting: only changes the ordinary enterprise default. It intentionally does not
   * silently become a global cap for an approved enterprise exception.
   */
  ordinaryDailyImportRowLimit?: unknown;
  /** Explicit emergency/global protection that caps both ordinary and enterprise limits. */
  globalDailyImportHardLimit?: unknown;
};

export const INVENTORY_QUOTA_DEPLOYMENT_GUARD_PATH = "/run/dianzi51-inventory-quota-deploy.guard";

/** Deployment creates this root-owned marker before replacing web/worker processes. */
export function isInventoryQuotaDeploymentBusy(): boolean {
  return existsSync(INVENTORY_QUOTA_DEPLOYMENT_GUARD_PATH);
}

/** Only queue-creating or queue-resuming operations call this; reads and cancellation remain available. */
export function assertInventoryQuotaDeploymentReady(): void {
  if (isInventoryQuotaDeploymentBusy()) {
    throw new Error("库存服务正在更新，请稍后重试");
  }
}

function boundedPositiveInteger(value: unknown, maximum: number): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= maximum
    ? value
    : null;
}

function environmentPositiveInteger(value: unknown, maximum: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return boundedPositiveInteger(parsed, maximum);
}

/** Exposed for a strict pure-policy test; invalid environment data never increases a limit. */
export function resolveInventoryQuotaEnvironment(
  environment: InventoryQuotaEnvironment = {},
): Pick<InventoryQuota, "dailyImportRowLimit"> & { globalDailyImportHardLimit: number | null } {
  const ordinaryOverride = environmentPositiveInteger(
    environment.ordinaryDailyImportRowLimit,
    INVENTORY_IMPORT_DEFAULT_DAILY_ROW_LIMIT,
  );
  const globalDailyImportHardLimit = environmentPositiveInteger(
    environment.globalDailyImportHardLimit,
    INVENTORY_IMPORT_DAILY_ROW_LIMIT_MAX,
  );
  const ordinaryDailyImportRowLimit = ordinaryOverride ?? INVENTORY_IMPORT_DEFAULT_DAILY_ROW_LIMIT;
  return {
    dailyImportRowLimit: globalDailyImportHardLimit == null
      ? ordinaryDailyImportRowLimit
      : Math.min(ordinaryDailyImportRowLimit, globalDailyImportHardLimit),
    globalDailyImportHardLimit,
  };
}

export function inventoryPublishedLimitMessage(limit: number): string {
  return `每个企业最多同时上线${limit.toLocaleString()}条库存；请先下架部分在售库存后再发布`;
}

/**
 * Pure fail-closed policy. A record is an exception only when every identity fact is exact,
 * the owner has exactly one enterprise, it is explicitly enabled, and both stored limits are
 * bounded positive integers. Any ambiguity falls back to the safe ordinary quota.
 */
export function deriveInventoryQuota(
  projection: InventoryQuotaProjection,
  environment: InventoryQuotaEnvironment = {},
): InventoryQuota {
  const defaults = resolveInventoryQuotaEnvironment(environment);
  const quota = projection.quota;
  const exceptionIsTrusted = projection.enterpriseBindingMatches
    && projection.enterpriseCountForDataOwner === 1
    && quota?.enabled === true
    && boundedPositiveInteger(quota.publishedRowLimit, INVENTORY_PUBLISHED_ROW_LIMIT_MAX) != null
    && boundedPositiveInteger(quota.dailyImportRowLimit, INVENTORY_IMPORT_DAILY_ROW_LIMIT_MAX) != null;
  if (!exceptionIsTrusted || !quota) {
    return {
      publishedRowLimit: INVENTORY_PUBLISHED_ROW_LIMIT,
      dailyImportRowLimit: defaults.dailyImportRowLimit,
      source: "default",
    };
  }
  return {
    publishedRowLimit: boundedPositiveInteger(quota.publishedRowLimit, INVENTORY_PUBLISHED_ROW_LIMIT_MAX)!,
    dailyImportRowLimit: defaults.globalDailyImportHardLimit == null
      ? boundedPositiveInteger(quota.dailyImportRowLimit, INVENTORY_IMPORT_DAILY_ROW_LIMIT_MAX)!
      : Math.min(
          boundedPositiveInteger(quota.dailyImportRowLimit, INVENTORY_IMPORT_DAILY_ROW_LIMIT_MAX)!,
          defaults.globalDailyImportHardLimit,
        ),
    source: "enterprise",
  };
}

export function isInventoryQuotaExceeded(currentCount: number, limit: number, incomingCount = 1): boolean {
  return !Number.isSafeInteger(currentCount)
    || currentCount < 0
    || !Number.isSafeInteger(incomingCount)
    || incomingCount < 0
    || boundedPositiveInteger(limit, Math.max(INVENTORY_PUBLISHED_ROW_LIMIT_MAX, INVENTORY_IMPORT_DAILY_ROW_LIMIT_MAX)) == null
    || currentCount + incomingCount > limit;
}

function runtimeEnvironment(): InventoryQuotaEnvironment {
  return {
    ordinaryDailyImportRowLimit: process.env.INVENTORY_IMPORT_DAILY_ROW_LIMIT,
    globalDailyImportHardLimit: process.env.INVENTORY_IMPORT_GLOBAL_DAILY_HARD_LIMIT,
  };
}

export function resolveInventoryQuotaEnterpriseIdentity(
  input: { enterpriseId: number | null | undefined },
  enterpriseIdsForDataOwner: readonly number[],
): Pick<InventoryQuotaProjection, "enterpriseBindingMatches" | "enterpriseCountForDataOwner"> & {
  enterpriseId: number | null;
} {
  const enterpriseCountForDataOwner = enterpriseIdsForDataOwner.length;
  if (enterpriseCountForDataOwner !== 1) {
    return { enterpriseId: null, enterpriseBindingMatches: false, enterpriseCountForDataOwner };
  }
  const enterpriseId = enterpriseIdsForDataOwner[0];
  const explicitEnterpriseId = input.enterpriseId !== null && input.enterpriseId !== undefined;
  const requestedEnterpriseId = Number(input.enterpriseId);
  const explicitlyMatches = !explicitEnterpriseId
    || (Number.isSafeInteger(requestedEnterpriseId) && requestedEnterpriseId > 0 && requestedEnterpriseId === enterpriseId);
  return {
    // A legacy inventory with enterpriseId=NULL may use the one unambiguous enterprise for its
    // trusted CRM owner. An explicit, stale or forged enterprise ID never self-corrects.
    enterpriseId: explicitlyMatches ? enterpriseId : null,
    enterpriseBindingMatches: explicitlyMatches,
    enterpriseCountForDataOwner,
  };
}

/**
 * Read a quota through the authoritative enterprise ID + stable CRM owner binding. The caller
 * passes its database/transaction; this module never imports server/db, avoiding an import cycle.
 * `lockEnterprise` is used by import-job creation to serialize daily SUM checks on the enterprise row.
 */
export async function getInventoryQuota(
  database: any,
  input: { enterpriseId: number | null | undefined; dataOwnerUserId: number },
  options: { lockEnterprise?: boolean } = {},
): Promise<InventoryQuota> {
  const dataOwnerUserId = Number(input.dataOwnerUserId);
  const explicitEnterpriseId = input.enterpriseId !== null && input.enterpriseId !== undefined;
  const requestedEnterpriseId = Number(input.enterpriseId);
  if (
    !Number.isSafeInteger(dataOwnerUserId)
    || dataOwnerUserId <= 0
    || (explicitEnterpriseId && (!Number.isSafeInteger(requestedEnterpriseId) || requestedEnterpriseId <= 0))
  ) {
    return deriveInventoryQuota({ enterpriseBindingMatches: false, enterpriseCountForDataOwner: 0, quota: null }, runtimeEnvironment());
  }

  let ownerEnterprisesQuery = database
    .select({ enterpriseId: enterprises.id })
    .from(enterprises)
    .where(eq(enterprises.crmDataOwnerUserId, dataOwnerUserId))
    .limit(2);
  if (options.lockEnterprise) ownerEnterprisesQuery = ownerEnterprisesQuery.for("update");
  const ownerEnterprises = await ownerEnterprisesQuery;
  const identity = resolveInventoryQuotaEnterpriseIdentity(
    { enterpriseId: input.enterpriseId },
    ownerEnterprises.map((row: { enterpriseId: number }) => Number(row.enterpriseId)),
  );
  if (identity.enterpriseId == null) {
    return deriveInventoryQuota({ ...identity, quota: null }, runtimeEnvironment());
  }

  let bindingQuery = database
    .select({
      enterpriseId: enterprises.id,
      dataOwnerUserId: enterprises.crmDataOwnerUserId,
      quotaEnterpriseId: enterpriseInventoryQuotas.enterpriseId,
      quotaDataOwnerUserId: enterpriseInventoryQuotas.dataOwnerUserId,
      publishedRowLimit: enterpriseInventoryQuotas.publishedRowLimit,
      dailyImportRowLimit: enterpriseInventoryQuotas.dailyImportRowLimit,
      enabled: enterpriseInventoryQuotas.enabled,
    })
    .from(enterprises)
    .leftJoin(enterpriseInventoryQuotas, eq(enterpriseInventoryQuotas.enterpriseId, enterprises.id))
    .where(and(
      eq(enterprises.id, identity.enterpriseId),
      eq(enterprises.crmDataOwnerUserId, dataOwnerUserId),
    ))
    .limit(1);
  if (options.lockEnterprise) bindingQuery = bindingQuery.for("update");
  const binding = (await bindingQuery)[0];

  const quota = binding?.quotaEnterpriseId != null
    ? {
        enterpriseId: Number(binding.quotaEnterpriseId),
        dataOwnerUserId: Number(binding.quotaDataOwnerUserId),
        publishedRowLimit: Number(binding.publishedRowLimit),
        dailyImportRowLimit: Number(binding.dailyImportRowLimit),
        enabled: binding.enabled === true,
      }
    : null;
  return deriveInventoryQuota({
    enterpriseBindingMatches: identity.enterpriseBindingMatches
      && Boolean(binding)
      && Number(binding.enterpriseId) === identity.enterpriseId
      && Number(binding.dataOwnerUserId) === dataOwnerUserId
      && quota?.enterpriseId === identity.enterpriseId
      && quota?.dataOwnerUserId === dataOwnerUserId,
    enterpriseCountForDataOwner: identity.enterpriseCountForDataOwner,
    quota,
  }, runtimeEnvironment());
}
