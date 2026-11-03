import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { canonicalOfficialInventoryJson, signedOfficialInventoryGrantSchema, type OfficialInventoryPermissions, type SignedOfficialInventoryGrant } from "../../../shared/internalBusinessOfficialInventory";
import type { StaffDelegation } from "../_core/context";

const verified = new WeakMap<StaffDelegation, OfficialInventoryPermissions>();
export function bindOfficialInventoryGrant(delegation: StaffDelegation, grant: OfficialInventoryPermissions) { verified.set(delegation, grant); }
export function officialInventoryGrantForDelegation(delegation?: StaffDelegation) { return delegation ? verified.get(delegation) : undefined; }
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
  return grant.permissions;
}
