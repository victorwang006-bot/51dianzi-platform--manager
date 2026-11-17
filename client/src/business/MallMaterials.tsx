import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import type { OfficialMallAccess, OfficialMallMaterial, OfficialMallMaterialInput, OfficialMallMutationResult, OfficialMallStatus, OfficialMallPreviewRow, OfficialMallImportResult, OfficialMallImportRow, OfficialMallDuplicatePolicy } from "@shared/officialMall";
import { OFFICIAL_MALL_SUGGEST_MIN_CHARS, OFFICIAL_MALL_SUGGEST_DEBOUNCE_MS, officialMallCreateTeam } from "@shared/officialMallSuggestPolicy";
import { applySuggestion, chunks, clearRequestHold, emptyForm, errorMessage, errorRowsCsv, firstEligibleQuote, formData, formFor, IMPORT_BATCH_SIZE, IMPORT_COLUMNS, isBusinessRejection, MAX_IMPORT_BYTES, parseImportFile, parseImportText, publishProblem, readRequestHold, rowsFromTable, storeRequestHold, templateCsv, validMutationResult, validQuoteTiers } from "@/lib/officialMallImport";
import type { Form, ImportField, ParsedImportRow, ParsedTable, RequestHold } from "@/lib/officialMallImport";
import { useAdminNewInformationContextRows, type AdminNewInformationRowPresentation } from "@/lib/adminNewInformation";
import { AdminNewInformationRowBadge } from "@/components/admin/AdminNewInformationBadge";
import "./MallMaterials.css";

// Retained helper entry points now use the native, exact-decimal contract.
export { emptyForm, formData, firstEligibleQuote, parseTiers, validQuoteTiers } from "@/lib/officialMallImport";
export type { Form, Tier } from "@/lib/officialMallImport";
type Mode = "manual" | "sheet" | "paste";
type Action = "publish" | "offshelf";
type Dialog = { kind: "create" | "edit" | Action | "bulk"; scopeKey: string; row?: OfficialMallMaterial; action?: Action; items?: OfficialMallMaterial[] };
interface BulkResult { success: boolean; successful: number; errors: { id: number; message: string }[]; idempotent?: boolean; }
type WriteResult = OfficialMallMutationResult | BulkResult | OfficialMallImportResult;
interface PreviewEntry extends ParsedImportRow {
  preview?: OfficialMallPreviewRow; confirmed: boolean; policy: OfficialMallDuplicatePolicy;
  duplicateId?: number; expectedRevision?: number; outcome: "ready" | "success" | "skipped" | "failed";
}
const statusNames: Record<OfficialMallStatus, string> = { draft: "待上架", published: "已上架", offshelf: "已下架" };
const count = (value: number | null | undefined) => value == null ? "未知" : value.toLocaleString("en-US");
const money = (value: string | null | undefined) => value == null ? "面议" : `¥${value}`;
const modeNames: Record<Mode, string> = { manual: "手工录入", sheet: "表格导入", paste: "粘贴识别" };
function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
/** Private reads bypass shared tRPC query keys; only this generation can settle. */
function useNativeRead<T>(key: string, enabled: boolean, fetch: (signal: AbortSignal) => Promise<T>) {
  const fetchRef = useRef(fetch); fetchRef.current = fetch;
  const [epoch, setEpoch] = useState(0);
  const identity = `${key}:${enabled}:${epoch}`;
  const scopeIdentity = `${key}:${enabled}`;
  const current = useRef({ identity, scopeIdentity, generation: 0, scopeGeneration: 0 });
  if (current.current.identity !== identity) current.current = { identity, scopeIdentity, generation: current.current.generation + 1, scopeGeneration: current.current.scopeGeneration + (current.current.scopeIdentity === scopeIdentity ? 0 : 1) };
  const generation = current.current.generation, scopeGeneration = current.current.scopeGeneration;
  const [result, setResult] = useState<{ key: string; generation: number; scopeGeneration: number; data?: T; error?: unknown }>({ key: "", generation: -1, scopeGeneration: -1 });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const active = () => !controller.signal.aborted && current.current.generation === generation;
    void fetchRef.current(controller.signal).then(data => { if (active()) setResult({ key, generation, scopeGeneration, data }); }, error => { if (active()) setResult({ key, generation, scopeGeneration, error }); });
    return () => controller.abort();
  }, [identity]);
  const sameScope = enabled && result.key === key && result.scopeGeneration === scopeGeneration;
  const error = sameScope && result.generation === generation ? result.error : undefined;
  const data = sameScope && !error ? result.data : undefined;
  return { data, error, isSuccess: enabled && result.generation === generation && data !== undefined && !error, isPlaceholderData: false, isError: !!error, isFetching: enabled && result.generation !== generation, isLoading: enabled && !data && !error, refetch: () => setEpoch(n => n + 1) };
}
type MallNewInformationRowsProps = {
  rows: OfficialMallMaterial[];
  listReady: boolean;
  children: (pageRows: OfficialMallMaterial[], getRow?: (id: string) => AdminNewInformationRowPresentation) => ReactNode;
};
function MallNewInformationRowsHook(props: MallNewInformationRowsProps) {
  const information = useAdminNewInformationContextRows({
    module: "mall",
    refs: props.listReady ? props.rows.map(row => `mall-material:${row.id}`) : [],
    listReady: props.listReady,
  });
  // Stable partition of ONLY this original page; never prefetch other pages to sort.
  const pageRows = [...props.rows].sort((a, b) => Number(information.getRow(`mall-material:${b.id}`).isNew) - Number(information.getRow(`mall-material:${a.id}`).isNew));
  return <>{props.children(pageRows, information.getRow)}</>;
}
/** Standalone native page remains usable when the owning layout has no provider.
 * Catch ONLY the shared hook's missing-provider error; business/render failures propagate.
 * Keep the hook in its own component, not a conditional or try/catch hook call.
 */
