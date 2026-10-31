import { toast } from "sonner";

export const INVENTORY_IMPORT_NOTICE_ID = "inventory-import-notice";

const QUEUED_NOTICE_DURATION_MS = 3_000;

type QueuedInventoryImportNotice = {
  phase: "queued";
  jobId: string;
  rejectedRows: number;
  hasValidRows: boolean;
};

type CompletedInventoryImportNotice = {
  phase: "completed";
  jobId: string;
  createdRows: number;
  updatedRows: number;
  exceptionRows: number;
};

export type InventoryImportNoticeInput =
  | QueuedInventoryImportNotice
  | CompletedInventoryImportNotice;

let dismissTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
const completedJobIds = new Set<string>();

function clearDismissTimer() {
  if (dismissTimer === undefined) return;

  globalThis.clearTimeout(dismissTimer);
  dismissTimer = undefined;
}

function scheduleDismiss(duration: number) {
  dismissTimer = globalThis.setTimeout(() => {
    dismissTimer = undefined;
    toast.dismiss(INVENTORY_IMPORT_NOTICE_ID);
  }, duration);
}

function noticeOptions(duration: number, description?: string) {
  return {
    id: INVENTORY_IMPORT_NOTICE_ID,
    duration,
    description,
    closeButton: true,
    dismissible: true,
    className: "px-3 py-2.5",
  };
}

/** 只显示上传提示；完成结果留在页面原任务区域，不重复弹窗。 */
export function showInventoryImportNotice(input: InventoryImportNoticeInput) {
  if (input.phase === "completed") {
    completedJobIds.add(input.jobId);
    return;
  }

  if (completedJobIds.has(input.jobId)) return;

  clearDismissTimer();
  const duration = QUEUED_NOTICE_DURATION_MS;
  const description = input.rejectedRows > 0
    ? `${input.rejectedRows}条异常，完成后到「待发布」查看`
    : undefined;
  const showNotice = input.hasValidRows ? toast.info : toast.warning;

  showNotice("已上传，后台处理中", noticeOptions(duration, description));
  scheduleDismiss(duration);
}

/** 仅关闭库存导入的固定通知，不会影响页面上的其他 toast。 */
export function dismissInventoryImportNotice() {
  clearDismissTimer();
  toast.dismiss(INVENTORY_IMPORT_NOTICE_ID);
}
