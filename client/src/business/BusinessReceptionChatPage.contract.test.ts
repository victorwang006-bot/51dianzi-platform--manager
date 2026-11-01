import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./platform/client/src/pages/ChatPage.tsx", import.meta.url), "utf8");

describe("Business reception ChatPage contract", () => {
  it("keeps the optional reception surface while disabling personal service, buyer, forum and invitation RPCs", () => {
    expect(page).toContain("businessReception?: BusinessReceptionConfig");
    expect(page).toContain("enabled: primeProtectedChatQueries && wantService && !receptionMode");
    expect(page).toContain("const targetUserId = !receptionMode && wantService");
    expect(page).toContain("if (receptionMode) return;");
    expect(page).toContain("useForumUnreadTotal(Boolean(user) && !receptionMode)");
    expect(page).toContain("enabled: !receptionMessage && Number.isSafeInteger(invitationId)");
  });

  it("removes the scope visual block without changing the protected reception surface", () => {
    expect(page).not.toContain('data-testid="business-reception-scope-notice"');
    expect(page).toContain('data-testid="business-reception-invitation-notice"');
    expect(page).toContain("businessReception={businessReception}");
    expect(page).not.toContain("企业接待范围：");
    expect(page).not.toContain("论坛未读和企业成员邀请属于员工个人流程");
  });
});
