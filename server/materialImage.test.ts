import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { appRouter } from "./routers";
import * as db from "./db";
import { getUploadRoot } from "./localUpload";

// 本地无 PORTAL_API_KEY 时注入测试密钥
if (!process.env.PORTAL_API_KEY) {
  process.env.PORTAL_API_KEY = "test-portal-key-local";
}
const PORTAL_KEY = process.env.PORTAL_API_KEY!;

function makeCaller(portalKey?: string) {
  return appRouter.createCaller({
    user: null,
    adminAccount: null,
    req: { headers: portalKey ? { "x-portal-key": portalKey } : {}, cookies: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
  } as any);
}

/** 1x1 红色像素 PNG */
const PNG_1PX_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const TEST_PART_NUMBER = `TEST-IMG-${Date.now()}`;
let createdMaterialId: number | null = null;
const savedFiles: string[] = [];

beforeAll(async () => {
  const material = await db.createMaterial({
    partNumber: TEST_PART_NUMBER,
    name: "图片上传测试物料",
    category: "微控制器",
  } as any);
  createdMaterialId = material?.id ?? null;
});

afterAll(async () => {
  if (createdMaterialId) await db.deleteMaterial(createdMaterialId).catch(() => {});
  for (const f of savedFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

describe("portal.uploadMaterialImage（物料图片上传回写）", () => {
  it("无密钥拒绝", async () => {
    const caller = makeCaller();
    await expect(
      caller.portal.uploadMaterialImage({
        partNumber: TEST_PART_NUMBER,
        fileName: "a.png",
        mimeType: "image/png",
        base64: PNG_1PX_BASE64,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("型号不存在返回 NOT_FOUND", async () => {
    const caller = makeCaller(PORTAL_KEY);
    await expect(
      caller.portal.uploadMaterialImage({
        partNumber: "NO-SUCH-PART-XYZ-000",
        fileName: "a.png",
        mimeType: "image/png",
        base64: PNG_1PX_BASE64,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("非法 mimeType 拒绝", async () => {
    const caller = makeCaller(PORTAL_KEY);
    await expect(
      caller.portal.uploadMaterialImage({
        partNumber: TEST_PART_NUMBER,
        fileName: "a.exe",
        mimeType: "application/octet-stream",
        base64: PNG_1PX_BASE64,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("伪装图片（垃圾数据声明 image/png）拒绝：魔数校验失败", async () => {
    const caller = makeCaller(PORTAL_KEY);
    const garbage = Buffer.from("this is not an image at all, just garbage bytes 12345").toString("base64");
    await expect(
      caller.portal.uploadMaterialImage({
        partNumber: TEST_PART_NUMBER,
        fileName: "fake.png",
        mimeType: "image/png",
        base64: garbage,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("正常上传：写文件 + 回写封面与图集（大小写不敏感匹配）", async () => {
    const caller = makeCaller(PORTAL_KEY);
    const result = await caller.portal.uploadMaterialImage({
      partNumber: TEST_PART_NUMBER.toLowerCase(),
      fileName: `${TEST_PART_NUMBER}.png`,
      mimeType: "image/png",
      base64: PNG_1PX_BASE64,
    });
    expect(result.partNumber).toBe(TEST_PART_NUMBER);
    expect(result.url).toMatch(/^\/uploads\/material-images\/.+\.png$/);
    expect(result.coverImageUrl).toBe(result.url);
    expect(result.imageCount).toBe(1);
    // 磁盘文件存在
    const filePath = path.join(getUploadRoot(), result.url.replace("/uploads/", ""));
    expect(fs.existsSync(filePath)).toBe(true);
    savedFiles.push(filePath);
    // 数据库已回写
    const material = await db.getMaterialById(createdMaterialId!);
    expect(material?.coverImageUrl).toBe(result.url);
    expect(material?.images?.length).toBe(1);
    // 再传一张 asCover=false：封面不变，图集追加
    const second = await caller.portal.uploadMaterialImage({
      partNumber: TEST_PART_NUMBER,
      fileName: "second.png",
      mimeType: "image/png",
      base64: PNG_1PX_BASE64,
      asCover: false,
    });
    expect(second.coverImageUrl).toBe(result.url);
    expect(second.imageCount).toBe(2);
    savedFiles.push(path.join(getUploadRoot(), second.url.replace("/uploads/", "")));
  });
});
