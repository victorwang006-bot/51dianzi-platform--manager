import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("BusinessChatContract", () => {
  it("declares inquiry.receive and all reception-safe ChatPage paths without impersonating owner data", () => {
    const contract = source("./BusinessChatContract.ts");
    expect(contract).toContain('BUSINESS_CHAT_REQUIRED_PERMISSION = "inquiry.receive" satisfies ErpPermissionKey');
    for (const method of [
      "chat.listConversations", "chat.getMessages", "chat.getAttachmentUrl", "chat.sendMessage",
      "chat.listGroups", "chat.setGroupMembership", "chat.contactProfile", "chat.reportContact",
      "publicReview.state", "publicReview.create", "cart.count",
    ]) expect(contract).toContain(`"${method}"`);
    expect(contract).toContain('actor: "bound-real-staff"');
    expect(contract).toContain('"crm-data-owner"');
    expect(contract).not.toContain("ownerUserId");
    expect(contract).not.toContain("dataOwnerUserId");
  });

  it("does not treat private/chat buyer/member paths as enterprise reception capabilities", () => {
    const contract = source("./BusinessChatContract.ts");
    for (const method of [
      "chat.getServiceUser", "chat.getOrCreateConversation", "chat.startInventoryInquiry",
      "enterprise.myInvitations", "enterprise.acceptInvitation", "enterprise.rejectInvitation", "forum.unreadState",
    ]) expect(contract).toContain(`"${method}"`);
  });
});
