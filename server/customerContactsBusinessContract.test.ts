import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const bff = readFileSync(resolve(import.meta.dirname, "businessRouter.ts"), "utf8");
const delegated = readFileSync(resolve(import.meta.dirname, "../client/src/business/platform/front-router-types/server/services/internalBusinessDelegation.ts"), "utf8");
const readMethods = ["contactsList", "contactsSummary"];
const writeMethods = ["createMulti", "contactsAdd", "contactsEdit", "contactsStop", "contactsSetPrimary", "updateBasic"];
describe("customer contacts exact BFF restoration boundary", () => {
  it("keeps reads in the existing authorized customers module", () => {
    for (const method of readMethods) {
      expect(bff).toContain(`${method}: businessQuery("customer.${method}", "customers")`);
      expect(delegated).toContain(`"customer.${method}"`);
    }
    const reads = delegated.match(/for \(const method of \[([\s\S]*?)\] as const\) BUSINESS_METHOD_CAPABILITIES\[method\] = CUSTOMER_READ;/)?.[1] ?? "";
    for (const method of readMethods) expect(reads).toContain(`"customer.${method}"`);
  });
  it("keeps every new mutation under original customer permissions and transactions", () => {
    for (const method of writeMethods) expect(bff).toContain(`${method}: businessMutation("customer.${method}", "customers")`);
    const writes = delegated.match(/for \(const method of \[([\s\S]*?)\] as const\) BUSINESS_METHOD_CAPABILITIES\[method\] = CUSTOMER;/)?.[1] ?? "";
    for (const method of writeMethods) expect(writes).toContain(`"customer.${method}"`);
    expect(delegated).toContain('permission: ["customers.manage", "customers.manage_all"]');
    expect(delegated).toContain("customerRouter.createCaller(context)");
  });
  it("does not expose collaborator editing, shared lists or wildcard customer dispatch", () => {
    expect(bff).not.toMatch(/contactsSetCollaborators:\s*businessMutation/);
    expect(bff).not.toMatch(/contactsSharedList:\s*businessQuery/);
    expect(delegated).not.toContain('"customer.*"');
    expect(bff).toContain("withCurrentBusinessAuthorization(ctx, merchantId, capability");
    expect(bff).toContain("staffUserId: staffBinding.frontUserId");
    expect(bff).toContain("bindingVersion: staffBinding.bindingVersion");
  });
});
