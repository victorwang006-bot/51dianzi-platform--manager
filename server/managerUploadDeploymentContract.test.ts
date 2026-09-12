import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const extractionScript = readFileSync("deploy/extract-admin-runtime-env.sh", "utf8");
const productionConfig = readFileSync("deploy/ecosystem.config.production.cjs", "utf8");
const exampleConfig = readFileSync("deploy/ecosystem.config.example.cjs", "utf8");

describe("管理员上传运行时环境部署契约", () => {
  it("固化 Forge 代理凭据且输出只脱敏展示键名", () => {
    expect(extractionScript).toContain('"BUILT_IN_FORGE_API_URL"');
    expect(extractionScript).toContain('"BUILT_IN_FORGE_API_KEY"');
    expect(extractionScript).toContain("sed -E 's/=.*/=***/' \"$OUT_FILE\"");
    expect(extractionScript).toContain('print("已固化：" + ", ".join(found))');
    expect(extractionScript).not.toContain("print(v)");
  });

  it("生产启动和示例配置均将 Forge URL 与密钥列为必需运行时变量", () => {
    for (const key of ["BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY"]) {
      expect(productionConfig).toContain(`"${key}"`);
      expect(exampleConfig).toContain(`${key}: process.env.${key}`);
    }
    expect(productionConfig).toContain("错误只包含键名，绝不输出 runtime.env 中的值");
    expect(productionConfig).not.toContain("console.log(sharedEnv");
  });
});
