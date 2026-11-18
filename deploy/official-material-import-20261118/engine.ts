import {
  officialMallBulkSchema, officialMallImportSchema,
  type createOfficialMallService,
} from "../../server/services/officialMall";
import type { OfficialActor } from "../../server/services/officialChannelAccess";
import type { OfficialMallImportResult } from "../../shared/officialMall";
import { ACTOR_ID, TEAM_ID, SCOPE, canonical, hash, requestId, type ImportPlan } from "./input";

type Service = Pick<ReturnType<typeof createOfficialMallService>, "importRows" | "bulkAction" | "requestStatus">;
export type ImportPayload = Parameters<Service["importRows"]>[1];
export type PublishPayload = Parameters<Service["bulkAction"]>[1];
export interface BatchReceipt {
  phase: "import" | "publish";
  index: number;
  requestId: string;
  payload: ImportPayload | PublishPayload;
  payloadHash: string;
  state: "attempting" | "completed" | "failed";
  result?: any;
  failureCode?: string;
}
export interface Checkpoint {
  version: 1;
  scope: typeof SCOPE;
  datasetHash: string;
  sourceHash: string;
  actor: OfficialActor;
  teamId: typeof TEAM_ID;
  baseline: any[];
  imports: BatchReceipt[];
  publications: BatchReceipt[];
  sourceMetadata: { firstIndex: number; ids: number[]; result: unknown }[];
  ids: number[];
  state: "ready" | "running" | "stopped" | "completed";
  failedRequestId?: string;
  completedAt?: string;
  verification?: unknown;
}
export interface ExecutionDependencies {
  service: Service;
  persist: (checkpoint: Checkpoint) => Promise<void>;
  /** Read actual rows and assert stock, quotes, owner/team, status and revision. */
  verifyDrafts: (ids: number[], firstIndex: number) => Promise<{ id: number; expectedRevision: number }[]>;
  /** Separate native-guarded transaction; fixed PK/importKey and exact-payload replay. */
  ensurePrivateMetadata: (ids: number[], firstIndex: number) => Promise<unknown>;
  verifyFinal: (ids: number[]) => Promise<unknown>;
  /** Only an explicit, individually reviewed not_found request may be sent again. */
  retryConfirmedNotFound?: string;
  progress?: (phase: string, completed: number, total: number) => void;
}
export function errorCode(error: unknown): string {
  // No driver messages/stacks: they can contain DSNs, SQL or sensitive parameters.
  const code = (error as any)?.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "EXECUTION_STOPPED";
}
function normalizedResult(result: any) {
  if (!result || typeof result !== "object") return result;
  const { idempotent: _ignored, ...body } = result;
  return body;
}
export function assertImportSuccess(result: OfficialMallImportResult, count: number) {
  if (!result || result.success !== true || result.imported !== count || result.updated !== 0 || result.skipped !== 0 ||
      !Array.isArray(result.errors) || result.errors.length !== 0 || !Array.isArray(result.ids) || result.ids.length !== count ||
      new Set(result.ids).size !== count || result.ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) {
    throw Error("IMPORT_PARTIAL_OR_INVALID_RECEIPT");
  }
}
function assertPublishSuccess(result: any, count: number) {
  if (!result || result.success !== true || result.successful !== count || !Array.isArray(result.errors) || result.errors.length) {
    throw Error("PUBLICATION_PARTIAL_OR_INVALID_RECEIPT");
  }
}

