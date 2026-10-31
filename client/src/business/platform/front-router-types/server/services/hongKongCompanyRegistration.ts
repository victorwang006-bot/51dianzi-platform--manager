import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { companies, enterpriseMembers, enterprises } from "../../drizzle/schema";
import { hkRegistrationDocuments } from "../../drizzle/hongKongRegistrationTables";
import { getDb, recordEnterpriseServiceAgreementAcceptance } from "../db";
import { storageDelete, storageGetAccessUrl, storagePutPrivate } from "../storage";
import { decodeAndValidateSensitiveDocument, decodeCanonicalBase64, MAX_SENSITIVE_DOCUMENT_BYTES, sensitiveDocumentExtension, type SensitiveDocumentMimeType } from "./sensitiveDocument";
import { isHongKongOcrConfigured, recognizeHongKongBank, recognizeHongKongRegistration } from "./hongKongRegistrationOcr";
import { hkRegistrationDataSchema, hkRegistrationIdentifier, normalizeHkDate, type HkDocumentKind, type HkExtractedFields, type HkRegistrationData } from "../../../shared/hongKongRegistration";
import { getAdminHkRegistrationCapabilities, listAdminSalesStaff, submitAdminHkCrmApplication } from "./customerService";
import { claimHkEnterpriseForCrmApplication } from "./enterpriseAccess";
import { preflightEnterpriseApplication } from "./enterpriseApplicationPreflight";
import { withHongKongSubmission } from "./hongKongSubmissionLedger";
import { ENTERPRISE_SERVICE_AGREEMENT_HASH, ENTERPRISE_SERVICE_AGREEMENT_NAME, ENTERPRISE_SERVICE_AGREEMENT_VERSION } from "../../../shared/enterpriseServiceAgreementContent";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "企业资料服务暂不可用" });
  return db;
}

export async function hongKongCapabilities() {
  const ocrConfigured = isHongKongOcrConfigured();
  if (!ocrConfigured || process.env.HK_REGISTRATION_ENABLED !== "1") return { enabled: false, ocrConfigured };
  try {
    const capabilities = await getAdminHkRegistrationCapabilities();
    return { enabled: capabilities.enabled === true && capabilities.version === 1, ocrConfigured };
  } catch { return { enabled: false, ocrConfigured }; }
}

async function requireHongKongEnabled() {
  if (!(await hongKongCapabilities()).enabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "香港企业申请暂未开放，请稍后重试" });
}

