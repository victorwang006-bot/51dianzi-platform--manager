import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listPlatformPublicReviews: vi.fn(),
    getPlatformPublicReviewStats: vi.fn(),
    hidePlatformPublicReview: vi.fn(),
    restorePlatformPublicReview: vi.fn(),
  };
});

import { appRouter } from "./routers";
import * as db from "./db";

const read = (relativePath: string) => readFileSync(join(__dirname, "..", relativePath), "utf8");

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-open-id",
      name: "超级管理员",
      email: "admin@test.com",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: { "user-agent": "vitest" }, ip: "127.0.0.1" } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  } as TrpcContext;
}

function userContext(): TrpcContext {
  const context = adminContext();
  (context.user as { role: string }).role = "user";
  return context;
}

describe("评价管理窗口", () => {
  beforeEach(() => vi.clearAllMocks());

  it("注册受限菜单、路由和完整管理页面", () => {
    const app = read("client/src/App.tsx");
    const layout = read("client/src/components/DashboardLayout.tsx");
    const page = read("client/src/pages/Reviews.tsx");
    expect(app).toContain('path={"/reviews"}');
    expect(app).toContain('permission="logs.read"');
    expect(layout).toContain('label: "评价管理"');
    expect(layout).toContain('path: "/reviews"');
    expect(page).toContain("全部记录");
    expect(page).toContain("用户已删除");
    expect(page).toContain("平台已隐藏");
    expect(page).toContain("后台不可修改评价原文");
    expect(page).toContain("if (query.data && page > pageCount) setPage(pageCount)");
  });

  it("跨库查询保留原文、图片、回复和所有删除审核字段", () => {
    const source = read("server/db.ts");
    expect(source).toContain("listPlatformPublicReviews");
    expect(source).toContain("public_company_review_images");
    expect(source).toContain("deletedByUserId");
    expect(source).toContain("hiddenByAdminName");
    expect(source).toContain("restoredByAdminName");
    expect(source).toContain('action: "review.platform_hide"');
    expect(source).toContain('action: "review.platform_restore"');
  });

  it("列表和统计接口返回跨库评价数据", async () => {
    vi.mocked(db.listPlatformPublicReviews).mockResolvedValue({ available: true, items: [], total: 0 });
    vi.mocked(db.getPlatformPublicReviewStats).mockResolvedValue({ available: true, total: 3, published: 1, userDeleted: 1, platformHidden: 1 });
    const caller = appRouter.createCaller(adminContext());
    const list = await caller.reviewManagement.list({ status: "all", page: 1, pageSize: 30 });
    const stats = await caller.reviewManagement.stats();
    expect(list.available).toBe(true);
    expect(stats.userDeleted).toBe(1);
    expect(db.listPlatformPublicReviews).toHaveBeenCalledWith(expect.objectContaining({ status: "all", page: 1 }));
  });

  it("平台隐藏必须填写原因并携带管理员审计身份", async () => {
    vi.mocked(db.hidePlatformPublicReview).mockResolvedValue({ success: true });
    const caller = appRouter.createCaller(adminContext());
    await expect(caller.reviewManagement.hide({ reviewId: 8, reason: "" })).rejects.toThrow();
    const result = await caller.reviewManagement.hide({ reviewId: 8, reason: "内容不合规" });
    expect(result.success).toBe(true);
    expect(db.hidePlatformPublicReview).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: 8,
      reason: "内容不合规",
      actor: expect.objectContaining({ operatorName: "超级管理员" }),
    }));
  });

  it("平台隐藏记录支持恢复，用户删除记录只读", async () => {
    vi.mocked(db.restorePlatformPublicReview).mockResolvedValue({ success: true });
    const caller = appRouter.createCaller(adminContext());
    const result = await caller.reviewManagement.restore({ reviewId: 9 });
    expect(result.success).toBe(true);
    expect(db.restorePlatformPublicReview).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 9 }));
    const page = read("client/src/pages/Reviews.tsx");
    expect(page).toContain('row.status === "user_deleted"');
    expect(page).toContain("仅查看");
  });

  it("普通前台用户不能访问评价管理接口", async () => {
    const caller = appRouter.createCaller(userContext());
    await expect(caller.reviewManagement.list({ status: "all", page: 1, pageSize: 30 })).rejects.toThrow();
    expect(db.listPlatformPublicReviews).not.toHaveBeenCalled();
  });
});
