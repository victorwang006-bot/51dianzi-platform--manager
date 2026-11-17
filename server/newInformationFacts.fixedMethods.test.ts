import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNEL_INVENTORY_BUSINESS_METHOD_IDS, CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES, isChannelInventoryBusinessMethodId } from "../client/src/business/platform/shared/channelInventoryBusinessPolicy";
import { NATIVE_TEAM_READ_METHODS, officialInventoryMethodRequirement, officialInventoryPermissionsSchema, type OfficialInventoryPermissions } from "../shared/internalBusinessOfficialInventory";
import { signedOfficialInventoryGrantSchema as embeddedGrantSchema } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
import { bindOfficialInventoryGrant, officialInventoryErpEntitled, officialInventoryGrantForRequest, verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";
import { signOfficialInventoryGrant } from "./platformBusinessApi";
import type { StaffDelegation } from "../client/src/business/platform/front-router-types/server/_core/context";
import { CHANNEL_INVENTORY_BUSINESS_METHOD_IDS as frontIds, CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES as frontPolicies } from "../../51dianzi-platform/shared/channelInventoryBusinessPolicy";
import { NATIVE_TEAM_READ_METHODS as frontNativeReads } from "../../51dianzi-platform/shared/internalBusinessOfficialInventory";

const method = "channelInventory.newInformationFacts";
const key = "synthetic-manager-new-info-key";
const permissions = { read: true, write: false, note: false, authorizationVersion: "synthetic-new-info-v1" };
const target = { creditCode: "SYNTHETIC", expectedOwnerUserId: 99, staffUserId: 10, adminAccountId: 303, bindingVersion: 4, method, requestId: "synthetic-new-info-request" };
const explicitMappings = [
  ["customer.newInformationFacts", "CUSTOMER_READ"],
  ["enterprise.inquiryNewInformationFacts", "INQUIRY_RECEIVE_READ"],
  ["customerDemand.procurementNewInformationFacts", "PROCUREMENT_DEMAND_READ"],
  ["inbound.newInformationFacts", "INVENTORY_INBOUND_READ"],
  ["crmSalesOrder.newInformationFacts", "SALES_ORDER_READ"],
  ["order.sellerNewInformationFacts", "READ"],
] as const;
const delegation = (): StaffDelegation => ({ kind: "business_bff", adminAccountId: 303, adminActorName: "Synthetic", adminActorRole: "operations", staffUserId: 10, bindingVersion: 4, requestId: target.requestId, enterpriseId: 31 });
afterEach(() => vi.unstubAllEnvs());

function inspectFixedManifest(path: URL) {
  const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const ids: string[] = [], spreads: string[] = [], assignments = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "BUSINESS_METHOD_IDS") {
      const initializer = node.initializer;
      const array = initializer && ts.isAsExpression(initializer) ? initializer.expression : initializer;
      if (!array || !ts.isArrayLiteralExpression(array)) throw new Error("Fixed IDs must remain a literal const array");
      for (const element of array.elements) {
        if (ts.isStringLiteral(element)) ids.push(element.text);
        else if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) spreads.push(element.expression.text);
        else throw new Error("Unexpected dynamic method manifest entry");
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left)
      && ts.isIdentifier(node.left.expression) && node.left.expression.text === "BUSINESS_METHOD_CAPABILITIES"
      && ts.isStringLiteral(node.left.argumentExpression) && ts.isIdentifier(node.right)) {
      assignments.set(node.left.argumentExpression.text, node.right.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { ids, spreads, assignments };
}

describe("new facts method classification is precisely shared, not a copied model/schema overwrite", () => {
  it("both channel lists and policies match, and native facts classification is explicitly closed", () => {
    expect(CHANNEL_INVENTORY_BUSINESS_METHOD_IDS).toEqual(frontIds);
    expect(CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES).toEqual(frontPolicies);
    expect(NATIVE_TEAM_READ_METHODS).toEqual(frontNativeReads);
    expect(CHANNEL_INVENTORY_BUSINESS_METHOD_IDS.filter(id => id === method)).toHaveLength(1);
    expect(CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES["channelInventory.newInformationFacts"]).toEqual({ mode: "read", permission: "inventory.manage" });
    expect(officialInventoryMethodRequirement(method)).toBe("read");
    expect(NATIVE_TEAM_READ_METHODS).toContain(method);
    for (const rejected of ["channelInventory.newInformationFact", "channelInventory.newInformationFacts.extra", "mallInventory.newInformationFacts", "customer.newInformationFacts"]) {
      expect(isChannelInventoryBusinessMethodId(rejected)).toBe(false);
      expect(officialInventoryMethodRequirement(rejected)).toBeNull();
    }
    expect(officialInventoryErpEntitled(method, permissions, "inventory.manage")).toBe(true);
    expect(officialInventoryErpEntitled("channelInventory.listMaterials", permissions, "inventory.manage")).toBe(false);
    expect(officialInventoryErpEntitled(method, permissions, "inventory.publish")).toBe(false);
    expect(officialInventoryErpEntitled(method, { ...permissions, read: false, write: true }, "inventory.manage")).toBe(false);
  });
  it.each([
    ["front", new URL("../../51dianzi-platform/server/services/internalBusinessDelegation.ts", import.meta.url)],
    ["embedded SDK", new URL("../client/src/business/platform/front-router-types/server/services/internalBusinessDelegation.ts", import.meta.url)],
  ] as const)("%s manifest keeps explicit method literals, correct permission constants, and channel spread", (_label, path) => {
    const manifest = inspectFixedManifest(path);
    for (const [id, capability] of explicitMappings) {
      expect(manifest.ids.filter(value => value === id)).toHaveLength(1);
      expect(manifest.assignments.get(id)).toBe(capability);
    }
    expect(manifest.spreads).toContain("CHANNEL_INVENTORY_BUSINESS_METHOD_IDS");
    expect(manifest.ids).not.toContain("mallInventory.newInformationFacts");
  });
  it("manager-only signed write extensions remain intact and do not infer read grants", () => {
    const extended = {
      ...permissions, inventoryScopeWrite: false,
      channelMaterialManagement: { leaderAdminAccountId: 303, recorderBindings: [{ adminAccountId: 303, staffUserId: 10 }] },
      materialBusinessTeamLeaderWrite: { adminAccountId: 303, staffUserId: 10 },
      channelProfileTeamRead: { ownerUserIds: [10], businessTeamLeaderRead: true },
      customerScopeRead: false,
    } satisfies OfficialInventoryPermissions;
    expect(officialInventoryPermissionsSchema.parse(extended)).toEqual(extended);
    expect(officialInventoryPermissionsSchema.safeParse({ ...extended, inventoryScopeWrite: "true" }).success).toBe(false);
    expect(officialInventoryPermissionsSchema.safeParse({ ...extended, actorUserId: 99 }).success).toBe(false);
    // Embedded/native schema remains intentionally narrower; do not blanket-copy it over manager shared schema.
    expect(embeddedGrantSchema.safeParse(signOfficialInventoryGrant(extended, target, key)).success).toBe(false);
    vi.stubEnv("PORTAL_API_KEY", key);
    expect(verifyOfficialInventoryGrant(signOfficialInventoryGrant(extended, target, key), target)).toEqual(extended);
  });
});

describe("manager signer + existing SDK verifier require exact facts method provenance", () => {
  it("real BFF signer round-trips only the exact facts request, without stock-write/note/publish", () => {
    vi.stubEnv("PORTAL_API_KEY", key);
    const verified = verifyOfficialInventoryGrant(signOfficialInventoryGrant(permissions, target, key), target);
    expect(verified).toEqual(permissions);
    const bound = delegation();
    bindOfficialInventoryGrant(bound, verified);
    expect(officialInventoryGrantForRequest(bound, method)).toEqual(permissions);
    expect(officialInventoryGrantForRequest(bound, "channelInventory.listTeamMaterials")).toBeUndefined();
    expect(officialInventoryGrantForRequest({ ...bound }, method)).toBeUndefined();
  });
  it.each(["channelInventory.listTeamMaterials", "channelInventory.listMaterials", "mallInventory.list"])("%s old grant cannot be replayed as new facts, including bound provenance", oldMethod => {
    vi.stubEnv("PORTAL_API_KEY", key);
    const oldTarget = { ...target, method: oldMethod };
    const token = signOfficialInventoryGrant(permissions, oldTarget, key);
    expect(() => verifyOfficialInventoryGrant(token, target)).toThrow();
    expect(() => verifyOfficialInventoryGrant(signOfficialInventoryGrant(permissions, target, key), oldTarget)).toThrow();
    const bound = delegation();
    bindOfficialInventoryGrant(bound, verifyOfficialInventoryGrant(token, oldTarget));
    expect(officialInventoryGrantForRequest(bound, method)).toBeUndefined();
  });
  it("no browser/copied logical grant can manufacture exact request proof", () => {
    const bound = delegation();
    bindOfficialInventoryGrant(bound, permissions);
    expect(officialInventoryGrantForRequest(bound, method)).toBeUndefined();
    vi.stubEnv("PORTAL_API_KEY", key);
    for (const patch of [{ staffUserId: 11 }, { adminAccountId: 304 }, { bindingVersion: 5 }, { requestId: "another" }, { expectedOwnerUserId: 98 }]) {
      expect(() => verifyOfficialInventoryGrant(signOfficialInventoryGrant(permissions, target, key), { ...target, ...patch })).toThrow();
    }
  });
});
