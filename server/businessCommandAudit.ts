export type BusinessCommandResourceCorrelation = Readonly<{
  schemaVersion: 1;
  actionRequestId: string | null;
  resourceType: "channel" | "channel_material" | "channel_note";
  resourceId: number;
}>;

/** Narrow server result/request correlation, not evidence of original creation.
 * Front's transaction-local immutable event is the only creator authority.
 */
export function validateBusinessCommandResourceCorrelation(value: unknown): BusinessCommandResourceCorrelation {
  const fail = (): never => { throw new Error("BUSINESS_COMMAND_RESOURCE_CORRELATION_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "actionRequestId,resourceId,resourceType,schemaVersion"
    || input.schemaVersion !== 1
    || !["channel", "channel_material", "channel_note"].includes(input.resourceType as string)
    || typeof input.resourceId !== "number" || !Number.isSafeInteger(input.resourceId) || input.resourceId <= 0
    || !(input.actionRequestId === null || (typeof input.actionRequestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input.actionRequestId)))) return fail();
  return {
    schemaVersion: 1,
    resourceType: input.resourceType as BusinessCommandResourceCorrelation["resourceType"],
    resourceId: input.resourceId,
    actionRequestId: input.actionRequestId as string | null,
  };
}
