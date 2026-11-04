import type { BatchEntry } from "./queue";

export type InventoryContext = { expectedEnterpriseId: number; expectedActorUserId: number };
export type InventoryTab = "materials" | "channels" | "batches" | "trash";
export type ReadableInventoryChannel = { id: number; name: string; materialCount?: number; canViewSource?: boolean };
export type ReadableChannelsPage = InventoryPage<ReadableInventoryChannel> & { canBrowseChannels: boolean };
export type UploadBatchRecord = {
  id: number; batchCode: string; name: string | null; fileName: string;
  channelId: number; channelName: string; uploadedByName: string;
  createdAt: Date | string; totalRows: number; successCount: number;
  remainingCount: number; revision: number; archived: boolean;
  // Optional finer-grained server restrictions; never inferred from actor names.
  canEdit?: boolean; canDelete?: boolean; readOnly?: boolean;
};
export type DeletedMaterial = {
  id: number; partNumber: string; brand: string; revision: number;
  deletedAt: Date | string; uploadBatchId: number | null; canRestore: boolean;
};
export type InventoryPage<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number; canWrite?: boolean; readOnly?: boolean };
export type UploadBatchInput = { channelId: number; fileName: string; totalRows: number; requestId: string };
export type UploadBatchReceipt = { id: number; batchCode: string; revision: number };
export type DeleteMaterialRow = { id: number; revision: number; partNumber: string; qty: number | null; canDelete?: boolean; readOnly?: boolean };
type Query<I, O> = { query: (input: I, options?: { signal?: AbortSignal }) => Promise<O> };
type Mutation<I, O> = { mutate: (input: I) => Promise<O> };
/** Temporary local contract over the existing authenticated bridge; no new transport. */
export type InventoryManagementClient = {
  listChannels: Query<InventoryContext & { page: number; pageSize: number; name?: string }, InventoryPage<ReadableInventoryChannel>>;
  listTeamSourceOptions: Query<InventoryContext, { items: ReadableInventoryChannel[]; canFilterSource: boolean }>;
  createUploadBatch: Mutation<InventoryContext & UploadBatchInput, UploadBatchReceipt>;
  deleteMaterials: Mutation<InventoryContext & { items: { id: number; expectedRevision: number }[]; requestId: string }, { deletedCount: number; skippedCount: number; results: { id: number; success: boolean; reason?: string }[] }>;
  listDeletedMaterials: Query<InventoryContext & { page: number; pageSize: number }, InventoryPage<DeletedMaterial>>;
  restoreMaterial: Mutation<InventoryContext & { id: number; expectedRevision: number; requestId: string }, { id: number; restored: true }>;
  listUploadBatches: Query<InventoryContext & { page: number; pageSize: number; channelId?: number; archived?: boolean }, InventoryPage<UploadBatchRecord>>;
  updateUploadBatch: Mutation<InventoryContext & { id: number; expectedRevision: number; name?: string; archived?: boolean; requestId: string }, { id: number; revision: number }>;
  previewDeleteUploadBatch: Query<InventoryContext & { id: number }, { total: number; eligibleCount: number; conflictCount: number; revision: number }>;
  deleteUploadBatch: Mutation<InventoryContext & { id: number; expectedRevision: number; requestId: string }, { deletedCount: number; skippedCount: number }>;
};
export type PersistentUploadBatch = { requestId: string; id?: number; batchCode?: string };
export type ManagedBatchEntry = BatchEntry & { uploadBatchId?: number };
export function inventoryRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, key => {
    const value = Math.floor(Math.random() * 16);
    return (key === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}
export function inventoryError(error: unknown, fallback = "操作失败，请刷新后重试。") {
  return error instanceof Error && error.message ? error.message : fallback;
}
export function inventoryDefinitiveFailure(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  return ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "UNAUTHORIZED"].includes(code ?? "");
}
export function deletableCurrentPage(rows: readonly DeleteMaterialRow[], canWrite: boolean) {
  return canWrite ? rows.filter(row => row.canDelete === true && row.readOnly !== true) : [];
}
