import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: "admin" | "user" | null): TrpcContext {
  const user: AuthenticatedUser | null = role
    ? {
        id: 1,
        openId: "test-user",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "manus",
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      }
    : null;
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("material 文件上传权限", () => {
  it("未登录用户上传 PDF 应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(
      caller.material.uploadDatasheet({ fileName: "a.pdf", base64: "JVBERi0=" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("普通用户上传 PDF 应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    await expect(
      caller.material.uploadDatasheet({ fileName: "a.pdf", base64: "JVBERi0=" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("非 PDF 文件名应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    await expect(
      caller.material.uploadDatasheet({ fileName: "a.exe", base64: "JVBERi0=" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("非 PDF 魔数内容应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const notPdf = Buffer.from("hello world").toString("base64");
    await expect(
      caller.material.uploadDatasheet({ fileName: "a.pdf", base64: notPdf }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("不支持的图片类型应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    await expect(
      caller.material.uploadImage({ fileName: "a.bmp", mimeType: "image/bmp", base64: "aGVsbG8=" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("material 前台公开搜索", () => {
  it("未登录可调用 search 并返回分页结构", async () => {
    const caller = appRouter.createCaller(createContext(null));
    const result = await caller.material.search({ keyword: "STM32", page: 1, pageSize: 5 });
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeLessThanOrEqual(5);
    if (result.data.length > 0) {
      const row = result.data[0];
      expect(row).toHaveProperty("partNumber");
      expect(row).toHaveProperty("specs");
      expect(row).toHaveProperty("coverImageUrl");
      expect(row).toHaveProperty("images");
      expect(row).toHaveProperty("datasheetUrl");
    }
  });

  it("按参数值筛选（specFilters）可执行且返回匹配结果", async () => {
    const caller = appRouter.createCaller(createContext(null));
    const result = await caller.material.search({
      specFilters: { CPU内核: "Cortex" },
      page: 1,
      pageSize: 5,
    });
    expect(result).toHaveProperty("total");
    for (const row of result.data) {
      const specs = (row.specs ?? {}) as Record<string, string>;
      expect(specs["CPU内核"] ?? "").toContain("Cortex");
    }
  });

  it("getSpecs 返回图片与 PDF 字段", async () => {
    const caller = appRouter.createCaller(createContext(null));
    const found = await caller.material.search({ page: 1, pageSize: 1 });
    if (found.data.length === 0) return; // 无数据时跳过
    const specs = await caller.material.getSpecs({ partNumber: found.data[0].partNumber });
    expect(specs).not.toBeNull();
    expect(specs).toHaveProperty("coverImageUrl");
    expect(specs).toHaveProperty("images");
    expect(specs).toHaveProperty("datasheetFileKey");
    expect(specs).toHaveProperty("datasheetFileName");
  });
});
