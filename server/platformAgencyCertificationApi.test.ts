import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelPlatformAgencyCertification,
  getPlatformAgencyCertificationDocument,
  listPlatformAgencyCertifications,
  reviewPlatformAgencyCertification,
  upsertPlatformAgencyCertification,
} from "./platformAgencyCertificationApi";

const TEST_KEY = "agency-certification-internal-key";
const binding = { creditCode: "91310000TEST000001", expectedOwnerUserId: 700001 };
const operator = {
  id: 9001,
  name: "初始超级管理员",
  role: "merchant_mgr",
  ipAddress: "203.0.113.9",
  userAgent: "test-agent",
};
const item = {
  id: 81,
  brands: ["ST(意法半导体)", "TI"],
  fileName: "st-agency.pdf",
  status: "active" as const,
  revision: 3,
  updatedAt: "2026-10-09T04:00:00.000Z",
};

function response(data: unknown, statusCode = 200) {
  return new Response(JSON.stringify([{ result: { data: { json: data } } }]), {
    status: statusCode,
    headers: { "content-type": "application/json" },
  });
}

function decode(value: string) {
  return Buffer.from(value.slice(4), "base64url").toString("utf8");
}

describe("internalAgencyCertification 后台代理", () => {
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

  it("列表通过 GET batch input 转发仅由服务端派生的绑定与操作人 header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ items: [item] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPlatformAgencyCertifications({ ...binding, operator })).resolves.toEqual({ items: [item] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toContain("/api/trpc/internalAgencyCertification.list?batch=1&input=");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(JSON.parse(new URL(url).searchParams.get("input") ?? "{}")["0"].json).toEqual(binding);
    expect(headers["x-portal-key"]).toBe(TEST_KEY);
    expect(decode(headers["x-internal-operator-id"])).toBe(String(operator.id));
    expect(decode(headers["x-internal-operator-name"])).toBe(operator.name);
    expect(Object.entries(headers)
      .filter(([name]) => name.startsWith("x-internal-operator-"))
      .every(([, value]) => [...value].every(character => character.charCodeAt(0) <= 127)))
      .toBe(true);
  });

  it("保存、取消与原件查看按合同使用受保护过程，浏览器无法填入 operator", async () => {
    const expiresAt = Date.now() + 5 * 60_000;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ success: true, id: item.id }))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ url: "https://private.example/signed", expiresAt, fileName: item.fileName }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(upsertPlatformAgencyCertification({
      ...binding,
      id: item.id,
      expectedRevision: item.revision,
      brands: item.brands,
      file: { fileName: item.fileName, mimeType: "application/pdf", base64: "JVBERi0=" },
      requestId: "c9b3b98f-81d3-43e5-9e3d-2030ba5691af",
      operator,
    })).resolves.toEqual({ success: true, id: item.id });
    await expect(cancelPlatformAgencyCertification({
      ...binding,
      id: item.id,
      expectedRevision: item.revision,
      requestId: "7a35ec80-11a5-4d62-a50b-440ee49240de",
      operator,
    })).resolves.toEqual({ success: true });
    await expect(getPlatformAgencyCertificationDocument({ ...binding, id: item.id, operator }))
      .resolves.toEqual({ url: "https://private.example/signed", expiresAt, fileName: item.fileName });

    const [upsertUrl, upsertInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(upsertUrl).toBe("http://platform.internal/api/trpc/internalAgencyCertification.upsert?batch=1");
    expect(upsertInit.method).toBe("POST");
    const upsertInput = JSON.parse(String(upsertInit.body))["0"].json;
    expect(upsertInput).toMatchObject({ ...binding, id: item.id, expectedRevision: item.revision, brands: item.brands });
    expect(upsertInput.file).toEqual({ fileName: item.fileName, mimeType: "application/pdf", base64: "JVBERi0=" });
    expect(upsertInput).not.toHaveProperty("operator");
    expect((upsertInit.headers as Record<string, string>)["x-portal-key"]).toBe(TEST_KEY);

    const [cancelUrl, cancelInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(cancelUrl).toBe("http://platform.internal/api/trpc/internalAgencyCertification.cancel?batch=1");
    expect(JSON.parse(String(cancelInit.body))["0"].json).toMatchObject({ ...binding, id: item.id, expectedRevision: item.revision });

    const [documentUrl, documentInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(documentUrl).toContain("/api/trpc/internalAgencyCertification.document?batch=1&input=");
    expect(documentInit.method).toBe("GET");
    expect(JSON.parse(new URL(documentUrl).searchParams.get("input") ?? "{}")["0"].json).toEqual({ ...binding, id: item.id });
  });

  it("拒绝不兼容响应并对上游错误中的 portal key 脱敏", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ items: [{ id: item.id }] }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        error: { json: { message: `主站拒绝 ${TEST_KEY}` } },
      }]), { status: 403 })));

    await expect(listPlatformAgencyCertifications({ ...binding, operator }))
      .rejects.toThrow("代理认证接口版本不兼容");
    await expect(getPlatformAgencyCertificationDocument({ ...binding, id: item.id, operator }))
      .rejects.toThrow("主站拒绝 [REDACTED]");
  });

  it("缺少 PORTAL_API_KEY 时不发起请求", async () => {
    delete process.env.PORTAL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPlatformAgencyCertifications({ ...binding, operator }))
      .rejects.toThrow("PORTAL_API_KEY 未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HK待审和驳回记录连同日期、原因及替代历史白名单透传，不把新增状态当active或遗漏", async () => {
    const extra = { authorizationIssuer: "品牌授权主体", validFrom: "2026-11-01", validUntil: null,
      supplementalNote: "申请补充说明", reviewReason: "授权范围不符", submittedAt: "2026-11-02T00:00:00Z",
      reviewedAt: null, createdAt: item.updatedAt, supersedesCertificationId: 70, effectiveBrands: [] };
    const pending = { ...item, ...extra, status: "pending" };
    const rejected = { ...pending, id: 82, status: "rejected" };
    const fetchMock = vi.fn().mockResolvedValue(response({ items: [
      { ...pending, objectKey: "private-key", url: "private-url", fileSha256: "private-hash", base64: "secret" }, rejected,
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const hk = { registrationRegion: "HK" as const, registrationIdentifier: "HK:01234567", expectedOwnerUserId: 700001 };
    await expect(listPlatformAgencyCertifications({ ...hk, operator })).resolves.toEqual({ items: [pending, rejected] });
    expect(JSON.parse(new URL(fetchMock.mock.calls[0][0]).searchParams.get("input") ?? "{}")['0'].json).toEqual(hk);
  });

  it("review使用POST、版本锁和幂等请求号，可信operator只在header且支持平台manual返回新id", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({ success: true, id: 99 }));
    vi.stubGlobal("fetch", fetchMock);
    const hk = { registrationRegion: "HK" as const, registrationIdentifier: "HK:01234567", expectedOwnerUserId: 700001 };
    const review = { ...hk, id: 81, expectedRevision: 3, decision: "reject" as const, reviewReason: "授权范围不符", requestId: "17ad5627-1982-4f31-adef-d9ac7d8b9d06" };
    await expect(reviewPlatformAgencyCertification({ ...review, operator })).resolves.toEqual({ success: true, id: 99 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("internalAgencyCertification.review?batch=1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))['0'].json).toEqual(review);
    expect(decode((init.headers as Record<string, string>)["x-internal-operator-name"])).toBe(operator.name);
    await expect(upsertPlatformAgencyCertification({ ...binding, id: 81, expectedRevision: 3, brands: item.brands, requestId: review.requestId, operator })).resolves.toEqual({ success: true, id: 99 });
  });

  it("拒绝未知状态、错误日期格式及错误effectiveBrands，不透传坏结果", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [{ ...item, status: "approved" }] }))
      .mockResolvedValueOnce(response({ items: [{ ...item, validUntil: "tomorrow" }] }))
      .mockResolvedValueOnce(response({ items: [{ ...item, effectiveBrands: [42] }] }));
    vi.stubGlobal("fetch", fetchMock);
    for (let n = 0; n < 3; n++) await expect(listPlatformAgencyCertifications({ ...binding, operator })).rejects.toThrow("版本不兼容");
  });
});
