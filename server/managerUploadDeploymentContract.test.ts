import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const extractionScript = readFileSync("deploy/extract-admin-runtime-env.sh", "utf8");
const productionConfig = readFileSync("deploy/ecosystem.config.production.cjs", "utf8");
const exampleConfig = readFileSync("deploy/ecosystem.config.example.cjs", "utf8");
const storageSource = readFileSync("server/storage.ts", "utf8");
const storageProxySource = readFileSync("server/_core/storageProxy.ts", "utf8");

describe("管理员上传运行时环境部署契约", () => {
  it("固化 Forge 代理凭据且输出只脱敏展示键名", () => {
    expect(extractionScript).toContain('"BUILT_IN_FORGE_API_URL"');
    expect(extractionScript).toContain('"BUILT_IN_FORGE_API_KEY"');
    expect(extractionScript).toContain("sed -E 's/=.*/=***/' \"$OUT_FILE\"");
    expect(extractionScript).toContain('print("已固化：" + ", ".join(found))');
    expect(extractionScript).not.toContain("print(v)");
    for (const key of ["ALI_OSS_ACCESS_KEY_ID", "ALI_OSS_ACCESS_KEY_SECRET", "ALI_OSS_BUCKET", "ALI_OSS_REGION"]) {
      expect(extractionScript).toContain(`"${key}"`);
    }
  });

  it("生产启动接受完整 Forge 或完整 Ali OSS 存储配置", () => {
    for (const key of ["BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY"]) {
      expect(productionConfig).toContain(`sharedEnv.${key}`);
      expect(exampleConfig).toContain(`${key}: process.env.${key}`);
    }
    for (const key of ["ALI_OSS_ACCESS_KEY_ID", "ALI_OSS_ACCESS_KEY_SECRET", "ALI_OSS_BUCKET", "ALI_OSS_REGION"]) {
      expect(productionConfig).toContain(`"${key}"`);
      expect(exampleConfig).toContain(`${key}: process.env.${key}`);
    }
    expect(productionConfig).toContain("hasForgeStorage");
    expect(productionConfig).toContain("hasOssStorage");
    expect(productionConfig).toContain("错误只包含键名，绝不输出 runtime.env 中的值");
    expect(productionConfig).not.toContain("console.log(sharedEnv");
  });

  it("Ali OSS 后备上传强制 private，并由统一代理签发短时下载地址", () => {
    expect(storageSource).toContain("new PutObjectCommand");
    expect(storageSource).toContain('ACL: "private"');
    expect(storageSource).toContain("new GetObjectCommand");
    expect(storageSource).toContain("{ expiresIn: 15 * 60 }");
    expect(storageSource).toContain("forgeConfig() || ossConfig()");
    expect(storageProxySource).toContain('import { storageGetSignedUrl } from "../storage"');
    expect(storageProxySource).toContain("await storageGetSignedUrl(key)");
    expect(storageProxySource).not.toContain("ENV.forgeApiUrl");
  });
});
