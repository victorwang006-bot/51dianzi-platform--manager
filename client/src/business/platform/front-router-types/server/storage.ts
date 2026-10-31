// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import crypto from "node:crypto";
import { ENV } from "./_core/env";
import OSS from "ali-oss";

// ─── 阿里云 OSS（dianzi51-assets 桶，用于营业执照等业务文件） ───

let ossClient: OSS | null = null;

export function isOssConfigured(): boolean {
  return Boolean(
    ENV.ossAccessKeyId && ENV.ossAccessKeySecret && ENV.ossBucket && ENV.ossRegion,
  );
}

function getOssClient(): OSS {
  if (!isOssConfigured()) {
    throw new Error(
      "OSS config missing: set ALI_OSS_ACCESS_KEY_ID / ALI_OSS_ACCESS_KEY_SECRET / ALI_OSS_BUCKET / ALI_OSS_REGION",
    );
  }
  if (!ossClient) {
    ossClient = new OSS({
      region: ENV.ossRegion,
      accessKeyId: ENV.ossAccessKeyId,
      accessKeySecret: ENV.ossAccessKeySecret,
      bucket: ENV.ossBucket,
      secure: true,
    });
  }
  return ossClient;
}

/** 上传文件到阿里云 OSS，返回 key 与可访问 URL（带签名，1年有效；桶若为公共读则直接用无签名URL） */
export async function ossPut(
  relKey: string,
  data: Buffer,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const client = getOssClient();
  const key = normalizeKey(relKey);
  await client.put(key, data, {
    headers: { "Content-Type": contentType },
  } as any);
  const url = `https://${ENV.ossBucket}.${ENV.ossRegion}.aliyuncs.com/${key}`;
  return { key, url };
}

/** 上传私有对象；聊天附件等敏感文件必须走此入口，禁止依赖桶默认 ACL。 */
export async function ossPutPrivate(
  relKey: string,
  data: Buffer,
  contentType = "application/octet-stream",
): Promise<{ key: string }> {
  const client = getOssClient();
  const key = normalizeKey(relKey);
  await client.put(key, data, {
    headers: {
      "Content-Type": contentType,
      "x-oss-object-acl": "private",
    },
  } as any);
  return { key };
}

/** 获取 OSS 私有对象的临时签名 URL（默认1小时） */
export function ossGetSignedUrl(key: string, expiresSeconds = 3600): string {
  const client = getOssClient();
  return client.signatureUrl(normalizeKey(key), { expires: signedUrlExpiry(expiresSeconds) });
}

/** 服务端读取私有OSS对象；调用方必须先完成业务授权或公开状态校验。 */
export async function ossGetPrivateBuffer(key: string): Promise<Buffer> {
  const result = await getOssClient().get(normalizeKey(key));
  const content = result.content;
  if (!content) throw new Error("OSS object body missing");
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (
    !key
    || key.length > 1024
    || /[\x00-\x1f\x7f]/.test(key)
    || key.split("/").some(segment => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Storage object key is invalid");
  }
  return key;
}

function signedUrlExpiry(expiresSeconds: number): number {
  if (!Number.isInteger(expiresSeconds) || expiresSeconds < 60 || expiresSeconds > 3600) {
    throw new Error("Private object URL expiry must be between 60 and 3600 seconds");
  }
  return expiresSeconds;
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

/**
 * 通用对象存储写入。后端优先级：阿里云 OSS → Manus Forge/S3。
 *
 * 生产 ECS 未配置 Forge 凭证（BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY 为空），
 * 若直接依赖 Forge 则一律抛出 "Storage config missing"，导致库存实拍照片、协议签名、
 * BOM 附件等上传在生产全部不可用。OSS 凭证（dianzi51-assets 桶）已在生产配齐，
 * 因此以 OSS 为首选后端，Forge 仅作为本地/模板环境的回退。
 *
 * 返回的 url 在 OSS 分支为绝对地址（桶公共读，可直接访问），
 * 在 Forge 分支保持既有 /manus-storage/{key} 代理路径；调用方必须兼容两种形态。
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  if (isOssConfigured()) {
    const ossKey = appendHashSuffix(normalizeKey(relKey));
    const body =
      typeof data === "string"
        ? Buffer.from(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
    return ossPut(ossKey, body, contentType);
  }

  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

/**
 * 删除对象。生产使用 OSS，可确保业务写入失败时不遗留公开孤儿文件。
 * Forge 模板存储没有受支持的删除接口，因此本地回退环境返回 false。
 */
export async function storageDelete(relKey: string): Promise<boolean> {
  const key = normalizeKey(relKey);
  if (!key) return false;
  if (isOssConfigured()) {
    await getOssClient().delete(key);
    return true;
  }
  return false;
}

/**
 * 写入私有业务文件。调用方只拿到稳定对象 key，绝不能持久化临时签名 URL；
 * 读取时必须在完成业务授权后通过 storageGetAccessUrl 签发短时访问地址。
 * 未配置 OSS 时拒绝上传，禁止回退到公开或 ACL 语义不明确的存储。
 */
export async function storagePutPrivate(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string }> {
  if (!isOssConfigured()) {
    throw new Error("私有对象存储未配置");
  }
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
  await ossPutPrivate(key, body, contentType);
  return { key };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}

/**
 * 返回受控文件的临时访问地址。聊天附件等私有业务文件只存 key，
 * 每次在服务端完成会话成员权限校验后调用本函数，避免把永久公网地址写入消息。
 */
export async function storageGetAccessUrl(relKey: string, expiresSeconds = 3600): Promise<string> {
  if (isOssConfigured()) return ossGetSignedUrl(relKey, expiresSeconds);
  return storageGetSignedUrl(relKey);
}
