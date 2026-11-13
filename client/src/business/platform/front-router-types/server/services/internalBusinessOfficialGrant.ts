import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { canonicalOfficialInventoryJson, signedOfficialInventoryGrantSchema, officialInventoryMethodRequirement, NATIVE_TEAM_READ_METHODS, type OfficialInventoryPermissions, type SignedOfficialInventoryGrant } from "../../../shared/internalBusinessOfficialInventory";
import { CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES, isChannelInventoryBusinessMethodId } from "../../../shared/channelInventoryBusinessPolicy";
import type { StaffDelegation } from "../_core/context";

const verified = new WeakMap<StaffDelegation, OfficialInventoryPermissions>();
// Server-local provenance; no new browser, delegation or signed-contract field.
const signedTargets = new WeakMap<OfficialInventoryPermissions, { target: OfficialInventoryGrantTarget; expiresAt: number }>();
const boundTargets = new WeakMap<StaffDelegation, { target: OfficialInventoryGrantTarget; expiresAt: number }>();
export function bindOfficialInventoryGrant(delegation: StaffDelegation, grant: OfficialInventoryPermissions) {
  verified.set(delegation, grant);
  boundTargets.delete(delegation);
  const proof = signedTargets.get(grant);
  if (proof && proof.target.staffUserId === delegation.staffUserId && proof.target.adminAccountId === delegation.adminAccountId
    && proof.target.bindingVersion === delegation.bindingVersion && proof.target.requestId === delegation.requestId) boundTargets.set(delegation, proof);
}
export function officialInventoryGrantForDelegation(delegation?: StaffDelegation) { return delegation ? verified.get(delegation) : undefined; }
/** Only the exact current signed action can replace its corresponding ERP gate. */
export function officialInventoryGrantForRequest(delegation: StaffDelegation | undefined, method: string) {
  if (!delegation) return undefined;
  const proof = boundTargets.get(delegation), grant = verified.get(delegation);
  const requirement = officialInventoryMethodRequirement(method);
  if (!proof || !grant || !requirement || proof.expiresAt <= Date.now() || proof.target.method !== method
    || proof.target.staffUserId !== delegation.staffUserId || proof.target.adminAccountId !== delegation.adminAccountId
    || proof.target.bindingVersion !== delegation.bindingVersion || proof.target.requestId !== delegation.requestId
    || grant.read !== true || grant[requirement] !== true) return undefined;
  return grant;
}
/** Management SELECT/export is not an ordinary read grant. Existing profile/team
 * read and note/publish mappings retain their independent fixed action flags.
 * False denies an official request; it must never trigger native ERP fallback. */
export function officialInventoryErpEntitled(method: string, grant: OfficialInventoryPermissions | undefined, permission: unknown): boolean {
  if (!grant || !isChannelInventoryBusinessMethodId(method) || CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES[method].permission !== permission) return false;
  const action = officialInventoryMethodRequirement(method);
  if (!action || grant.read !== true || grant[action] !== true) return false;
  if (permission === "inventory.publish") return action === "publish" && grant.publish === true;
  if (permission !== "inventory.manage") return false;
  return NATIVE_TEAM_READ_METHODS.includes(method) || action === "note" || grant.write === true;
}
export type OfficialInventoryGrantTarget = {
  creditCode?: string; registrationIdentifier?: string; expectedOwnerUserId: number;
  staffUserId: number; adminAccountId: number; bindingVersion: number; method: string; requestId: string;
};
export function verifyOfficialInventoryGrant(token: SignedOfficialInventoryGrant | undefined, target: OfficialInventoryGrantTarget): OfficialInventoryPermissions {
  const parsed = signedOfficialInventoryGrantSchema.safeParse(token);
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!parsed.success || !key) throw new TRPCError({ code: "FORBIDDEN", message: "渠道库存受信授权无效" });
  const { signature, ...grant } = parsed.data;
  const now = Date.now();
  if (grant.expiresAt <= now || grant.issuedAt > now + 1000 || grant.expiresAt - grant.issuedAt !== 30_000) {
    throw new TRPCError({ code: "FORBIDDEN", message: "渠道库存受信授权已过期" });
  }
  const expected = createHmac("sha256", key).update(canonicalOfficialInventoryJson({ grant, target })).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new TRPCError({ code: "FORBIDDEN", message: "渠道库存受信授权无效" });
  if (grant.permissions.channelProfileTeamRead) {
    Object.freeze(grant.permissions.channelProfileTeamRead.ownerUserIds);
    Object.freeze(grant.permissions.channelProfileTeamRead);
  }
  Object.freeze(grant.permissions);
  signedTargets.set(grant.permissions, { target: { ...target }, expiresAt: grant.expiresAt });
  return grant.permissions;
}
