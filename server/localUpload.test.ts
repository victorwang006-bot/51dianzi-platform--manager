import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getUploadRoot, removeLocalFile, saveLocalFile } from "./localUpload";

let tempRoot = "";
let previousUploadDir: string | undefined;

beforeEach(() => {
  previousUploadDir = process.env.UPLOAD_DIR;
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "company-wall-upload-"));
  process.env.UPLOAD_DIR = tempRoot;
});

afterEach(() => {
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("ECS 本地持久化上传", () => {
  it("以随机文件名原子写入指定公司目录并返回公开 URL", () => {
    const stored = saveLocalFile("company-wall/123", "jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(stored.key).toMatch(/^company-wall\/123\/\d+-[a-f0-9]{16}\.jpg$/);
    expect(stored.url).toBe(`/uploads/${stored.key}`);
    expect(fs.readFileSync(stored.filePath)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(path.resolve(stored.filePath).startsWith(`${getUploadRoot()}${path.sep}`)).toBe(true);
    expect(fs.statSync(stored.filePath).mode & 0o777).toBe(0o644);
    expect(fs.statSync(path.dirname(stored.filePath)).mode & 0o777).toBe(0o755);
    expect(fs.readdirSync(path.dirname(stored.filePath)).some(name => name.endsWith(".tmp"))).toBe(false);
  });

  it("拒绝目录穿越和非法扩展名", () => {
    expect(() => saveLocalFile("../outside", "jpg", Buffer.from("x"))).toThrow("LOCAL_UPLOAD_PATH_INVALID");
    expect(() => saveLocalFile("company-wall/123", "../../sh", Buffer.from("x"))).toThrow("LOCAL_UPLOAD_EXTENSION_INVALID");
  });

  it("补偿清理只能删除上传根目录内文件", () => {
    const stored = saveLocalFile("company-wall/123", "png", Buffer.from("png"));
    removeLocalFile(stored.filePath);
    expect(fs.existsSync(stored.filePath)).toBe(false);
    expect(() => removeLocalFile(path.join(tempRoot, "..", "outside.png"))).toThrow("LOCAL_UPLOAD_PATH_OUTSIDE_ROOT");
  });
});
