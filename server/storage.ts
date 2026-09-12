import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

function forgeConfig() {
  const forgeUrl = ENV.forgeApiUrl.trim();
  const forgeKey = ENV.forgeApiKey.trim();
  return forgeUrl && forgeKey
    ? { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey }
    : null;
}

function ossConfig() {
  const accessKeyId = ENV.ossAccessKeyId.trim();
  const accessKeySecret = ENV.ossAccessKeySecret.trim();
  const bucket = ENV.ossBucket.trim();
  const region = ENV.ossRegion.trim();
  return accessKeyId && accessKeySecret && bucket && region
    ? { accessKeyId, accessKeySecret, bucket, region }
    : null;
}

let cachedOssClient: { signature: string; client: S3Client } | null = null;

function getOssClient(config: NonNullable<ReturnType<typeof ossConfig>>) {
  const signature = `${config.accessKeyId}\0${config.bucket}\0${config.region}`;
  if (cachedOssClient?.signature === signature) return cachedOssClient.client;
  const client = new S3Client({
    region: config.region,
    endpoint: `https://${config.region}.aliyuncs.com`,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret,
    },
  });
  cachedOssClient = { signature, client };
  return client;
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (
    !key
    || key.length > 512
    || /[\x00-\x1f\x7f]/.test(key)
    || key.split("/").some(segment => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid storage key");
  }
  return key;
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export function storageBackendReady(): boolean {
  return Boolean(forgeConfig() || ossConfig());
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const forge = forgeConfig();
  if (forge) {
    const presignUrl = new URL("v1/storage/presign/put", forge.forgeUrl + "/");
    presignUrl.searchParams.set("path", key);
    const presignResp = await fetch(presignUrl, {
      headers: { Authorization: `Bearer ${forge.forgeKey}` },
    });
    if (!presignResp.ok) {
      const msg = await presignResp.text().catch(() => presignResp.statusText);
      throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
    }
    const { url: s3Url } = (await presignResp.json()) as { url: string };
    if (!s3Url) throw new Error("Forge returned empty presign URL");
    const uploadResp = await fetch(s3Url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: typeof data === "string" ? data : new Blob([data as BlobPart], { type: contentType }),
    });
    if (!uploadResp.ok) throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  } else {
    const oss = ossConfig();
    if (!oss) {
      throw new Error("Storage config missing: configure Forge or ALI_OSS_* credentials");
    }
    await getOssClient(oss).send(new PutObjectCommand({
      Bucket: oss.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
      ACL: "private",
    }));
  }
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  const forge = forgeConfig();
  if (forge) {
    const getUrl = new URL("v1/storage/presign/get", forge.forgeUrl + "/");
    getUrl.searchParams.set("path", key);
    const resp = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${forge.forgeKey}` },
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
    }
    const { url } = (await resp.json()) as { url: string };
    if (!url) throw new Error("Forge returned empty signed URL");
    return url;
  }
  const oss = ossConfig();
  if (!oss) throw new Error("Storage config missing: configure Forge or ALI_OSS_* credentials");
  return getSignedUrl(
    getOssClient(oss),
    new GetObjectCommand({ Bucket: oss.bucket, Key: key }),
    { expiresIn: 15 * 60 },
  );
}
