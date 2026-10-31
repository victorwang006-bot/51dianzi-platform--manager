type ValidationIssue = {
  code?: unknown;
  path?: unknown;
  message?: unknown;
  maximum?: unknown;
  minimum?: unknown;
  expected?: unknown;
};

export type InventoryImportFailurePhase = "create" | "staging" | "queue";

const FIELD_LABELS: Record<string, string> = {
  partNumber: "型号 / 料号",
  brand: "品牌",
  category: "分类",
  pkg: "封装",
  dateCode: "生产周期（Date Code）",
  qtyOnSale: "上架数量",
  qtyStock: "实际库存",
  priceEx: "含税单价",
  moq: "起订量（MOQ）",
  spq: "标准包装数量（SPQ）",
  leadTime: "交期",
  warehouseAddress: "仓库地址",
  rohs: "RoHS",
  note: "物料备注",
};

function asValidationIssues(value: unknown): ValidationIssue[] {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === "object") as ValidationIssue[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.issues)) return asValidationIssues(record.issues);
  if (Array.isArray(record.errors)) return asValidationIssues(record.errors);
  return [];
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

const INTERNAL_ERROR = /(?:\b(?:select|insert|update|delete|from|where|sql|drizzle|mysql|postgres|sqlite|stack|trace|errno|er_[a-z0-9_]+)\b|\/(?:home|srv|var|app|api|server|dist|node_modules)(?:\/|$)|[A-Za-z]:\\)/i;

function parseIssues(error: unknown): ValidationIssue[] {
  const trimmed = errorText(error).trim();
  if (!trimmed) return [];
  try {
    return asValidationIssues(JSON.parse(trimmed));
  } catch {
    return [];
  }
}

function getPath(issue: ValidationIssue) {
  return Array.isArray(issue.path) ? issue.path : [];
}

function getFieldKey(issue: ValidationIssue) {
  const path = getPath(issue);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const value = path[index];
    if (typeof value === "string" && value !== "rows") return value;
  }
  return null;
}

