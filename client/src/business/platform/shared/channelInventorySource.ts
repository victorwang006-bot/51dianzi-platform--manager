import { z } from "zod";
import { channelCollaborationExpectedContext } from "./channelInventoryCollaboration";

/** Expected context is a stale-session assertion, never an authorization grant. */
export const teamMaterialSourceSchema = z.object({
  materialId: z.number().int().safe().positive(),
  ...channelCollaborationExpectedContext,
}).strict();
export type TeamMaterialSourceInput = z.input<typeof teamMaterialSourceSchema>;
/** No channel identifier/contact/private note is needed by the source-name dialog. */
export type TeamMaterialSource = { name: string };
