import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  ADMIN_NEW_INFORMATION_ACTIVATED_AT,
  newInformationFactsInputSchema,
  newInformationFactsResultSchema,
  type NewInformationFactsResult,
} from "../../../../51dianzi-platform/shared/adminNewInformationFacts";
import {
  createOfficialMallService,
  type OfficialMallDependencies,
} from "../officialMall";
import type { OfficialActor } from "../officialChannelAccess";

/** Fixed physical official_mall_materials namespace; NOT publicId or inventoryId. */
export const MALL_NEW_INFORMATION_PREFIX = "mall-material:";
export const mallNewInformationFactsInputSchema = newInformationFactsInputSchema;
export const mallNewInformationFactsResultSchema = newInformationFactsResultSchema;
export type MallNewInformationFactsInput = { refs?: string[] };

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function nativeAdminKey(id: number): string | undefined {
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647
    ? `admin:${id}`
    : undefined;
}
function idsFor(refs: string[] | undefined): number[] | undefined {
  if (refs === undefined) return undefined;
  const ids = refs.flatMap(ref => {
    const match = /^mall-material:([1-9]\d*)$/.exec(ref);
    if (!match) return [];
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id <= 2147483647 ? [id] : [];
  });
  return Array.from(new Set(ids));
}

/**
 * Native-only reader: inject the SAME four officialMall service dependencies.
 * The trusted actor must be produced by officialActorFromContext(ctx) at the route.
 * No main-site DB imports, business delegation, client time/actor/team/merchant input.
 */
export function createMallNewInformationReader(deps: OfficialMallDependencies) {
  const service = createOfficialMallService(deps);
  return {
    async read(
      actor: OfficialActor,
      value: MallNewInformationFactsInput = {}
    ): Promise<NewInformationFactsResult> {
      // Parse before DB access. Strict shared schema rejects actor/time/scope injection.
      const input = mallNewInformationFactsInputSchema.parse(value);
      const { access, items: rows } = await service.readNewInformationFacts(
        actor,
        idsFor(input.refs)
      );
      const actorKey = nativeAdminKey(access.adminUserId);
      if (!actorKey || access.adminUserId !== actor.adminUserId)
        throw new TRPCError({ code: "FORBIDDEN", message: "商城后台主体核验失败" });
      const scope = {
        identity: actorKey,
        version: digest([
          "official-mall-materials-scope-v1",
          access.adminUserId,
          actor.sessionVersion,
          access.isSuperAdmin,
          access.teamId,
          access.teamRole,
          [...access.permissions].sort(),
        ]),
        actorKey,
      };
      const items = rows.map(row => {
        // officialMallSchema already maps native Asia/Shanghai TIMESTAMP to Date.
        // Never parse an unzoned raw driver string as UTC, nor use updatedAt/revision.
        if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.id > 2147483647 ||
            !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime()))
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "商城事件元数据无效" });
        const occurredAt = row.createdAt.toISOString();
        const creator = nativeAdminKey(row.createdByAdminUserId);
        return {
          id: `${MALL_NEW_INFORMATION_PREFIX}${row.id}`,
          version: `created:${occurredAt}`,
          occurredAt,
          historical: occurredAt < ADMIN_NEW_INFORMATION_ACTIVATED_AT,
          // insertMaterial sets this column only from the trusted native admin actor.
          // No owner/updater/publication account inference or front-user mapping.
          ...(creator ? { actorKey: creator } : {}),
        };
      });
      // Content-addressed token of this complete RR read; not a wall-clock cursor.
      // Lookup receives its exact SQL scope/ID intersection, never scan+memory filtering.
      return mallNewInformationFactsResultSchema.parse({
        available: true,
        scope,
        items,
        snapshot: digest(["official-mall-materials-facts-v1", scope, items]),
      });
    },
  };
}