function getBatchRowIndex(issue: ValidationIssue) {
  const path = getPath(issue);
  const rowsIndex = path.indexOf("rows");
  const value = rowsIndex >= 0 ? path[rowsIndex + 1] : null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function issueReason(issue: ValidationIssue, fieldKey: string | null) {
  const label = fieldKey ? FIELD_LABELS[fieldKey] ?? "字段" : "数据";
  const code = typeof issue.code === "string" ? issue.code : "";
  const maximum = Number(issue.maximum);
  const minimum = Number(issue.minimum);
  const rawMessage = typeof issue.message === "string" ? issue.message.trim() : "";

  if (code === "too_big" && Number.isFinite(maximum)) {
    const unit = issue.expected === "array" ? "条" : "个字符";
    const guidance = fieldKey === "pkg" ? "，也请确认“封装”是否选择了正确的Excel列" : "";
    return `“${label}”填写过长，最多${maximum}${unit}${guidance}`;
  }
  if (code === "too_small" && Number.isFinite(minimum)) {
    return minimum <= 1 ? `“${label}”不能为空` : `“${label}”至少需要${minimum}个字符`;
  }
  if (code === "invalid_type") {
    if (issue.expected === "number") return `“${label}”格式不正确，请填写数字`;
    if (issue.expected === "string") return `“${label}”格式不正确，请填写文字`;
    return `“${label}”格式不正确`;
  }
  if (rawMessage && /[\u3400-\u9fff]/.test(rawMessage) && !INTERNAL_ERROR.test(rawMessage)) {
    return rawMessage.replace(/[。；;]+$/, "");
  }
  const tooLongMatch = rawMessage.match(/expected string to have <=\s*(\d+) characters/i);
  if (tooLongMatch) return `“${label}”填写过长，最多${tooLongMatch[1]}个字符`;
  return `“${label}”内容不符合要求`;
}

function formatIssue(issue: ValidationIssue, completed: number) {
  const fieldKey = getFieldKey(issue);
  const batchRowIndex = getBatchRowIndex(issue);
  const reason = issueReason(issue, fieldKey);
  if (batchRowIndex === null) return reason;
  const dataRow = completed + batchRowIndex + 1;
  const approximateExcelRow = dataRow + 1;
  return `第${dataRow}条数据（Excel约第${approximateExcelRow}行）的${reason}`;
}

function retryMessage(phase: InventoryImportFailurePhase) {
  if (phase === "queue") {
    return "数据可能已暂存，正在确认后台队列状态。请刷新任务状态，不要重复上传或更换文件。";
  }
  if (phase === "staging") {
    return "暂存上传暂停，请直接再次提交以继续；无需重新选择文件。";
  }
  return "创建导入任务暂未完成，请直接再次提交；无需重新选择文件。";
}

/** Never render SQL, stack traces, paths, or raw infrastructure messages. */
export function safeInventoryImportMessage(
  error: unknown,
  phase: InventoryImportFailurePhase = "create",
) {
  const message = errorText(error).trim();
  if (!message) return retryMessage(phase);
  if (INTERNAL_ERROR.test(message)) {
    return phase === "queue"
      ? "后台队列状态暂时无法确认，请稍后刷新任务状态。"
      : "库存导入服务暂时不可用，请稍后重试；无需重新选择文件。";
  }
  const quota = message.match(/今日库存导入总量最多[0-9,]+条[^。；;]*/);
  if (quota) return `${quota[0].replace(/[。；;]+$/, "")}。无需重新选择文件。`;
  if (/库存服务正在更新/.test(message)) return "库存服务正在更新，请稍后重试；无需重新选择文件。";
  if (/库存导入服务暂时不可用/.test(message)) return "库存导入服务暂时不可用，请稍后重试；无需重新选择文件。";
  if (/当前企业已有库存导入任务|继续上传原文件|任务卡中取消/.test(message)) {
    return "检测到未完成任务，请在任务卡继续原文件；如需更换文件，请先取消旧任务。";
  }
  if (/请求号已用于其他导入任务/.test(message)) return "该提交请求已对应其他导入任务，请刷新任务状态后继续。";
  if (/当前任务已结束暂存|不能继续上传数据/.test(message)) return "任务状态已更新，不能继续暂存。请刷新任务状态，不要重复上传。";
  if (/暂存数据不完整/.test(message)) return "数据尚未全部暂存，暂时不能进入后台队列。请继续暂存当前文件。";
  if (/批次位置超出|批次编号已用于不同数据|Excel 原始行号顺序异常/.test(message)) return "暂存批次与当前任务不一致。请保留当前文件并刷新任务状态后再继续。";
  if (/导入任务不存在/.test(message)) return "导入任务已不可用，请刷新后重新提交。";
  if (/network|failed to fetch|timeout|timed out|网络|超时/i.test(message)) {
    if (phase === "queue") return "后台队列确认连接中断，请刷新任务状态；不要重复上传或更换文件。";
    if (phase === "staging") return "暂存上传连接中断，请直接再次提交以继续；无需重新选择文件。";
    return "创建导入任务的请求尚未确认，请直接再次提交；无需重新选择文件。";
  }
  if (message.length <= 500 && /[\u3400-\u9fff]/.test(message) && !/^[\[{]/.test(message)) {
    return message.replace(/[\r\n]+/g, " ");
  }
  return retryMessage(phase);
}

export function formatInventoryImportFailure(
  error: unknown,
  completed: number,
  total: number,
  phase: InventoryImportFailurePhase = completed > 0 ? "staging" : "create",
) {
  const safeCompleted = Math.max(0, Math.min(total, Math.trunc(completed)));
  const remaining = Math.max(0, total - safeCompleted);
  const progress = safeCompleted === 0
    ? `尚未上传数据，共${total}条待处理。`
    : `已上传${safeCompleted}/${total}条，剩余${remaining}条。`;
  const issues = parseIssues(error);
  if (issues.length === 0) return `${progress}${safeInventoryImportMessage(error, phase)}`;

  const visibleIssues = issues.slice(0, 2).map(issue => formatIssue(issue, safeCompleted));
  const more = issues.length > visibleIssues.length ? `；另有${issues.length - visibleIssues.length}处格式问题` : "";
  return `${progress}${visibleIssues.join("；")}${more}，请修改原文件后重新上传。`;
}

export function formatInventorySubmissionFailure(error: unknown) {
  const issues = parseIssues(error);
  if (issues.length > 0) {
    const visibleIssues = issues.slice(0, 3).map(issue => formatIssue(issue, 0));
    const more = issues.length > visibleIssues.length ? `；另有${issues.length - visibleIssues.length}处格式问题` : "";
    return `${visibleIssues.join("；")}${more}`;
  }

  const message = errorText(error).trim();
  if (/network|failed to fetch|timeout|timed out|网络|超时/i.test(message)) {
    return "网络连接不稳定，请检查网络后重试";
  }
  if (message && /[\u3400-\u9fff]/.test(message) && !/^[\[{]/.test(message) && !INTERNAL_ERROR.test(message)) {
    return message;
  }
  return "物料提交失败，请稍后重试；如仍失败，请联系平台客服";
}
