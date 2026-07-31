import { describe, expect, it } from "vitest";
import { isSmsConfigured, sendSmsCode } from "./sms";

const smsConfigured = isSmsConfigured();

describe("短信服务配置检测", () => {
  it("未配置生产凭证时返回明确且安全的回退结果", async () => {
    if (smsConfigured) {
      expect(isSmsConfigured()).toBe(true);
      return;
    }

    expect(isSmsConfigured()).toBe(false);
    await expect(sendSmsCode("13800000000", "123456")).resolves.toMatchObject({
      ok: false,
      code: "NOT_CONFIGURED",
    });
  });
});

describe.skipIf(!smsConfigured)("阿里云短信服务（已配置环境）", () => {
  it("凭证签名有效（API 返回业务响应而非鉴权错误）", async () => {
    // 使用一个格式合法的测试号码调用真实 API。
    // 判定标准：凭证无效时返回签名/AK类错误（InvalidAccessKeyId / SignatureDoesNotMatch / Forbidden.AccessKey）；
    // 凭证有效时返回 OK 或业务类错误（如流控、号码问题），均视为凭证校验通过。
    const result = await sendSmsCode("13800000000", "123456");
    const credentialErrors = [
      "InvalidAccessKeyId.NotFound",
      "SignatureDoesNotMatch",
      "Forbidden.AccessKey",
      "InvalidAccessKeyId",
      "NOT_CONFIGURED",
    ];
    expect(credentialErrors).not.toContain(result.code);
  }, 15000);
});