class MallNewInformationRows extends Component<MallNewInformationRowsProps, { noProvider: boolean }> {
  state = { noProvider: false };
  static getDerivedStateFromError(error: unknown) {
    if (error instanceof Error && error.message === "新信息组件须在 AdminNewInformationProvider 内使用") return { noProvider: true };
    throw error;
  }
  render() {
    return this.state.noProvider ? <>{this.props.children(this.props.rows)}</> : <MallNewInformationRowsHook {...this.props}/>;
  }
}
function entryProblem(entry: PreviewEntry): string | null {
  if (entry.errors.length) return entry.errors.join("；");
  if (!entry.data || !entry.preview) return "尚未完成服务端校验";
  if (entry.policy === "update" && entry.preview.duplicates.length && (!entry.duplicateId || !entry.expectedRevision)) return "请选择待更新的重复记录及版本";
  if (entry.policy === "new" && entry.preview.duplicates.some(d => d.dateCode === entry.data?.dateCode)) return "另建批次须人工填写不同批次，再校验";
  return null;
}
function Quote({ row }: { row: OfficialMallMaterialInput }) {
  const tiers = validQuoteTiers(row), first = firstEligibleQuote(row);
  const tax = row.taxIncluded == null ? "税口径未知 · 仅询价" : row.taxIncluded ? "含税" : "未税 · 仅询价";
  return <div className="mall-quote"><span className="mall-quote-main">{first ? `${count(first.quantity)}件 · ${money(first.price)}` : "报价须核对"}</span>{tiers.length ? <details><summary>梯度价 · {tiers.length}档 · {tax}</summary><div className="mall-quote-tiers"><span>基础价　{money(row.priceEx)}</span>{tiers.map((tier, i) => <span key={i}>{count(tier.minQty)}+　{money(tier.price)}</span>)}<small>默认单量1件，按MOQ / 包装倍数适配</small><small>MOQ {count(row.moq)} · 包装倍数 {count(row.spq)}</small></div></details> : <small>{tax} · MOQ {count(row.moq)} / SPQ {count(row.spq)}</small>}</div>;
}
const formFields = [["partNumber", "型号", 128], ["brand", "品牌", 128], ["pkg", "封装", 128], ["dateCode", "批次/DC", 64], ["qtyOnSale", "可售数量", 32], ["qtyStock", "实际库存（未知留空）", 32], ["qtyOrder", "订货数量（未知留空）", 32], ["leadTime", "货期", 128], ["priceEx", "基础单价（面议留空）", 32], ["moq", "MOQ（未知留空）", 32], ["spq", "包装倍数（未知留空）", 32]] as const;
function FormEditor({ form, onChange, disabled, suggestions }: { form: Form; onChange: (form: Form) => void; disabled: boolean; suggestions?: React.ReactNode }) {
  return <fieldset className="mall-form" disabled={disabled}>
    {formFields.map(([key, label, maxLength]) => <label key={key}>{label}<input aria-label={label} value={form[key]} maxLength={maxLength} autoComplete="off" inputMode={["qtyOnSale", "qtyStock", "qtyOrder", "moq", "spq"].includes(key) ? "numeric" : key === "priceEx" ? "decimal" : undefined} onChange={e => onChange({ ...form, [key]: e.target.value })}/>{key === "partNumber" ? suggestions : null}</label>)}
    <label>税口径<select aria-label="税口径" value={form.taxIncluded == null ? "" : form.taxIncluded ? "true" : "false"} onChange={e => onChange({ ...form, taxIncluded: e.target.value === "" ? null : e.target.value === "true" })}><option value="">未知 / 待确认</option><option value="true">含税</option><option value="false">未税</option></select></label>
    <fieldset className="mall-tiers"><legend>梯度报价（最多10档）</legend><p className="mall-hint">数量及单价成对填写，数量严格递增；单价最多6位小数，按原精度保存。</p>{form.tiers.map((tier, i) => <div className="mall-tier-row" key={i}><label>数量<input aria-label={`第${i + 1}档数量`} inputMode="numeric" value={tier.minQty} onChange={e => onChange({ ...form, tiers: form.tiers.map((t, j) => j === i ? { ...t, minQty: e.target.value } : t) })}/></label><span>+</span><label>单价<input aria-label={`第${i + 1}档单价`} inputMode="decimal" value={tier.price} onChange={e => onChange({ ...form, tiers: form.tiers.map((t, j) => j === i ? { ...t, price: e.target.value } : t) })}/></label><button type="button" aria-label={`删除第${i + 1}档`} onClick={() => onChange({ ...form, tiers: form.tiers.filter((_, j) => j !== i) })}>删除</button></div>)}<button type="button" disabled={disabled || form.tiers.length >= 10} onClick={() => onChange({ ...form, tiers: [...form.tiers, { minQty: "", price: "" }] })}>增加档位</button></fieldset>
    <label className="mall-wide">内部备注<textarea aria-label="内部备注" maxLength={2000} value={form.note} onChange={e => onChange({ ...form, note: e.target.value })}/></label><p className="mall-wide mall-hint">数量未知保持空值，基础价为空表示面议；保存为待上架，不自动发布。上架须明确可售或订货数量及货期；税口径未知或未税时保留真实报价，仅供询价。</p>
  </fieldset>;
}

