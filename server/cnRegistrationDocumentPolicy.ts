export type CnRegistrationDocumentReferences = {
  licenseUrl: string | null;
  licenseObjectKey: string | null;
  licenseFileName: string | null;
  bankLicenseUrl: string | null;
  bankLicenseObjectKey: string | null;
  bankLicenseFileName: string | null;
};

/**
 * Mirrors the only current CN producers in platform/server/routers/company.ts:
 *
 *   storagePutPrivate(`${namespace}/user-${ctx.user.id}-${Date.now()}-${randomUUID()}.${extension}`, ...)
 *
 * storagePutPrivate appends an eight-hex suffix before the extension. The
 * producer writes a stable private key and a user-supplied display name, while
 * explicitly clearing the old public URL. This is a verifier only: it neither
 * signs URLs nor creates a new document/submission protocol.
 */
const PRIVATE_DOCUMENT_KEY = /^(licenses|bank-licenses)\/user-([1-9]\d*)-(\d{13})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_([0-9a-f]{8})\.(jpg|png|pdf)$/;

type DocumentKind = "license" | "bankLicense";

function documentReferenceInvalid(): never {
  throw new Error("CN_REVIEW_DOCUMENT_REFERENCE_INVALID");
}

function exactOwnerId(value: string | number | null | undefined) {
  const owner = String(value ?? "");
  if (!/^[1-9]\d*$/.test(owner)) documentReferenceInvalid();
  return owner;
}

function assertPrivateProducerKey(kind: DocumentKind, key: string | null, owner: string) {
  if (!key) documentReferenceInvalid();
  const match = PRIVATE_DOCUMENT_KEY.exec(key);
  const namespace = kind === "license" ? "licenses" : "bank-licenses";
  if (!match || match[1] !== namespace || match[2] !== owner) documentReferenceInvalid();
}

function assertDocument(kind: DocumentKind, input: {
  objectKey: string | null;
  url: string | null;
  fileName: string | null;
}, owner: string) {
  // New producer rows persist only a private object key. A URL, including a
  // same-key proxy URL, is not producer evidence and must not be promoted.
  if (input.url !== null || !input.fileName) documentReferenceInvalid();
  assertPrivateProducerKey(kind, input.objectKey, owner);
}

/**
 * Requires both CN review documents to remain exact private outputs of the
 * current authenticated platform owner. The caller must still bind the row to
 * an in-lock expectedVersion/CAS; this function deliberately has no storage
 * I/O and cannot turn a key prefix into a new upload capability.
 */
export function assertCurrentCnRegistrationDocumentReferences(input: {
  dataOwnerUserId: string | number | null | undefined;
  documents: CnRegistrationDocumentReferences;
}) {
  const owner = exactOwnerId(input.dataOwnerUserId);
  assertDocument("license", {
    objectKey: input.documents.licenseObjectKey,
    url: input.documents.licenseUrl,
    fileName: input.documents.licenseFileName,
  }, owner);
  assertDocument("bankLicense", {
    objectKey: input.documents.bankLicenseObjectKey,
    url: input.documents.bankLicenseUrl,
    fileName: input.documents.bankLicenseFileName,
  }, owner);
}
