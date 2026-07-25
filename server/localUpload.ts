/**
 * 本地磁盘文件存储（物料图片等）
 *
 * 生产 ECS 未配置 Manus Forge 存储凭证，采用 ECS 本地磁盘 + Nginx/Express 静态服务方案：
 * - 文件写入 UPLOAD_DIR（默认 <cwd>/uploads），按子目录分类
 * - 返回相对 URL（/uploads/...），生产经 Nginx /admin/uploads/ 提供访问，
 *   开发经 Express 静态挂载 /uploads 提供访问
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

/** 上传根目录（生产 cwd=/opt/apps/dianzi51-admin） */
export function getUploadRoot(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
}

/**
 * 保存文件到本地磁盘
 * @param subDir 分类子目录，如 material-images
 * @param ext 文件扩展名（不含点）
 * @param buffer 文件内容
 * @returns 相对 URL 路径（/uploads/<subDir>/<file>）与磁盘绝对路径
 */
export function saveLocalFile(subDir: string, ext: string, buffer: Buffer): { url: string; filePath: string } {
  const dir = path.join(getUploadRoot(), subDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}.${ext}`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buffer);
  return { url: `/uploads/${subDir}/${name}`, filePath };
}
