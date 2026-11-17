import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ChannelReferenceSource } from "../../shared/channelReference";

const IDENTITY_BINDINGS_FILE = new URL("./channel-reference-identity-bindings.json", import.meta.url);
const MAX_BYTES = 512 * 1024;
const MAX_BINDINGS = 500;
const SOURCES: readonly ChannelReferenceSource[] = ["lcsc", "ickey"];
type Identity = { partNumber: string; brand: string };
export type ChannelReferenceIdentityBinding = {
  raw: Identity;
  canonical: Identity;
  sources: ChannelReferenceSource[];
  confirmation: {
    reviewVersion: string;
    manufacturerSpecificCompleteMpn: true;
    uniqueManufacturer: true;
    additionalSpecificationsMatch: true;
    basis: string;
  };
};
export type ChannelReferenceIdentityBindingsDocument = {
  schemaVersion: 1;
  /** SHA-256 of the exact complete snapshot bytes, including quote/evidence for both sources. */
  snapshotSha256: string;
  bindings: ChannelReferenceIdentityBinding[];
};
export class ChannelReferenceIdentityBindingsUnavailableError extends Error {
  constructor() { super("Channel reference identity bindings unavailable"); this.name = "ChannelReferenceIdentityBindingsUnavailableError"; }
}
export const channelReferenceIdentityKey = (partNumber: string, brand: string) => JSON.stringify([partNumber, brand]);
function keys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k));
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max
    && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(value);
}
function identity(value: unknown): value is Identity {
  return keys(value, ["partNumber", "brand"]) && text(value.partNumber, 128) && text(value.brand, 64);
}
// JSON.parse otherwise silently discards duplicate member names. JSON syntax is
// validated first; tokens keep braces/colons inside strings out of the traversal.
export function uniqueJsonMembers(json: string) {
  const tokens = json.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g) ?? [];
  const stack: Array<Set<string> | null> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (tokens[i + 1] === ":") {
      const names = stack.at(-1), name = JSON.parse(token) as string;
      if (!names || names.has(name)) throw new ChannelReferenceIdentityBindingsUnavailableError();
      names.add(name);
    }
  }
}

/** Pure strict validation; no identity inference, prefix matching, aliases or IO.
 * Audit confirmations are supplied by the finite reviewed input, never fabricated
 * at runtime. The exact canonical row still needs the original snapshot validator. */
export function parseChannelReferenceIdentityBindings(content: string | Uint8Array, snapshotSha256: string): Map<string, ChannelReferenceIdentityBinding> {
  try {
    if (typeof content !== "string" && !(content instanceof Uint8Array)) throw new Error("Invalid bytes");
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error("Invalid size");
    const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const doc: unknown = JSON.parse(json);
    uniqueJsonMembers(json);
    if (!keys(doc, ["schemaVersion", "snapshotSha256", "bindings"]) || doc.schemaVersion !== 1
      || typeof doc.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(doc.snapshotSha256)
      || doc.snapshotSha256 !== snapshotSha256 || !Array.isArray(doc.bindings) || doc.bindings.length > MAX_BINDINGS) throw new Error("Invalid document");
    const bindings = new Map<string, ChannelReferenceIdentityBinding>();
    for (const binding of doc.bindings) {
      if (!keys(binding, ["raw", "canonical", "sources", "confirmation"]) || !identity(binding.raw) || !identity(binding.canonical)
        // Literal complete MPN only: no whitespace, wildcard or regex notation.
        || !/^[A-Za-z0-9][A-Za-z0-9._+#/\-]*$/.test(binding.canonical.partNumber)
        || binding.canonical.brand !== binding.canonical.brand.trim() || /[*?\\]/.test(binding.canonical.brand)
        || !Array.isArray(binding.sources) || !binding.sources.length || binding.sources.length > SOURCES.length
        || new Set(binding.sources).size !== binding.sources.length || binding.sources.some(s => !SOURCES.includes(s))
        || !keys(binding.confirmation, ["reviewVersion", "manufacturerSpecificCompleteMpn", "uniqueManufacturer", "additionalSpecificationsMatch", "basis"])
        || !text(binding.confirmation.reviewVersion, 64) || !text(binding.confirmation.basis, 2048)
        || binding.confirmation.manufacturerSpecificCompleteMpn !== true || binding.confirmation.uniqueManufacturer !== true
        || binding.confirmation.additionalSpecificationsMatch !== true) throw new Error("Invalid binding");
      const key = channelReferenceIdentityKey(binding.raw.partNumber, binding.raw.brand);
      if (bindings.has(key) || key === channelReferenceIdentityKey(binding.canonical.partNumber, binding.canonical.brand)) throw new Error("Duplicate or self binding");
      bindings.set(key, binding as unknown as ChannelReferenceIdentityBinding);
    }
    return bindings;
  } catch { throw new ChannelReferenceIdentityBindingsUnavailableError(); }
}

/** Production has no path/URL argument or environment override. No import-time
 * IO, watcher, write or last-known-good cache. Only true ENOENT means absent. */
export async function readFixedChannelReferenceIdentityBindings(): Promise<Uint8Array | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(IDENTITY_BINDINGS_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw new ChannelReferenceIdentityBindingsUnavailableError();
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw new ChannelReferenceIdentityBindingsUnavailableError();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (!length || length > MAX_BYTES) throw new ChannelReferenceIdentityBindingsUnavailableError();
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