async function requireHkApplicant(userId: number) {
  const db = await requireDb();
  const membership = (await db.select({ enterprise: enterprises, member: enterpriseMembers }).from(enterpriseMembers)
    .innerJoin(enterprises, eq(enterpriseMembers.enterpriseId, enterprises.id))
    .where(eq(enterpriseMembers.userId, userId)).limit(1))[0];
  if (membership && (membership.member.status !== "active" || membership.enterprise.registrationRegion !== "HK" || membership.enterprise.superAdminUserId !== userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅香港企业所有者可提交本企业证件，已归属其他企业不可变更注册地区" });
  }
  const dataOwnerUserId = membership?.enterprise.crmDataOwnerUserId ?? userId;
  const company = (await db.select().from(companies).where(eq(companies.userId, dataOwnerUserId)).limit(1))[0];
  if (company?.registrationRegion === "HK" && company.enterpriseId && !membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不再是企业成员，不能读取或上传企业证件" });
  }
  if (company?.companyName && company.registrationRegion !== "HK") throw new TRPCError({ code: "CONFLICT", message: "当前账号已有内地企业资料，不可改为香港主体" });
  return { db, company, dataOwnerUserId };
}

export async function getHongKongDraft(userId: number) {
  const { db, company } = await requireHkApplicant(userId);
  const docs = await db.select().from(hkRegistrationDocuments).where(eq(hkRegistrationDocuments.userId, userId)).orderBy(desc(hkRegistrationDocuments.createdAt));
  const documents: Partial<Record<HkDocumentKind, { id: string; fileName: string; accessUrl: string | null }>> = {};
  for (const doc of docs) if (!documents[doc.kind]) documents[doc.kind] = { id: doc.id, fileName: doc.fileName, accessUrl: await storageGetAccessUrl(doc.objectKey, 900) };
  let registrationData: HkExtractedFields | null = company?.registrationRegion === "HK" ? company.registrationData : null;
  if (company?.registrationRegion === "HK" && company.pendingDraft) {
    try { registrationData = (JSON.parse(company.pendingDraft) as { registrationData?: HkRegistrationData }).registrationData || registrationData; } catch { /* Invalid legacy drafts never become input. */ }
  }
  return { registrationData, documents, reviewStatus: company?.registrationRegion === "HK" ? company.reviewStatus : undefined, submitted: company?.registrationRegion === "HK" && Boolean(company.companyName) };
}

export async function uploadHongKongDocument(userId: number, input: { kind: HkDocumentKind; fileName: string; base64: string; mimeType: SensitiveDocumentMimeType }) {
  await requireHongKongEnabled();
  const { db } = await requireHkApplicant(userId);
  let buffer: Buffer;
  try {
    await decodeAndValidateSensitiveDocument(input.base64, input.mimeType);
    buffer = decodeCanonicalBase64(input.base64, MAX_SENSITIVE_DOCUMENT_BYTES);
  } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "证件文件无效" }); }
  let extracted: HkExtractedFields | null = null;
  let recognizedType: string | null = null;
  let ocrStatus: "recognized" | "failed" = "failed";
  try {
    const result = input.kind === "BANK" ? await recognizeHongKongBank(buffer, input.mimeType) : await recognizeHongKongRegistration(buffer, input.mimeType, input.kind);
    extracted = result.extracted;
    recognizedType = result.recognizedType;
    ocrStatus = Object.keys(extracted).length ? "recognized" : "failed";
  } catch (error) {
    if (error instanceof Error && /^请上传正确的/.test(error.message)) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    console.warn("[hk.registration.ocr] 识别失败", { kind: input.kind, errorType: error instanceof Error ? error.name : "UnknownError" });
  }
  const id = randomUUID();
  const stored = await storagePutPrivate(`hk-registration/user-${userId}/${input.kind}/${id}.${sensitiveDocumentExtension(input.mimeType)}`, buffer, input.mimeType);
  try {
    await db.insert(hkRegistrationDocuments).values({ id, userId, kind: input.kind, objectKey: stored.key, fileName: input.fileName,
      mimeType: input.mimeType, extracted, recognizedType, ocrStatus });
  } catch (error) { await storageDelete(stored.key).catch(() => false); throw error; }
  return { success: true as const, document: { id, fileName: input.fileName }, extracted, ocrStatus };
}

function comparableName(value: string | undefined) { return (value || "").normalize("NFKC").replace(/[\s.,，。]/g, "").toUpperCase(); }

/** OCR只辅助填写；不宣称验真，但已识别的关键身份不能被表单偷偷换成另一主体。 */
export function validateHkEvidenceConsistency(data: HkRegistrationData, br: HkExtractedFields | null, ci: HkExtractedFields | null) {
  if (br?.brn && br.brn !== data.brn) throw new Error("填写的BRN与所上传BR识别号码不一致");
  if (br?.registrationNumber && br.registrationNumber.replace(/\s+/g, "-") !== data.registrationNumber.replace(/\s+/g, "-")) throw new Error("完整登记证号码与上传BR不一致");
  if (br?.legalStatus && /SOLE|PARTNERSHIP|独资|獨資|合伙|合夥/i.test(br.legalStatus)) throw new Error("独资／合伙BR主体请联系客服核验，无需公司CI");
  if (br?.brExpiryDate && normalizeHkDate(br.brExpiryDate) !== normalizeHkDate(data.brExpiryDate)) throw new Error("BR届满日期与上传证件不一致");
  if (br?.brStartDate && normalizeHkDate(br.brStartDate) !== normalizeHkDate(data.brStartDate)) throw new Error("BR生效日期与上传证件不一致");
  if (ci?.ciNumber && data.ciNumber && ci.ciNumber !== data.ciNumber) throw new Error("CI编号与上传证件不一致");
  for (const evidence of [br, ci]) if (evidence?.companyName && comparableName(evidence.companyName) !== comparableName(data.companyName)) throw new Error("企业名称与上传BR／CI不一致，请核对证件");
  if (br?.companyName && ci?.companyName && comparableName(br.companyName) !== comparableName(ci.companyName)) throw new Error("BR与CI不属于同一公司");
}

