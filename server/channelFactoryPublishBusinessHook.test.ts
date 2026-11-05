import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { publishFactoryMaterialInputSchema, publishFactoryMaterialResultSchema } from "../client/src/business/platform/shared/channelFactoryPublication";
import { CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES, isChannelInventoryBusinessMethodId } from "../client/src/business/platform/shared/channelInventoryBusinessPolicy";
import { canonicalOfficialInventoryJson, officialInventoryMethodRequirement, signedOfficialInventoryGrantSchema } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
import { signOfficialInventoryGrant } from "./platformBusinessApi";

const input = { materialId: 17, expectedRevision: 2, requestId: "81123456-1234-4234-9234-123456789abc", expectedEnterpriseId: 6, expectedActorUserId: 9 };
const source = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("factory publish strict BFF contract", () => {
  it("accepts only record/version/nonce and expected context assertions", () => {
    expect(publishFactoryMaterialInputSchema.parse(input)).toEqual(input);
    const { expectedEnterpriseId, expectedActorUserId, ...minimal } = input;
    expect(publishFactoryMaterialInputSchema.parse(minimal)).toEqual(minimal);
  });
  for (const key of ["actorUserId", "publisherUserId", "publisherAdminUserId", "merchantId", "snapshot", "source", "phone", "note", "permissions", "officialInventoryPermissions", "method", "price", "qty"]) {
    it(`rejects caller-selected ${key}`, () => {
      expect(publishFactoryMaterialInputSchema.safeParse({ ...input, [key]: "untrusted" }).success).toBe(false);
    });
  }
  it("requires positive safe IDs/revisions and a UUID; no batch fallback", () => {
    for (const invalid of [{ materialId: 0 }, { materialId: -1 }, { materialId: 1.5 }, { materialId: Number.MAX_SAFE_INTEGER + 1 }, { expectedRevision: 0 }, { requestId: "" }, { requestId: "arbitrary" }, { expectedEnterpriseId: 0 }, { expectedActorUserId: -1 }]) {
      expect(publishFactoryMaterialInputSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
    }
  });
  it("is an explicit closed write method requiring publish, not read/write/note", () => {
    expect(isChannelInventoryBusinessMethodId("channelInventory.publishFactoryMaterial")).toBe(true);
    expect(CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES["channelInventory.publishFactoryMaterial"].mode).toBe("write");
    expect(officialInventoryMethodRequirement("channelInventory.publishFactoryMaterial")).toBe("publish");
    expect(officialInventoryMethodRequirement("channelInventory.publishAllFactoryMaterials")).toBeNull();
  });
  it("binds the real router to the strict input and unchanged scope fence", () => {
    const text = source("./businessRouter.ts");
    expect(text).toContain('if (method === "channelInventory.publishFactoryMaterial") return publishFactoryMaterialInputSchema;');
    expect(text).toContain('publishFactoryMaterial: businessMutation("channelInventory.publishFactoryMaterial", "inventory")');
    expect(text).toContain('const publishing = capability.method === "channelInventory.publishFactoryMaterial";');
    expect(text).toContain('const requirement = publishing ? "publish"');
    expect(text).toContain('publish: officialInventoryPermissions.publish === true && businessScopeAllows(scope, "inventory", "write")');
    expect(text).toContain("return db.withBusinessAuthorizationFence");
    expect(text).toContain("const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);");
  });
  it("native publication authorization is checked independently and participates in version digest", () => {
    const text = source("./businessAccess.ts");
    expect(text).toContain('publish: has("officialInventory.publish")');
    expect(text).toContain('if (!account || account.status !== "active")');
    expect(text).toContain("sessionVersion: account.sessionVersion, ...grant");
  });
  it("result cannot leak private source, account, contact or notes", () => {
    const result = { materialId: 17, publicId: `ocp_${"a".repeat(32)}`, status: "published", revision: 2 };
    expect(publishFactoryMaterialResultSchema.parse(result)).toEqual(result);
    for (const key of ["source", "phone", "publisherUserId", "notes"]) expect(publishFactoryMaterialResultSchema.safeParse({ ...result, [key]: "private" }).success).toBe(false);
  });
});

describe("optional publish proof stays compatible without granting old payloads", () => {
  const key = "isolated-test-hmac-key-not-production";
  const target = { staffUserId: 9, enterpriseId: 6, adminAccountId: 4, bindingVersion: 2 };
  const old = { read: true, write: true, note: false, authorizationVersion: "fixture-authorization-v1" };
  const verify = (signed: ReturnType<typeof signOfficialInventoryGrant>) => {
    const { signature, ...grant } = signedOfficialInventoryGrantSchema.parse(signed);
    return createHmac("sha256", key).update(canonicalOfficialInventoryJson({ grant, target })).digest("hex") === signature;
  };
  it("old signed read/write proofs parse byte-equivalently; publish is absent", () => {
    const signed = signOfficialInventoryGrant(old, target, key, 1000);
    const parsed = signedOfficialInventoryGrantSchema.parse(signed);
    expect(parsed.permissions).toEqual(old);
    expect(Object.hasOwn(parsed.permissions, "publish")).toBe(false);
    expect(verify(signed)).toBe(true);
    expect(parsed.permissions.publish === true).toBe(false);
  });
  it("new publish proof is signed and cannot be inserted or changed by a caller", () => {
    const signed = signOfficialInventoryGrant({ ...old, publish: true }, target, key, 1000);
    expect(verify(signed)).toBe(true);
    expect(verify({ ...signed, permissions: { ...signed.permissions, publish: false } })).toBe(false);
    const prior = signOfficialInventoryGrant(old, target, key, 1000);
    expect(verify({ ...prior, permissions: { ...prior.permissions, publish: true } })).toBe(false);
  });
});
