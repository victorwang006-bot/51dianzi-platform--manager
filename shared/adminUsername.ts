/**
 * Canonical representation for local administrator account names.
 *
 * The display/login spelling is trimmed but otherwise preserved in `username`; the
 * canonical form is stored separately and used for uniqueness and lookup.  This
 * makes leading/trailing whitespace impossible to turn into an unreachable,
 * visually duplicate account while retaining existing case-insensitive login
 * behaviour explicitly rather than relying on a database collation.
 */
export function normalizeAdminUsername(value: string): string {
  return value.trim();
}

export function canonicalAdminUsername(value: string): string {
  return normalizeAdminUsername(value).toLocaleLowerCase("en-US");
}

export function isNormalizedAdminUsername(value: string): boolean {
  return value === normalizeAdminUsername(value);
}
