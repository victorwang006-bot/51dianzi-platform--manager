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

export type BusinessWorkbenchCapability = (typeof BUSINESS_WORKBENCH_CAPABILITIES)[number];
export type BusinessWorkbenchModule = "context" | "inventory" | "customers" | "procurement" | "users" | "orders";

type ScopeLike = { modulePermissions: readonly string[] };
import type { OfficialInventoryPermissions } from "./platformBusinessApi";

type CapabilityProjectionRule = {
  capability: BusinessWorkbenchCapability;
  readModule: BusinessWorkbenchModule;
  /** A capability with this flag is not safe to display under read scope alone. */
  displayRequiresWrite?: boolean;
  /** Writes remain a separate outer-scope gate even when the front capability is present. */
  writeModule?: BusinessWorkbenchModule;
};

/**
 * This is deliberately a capability-to-BFF-method projection, not a new ERP
 * permission map. The front service remains the source of each fine-grained
 * permission and record/owner/seller check.
 */
const CAPABILITY_RULES: readonly CapabilityProjectionRule[] = [
  { capability: "company.read", readModule: "context" },
  { capability: "inventory.read", readModule: "inventory", writeModule: "inventory" },
  { capability: "inventory.channel", readModule: "inventory", writeModule: "inventory" },
  // Publishing itself is never exposed by a read-only inventory scope.
  { capability: "inventory.publish", readModule: "inventory", displayRequiresWrite: true, writeModule: "inventory" },
  { capability: "inventory.inbound", readModule: "inventory", writeModule: "inventory" },
  { capability: "customers.manage", readModule: "customers", writeModule: "customers" },
  // CRM sales orders map to orders scope only; this does not synthesize any
  // front sales/business-orders permission.
  { capability: "crm.sales_orders", readModule: "orders", writeModule: "orders" },
  { capability: "procurement.demands", readModule: "procurement", writeModule: "procurement" },
  { capability: "procurement.orders", readModule: "procurement", writeModule: "procurement" },
  // Reception remains constrained by the front's fixed inquiry policy.
  { capability: "inquiry.receive", readModule: "inventory", writeModule: "inventory" },
  // Member visibility and mutation have independent users read/write gates.
  { capability: "enterprise.members.manage", readModule: "users", writeModule: "users" },
  // Marketplace mutations still require the original front sellerId record gate.
  { capability: "marketplace.seller", readModule: "orders", writeModule: "orders" },
];

function scopeAllows(scope: ScopeLike, module: BusinessWorkbenchModule, mode: "read" | "write") {
  return scope.modulePermissions.includes(`business.${module}.${mode}`);
}

export type BusinessWorkbenchProjection = Readonly<{
  /** Safe-to-render front capability intersection for this exact merchant. */
  workbenchCapabilities: readonly BusinessWorkbenchCapability[];
  /** Capability names that additionally have this exact merchant's BFF write mode. */
  writeCapabilities: readonly BusinessWorkbenchCapability[];
  /** Stable module-mode data for route guards and merchant selection UI. */
  moduleAvailability: Readonly<Record<BusinessWorkbenchModule, Readonly<{ read: boolean; write: boolean }>>>;
  /** True only when a current front capability and an exact BFF write mode intersect. */
  canWrite: boolean;
  officialInventoryPermissions?: OfficialInventoryPermissions;
}>;

function moduleAvailability(scope: ScopeLike): BusinessWorkbenchProjection["moduleAvailability"] {
  const modules: BusinessWorkbenchModule[] = ["context", "inventory", "customers", "procurement", "users", "orders"];
  return Object.fromEntries(modules.map(module => [module, {
    read: scopeAllows(scope, module, "read"),
    write: scopeAllows(scope, module, "write"),
  }])) as BusinessWorkbenchProjection["moduleAvailability"];
}

/**
 * Intersects current portal-derived capabilities with exactly one active scope.
 * Unknown/duplicated portal strings are ignored and thus fail closed.
 */
export function projectBusinessWorkbenchCapabilities(input: {
  scope: ScopeLike;
  frontWorkbenchCapabilities: readonly string[];
  officialInventoryPermissions?: OfficialInventoryPermissions;
}): BusinessWorkbenchProjection {
  const front = new Set(input.frontWorkbenchCapabilities);
  const readable: BusinessWorkbenchCapability[] = [];
  const writable: BusinessWorkbenchCapability[] = [];

  for (const rule of CAPABILITY_RULES) {
    if (rule.capability === "inventory.channel" && input.officialInventoryPermissions) {
      const native = input.officialInventoryPermissions;
      if (native.read) readable.push(rule.capability);
      if (native.read && native.write && front.has(rule.capability) && scopeAllows(input.scope, "inventory", "write")) writable.push(rule.capability);
      continue;
    }
    if (!front.has(rule.capability)) continue;
    const visible = rule.displayRequiresWrite
      ? scopeAllows(input.scope, rule.readModule, "write")
      : scopeAllows(input.scope, rule.readModule, "read");
    if (!visible) continue;
    readable.push(rule.capability);
    if (rule.writeModule && scopeAllows(input.scope, rule.writeModule, "write")) {
      writable.push(rule.capability);
    }
  }

  return {
    workbenchCapabilities: readable,
    writeCapabilities: writable,
    moduleAvailability: moduleAvailability(input.scope),
    canWrite: writable.length > 0,
    officialInventoryPermissions: input.officialInventoryPermissions ? { ...input.officialInventoryPermissions,
      write: input.officialInventoryPermissions.read && input.officialInventoryPermissions.write && scopeAllows(input.scope, "inventory", "write"),
      note: input.officialInventoryPermissions.read && input.officialInventoryPermissions.note } : undefined,
  };
}

/** Full chat stays false; reception must be true both upstream and in the scope projection. */
export function projectBusinessSessionCapabilities(input: {
  frontReceptionReady: unknown;
  projection: BusinessWorkbenchProjection;
}) {
  return {
    chat: false as const,
    receptionReady: input.frontReceptionReady === true
      && input.projection.workbenchCapabilities.includes("inquiry.receive"),
  };
}

export const businessWorkbenchProjectionTestUtils = {
  CAPABILITY_RULES,
};
