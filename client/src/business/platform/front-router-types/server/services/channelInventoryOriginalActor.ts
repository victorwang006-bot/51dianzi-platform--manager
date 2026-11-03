import { sql, type SQL } from "drizzle-orm";
import type { ChannelInventoryScope } from "./channelInventory";
import { LEGACY_CONFIRMATION_ACTION, LEGACY_CONFIRMATION_HASH_PATHS } from "./channelInventoryLegacyConfirmation";

/** Correlated to material m. Only immutable native evidence or an independently
 * appended, fully attested legacy confirmation qualifies. This is NOT a row,
 * team, enterprise, module-read, write or private-notes authorization fence. */
export function officialMaterialCreator(scope: ChannelInventoryScope, lock = false): SQL {
  if (!scope.officialActor || !Number.isSafeInteger(scope.officialActor.adminAccountId) || scope.officialActor.adminAccountId <= 0) return sql`FALSE`;
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const event = (alias: string) => {
    const a = sql.raw(alias);
    const json = (path: string) => sql`JSON_EXTRACT(${a}.after_data, ${`$.${path}`})`;
    const text = (path: string) => sql`JSON_UNQUOTE(${json(path)})`;
    const literal = (path: string, value: string) => sql`JSON_TYPE(${json(path)}) = 'STRING' AND BINARY ${text(path)} = BINARY ${value}`;
    const number = (path: string) => sql`JSON_TYPE(${json(path)}) = 'INTEGER' AND ${text(path)} REGEXP '^[1-9][0-9]{0,15}$' AND CAST(${text(path)} AS DECIMAL(20,0)) <= 9007199254740991`;
    const request = (path: string) => sql`JSON_TYPE(${json(path)}) = 'STRING' AND CHAR_LENGTH(${text(path)}) BETWEEN 8 AND 64 AND ${text(path)} NOT REGEXP '[^A-Za-z0-9_-]'`;
    const timestamp = (path: string) => sql`JSON_TYPE(${json(path)}) = 'STRING'
      AND CHAR_LENGTH(${text(path)}) = 24 AND ${text(path)} COLLATE utf8mb4_bin REGEXP '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
      AND CAST(SUBSTRING(${text(path)}, 9, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(SUBSTRING(${text(path)}, 1, 7), '-01')))`;
    const nativeAction = literal("action", "createDefaultShare");
    const confirmationAction = literal("action", LEGACY_CONFIRMATION_ACTION);
    const native = sql`(${nativeAction}
      AND BINARY ${a}.request_id = BINARY m.create_request_id
      AND JSON_TYPE(${json("materialId")}) = 'INTEGER' AND BINARY ${text("materialId")} = BINARY CAST(m.id AS CHAR)
      AND ${json("legacyOriginalActor")} IS NULL
      AND JSON_TYPE(${json("officialActor")}) = 'OBJECT' AND JSON_LENGTH(${json("officialActor")}) = 5
      AND JSON_TYPE(${json("officialActor.schemaVersion")}) = 'INTEGER' AND ${text("officialActor.schemaVersion")} = '1'
      AND ${number("officialActor.adminAccountId")} AND ${number("officialActor.staffUserId")}
      AND BINARY ${text("officialActor.staffUserId")} = BINARY CAST(${a}.actor_user_id AS CHAR)
      AND ${number("officialActor.bindingVersion")} AND ${request("officialActor.requestId")})`;
    const prefix = "legacyOriginalActor";
    const evidence = `${prefix}.evidence`;
    const digest = sql`SHA2(CONCAT_WS(CHAR(10), ${sql.join(LEGACY_CONFIRMATION_HASH_PATHS.map(text), sql`, `)}), 256)`;
    const confirmation = sql`(${confirmationAction}
      AND JSON_TYPE(${a}.after_data) = 'OBJECT' AND JSON_LENGTH(${a}.after_data) = 2
      AND JSON_TYPE(${json(prefix)}) = 'OBJECT' AND JSON_LENGTH(${json(prefix)}) = 11
      AND JSON_TYPE(${json(evidence)}) = 'OBJECT' AND JSON_LENGTH(${json(evidence)}) = 6
      AND JSON_TYPE(${a}.before_data) = 'NULL'
      AND JSON_TYPE(${json(`${prefix}.schemaVersion`)}) = 'INTEGER' AND ${text(`${prefix}.schemaVersion`)} = '1'
      AND ${number(`${prefix}.enterpriseId`)} AND BINARY ${text(`${prefix}.enterpriseId`)} = BINARY CAST(m.enterprise_id AS CHAR)
      AND ${number(`${prefix}.materialId`)} AND BINARY ${text(`${prefix}.materialId`)} = BINARY CAST(m.id AS CHAR)
      AND ${request(`${prefix}.originalCreateRequestId`)} AND BINARY ${text(`${prefix}.originalCreateRequestId`)} = BINARY m.create_request_id
      AND ${literal(`${prefix}.identityNamespace`, "backend-admin")} AND ${number(`${prefix}.adminAccountId`)}
      AND ${number(`${prefix}.staffUserId`)} AND BINARY ${text(`${prefix}.staffUserId`)} = BINARY CAST(${a}.actor_user_id AS CHAR)
      AND ${number(`${prefix}.bindingVersion`)} AND ${request(`${prefix}.confirmationRequestId`)}
      AND BINARY ${text(`${prefix}.confirmationRequestId`)} = BINARY ${a}.request_id
      AND BINARY ${a}.request_id <> BINARY m.create_request_id
      AND ${literal(`${prefix}.confirmationSource`, "project-owner-confirmation")}
      AND JSON_TYPE(${json(`${evidence}.taskId`)}) = 'STRING' AND CHAR_LENGTH(${text(`${evidence}.taskId`)}) BETWEEN 8 AND 128 AND ${text(`${evidence}.taskId`)} NOT REGEXP '[^A-Za-z0-9_-]'
      AND ${timestamp(`${evidence}.messageTimestamp`)}
      AND JSON_TYPE(${json(`${evidence}.messageTextSha256`)}) = 'STRING' AND CHAR_LENGTH(${text(`${evidence}.messageTextSha256`)}) = 64 AND ${text(`${evidence}.messageTextSha256`)} COLLATE utf8mb4_bin REGEXP '^[a-f0-9]{64}$'
      AND ${literal(`${evidence}.backendAccountStatus`, "active")}
      AND ${timestamp(`${evidence}.backendAccountVerifiedAt`)} AND ${timestamp(`${evidence}.bindingVerifiedAt`)}
      AND BINARY ${a}.payload_hash = BINARY ${digest})`;
    const correlated = sql`${a}.enterprise_id = m.enterprise_id AND ${a}.material_id = m.id`;
    // Ordinary pre-v11 create events have no officialActor: ignore them, never
    // rewrite them. A recognized, linked claim that is malformed poisons the
    // grant instead of being silently discarded beside another valid claim.
    const candidate = sql`(${confirmationAction} OR (${nativeAction} AND BINARY ${a}.request_id = BINARY m.create_request_id AND ${json("officialActor")} IS NOT NULL))`;
    return {
      correlated,
      candidate,
      valid: sql`(${native} OR ${confirmation})`,
      admin: sql`CASE WHEN ${nativeAction} THEN ${text("officialActor.adminAccountId")} ELSE ${text(`${prefix}.adminAccountId`)} END`,
    };
  };
  const original = event("original_event");
  const conflict = event("conflicting_event");
  return sql`(EXISTS (SELECT 1 FROM channel_inventory_material_share_audits original_event
    WHERE ${original.correlated} AND ${original.valid}
      AND BINARY ${original.admin} = BINARY ${String(scope.officialActor.adminAccountId)}${suffix})
    AND NOT EXISTS (SELECT 1 FROM channel_inventory_material_share_audits conflicting_event
      WHERE ${conflict.correlated} AND ${conflict.candidate}
        AND ((${conflict.valid}) IS NOT TRUE OR BINARY ${conflict.admin} <> BINARY ${String(scope.officialActor.adminAccountId)})${suffix}))`;
}

/** A creation event is enriched only while the material itself is first inserted.
 * The browser DTO has no such field. Legacy audit events are never updated. */
export function officialCreationEvidence(scope: ChannelInventoryScope) {
  const actor = scope.officialActor;
  if (!actor) return {};
  if (![actor.adminAccountId, actor.bindingVersion, scope.actorUserId].every(id => Number.isSafeInteger(id) && id > 0)
    || !/^[A-Za-z0-9_-]{8,64}$/.test(actor.requestId)) throw new Error("OFFICIAL_CREATION_CONTEXT_INVALID");
  return { officialActor: { schemaVersion: 1, adminAccountId: actor.adminAccountId,
    staffUserId: scope.actorUserId, bindingVersion: actor.bindingVersion, requestId: actor.requestId } };
}
