function decodeJsonValue(value, fallback = null) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
function normalizeCreditCode(value) {
  return value.replace(/\s+/g, "").toUpperCase();
}
function normalizeCrmPortalUserId(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function merchantRegistrationIdentity(merchant) {
  if (merchant.registrationRegion === "HK") {
    const identity = merchant.registrationIdentifier?.trim().toUpperCase() || "";
    return /^HK:\d{8}$/.test(identity) ? identity : null;
  }
  const creditCode = merchant.businessLicense?.trim();
  return creditCode ? `CN:${normalizeCreditCode(creditCode)}` : null;
}
var CN_REVIEW_DRAFT_KEYS = /* @__PURE__ */ new Set([
  "companyName", "creditCode", "companyType", "legalPerson", "companyRole",
  "bankAccountName", "bankAccountNumber", "bankName", "regAddress", "establishedAt",
  "salesOwner", "salesOwnerCode",
  // Private-document fields are accepted only by these exact names. Any future
  // field requires a review of this closure instead of being spread into SQL.
  "licenseUrl", "licenseObjectKey", "licenseFileName",
  "bankLicenseUrl", "bankLicenseObjectKey", "bankLicenseFileName"
]);

function cnReviewText(value, max, required = false) {
  if (value == null) {
    if (required) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
    return null;
  }
  if (typeof value !== "string") throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  const text = value.trim();
  if ((required && !text) || text.length > max) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  return text || null;
}
function cnReviewDate(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  return value;
}
function cnReviewCreditCode(value) {
  const creditCode = cnReviewText(value, 32, true)?.replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(creditCode ?? "")) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  return creditCode;
}
function cnReviewCandidateFromSource(source, fromDraft = false) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  if (Object.keys(source).some((key) => !CN_REVIEW_DRAFT_KEYS.has(key))) {
    throw new Error("CN_REVIEW_UNSUPPORTED_DRAFT_FIELD");
  }
  const candidate = {
    companyName: cnReviewText(source.companyName, 128, true),
    creditCode: cnReviewCreditCode(source.creditCode),
    companyType: cnReviewText(source.companyType, 128, true),
    legalPerson: cnReviewText(source.legalPerson, 64, true),
    companyRole: cnReviewText(source.companyRole, 64),
    bankAccountName: cnReviewText(source.bankAccountName, 128, true),
    bankAccountNumber: cnReviewText(source.bankAccountNumber, 64, true),
    bankName: cnReviewText(source.bankName, 128, true),
    regAddress: cnReviewText(source.regAddress, 255, true),
    establishedAt: cnReviewDate(source.establishedAt),
    salesOwner: cnReviewText(source.salesOwner, 64),
    salesOwnerCode: cnReviewText(source.salesOwnerCode, 64),
    licenseUrl: cnReviewText(source.licenseUrl, 1024),
    licenseObjectKey: cnReviewText(source.licenseObjectKey, 512),
    licenseFileName: cnReviewText(source.licenseFileName, 255),
    bankLicenseUrl: cnReviewText(source.bankLicenseUrl, 1024),
    bankLicenseObjectKey: cnReviewText(source.bankLicenseObjectKey, 512),
    bankLicenseFileName: cnReviewText(source.bankLicenseFileName, 255)
  };
  // A file update needs a storage object key; a URL-only update is rejected so
  // legacy/public URL values cannot become a private-document bypass.
  const hasOwn = Object.prototype.hasOwnProperty;
  const hasLicenseChange = ["licenseUrl", "licenseObjectKey", "licenseFileName"].some((key) => hasOwn.call(source, key));
  const hasBankLicenseChange = ["bankLicenseUrl", "bankLicenseObjectKey", "bankLicenseFileName"].some((key) => hasOwn.call(source, key));
  if (fromDraft && ((hasLicenseChange && (!candidate.licenseObjectKey || !candidate.licenseFileName)) || (hasBankLicenseChange && (!candidate.bankLicenseObjectKey || !candidate.bankLicenseFileName)))) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  return candidate;
}
function cnReviewDecodeDraft(value) {
  const decoded = decodeJsonValue(value, null);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  return decoded;
}
function cnReviewMaskAccount(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length <= 4) return "****";
  return `${"*".repeat(Math.min(12, Math.max(4, text.length - 4)))}${text.slice(-4)}`;
}
function cnReviewDocuments(row, candidate = null) {
  const licenseObjectKey = candidate?.licenseObjectKey ?? row.licenseObjectKey;
  const licenseUrl = candidate?.licenseUrl ?? row.licenseUrl;
  const licenseFileName = candidate?.licenseFileName ?? row.licenseFileName;
  const bankObjectKey = candidate?.bankLicenseObjectKey ?? row.bankLicenseObjectKey;
  const bankFileName = candidate?.bankLicenseFileName ?? row.bankLicenseFileName;
  return {
    BUSINESS_LICENSE: {
      available: Boolean(licenseObjectKey || licenseUrl),
      fileName: cnReviewText(licenseFileName, 255) ?? null
    },
    BANK_LICENSE: {
      available: Boolean(bankObjectKey),
      fileName: cnReviewText(bankFileName, 255) ?? null
    }
  };
}
function cnReviewSummary(candidate, row) {
  return {
    companyName: candidate.companyName,
    unifiedSocialCreditCode: candidate.creditCode,
    legalRepresentative: candidate.legalPerson,
    registeredAddress: candidate.regAddress,
    bankAccountName: candidate.bankAccountName,
    bankName: candidate.bankName,
    bankAccountNumberMasked: cnReviewMaskAccount(candidate.bankAccountNumber),
    documents: cnReviewDocuments(row, candidate)
  };
}
function cnReviewDifference(field, label, before, after) {
  if ((before ?? null) === (after ?? null)) return null;
  return { field, label, before: before ?? null, after: after ?? null, changed: true };
}
function cnReviewDifferences(effective, candidate) {
  const baseline = effective ?? {
    companyName: null, creditCode: null, legalPerson: null, companyType: null,
    companyRole: null, regAddress: null, bankAccountName: null, bankName: null,
    bankAccountNumber: null, establishedAt: null, salesOwner: null, salesOwnerCode: null,
    licenseUrl: null, licenseObjectKey: null, licenseFileName: null,
    bankLicenseUrl: null, bankLicenseObjectKey: null, bankLicenseFileName: null
  };
  const differences = [
    cnReviewDifference("companyName", "企业名称", baseline.companyName, candidate.companyName),
    cnReviewDifference("creditCode", "统一社会信用代码", baseline.creditCode, candidate.creditCode),
    cnReviewDifference("legalPerson", "法定代表人", baseline.legalPerson, candidate.legalPerson),
    cnReviewDifference("companyType", "企业类型", baseline.companyType, candidate.companyType),
    cnReviewDifference("companyRole", "企业角色", baseline.companyRole, candidate.companyRole),
    cnReviewDifference("regAddress", "注册地址", baseline.regAddress, candidate.regAddress),
    cnReviewDifference("bankAccountName", "账户名称", baseline.bankAccountName, candidate.bankAccountName),
    cnReviewDifference("bankName", "开户行", baseline.bankName, candidate.bankName),
    cnReviewDifference("establishedAt", "成立日期", baseline.establishedAt, candidate.establishedAt),
    cnReviewDifference("salesOwner", "销售负责人", baseline.salesOwner, candidate.salesOwner),
    cnReviewDifference("salesOwnerCode", "销售负责人工号", baseline.salesOwnerCode, candidate.salesOwnerCode)
  ].filter(Boolean);
  // Compare raw values before masking: changing only hidden digits must still
  // be shown as a change to the reviewer even if both masked endings match.
  if ((baseline.bankAccountNumber ?? null) !== (candidate.bankAccountNumber ?? null)) {
    differences.push({ field: "bankAccountNumber", label: "账户号码", before: cnReviewMaskAccount(baseline.bankAccountNumber), after: cnReviewMaskAccount(candidate.bankAccountNumber), changed: true });
  }
  const oldDocuments = cnReviewDocuments({
    licenseObjectKey: baseline.licenseObjectKey, licenseUrl: baseline.licenseUrl, licenseFileName: baseline.licenseFileName,
    bankLicenseObjectKey: baseline.bankLicenseObjectKey, bankLicenseFileName: baseline.bankLicenseFileName
  });
  const newDocuments = cnReviewDocuments({
    licenseObjectKey: baseline.licenseObjectKey, licenseUrl: baseline.licenseUrl, licenseFileName: baseline.licenseFileName,
    bankLicenseObjectKey: baseline.bankLicenseObjectKey, bankLicenseFileName: baseline.bankLicenseFileName
  }, candidate);
  if (baseline.licenseObjectKey !== candidate.licenseObjectKey || baseline.licenseUrl !== candidate.licenseUrl || baseline.licenseFileName !== candidate.licenseFileName) {
    differences.push({ field: "documents.BUSINESS_LICENSE", label: "营业执照", before: oldDocuments.BUSINESS_LICENSE.fileName || "已上传", after: newDocuments.BUSINESS_LICENSE.fileName || "已更换", changed: true });
  }
  if (baseline.bankLicenseObjectKey !== candidate.bankLicenseObjectKey || baseline.bankLicenseFileName !== candidate.bankLicenseFileName) {
    differences.push({ field: "documents.BANK_LICENSE", label: "银行许可证", before: oldDocuments.BANK_LICENSE.fileName || "已上传", after: newDocuments.BANK_LICENSE.fileName || "已更换", changed: true });
  }
  return differences;
}
function cnReviewVersionSql(merchant) {
  // All values that decide whether the reviewer saw the current candidate are
  // bound into the digest. Keeping pendingDraft itself in the digest protects
  // unknown/new draft fields too, without returning that sensitive JSON.
  return sql4`SHA2(CONCAT_WS(CHAR(10),
    ${CN_REVIEW_VERSION_PREFIX},
    CAST(company.id AS CHAR),
    COALESCE(CAST(company.pendingDraft AS CHAR), ''),
    COALESCE(company.companyName, ''), COALESCE(company.creditCode, ''),
    COALESCE(company.companyType, ''), COALESCE(company.legalPerson, ''),
    COALESCE(company.companyRole, ''), COALESCE(company.bankAccountName, ''),
    COALESCE(company.bankAccountNumber, ''), COALESCE(company.bankName, ''),
    COALESCE(company.regAddress, ''), COALESCE(CAST(company.establishedAt AS CHAR), ''),
    COALESCE(company.salesOwner, ''), COALESCE(company.salesOwnerCode, ''),
    COALESCE(company.licenseUrl, ''), COALESCE(company.licenseObjectKey, ''), COALESCE(company.licenseFileName, ''),
    COALESCE(company.bankLicenseUrl, ''), COALESCE(company.bankLicenseObjectKey, ''), COALESCE(company.bankLicenseFileName, ''),
    COALESCE(CAST(company.submittedAt AS CHAR), ''), COALESCE(company.reviewStatus, ''),
    CAST(${merchant.id} AS CHAR), COALESCE(${merchant.registrationRegion}, ''),
    COALESCE(${merchant.businessLicense}, ''), COALESCE(${merchant.status}, ''),
    COALESCE(${merchant.crmStatus}, ''), COALESCE(CAST(${merchant.crmOwnerPortalUserId} AS CHAR), '')
  ), 256)`;
}
async function cnReviewReadPlatformCompany(executor, merchant, forUpdate = false) {
  const identity = merchantRegistrationIdentity(merchant);
  if (!identity) throw new Error("CN_REVIEW_SUBJECT_MISMATCH");
  const creditCode = identity.slice(3);
  const lock = forUpdate ? sql4`FOR UPDATE` : sql4``;
  const result = await executor.execute(sql4`
    SELECT company.id AS companyId,
           company.enterpriseId AS enterpriseId,
           company.registrationRegion AS companyRegistrationRegion,
           company.companyName, company.creditCode, company.companyType,
           company.legalPerson, company.companyRole, company.bankAccountName,
           company.bankAccountNumber, company.bankName, company.regAddress,
           DATE_FORMAT(company.establishedAt, '%Y-%m-%d') AS establishedAt, company.salesOwner, company.salesOwnerCode,
           company.licenseUrl, company.licenseObjectKey, company.licenseFileName,
           company.bankLicenseUrl, company.bankLicenseObjectKey, company.bankLicenseFileName,
           company.pendingDraft, JSON_VALID(company.pendingDraft) AS pendingDraftJsonValid,
           company.reviewStatus, company.certLevel, company.enterpriseCrmAccess,
           company.rejectReason, company.reviewedAt, company.submittedAt,
           ${cnReviewVersionSql(merchant)} AS expectedVersion,
           enterprise.registrationRegion AS enterpriseRegistrationRegion,
           enterprise.creditCode AS enterpriseCreditCode,
           CAST(enterprise.superAdminUserId AS CHAR) AS superAdminUserId,
           CAST(enterprise.crmDataOwnerUserId AS CHAR) AS dataOwnerUserId,
           CAST(company.userId AS CHAR) AS companyUserId,
           member.status AS memberStatus, member.role AS memberRole,
           ownerAccount.loginDisabled AS ownerLoginDisabled
      FROM ${sql4.raw(PLATFORM_DB)}.companies AS company
      INNER JOIN ${sql4.raw(PLATFORM_DB)}.enterprises AS enterprise
        ON enterprise.id = company.enterpriseId
      LEFT JOIN ${sql4.raw(PLATFORM_DB)}.enterprise_members AS member
        ON member.enterpriseId = enterprise.id
       AND member.userId = enterprise.crmDataOwnerUserId
      LEFT JOIN ${sql4.raw(PLATFORM_DB)}.users AS ownerAccount
        ON ownerAccount.id = enterprise.crmDataOwnerUserId
     WHERE company.registrationRegion = 'CN'
       AND enterprise.registrationRegion = 'CN'
       AND UPPER(REPLACE(company.creditCode, ' ', '')) = ${creditCode}
     LIMIT 2
     ${lock}
  `);
  const rows = result[0] ?? [];
  if (rows.length !== 1 || !rows[0]) throw new Error("CN_REVIEW_PLATFORM_SUBJECT_NOT_FOUND");
  return rows[0];
}
function cnReviewEffectiveCandidate(row) {
  return cnReviewCandidateFromSource({
    companyName: row.companyName, creditCode: row.creditCode, companyType: row.companyType,
    legalPerson: row.legalPerson, companyRole: row.companyRole,
    bankAccountName: row.bankAccountName, bankAccountNumber: row.bankAccountNumber,
    bankName: row.bankName, regAddress: row.regAddress, establishedAt: row.establishedAt,
    salesOwner: row.salesOwner, salesOwnerCode: row.salesOwnerCode,
    licenseUrl: row.licenseUrl, licenseObjectKey: row.licenseObjectKey, licenseFileName: row.licenseFileName,
    bankLicenseUrl: row.bankLicenseUrl, bankLicenseObjectKey: row.bankLicenseObjectKey, bankLicenseFileName: row.bankLicenseFileName
  });
}
function cnReviewResolveCandidateDocuments(candidate, row) {
  return {
    ...candidate,
    licenseUrl: candidate.licenseUrl ?? row.licenseUrl,
    licenseObjectKey: candidate.licenseObjectKey ?? row.licenseObjectKey,
    licenseFileName: candidate.licenseFileName ?? row.licenseFileName,
    bankLicenseUrl: candidate.bankLicenseUrl ?? row.bankLicenseUrl,
    bankLicenseObjectKey: candidate.bankLicenseObjectKey ?? row.bankLicenseObjectKey,
    bankLicenseFileName: candidate.bankLicenseFileName ?? row.bankLicenseFileName
  };
}
function cnReviewState(row) {
  if (row.reviewStatus !== "pending") return { candidate: null, effective: null, reviewKind: null };
  if (row.pendingDraft != null) {
    if (Number(row.pendingDraftJsonValid) !== 1) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
    return {
      candidate: cnReviewResolveCandidateDocuments(cnReviewCandidateFromSource(cnReviewDecodeDraft(row.pendingDraft), true), row),
      effective: cnReviewEffectiveCandidate(row),
      reviewKind: "resubmission"
    };
  }
  return { candidate: cnReviewEffectiveCandidate(row), effective: null, reviewKind: "initial" };
}
function cnReviewAssertSubject(merchant, row, candidate, isResubmission) {
  const identity = merchantRegistrationIdentity(merchant);
  const companyIdentity = row.companyRegistrationRegion === "CN" ? `CN:${String(row.creditCode ?? "").replace(/\s/g, "").toUpperCase()}` : null;
  const enterpriseIdentity = row.enterpriseRegistrationRegion === "CN" ? `CN:${String(row.enterpriseCreditCode ?? "").replace(/\s/g, "").toUpperCase()}` : null;
  if (!identity || !/^CN:[0-9A-HJ-NPQRTUWXY]{18}$/.test(identity) || companyIdentity !== identity || enterpriseIdentity !== identity) {
    throw new Error("CN_REVIEW_SUBJECT_MISMATCH");
  }
  if (candidate.creditCode !== identity.slice(3) || String(row.companyUserId ?? "") !== String(row.dataOwnerUserId ?? "") || String(row.superAdminUserId ?? "") !== String(row.dataOwnerUserId ?? "") || row.memberStatus !== "active" || row.memberRole !== "super_admin" || row.ownerLoginDisabled == null || Number(row.ownerLoginDisabled) !== 0) {
    throw new Error("CN_REVIEW_OWNER_OR_SUBJECT_INVALID");
  }
  const crmOwner = normalizeCrmPortalUserId(merchant.crmOwnerPortalUserId);
  if (crmOwner && crmOwner !== String(row.dataOwnerUserId ?? "")) {
    throw new Error("CN_REVIEW_OWNER_OR_SUBJECT_INVALID");
  }
  // A legal-subject or responsible-person change may only use the existing
  // verified legal-change workflow. A normal profile draft cannot overwrite it.
  if (isResubmission && (candidate.companyName !== cnReviewText(row.companyName, 128, true) || candidate.legalPerson !== cnReviewText(row.legalPerson, 64, true))) {
    throw new Error("CN_REVIEW_LEGAL_CHANGE_REQUIRED");
  }
}
function cnReviewCompanyGuard(identity, merchant, expectedVersion) {
  const creditCode = identity.slice(3);
  return sql4`
    company.registrationRegion = 'CN'
    AND UPPER(REPLACE(company.creditCode, ' ', '')) = ${creditCode}
    AND company.reviewStatus = 'pending'
    AND ${cnReviewVersionSql(merchant)} = ${expectedVersion}
  `;
}
async function cnReviewPriorDecision(tx, merchantId, expectedVersion) {
  const result = await tx.execute(sql4`
    SELECT action,
           JSON_UNQUOTE(JSON_EXTRACT(afterValue, '$.expectedVersion')) AS expectedVersion,
           JSON_UNQUOTE(JSON_EXTRACT(afterValue, '$.decision')) AS decision
      FROM audit_logs
     WHERE targetType = 'merchant'
       AND targetId = ${String(merchantId)}
       AND action = ${CN_REVIEW_AUDIT_ACTION}
     ORDER BY id DESC
     LIMIT 3
     FOR UPDATE
  `);
  return (result[0] ?? []).find((row) => row.expectedVersion === expectedVersion) ?? null;
}
async function getCnRegistrationReviewDetail(merchantId) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
  if (merchant.registrationRegion !== "CN") throw new Error("CN_REGISTRATION_REQUIRED");
  const identity = merchantRegistrationIdentity(merchant);
  if (!identity) throw new Error("CN_REVIEW_SUBJECT_MISMATCH");
  const row = await cnReviewReadPlatformCompany(db, merchant);
  const state = cnReviewState(row);
  let reviewBlockedReason = null;
  if (state.candidate) {
    try {
      cnReviewAssertSubject(merchant, row, state.candidate, state.reviewKind === "resubmission");
    } catch (error) {
      // Read permission is not approval permission. Keep all subject/owner guards.
      if (!(error instanceof Error) || error.message !== "CN_REVIEW_LEGAL_CHANGE_REQUIRED") throw error;
      reviewBlockedReason = "本次提交涉及企业名称或法定代表人变更，可查看新旧资料对比，但不能在普通资料审核中直接通过或退回。请使用既有合法主体变更流程处理；已生效资料保持不变。";
    }
  }
  const effectiveSummary = state.effective ? cnReviewSummary(state.effective, row) : null;
  return {
    merchantId: merchant.id,
    region: "CN",
    reviewKind: state.reviewKind,
    effective: effectiveSummary,
    candidate: state.candidate ? {
      expectedVersion: String(row.expectedVersion),
      submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
      summary: cnReviewSummary(state.candidate, row)
    } : null,
    differences: cnReviewDifferences(state.effective, state.candidate ?? cnReviewEffectiveCandidate(row)),
    reviewStatus: row.reviewStatus ?? "none",
    reviewBlockedReason,
    reviewBlockedCode: reviewBlockedReason ? "CN_REVIEW_LEGAL_CHANGE_REQUIRED" : null,
    canReview: Boolean(state.candidate) && !reviewBlockedReason
  };
}
async function reviewCnRegistrationDraft(input) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");
  const note = input.note?.trim() || null;
  if (input.decision === "rejected" && !note) throw new Error("CN_REVIEW_NOTE_REQUIRED");
  if (input.decision === "approved" && input.confirmed !== true) throw new Error("CN_REVIEW_CONFIRMATION_REQUIRED");
  return db.transaction(async (tx) => {
    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, input.merchantId)).limit(1).for("update");
    if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
    if (merchant.registrationRegion !== "CN") throw new Error("CN_REGISTRATION_REQUIRED");
    const identity = merchantRegistrationIdentity(merchant);
    if (!identity) throw new Error("CN_REVIEW_SUBJECT_MISMATCH");
    const row = await cnReviewReadPlatformCompany(tx, merchant, true);
    const state = cnReviewState(row);
    if (!state.candidate) {
      const prior = await cnReviewPriorDecision(tx, merchant.id, input.expectedVersion);
      if (prior) {
        if (prior.decision !== input.decision) throw new Error("CN_REVIEW_ALREADY_DECIDED");
        return {
          success: true, decision: input.decision, merchantId: merchant.id,
          expectedVersion: input.expectedVersion, idempotent: true,
          reviewStatus: row.reviewStatus, retainedEffectiveAccess: true
        };
      }
      throw new Error("CN_REVIEW_CANDIDATE_NOT_FOUND");
    }
    if (String(row.expectedVersion) !== input.expectedVersion) throw new Error("CN_REVIEW_VERSION_CHANGED");
    const isResubmission = state.reviewKind === "resubmission";
    cnReviewAssertSubject(merchant, row, state.candidate, isResubmission);
    const before = {
      merchantStatus: merchant.status, merchantCrmStatus: merchant.crmStatus,
      companyReviewStatus: row.reviewStatus, companyCertification: row.certLevel,
      reviewKind: state.reviewKind, expectedVersion: input.expectedVersion
    };
    const companyGuard = cnReviewCompanyGuard(identity, merchant, input.expectedVersion);
    let reviewStatus;
    if (input.decision === "approved") {
      const candidate = state.candidate;
      const companyUpdate = await tx.execute(sql4`
        UPDATE ${sql4.raw(PLATFORM_DB)}.companies AS company
           SET company.companyName = ${candidate.companyName},
               company.creditCode = ${candidate.creditCode},
               company.companyType = ${candidate.companyType},
               company.legalPerson = ${candidate.legalPerson},
               company.companyRole = ${candidate.companyRole},
               company.bankAccountName = ${candidate.bankAccountName},
               company.bankAccountNumber = ${candidate.bankAccountNumber},
               company.bankName = ${candidate.bankName},
               company.regAddress = ${candidate.regAddress},
               company.establishedAt = ${candidate.establishedAt},
               company.salesOwner = ${candidate.salesOwner},
               company.salesOwnerCode = ${candidate.salesOwnerCode},
               company.licenseUrl = ${candidate.licenseUrl},
               company.licenseObjectKey = ${candidate.licenseObjectKey},
               company.licenseFileName = ${candidate.licenseFileName},
               company.bankLicenseUrl = ${candidate.bankLicenseUrl},
               company.bankLicenseObjectKey = ${candidate.bankLicenseObjectKey},
               company.bankLicenseFileName = ${candidate.bankLicenseFileName},
               company.pendingDraft = NULL,
               company.reviewStatus = 'approved',
               company.certLevel = CASE WHEN company.certLevel = 'premium' THEN 'premium' ELSE 'certified' END,
               company.rejectReason = NULL,
               company.reviewedAt = NOW(),
               company.merchantSinceAt = COALESCE(company.merchantSinceAt, NOW())
         WHERE ${companyGuard}
      `);
      if (Number(companyUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_VERSION_CHANGED");
      await tx.execute(sql4`
        UPDATE ${sql4.raw(PLATFORM_DB)}.enterprises AS enterprise
           SET enterprise.companyName = ${candidate.companyName}
         WHERE enterprise.id = ${row.enterpriseId}
           AND enterprise.registrationRegion = 'CN'
           AND UPPER(REPLACE(enterprise.creditCode, ' ', '')) = ${identity.slice(3)}
           AND CAST(enterprise.superAdminUserId AS CHAR) = CAST(enterprise.crmDataOwnerUserId AS CHAR)
      `);
      const merchantUpdate = await tx.update(merchants).set({
        companyName: candidate.companyName,
        companyType: candidate.companyType,
        companyRole: candidate.companyRole,
        registeredAddress: candidate.regAddress,
        establishedDate: candidate.establishedAt ? new Date(`${candidate.establishedAt}T00:00:00+08:00`) : null,
        settlementAccountName: candidate.bankAccountName,
        settlementAccount: candidate.bankAccountNumber,
        settlementBank: candidate.bankName,
        salesOwner: candidate.salesOwner,
        salesOwnerCode: candidate.salesOwnerCode,
        licenseObjectKey: candidate.licenseObjectKey,
        licenseImageUrl: candidate.licenseUrl,
        bankDocumentObjectKey: candidate.bankLicenseObjectKey,
        status: merchant.status === "pending" ? "approved" : merchant.status,
        reviewNote: note,
        reviewedBy: input.actor?.operatorId ?? null,
        reviewedAt: /* @__PURE__ */ new Date()
      }).where(and(eq(merchants.id, merchant.id), eq(merchants.status, merchant.status), eq(merchants.crmStatus, merchant.crmStatus)));
      if (Number(merchantUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_MERCHANT_UPDATE_FAILED");
      reviewStatus = "approved";
    } else {
      const nextCompanyStatus = isResubmission ? "approved" : "rejected";
      const companyUpdate = await tx.execute(sql4`
        UPDATE ${sql4.raw(PLATFORM_DB)}.companies AS company
           SET company.pendingDraft = NULL,
               company.reviewStatus = ${nextCompanyStatus},
               company.certLevel = CASE WHEN ${isResubmission} THEN company.certLevel ELSE 'pending' END,
               company.rejectReason = ${note},
               company.reviewedAt = NOW()
         WHERE ${companyGuard}
      `);
      if (Number(companyUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_VERSION_CHANGED");
      const merchantUpdate = await tx.update(merchants).set({
        status: !isResubmission && merchant.status === "pending" ? "supplement" : merchant.status,
        reviewNote: note,
        reviewedBy: input.actor?.operatorId ?? null,
        reviewedAt: /* @__PURE__ */ new Date()
      }).where(and(eq(merchants.id, merchant.id), eq(merchants.status, merchant.status), eq(merchants.crmStatus, merchant.crmStatus)));
      if (Number(merchantUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_MERCHANT_UPDATE_FAILED");
      reviewStatus = nextCompanyStatus;
    }
    await tx.insert(auditLogs).values({
      operatorId: input.actor?.operatorId ?? null,
      operatorName: input.actor?.operatorName ?? "system",
      operatorRole: input.actor?.operatorRole ?? "system",
      action: CN_REVIEW_AUDIT_ACTION,
      module: "merchants",
      targetType: "merchant",
      targetId: String(merchant.id),
      beforeValue: before,
      afterValue: {
        decision: input.decision, expectedVersion: input.expectedVersion,
        companyReviewStatus: reviewStatus,
        merchantStatus: input.decision === "approved" && merchant.status === "pending" ? "approved" : !isResubmission && merchant.status === "pending" ? "supplement" : merchant.status,
        reviewKind: state.reviewKind,
        retainedEffectiveAccess: isResubmission
      },
      ipAddress: input.actor?.ipAddress ?? null,
      userAgent: input.actor?.userAgent ?? null,
      result: "success",
      note
    });
    return {
      success: true, decision: input.decision, merchantId: merchant.id,
      expectedVersion: input.expectedVersion, idempotent: false,
      reviewStatus, retainedEffectiveAccess: isResubmission
    };
  });
}

function cnPendingReviewMerchantCondition() {}
