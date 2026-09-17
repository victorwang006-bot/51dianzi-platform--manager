import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlatformHomepageFeatureStatus,
  setPlatformHomepageFeatured,
} from "./platformCompanyMediaApi";

const TEST_KEY = "homepage-feature-internal-key";
const binding = { creditCode: "91310000TEST000001", expectedOwnerUserId: 700001 };
const operator = {
  id: 9001,
  name: "测试管理员",
  role: "merchant_mgr",
  ipAddress: "203.0.113.9",
  userAgent: "test-agent",
};
const status = {
  featured: false,
  eligible: true,
  approvedPhotoCount: 3,
  hasPublishedInventory: true,
  missingReasons: [],
};

function response(data: unknown, statusCode = 200) {
  return new Response(JSON.stringify([{ result: { data: { json: data } } }]), {
    status: statusCode,
    headers: { "content-type": "application/json" },
  });
}

describe("internalCompanyMedia 首页精选代理", () => {
  beforeEach(() => {
    process.env.PLATFORM_API_BASE = "http://platform.internal";
    process.env.PORTAL_API_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.PLATFORM_API_BASE;
    delete process.env.PORTAL_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("状态查询复用 PORTAL_API_KEY、GET batch input，并传递服务端企业绑定", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(status));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlatformHomepageFeatureStatus(binding)).resolves.toEqual(status);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/trpc/internalCompanyMedia.homepageFeatureStatus?batch=1&input=");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["x-portal-key"]).toBe(TEST_KEY);
    const input = JSON.parse(new URL(url).searchParams.get("input") ?? "{}");
    expect(input["0"].json).toEqual(binding);
  });

  it("设置或取消精选使用 POST，并携带由后台上下文生成的操作人", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ...status, featured: true }))
      .mockResolvedValueOnce(response(status));
    vi.stubGlobal("fetch", fetchMock);

    await expect(setPlatformHomepageFeatured({ ...binding, featured: true, operator }))
      .resolves.toEqual({ ...status, featured: true });
    await expect(setPlatformHomepageFeatured({ ...binding, featured: false, operator }))
      .resolves.toEqual(status);

    for (const [index, featured] of [true, false].entries()) {
      const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
      expect(url).toBe(`http://platform.internal/api/trpc/internalCompanyMedia.${featured ? "setHomepageFeatured" : "clearHomepageFeatured"}?batch=1`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["x-portal-key"]).toBe(TEST_KEY);
      expect((init.headers as Record<string, string>)["x-internal-operator-id"]).toBe(String(operator.id));
      expect((init.headers as Record<string, string>)["x-internal-operator-name"]).toBe(operator.name);
      expect((init.headers as Record<string, string>)["x-internal-operator-role"]).toBe(operator.role);
      const mutationInput = JSON.parse(String(init.body))["0"].json;
      expect(mutationInput).toMatchObject({
        ...binding,
        reason: featured ? "后台设置为优质商家" : "后台取消优质商家",
      });
      expect(mutationInput.requestId).toMatch(/^homepage-feature:/);
      expect(mutationInput).not.toHaveProperty("featured");
      expect(mutationInput).not.toHaveProperty("operator");
    }
  });

  it("拒绝不完整的主站状态并对上游错误脱敏内部密钥", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ featured: false }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        error: { json: { message: `主站拒绝 ${TEST_KEY}` } },
      }]), { status: 403 })));

    await expect(getPlatformHomepageFeatureStatus(binding))
      .rejects.toThrow("商城首页精选接口版本不兼容");
    await expect(setPlatformHomepageFeatured({ ...binding, featured: true, operator }))
      .rejects.toThrow("主站拒绝 [REDACTED]");
  });

  it("缺少 PORTAL_API_KEY 时不发起主站请求", async () => {
    delete process.env.PORTAL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlatformHomepageFeatureStatus(binding))
      .rejects.toThrow("PORTAL_API_KEY 未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
