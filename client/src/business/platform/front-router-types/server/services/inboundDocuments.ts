import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import {
  INBOUND_DOCUMENT_ACCESS_SECONDS, INBOUND_DOCUMENT_MAX_BYTES,
  inboundDocumentRefSchema, inboundDocumentsSchema, inboundDocumentUploadSchema, inboundDocumentAccessSchema, inboundDocumentsSaveSchema,
  type InboundDocumentRef, type InboundDocumentUploadInput, type InboundDocumentAccessInput, type InboundDocumentAccess,
  type InboundDocumentScope, type InboundDocumentsSaveInput, type InboundDocumentsSaveResult,
} from "../../../shared/inboundDocuments";
import {
  resolveInboundProcurementAccess, lockInboundProcurementOrder, inboundProcurementWhere,
  type InboundProcurementAccess, type InboundProcurementIdentity, type InboundProcurementExecutor,
} from "./inboundProcurementAccess";
import { storagePutPrivate, storageGetAccessUrl, storageAssertPrivateObjectAvailable } from "../storage";

type Executor = InboundProcurementExecutor;
type Database = Executor & { transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> };
type Metadata = InboundDocumentRef & {
  id: number; enterpriseId: number; ownerUserId: number; uploadedByUserId: number; uploadedByAdminUserId: number;
  bindingVersion: number; teamId: number; staffTeamId: number; uploadScope: string; uploadRequestId: string;
  targetOrderId: number | null; expiresAt: Date | string; revokedAt: Date | string | null;
  associationType: "single" | "bulk" | "edit" | null; associationRequestId: string | null;
  associationBatchId: number | null; boundOrderIds: unknown; orderIds: unknown;
};
export type InboundDocumentAssociation = { type: "single" | "bulk"; clientRequestId: string; batchId?: number; orderIds: number[] };
export type InboundDocumentDependencies = {
  putPrivate: typeof storagePutPrivate; getAccessUrl: typeof storageGetAccessUrl;
  assertAvailable: typeof storageAssertPrivateObjectAvailable;
  resolveAccess: typeof resolveInboundProcurementAccess; lockOrder: typeof lockInboundProcurementOrder;
  now: () => Date; uuid: () => string;
};
const rows = <T>(result: unknown): T[] => {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("Invalid inbound attachment SQL response");
  return result[0];
};
const unavailable = (cause: unknown) => new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "采购附件私有存储或元资料暂不可用，请稍后重试", cause });
const invalid = () => new TRPCError({ code: "BAD_REQUEST", message: "附件不是本次本人成功上传的可用私有文件，或已关联其他单据/批次" });
const missing = () => new TRPCError({ code: "NOT_FOUND", message: "入库单或附件不存在" });
function assertOneUpdate(result: unknown) {
  if (Number((result as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) !== 1)
    throw new TRPCError({ code: "CONFLICT", message: "附件关联已变化，请刷新后重试" });
}
function orderIds(value: unknown): number[] {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(raw) || raw.length > 200 || raw.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(raw).size !== raw.length) throw new Error("Invalid document associations");
  return raw;
}
function sameReference(a: InboundDocumentRef, b: InboundDocumentRef): boolean {
  return a.key === b.key && a.kind === b.kind && a.name === b.name && a.mimeType === b.mimeType && Number(a.size) === Number(b.size);
}
/** Exact base64 + magic, not extension-only checks. No network/file/DB needed. */
export function decodeInboundDocumentBase64(base64: string, mimeType: InboundDocumentRef["mimeType"]): Buffer {
  const match = base64.match(/^data:([^;,]+);base64,([\s\S]*)$/);
  if (base64.startsWith("data:") && (!match || match[1] !== mimeType)) throw invalid();
  const encoded = (match ? match[2] : base64).replace(/\s/g, "");
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalid();
  const data = Buffer.from(encoded, "base64");
  if (!data.length || data.length > INBOUND_DOCUMENT_MAX_BYTES || data.toString("base64") !== encoded) throw invalid();
  const valid = mimeType === "application/pdf"
    ? /^%PDF-(1\.[0-7]|2\.0)/.test(data.subarray(0, 8).toString("ascii")) && /%%EOF\s*$/.test(data.subarray(Math.max(0, data.length - 1024)).toString("latin1"))
    : mimeType === "image/jpeg" ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : mimeType === "image/png" ? data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  if (!valid) throw new TRPCError({ code: "BAD_REQUEST", message: "附件真实格式与声明类型不一致" });
  return data;
}

/** Narrow ABI: build this file + shared schema + existing storage/access helpers only.
 * Dependencies injectable for an old router factory; never wrap create/update/bulk in a second tx. */
