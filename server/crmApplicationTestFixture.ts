import {
  ENTERPRISE_SERVICE_AGREEMENT_HASH,
  ENTERPRISE_SERVICE_AGREEMENT_VERSION,
} from "../shared/enterpriseServiceAgreementSummary";
import { accessSync, constants } from "node:fs";
import { basename } from "node:path";
import { eq, sql } from "drizzle-orm";
import { merchants } from "../drizzle/schema";
import { getDb } from "./db";
import { isAllowedFrozenTestDatabase } from "../tests/frozenTestEnvironment";
import { platformDatabaseIdentifier } from "./cnRegistrationPolicy";

const NORMAL_CRM_ADMIN_FIXTURE_DATABASE = "migration_v2_testinfra_admin_test";
const NORMAL_CRM_PLATFORM_FIXTURE_DATABASE = "migration_v2_testinfra_platform_test";
const LOCAL_NETWORK_GUARD = "local-network-only.so";
const EXACT_NETWORK_GUARD = "/home/ubuntu/51_migration_20261029/tests/local-network-only.so";

type CrmFixtureEnvironment = Readonly<Record<string, string | undefined>>;

function hasReadableLocalNetworkGuard(preload: string) {
  if (preload !== EXACT_NETWORK_GUARD) return false;
  return preload.split(":").some((entry) => {
    if (!entry || basename(entry) !== LOCAL_NETWORK_GUARD) return false;
    try {
      accessSync(entry, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Fail closed before getDb() can be reached. The CRM callers write merchants
 * into the dedicated admin schema, while the enablement guard writes only its
 * own companies/enterprises identities into the separate platform schema.
 */
export function assertCrmApplicationFixtureEnvironment(
  environment: CrmFixtureEnvironment = process.env,
  guardReadable: (preload: string) => boolean = hasReadableLocalNetworkGuard,
) {
  if (environment.NODE_ENV !== "test") {
    throw new Error("CRM_FIXTURE_REQUIRES_NODE_ENV_TEST");
  }
  if (environment.LD_PRELOAD !== EXACT_NETWORK_GUARD || !guardReadable(environment.LD_PRELOAD)) {
    throw new Error("CRM_FIXTURE_REQUIRES_LOCAL_NETWORK_GUARD");
  }
  if (!environment.DATABASE_URL) {
    throw new Error("CRM_FIXTURE_DATABASE_URL_REQUIRED");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error("CRM_FIXTURE_DATABASE_URL_INVALID");
  }
  const database = decodeURIComponent(databaseUrl.pathname.slice(1));
  let platformDatabase: string;
  try {
    platformDatabase = platformDatabaseIdentifier(environment.PLATFORM_DB_NAME);
  } catch {
    throw new Error("CRM_FIXTURE_PLATFORM_DATABASE_INVALID");
  }
  const platformUrl = new URL(databaseUrl);
  platformUrl.pathname = `/${platformDatabase}`;
  if (
    databaseUrl.protocol !== "mysql:"
    || databaseUrl.hostname !== "127.0.0.1"
    || databaseUrl.port !== "13307"
    || databaseUrl.username !== "root"
    || databaseUrl.password !== ""
    || (database !== NORMAL_CRM_ADMIN_FIXTURE_DATABASE && !isAllowedFrozenTestDatabase(databaseUrl.href))
    || (platformDatabase !== NORMAL_CRM_PLATFORM_FIXTURE_DATABASE && !isAllowedFrozenTestDatabase(platformUrl.href))
  ) {
    throw new Error("CRM_FIXTURE_REQUIRES_ADMIN_ERP_LOOPBACK_SCHEMA");
  }

  return {
    database,
    databaseUrl: databaseUrl.toString(),
    platformDatabase,
    platformDatabaseUrl: platformUrl.toString(),
  };
}

function guardedCrmPlatformSchema(): string {
  return assertCrmApplicationFixtureEnvironment().platformDatabase;
}

type StrictCrmApplicationOverrides = {
  companyName: string;
  creditCode: string;
  portalUserId?: string | null;
  companyType?: string;
  companyRole?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  legalPersonName?: string;
  registeredAddress?: string;
  settlementAccountName?: string;
  settlementAccount?: string;
  settlementBank?: string;
  businessScope?: string | null;
  note?: string | null;
};

/**
 * Valid test submission for the public CRM-opening contract.  Tests which need
 * an unauthenticated account deliberately omit portalUserId; the private key
 * remains well-formed, but the server must reject before creating a merchant.
 */
export function strictCrmApplicationFixture(
  overrides: StrictCrmApplicationOverrides,
) {
  const evidenceOwner = overrides.portalUserId?.trim() || "unbound-test-user";
  return {
    companyName: overrides.companyName,
    creditCode: overrides.creditCode,
    portalUserId: overrides.portalUserId ?? undefined,
    companyType: overrides.companyType ?? "有限责任公司",
    companyRole: overrides.companyRole ?? "supplier",
    contactName: overrides.contactName ?? "测试联系人",
    contactPhone: overrides.contactPhone ?? "13800001111",
    contactEmail: overrides.contactEmail ?? "crm-fixture@example.test",
    legalPersonName: overrides.legalPersonName ?? "测试法定代表人",
    registeredAddress: overrides.registeredAddress ?? "上海市浦东新区测试路 51 号",
    settlementAccountName: overrides.settlementAccountName ?? overrides.companyName,
    settlementAccount: overrides.settlementAccount ?? "6222020202021234",
    settlementBank: overrides.settlementBank ?? "测试银行浦东支行",
    businessScope: overrides.businessScope ?? "电子元器件销售",
    licenseObjectKey: `licenses/user-${evidenceOwner}-business-license.pdf`,
    agreementAccepted: true as const,
    agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION,
    agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
    ...(overrides.note !== undefined ? { note: overrides.note } : {}),
  };
}

export type ApprovedCnCrmEnablementFixture = {
  creditCode: string;
  enterpriseId: number;
  portalUserId: string;
};

/**
 * The real CN enablement gate verifies an approved main-site company and
 * enterprise whose three ownership values equal the CRM owner. This test-only
 * fixture creates that minimum state in the dedicated loopback schema; it does
 * not fake or relax the production CAS.
 */
export async function prepareApprovedCnCrmEnablement(input: {
  merchantId: number;
  creditCode: string;
  portalUserId: string;
}) {
  assertCrmApplicationFixtureEnvironment();
  const ownerId = Number(input.portalUserId);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new Error("TEST_PORTAL_OWNER_MUST_BE_POSITIVE_INTEGER");
  }
  const platformSchema = guardedCrmPlatformSchema();
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");
  await db.update(merchants)
    .set({ status: "approved" })
    .where(eq(merchants.id, input.merchantId));
  await db.execute(sql`
    DELETE FROM ${sql.raw(`${platformSchema}.companies`)}
    WHERE creditCode = ${input.creditCode}
      AND enterpriseId = ${ownerId}
      AND userId = ${ownerId}
  `);
  await db.execute(sql`
    DELETE FROM ${sql.raw(`${platformSchema}.enterprises`)}
    WHERE creditCode = ${input.creditCode}
      AND id = ${ownerId}
      AND superAdminUserId = ${ownerId}
      AND crmDataOwnerUserId = ${ownerId}
  `);
  await db.execute(sql`
    INSERT INTO ${sql.raw(`${platformSchema}.enterprises`)}
      (id, creditCode, registrationRegion, companyName, superAdminUserId, crmDataOwnerUserId)
    VALUES (${ownerId}, ${input.creditCode}, 'CN', 'CRM enablement test enterprise', ${ownerId}, ${ownerId})
  `);
  await db.execute(sql`
    INSERT INTO ${sql.raw(`${platformSchema}.companies`)}
      (userId, enterpriseId, creditCode, registrationRegion, reviewStatus, pendingDraft)
      VALUES (${ownerId}, ${ownerId}, ${input.creditCode}, 'CN', 'approved', NULL)
  `);
  return {
    creditCode: input.creditCode,
    enterpriseId: ownerId,
    portalUserId: input.portalUserId,
  } satisfies ApprovedCnCrmEnablementFixture;
}

export async function cleanupApprovedCnCrmEnablement(
  fixture: ApprovedCnCrmEnablementFixture,
) {
  assertCrmApplicationFixtureEnvironment();
  const ownerId = Number(fixture.portalUserId);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0 || fixture.enterpriseId !== ownerId) {
    throw new Error("TEST_CRM_FIXTURE_IDENTITY_INVALID");
  }
  const platformSchema = guardedCrmPlatformSchema();
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    DELETE FROM ${sql.raw(`${platformSchema}.companies`)}
    WHERE creditCode = ${fixture.creditCode}
      AND enterpriseId = ${fixture.enterpriseId}
      AND userId = ${ownerId}
  `);
  await db.execute(sql`
    DELETE FROM ${sql.raw(`${platformSchema}.enterprises`)}
    WHERE creditCode = ${fixture.creditCode}
      AND id = ${fixture.enterpriseId}
      AND superAdminUserId = ${ownerId}
      AND crmDataOwnerUserId = ${ownerId}
  `);
}
