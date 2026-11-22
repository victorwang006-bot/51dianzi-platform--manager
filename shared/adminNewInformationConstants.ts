/** Browser-safe notification constants. No schema or runtime library dependency. */
export const ADMIN_NEW_INFORMATION_MODULES = [
  "customers", "inventory", "mall", "reception", "procurement", "inbound", "sales",
] as const;
export const ADMIN_NEW_INFORMATION_REFRESH_MS = 15_000;