export async function submitHongKongApplication(user: { id: number; name?: string | null; phone?: string | null; email?: string | null }, input: {
  registrationData: HkRegistrationData; documents: Record<"BR" | "BANK", string> & Partial<Record<"CI", string>>;
}, audit: { ip: string | null; userAgent: string | null }) {
  await requireHongKongEnabled();
  const { db, dataOwnerUserId } = await requireHkApplicant(user.id);
  const data = hkRegistrationDataSchema.parse(input.registrationData);
  if (data.salesOwnerCode || data.salesOwner) {
    const staff = await listAdminSalesStaff();
    const matched = staff.find(row => row.staffCode === data.salesOwnerCode.trim().toLowerCase());
    if (!matched) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的销售负责人" });
    data.salesOwnerCode = matched.staffCode; data.salesOwner = matched.displayName;
  }
  const salesOwnerFields = data.salesOwnerCode
    ? { salesOwner: data.salesOwner, salesOwnerCode: data.salesOwnerCode }
    : {};
  const selected: Partial<Record<HkDocumentKind, typeof hkRegistrationDocuments.$inferSelect>> = {};
  for (const kind of ["BR", "CI", "BANK"] as const) {
    const documentId = input.documents[kind];
    if (kind === "CI" && documentId === undefined) continue;
    if (!documentId) throw new TRPCError({ code: "BAD_REQUEST", message: `请先上传本账号有效的${kind === "BANK" ? "银行证明" : kind}文件` });
    const doc = (await db.select().from(hkRegistrationDocuments).where(and(eq(hkRegistrationDocuments.id, documentId), eq(hkRegistrationDocuments.userId, user.id), eq(hkRegistrationDocuments.kind, kind))).limit(1))[0];
    if (!doc || !doc.objectKey.startsWith(`hk-registration/user-${user.id}/${kind}/`)) throw new TRPCError({ code: "BAD_REQUEST", message: `请先上传本账号有效的${kind === "BANK" ? "银行证明" : kind}文件` });
    selected[kind] = doc;
  }
  try { validateHkEvidenceConsistency(data, selected.BR!.extracted, selected.CI?.extracted ?? null); }
  catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message }); }
  const registrationIdentifier = hkRegistrationIdentifier(data.brn);
  const documents = { BR: { objectKey: selected.BR!.objectKey, fileName: selected.BR!.fileName }, ...(selected.CI ? { CI: { objectKey: selected.CI.objectKey, fileName: selected.CI.fileName } } : {}), BANK: { objectKey: selected.BANK!.objectKey, fileName: selected.BANK!.fileName } };
  const documentVerification = Object.fromEntries((["BR", "CI", "BANK"] as const).filter(kind => Boolean(selected[kind])).map(kind => [kind, {
    documentId: selected[kind]!.id, ocrStatus: selected[kind]!.ocrStatus,
    // Preserve the vendor label locally; the admin contract takes the stable document role.
    recognizedType: selected[kind]!.recognizedType ? kind : null,
    classification: selected[kind]!.recognizedType && selected[kind]!.ocrStatus === "recognized" ? "ocr-assisted" : "manual-classification-required",
  }]));
  // Run before the ledger can write. It is read-only, so an otherwise valid local-complete
  // replay retains its no-new-write guarantee.
  await preflightEnterpriseApplication({
    userId: user.id,
    companyName: data.companyName,
    chineseName: data.chineseName,
    registrationIdentifier,
    privateLicenseObjectKey: selected.BR!.objectKey,
    purpose: "review-update",
  });
  return withHongKongSubmission({ userId: dataOwnerUserId, registrationIdentifier, payload: { registrationData: data, documents, documentVerification, portalUserId: String(user.id), ...salesOwnerFields } }, async context => {
    if (context.previousStatus === "local-complete") return { success: true as const, crm: { accepted: true, created: false, code: "HK_CRM_APPLICATION_IDEMPOTENT", crmStatus: "pending" as const } };
    await recordEnterpriseServiceAgreementAcceptance({ userId: user.id, companyNameSnapshot: data.companyName,
      creditCodeSnapshot: null, registrationIdentifierSnapshot: registrationIdentifier, agreementName: ENTERPRISE_SERVICE_AGREEMENT_NAME,
      agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION, agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
      acceptedAt: new Date(), ip: audit.ip, userAgent: audit.userAgent });
    const crm = await submitAdminHkCrmApplication({ registrationIdentifier, submissionId: context.submissionId, payloadHash: context.payloadHash, registrationData: data,
      documents, documentVerification,
      ...salesOwnerFields,
      portalUserId: String(user.id), contactName: user.name || undefined, contactPhone: user.phone || undefined, contactEmail: user.email || undefined,
      agreementAccepted: true, agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION, agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH });
    await context.markRemoteAccepted();
    const claim = await claimHkEnterpriseForCrmApplication({ userId: user.id, registrationIdentifier, companyName: data.companyName });
    const fields = { registrationRegion: "HK", registrationIdentifier, registrationSubmissionId: context.submissionId, registrationPayloadHash: context.payloadHash,
      registrationData: data, creditCode: null, companyName: data.companyName, companyType: data.businessNature, legalPerson: null, companyRole: data.companyRole || null,
      regAddress: data.regAddress, establishedAt: data.establishedAt ? normalizeHkDate(data.establishedAt) : null,
      bankAccountName: data.bankAccountName, bankAccountNumber: data.bankAccountNumber, bankName: data.bankName,
      salesOwner: data.salesOwner || null, salesOwnerCode: data.salesOwnerCode || null,
      licenseObjectKey: selected.BR!.objectKey, licenseUrl: null, licenseFileName: selected.BR!.fileName,
      bankLicenseObjectKey: selected.BANK!.objectKey, bankLicenseUrl: null, bankLicenseFileName: selected.BANK!.fileName };
    await db.transaction(async tx => {
      const current = (await tx.select().from(companies).where(eq(companies.userId, dataOwnerUserId)).limit(1).for("update"))[0];
      if (current?.registrationRegion === "HK" && current.registrationSubmissionId === context.submissionId && current.registrationPayloadHash === context.payloadHash) return;
      if (current && current.registrationRegion === "HK" && (current.reviewStatus === "approved" || current.pendingDraft || current.certLevel !== "pending")) {
        await tx.update(companies).set({ pendingDraft: JSON.stringify(fields), registrationSubmissionId: context.submissionId, registrationPayloadHash: context.payloadHash,
          reviewStatus: "pending", submittedAt: new Date(), rejectReason: null }).where(eq(companies.id, current.id));
      } else if (current) {
        await tx.update(companies).set({ ...fields, enterpriseId: claim.enterprise.id, pendingDraft: null, reviewStatus: "pending", submittedAt: new Date(), rejectReason: null }).where(eq(companies.id, current.id));
      } else {
        await tx.insert(companies).values({ ...fields, userId: dataOwnerUserId, enterpriseId: claim.enterprise.id, reviewStatus: "pending", submittedAt: new Date() });
      }
    });
    return { success: true as const, crm };
  });
}
