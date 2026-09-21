import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const messages = readFileSync(resolve(root, "client/src/pages/Messages.tsx"), "utf8");
const lookup = readFileSync(resolve(root, "client/src/components/MerchantOwnershipLookup.tsx"), "utf8");

describe("开户消息客户归属查询入口", () => {
  it("仅在开通消息且拥有商户读取权限时显示入口", () => {
    expect(messages).toContain('const isOnboarding = threadType === "onboarding"');
    expect(messages).toContain('hasAdminPermission(role, "merchants.read", permissions)');
    expect(messages).toContain("isOnboarding && canReadMerchants && (thread.contactPhone || thread.portalUserId)");
    expect(messages).toContain("客户归属查询");
  });

  it("复用现有归属弹窗并自动带入手机号和前台用户ID", () => {
    expect(messages).toContain("<MerchantOwnershipLookup");
    expect(messages).toContain('initialQuery={thread.contactPhone || thread.portalUserId || ""}');
    expect(messages).toContain("messageThreadId={threadId}");
    expect(lookup).toContain('initialQuery = ""');
    expect(lookup).toContain("messageThreadId?: number");
    expect(lookup).toContain("setDraft(automaticQuery)");
    expect(lookup).toContain("setQuery(automaticQuery)");
    expect(lookup).toContain("trpc.message.ownershipSearch.useQuery");
    expect(lookup).toContain("setUseMessageThreadEvidence(false)");
  });

  it("不增加跟进状态或新的归属数据源", () => {
    expect(messages).not.toContain("最近跟进");
    expect(messages).not.toContain("跟进状态");
    expect(messages).not.toContain("新增归属");
  });
});
