import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

type DemandPublisherCompany = {
  companyId: unknown;
  companyName: unknown;
  publisherCompanyName?: unknown;
  creditCode: unknown;
  registrationRegion: unknown;
  registrationIdentifier: unknown;
  reviewStatus: unknown;
  certLevel: unknown;
};

export type DemandPublisherIdentity = {
  publisherCompanyId: number;
  publisherCompanyName: string;
  publisherCreditCode: string | null;
  publisherRegistrationRegion: "CN" | "HK";
  publisherRegistrationIdentifier: string | null;
};

export type DemandPublisherIdentityResolution =
  | { ok: true; identity: DemandPublisherIdentity }
  | { ok: false; message: string };

/**
 * Resolves the immutable publisher snapshot before an insert.  HK identifiers
 * are deliberately not normalized: lowercase, whitespace, and incomplete IDs
 * are invalid rather than being silently repaired into a different identity.
 */
export function resolveDemandPublisherIdentity(
  company: DemandPublisherCompany,
): DemandPublisherIdentityResolution {
  const companyId = Number(company.companyId);
  const registeredCompanyName = typeof company.companyName === "string"
    ? company.companyName.trim()
    : "";
  const publisherCompanyName = typeof company.publisherCompanyName === "string"
    ? company.publisherCompanyName.trim()
    : registeredCompanyName;

  if (!Number.isSafeInteger(companyId) || companyId <= 0 || !registeredCompanyName || !publisherCompanyName) {
    return {
      ok: false,
      message: "企业资料不完整，请先补全企业名称和统一社会信用代码",
    };
  }

  const registrationRegion = typeof company.registrationRegion === "string"
    ? company.registrationRegion.trim()
    : "";
  const region = registrationRegion || "CN";
  if (region === "CN") {
    const creditCode = typeof company.creditCode === "string" ? company.creditCode.trim() : "";
    if (!creditCode) {
      return {
        ok: false,
        message: "企业资料不完整，请先补全企业名称和统一社会信用代码",
      };
    }
    return {
      ok: true,
      identity: {
        publisherCompanyId: companyId,
        publisherCompanyName,
        publisherCreditCode: creditCode,
        publisherRegistrationRegion: "CN",
        publisherRegistrationIdentifier: null,
      },
    };
  }

  if (region !== "HK") {
    return { ok: false, message: "企业注册辖区无效，请先完成企业资料审核" };
  }

  const registrationIdentifier = typeof company.registrationIdentifier === "string"
    ? company.registrationIdentifier
    : "";
  if (!/^HK:[0-9]{8}$/.test(registrationIdentifier)) {
    return {
      ok: false,
      message: "香港企业标识必须为 HK: 加 8 位商业登记号码 BRN",
    };
  }
  if (company.reviewStatus !== "approved" || !["certified", "premium"].includes(String(company.certLevel))) {
    return { ok: false, message: "香港企业须通过人工审核并完成企业认证后才能发布需求" };
  }

  return {
    ok: true,
    identity: {
      publisherCompanyId: companyId,
      publisherCompanyName,
      publisherCreditCode: null,
      publisherRegistrationRegion: "HK",
      publisherRegistrationIdentifier: registrationIdentifier,
    },
  };
}

/** Explicit columns keep this usable for both Drizzle tables and d/u/c raw SQL aliases. */
export type DemandPublisherIdentityColumns = {
  publisherCompanyId: SQLWrapper;
  publisherCompanyName: SQLWrapper;
  publisherCreditCode: SQLWrapper;
  publisherRegistrationRegion: SQLWrapper;
  publisherRegistrationIdentifier: SQLWrapper;
  companyId: SQLWrapper;
  companyRegistrationRegion: SQLWrapper;
  companyRegistrationIdentifier: SQLWrapper;
  companyCertLevel: SQLWrapper;
};

/**
 * Public-demand identity condition.  Old demand rows have no region snapshot:
 * they are CN only if their current company is CN (or legacy-empty) and their
 * original credit-code snapshot remains present.  HK rows bind both immutable
 * snapshots to the current HK company record and fail closed on malformed IDs.
 */
export function demandPublisherIdentityConditions(
  columns: DemandPublisherIdentityColumns,
): SQL[] {
  const snapshotRegion = sql`COALESCE(NULLIF(TRIM(${columns.publisherRegistrationRegion}), ''), 'CN')`;
  const companyRegion = sql`COALESCE(NULLIF(TRIM(${columns.companyRegistrationRegion}), ''), 'CN')`;
  const strictHkPublisherIdentifier = sql`REGEXP_LIKE(CONVERT(${columns.publisherRegistrationIdentifier} USING utf8mb4), '^HK:[0-9]{8}$', 'c')`;
  const strictHkCompanyIdentifier = sql`REGEXP_LIKE(CONVERT(${columns.companyRegistrationIdentifier} USING utf8mb4), '^HK:[0-9]{8}$', 'c')`;

  return [
    or(
      and(
        sql`${snapshotRegion} = 'CN'`,
        sql`${companyRegion} = 'CN'`,
        sql`NULLIF(TRIM(${columns.publisherCreditCode}), '') IS NOT NULL`,
      ),
      and(
        sql`${columns.publisherRegistrationRegion} = 'HK'`,
        strictHkPublisherIdentifier,
        sql`${columns.companyRegistrationRegion} = 'HK'`,
        strictHkCompanyIdentifier,
        sql`${columns.publisherRegistrationIdentifier} = ${columns.companyRegistrationIdentifier}`,
        sql`${columns.companyId} = ${columns.publisherCompanyId}`,
        sql`${columns.companyCertLevel} IN ('certified', 'premium')`,
      ),
    )!,
  ];
}
