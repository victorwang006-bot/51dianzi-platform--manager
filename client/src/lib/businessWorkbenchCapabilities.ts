/**
 * Display-only capabilities returned by business.navigation. They are derived
 * from the current bound portal staff principal, never from adminPermissions.
 * The BFF and original portal route remain the authorization authorities.
 */
export const BUSINESS_WORKBENCH_CAPABILITIES = [
  "inventory.read",
  "inventory.publish",
  "inventory.inbound",
  "inventory.channel",
  "customers.manage",
  "crm.sales_orders",
  "procurement.demands",
  "procurement.orders",
  "inquiry.receive",
  "enterprise.members.manage",
  "company.read",
  "marketplace.seller",
] as const;

export type BusinessWorkbenchCapability =
  (typeof BUSINESS_WORKBENCH_CAPABILITIES)[number];

export function hasBusinessWorkbenchCapability(
  capabilities: readonly string[] | null | undefined,
  required: BusinessWorkbenchCapability,
): boolean {
  return capabilities?.includes(required) ?? false;
}
