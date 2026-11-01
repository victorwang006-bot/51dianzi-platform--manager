import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPlatformBusinessContext,
  PlatformBusinessPublicError,
  PlatformBusinessServiceError,
  platformBusinessApiTestUtils,
} from "./platformBusinessApi";

const originalBaseUrl = process.env.PLATFORM_API_BASE;
const originalPortalKey = process.env.PORTAL_API_KEY;

function restoreEnv(name: "PLATFORM_API_BASE" | "PORTAL_API_KEY", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function mockedResponse(status: number, payload: unknown, jsonError?: Error) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: jsonError ? vi.fn().mockRejectedValue(jsonError) : vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv("PLATFORM_API_BASE", originalBaseUrl);
  restoreEnv("PORTAL_API_KEY", originalPortalKey);
});

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

  it.each([
    ["network", () => Promise.reject(new Error("network failed: portal key=do-not-log")), "NETWORK"],
    ["timeout", () => Promise.reject(Object.assign(new Error("timeout secret=do-not-log"), { name: "TimeoutError" })), "TIMEOUT"],
    ["5xx", () => Promise.resolve(mockedResponse(503, { error: { json: { data: { code: "FORBIDDEN" }, message: "not authoritative" } } })), "UPSTREAM_5XX"],
    ["parse", () => Promise.resolve(mockedResponse(200, null, new Error("invalid json token=do-not-log"))), "PARSE"],
    ["malformed result", () => Promise.resolve(mockedResponse(200, { result: {} })), "INVALID_RESPONSE"],
  ] as const)("将 %s 转换为不含上游原文的 %s 受控失败", async (_caseName, response, kind) => {
    process.env.PLATFORM_API_BASE = "https://platform.test";
    process.env.PORTAL_API_KEY = "test-only-key";
    vi.stubGlobal("fetch", vi.fn(response));

    const failure = getPlatformBusinessContext({ creditCode: "91310000TEST", expectedOwnerUserId: 1 });
    await expect(failure).rejects.toBeInstanceOf(PlatformBusinessServiceError);
    await expect(failure).rejects.toMatchObject({ kind, message: "主站业务服务暂不可用，请稍后重试" });
  });

  it("配置缺失也使用受控 failure kind，不尝试网络访问", async () => {
    delete process.env.PLATFORM_API_BASE;
    delete process.env.PORTAL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlatformBusinessContext({ creditCode: "91310000TEST", expectedOwnerUserId: 1 }))
      .rejects.toMatchObject({ kind: "CONFIGURATION" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("200 的真实领域拒绝仍保留公开错误边界", async () => {
    process.env.PLATFORM_API_BASE = "https://platform.test";
    process.env.PORTAL_API_KEY = "test-only-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockedResponse(200, {
      error: { json: { data: { code: "FORBIDDEN" }, message: "当前员工无企业权限" } },
    })));

    await expect(getPlatformBusinessContext({ creditCode: "91310000TEST", expectedOwnerUserId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "当前员工无企业权限" });
  });
});
