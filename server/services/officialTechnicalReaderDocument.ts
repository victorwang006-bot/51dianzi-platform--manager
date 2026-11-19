import { z } from "zod";
import type { BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";
import { OFFICIAL_TECHNICAL_PROJECTION_VERSION, officialTechnicalIdentitySchema, officialTechnicalResponseSchema } from "./officialTechnicalResource";

export const MAX_TECHNICAL_STORE_BYTES = 32 * 1024 * 1024;
const hex = z.string().regex(/^[0-9a-f]{64}$/);
export const technicalEntrySchema = z.object({
  identity: officialTechnicalIdentitySchema, sourceKey: hex, sourceVersion: hex,
  projectionVersion: z.literal(OFFICIAL_TECHNICAL_PROJECTION_VERSION), preparedAt: z.iso.datetime(),
  technicalResource: officialTechnicalResponseSchema,
}).strict();
const sourceSchema = z.object({
  ticket: z.string().uuid(), version: hex.nullable(),
  pendingWriterTickets: z.array(z.string().uuid()).max(50000).default([]),
}).strict().refine(source => new Set(source.pendingWriterTickets).size === source.pendingWriterTickets.length
  && (!source.pendingWriterTickets.length || source.version === null));
export const technicalDocumentSchema = z.object({
  schemaVersion: z.literal(1), generation: z.number().int().nonnegative(),
  sources: z.record(hex, sourceSchema), entries: z.array(technicalEntrySchema).max(50000),
}).strict();
export type TechnicalDocument = z.infer<typeof technicalDocumentSchema>;
/** Nanosecond and inode checks detect atomic replacement, same-size overwrites and restored mtime. */
export function technicalFileVersion(stat: BigIntStats): string {
  if (!stat.isFile() || stat.size > BigInt(MAX_TECHNICAL_STORE_BYTES)) throw Error("Invalid technical store");
  return [stat.dev, stat.ino, stat.mtimeNs, stat.ctimeNs, stat.size].join(":");
}
export async function technicalPathVersion(path: string): Promise<string> {
  // lstat rejects symlinks, including after a previously valid cached read.
  return technicalFileVersion(await lstat(path, { bigint: true }));
}