/** Plain native page: the owning App supplies its native gate and layout. */
export default function MallMaterials(_props?: unknown) {
  const auth = useAuth();
  const signedIn = auth.isAuthenticated && !auth.loading && !auth.error && auth.user?.hasNativeAdminAccount === true;
  const utils = trpc.useUtils();
  const authScope = useRef({ user: auth.user, signedIn, generation: 0 });
  if (authScope.current.user !== auth.user || authScope.current.signedIn !== signedIn) authScope.current = { user: auth.user, signedIn, generation: authScope.current.generation + 1 };
  const authKey = `${auth.user?.id ?? "anonymous"}:${authScope.current.generation}`;
  const status = useNativeRead(authKey, signedIn, signal => utils.client.officialMall.status.query(undefined, { signal }));
  const access: OfficialMallAccess | undefined = status.data;
  const canRead = signedIn && !status.isError && access?.available === true && access.permissions.read && access.scope.adminUserId === auth.user?.id;
  const canWrite = canRead && access?.permissions.write === true;
  const canPublish = canRead && access?.permissions.publish === true;
  const scopeKey = `${auth.user?.id ?? "anonymous"}:${access?.scope.teamId ?? "none"}`;
  const permissionKey = `${authKey}:${scopeKey}:${canRead}:${canWrite}:${canPublish}`;
  const latest = useRef(permissionKey); latest.current = permissionKey;
  const authority = useRef({ canWrite, canPublish }); authority.current = { canWrite, canPublish };
  const [partNumber, setPartNumber] = useState(""); const [brand, setBrand] = useState("");
  const [filters, setFilters] = useState({ partNumber: "", brand: "" });
  const [state, setState] = useState<"" | OfficialMallStatus>(""); const [page, setPage] = useState(1);
  const listInput = { partNumber: filters.partNumber || undefined, brand: filters.brand || undefined, status: state || undefined, page, pageSize: 30 };
  const list = useNativeRead(`${permissionKey}:${JSON.stringify(listInput)}`, canRead, signal => utils.client.officialMall.list.query(listInput, { signal }));
  const rows: OfficialMallMaterial[] = canRead ? list.data?.items ?? [] : [];
  const listReady = canRead && status.isSuccess && !status.isError && !status.isFetching && !status.isPlaceholderData && list.isSuccess && !list.isError && !list.isFetching && !list.isPlaceholderData;
  const [selected, setSelected] = useState<OfficialMallMaterial[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null); const [mode, setMode] = useState<Mode>("manual");
  const [form, setForm] = useState<Form>(emptyForm); const [teamId, setTeamId] = useState<number | undefined>();
  const createTeam = officialMallCreateTeam(access, teamId);
  const effectiveTeamId = createTeam.teamId;
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const rejectionRef = useRef("");
  const [storedHold, setHold] = useState<RequestHold | null>(null);
  const hold = signedIn && storedHold?.scopeKey.split(":")[0] === String(auth.user?.id) ? storedHold : null; const holdRef = useRef<RequestHold | null>(null);
  const memoryHolds = useRef(new Map<string, RequestHold>());
  const [table, setTable] = useState<ParsedTable | null>(null); const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [paste, setPaste] = useState(""); const [entries, setEntries] = useState<PreviewEntry[]>([]);
  const [editingRow, setEditingRow] = useState<number | null>(null); const [rowForm, setRowForm] = useState<Form>(emptyForm);
  const [importing, setImporting] = useState(false); const importingRef = useRef(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [importTotals, setImportTotals] = useState({ imported: 0, updated: 0, skipped: 0 });
  const [suggestQuery, setSuggestQuery] = useState("");
  const [suggestBrand, setSuggestBrand] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setSuggestQuery(form.partNumber.trim()); setSuggestBrand(form.brand.trim()); }, OFFICIAL_MALL_SUGGEST_DEBOUNCE_MS); return () => clearTimeout(timer); }, [form.partNumber, form.brand]);
  const suggesting = canWrite && !!dialog && (dialog.kind === "edit" || dialog.kind === "create" && mode === "manual") && suggestQuery.length >= OFFICIAL_MALL_SUGGEST_MIN_CHARS && suggestQuery === form.partNumber.trim() && suggestBrand === form.brand.trim();
  const suggestInput = { query: suggestQuery, brand: suggestBrand || undefined };
  const suggestions = useNativeRead(`${permissionKey}:${JSON.stringify(suggestInput)}`, suggesting, signal => utils.client.officialMall.suggest.query(suggestInput, { signal }));
  useEffect(() => {
    const saved = readRequestHold(scopeKey) ?? memoryHolds.current.get(scopeKey.split(":")[0]) ?? null; holdRef.current = saved; setHold(saved);
    setDialog(null); setSelected([]); setForm(emptyForm()); setEntries([]); setTable(null); setEditingRow(null);
    setError(""); setNotice(""); setTeamId(undefined); setSuggestQuery(""); setImportTotals({ imported: 0, updated: 0, skipped: 0 });
  }, [authKey, scopeKey]);
  useEffect(() => { setDialog(null); setSelected([]); }, [permissionKey]);
  useEffect(() => { setSelected([]); }, [filters, state, page]);
  useEffect(() => { const focus = () => status.refetch(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [authKey]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>(".mall-dialog"); panel?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current && !importingRef.current && !holdRef.current) setDialog(null);
      if (event.key !== "Tab" || !panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [!!dialog]);
  const refresh = () => { status.refetch(); list.refetch(); };
  const locked = busy || importing || !!hold || !canRead;
  const setRequest = (request: RequestHold) => { memoryHolds.current.set(request.scopeKey.split(":")[0], request); storeRequestHold(request); holdRef.current = request; setHold(request); };
  const clearRequest = () => { memoryHolds.current.delete(scopeKey.split(":")[0]); clearRequestHold(scopeKey); const next = readRequestHold(scopeKey); holdRef.current = next; setHold(next); };
  async function runWrite<T extends WriteResult>(kind: RequestHold["kind"], send: (requestId: string) => Promise<T>, settled: (result: T) => void, expected: Pick<RequestHold, "rowNumbers" | "bulkIds" | "expectedId"> = {}): Promise<"completed" | "rejected" | "unknown"> {
    if (busyRef.current || holdRef.current) return "unknown";
    const lease = permissionKey;
    const request: RequestHold = { requestId: crypto.randomUUID(), kind, scopeKey, originalTeamId: (kind === "create" || kind === "import" ? effectiveTeamId : undefined) ?? access?.scope.teamId, proof: true, ...expected };
    setRequest(request); busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await send(request.requestId);
      if (latest.current !== lease) return "unknown";
      const complete = validMutationResult(result, request);
      if (!complete) throw new Error("服务端响应不完整，保留UUID核对原请求");
      clearRequest(); settled(result); refresh();
      if (!result.success && "message" in result) setError(result.message ?? "本次业务操作未成功，请刷新核对");
      return "completed";
    } catch (cause) {
      if (latest.current !== lease) return "unknown";
      const message = errorMessage(cause); setError(message);
      if (isBusinessRejection(cause)) {
        rejectionRef.current = message;
        clearRequest(); refresh(); setSelected([]);
        if (kind !== "import") setDialog(null);
        setNotice(message); // Preserve the server's precise business refusal; no automatic retry.
        return "rejected";
      }
      setNotice(`${message}；结果未知，已停止后续提交，请核对原UUID。`);
      return "unknown";
    } finally { busyRef.current = false; setBusy(false); }
  }
  function settleImport(result: OfficialMallImportResult, rowNumbers: number[]) {
    const failures = new Map(result.errors.map(e => [e.rowNumber, e.message]));
    setEntries(current => current.map(entry => {
      if (!rowNumbers.includes(entry.rowNumber)) return entry;
      const message = failures.get(entry.rowNumber);
      return message ? { ...entry, outcome: "failed", confirmed: false, errors: [message] } : { ...entry, outcome: "success", confirmed: false, errors: [] };
    }));
    setProgress(current => ({ ...current, completed: current.completed + rowNumbers.length }));
    setImportTotals(current => ({ imported: current.imported + result.imported, updated: current.updated + result.updated, skipped: current.skipped + result.skipped }));
    setNotice(`本批新增 ${result.imported}、更新 ${result.updated}、跳过 ${result.skipped}、失败 ${result.errors.length}；均未自动上架。`);
  }
  async function inspectRequest() {
    if (!hold || !canRead || busyRef.current) return;
    const request = hold, lease = permissionKey; busyRef.current = true; setBusy(true);
    try {
      const receipt = await utils.client.officialMall.requestStatus.query({ requestId: request.requestId });
      if (latest.current !== lease) return;
      if (receipt.state !== "completed") { setNotice(receipt.state === "not_found" ? "尚未找到回执不代表未执行。保留原UUID，继续停止，不会重发。" : "原请求仍在处理中，保留UUID并停止后续批次。"); return; }
      const result: unknown = receipt.result;
      if (!validMutationResult(result, request)) { setNotice("原请求回执尚不完整或缺少原请求覆盖证明，继续保留UUID；请管理员核对，未重发。"); return; }
      if (request.kind === "import") {
        settleImport(result as OfficialMallImportResult, request.rowNumbers!);
      } else if (request.kind === "bulk") {
        const bulk = result as BulkResult;
        setNotice(`原请求已完成：成功 ${bulk.successful}，失败 ${bulk.errors.length}${bulk.errors.length ? "；" + bulk.errors.map(e => `ID ${e.id}：${e.message}`).join("；") : ""}`);
      } else {
        setNotice("已核对原请求回执，请刷新查看物料；未重发或自动上架。");
      }
      clearRequest(); setSelected([]); if (request.kind !== "import") setDialog(null); refresh();
    } catch (cause) { if (latest.current === lease) setNotice(`${errorMessage(cause)}；核对失败，仍保留原UUID。`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function open(kind: Dialog["kind"], row?: OfficialMallMaterial, action?: Action) {
    if (locked || (kind === "create" || kind === "edit") && !canWrite || (kind === "publish" || kind === "offshelf" || kind === "bulk") && !canPublish) return;
    if (kind === "edit" && row?.status === "published") { setNotice("已上架物料请先下架，再编辑并重新确认上架。"); return; }
    setError(""); setForm(row ? formFor(row) : emptyForm()); setEditingRow(null);
    if (kind === "create") { setMode("manual"); setEntries([]); setTable(null); setPaste(""); setProgress({ completed: 0, total: 0 }); setImportTotals({ imported: 0, updated: 0, skipped: 0 }); }
    setDialog({ kind, row: row && { ...row }, action, items: kind === "bulk" ? selected.map(r => ({ ...r })) : undefined, scopeKey });
  }
  const currentRow = (row: OfficialMallMaterial) => rows.find(r => r.id === row.id && r.revision === row.revision && r.status === row.status);
  const staleDialog = !!dialog && (dialog.scopeKey !== scopeKey || !!dialog.row && !currentRow(dialog.row) || !!dialog.items?.some(r => !currentRow(r)));
  async function submitDialog() {
    if (!dialog || locked || staleDialog) return;
    try {
      if (dialog.kind === "create" || dialog.kind === "edit") {
        if (!authority.current.canWrite) return;
        if (dialog.kind === "create" && createTeam.problem) throw new Error(createTeam.problem);
        const data = formData(form);
        if (dialog.kind === "create") await runWrite("create", requestId => utils.client.officialMall.create.mutate({ requestId, data, ...(effectiveTeamId ? { teamId: effectiveTeamId } : {}) }), result => {
          if (result.success) { setNotice("物料已保存到待上架；未自动发布。"); setDialog(null); }
        });
        else {
          const row = dialog.row; if (!row || !currentRow(row)) throw new Error("物料版本已变化，请刷新重新选择");
          await runWrite("update", requestId => utils.client.officialMall.update.mutate({ id: row.id, expectedRevision: row.revision, requestId, data }), result => { if (result.success) { setNotice("草稿已保存，未自动上架。"); setDialog(null); } }, { expectedId: row.id });
        }
      } else {
        if (!authority.current.canPublish) return;
        const action = dialog.kind === "bulk" ? dialog.action : dialog.kind;
        if (action !== "publish" && action !== "offshelf") return;
        const targets = dialog.kind === "bulk" ? dialog.items ?? [] : dialog.row ? [dialog.row] : [];
        if (!targets.length || targets.length > 100) throw new Error("请选择1至100条物料");
        for (const row of targets) {
          if (!currentRow(row)) throw new Error(`物料 ${row.partNumber} 版本已变化，请刷新重新选择`);
          if (action === "publish") { const problem = publishProblem(row); if (problem) throw new Error(`${row.partNumber}：${problem}`); }
        }
        if (dialog.kind === "bulk") await runWrite("bulk", requestId => utils.client.officialMall.bulkAction.mutate({ action, requestId, items: targets.map(r => ({ id: r.id, expectedRevision: r.revision })) }), result => {
          setNotice(`批量${action === "publish" ? "上架" : "下架"}：成功 ${result.successful}，失败 ${result.errors.length}${result.errors.length ? "；" + result.errors.map(e => `ID ${e.id}：${e.message}`).join("；") : ""}`);
          setSelected([]); setDialog(null);
        }, { bulkIds: targets.map(r => r.id) });
        else await runWrite(action, requestId => {
          const input = { id: targets[0].id, expectedRevision: targets[0].revision, requestId };
          return action === "publish" ? utils.client.officialMall.publish.mutate(input) : utils.client.officialMall.offshelf.mutate(input);
        }, result => { if (result.success) { setNotice(action === "publish" ? "物料已确认上架。" : "物料已下架，原订单不变。"); setDialog(null); } }, { expectedId: targets[0].id });
      }
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function previewRows(local: ParsedImportRow[]): Promise<PreviewEntry[]> {
    const result: PreviewEntry[] = [];
    for (const batch of chunks(local, 500)) {
      const server = await utils.client.officialMall.importPreview.query({ rows: batch.map(row => ({ rowNumber: row.rowNumber, data: row.data ?? row.rawData })) });
      const previews = new Map<number, OfficialMallPreviewRow>(server.rows.map(row => [row.rowNumber, row]));
      result.push(...batch.map(row => {
        const preview = previews.get(row.rowNumber);
        return { ...row, preview, errors: Array.from(new Set([...row.errors, ...(preview?.errors ?? ["未返回本行校验结果"])])), confirmed: false, policy: "skip" as const, outcome: "ready" as const };
      }));
    }
    return result;
  }
  async function prepareTable(parsed: ParsedTable, columns = parsed.mapping) {
    if (!canWrite || busyRef.current || holdRef.current || importingRef.current) return;
    const lease = permissionKey; busyRef.current = true; setBusy(true); setError("");
    try {
      let local = rowsFromTable(parsed, columns);
      const alreadyProcessed = entries.some(e => e.outcome === "success" || e.outcome === "skipped");
      const failures = entries.filter(e => e.outcome === "failed" || e.errors.length > 0);
      if (alreadyProcessed) {
        if (!failures.length || local.length !== failures.length) throw new Error(`补传仅允许${failures.length}条失败行；禁止重新上传整批已成功数据。可下载错误行修正后补传。`);
        local = local.map((r, i) => ({ ...r, rowNumber: failures[i].rowNumber }));
      }
      const next = await previewRows(local);
      if (latest.current !== lease) return;
      if (alreadyProcessed) {
        const replaces = new Map(next.map(e => [e.rowNumber, e]));
        setEntries(current => current.map(e => replaces.get(e.rowNumber) ?? e)); setTable(null);
      } else { setEntries(next); setTable(parsed); setMapping(columns); setProgress({ completed: 0, total: 0 }); setImportTotals({ imported: 0, updated: 0, skipped: 0 }); }
      setEditingRow(null); setNotice("请人工核对型号、品牌、数量、价格及匹配结果。有效行确认后仅导入待上架。");
    } catch (cause) { if (latest.current === lease) setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function uploadFile(file: File | undefined) {
    if (!file || locked || !canWrite) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("文件不得超过5MiB");
      await prepareTable(parseImportFile(file.name, await file.arrayBuffer()));
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function previewEdited(rowNumber: number, nextForm: Form) {
    if (locked || !canWrite) return;
    try {
      const data = formData(nextForm), lease = permissionKey; busyRef.current = true; setBusy(true); setError("");
      const local: ParsedImportRow = { rowNumber, data, form: nextForm, errors: [], rawData: { ...data } };
      const [entry] = await previewRows([local]);
      if (latest.current !== lease) return;
      setEntries(current => current.map(e => e.rowNumber === rowNumber ? entry : e)); setEditingRow(null);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const importable = entries.filter(e => e.outcome === "ready" && e.confirmed && !entryProblem(e));
  async function confirmImport() {
    if (locked || !canWrite || !importable.length) return;
    if (createTeam.problem) { setError(createTeam.problem); return; }
    const lease = permissionKey;
    const batches = chunks(importable, IMPORT_BATCH_SIZE); importingRef.current = true; setImporting(true); setProgress({ completed: 0, total: importable.length });
    try {
      for (const batch of batches) {
        if (latest.current !== lease || !authority.current.canWrite || holdRef.current) break;
        const importRows: OfficialMallImportRow[] = batch.map(entry => ({ rowNumber: entry.rowNumber, data: entry.data!, duplicatePolicy: entry.policy, ...(entry.policy === "update" && entry.duplicateId ? { duplicateId: entry.duplicateId, expectedRevision: entry.expectedRevision } : {}) }));
        const rowNumbers = batch.map(r => r.rowNumber);
        const result = await runWrite("import", requestId => utils.client.officialMall.importRows.mutate({ requestId, rows: importRows, ...(effectiveTeamId ? { teamId: effectiveTeamId } : {}) }), response => settleImport(response, rowNumbers), { rowNumbers });
        if (result === "rejected") { setEntries(current => current.map(e => rowNumbers.includes(e.rowNumber) ? { ...e, outcome: "failed", confirmed: false, errors: [rejectionRef.current] } : e)); break; }
        if (result === "unknown") break;
      }
    } finally { importingRef.current = false; setImporting(false); }
  }
  const failedEntries = entries.filter(e => e.errors.length > 0 || e.outcome === "failed");
  const successCount = importTotals.imported + importTotals.updated;
  const skipCount = importTotals.skipped;
  const readyCount = entries.filter(e => e.outcome === "ready" && !entryProblem(e)).length;
  const importMode = dialog?.kind === "create" && mode !== "manual";
  const importPanel = <div className="mall-import">
    <div className="mall-import-tools"><button disabled={busy || importing} onClick={() => downloadCsv("官方商城物料模板.csv", templateCsv())}>下载模板</button><label className="mall-file-label">{successCount || skipCount ? "补传失败行" : "上传 XLSX / CSV"}<input type="file" aria-label={successCount || skipCount ? "补传失败行文件" : "上传商城物料表格"} accept=".xlsx,.csv" disabled={locked || !canWrite || !!(successCount || skipCount) && !failedEntries.length} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void uploadFile(file); }}/></label>{failedEntries.length > 0 && <button disabled={busy || importing} onClick={() => downloadCsv("官方商城物料错误行.csv", errorRowsCsv(failedEntries))}>下载错误行（{failedEntries.length}）</button>}</div>
    <p className="mall-hint">仅支持.xlsx / UTF-8 .csv，5MiB、最多2000行；不执行公式、宏或外部引用。Excel复制多行可直接粘贴。未知字段须映射或编辑，绝不猜库存和售价。</p>
    <label className="mall-paste-label">{mode === "paste" ? "供应商报价 / 库存文本" : "从Excel复制多行"}<textarea aria-label="粘贴商城物料数据" disabled={locked || !canWrite} value={paste} onChange={e => setPaste(e.target.value)} placeholder={mode === "paste" ? "粘贴带表头的报价表，或型号：…、品牌：…等明确标注的字段；无法确定的列需人工补充" : "粘贴包含型号、品牌等表头的多行表格"}/></label>
    <button disabled={locked || !canWrite || !paste.trim()} onClick={() => { try { void prepareTable(parseImportText(paste)); } catch (cause) { setError(errorMessage(cause)); } }}>{successCount || skipCount ? "识别失败行并校验" : "识别并校验"}</button>
    {table && <details className="mall-mapping" open={entries.some(e => !e.data)}><summary>列映射（未映射列忽略）</summary><div className="mall-mapping-grid">{table.headers.map((header, i) => <label key={i}>{header}<select aria-label={`第${i + 1}列映射`} disabled={locked || !canWrite || !!successCount || !!skipCount} value={mapping[i] ?? ""} onChange={e => setMapping(current => current.map((key, j) => j === i ? e.target.value as ImportField || null : key))}><option value="">忽略 / 待映射</option>{IMPORT_COLUMNS.map(col => <option key={col.key} value={col.key}>{col.label}</option>)}</select></label>)}</div><button disabled={locked || !canWrite || !!successCount || !!skipCount} onClick={() => void prepareTable(table, mapping)}>按映射重新校验</button></details>}
    {entries.length > 0 && <><div className="mall-import-summary" role="status"><span>有效 {readyCount} · 错误 {failedEntries.length} · 成功 {successCount} · 跳过 {skipCount}</span><span>进度 {progress.completed} / {progress.total}</span></div><progress aria-label="导入进度" max={Math.max(progress.total, 1)} value={progress.completed}/><label className="mall-confirm-all"><input type="checkbox" aria-label="人工核对全部有效行" disabled={locked || !canWrite || readyCount === 0} checked={readyCount > 0 && importable.length === readyCount} onChange={e => { const checked = e.target.checked; setEntries(current => current.map(entry => entry.outcome === "ready" && !entryProblem(entry) ? { ...entry, confirmed: checked } : entry)); }}/>我已人工核对有效行的型号、品牌、数量、售价及匹配结果（不自动替换）</label>
      <div className="mall-table-wrap mall-preview-wrap"><table className="mall-preview-table"><thead><tr><th>确认 / 行</th><th>型号</th><th>品牌 / 封装</th><th>数量 / 价格</th><th>匹配 / 重复策略</th><th>校验 / 操作</th></tr></thead><tbody>{entries.map(entry => { const problem = entryProblem(entry), done = entry.outcome === "success" || entry.outcome === "skipped"; return <tr key={entry.rowNumber} className={problem ? "mall-error-row" : ""}><td><label><input type="checkbox" aria-label={`确认第${entry.rowNumber}行`} disabled={locked || !canWrite || done || !!problem} checked={entry.confirmed} onChange={e => setEntries(current => current.map(r => r.rowNumber === entry.rowNumber ? { ...r, confirmed: e.target.checked } : r))}/>{entry.rowNumber}</label></td><td>{entry.form.partNumber || "未填写"}<small>批次 {entry.form.dateCode || "未知"}</small></td><td>{entry.form.brand || "未填写"}<small>{entry.form.pkg || "封装未知"}</small></td><td><small>可售 {entry.form.qtyOnSale || "未知"} / 实际 {entry.form.qtyStock || "未知"}</small>{entry.data ? <Quote row={entry.data}/> : <span>{entry.form.priceEx ? money(entry.form.priceEx) : "面议 / 待核对"}</span>}</td><td><span>{entry.preview?.matchStatus === "exact" ? "准确匹配（保留录入）" : entry.preview?.matchStatus === "multiple" ? "多个候选，须人工核对" : entry.preview ? "未匹配，须人工确认" : "未完成匹配"}</span>{!!entry.preview?.matches.length && !done && <select aria-label={`第${entry.rowNumber}行资料匹配`} value="" disabled={locked || !canWrite} onChange={e => { const match = entry.preview?.matches[Number(e.target.value)]; if (e.target.value !== "" && match) void previewEdited(entry.rowNumber, applySuggestion(entry.form, match)); }}><option value="">保留原录入资料</option>{entry.preview.matches.map((match, i) => <option key={i} value={i}>{match.partNumber} · {match.brand} · {match.pkg}</option>)}</select>}{!!entry.preview?.duplicates.length && <><select aria-label={`第${entry.rowNumber}行重复策略`} value={entry.policy} disabled={locked || !canWrite || done} onChange={e => setEntries(current => current.map(r => r.rowNumber === entry.rowNumber ? { ...r, policy: e.target.value as OfficialMallDuplicatePolicy, duplicateId: undefined, expectedRevision: undefined, confirmed: false } : r))}><option value="skip">重复跳过（默认）</option><option value="update">按版本更新</option><option value="new">另建批次（先修改批次）</option></select>{entry.policy === "update" && <select aria-label={`第${entry.rowNumber}行更新目标`} value={entry.duplicateId ?? ""} disabled={locked || !canWrite || done} onChange={e => { const duplicate = entry.preview?.duplicates.find(d => d.id === Number(e.target.value)); setEntries(current => current.map(r => r.rowNumber === entry.rowNumber ? { ...r, duplicateId: duplicate?.id, expectedRevision: duplicate?.revision, confirmed: false } : r)); }}><option value="">人工选择原记录</option>{entry.preview.duplicates.map(d => <option key={d.id} value={d.id}>ID {d.id} · 版本 {d.revision} · 批次 {d.dateCode || "未知"}</option>)}</select>}</>}</td><td><span>{done ? "已处理（详见汇总）" : problem || "有效，待人工确认"}</span>{!done && <button className="mall-inline-action" disabled={locked || !canWrite} onClick={() => { setEditingRow(entry.rowNumber); setRowForm(entry.form); setError(""); }}>编辑 / 修正</button>}</td></tr>; })}</tbody></table></div>
      {editingRow != null && <section className="mall-row-editor" aria-label={`修正第${editingRow}行`}><h3>修正第 {editingRow} 行</h3><FormEditor form={rowForm} onChange={setRowForm} disabled={locked || !canWrite}/><div className="mall-dialog-actions"><button disabled={busy || importing || !!hold} onClick={() => setEditingRow(null)}>取消修正</button><button disabled={locked || !canWrite} onClick={() => void previewEdited(editingRow, rowForm)}>人工保存并重新校验</button></div></section>}
      <p className="mall-hint">按100行分批保存到待上架；重复默认跳过。已成功行不可再次提交。未知结果立即停批并保留当前UUID，核对完成后须人工确认剩余批次。</p></>}
  </div>;
  return <section className="mall-materials" aria-label="官方商城物料管理" data-official-mall="native">
    <div className="mall-filter"><input aria-label="搜索商城物料型号" placeholder="型号" value={partNumber} maxLength={128} onChange={e => setPartNumber(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setFilters({ partNumber: partNumber.trim(), brand: brand.trim() }); setPage(1); } }}/><input aria-label="搜索商城物料品牌" placeholder="品牌" value={brand} maxLength={128} onChange={e => setBrand(e.target.value)}/><select aria-label="商城上架状态" value={state} onChange={e => { setState(e.target.value as typeof state); setPage(1); }}><option value="">全部状态</option><option value="draft">待上架</option><option value="published">已上架</option><option value="offshelf">已下架</option></select><button disabled={!canRead} onClick={() => { setFilters({ partNumber: partNumber.trim(), brand: brand.trim() }); setPage(1); }}>筛选</button><button onClick={() => { setPartNumber(""); setBrand(""); setFilters({ partNumber: "", brand: "" }); setState(""); setPage(1); }}>重置</button><button disabled={busy || importing} onClick={refresh}>刷新</button><button className="mall-primary mall-add" disabled={!canWrite || locked} onClick={() => open("create")}>新增物料</button></div>
    {selected.length > 0 && selected.every(row => rows.some(r => r.id === row.id && r.revision === row.revision)) && <div className="mall-bulk" role="group" aria-label="选中物料批量操作"><span>已选 {selected.length} 条</span><button disabled={!canPublish || locked} onClick={() => open("bulk", undefined, "publish")}>批量上架</button><button disabled={!canPublish || locked} onClick={() => open("bulk", undefined, "offshelf")}>批量下架</button><button disabled={busy || importing || !!hold} onClick={() => setSelected([])}>取消选择</button></div>}
    {hold && <div className="mall-notice" role="alert"><div>原请求结果待核对，已停止提交。<code>{hold.requestId}</code><small>没有回执不代表未执行；不重新上传整批，也不重发新增或上架。</small></div><button disabled={busy || !canRead} onClick={() => void inspectRequest()}>核对原请求</button></div>}
    {notice && <p className="mall-notice" role="status">{notice}</p>}{error && !dialog && <p className="mall-form-error" role="alert">{error}</p>}
    {!signedIn ? <p className="mall-notice">{auth.loading ? "正在核验后台员工会话…" : "请使用后台员工账号登录。"}</p> : status.isError ? <p className="mall-notice" role="alert">{errorMessage(status.error)}</p> : status.isLoading ? <p>正在核验官方物料权限…</p> : !canRead ? <p className="mall-notice">{access?.message ?? "当前后台员工没有官方商城物料查看权限。"}</p> : null}
    <MallNewInformationRows rows={rows} listReady={listReady}>{(pageRows, getRow) =>
    <div className="mall-table-wrap"><table className="mall-main-table"><colgroup><col className="mall-col-check"/><col className="mall-col-model"/><col className="mall-col-brand"/><col className="mall-col-pkg"/><col className="mall-col-dc"/><col className="mall-col-qty"/><col className="mall-col-price"/><col className="mall-col-lead"/><col className="mall-col-state"/><col className="mall-col-action"/></colgroup><thead><tr><th><input type="checkbox" aria-label="选择本页物料" disabled={locked || !canPublish || !rows.length} checked={rows.length > 0 && rows.every(r => selected.some(s => s.id === r.id && s.revision === r.revision))} onChange={e => setSelected(e.target.checked ? rows.map(r => ({ ...r })) : [])}/></th><th>型号</th><th>品牌</th><th>封装</th><th>批次/DC</th><th>可售数量</th><th>报价 CNY</th><th>货期</th><th>状态</th><th className="mall-action-cell">操作</th></tr></thead><tbody>{pageRows.map(row => { const information = getRow?.(`mall-material:${row.id}`); return <tr key={row.id} ref={information?.ref}><td><input type="checkbox" aria-label={`选择物料 ${row.partNumber} ${row.id}`} checked={selected.some(r => r.id === row.id)} disabled={locked || !canPublish} onChange={e => setSelected(current => e.target.checked ? [...current.filter(r => r.id !== row.id), { ...row }] : current.filter(r => r.id !== row.id))}/></td><td><button className="mall-model" disabled={!canWrite || locked} title={row.status === "published" ? "先下架再编辑" : "编辑物料"} onClick={() => open("edit", row)}>{row.partNumber}</button><AdminNewInformationRowBadge isNew={information?.isNew ?? false}/></td><td title={row.brand}>{row.brand}</td><td title={row.pkg}>{row.pkg || "—"}</td><td>{row.dateCode || "—"}</td><td className="mall-numeric">{count(row.qtyOnSale)}<small>实际 {count(row.qtyStock)}</small></td><td><Quote row={row}/></td><td title={row.leadTime}>{row.leadTime || "未知"}</td><td><span className={`mall-state ${row.status}`}>{statusNames[row.status]}</span></td><td className="mall-action-cell"><button className="mall-inline-action" disabled={!canPublish || locked} onClick={() => open(row.status === "published" ? "offshelf" : "publish", row)}>{row.status === "published" ? "下架" : "上架"}</button></td></tr>; })}{!rows.length && <tr><td colSpan={10} className="mall-empty">{!canRead ? "暂无可读取物料" : list.isFetching ? "读取物料中…" : list.isError ? errorMessage(list.error) : "暂无官方商城物料，可手工新增或导入到待上架"}</td></tr>}</tbody></table></div>
    }</MallNewInformationRows>
    <footer className="mall-pagination"><span>共 {canRead ? list.data?.total ?? 0 : 0} 条</span><button disabled={!canRead || page <= 1 || list.isFetching || importing} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页</span><button disabled={!canRead || page * 30 >= (list.data?.total ?? 0) || list.isFetching || importing} onClick={() => setPage(p => p + 1)}>下一页</button></footer>
    {entries.length > 0 && !dialog && <button disabled={busy || importing || !canRead} onClick={() => { setMode("sheet"); setDialog({ kind: "create", scopeKey }); }}>查看导入结果 / 剩余行</button>}
    {dialog && canRead && dialog.scopeKey === scopeKey && <div className="mall-dialog-overlay"><section className={`mall-dialog ${importMode ? "mall-import-dialog" : ""}`} role="dialog" aria-modal="true" aria-labelledby="mall-dialog-title" tabIndex={-1}><h2 id="mall-dialog-title">{dialog.kind === "create" ? "新增物料" : dialog.kind === "edit" ? "编辑物料" : dialog.kind === "bulk" ? `确认批量${dialog.action === "publish" ? "上架" : "下架"}` : dialog.kind === "publish" ? "确认上架" : "确认下架"}</h2>
      {dialog.kind === "create" && <div className="mall-create-modes" role="group" aria-label="新增方式">{(["manual", "sheet", "paste"] as const).map(key => <button key={key} aria-pressed={mode === key} disabled={locked} onClick={() => { setMode(key); setError(""); }}>{modeNames[key]}</button>)}</div>}
      {dialog.kind === "create" && access?.scope.isSuperAdmin && !!access.teams?.length && <label className="mall-team">归属团队<select aria-label="归属官方团队" disabled={locked || !canWrite || !!successCount || !!skipCount || access.teams.length === 1} value={effectiveTeamId ?? ""} onChange={e => setTeamId(e.target.value ? Number(e.target.value) : undefined)}>{access.teams.length > 1 && <option value="">请选择有效官方团队</option>}{access.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>{access.teams.length === 1 && <small>已自动选择唯一有效官方团队；保存时服务端再次核验。</small>}</label>}
      {dialog.kind === "create" && createTeam.problem && <p className="mall-form-error" role="alert">{createTeam.problem}</p>}
      {(dialog.kind === "edit" || dialog.kind === "create" && mode === "manual") && <p className="mall-hint">型号至少输入3个字符，停顿500毫秒后查询；精确型号优先，未命中再提供有限前缀候选。联想失败或未命中不影响手工保存。</p>}
      {importMode ? importPanel : dialog.kind === "create" || dialog.kind === "edit" ? <FormEditor form={form} onChange={setForm} disabled={locked || !canWrite || staleDialog} suggestions={suggesting && !locked ? <div className="mall-suggestions">{suggestions.isError ? <small>资料联想暂不可用，可手工输入。</small> : suggestions.isFetching ? <small>查询型号资料…</small> : suggestions.data?.items.length ? <>{suggestions.data.items.map((item, i) => <button type="button" key={i} aria-label={`使用型号资料 ${item.partNumber} ${item.brand} ${item.pkg}`} onClick={() => setForm(current => applySuggestion(current, item))}>{item.partNumber} · {item.brand} · {item.pkg || "封装未知"}</button>)}<small>仅填型号、品牌、封装；交易字段仍需人工录入。</small></> : <small>未匹配资料，请人工确认型号与品牌。</small>}</div> : null}/> : <><p>{(dialog.action ?? dialog.kind) === "publish" ? "确认公开选定官方物料的数量、报价及货期。权限和版本由服务端事务再次核验，不自动更换物料或价格。" : "确认停止公开展示选定官方物料。原订单与其他库存保持不变。"}</p>{dialog.row && <div className="mall-confirm-details"><strong>{dialog.row.partNumber} · {dialog.row.brand}</strong><Quote row={dialog.row}/><p>批次 {dialog.row.dateCode || "未知"} · 可售 {count(dialog.row.qtyOnSale)} / 实际 {count(dialog.row.qtyStock)} · 订货 {count(dialog.row.qtyOrder)}</p><p>货期 {dialog.row.leadTime || "未知"} · 版本 {dialog.row.revision}</p>{dialog.kind === "publish" && publishProblem(dialog.row) && <p className="mall-form-error">{publishProblem(dialog.row)}</p>}</div>}{dialog.items && <ul className="mall-bulk-review">{dialog.items.map(row => <li key={row.id}>{row.partNumber} · {row.brand} · 版本 {row.revision}{dialog.action === "publish" && publishProblem(row) ? `：${publishProblem(row)}` : ""}</li>)}</ul>}</>}
      {error && <p className="mall-form-error" role="alert">{error}</p>}{staleDialog && <p className="mall-form-error" role="alert">物料版本已变化，请刷新后人工重新选择；未自动重试。</p>}{hold && <p className="mall-form-error" role="alert">原请求结果待核对：{hold.requestId}，停止后续批次。</p>}
      <div className="mall-dialog-actions"><button disabled={busy || importing || !!hold} onClick={() => setDialog(null)}>关闭</button>{hold && <button disabled={busy || !canRead} onClick={() => void inspectRequest()}>核对原请求</button>}{importMode ? <button className="mall-primary" disabled={locked || !canWrite || !!createTeam.problem || importable.length === 0 || editingRow != null} onClick={() => void confirmImport()}>{importing ? "正在分批导入…" : `导入已确认有效行（${importable.length}）`}</button> : <button className="mall-primary" disabled={locked || staleDialog || dialog.kind === "create" && !!createTeam.problem || (dialog.kind === "create" || dialog.kind === "edit" ? !canWrite : !canPublish)} onClick={() => void submitDialog()}>{busy ? "正在提交…" : dialog.kind === "create" ? "保存到待上架" : dialog.kind === "edit" ? "保存草稿" : dialog.kind === "bulk" ? `确认批量${dialog.action === "publish" ? "上架" : "下架"}` : dialog.kind === "publish" ? "确认上架" : "确认下架"}</button>}</div>
    </section></div>}
  </section>;
}