export function createInboundDocumentService(overrides: Partial<InboundDocumentDependencies> = {}) {
  const deps: InboundDocumentDependencies = {
    putPrivate: (...args) => storagePutPrivate(...args), getAccessUrl: (...args) => storageGetAccessUrl(...args),
    assertAvailable: (...args) => storageAssertPrivateObjectAvailable(...args),
    resolveAccess: (...args) => resolveInboundProcurementAccess(...args), lockOrder: (...args) => lockInboundProcurementOrder(...args),
    now: () => new Date(), uuid: randomUUID, ...overrides,
  };
  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (error) { if (error instanceof TRPCError) throw error; throw unavailable(error); }
  }
  function assertScope(row: Metadata, access: InboundProcurementAccess) {
    inboundDocumentRefSchema.parse({ kind: row.kind, key: row.key, name: row.name, mimeType: row.mimeType, size: Number(row.size) });
    if (Number(row.enterpriseId) !== access.enterpriseId || Number(row.ownerUserId) !== access.ownerUserId || row.revokedAt) throw missing();
  }
  function assertPending(row: Metadata, access: InboundProcurementAccess, requestId?: string, targetOrderId?: number) {
    assertScope(row, access);
    const peer = access.staffRoster.find(staff => staff.userId === access.actorUserId && staff.adminUserId === access.actorAdminUserId);
    if (!peer || Number(row.uploadedByUserId) !== access.actorUserId || Number(row.uploadedByAdminUserId) !== access.actorAdminUserId
      || Number(row.bindingVersion) !== peer.bindingVersion || Number(row.teamId) !== access.teamId || Number(row.staffTeamId) !== access.staffTeamId
      || row.uploadScope !== access.scope || new Date(row.expiresAt).getTime() <= deps.now().getTime()
      || !Number.isFinite(new Date(row.expiresAt).getTime()) || row.associationType !== null
      || requestId !== undefined && row.uploadRequestId !== requestId || Number(row.targetOrderId ?? 0) !== (targetOrderId ?? 0)) throw invalid();
  }
  async function getMetadata(tx: Executor, key: string, lock = true): Promise<Metadata> {
    const found = rows<Metadata>(await tx.execute(sql`SELECT * FROM inbound_document_objects WHERE \`key\` = ${key} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`));
    if (found.length !== 1) throw invalid();
    return found[0];
  }
  async function accessResult(row: Metadata, scope: InboundDocumentScope = {}, mode: "preview" | "download" = "preview"): Promise<InboundDocumentAccess> {
    await deps.assertAvailable(row.key, { mimeType: row.mimeType, size: Number(row.size) });
    const url = await deps.getAccessUrl(row.key, INBOUND_DOCUMENT_ACCESS_SECONDS, { mode, fileName: row.name });
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("私有附件签名地址无效");
    return { kind: row.kind, key: row.key, name: row.name, mimeType: row.mimeType, size: Number(row.size), url, expiresIn: INBOUND_DOCUMENT_ACCESS_SECONDS, ...scope };
  }
  /** Attachment-only scope: actual visible row and immutable attribution are locked.
   * No NOT_FOUND fallback, no owner/buyer/business-column repair. Financial locks stay unchanged. */
  async function documentOrderScope(tx: Executor, access: InboundProcurementAccess, id: number): Promise<InboundDocumentScope> {
    const visible = rows<{ id: number; userId: number; status: string }>(await tx.execute(sql`SELECT io.id, io.userId, io.status FROM inbound_orders io
      WHERE io.id = ${id} AND ${inboundProcurementWhere(access)} LIMIT 1 FOR UPDATE`));
    if (visible.length !== 1 || Number(visible[0].id) !== id || Number(visible[0].userId) !== access.ownerUserId) throw missing();
    const owners = rows(await tx.execute(sql`SELECT buyerUserId, teamId, enterpriseId, ownerUserId, staffTeamId, buyerAdminUserId FROM inbound_procurement_owners WHERE inboundOrderId = ${id} FOR UPDATE`));
    if (owners.length === 0) {
      if (access.canReadLegacy !== true) throw missing();
      if (!["in_transit", "received"].includes(visible[0].status)) throw new TRPCError({ code: "CONFLICT", message: "当前入库单状态不允许保存或读取附件" });
      return { documentsOnly: true };
    }
    if (owners.length !== 1) throw missing();
    await deps.lockOrder(tx, access, id); // full original modern attribution/current buyer fence; never catch as legacy
    if (!["in_transit", "received"].includes(visible[0].status)) throw new TRPCError({ code: "CONFLICT", message: "当前入库单状态不允许保存或读取附件" });
    return {};
  }
  async function upload(db: Database, identity: InboundProcurementIdentity, raw: InboundDocumentUploadInput): Promise<InboundDocumentAccess> {
    const input = inboundDocumentUploadSchema.parse(raw);
    const data = decodeInboundDocumentBase64(input.base64, input.mimeType);
    // Upload consumes no order/request/stock/payment writes, even when cancelled.
    // If COMMIT is unknown, deleting the private object could destroy committed evidence.
    // Fail without a client reference; leave an inaccessible orphan for later operator review.
    return guarded(() => db.transaction(async tx => {
        const access = await deps.resolveAccess(tx, identity, true);
        if (!access.teamId) throw invalid();
        const scope = input.orderId !== undefined ? await documentOrderScope(tx, access, input.orderId) : {};
        const peer = access.staffRoster.find(staff => staff.userId === access.actorUserId && staff.adminUserId === access.actorAdminUserId);
        if (!peer) throw invalid();
        const extension = input.mimeType === "application/pdf" ? "pdf" : input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/")[1];
        const stored = await deps.putPrivate(`inbound-documents/${access.enterpriseId}/${access.actorUserId}/${deps.uuid()}.${extension}`, data, input.mimeType);
        const ref = inboundDocumentRefSchema.parse({ kind: input.kind, key: stored.key, name: input.fileName, mimeType: input.mimeType, size: data.length });
        const preview = await accessResult(ref as Metadata, scope);
        const expiresAt = new Date(deps.now().getTime() + 24 * 60 * 60 * 1000);
        const inserted = await tx.execute(sql`INSERT INTO inbound_document_objects
          (\`key\`, kind, name, mimeType, size, enterpriseId, ownerUserId, uploadedByUserId, uploadedByAdminUserId,
           bindingVersion, teamId, staffTeamId, uploadScope, uploadRequestId, targetOrderId, expiresAt, boundOrderIds, orderIds)
          VALUES (${ref.key}, ${ref.kind}, ${ref.name}, ${ref.mimeType}, ${ref.size}, ${access.enterpriseId}, ${access.ownerUserId},
            ${access.actorUserId}, ${access.actorAdminUserId}, ${peer.bindingVersion}, ${access.teamId}, ${access.staffTeamId},
            ${access.scope}, ${input.clientRequestId}, ${input.orderId ?? null}, ${expiresAt}, ${JSON.stringify([])}, ${JSON.stringify([])})`);
        if (Number((inserted as Array<{ insertId?: number }>)[0]?.insertId ?? 0) <= 0) throw new Error("附件元资料写入结果缺失");
        return preview;
    }));
  }
  async function associateNewInTx(tx: Executor, access: InboundProcurementAccess, raw: InboundDocumentRef[] | undefined, target: InboundDocumentAssociation) {
    if (!raw?.length) return;
    await guarded(async () => {
      const refs = inboundDocumentsSchema.parse(raw);
      if (!target.orderIds.length || target.orderIds.length > 200 || new Set(target.orderIds).size !== target.orderIds.length
        || target.type === "single" && target.orderIds.length !== 1 || target.type === "bulk" && !target.batchId) throw invalid();
      // All ACTUAL created IDs must still be visible, and a bulk cannot silently select another batch/subset.
      const actual = rows<{ id: number; bulkBatchId: number | null }>(await tx.execute(sql`SELECT io.id, io.bulkBatchId FROM inbound_orders io
        WHERE io.id IN (${sql.join(target.orderIds.map(id => sql`${id}`), sql`, `)}) AND ${inboundProcurementWhere(access)} ORDER BY io.id FOR UPDATE`));
      if (actual.length !== target.orderIds.length || target.type === "bulk" && actual.some(row => Number(row.bulkBatchId) !== target.batchId)) throw missing();
      if (target.type === "bulk") {
        const batchOrders = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM inbound_orders WHERE userId = ${access.ownerUserId} AND bulkBatchId = ${target.batchId!} ORDER BY id FOR UPDATE`));
        if (batchOrders.length !== target.orderIds.length || batchOrders.some(row => !target.orderIds.includes(Number(row.id)))) throw invalid();
      }
      for (const ref of [...refs].sort((a,b) => a.key.localeCompare(b.key))) {
        const row = await getMetadata(tx, ref.key);
        assertPending(row, access, target.clientRequestId);
        if (!sameReference(ref, row)) throw invalid();
        await deps.assertAvailable(row.key, { mimeType: row.mimeType, size: Number(row.size) });
        assertOneUpdate(await tx.execute(sql`UPDATE inbound_document_objects SET associationType = ${target.type}, associationRequestId = ${target.clientRequestId},
          associationBatchId = ${target.batchId ?? null}, boundOrderIds = ${JSON.stringify(target.orderIds)}, orderIds = ${JSON.stringify(target.orderIds)}
          WHERE id = ${row.id} AND associationType IS NULL AND revokedAt IS NULL`));
      }
    });
  }
  async function replaceInTx(tx: Executor, access: InboundProcurementAccess, id: number, raw: InboundDocumentRef[] | undefined) {
    if (raw === undefined) return; // older clients preserve evidence, never implicitly clear
    return guarded(async () => {
      const refs = inboundDocumentsSchema.parse(raw);
      const scope = await documentOrderScope(tx, access, id);
      const existing = rows<Metadata>(await tx.execute(sql`SELECT * FROM inbound_document_objects
        WHERE enterpriseId = ${access.enterpriseId} AND ownerUserId = ${access.ownerUserId}
          AND JSON_CONTAINS(orderIds, ${JSON.stringify(id)}) ORDER BY \`key\` FOR UPDATE`));
      const selected = new Set(refs.map(ref => ref.key));
      // Lock union in stable key order to avoid two edits of a shared batch deadlocking.
      const keys = Array.from(new Set([...existing.map(row => row.key), ...Array.from(selected)])).sort();
      for (const key of keys) {
        const row = await getMetadata(tx, key);
        assertScope(row, access);
        const active = orderIds(row.orderIds);
        const ref = refs.find(item => item.key === key);
        if (ref) {
          if (!sameReference(ref, row)) throw invalid();
          if (row.associationType === null) {
            assertPending(row, access, undefined, id);
            await deps.assertAvailable(row.key, { mimeType: row.mimeType, size: Number(row.size) });
            assertOneUpdate(await tx.execute(sql`UPDATE inbound_document_objects SET associationType = 'edit', associationRequestId = ${row.uploadRequestId},
              boundOrderIds = ${JSON.stringify([id])}, orderIds = ${JSON.stringify([id])} WHERE id = ${row.id} AND associationType IS NULL AND revokedAt IS NULL`));
          } else {
            if (!orderIds(row.boundOrderIds).includes(id)) throw invalid();
            await deps.assertAvailable(row.key, { mimeType: row.mimeType, size: Number(row.size) });
            if (!active.includes(id)) assertOneUpdate(await tx.execute(sql`UPDATE inbound_document_objects SET orderIds = ${JSON.stringify([...active, id].sort((a,b)=>a-b))} WHERE id = ${row.id}`));
          }
        } else if (active.includes(id)) {
          assertOneUpdate(await tx.execute(sql`UPDATE inbound_document_objects SET orderIds = ${JSON.stringify(active.filter(value => value !== id))} WHERE id = ${row.id}`));
        }
      }
      return scope;
    });
  }
  async function save(db: Database, identity: InboundProcurementIdentity, raw: InboundDocumentsSaveInput): Promise<InboundDocumentsSaveResult> {
    const input = inboundDocumentsSaveSchema.parse(raw);
    return guarded(() => db.transaction(async tx => {
      const current = await deps.resolveAccess(tx, identity, true);
      const scope = await replaceInTx(tx, current, input.id, input.documents);
      return { success: true, ...scope };
    }));
  }
  async function list(db: Database, identity: InboundProcurementIdentity, id: number): Promise<InboundDocumentAccess[]> {
    return guarded(() => db.transaction(async tx => {
      const access = await deps.resolveAccess(tx, identity, true);
      const scope = await documentOrderScope(tx, access, id);
      const found = rows<Metadata>(await tx.execute(sql`SELECT * FROM inbound_document_objects
        WHERE enterpriseId = ${access.enterpriseId} AND ownerUserId = ${access.ownerUserId}
          AND revokedAt IS NULL AND JSON_CONTAINS(orderIds, ${JSON.stringify(id)}) ORDER BY kind, id FOR UPDATE`));
      // Validate count/kinds/duplicates without returning persisted metadata internals.
      inboundDocumentsSchema.parse(found.map(row => ({ kind: row.kind, key: row.key, name: row.name, mimeType: row.mimeType, size: Number(row.size) })));
      const result: InboundDocumentAccess[] = [];
      for (const row of found) { assertScope(row, access); if (!orderIds(row.boundOrderIds).includes(id)) throw missing(); result.push(await accessResult(row, scope)); }
      return result;
    }));
  }
  async function access(db: Database, identity: InboundProcurementIdentity, raw: InboundDocumentAccessInput): Promise<InboundDocumentAccess> {
    const input = inboundDocumentAccessSchema.parse(raw);
    return guarded(() => db.transaction(async tx => {
      const current = await deps.resolveAccess(tx, identity, true);
      const targetId = input.id ?? input.orderId;
      const scope = targetId !== undefined ? await documentOrderScope(tx, current, targetId) : {};
      const row = await getMetadata(tx, input.key);
      assertScope(row, current);
      if (input.id !== undefined) {
        if (!row.associationType || !orderIds(row.orderIds).includes(input.id) || !orderIds(row.boundOrderIds).includes(input.id)) throw missing();
      } else assertPending(row, current, input.clientRequestId, input.orderId);
      return accessResult(row, scope, input.mode);
    }));
  }
  return { upload, list, access, save, associateNewInTx, replaceInTx };
}

export const inboundDocumentService = createInboundDocumentService();
