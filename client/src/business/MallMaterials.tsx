import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./platform/front-router-types/server/routers";
import { trpc } from "./api/business-trpc";
import { useBusinessScope } from "./BusinessScope";
import { toast } from "sonner";
import "./MallMaterials.css";

type Row = inferRouterOutputs<AppRouter>["mallInventory"]["list"]["items"][number] & { inventoryFingerprint?: string };
type Action = "save" | "publish" | "offshelf";
export type Tier = { minQty: string; price: string };
export type Form = { partNumber: string; brand: string; pkg: string; dateCode: string; qtyStock: string; qtyOnSale: string; qtyOrder: string; priceEx: string; moq: string; spq: string; leadTime: string; taxIncluded: boolean; note: string; tiers: Tier[] };
type Dialog = { kind: Action | "create"; row?: Row; scope: string };
const statusNames = { draft: "待上架", published: "已上架", offshelf: "已下架" };
const count = (v: unknown) => v == null ? "—" : Number(v).toLocaleString("en-US");
const money = (v: unknown) => v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? "询价" : `¥${Number(v).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
export const emptyForm = (): Form => ({ partNumber: "", brand: "", pkg: "", dateCode: "", qtyStock: "", qtyOnSale: "", qtyOrder: "", priceEx: "", moq: "1", spq: "1", leadTime: "", taxIncluded: true, note: "", tiers: [] });
function tierMinimum(tier: unknown) { const t = tier && typeof tier === "object" ? tier as { minQty?: unknown; qty?: unknown } : {}; return Number(t.minQty ?? t.qty); }
function formFor(row: Row): Form {
  if (row.ladderPrices != null && !Array.isArray(row.ladderPrices)) throw new Error("原阶梯报价格式需要核对，请先在原库存页处理；不会静默清空原报价");
  return { partNumber: row.partNumber, brand: row.brand ?? "", pkg: row.pkg ?? "", dateCode: row.dateCode ?? "", qtyStock: String(row.qtyStock), qtyOnSale: String(row.qtyOnSale), qtyOrder: row.qtyOrder == null ? "" : String(row.qtyOrder), priceEx: row.priceEx ?? "", moq: String(row.moq ?? 1), spq: String(row.spq ?? 1), leadTime: row.leadTime ?? "", taxIncluded: row.taxIncluded !== false, note: row.note ?? "", tiers: Array.isArray(row.ladderPrices) ? row.ladderPrices.map(t => ({ minQty: String(tierMinimum(t)), price: String(t?.price) })) : [] };
}
function photoMime(mime: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return mime;
  throw new Error("原库存图片格式不符合现行规则，请先在原库存页处理；不会静默删除原图");
}
export function parseTiers(tiers: Tier[]) {
  if (tiers.length > 64) throw new Error("阶梯价最多64档");
  const result: { minQty: number; price: number }[] = [];
  for (let index = 0; index < tiers.length; index++) {
    const tier = tiers[index];
    const qty = tier.minQty.trim(), value = tier.price.trim();
    if (!qty && !value) continue;
    if (!qty || !value) throw new Error(`第${index + 1}档请同时填写起订数量和单价`);
    const minQty = Number(qty), price = Number(value);
    if (!/^\d+$/.test(qty) || !Number.isSafeInteger(minQty) || minQty <= 0) throw new Error(`第${index + 1}档起订数量须为正整数`);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`第${index + 1}档单价须为大于0的有限数值`);
    if (result.length && minQty <= result[result.length - 1].minQty) throw new Error("阶梯起订数量须严格递增，不能重复");
    result.push({ minQty, price });
  }
  return result.length ? result : undefined;
}
export function formData(form: Form, original?: Row) {
  const integer = (s: string, name: string, positive = false) => {
    const n = Number(s);
    if (!/^\d+$/.test(s.trim()) || !Number.isSafeInteger(n) || n < (positive ? 1 : 0) || n > 2147483647) throw new Error(`${name}须为${positive ? "正" : "非负"}整数且不超过2147483647`);
    return n;
  };
  const price = (s: string) => { const n = Number(s); if (!Number.isFinite(n) || n <= 0) throw new Error("单价须为大于0的有限数值；询价请留空"); return n; };
  if (!form.partNumber.trim() || !form.brand.trim() || !form.leadTime.trim()) throw new Error("请填写型号、品牌及真实货期");
  if (typeof form.taxIncluded !== "boolean") throw new Error("请选择明确税口径");
  const qtyStock = integer(form.qtyStock, "实际库存"), qtyOnSale = integer(form.qtyOnSale, "现货上架量");
  if (qtyOnSale > qtyStock) throw new Error("实际库存数量须大于等于现货上架量");
  const ladderPrices = parseTiers(form.tiers);
  const priceEx = form.priceEx.trim() ? price(form.priceEx) : undefined;
  if (!form.taxIncluded && !priceEx && !ladderPrices) throw new Error("选择未税价时请填写单价或阶梯价；不会改动原税口径");
  if (form.note.length > 50) throw new Error("公开备注最多50字");
  return { partNumber: form.partNumber.trim(), brand: form.brand.trim(), category: original?.category ?? "", pkg: form.pkg.trim(), dateCode: form.dateCode.trim(), qtyStock, qtyOnSale, qtyOrder: form.qtyOrder.trim() ? integer(form.qtyOrder, "订货数量") : undefined, priceEx, taxIncluded: form.taxIncluded, invoice: original?.invoice ?? true, ladderPrices, moq: integer(form.moq, "起订量MOQ", true), spq: integer(form.spq, "包装倍数SPQ", true), leadTime: form.leadTime.trim(), note: form.note, warehouseAddress: original?.warehouseAddress ?? undefined, rohs: original?.rohs ?? true, photos: original?.photos?.map(p => ({ ...p, mimeType: photoMime(p.mimeType) })) ?? undefined };
}
export function validQuoteTiers(row: Pick<Row, "ladderPrices">) {
  return Array.isArray(row.ladderPrices) ? row.ladderPrices.map(t => ({ minQty: tierMinimum(t), price: Number(t?.price) })).filter(t => Number.isSafeInteger(t.minQty) && t.minQty > 0 && Number.isFinite(t.price) && t.price > 0) : [];
}
export function firstEligibleQuote(row: Pick<Row, "ladderPrices" | "moq" | "spq">) {
  const tiers = validQuoteTiers(row), raw = row.ladderPrices ?? [];
  const moq = row.moq == null ? 1 : Number(row.moq), spq = row.spq == null ? 1 : Number(row.spq);
  if (!tiers.length || raw.length > 64 || tiers.length !== raw.length || tiers.some((tier, i) => i > 0 && Number(tier.minQty) <= Number(tiers[i - 1].minQty))) return null;
  if (![moq, spq].every(n => Number.isSafeInteger(n) && n > 0)) return null;
  const quantity = Math.ceil(Math.max(moq, Number(tiers[0].minQty)) / spq) * spq;
  if (!Number.isSafeInteger(quantity) || quantity > 2147483647) return null;
  let price = Number(tiers[0].price);
  for (const tier of tiers) if (quantity >= Number(tier.minQty)) price = Number(tier.price);
  return { quantity, price };
}
function Quote({ row }: { row: Row }) {
  const tiers = validQuoteTiers(row), first = firstEligibleQuote(row), hasTiers = row.ladderPrices != null && (!Array.isArray(row.ladderPrices) || row.ladderPrices.length > 0);
  const tax = row.taxIncluded === true ? "含税" : row.taxIncluded === false ? "未税" : "税口径待核对";
  return <div className="mall-quote"><span className="mall-quote-main">{hasTiers ? first ? `${count(first.quantity)}+ · ${money(first.price)}` : "阶梯报价待核对" : money(row.priceEx)}</span>{tiers.length ? <details><summary>阶梯价 · {tax}</summary><div className="mall-quote-tiers">{tiers.map((tier, i) => <span key={i}>{count(tier.minQty)}+　{money(tier.price)}</span>)}<small>MOQ {count(row.moq ?? 1)} · 包装倍数 {count(row.spq ?? 1)}</small><small>{tax}报价{row.taxIncluded !== true ? " · 仅支持询价" : ""}</small></div></details> : <small>{tax}{row.taxIncluded !== true ? " · 仅支持询价" : ""}</small>}</div>;
}
function confirmRow(row: Row) {
  if (!Number.isSafeInteger(row.inventoryId) || row.inventoryId <= 0 || !/^[a-f0-9]{64}$/.test(row.inventoryFingerprint ?? "")) throw new Error("缺少当前商品确认指纹或真实库存ID，请刷新；不能使用旧部署的确认资料");
}

/** Stock remains in inventories; this page shows explicit mall references only. */
export default function MallMaterials() {
  const scope = useBusinessScope();
  const identity = `${scope.storageScope}:${scope.contextVerification.authorizationVersion}:${scope.officialInventoryPermissions.authorizationVersion}`;
  const latest = useRef(identity); latest.current = identity;
  const verified = scope.contextVerification.state === "verified";
  const generation = useRef({ identity, verified, value: 0 });
  if (generation.current.identity !== identity || generation.current.verified !== verified) generation.current = { identity, verified, value: generation.current.value + 1 };
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [state, setState] = useState<"" | "draft" | "published" | "offshelf">("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [createMode, setCreateMode] = useState<"manual" | "existing">("manual");
  const [candidatePart, setCandidatePart] = useState("");
  const [candidateBrand, setCandidateBrand] = useState("");
  const [candidateSearch, setCandidateSearch] = useState({ partNumber: "", brand: "" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [unknownRequest, setUnknownRequest] = useState<string | null>(null);
  const [creationHold, setCreationHold] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const utils = trpc.useUtils();
  const status = trpc.mallInventory.status.useQuery(undefined, { enabled: verified, staleTime: 0 });
  const eligible = verified && status.data?.eligibility.eligible === true && status.data.context.enterpriseId === scope.staffPrincipal.enterpriseId;
  const list = trpc.mallInventory.list.useQuery({ visibility: "linked", partNumber: appliedKeyword || undefined, status: state || undefined, page, pageSize: 30 }, { enabled: eligible, placeholderData: undefined });
  const rows = eligible ? list.data?.items.filter(row => row.linked) ?? [] : [];
  const permissions = status.data?.permissions;
  const canWrite = eligible && permissions?.write === true;
  const canPublish = eligible && permissions?.publish === true;
  const livePermissions = useRef({ canWrite, canPublish }); livePermissions.current = { canWrite, canPublish };
  const choosingExisting = dialog?.kind === "create" && dialog.scope === identity && createMode === "existing" && canWrite;
  const candidates = trpc.mallInventory.list.useQuery({ visibility: "unlinked", partNumber: candidateSearch.partNumber || undefined, brand: candidateSearch.brand || undefined, page: 1, pageSize: 30 }, { enabled: choosingExisting, placeholderData: undefined, staleTime: 0 });
  const candidateRows = choosingExisting ? candidates.data?.items.filter(row => !row.linked) ?? [] : [];
  useEffect(() => {
    setDialog(null); setForm(emptyForm()); setFormError(""); setBusy(false); busyRef.current = false; setUnknownRequest(null); setCreationHold(null);
    setKeyword(""); setAppliedKeyword(""); setState(""); setPage(1); setCreateMode("manual"); setCandidatePart(""); setCandidateBrand(""); setCandidateSearch({ partNumber: "", brand: "" });
  }, [identity]);
  const refresh = () => { void status.refetch(); void utils.mallInventory.list.invalidate(); };
  const open = (kind: Dialog["kind"], row?: Row) => {
    if (!verified || busyRef.current || unknownRequest || creationHold) return;
    if (kind === "save" && (!canWrite || row?.status === "published" || row?.publicationStatus === "published")) { toast.info("已上架物料请先下架，再编辑并重新确认上架"); return; }
    if (kind === "create" && !canWrite) return;
    try { setForm(row ? formFor(row) : emptyForm()); } catch (e) { toast.error(e instanceof Error ? e.message : "原报价需要核对，未清空原数据"); return; }
    setFormError(""); setCreateMode(canPublish ? "manual" : "existing");
    setCandidatePart(""); setCandidateBrand(""); setCandidateSearch({ partNumber: "", brand: "" }); setDialog({ kind, row, scope: identity });
  };
  async function submit() {
    if (!dialog || dialog.scope !== identity || !verified || busyRef.current || unknownRequest || creationHold || !status.data) return;
    const manual = dialog.kind === "create" && createMode === "manual";
    const selecting = dialog.kind === "create" && createMode === "existing";
    if (manual ? !canWrite || !canPublish : dialog.kind === "publish" || dialog.kind === "offshelf" ? !canPublish : !canWrite) return;
    const lease = identity, epoch = generation.current.value;
    const current = () => latest.current === lease && generation.current.value === epoch && generation.current.verified;
    let requestId: string | null = null;
    let createSent = false;
    setFormError("");
    try {
      let data: ReturnType<typeof formData> | undefined;
      if (manual || dialog.kind === "save") data = formData(form, dialog.row);
      if (manual && !form.dateCode.trim()) throw new Error("新增物料请填写真实生产周期/DC");
      if (manual && data!.qtyOnSale <= 0 && !(data!.qtyOrder && data!.qtyOrder > 0)) throw new Error("请填写大于0的现货上架量或订货数量");
      let row = dialog.row;
      if (!manual) {
        if (!row) throw new Error("请选择一条已有库存");
        confirmRow(row);
        if ((selecting || dialog.kind === "save") && (row.status === "published" || row.publicationStatus === "published")) throw new Error("已上架库存请先显式下架；不会自动关联或修改");
        if (selecting && row.linked) throw new Error("该库存已纳入商城，请刷新核对");
      }
      busyRef.current = true; setBusy(true);
      if (manual) {
        createSent = true;
        const result = await utils.client.inventory.create.mutate({ data: data!, saveAs: "draft" });
        if (!current()) return;
        const created = result as { success?: boolean; inventoryId?: unknown };
        if (created.success !== true || typeof created.inventoryId !== "number" || !Number.isSafeInteger(created.inventoryId) || created.inventoryId <= 0) throw new Error("库存创建结果需核对：缺少真实库存ID；已停止，不会按型号猜测或重发创建");
        const found = await utils.client.mallInventory.list.query({ inventoryId: created.inventoryId, visibility: "unlinked", page: 1, pageSize: 1 });
        if (!current()) return;
        if (found.items.length !== 1 || found.total !== 1 || found.items[0].inventoryId !== created.inventoryId || found.items[0].linked || found.items[0].status === "published") throw new Error("已保存原库存，但精确ID核对未通过；请在原库存页核对，不会自动重发或关联其他物料");
        row = found.items[0]; confirmRow(row);
        if (!livePermissions.current.canWrite || !livePermissions.current.canPublish) throw new Error("库存已保存，但当前创建资格已变化；请核对原库存，未继续关联");
      }
      if (!current()) return;
      requestId = crypto.randomUUID();
      const input = { inventoryId: row!.inventoryId, expectedVersion: row!.publicationVersion, expectedInventoryUpdatedAt: new Date(row!.inventoryUpdatedAt), expectedOwnershipVersion: row!.ownershipVersion, expectedPermissionVersion: status.data.context.permissionVersion, expectedAuthorizationVersion: status.data.context.authorizationVersion, expectedInventoryFingerprint: row!.inventoryFingerprint!, requestId };
      const result = manual || selecting ? await utils.client.mallInventory.link.mutate(input)
        : dialog.kind === "save" ? await utils.client.mallInventory.save.mutate({ ...input, data: data! })
        : dialog.kind === "publish" ? await utils.client.mallInventory.publish.mutate(input)
        : await utils.client.mallInventory.offshelf.mutate(input);
      if (!current()) return;
      if (!result.success) { toast.error(dialog.kind === "publish" ? "未上架，请刷新核对发布条件" : "操作未成功，请刷新核对当前状态"); setDialog(null); refresh(); return; }
      toast.success(manual || selecting ? "已保存到待上架" : dialog.kind === "publish" ? "已确认上架" : dialog.kind === "offshelf" ? "已下架" : "草稿已保存", manual || selecting ? { description: "仅纳入商城待上架，未自动发布。" } : undefined);
      setDialog(null); refresh();
    } catch (e) {
      if (!current()) return;
      scope.onAuthorizationError(e);
      const message = e instanceof Error ? e.message : "操作结果需要核对";
      setFormError(message); toast.error(message);
      if (requestId) setUnknownRequest(requestId);
      else if (createSent) setCreationHold("库存已保存或创建结果未知，请在原库存页核对。未重发创建，未自动按型号关联；核对前停止提交。");
    } finally {
      if (latest.current === lease) {
        if (generation.current.value !== epoch) {
          // A live verification interruption is not proof that the write failed.
          // Retain only our request metadata; discard its stale response and form.
          if (requestId) setUnknownRequest(requestId);
          else if (createSent) setCreationHold("库存创建期间身份核验已变化，结果需在原库存页核对；未重发创建，未继续自动关联。");
          setDialog(null); setForm(emptyForm());
        }
        busyRef.current = false; setBusy(false);
      }
    }
  }
  async function inspectRequest() {
    if (!unknownRequest || !verified || busyRef.current) return;
    const lease = identity, epoch = generation.current.value; busyRef.current = true; setBusy(true);
    try {
      const result = await utils.client.mallInventory.requestStatus.query({ requestId: unknownRequest });
      if (latest.current !== lease || generation.current.value !== epoch || !generation.current.verified) return;
      if (result.state === "completed") { toast.info("已找到原请求回执，请刷新核对物料状态"); setUnknownRequest(null); setDialog(null); refresh(); }
      else toast.info("尚无最终回执，保持停止；请稍后再核对，不要重复提交");
    } catch (e) { if (latest.current === lease && generation.current.value === epoch) { scope.onAuthorizationError(e); toast.error("暂时无法核对原请求，未重发任何操作"); } }
    finally { if (latest.current === lease) { busyRef.current = false; setBusy(false); } }
  }
  const locked = busy || !verified || !!unknownRequest || !!creationHold;
  const dialogCanSubmit = dialog?.kind === "create" ? createMode === "manual" ? canWrite && canPublish : canWrite && !!dialog.row : dialog?.kind === "save" ? canWrite : canPublish;
  return <section className="mall-materials" aria-label="商城物料管理">
    <div className="mall-filter"><input aria-label="搜索商城物料型号" placeholder="搜索型号" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && verified) { setAppliedKeyword(keyword.trim()); setPage(1); } }}/><select aria-label="商城上架状态" value={state} onChange={e => { setState(e.target.value as typeof state); setPage(1); }}><option value="">全部状态</option><option value="draft">待上架</option><option value="published">已上架</option><option value="offshelf">已下架</option></select><button onClick={() => { setAppliedKeyword(keyword.trim()); setPage(1); }} disabled={!verified}>筛选</button><button onClick={() => { setKeyword(""); setAppliedKeyword(""); setState(""); setPage(1); }}>重置</button><button onClick={refresh} disabled={busy}>刷新</button><button className="mall-primary mall-add" disabled={!canWrite || locked} title="手工录入沿用原库存创建资格；选择已有库存仅需编辑权限" onClick={() => open("create")}>新增物料</button></div>
    {unknownRequest && <div className="mall-notice" role="alert">原请求结果尚待核对。未自动重发，也不会重复上架。<button disabled={busy || !verified} onClick={() => void inspectRequest()}>核对原请求</button></div>}
    {creationHold && <p className="mall-notice" role="alert">{creationHold}</p>}
    {!verified ? <p className="mall-notice">正在重新核验当前企业与权限，暂不可操作。</p> : status.isError ? <p className="mall-notice" role="alert">商城权限核验失败，请刷新；不会借用旧企业数据。</p> : status.isLoading ? <p>正在核验商城配置…</p> : !eligible ? <p className="mall-notice">{status.data?.eligibility.message ?? "商城尚未完成安全就绪"}。不会自动关联或上架历史物料。</p> : null}
    <div className="mall-table-wrap"><table className="mall-main-table"><colgroup><col className="mall-col-model"/><col className="mall-col-brand"/><col className="mall-col-pkg"/><col className="mall-col-dc"/><col className="mall-col-qty"/><col className="mall-col-price"/><col className="mall-col-lead"/><col className="mall-col-state"/><col className="mall-col-action"/></colgroup><thead><tr><th>型号</th><th>品牌</th><th>封装</th><th>DC</th><th>可售数量</th><th>报价 CNY</th><th>货期</th><th>状态</th><th className="mall-action-cell">操作</th></tr></thead><tbody>
      {rows.map(row => { const published = row.publicationStatus === "published" || row.status === "published"; return <tr key={row.inventoryId}><td><button className="mall-model" disabled={!canWrite || locked} title={published ? "已上架请先下架再编辑" : "编辑商城物料"} onClick={() => open("save", row)}>{row.partNumber}</button></td><td title={row.brand ?? ""}>{row.brand || "—"}</td><td title={row.pkg ?? ""}>{row.pkg || "—"}</td><td>{row.dateCode || "—"}</td><td className="mall-numeric">{count(row.qtyOnSale)}</td><td><Quote row={row}/></td><td title={row.leadTime ?? ""}>{row.leadTime || "—"}</td><td><span className={`mall-state ${row.publicationStatus ?? "draft"}`}>{statusNames[row.publicationStatus ?? "draft"]}</span></td><td className="mall-action-cell"><button className="mall-inline-action" disabled={!canPublish || locked} onClick={() => open(published ? "offshelf" : "publish", row)}>{published ? "下架" : "上架"}</button></td></tr>; })}
      {!rows.length && <tr><td colSpan={9} className="mall-empty">{list.isFetching ? "读取物料中…" : !eligible ? "商城未就绪" : list.isError ? "读取失败，请刷新" : "暂无商城物料，可新增或选择已有库存保存到待上架"}</td></tr>}
    </tbody></table></div>
    <footer className="mall-pagination"><span>共 {eligible ? list.data?.total ?? 0 : 0} 条</span><button disabled={page <= 1 || list.isFetching} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 30 >= (list.data?.total ?? 0) || list.isFetching} onClick={() => setPage(p => p + 1)}>下一页</button></footer>
    {dialog && dialog.scope === identity && <div className="mall-dialog-overlay"><section className="mall-dialog" role="dialog" aria-modal="true" aria-labelledby="mall-dialog-title"><h2 id="mall-dialog-title">{dialog.kind === "create" ? "新增物料" : dialog.kind === "save" ? "编辑商城物料" : dialog.kind === "publish" ? "确认上架" : "确认下架"}</h2>
      {dialog.kind === "create" && <div className="mall-create-modes" role="group" aria-label="新增方式"><button aria-pressed={createMode === "manual"} disabled={locked || !canPublish} title={!canPublish ? "手工创建需要原库存创建资格" : undefined} onClick={() => { setCreateMode("manual"); setForm(emptyForm()); setFormError(""); setDialog({ ...dialog, row: undefined }); }}>手工录入</button><button aria-pressed={createMode === "existing"} disabled={locked || !canWrite} onClick={() => { setCreateMode("existing"); setForm(emptyForm()); setFormError(""); setDialog({ ...dialog, row: undefined }); }}>选择已有库存</button></div>}
      {dialog.row && <p><strong>{dialog.row.partNumber}</strong> · {dialog.row.brand} · 库存ID {dialog.row.inventoryId}</p>}
      {dialog.kind === "create" && createMode === "existing" ? <div className="mall-candidates"><div className="mall-candidate-filter"><input aria-label="已有库存型号" placeholder="搜索型号" value={candidatePart} disabled={locked} onChange={e => setCandidatePart(e.target.value)}/><input aria-label="已有库存品牌" placeholder="搜索品牌" value={candidateBrand} disabled={locked} onChange={e => setCandidateBrand(e.target.value)}/><button disabled={locked} onClick={() => { setCandidateSearch({ partNumber: candidatePart.trim(), brand: candidateBrand.trim() }); setDialog({ ...dialog, row: undefined }); }}>搜索库存</button></div><p className="mall-hint">仅列出未纳入商城的库存，最多30条。原库存已上架的物料须先在原库存页下架；保存不会自动发布。</p><div className="mall-candidate-list">{candidateRows.map(row => <label className="mall-candidate" key={row.inventoryId}><input type="radio" name="mall-candidate" aria-label={`选择 ${row.partNumber} ${row.brand ?? ""}`} checked={dialog.row?.inventoryId === row.inventoryId} disabled={locked || row.status === "published"} onChange={() => { setDialog({ ...dialog, row }); setFormError(""); }}/><span><strong>{row.partNumber}</strong><small>{row.brand || "—"} · {row.pkg || "—"} · DC {row.dateCode || "—"}</small></span><span>{row.status === "published" ? "原库存已上架，须先下架" : `可售 ${count(row.qtyOnSale)}`}</span></label>)}{!candidateRows.length && <p className="mall-empty">{candidates.isFetching ? "读取库存中…" : candidates.isError ? "读取失败，请重新搜索" : "没有可选择的未纳入库存"}</p>}</div></div> : dialog.kind === "create" || dialog.kind === "save" ? <fieldset className="mall-form" disabled={locked}>
        {([['partNumber', '型号', 128], ['brand', '品牌', 64], ['pkg', '封装', 32], ['dateCode', '生产周期/DC', 32], ['qtyStock', '实际库存', 32], ['qtyOnSale', '现货上架量', 32], ['qtyOrder', '订货数量（未知可留空）', 32], ['priceEx', '单价（询价可留空）', 32], ['moq', '起订量MOQ', 32], ['spq', '包装倍数SPQ', 32], ['leadTime', '真实货期', 128]] as const).map(([key, label, maxLength]) => <label key={key}>{label}<input aria-label={label} value={form[key]} maxLength={maxLength} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}/></label>)}
        <label>税口径<select aria-label="税口径" value={form.taxIncluded ? "taxed" : "untaxed"} onChange={e => setForm(f => ({ ...f, taxIncluded: e.target.value === "taxed" }))}><option value="taxed">含税价</option><option value="untaxed">未税价（仅支持询价）</option></select></label>
        <fieldset className="mall-tiers"><legend>阶梯报价（最多64档）</legend><p className="mall-hint">起订数量须为正整数并严格递增，单价大于0；整档留空可省略，不填演示价。</p>{form.tiers.map((tier, i) => <div className="mall-tier-row" key={i}><label>起订数量<input aria-label={`第${i + 1}档起订数量`} value={tier.minQty} onChange={e => setForm(f => ({ ...f, tiers: f.tiers.map((t, j) => j === i ? { ...t, minQty: e.target.value } : t) }))}/></label><span>+</span><label>单价 CNY<input aria-label={`第${i + 1}档单价`} value={tier.price} onChange={e => setForm(f => ({ ...f, tiers: f.tiers.map((t, j) => j === i ? { ...t, price: e.target.value } : t) }))}/></label><button aria-label={`删除第${i + 1}档`} onClick={() => setForm(f => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }))}>删除</button></div>)}<button disabled={form.tiers.length >= 64} onClick={() => setForm(f => ({ ...f, tiers: f.tiers.length < 64 ? [...f.tiers, { minQty: "", price: "" }] : f.tiers }))}>增加档位</button></fieldset>
        <label className="mall-wide">公开备注（最多50字）<input aria-label="公开备注" maxLength={50} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}/></label><p className="mall-wide mall-hint">保存到待上架，不自动发布。原库存照片（{dialog.row?.photos?.length ?? 0}张）、分类、仓库、开票和环保属性保留；不虚构图片或供应数量。</p>
      </fieldset> : <><p>{dialog.kind === "publish" ? "确认公开当前真实库存、报价、阶梯价与货期。缺报价可询价，未税报价仅支持询价；购买继续校验登录、企业、起订量和库存。" : "停止商城公开展示并下架原可售库存。旧订单和询价记录保留，旧购物车结算会再次核验。"}</p>{dialog.row && <div className="mall-confirm-details"><Quote row={dialog.row}/><p>封装 {dialog.row.pkg || "—"} · DC {dialog.row.dateCode || "—"}</p><p>现货上架 {count(dialog.row.qtyOnSale)} / 实际库存 {count(dialog.row.qtyStock)} · 订货 {count(dialog.row.qtyOrder)}</p><p>MOQ {count(dialog.row.moq)} · SPQ {count(dialog.row.spq)} · 货期 {dialog.row.leadTime || "—"}</p></div>}</>}
      {formError && <p className="mall-form-error" role="alert">{formError}</p>}
      <div className="mall-dialog-actions"><button disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="mall-primary" disabled={locked || !dialogCanSubmit} onClick={() => void submit()}>{busy ? "正在核验…" : dialog.kind === "create" ? "保存到待上架" : dialog.kind === "save" ? "保存草稿" : dialog.kind === "publish" ? "确认上架" : "确认下架"}</button></div>
    </section></div>}
  </section>;
}
