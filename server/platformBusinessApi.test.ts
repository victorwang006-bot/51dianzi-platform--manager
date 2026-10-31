import { describe, expect, it } from "vitest";
import {
  PlatformBusinessPublicError,
  platformBusinessApiTestUtils,
} from "./platformBusinessApi";

describe("平台业务错误边界", () => {
  it("保留白名单的原领域错误码与正常用户消息", () => {
    const error = platformBusinessApiTestUtils.publicUpstreamError({
      json: { message: "版本已变化，请刷新后重试", data: { code: "CONFLICT" } },
    });
    expect(error).toBeInstanceOf(PlatformBusinessPublicError);
    expect(error).toMatchObject({ code: "CONFLICT", message: "版本已变化，请刷新后重试" });
  });

  it("拒绝带堆栈、SQL 或未列入白名单的下游错误", () => {
    expect(platformBusinessApiTestUtils.publicUpstreamError({
      json: { message: "Error: SELECT * FROM enterprise_members", data: { code: "INTERNAL_SERVER_ERROR" } },
    })).toBeNull();
    expect(platformBusinessApiTestUtils.publicUpstreamError({
      json: { message: "stack trace: token=secret", data: { code: "FORBIDDEN" } },
    })).toBeNull();
  });
});
