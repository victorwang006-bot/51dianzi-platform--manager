import { readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export type PublicHotSnapshot = {
  version: 1;
  generatedAt: string;
  terms: string[];
  companies: Array<{ supplierId: number; companyName: string }>;
};
export function publicHotSnapshotPath() {
  return process.env.PUBLIC_HOT_SNAPSHOT_PATH || "/opt/shared/dianzi51-platform/public-hot-snapshot.json";
}
export function validPublicHotSnapshot(value: unknown): value is PublicHotSnapshot {
  const x = value as PublicHotSnapshot;
  return !!x && x.version === 1 && Number.isFinite(Date.parse(x.generatedAt))
    && Array.isArray(x.terms) && x.terms.length <= 12
    && x.terms.every(v => typeof v === "string" && v.length > 0 && v.length <= 128)
    && Array.isArray(x.companies) && x.companies.length <= 12
    && x.companies.every(v => Number.isInteger(v.supplierId) && v.supplierId > 0
      && typeof v.companyName === "string" && v.companyName.length > 0 && v.companyName.length <= 256);
}
export function readPublicHotSnapshot(): PublicHotSnapshot | null {
  try {
    const raw = readFileSync(publicHotSnapshotPath(), "utf8");
    if (Buffer.byteLength(raw) > 16_384) return null;
    const value = JSON.parse(raw);
    // A failed scheduled refresh may retain the last successful safe public projection.
    return validPublicHotSnapshot(value) ? { version: 1, generatedAt: value.generatedAt, terms: value.terms, companies: value.companies.map(x => ({ supplierId: x.supplierId, companyName: x.companyName })) } : null;
  } catch { return null; }
}
export function writePublicHotSnapshot(value: PublicHotSnapshot) {
  if (!validPublicHotSnapshot(value)) throw new Error("Invalid public hot snapshot");
  const path = publicHotSnapshotPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  const temp = `${path}.${process.pid}.next`;
  // Persist only public model strings and public company IDs/names, never totals or user IDs.
  const projection: PublicHotSnapshot = { version: 1, generatedAt: value.generatedAt, terms: value.terms.slice(), companies: value.companies.map(x => ({ supplierId: x.supplierId, companyName: x.companyName })) };
  writeFileSync(temp, JSON.stringify(projection) + "\n", { mode: 0o644 });
  renameSync(temp, path);
}
