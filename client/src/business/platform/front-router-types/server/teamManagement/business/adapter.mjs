import { createHash } from 'node:crypto';
import {
  INHERITED_RECORD_TYPES,
  RECORD_REGISTRY,
  RECORD_TYPES,
  TeamBusinessError,
  hasModuleGate,
  recordDefinition
} from './registry.mjs';

/**
 * The table names and column names are fixed application constants. Values are
 * always bound through `?` placeholders; no request value can select a table,
 * field, ORDER BY fragment, or SQL expression.
 */
export const DEFAULT_ASSIGNMENT_SCHEMA = Object.freeze({
  table: 'enterprise_team_record_assignments',
  auditTable: 'enterprise_team_record_assignment_audits',
  id: 'id',
  enterpriseId: 'enterpriseId',
  teamId: 'teamId',
  recordType: 'recordType',
  recordKey: 'recordId',
  originalCreator: 'createdByUserId',
  currentOwner: 'currentOwnerUserId',
  version: 'revision'
});

const LIST_TYPES = Object.freeze({
  all: ['inventory', 'channel', 'channel_material', 'customer', 'sales_order', 'purchase_order', 'inbound_order', 'inventory_inquiry'],
  inventory: ['inventory'],
  inbound: ['inbound_order'],
  channel_profile: ['channel', 'channel_material'],
  customer: ['customer'],
  follow_up: ['customer'],
  sales_order: ['sales_order'],
  purchase_order: ['purchase_order'],
  inquiry: ['inventory_inquiry']
});

const SUMMARY_LABELS = Object.freeze({
  inventory: '库存', channel: '渠道档案', channel_material: '渠道库存', customer: '客户及跟进',
  sales_order: '销售订单', purchase_order: '采购订单', inbound_order: '入库单', inventory_inquiry: '库存询价'
});

const SUMMARY_TITLES = Object.freeze({
  inventory: "CONCAT(r.partNumber, ' / ', r.brand)",
  channel: 'r.name',
  channel_material: "CONCAT(r.part_number, ' / ', r.brand)",
  customer: 'r.name',
  sales_order: 'r.orderNumber',
  purchase_order: 'r.orderNo',
  inbound_order: 'r.slipNo',
  inventory_inquiry: 'r.partNumber'
});

function fail(code, message, detail) {
  throw new TeamBusinessError(code, message, detail);
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail('BAD_REQUEST', `${name} must be a positive integer`);
  return number;
}

function nullablePositiveInteger(value, name) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, name);
}

function limitedInteger(value, fallback, min, max, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail('BAD_REQUEST', `${name} is invalid`);
  return number;
}

