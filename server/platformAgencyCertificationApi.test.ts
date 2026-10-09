import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelPlatformAgencyCertification,
  getPlatformAgencyCertificationDocument,
  listPlatformAgencyCertifications,
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
});
