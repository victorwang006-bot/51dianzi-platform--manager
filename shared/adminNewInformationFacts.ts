import { z } from "zod";

/** Approved feature activation: stored creation/assignment time, not commit time. */
export const ADMIN_NEW_INFORMATION_ACTIVATED_AT = "2026-11-17T00:43:47.000Z";
export const ADMIN_NEW_INFORMATION_GENERATION = "20261117-new-info-v1";
export const newInformationFactsInputSchema = z.object({
  refs: z.array(z.string().min(1).max(180)).max(100).optional(),
}).strict();
export type NewInformationFact = {
  /** Fixed physical source namespace plus actual globally unique primary key. */
  id: string;
  version: string;
  occurredAt: string;
  historical: boolean;
  actorKey?: string | null;
  countKey?: string;
  children?: string[];
};
export type NewInformationFactsResult = {
  available: true;
  scope: { identity: string; version: string; actorKey?: string | null };
  items: NewInformationFact[];
  /** All facts in one authority-fenced consistent database read. */
  snapshot: string;
};
export const newInformationFactsResultSchema = z.object({
  available: z.literal(true),
  scope: z.object({ identity: z.string().min(1).max(180), version: z.string().min(1).max(180), actorKey: z.string().max(180).nullable().optional() }).strict(),
  items: z.array(z.object({ id: z.string().min(1).max(180), version: z.string().min(1).max(180), occurredAt: z.string().min(1).max(64), historical: z.boolean(), actorKey: z.string().max(180).nullable().optional(), countKey: z.string().max(180).optional(), children: z.array(z.string().max(180)).optional() }).strict()),
  snapshot: z.string().min(1).max(180),
}).strict();
