/**
 * ECS 本地持久化文件存储。
 *
 * 生产环境应通过 UPLOAD_DIR 指向独立于发布目录的共享路径，例如：
 * /opt/apps/dianzi51-admin-shared/uploads。
 * Nginx 将 /uploads/ 映射到同一目录，发布版本切换不会移动业务文件。
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

export function getUploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
}

function normalizeSubDir(subDir: string): string {
  const normalized = subDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error("LOCAL_UPLOAD_PATH_INVALID");
  }
  return normalized;
}

function normalizeExtension(ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\.+/, "");
  if (!/^[a-z0-9]{1,10}$/.test(normalized)) throw new Error("LOCAL_UPLOAD_EXTENSION_INVALID");
  return normalized;
}

function assertInsideUploadRoot(target: string): void {
  const root = getUploadRoot();
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("LOCAL_UPLOAD_PATH_OUTSIDE_ROOT");
  }
}

export type LocalStoredFile = {
  key: string;
  url: string;
  filePath: string;
};

/**
 * 将文件原子写入本地共享目录：先写同目录临时文件，再 rename 为最终文件。
 * 写入失败会清理临时文件，调用方无需处理半成品。
 */
export function saveLocalFile(subDir: string, ext: string, buffer: Buffer): LocalStoredFile {
  const safeSubDir = normalizeSubDir(subDir);
  const safeExt = normalizeExtension(ext);
  const root = getUploadRoot();
  const dir = path.resolve(root, safeSubDir);
  assertInsideUploadRoot(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });

  const token = crypto.randomUUID().replace(/-/g, "");
  const name = `${Date.now()}-${token.slice(0, 16)}.${safeExt}`;
  const key = `${safeSubDir}/${name}`;
  const filePath = path.join(dir, name);
  const tempPath = path.join(dir, `.${name}.${token.slice(16, 24)}.tmp`);

  try {
    fs.writeFileSync(tempPath, buffer, { flag: "wx", mode: 0o640 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // 保留原始写入异常；临时文件可由定期清理任务移除。
    }
    throw error;
  }

  return { key, url: `/uploads/${key}`, filePath };
}

/** 仅删除 UPLOAD_DIR 内的文件；用于数据库写入失败后的补偿清理。 */
export function removeLocalFile(filePath: string): void {
  assertInsideUploadRoot(filePath);
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}