function rowSet(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function resultHeader(result) {
  if (Array.isArray(result) && !Array.isArray(result[0])) return result[0] ?? {};
  if (Array.isArray(result) && result[0] && !Array.isArray(result[0])) return result[0];
  return result?.[0] && !Array.isArray(result[0]) ? result[0] : (result ?? {});
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function like(value) {
  return `%${String(value).replace(/[=%_]/g, (character) => `=${character}`)}%`;
}

function normalizeDate(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail('BAD_REQUEST', `${name} must be YYYY-MM-DD`);
  return text;
}

function assignmentColumns(schema, alias = 'a') {
  return `${alias}.${schema.id} AS assignmentId, ${alias}.${schema.enterpriseId} AS assignmentEnterpriseId, ${alias}.${schema.teamId} AS teamId, ${alias}.${schema.recordType} AS assignmentRecordType, ${alias}.${schema.recordKey} AS assignmentRecordId, ${alias}.${schema.originalCreator} AS assignmentCreatorUserId, ${alias}.${schema.currentOwner} AS assignmentCurrentOwnerUserId, ${alias}.${schema.version} AS assignmentVersion`;
}

/**
 * `actorDataScope` is installed by the service after membership lookup. It is
 * intentionally never read from request args. NULL preserves the established
 * role default while a non-NULL unknown value fails closed to self. Enterprise
 * owners retain the approved team-wide supervisory scope.
 */
function effectiveActorDataScope(scope, role) {
  if (role === 'owner') return 'team';
  const serverValue = scope?.teamAccess?.actorDataScope;
  if (serverValue === 'team' || serverValue === 'self') return serverValue;
  if (serverValue === null || serverValue === undefined) return 'self';
  return 'self';
}

function readableAssignmentScopePredicate(schema, scopeInfo, recordType = null, alias = 'a') {
  const own = `${alias}.${schema.currentOwner} = ?`;
  const ownValues = [scopeInfo.actorUserId];
  // A member's channel profile is private even when their server-approved
  // general business scope is team. With an unknown type (detail without a
  // recordType hint), express that same rule in SQL rather than loading an
  // unauthorized assignment and deciding in JavaScript.
  const mustBeOwn = scopeInfo.actorDataScope === 'self'
    || recordType === 'channel' || recordType === 'channel_material';
  if (mustBeOwn) {
    return { text: ` AND ${alias}.${schema.teamId} = ? AND ${own}`, values: [scopeInfo.teamId, ...ownValues] };
  }
  if (scopeInfo.role === 'member' && recordType === null) {
    return {
      text: ` AND ${alias}.${schema.teamId} = ? AND (${alias}.${schema.recordType} <> 'channel' OR ${own})`,
      values: [scopeInfo.teamId, ...ownValues]
    };
  }
  return { text: ` AND ${alias}.${schema.teamId} = ?`, values: [scopeInfo.teamId] };
}

function assertScope(scope, args) {
  const enterpriseId = positiveInteger(scope?.enterprise?.id, 'scope.enterprise.id');
  const teamId = positiveInteger(args?.teamId, 'teamId');
  const actorUserId = positiveInteger(scope?.teamAccess?.actorUserId, 'scope.teamAccess.actorUserId');
  const role = scope?.teamAccess?.actorTeamRole;
  if (!['owner', 'leader', 'member'].includes(role)) fail('FORBIDDEN', 'Team role is not valid');
  if (positiveInteger(scope.teamAccess.teamId, 'scope.teamAccess.teamId') !== teamId) fail('FORBIDDEN', 'Requested team differs from authorized team');
  if (args?.actorTeamRole !== undefined && args.actorTeamRole !== role) fail('FORBIDDEN', 'Requested role differs from authorized role');
  return { enterpriseId, teamId, actorUserId, role, actorDataScope: effectiveActorDataScope(scope, role) };
}

function assertRegisteredType(recordType) {
  if (!RECORD_TYPES.includes(recordType)) fail('BAD_REQUEST', `Unsupported record type: ${String(recordType)}`);
  return recordDefinition(recordType);
}

function expectedCreator(record, definition) {
  if (record.actorUserId === null || record.actorUserId === undefined) return null;
  return positiveInteger(record.actorUserId, 'actorUserId');
}

function isSameNullableId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return left == null && right == null;
  return Number(left) === Number(right);
}

function hasLegacyEnterpriseOwner(definition) {
  return definition.recordType === 'inventory' || definition.recordType === 'inbound_order';
}

function recordTenantPredicate(definition, alias = 'r', enterpriseValue = '?') {
  const direct = `${alias}.${definition.enterpriseColumn} = ${enterpriseValue}`;
  if (!hasLegacyEnterpriseOwner(definition)) return direct;
  return `(${direct} OR (${alias}.${definition.enterpriseColumn} IS NULL AND EXISTS (
    SELECT 1 FROM enterprise_legacy_data_owners legacy_owner
     WHERE legacy_owner.dataOwnerUserId = ${alias}.userId
       AND legacy_owner.enterpriseId = ${enterpriseValue}
  )))`;
}

function recordTenantValues(definition, enterpriseId) {
  return hasLegacyEnterpriseOwner(definition) ? [enterpriseId, enterpriseId] : [enterpriseId];
}

/**
 * Create an adapter. `getReadConnection` must return the active Drizzle/MySQL
 * database executor for read-only routes. `execute` can adapt `{text, values}`
 * to Drizzle `sql` before execution. Neither callback may start a transaction.
 */
export function createTeamBusinessAdapter({ getReadConnection, readConnection, execute, resolveModuleAccess, assignmentSchema = {}, bootstrapEnterpriseId = 1 } = {}) {
  const schema = Object.freeze({ ...DEFAULT_ASSIGNMENT_SCHEMA, ...assignmentSchema });

  async function run(connection, text, values = []) {
    if (!connection) fail('INTERNAL_SERVER_ERROR', 'A database connection is required');
    const bound = Object.freeze({ text, values: Object.freeze([...values]) });
    let result;
    if (typeof execute === 'function') result = await execute(connection, bound);
    else if (typeof connection.query === 'function') result = await connection.query(text, values);
    else if (typeof connection.execute === 'function') result = await connection.execute(text, values);
    else fail('INTERNAL_SERVER_ERROR', 'Connection does not support parameterized queries');
    return result;
  }

  async function rows(connection, text, values = []) {
    return rowSet(await run(connection, text, values));
  }

  async function one(connection, text, values = []) {
    return (await rows(connection, text, values))[0] ?? null;
  }

  async function getReader() {
    const connection = typeof getReadConnection === 'function' ? await getReadConnection() : readConnection;
    if (!connection) fail('INTERNAL_SERVER_ERROR', 'Business read database is unavailable');
    return connection;
  }

  async function lockAssignment(connection, enterpriseId, recordType, recordKey) {
    return one(connection,
      `SELECT ${assignmentColumns(schema)} FROM ${schema.table} a WHERE a.${schema.enterpriseId} = ? AND a.${schema.recordType} = ? AND a.${schema.recordKey} = ? LIMIT 1 FOR UPDATE`,
      [enterpriseId, recordType, recordKey]);
  }

  async function lockVerifiedParentAssignment(connection, enterpriseId, parentType, parentKey) {
    let parentAssignment = await lockAssignment(connection, enterpriseId, parentType, parentKey);
    if (parentAssignment) return parentAssignment;
    const parentDefinition = recordDefinition(parentType);
    const parent = await one(connection,
      `SELECT ${parentDefinition.idColumn} AS id FROM ${parentDefinition.table} r WHERE ${recordTenantPredicate(parentDefinition)} AND r.${parentDefinition.idColumn} = ? LIMIT 1 FOR UPDATE`,
      [...recordTenantValues(parentDefinition, enterpriseId), parentKey]);
    if (!parent) fail('PRECONDITION_FAILED', 'Dependent record parent is unavailable in this enterprise');
    // A legacy parent lacking a mapping cannot be attributed from its current
    // membership.  Persist the known-unassigned state and let the child safely
    // inherit it rather than rejecting an otherwise valid business write.
    parentAssignment = await insertAssignment(connection, {
      enterpriseId, teamId: null, recordType: parentType, recordKey: parentKey,
      creatorUserId: null, currentOwnerUserId: null
    });
    return parentAssignment;
  }

  async function lockActiveTeam(connection, enterpriseId, teamId) {
    const team = await one(connection,
      'SELECT id, enterpriseId, status FROM enterprise_teams WHERE enterpriseId = ? AND id = ? LIMIT 1 FOR UPDATE',
      [enterpriseId, teamId]);
    if (!team || team.status !== 'active') fail('CONFLICT', 'Target team is unavailable');
    return team;
  }

  async function lockActorTeamMembership(connection, enterpriseId, teamId, actorUserId) {
    const membership = await one(connection,
      `SELECT tm.id, tm.teamId, tm.userId, tm.teamRole
         FROM enterprise_team_members tm
         INNER JOIN enterprise_members em ON em.enterpriseId = tm.enterpriseId AND em.userId = tm.userId AND em.status = 'active'
         INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
        WHERE tm.enterpriseId = ? AND tm.teamId = ? AND tm.userId = ?
        LIMIT 1 FOR UPDATE`,
      [enterpriseId, teamId, actorUserId]);
    if (!membership) fail('FORBIDDEN', 'Actor is not an active member of the selected team');
    return membership;
  }

  async function resolveCreationTeam(connection, enterpriseId, actorUserId, requestedTeamId) {
    if (!actorUserId) return null;
    if (requestedTeamId !== null && requestedTeamId !== undefined) {
      const teamId = positiveInteger(requestedTeamId, 'teamId');
      await lockActiveTeam(connection, enterpriseId, teamId);
      await lockActorTeamMembership(connection, enterpriseId, teamId, actorUserId);
      return teamId;
    }
    const memberships = await rows(connection,
      `SELECT tm.teamId
         FROM enterprise_team_members tm
         INNER JOIN enterprise_members em ON em.enterpriseId = tm.enterpriseId AND em.userId = tm.userId AND em.status = 'active'
         INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
        WHERE tm.enterpriseId = ? AND tm.userId = ?
         ORDER BY tm.teamId ASC FOR UPDATE`,
      [enterpriseId, actorUserId]);
    // Business creation is never blocked merely because an employee has not
    // joined a team (or belongs to more than one).  The assignment row records
    // a deliberate NULL team so an owner can assign it later.  An *explicit*
    // team remains fail-closed above.
    return memberships.length === 1 ? positiveInteger(memberships[0].teamId, 'membership.teamId') : null;
  }

  function validateExistingAssignment(existing, record, expectedTeamId) {
    if (Number(existing.assignmentEnterpriseId) !== Number(record.enterpriseId)) fail('CONFLICT', 'Existing assignment has a different enterprise');
    if (expectedTeamId !== null && Number(existing.teamId) !== expectedTeamId) fail('CONFLICT', 'Idempotent record has a different frozen team');
    const creator = expectedCreator(record);
    if (creator !== null && !isSameNullableId(existing.assignmentCreatorUserId, creator)) {
      fail('CONFLICT', 'Idempotent record has a different original creator snapshot');
    }
    if (record.currentOwnerUserId !== undefined && record.currentOwnerUserId !== null && !isSameNullableId(existing.assignmentCurrentOwnerUserId, record.currentOwnerUserId)) {
      fail('CONFLICT', 'Idempotent record has a different current-owner snapshot');
    }
  }

  async function insertAssignment(connection, { enterpriseId, teamId, recordType, recordKey, creatorUserId, currentOwnerUserId }) {
    await run(connection,
      `INSERT INTO ${schema.table} (${schema.enterpriseId}, ${schema.teamId}, ${schema.recordType}, ${schema.recordKey}, ${schema.originalCreator}, ${schema.currentOwner}, ${schema.version}) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [enterpriseId, teamId, recordType, recordKey, creatorUserId, currentOwnerUserId]);
    const assigned = await lockAssignment(connection, enterpriseId, recordType, recordKey);
    if (!assigned) fail('INTERNAL_SERVER_ERROR', 'Inserted team assignment could not be locked');
    return assigned;
  }

  /**
   * Called within the native writer transaction immediately after its root INSERT.
   * No membership-driven historical backfill is performed here.
   */
  async function registerInsertedRecord(connection, record) {
    const enterpriseId = positiveInteger(record?.enterpriseId, 'enterpriseId');
    const definition = assertRegisteredType(record?.recordType);
    const recordKey = positiveInteger(record?.recordKey, 'recordKey');
    const actorUserId = expectedCreator(record);
    const requestedTeamId = record?.teamId === undefined ? null : nullablePositiveInteger(record.teamId, 'teamId');
    const currentOwnerUserId = nullablePositiveInteger(record?.currentOwnerUserId, 'currentOwnerUserId');

    if (definition.kind === 'inherits-parent' || definition.kind === 'inherits-link') {
      const parent = record?.parent;
      if (!parent || parent.recordType !== definition.parentType) fail('PRECONDITION_FAILED', `${definition.recordType} must declare its verified ${definition.parentType} parent`);
      const parentKey = positiveInteger(parent.recordKey, 'parent.recordKey');
      const parentAssignment = await lockVerifiedParentAssignment(connection, enterpriseId, definition.parentType, parentKey);
      if (requestedTeamId !== null && !isSameNullableId(parentAssignment.teamId, requestedTeamId)) fail('CONFLICT', 'Dependent record cannot select a team different from its parent');
      const existing = await lockAssignment(connection, enterpriseId, definition.recordType, recordKey);
      if (definition.kind === 'inherits-link') {
        if (existing) fail('CONFLICT', 'A linked child record must not receive its own team assignment');
        return {
          status: 'inherited', recordType: definition.recordType, recordId: recordKey,
          teamId: parentAssignment.teamId == null ? null : Number(parentAssignment.teamId), idempotent: false,
          inheritedFrom: { recordType: definition.parentType, recordId: parentKey }
        };
      }
      if (definition.kind === 'inherits-parent') {
        if (existing) {
          validateExistingAssignment(existing, record, parentAssignment.teamId == null ? null : Number(parentAssignment.teamId));
          return { ...publicAssignment(existing), idempotent: true, inheritedFrom: { recordType: definition.parentType, recordId: parentKey } };
        }
        const assignment = await insertAssignment(connection, {
          enterpriseId, teamId: parentAssignment.teamId == null ? null : Number(parentAssignment.teamId), recordType: definition.recordType, recordKey,
          creatorUserId: actorUserId, currentOwnerUserId: currentOwnerUserId ?? actorUserId
        });
        return { ...publicAssignment(assignment), idempotent: false, inheritedFrom: { recordType: definition.parentType, recordId: parentKey } };
      }
    }

    const teamId = await resolveCreationTeam(connection, enterpriseId, actorUserId, requestedTeamId);
    const existing = await lockAssignment(connection, enterpriseId, definition.recordType, recordKey);
    if (existing) {
      validateExistingAssignment(existing, record, teamId);
      return { ...publicAssignment(existing), idempotent: true };
    }
    const assignment = await insertAssignment(connection, {
      enterpriseId, teamId, recordType: definition.recordType, recordKey, creatorUserId: actorUserId,
      // Preserve a known native owner, but never synthesize one from legacy
      // data-owner/userId fields.  An unknown actor stays wholly unassigned.
      currentOwnerUserId: currentOwnerUserId ?? actorUserId
    });
    return { ...publicAssignment(assignment), status: teamId == null ? 'unassigned' : 'assigned', idempotent: false };
  }

  function publicAssignment(row) {
    return {
      id: Number(row.assignmentId), enterpriseId: Number(row.assignmentEnterpriseId), teamId: row.teamId == null ? null : Number(row.teamId),
      recordType: String(row.assignmentRecordType), recordId: Number(row.assignmentRecordId),
      originalCreatorUserId: row.assignmentCreatorUserId == null ? null : Number(row.assignmentCreatorUserId),
      currentOwnerUserId: row.assignmentCurrentOwnerUserId == null ? null : Number(row.assignmentCurrentOwnerUserId),
      assignmentVersion: Number(row.assignmentVersion)
    };
  }

  function typesFor(args) {
    const requested = args?.recordType ?? args?.businessType ?? 'all';
    if (Array.isArray(requested)) {
      const values = requested.map((value) => String(value));
      if (!values.length || values.some((value) => !RECORD_TYPES.includes(value) || value==='customer_demand')) fail('BAD_REQUEST', '客户需求请从获准客户详情查看');
      return values;
    }
    const aliases = LIST_TYPES[String(requested)];
    if (aliases) return aliases;
    if (RECORD_TYPES.includes(String(requested)) && requested!=='customer_demand') return [String(requested)];
    fail('BAD_REQUEST', 'businessType is invalid');
  }

  const protectedModules = Object.freeze({ customer: 'customers', customer_demand: 'demands', channel: 'channels', channel_material: 'stocks' });

  async function installModulePolicies(reader, scopeInfo) {
    const policies = {};
    for (const module of ['customers', 'demands', 'channels', 'stocks']) {
      // No compatibility grant if a caller failed to wire the authoritative resolver.
      policies[module] = typeof resolveModuleAccess === 'function'
        ? await resolveModuleAccess(scopeInfo.actorUserId, scopeInfo.enterpriseId, module, reader)
        : { read: false, write: false, scope: 'self', teamId: null };
    }
    scopeInfo.modulePolicies = policies;
    return scopeInfo;
  }

  function policyScopeInfo(definition, scopeInfo) {
    const module = protectedModules[definition.recordType];
    if (!module) return scopeInfo;
    const access = scopeInfo.modulePolicies?.[module];
    if (!access?.read) return null;
    if (access.scope === 'team' && Number(access.teamId) !== scopeInfo.teamId) return null;
    return { ...scopeInfo, actorDataScope: access.scope === 'self' ? 'self' : 'team' };
  }

  function summarySubquery(definition, scope, scopeInfo, args) {
    if (!hasModuleGate(scope, definition)) return null;
    scopeInfo = policyScopeInfo(definition, scopeInfo);
    if (!scopeInfo) return null;
    // Peer shares are available only through the dedicated, source-free channel DTO.
    const isSharedMaterial = false;
    const readScope = readableAssignmentScopePredicate(schema, scopeInfo, definition.recordType);
    const sharedOwner = isSharedMaterial ? 'NULL' : `a.${schema.currentOwner}`;
    const sharedTeam = isSharedMaterial ? 'NULL' : `a.${schema.teamId}`;
    const memberFilter = args?.memberUserId === undefined ? null : positiveInteger(args.memberUserId, 'memberUserId');
    const ownerFilter = args?.ownerUserId === undefined ? null : positiveInteger(args.ownerUserId, 'ownerUserId');
    const dateFrom = normalizeDate(args?.dateFrom, 'dateFrom');
    const dateTo = normalizeDate(args?.dateTo, 'dateTo');
    const updateColumn = definition.recordType === 'inventory_inquiry'
      ? 'r.lastActivityAt'
      : (definition.recordType === 'channel' || definition.recordType === 'channel_material' ? 'r.updated_at' : 'r.updatedAt');
    const createdColumn = definition.recordType === 'channel' || definition.recordType === 'channel_material' ? 'r.created_at' : 'r.createdAt';
    let filters = definition.recordType === 'customer' ? ` AND r.assignedUserId = a.${schema.currentOwner}` : ['channel', 'channel_material'].includes(definition.recordType) ? ` AND r.responsible_user_id = a.${schema.currentOwner}` : '';
    const filterValues = [];
    if (definition.recordType === 'channel_material') filters += ' AND NOT EXISTS (SELECT 1 FROM channel_inventory_material_management dm WHERE dm.enterprise_id = r.enterprise_id AND dm.material_id = r.id AND dm.deleted_at IS NOT NULL)';
    if (memberFilter) { filters += ` AND a.${schema.originalCreator} = ?`; filterValues.push(memberFilter); }
    if (ownerFilter && !isSharedMaterial) { filters += ` AND a.${schema.currentOwner} = ?`; filterValues.push(ownerFilter); }
    if (dateFrom) { filters += ` AND ${updateColumn} >= ?`; filterValues.push(`${dateFrom} 00:00:00`); }
    if (dateTo) { filters += ` AND ${updateColumn} < DATE_ADD(?, INTERVAL 1 DAY)`; filterValues.push(dateTo); }
    const version = definition.versionColumn ? `r.${definition.versionColumn}` : '1';
    const status = definition.recordType === 'customer'
      ? 'r.stage'
      : definition.recordType === 'purchase_order' ? 'r.lifecycle'
        : definition.recordType === 'channel' ? 'r.active'
          : definition.recordType === 'channel_material' ? "'active'"
            : definition.recordType === 'inventory_inquiry' ? 'r.status'
              : 'r.status';
    // Customer demands intentionally have no assignment row: their access is
    // derived from the parent customer mapping via customerId, never demand.id.
    const inheritedLink = definition.kind === 'inherits-link';
    const joinRecordType = inheritedLink ? definition.parentType : definition.mappingType;
    const joinRecordId = inheritedLink ? `r.${definition.parentIdColumn}` : `r.${definition.idColumn}`;
    const tenantPredicate = recordTenantPredicate(definition);
    return {
      text: `SELECT a.${schema.id} AS id, a.${schema.recordKey} AS recordId, '${definition.recordType}' AS recordType,
                    '${SUMMARY_LABELS[definition.recordType]}' AS businessType, ${SUMMARY_TITLES[definition.recordType]} AS title,
                    ${sharedTeam} AS teamId, a.${schema.originalCreator} AS originalCreatorUserId,
                    ${sharedOwner} AS currentOwnerUserId, ${status} AS status, ${version} AS nativeVersion,
                    ${createdColumn} AS createdAt, ${updateColumn} AS updatedAt,
                    ${isSharedMaterial ? '1' : '0'} AS channelPrivate
               FROM ${definition.table} r
               INNER JOIN ${schema.table} a
                 ON a.${schema.enterpriseId} = ? AND a.${schema.recordType} = ? AND a.${schema.recordKey} = ${joinRecordId}
              WHERE ${tenantPredicate}${readScope.text}${filters}`,
      // table join bindings are first; tenant predicate follows the join.
      values: [scopeInfo.enterpriseId, joinRecordType, ...recordTenantValues(definition, scopeInfo.enterpriseId), ...readScope.values, ...filterValues]
    };
  }

  function mapSummary(row) {
    return {
      id: Number(row.id), recordId: Number(row.recordId), recordType: String(row.recordType), businessType: String(row.businessType),
      businessTypeLabel: String(row.businessType), title: row.title == null ? '' : String(row.title),
      teamId: row.teamId == null ? null : Number(row.teamId), originalCreatorUserId: row.originalCreatorUserId == null ? null : Number(row.originalCreatorUserId),
      currentOwnerUserId: row.currentOwnerUserId == null ? null : Number(row.currentOwnerUserId), status: row.status,
      nativeVersion: row.nativeVersion == null ? null : Number(row.nativeVersion), createdAt: row.createdAt ?? null, updatedAt: row.updatedAt ?? null,
      channelPrivate: Boolean(Number(row.channelPrivate)), readOnly: true, canEdit: false
    };
  }

  async function list(scope, args = {}) {
    const scopeInfo = assertScope(scope, args);
    const reader = await getReader();
    await installModulePolicies(reader, scopeInfo);
    const subqueries = typesFor(args).map((type) => summarySubquery(recordDefinition(type), scope, scopeInfo, args)).filter(Boolean);
    if (!subqueries.length) return { items: [], total: 0, page: 1, pageSize: limitedInteger(args.pageSize, 20, 1, 100, 'pageSize') };
    const union = subqueries.map((query) => query.text).join(' UNION ALL ');
    const values = subqueries.flatMap((query) => query.values);
    const page = limitedInteger(args.page, 1, 1, 100000, 'page');
    const pageSize = limitedInteger(args.pageSize, 20, 1, 100, 'pageSize');
    const count = await one(reader, `SELECT COUNT(*) AS total FROM (${union}) team_records`, values);
    const items = await rows(reader, `SELECT * FROM (${union}) team_records ORDER BY updatedAt DESC, id DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
    return { items: items.map(mapSummary), total: Number(count?.total ?? 0), page, pageSize };
  }

  async function loadReadableAssignment(connection, scopeInfo, assignmentId, recordType = null) {
    const readScope = readableAssignmentScopePredicate(schema, scopeInfo, recordType);
    const typePredicate = recordType === null ? '' : ` AND a.${schema.recordType} = ?`;
    const values = [scopeInfo.enterpriseId, assignmentId, ...(recordType === null ? [] : [recordType]), ...readScope.values];
    return one(connection,
      `SELECT ${assignmentColumns(schema)} FROM ${schema.table} a
        WHERE a.${schema.enterpriseId} = ? AND a.${schema.id} = ?${typePredicate}${readScope.text}
        LIMIT 1`, values);
  }

  function mayReadAllCustomerFollowUps(scopeInfo) {
    // Customer parent access is checked before this query. Follow-up authorship
    // remains private for members even if their parent scope is team or they
    // hold the broad customer management module permission.
    return scopeInfo.role !== 'member';
  }

  async function childDetails(connection, definition, enterpriseId, recordId, scope, scopeInfo) {
    if (definition.recordType === 'customer') {
      const ownFollowUps = !mayReadAllCustomerFollowUps(scopeInfo);
      const demandsAccess = scopeInfo.modulePolicies?.demands;
      const demandsSelf = demandsAccess?.scope === 'self';
      const demandsAllowed = demandsAccess?.read && (demandsAccess.scope !== 'team' || Number(demandsAccess.teamId) === scopeInfo.teamId);
      const [followUps, demands] = await Promise.all([
        rows(connection, `SELECT id, authorUserId, method, content, occurredAt, correctionOfId, createdAt FROM crm_customer_followups WHERE enterpriseId = ? AND customerId = ?${ownFollowUps ? ' AND authorUserId = ?' : ''} ORDER BY occurredAt DESC, id DESC LIMIT 100`, [enterpriseId, recordId, ...(ownFollowUps ? [scopeInfo.actorUserId] : [])]),
        demandsAllowed ? rows(connection, `SELECT d.id, d.demandNo, d.projectName, d.priority, d.status, d.replyDueAt, d.createdByUserId, d.version, d.revision, d.createdAt, d.updatedAt FROM crm_customer_demands d INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId WHERE d.enterpriseId = ? AND d.customerId = ?${demandsSelf ? ' AND c.assignedUserId = ?' : ''} ORDER BY d.updatedAt DESC, d.id DESC LIMIT 100`, [enterpriseId, recordId, ...(demandsSelf ? [scopeInfo.actorUserId] : [])]) : Promise.resolve([])
      ]);
      return { followUps: followUps.map((row) => ({ ...row, id: Number(row.id), authorUserId: Number(row.authorUserId), correctionOfId: row.correctionOfId == null ? null : Number(row.correctionOfId) })), demands: demands.map((row) => ({ ...row, id: Number(row.id), createdByUserId: Number(row.createdByUserId), version: Number(row.version), revision: Number(row.revision) })) };
    }
    if (definition.recordType === 'inbound_order') {
      const [payments, events] = await Promise.all([
        rows(connection, `SELECT id, actorUserId, amount, paymentDate, note, voidedAt, voidReason, createdAt FROM inbound_payment_entries WHERE enterpriseId = ? AND inboundOrderId = ? ORDER BY id ASC`, [enterpriseId, recordId]),
        rows(connection, `SELECT id, actorUserId, eventType, reason, createdAt FROM inbound_order_events WHERE enterpriseId = ? AND inboundOrderId = ? ORDER BY id ASC LIMIT 100`, [enterpriseId, recordId])
      ]);
      return { payments: payments.map((row) => ({ ...row, id: Number(row.id), actorUserId: Number(row.actorUserId) })), events: events.map((row) => ({ ...row, id: Number(row.id), actorUserId: Number(row.actorUserId) })) };
    }
    if (definition.recordType === 'sales_order') {
      const items = await rows(connection, `SELECT id, partNumber, brand, pkg, qtyUnit, demandQty, orderedQty, unitPrice, lineAmount, deliveryRequirement, note FROM crm_sales_order_items WHERE enterpriseId = ? AND orderId = ? ORDER BY id ASC`, [enterpriseId, recordId]);
      return { items: items.map((row) => ({ ...row, id: Number(row.id), demandQty: Number(row.demandQty), orderedQty: Number(row.orderedQty) })) };
    }
    if (definition.recordType === 'purchase_order') {
      const items = await rows(connection, `SELECT id, partNumber, brand, pkg, qtyUnit, qty, unitPrice, shippedQty FROM crm_purchase_order_items WHERE enterpriseId = ? AND orderId = ? ORDER BY id ASC`, [enterpriseId, recordId]);
      return { items: items.map((row) => ({ ...row, id: Number(row.id), qty: Number(row.qty), shippedQty: Number(row.shippedQty) })) };
    }
    return {};
  }

  async function detail(scope, args = {}) {
    const scopeInfo = assertScope(scope, args);
    const assignmentId = positiveInteger(args.recordId, 'recordId');
    const requestedType = args.recordType === undefined ? null : String(args.recordType);
    if (requestedType && !RECORD_TYPES.includes(requestedType)) fail('BAD_REQUEST', 'recordType is invalid');
    const assignmentType = requestedType === 'customer_demand' ? 'customer' : requestedType;
    const reader = await getReader();
    await installModulePolicies(reader, scopeInfo);
    const candidate = await one(reader, `SELECT ${assignmentColumns(schema)} FROM ${schema.table} a WHERE a.${schema.enterpriseId} = ? AND a.${schema.id} = ? LIMIT 1`, [scopeInfo.enterpriseId, assignmentId]);
    if (!candidate || (assignmentType && String(candidate.assignmentRecordType) !== assignmentType)) return null;
    const nativeType = String(candidate.assignmentRecordType);
    const effective = policyScopeInfo(recordDefinition(requestedType === 'customer_demand' ? requestedType : nativeType), scopeInfo);
    if (!effective) return null;
    if (requestedType === 'customer_demand') {
      const parentEffective = policyScopeInfo(recordDefinition('customer'), scopeInfo);
      if (!parentEffective || !await loadReadableAssignment(reader, parentEffective, assignmentId, 'customer')) return null;
    }
    const assignment = await loadReadableAssignment(reader, effective, assignmentId, nativeType);
    if (!assignment) return null;
    if (requestedType === 'customer_demand') {
      if (String(assignment.assignmentRecordType) !== 'customer') return null;
      const definition = recordDefinition('customer_demand');
      if (!hasModuleGate(scope, definition)) return null;
      const demandId = positiveInteger(args.nativeRecordId, 'nativeRecordId');
      const row = await one(reader,
        `SELECT ${definition.detailColumns} FROM ${definition.table} r WHERE r.${definition.enterpriseColumn} = ? AND r.${definition.idColumn} = ? AND r.${definition.parentIdColumn} = ? LIMIT 1`,
        [scopeInfo.enterpriseId, demandId, Number(assignment.assignmentRecordId)]);
      if (!row) return null;
      return {
        recordType: definition.recordType, recordId: demandId, teamId: assignment.teamId == null ? null : Number(assignment.teamId),
        originalCreatorUserId: assignment.assignmentCreatorUserId == null ? null : Number(assignment.assignmentCreatorUserId),
        currentOwnerUserId: assignment.assignmentCurrentOwnerUserId == null ? null : Number(assignment.assignmentCurrentOwnerUserId),
        assignmentVersion: Number(assignment.assignmentVersion), readOnly: true, canEdit: false,
        record: row, children: {}
      };
    }
    const definition = assertRegisteredType(String(assignment.assignmentRecordType));
    if (!hasModuleGate(scope, definition)) return null;
    const activeMaterial = definition.recordType === 'channel_material' ? ' AND NOT EXISTS (SELECT 1 FROM channel_inventory_material_management dm WHERE dm.enterprise_id = r.enterprise_id AND dm.material_id = r.id AND dm.deleted_at IS NOT NULL)' : '';
    const row = await one(reader,
      `SELECT ${definition.detailColumns} FROM ${definition.table} r WHERE ${recordTenantPredicate(definition)} AND r.${definition.idColumn} = ?${activeMaterial} LIMIT 1`,
      [...recordTenantValues(definition, scopeInfo.enterpriseId), Number(assignment.assignmentRecordId)]);
    if (!row) return null;
    if (['customer', 'channel', 'channel_material'].includes(definition.recordType) && Number(row.currentOwnerUserId) !== Number(assignment.assignmentCurrentOwnerUserId)) return null;
    const sharedMaterialForMember = false;
    const children = await childDetails(reader, definition, scopeInfo.enterpriseId, Number(assignment.assignmentRecordId), scope, scopeInfo);
    return {
      recordType: definition.recordType, recordId: Number(assignment.assignmentRecordId), teamId: sharedMaterialForMember ? null : Number(assignment.teamId),
      originalCreatorUserId: assignment.assignmentCreatorUserId == null ? null : Number(assignment.assignmentCreatorUserId),
      currentOwnerUserId: sharedMaterialForMember ? null : (assignment.assignmentCurrentOwnerUserId == null ? null : Number(assignment.assignmentCurrentOwnerUserId)),
      assignmentVersion: Number(assignment.assignmentVersion), readOnly: true, canEdit: false,
      channelPrivate: sharedMaterialForMember, record: sharedMaterialForMember ? redactSharedMaterial(row) : row, children
    };
  }

  function redactSharedMaterial(row) {
    const clone = { ...row };
    // Registry detail has no profile fields, but do not accidentally retain any
    // field added by a future query without an explicit entitlement review.
    for (const field of ['channelId', 'channel_id', 'channelName', 'channelType', 'channelActive', 'responsibleUserId', 'responsible_user_id', 'dataOwnerUserId', 'data_owner_user_id', 'source', 'sourceUserId', 'sourceOwnerUserId', 'currentOwnerUserId', 'enterpriseId', 'enterprise_id']) delete clone[field];
    return clone;
  }

  async function previewRows(connection, enterpriseId, teamId, userId, lock) {
    const result = [];
    for (const type of ['inventory', 'channel', 'channel_material', 'customer', 'sales_order', 'purchase_order', 'inbound_order', 'inventory_inquiry']) {
      const definition = recordDefinition(type);
      const nativeOwner = definition.ownerColumn ? ` OR r.${definition.ownerColumn} = ?` : '';
      const nativeVersion = definition.versionColumn ? `r.${definition.versionColumn}` : '1';
      const nativeStatus = type === 'customer' ? 'r.stage' : type === 'purchase_order' ? 'r.lifecycle' : type === 'channel' ? 'r.active' : type === 'channel_material' ? "'active'" : 'r.status';
      const parentRecordId = type === 'channel_material' ? ', r.channel_id AS parentRecordId' : '';
      const recordJoin = hasLegacyEnterpriseOwner(definition)
        ? `(r.${definition.enterpriseColumn} = a.${schema.enterpriseId} OR (r.${definition.enterpriseColumn} IS NULL AND EXISTS (SELECT 1 FROM enterprise_legacy_data_owners legacy_owner WHERE legacy_owner.dataOwnerUserId = r.userId AND legacy_owner.enterpriseId = a.${schema.enterpriseId})))`
        : `r.${definition.enterpriseColumn} = a.${schema.enterpriseId}`;
      const query = `SELECT a.${schema.id} AS assignmentId, a.${schema.recordKey} AS recordId, a.${schema.teamId} AS teamId,
                            a.${schema.version} AS assignmentVersion, a.${schema.currentOwner} AS assignmentOwner,
                            ${nativeVersion} AS nativeVersion, ${nativeStatus} AS nativeStatus${parentRecordId}
                       FROM ${schema.table} a
                       INNER JOIN ${definition.table} r ON r.${definition.idColumn} = a.${schema.recordKey} AND ${recordJoin}
                      WHERE a.${schema.enterpriseId} = ? AND a.${schema.teamId} = ? AND a.${schema.recordType} = ?
                        AND (a.${schema.currentOwner} = ?${nativeOwner})
                      ORDER BY a.${schema.recordKey} ASC${lock ? ' FOR UPDATE' : ''}`;
      const values = [enterpriseId, teamId, type, userId, ...(definition.ownerColumn ? [userId] : [])];
      for (const row of await rows(connection, query, values)) result.push({ type, ...row });
    }
    return result;
  }

  async function unassignedCount(connection, enterpriseId) {
    const checks = ['inventory', 'channel', 'customer', 'sales_order', 'purchase_order', 'inbound_order'];
    let total = 0;
    for (const type of checks) {
      const definition = recordDefinition(type);
      const row = await one(connection, `SELECT COUNT(*) AS total FROM ${definition.table} r LEFT JOIN ${schema.table} a ON a.${schema.enterpriseId} = ? AND a.${schema.recordType} = ? AND a.${schema.recordKey} = r.${definition.idColumn} WHERE ${recordTenantPredicate(definition)} AND (a.${schema.id} IS NULL OR a.${schema.teamId} IS NULL)`, [enterpriseId, type, ...recordTenantValues(definition, enterpriseId)]);
      total += Number(row?.total ?? 0);
    }
    return total;
  }

  async function previewMember(connection, enterpriseIdValue, teamIdValue, userIdValue) {
    const enterpriseId = positiveInteger(enterpriseIdValue, 'enterpriseId');
    const teamId = positiveInteger(teamIdValue, 'teamId');
    const userId = positiveInteger(userIdValue, 'userId');
    const records = await previewRows(connection, enterpriseId, teamId, userId, true);
    const counts = {};
    for (const row of records) counts[row.type] = (counts[row.type] ?? 0) + 1;
    const unassigned = await unassignedCount(connection, enterpriseId);
    if (unassigned) counts.unassigned = unassigned;
    const blocked = records.filter((row) => row.type === 'inventory_inquiry' && row.nativeStatus !== 'closed');
    const material = records.map((row) => ({
      recordType: row.type, assignmentId: Number(row.assignmentId), recordId: Number(row.recordId), teamId: Number(row.teamId),
      assignmentVersion: Number(row.assignmentVersion), nativeVersion: Number(row.nativeVersion ?? 0), nativeOwnerUserId: row.assignmentOwner == null ? null : Number(row.assignmentOwner), nativeStatus: row.nativeStatus ?? null,
      blocked: row.type === 'inventory_inquiry' && row.nativeStatus !== 'closed'
    })).sort((left, right) => left.recordType.localeCompare(right.recordType) || left.recordId - right.recordId);
    return { counts, requiresHandoff: records.length > 0, revisionMaterial: { records: material, unassignedCount: unassigned, blockedCount: blocked.length, fingerprint: hash(material) } };
  }

  function transferBlocker(row) {
    if (row.type === 'inbound_order') return row.nativeStatus === 'in_transit';
    if (row.type === 'sales_order') return row.nativeStatus === 'confirmed';
    if (row.type === 'purchase_order') return row.nativeStatus === 'active';
    return false;
  }

  async function assertNoOrderSideEffects(connection, enterpriseId, row) {
    if (row.type === 'sales_order') {
      const state = await one(connection, `SELECT (SELECT COUNT(*) FROM crm_sales_order_payments WHERE enterpriseId = ? AND orderId = ?) AS payments, (SELECT COUNT(*) FROM crm_sales_order_shipments WHERE enterpriseId = ? AND orderId = ?) AS shipments`, [enterpriseId, row.recordId, enterpriseId, row.recordId]);
      if (Number(state?.payments ?? 0) || Number(state?.shipments ?? 0)) fail('PRECONDITION_FAILED', 'Sales orders with payments or shipments require the existing specialized handoff workflow');
    }
    if (row.type === 'purchase_order') {
      const state = await one(connection, `SELECT (SELECT COUNT(*) FROM crm_purchase_order_items WHERE enterpriseId = ? AND orderId = ? AND shippedQty > 0) AS shipped, (SELECT COUNT(*) FROM crm_purchase_order_inbounds WHERE enterpriseId = ? AND orderId = ?) AS inbounds, (SELECT COUNT(*) FROM crm_purchase_order_invoices WHERE enterpriseId = ? AND orderId = ? AND voidedAt IS NULL) AS invoices`, [enterpriseId, row.recordId, enterpriseId, row.recordId, enterpriseId, row.recordId]);
      if (Number(state?.shipped ?? 0) || Number(state?.inbounds ?? 0) || Number(state?.invoices ?? 0)) fail('PRECONDITION_FAILED', 'Purchase orders with goods, inbound links, or invoices require the existing specialized handoff workflow');
    }
    if (row.type === 'inbound_order') {
      const state = await one(connection, `SELECT (SELECT COUNT(*) FROM inbound_payment_entries WHERE enterpriseId = ? AND inboundOrderId = ? AND voidedAt IS NULL) AS payments, (SELECT COUNT(*) FROM inbound_ledger_effects WHERE enterpriseId = ? AND inboundOrderId = ? AND reversedAt IS NULL) AS ledgerEffects`, [enterpriseId, row.recordId, enterpriseId, row.recordId]);
      if (Number(state?.payments ?? 0) || Number(state?.ledgerEffects ?? 0)) fail('PRECONDITION_FAILED', 'Inbound records with payment or stock-ledger effects require the existing specialized handoff workflow');
    }
  }

  async function transferNativeResponsibility(connection, enterpriseId, fromUserId, successorUserId, actorUserId, row) {
    if (row.type === 'inventory') {
      const result = resultHeader(await run(connection, `UPDATE inventories SET ownerUserId = ?, updatedByUserId = ?, ownerAssignedAt = CURRENT_TIMESTAMP, ownershipVersion = ownershipVersion + 1 WHERE enterpriseId = ? AND id = ? AND ownerUserId = ? AND ownershipVersion = ?`, [successorUserId, actorUserId, enterpriseId, row.recordId, fromUserId, row.nativeVersion]));
      if (Number(result.affectedRows ?? 0) !== 1) fail('CONFLICT', 'Inventory responsibility changed during handoff');
      await run(connection, `INSERT INTO inventory_assignment_logs (inventoryId, enterpriseId, previousOwnerUserId, nextOwnerUserId, actorUserId, reason, batchId) VALUES (?, ?, ?, ?, ?, ?, ?)`, [row.recordId, enterpriseId, fromUserId, successorUserId, actorUserId, 'team_member_handoff', null]);
    } else if (row.type === 'customer') {
      const result = resultHeader(await run(connection, `UPDATE crm_customers SET assignedUserId = ?, updatedByUserId = ?, version = version + 1, updatedAt = CURRENT_TIMESTAMP WHERE enterpriseId = ? AND id = ? AND assignedUserId = ? AND version = ?`, [successorUserId, actorUserId, enterpriseId, row.recordId, fromUserId, row.nativeVersion]));
      if (Number(result.affectedRows ?? 0) !== 1) fail('CONFLICT', 'Customer responsibility changed during handoff');
      await run(connection, `INSERT INTO crm_customer_audits (customerId, enterpriseId, actorUserId, action, note, requestId, createdAt) VALUES (?, ?, ?, 'member_handoff', ?, ?, CURRENT_TIMESTAMP)`, [row.recordId, enterpriseId, actorUserId, '团队成员交接；保留客户创建者及跟进作者', null]);
    } else if (row.type === 'channel') {
      const result = resultHeader(await run(connection, `UPDATE channel_inventory_channels SET responsible_user_id = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE enterprise_id = ? AND id = ? AND responsible_user_id = ? AND revision = ?`, [successorUserId, enterpriseId, row.recordId, fromUserId, row.nativeVersion]));
      if (Number(result.affectedRows ?? 0) !== 1) fail('CONFLICT', 'Channel responsibility changed during handoff');
      const materials = await rows(connection, `SELECT id, revision FROM channel_inventory_materials WHERE enterprise_id = ? AND channel_id = ? AND responsible_user_id = ? ORDER BY id ASC FOR UPDATE`, [enterpriseId, row.recordId, fromUserId]);
      const allMaterials = await rows(connection, `SELECT id FROM channel_inventory_materials WHERE enterprise_id = ? AND channel_id = ? ORDER BY id ASC FOR UPDATE`, [enterpriseId, row.recordId]);
      if (materials.length !== allMaterials.length) fail('PRECONDITION_FAILED', 'Channel material responsibility is inconsistent; do not perform a partial handoff');
      if (materials.length) await run(connection, `UPDATE channel_inventory_materials SET responsible_user_id = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE enterprise_id = ? AND channel_id = ? AND responsible_user_id = ?`, [successorUserId, enterpriseId, row.recordId, fromUserId]);
    } else if (transferBlocker(row)) {
      await assertNoOrderSideEffects(connection, enterpriseId, row);
    }
  }

  async function writeAssignmentAudit(connection, event) {
    await run(connection,
      `INSERT INTO ${schema.auditTable} (enterpriseId, recordType, recordId, previousTeamId, nextTeamId, previousOwnerUserId, nextOwnerUserId, actorUserId, reason, requestId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.enterpriseId, event.recordType, event.recordId, event.previousTeamId, event.nextTeamId, event.previousOwnerUserId, event.nextOwnerUserId, event.actorUserId, event.reason, event.requestId]);
  }

  async function transferMember(connection, args) {
    const enterpriseId = positiveInteger(args?.enterpriseId, 'enterpriseId');
    const teamId = positiveInteger(args?.teamId, 'teamId');
    const fromUserId = positiveInteger(args?.fromUserId, 'fromUserId');
    const successorUserId = positiveInteger(args?.successorUserId, 'successorUserId');
    const successorTeamId = positiveInteger(args?.successorTeamId, 'successorTeamId');
    const actorUserId = positiveInteger(args?.actorUserId, 'actorUserId');
    if (fromUserId === successorUserId) fail('BAD_REQUEST', 'Handoff successor must differ from source member');
    if (!['member_removal', 'team_archive'].includes(args?.mode)) fail('BAD_REQUEST', 'Handoff mode is invalid');
    if (args.mode === 'member_removal' && successorTeamId !== teamId) fail('CONFLICT', 'Member removal must keep the frozen record team');
    if (args.mode === 'team_archive' && successorTeamId === teamId) fail('CONFLICT', 'Archive must explicitly transfer to another active team');
    await lockActiveTeam(connection, enterpriseId, teamId);
    await lockActiveTeam(connection, enterpriseId, successorTeamId);
    await lockActorTeamMembership(connection, enterpriseId, successorTeamId, successorUserId);
    const before = await previewRows(connection, enterpriseId, teamId, fromUserId, true);
    if (before.some((row) => row.type === 'inventory_inquiry' && row.nativeStatus !== 'closed')) {
      fail('PRECONDITION_FAILED', '存在未结库存询价；请先执行现有询价交接，不能伪造交接');
    }
    const channelIds = new Set(before.filter((row) => row.type === 'channel').map((row) => Number(row.recordId)));
    if (before.some((row) => row.type === 'channel_material' && !channelIds.has(Number(row.parentRecordId)))) {
      fail('PRECONDITION_FAILED', '渠道物料与渠道负责人不一致；请先在既有渠道流程中纠正，不能独立交接物料');
    }
    const counts = {};
    for (const row of before) {
      // A channel native handoff has already atomically moved every child
      // material's native responsibility.  Its assignment is still updated
      // below with that material's individually locked mapping revision.
      if (row.type !== 'channel_material' && row.type !== 'inventory_inquiry') {
        await transferNativeResponsibility(connection, enterpriseId, fromUserId, successorUserId, actorUserId, row);
      }
      const changed = resultHeader(await run(connection,
        `UPDATE ${schema.table} SET ${schema.teamId} = ?, ${schema.currentOwner} = ?, ${schema.version} = ${schema.version} + 1 WHERE ${schema.id} = ? AND ${schema.enterpriseId} = ? AND ${schema.teamId} = ? AND ${schema.currentOwner} = ? AND ${schema.version} = ?`,
        [successorTeamId, successorUserId, row.assignmentId, enterpriseId, teamId, fromUserId, row.assignmentVersion]));
      if (Number(changed.affectedRows ?? 0) !== 1) fail('CONFLICT', 'Business assignment changed during handoff');
      await writeAssignmentAudit(connection, { enterpriseId, recordType: row.type, recordId: row.recordId, previousTeamId: teamId, nextTeamId: successorTeamId, previousOwnerUserId: fromUserId, nextOwnerUserId: successorUserId, actorUserId, reason: args.mode, requestId: args.requestId });
      counts[row.type] = (counts[row.type] ?? 0) + 1;
    }
    const remaining = await previewRows(connection, enterpriseId, teamId, fromUserId, true);
    if (remaining.length) fail('CONFLICT', 'New or changed business appeared during handoff; refresh the preview');
    return { counts };
  }

  async function assertBootstrapAuthority(connection, enterpriseId, teamId, actorUserId) {
    if (enterpriseId !== bootstrapEnterpriseId) fail('FORBIDDEN', 'Only the explicitly approved enterprise may receive the default-team bootstrap');
    const owner = await one(connection,
      `SELECT e.id, e.superAdminUserId, e.crmDataOwnerUserId, em.id AS memberId, em.role, em.status
         FROM enterprises e
         INNER JOIN enterprise_members em ON em.enterpriseId = e.id AND em.userId = e.superAdminUserId
        WHERE e.id = ? AND e.superAdminUserId = ? LIMIT 1 FOR UPDATE`, [enterpriseId, actorUserId]);
    if (!owner || owner.role !== 'super_admin' || owner.status !== 'active') fail('FORBIDDEN', 'Bootstrap requires the verified active enterprise owner');
    const team = await lockActiveTeam(connection, enterpriseId, teamId);
    if (Number(team.id) !== teamId) fail('CONFLICT', 'Default team changed');
    await lockActorTeamMembership(connection, enterpriseId, teamId, actorUserId);
  }

  async function bootstrapType(connection, definition, enterpriseId, teamId) {
    if (!definition.bootstrap) return 0;
    const bootstrap = definition.bootstrap;
    const selectedTeam = bootstrap.inheritedTeam ?? '?';
    const sql = `INSERT INTO ${schema.table} (${schema.enterpriseId}, ${schema.teamId}, ${schema.recordType}, ${schema.recordKey}, ${schema.originalCreator}, ${schema.currentOwner}, ${schema.version})
      SELECT ?, ${selectedTeam}, '${definition.recordType}', ${bootstrap.recordId}, ${bootstrap.creator}, ${bootstrap.owner}, 1
        FROM ${bootstrap.from}
       WHERE ${bootstrap.where}
      ON DUPLICATE KEY UPDATE ${schema.id} = ${schema.table}.${schema.id}`;
    const placeholderCount = (bootstrap.from.match(/\?/g) ?? []).length + (bootstrap.where.match(/\?/g) ?? []).length;
    const values = [enterpriseId, ...(bootstrap.inheritedTeam ? [] : [teamId]), ...Array(placeholderCount).fill(enterpriseId)];
    const header = resultHeader(await run(connection, sql, values));
    return Number(header.affectedRows ?? 0);
  }

  function confirmedLegacyCreator(args, recordType) {
    const value = args?.confirmedLegacyCreators?.[recordType];
    return value === undefined ? null : positiveInteger(value, `confirmedLegacyCreators.${recordType}`);
  }

  async function bootstrapInbound(connection, enterpriseId, teamId, actorUserId, requestId, confirmedCreator) {
    const definition = recordDefinition('inbound_order');
    const bootstrap = definition.bootstrap;
    if (confirmedCreator !== null) {
      // User confirmation is narrow: only rows whose native stable owner is the
      // confirmed user receive that creator/owner snapshot and default team.
      await lockActorTeamMembership(connection, enterpriseId, teamId, confirmedCreator);
      await run(connection,
        `INSERT INTO ${schema.auditTable} (enterpriseId, recordType, recordId, previousTeamId, nextTeamId, previousOwnerUserId, nextOwnerUserId, actorUserId, reason, requestId)
         SELECT ?, 'inbound_order', r.id, NULL, ?, NULL, ?, ?, 'userconfirmed', ?
           FROM ${bootstrap.from}
          WHERE ${bootstrap.where} AND r.userId = ?
            AND NOT EXISTS (
              SELECT 1 FROM ${schema.table} existing
               WHERE existing.${schema.enterpriseId} = ?
                 AND existing.${schema.recordType} = 'inbound_order'
                 AND existing.${schema.recordKey} = r.id
            )`,
        [enterpriseId, teamId, confirmedCreator, actorUserId, requestId ?? null,
          enterpriseId, enterpriseId, confirmedCreator, enterpriseId]);
    }
    const sql = `INSERT INTO ${schema.table} (${schema.enterpriseId}, ${schema.teamId}, ${schema.recordType}, ${schema.recordKey}, ${schema.originalCreator}, ${schema.currentOwner}, ${schema.version})
      SELECT ?,
             CASE WHEN r.userId = ? THEN ? ELSE NULL END,
             'inbound_order', r.id,
             CASE WHEN r.userId = ? THEN ? ELSE NULL END,
             CASE WHEN r.userId = ? THEN ? ELSE NULL END, 1
        FROM ${bootstrap.from}
       WHERE ${bootstrap.where}
      ON DUPLICATE KEY UPDATE ${schema.id} = ${schema.table}.${schema.id}`;
    const header = resultHeader(await run(connection, sql, [
      enterpriseId, confirmedCreator, teamId,
      confirmedCreator, confirmedCreator, confirmedCreator, confirmedCreator,
      enterpriseId, enterpriseId
    ]));
    return Number(header.affectedRows ?? 0);
  }

  async function initializeAssignments(connection, args) {
    const enterpriseId = positiveInteger(args?.enterpriseId, 'enterpriseId');
    const teamId = positiveInteger(args?.teamId, 'teamId');
    const actorUserId = positiveInteger(args?.actorUserId, 'actorUserId');
    await assertBootstrapAuthority(connection, enterpriseId, teamId, actorUserId);
    let initializedCount = 0;
    for (const type of ['inventory', 'channel', 'customer', 'sales_order', 'purchase_order', 'channel_material', 'inventory_inquiry']) {
      initializedCount += await bootstrapType(connection, recordDefinition(type), enterpriseId, teamId);
    }
    initializedCount += await bootstrapInbound(
      connection, enterpriseId, teamId, actorUserId, args?.requestId,
      confirmedLegacyCreator(args, 'inbound_order')
    );
    const pending = await unassignedCount(connection, enterpriseId);
    return { initializedCount, unassignedCount: pending, revisionMaterial: { enterpriseId, teamId, types: [...RECORD_TYPES], pending } };
  }

  return Object.freeze({ list, detail, previewMember, transferMember, initializeAssignments, registerInsertedRecord, schema });
}

export { TeamBusinessError };
