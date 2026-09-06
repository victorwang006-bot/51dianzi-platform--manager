import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlatformUserForumMessages,
  getPlatformUserModerationHistory,
  hidePlatformForumMessage,
  listPlatformUsers,
  setPlatformUserForumMute,
  setPlatformUserLoginDisabled,
} from "./platformUserApi";

const TEST_KEY = "fake-portal-key-for-tests";
const operator = {
  id: 9001,
  name: "测试管理员",
  role: "operation",
  ipAddress: "203.0.113.9",
  userAgent: "test-agent",
};

function response(data: unknown, batch = true, status = 200) {
  const envelope = { result: { data: { json: data } } };
  return new Response(JSON.stringify(batch ? [envelope] : envelope), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("internalUser 平台代理契约", () => {
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

  it("列表和两类记录查询继续使用 GET + batch input", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ rows: [], total: 0 }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ rows: [] }, false));
    vi.stubGlobal("fetch", fetchMock);

    await listPlatformUsers({ page: 2, pageSize: 20, keyword: "张三" });
    await getPlatformUserModerationHistory({ userId: 7, limit: 50 });
    await getPlatformUserForumMessages({ userId: 7, limit: 50 });

    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      expect(url).toContain("?batch=1&input=");
      expect((init.headers as Record<string, string>)["x-portal-key"]).toBe(TEST_KEY);
    }
    expect(fetchMock.mock.calls[0][0]).toContain("/api/trpc/internalUser.list");
    expect(fetchMock.mock.calls[1][0]).toContain("/api/trpc/internalUser.moderationHistory");
    expect(fetchMock.mock.calls[2][0]).toContain("/api/trpc/internalUser.forumMessages");
    const listInput = JSON.parse(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("input") ?? "{}");
    expect(listInput["0"].json).toEqual({ page: 2, pageSize: 20, keyword: "张三" });
  });

  it("三项写操作使用 tRPC POST，input 仅置于 JSON body", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response({ success: true })));
    vi.stubGlobal("fetch", fetchMock);

    await setPlatformUserLoginDisabled({ userId: 7, disabled: true, reason: "异常登录", operator });
    await setPlatformUserForumMute({ userId: 7, durationHours: 24, reason: "刷屏", operator });
    await hidePlatformForumMessage({ messageId: 99, reason: "违规内容", operator });

    const procedures = ["setLoginDisabled", "setForumMute", "hideForumMessage"];
    fetchMock.mock.calls.forEach((call, index) => {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe(`http://platform.internal/api/trpc/internalUser.${procedures[index]}?batch=1`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["x-portal-key"]).toBe(TEST_KEY);
      const body = JSON.parse(String(init.body));
      expect(body["0"].json.operator).toEqual(operator);
    });
  });

  it("正确解析 batch 和 non-batch 错误并脱敏内部密钥", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        error: { json: { message: `上游拒绝：${TEST_KEY}` } },
      }]), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { json: { data: { message: "消息不存在" } } },
      }), { status: 404 })));

    await expect(setPlatformUserLoginDisabled({ userId: 7, disabled: true, reason: "风险", operator }))
      .rejects.toThrow("上游拒绝：[REDACTED]");
    await expect(hidePlatformForumMessage({ messageId: 99, reason: "违规", operator }))
      .rejects.toThrow("消息不存在");
  });

  it("缺少共享密钥时不发起上游请求", async () => {
    delete process.env.PORTAL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPlatformUserModerationHistory({ userId: 1, limit: 20 }))
      .rejects.toThrow("PORTAL_API_KEY 未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