export async function executePlan(plan: ImportPlan, checkpoint: Checkpoint, deps: ExecutionDependencies) {
  if (checkpoint.version !== 1 || checkpoint.scope !== SCOPE || checkpoint.datasetHash !== plan.datasetHash ||
      checkpoint.actor.adminUserId !== ACTOR_ID || checkpoint.teamId !== TEAM_ID ||
      !Number.isSafeInteger(checkpoint.actor.sessionVersion) || checkpoint.actor.sessionVersion < 1) throw Error("CHECKPOINT_CONTEXT_MISMATCH");
  // Partial native results are committed facts, not instructions to blindly rerun failed rows.
  if ([...checkpoint.imports, ...checkpoint.publications].some(receipt => receipt.state === "failed")) throw Error("COMMITTED_PARTIAL_RECEIPT_REQUIRES_MANUAL_REVIEW");
  const actor = checkpoint.actor;
  checkpoint.state = "running";
  await deps.persist(checkpoint);

  async function batch(phase: "import" | "publish", index: number, body: any, count: number) {
    const receipts = phase === "import" ? checkpoint.imports : checkpoint.publications;
    const id = requestId(plan, phase, index, body);
    const payload = phase === "import"
      ? officialMallImportSchema.parse({ ...body, requestId: id })
      : officialMallBulkSchema.parse({ ...body, requestId: id });
    let receipt = receipts[index];
    const validate = (result: any) => phase === "import" ? assertImportSuccess(result, count) : assertPublishSuccess(result, count);
    const invoke = () => phase === "import"
      ? deps.service.importRows(actor, payload as ImportPayload)
      : deps.service.bulkAction(actor, payload as PublishPayload);
    if (receipt) {
      if (receipt.index !== index || receipt.phase !== phase || receipt.requestId !== id ||
          receipt.payloadHash !== hash(payload) || canonical(receipt.payload) !== canonical(payload)) throw Error("CHECKPOINT_BATCH_MISMATCH");
      const native = await deps.service.requestStatus(actor, { requestId: id });
      if (receipt.state === "completed") {
        if (native.state !== "completed" || canonical(normalizedResult(native.result)) !== canonical(normalizedResult(receipt.result))) throw Error("NATIVE_RECEIPT_MISMATCH");
        validate(receipt.result);
        return receipt.result;
      }
      if (native.state === "pending") throw Error("NATIVE_REQUEST_PENDING_DO_NOT_RESEND");
      if (native.state === "not_found" && deps.retryConfirmedNotFound !== id) throw Error("NATIVE_NOT_FOUND_REQUIRES_EXPLICIT_INDIVIDUAL_REVIEW");
      // Completed but locally ambiguous: exact native replay verifies action/hash/current authority.
      // Not found: only operator-confirmed single request, still with its ORIGINAL fixed ID/body.
    } else {
      if (receipts.length !== index) throw Error("CHECKPOINT_RECEIPT_GAP");
      receipt = { phase, index, requestId: id, payload, payloadHash: hash(payload), state: "attempting" };
      receipts.push(receipt);
      // Fsync original request BEFORE its first invocation: ambiguity is never lost on a crash.
      await deps.persist(checkpoint);
    }
    let result: any;
    try { result = await invoke(); } catch (error) {
      receipt.failureCode = errorCode(error);
      checkpoint.state = "stopped"; checkpoint.failedRequestId = id;
      await deps.persist(checkpoint);
      throw error;
    }
    receipt.result = result;
    receipt.state = "completed";
    try { validate(result); } catch (error) {
      receipt.state = "failed";
      receipt.failureCode = phase === "import" ? "IMPORT_PARTIAL_OR_INVALID_RECEIPT" : "PUBLICATION_PARTIAL_OR_INVALID_RECEIPT";
      checkpoint.state = "stopped"; checkpoint.failedRequestId = id;
      await deps.persist(checkpoint);
      throw error;
    }
    // Store the committed result (including all new IDs) BEFORE any next batch.
    await deps.persist(checkpoint);
    return result;
  }

  try {
    const ids: number[] = [];
    for (let start = 0, index = 0; start < plan.rows.length; start += 500, index++) {
      const rows = plan.rows.slice(start, start + 500);
      const result = await batch("import", index, { rows, teamId: TEAM_ID }, rows.length);
      ids.push(...result.ids);
      if (new Set(ids).size !== ids.length || ids.some(id => checkpoint.baseline.some(row => row.id === id))) throw Error("IDS_DUPLICATED_OR_BASELINE_OVERLAP");
      checkpoint.ids = [...ids];
      await deps.persist(checkpoint);
      const metadata = await deps.ensurePrivateMetadata(result.ids, start);
      checkpoint.sourceMetadata[index] = { firstIndex: start, ids: result.ids, result: metadata };
      await deps.persist(checkpoint);
      deps.progress?.("import", ids.length, plan.rows.length);
    }
    if (ids.length !== plan.rows.length) throw Error("FINAL_IMPORT_COUNT_MISMATCH");
    for (let start = 0, index = 0; start < ids.length; start += 100, index++) {
      const selected = ids.slice(start, start + 100);
      const saved = checkpoint.publications[index];
      let items: { id: number; expectedRevision: number }[];
      if (saved) {
        items = (saved.payload as PublishPayload).items;
        if (canonical(items.map(item => item.id)) !== canonical(selected) || items.some(item => item.expectedRevision !== 1)) throw Error("PUBLICATION_ITEMS_MISMATCH");
      } else {
        items = await deps.verifyDrafts(selected, start);
        if (canonical(items.map(item => item.id)) !== canonical(selected) || items.some(item => item.expectedRevision !== 1)) throw Error("DRAFT_REVISION_OR_ORDER_MISMATCH");
      }
      await batch("publish", index, { action: "publish", items }, selected.length);
      deps.progress?.("publish", start + selected.length, ids.length);
    }
    checkpoint.verification = await deps.verifyFinal(ids);
    checkpoint.state = "completed";
    checkpoint.completedAt = new Date().toISOString();
    delete checkpoint.failedRequestId;
    await deps.persist(checkpoint);
    return checkpoint;
  } catch (error) {
    checkpoint.state = "stopped";
    await deps.persist(checkpoint);
    throw error;
  }
}
