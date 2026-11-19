import { isIP } from "node:net";
import { containsCompetitorDisplayName, sanitizeCompetitorDisplayText } from "../../shared/competitorDisplayPolicy";
import type { OfficialMaterialDictionary } from "./officialTechnicalTypes";
import type { OfficialMaterialResource } from "./officialTechnicalTypes";

const normalized = (value: string) => value.normalize("NFKC").trim().toUpperCase();
/** Same reviewed manufacturer families as the existing image/market policies, not their
 * image-only matcher. No brand substring, empty-brand wildcard or model suffix stripping. */
const families = [
  ["ST", "STM", "STMICROELECTRONICS", "意法", "意法半导体"],
  ["TI", "TEXAS INSTRUMENTS", "德州仪器"],
  ["DIODES", "DIODES INCORPORATED", "美台"],
  ["NXP", "恩智浦"],
  ["SEMTECH", "SEMTECH ELECTRONICS LTD.", "先科"],
] as const;
function brandKey(value: string): string | null {
  const text = normalized(value).replace(/\s+/g, " ");
  if (!text || text.length > 128 || /[\u0000-\u001f\u007f·•]/.test(text)) return null;
  const direct = families.findIndex(group => (group as readonly string[]).includes(text));
  if (direct >= 0) return `family:${direct}`;
  if (!/[\/()+（）]/.test(text)) return `literal:${text}`;
  // Every component must be an explicit alias of one manufacturer. ST(先科) is not ST.
  if (!/^[^/()+（）]+(?:[/+][^/()+（）]+|[（(][^/()+（）]+(?:[/+][^/()+（）]+)*[)）])*$/.test(text)) return null;
  const parts = text.split(/[\/()+（）]/).map(s => s.trim()).filter(Boolean);
  const indices = parts.map(part => families.findIndex(group => (group as readonly string[]).includes(part)));
  return indices.length && indices[0] >= 0 && indices.every(index => index === indices[0]) ? `family:${indices[0]}` : null;
}
export function officialMaterialBrandMatches(a: string, b: string): boolean {
  const left = brandKey(a); return left !== null && left === brandKey(b);
}
/** Only a family+pin base and one numeric WxH dimension annotation are understood.
 * Unknown suffixes/annotations retain the original strict equality behavior. */
export function officialMaterialPackageMatches(a: string, b: string): boolean {
  const strict = (value: string) => normalized(value).replace(/[\s_-]/g, "");
  if (strict(a) === strict(b)) return true;
  const parse = (value: string) => {
    const match = /^([A-Z]+)[-_]?([1-9]\d*)(?:\((\d+(?:\.\d+)?)[X×](\d+(?:\.\d+)?)(?:MM)?\))?$/.exec(normalized(value).replace(/\s/g, ""));
    return match ? { base: `${match[1]}${match[2]}`, dimensions: match[3] ? `${match[3]}X${match[4]}` : null } : null;
  };
  const left = parse(a); const right = parse(b);
  return !!left && !!right && left.base === right.base
    && (left.dimensions === null || right.dimensions === null || left.dimensions === right.dimensions);
}
export function officialMaterialSafeText(value: unknown, max = 4096): string | null {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  // Whole-value rejection, not an HTML interpreter; retain technical <1uA / >=2V.
  if (/<\s*\/?\s*[a-z][^<>]*>|<!--|<!doctype\b|<\?/i.test(value)) return null;
  // Technical strings are not a second URL channel. URLs belong only in the reviewed
  // datasheet field; reject embedded/encoded network addresses rather than leaking them.
  let decoded = value;
  for (let i = 0; i < 8; i++) {
    if (/(?:[a-z][a-z\d+.-]*:\/\/|\/\/[a-z\d\[]|\\\\)/i.test(decoded)) return null;
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
  }
  return sanitizeCompetitorDisplayText(value) || null;
}
/** Validate the supplied REAL URL only; never construct a datasheet path or fetch a PDF. */
export function officialMaterialDatasheetUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    // Check supplied and decoded bytes only; never rewrite a genuine supplier URL.
    let decoded = value;
    for (;;) {
      if (/[<>]/.test(decoded)) return null;
      let next: string;
      try { next = decodeURIComponent(decoded); } catch { break; }
      if (next === decoded) break;
      decoded = next;
    }
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host.includes(".") || host.includes(":") || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)) return null;
    if (isIP(host)) {
      if (isIP(host) !== 4) return null;
      const [a, b] = host.split(".").map(Number);
      if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0 || a >= 224) return null;
    }
    const path = decodeURIComponent(url.pathname);
    if (/(?:^|\/)(?:private|internal|supplier[-_]?photos?)(?:\/|$)/i.test(path)) return null;
    if (Array.from(url.searchParams.keys()).some(key => /token|secret|signature|credential|password|authorization|api[-_]?key/i.test(key))) return null;
    return value;
  } catch { return null; }
}
export function projectOfficialMaterialResource(identity: Pick<OfficialMaterialResource, "publicId" | "revision" | "partNumber" | "brand" | "pkg">, dictionary: OfficialMaterialDictionary | undefined, parameterLimit = 100): OfficialMaterialResource {
  const empty: OfficialMaterialResource = { ...identity, category: null, description: null, parameters: [], datasheetUrl: null };
  if (!dictionary || normalized(dictionary.partNumber) !== normalized(identity.partNumber)
    || !officialMaterialBrandMatches(identity.brand, dictionary.brand)) return empty;
  if (identity.pkg.trim() && dictionary.package.trim() && !officialMaterialPackageMatches(identity.pkg, dictionary.package)) return empty;
  if ([dictionary.name, dictionary.brand, dictionary.category, dictionary.description].some(containsCompetitorDisplayName)) return empty;
  const parameters = Object.entries(dictionary.specs ?? {}).slice(0, Math.min(1000, Math.max(0, Math.floor(parameterLimit)))).flatMap(([key, value]) => {
    const name = officialMaterialSafeText(key, 128); const text = officialMaterialSafeText(value, 2048);
    return name && text ? [{ name, value: text }] : [];
  });
  return { ...empty, category: officialMaterialSafeText(dictionary.category, 256), description: officialMaterialSafeText(dictionary.description), parameters, datasheetUrl: officialMaterialDatasheetUrl(dictionary.datasheetUrl) };
}
