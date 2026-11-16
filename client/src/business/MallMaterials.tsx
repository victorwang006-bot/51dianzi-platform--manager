import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./platform/front-router-types/server/routers";
import { trpc } from "./api/business-trpc";
import { useBusinessScope } from "./BusinessScope";
import { toast } from "sonner";
import "./MallMaterials.css";

type Row = inferRouterOutputs<AppRouter>["mallInventory"]["list"]["items"][number] & { inventoryFingerprint?: string };
type Action = "link" | "save" | "publish" | "offshelf";
type Tier = { minQty: string; price: string };
type Form = { partNumber: string; brand: string; pkg: string; dateCode: string; qtyStock: string; qtyOnSale: string; qtyOrder: string; priceEx: string; moq: string; spq: string; leadTime: string; taxIncluded: boolean; note: string; tiers: Tier[] };
type Dialog = { kind: Action | "create"; row?: Row; scope: string };
const statusNames = { draft: "草稿", published: "已上架", offshelf: "已下架" };
const count = (v: unknown) => v == null ? "—" : Number(v).toLocaleString("en-US");
const money = (v: unknown) => v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? "询价" : `¥${Number(v).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
const emptyForm = (): Form => ({ partNumber: "", brand: "", pkg: "", dateCode: "", qtyStock: "", qtyOnSale: "", qtyOrder: "", priceEx: "", moq: "10", spq: "1", leadTime: "", taxIncluded: true, note: "", tiers: [10, 50, 100].map(minQty => ({ minQty: String(minQty), price: "" })) });
function formFor(row: Row): Form {
  return { partNumber: row.partNumber, brand: row.brand ?? "", pkg: row.pkg ?? "", dateCode: row.dateCode ?? "", qtyStock: String(row.qtyStock), qtyOnSale: String(row.qtyOnSale), qtyOrder: row.qtyOrder == null ? "" : String(row.qtyOrder), priceEx: row.priceEx ?? "", moq: String(row.moq ?? 1), spq: String(row.spq ?? 1), leadTime: row.leadTime ?? "", taxIncluded: row.taxIncluded !== false, note: row.note ?? "", tiers: row.ladderPrices?.length ? row.ladderPrices.map(t => ({ minQty: String(t.minQty), price: String(t.price) })) : emptyForm().tiers };
}
function photoMime(mime: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return mime;
  throw new Error("原库存图片格式不符合现行规则，请先在原库存页处理；不会静默删除原图");
}
function formData(form: Form, original?: Row) {
  const number = (s: string, name: string) => { const n = Number(s); if (s.trim() === "" || !Number.isFinite(n)) throw new Error(`请填写有效${name}`); return n; };
  if (!form.partNumber.trim() || !form.brand.trim() || !form.leadTime.trim()) throw new Error("请填写型号、品牌及真实货期");
  const ladderPrices = form.tiers.filter(t => t.price.trim()).map(t => ({ minQty: number(t.minQty, "阶梯起订量"), price: number(t.price, "阶梯价格") }));
  return { partNumber: form.partNumber.trim(), brand: form.brand.trim(), category: original?.category ?? "", pkg: form.pkg.trim(), dateCode: form.dateCode.trim(), qtyStock: number(form.qtyStock, "实际库存"), qtyOnSale: number(form.qtyOnSale, "现货上架量"), qtyOrder: form.qtyOrder.trim() ? number(form.qtyOrder, "订货数量") : undefined, priceEx: form.priceEx.trim() ? number(form.priceEx, "单价") : undefined, taxIncluded: form.taxIncluded, invoice: original?.invoice ?? true, ladderPrices: ladderPrices.length ? ladderPrices : undefined, moq: number(form.moq, "起订量"), spq: number(form.spq, "包装倍数"), leadTime: form.leadTime.trim(), note: form.note, warehouseAddress: original?.warehouseAddress ?? undefined, rohs: original?.rohs ?? true, photos: original?.photos?.map(p => ({ ...p, mimeType: photoMime(p.mimeType) })) ?? undefined };
}

/** Stock remains in inventories; this page manages explicit publication references only. */
export default function MallMaterials() {
  const scope = useBusinessScope();
  const identity = `${scope.storageScope}:${scope.contextVerification.authorizationVersion}:${scope.officialInventoryPermissions.authorizationVersion}`;
  const latest = useRef(identity); latest.current = identity;
  const verified = scope.contextVerification.state === "verified";
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [state, setState] = useState<"" | "draft" | "published" | "offshelf">("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [unknownRequest, setUnknownRequest] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const status = trpc.mallInventory.status.useQuery(undefined, { enabled: verified, staleTime: 0 });
  const eligible = verified && status.data?.eligibility.eligible === true && status.data.context.enterpriseId === scope.staffPrincipal.enterpriseId;
  const list = trpc.mallInventory.list.useQuery({ partNumber: appliedKeyword || undefined, status: state || undefined, page, pageSize: 30 }, { enabled: eligible, placeholderData: undefined });
  const rows = eligible ? list.data?.items ?? [] : [];
  const permissions = status.data?.permissions;
  const canWrite = eligible && permissions?.write === true;
  const canPublish = eligible && permissions?.publish === true;
  useEffect(() => { setDialog(null); setBusy(false); setUnknownRequest(null); setKeyword(""); setAppliedKeyword(""); setState(""); setPage(1); }, [identity]);
  const refresh = () => { void status.refetch(); void utils.mallInventory.list.invalidate(); };
  const open = (kind: Dialog["kind"], row?: Row) => { if (!verified || busy || unknownRequest) return; setForm(row ? formFor(row) : emptyForm()); setDialog({ kind, row, scope: identity }); };
  const preview = (row?: Row) => window.open(`https://www.51dianzi.com/search?${new URLSearchParams({ ...(row ? { q: row.partNumber } : {}), selfOperatedOnly: "1" })}`, "_blank", "noopener,noreferrer");
  async function submit() {
    if (!dialog || dialog.scope !== identity || !verified || busy || unknownRequest || !status.data) return;
    if (dialog.kind === "create" ? !canWrite || !canPublish : dialog.kind === "publish" || dialog.kind === "offshelf" ? !canPublish : !canWrite) return;
    const lease = identity;
    let requestId: string | null = null;
    try {
      let data: ReturnType<typeof formData> | undefined;
      if (dialog.kind === "create" || dialog.kind === "save") data = formData(form, dialog.row);
      if (dialog.kind === "create" && !form.dateCode.trim()) throw new Error("新增物料请填写真实生产周期/DC");
      const row = dialog.row;
      if (dialog.kind !== "create" && (!row || !/^[a-f0-9]{64}$/.test(row.inventoryFingerprint ?? ""))) throw new Error("缺少当前商品确认指纹，请刷新；不能使用旧部署的确认资料");
      setBusy(true);
      if (dialog.kind === "create") {
        await utils.client.inventory.create.mutate({ data: data!, saveAs: "draft" });
        if (latest.current !== lease) return;
        toast.success("已保存原库存草稿", { description: "请在未关联物料中核对真实库存ID，再确认关联商城。不会自动上架。" });
      } else {
        requestId = crypto.randomUUID();
        const input = { inventoryId: row!.inventoryId, expectedVersion: row!.publicationVersion, expectedInventoryUpdatedAt: new Date(row!.inventoryUpdatedAt), expectedOwnershipVersion: row!.ownershipVersion, expectedPermissionVersion: status.data.context.permissionVersion, expectedAuthorizationVersion: status.data.context.authorizationVersion, expectedInventoryFingerprint: row!.inventoryFingerprint!, requestId };
        const result = dialog.kind === "save" ? await utils.client.mallInventory.save.mutate({ ...input, data: data! })
          : dialog.kind === "publish" ? await utils.client.mallInventory.publish.mutate(input)
          : dialog.kind === "offshelf" ? await utils.client.mallInventory.offshelf.mutate(input)
          : await utils.client.mallInventory.link.mutate(input);
        if (latest.current !== lease) return;
        if (!result.success) toast.error("未上架，请刷新核对发布条件"); else toast.success(dialog.kind === "link" ? "已关联为商城草稿" : dialog.kind === "publish" ? "已确认上架" : dialog.kind === "offshelf" ? "已下架" : "草稿已保存");
      }
      setDialog(null); refresh();
    } catch (e) {
      scope.onAuthorizationError(e);
      if (latest.current !== lease) return;
      toast.error(e instanceof Error ? e.message : "操作结果需要核对");
      if (requestId) setUnknownRequest(requestId);
    } finally { if (latest.current === lease) setBusy(false); }
  }
  async function inspectRequest() {
    if (!unknownRequest || !verified || busy) return;
    const lease=identity; setBusy(true);
    try {
      const result=await utils.client.mallInventory.requestStatus.query({ requestId: unknownRequest });
      if (latest.current !== lease) return;
      if (result.state === "completed") { toast.info("已找到原请求回执，请刷新核对物料状态"); setUnknownRequest(null); setDialog(null); refresh(); }
      else toast.info("尚无最终回执，保持停止；请稍后再核对，不要重复提交");
    } catch(e) { scope.onAuthorizationError(e); if(latest.current===lease) toast.error("暂时无法核对原请求，未重发任何操作"); }
    finally { if(latest.current===lease) setBusy(false); }
  }
  const locked = busy || !verified || !!unknownRequest;
  return <section className="mall-materials" aria-label="商城物料管理">
    <header className="mall-toolbar"><h1>商城物料</h1><span>仅管理真实库存引用，不重复维护库存</span><div className="mall-toolbar-actions"><button onClick={()=>preview()}>前台自营渠道</button><button className="mall-primary" disabled={!canWrite || !canPublish || locked} title="新增沿用原库存创建资格；独立编辑权限可关联已有库存，不自动获得发布权限" onClick={()=>open("create")}>新增物料</button></div></header>
    <div className="mall-filter"><input aria-label="搜索商城物料型号" placeholder="搜索型号" value={keyword} onChange={e=>setKeyword(e.target.value)}/><select aria-label="商城上架状态" value={state} onChange={e=>{setState(e.target.value as typeof state);setPage(1);}}><option value="">全部状态／未关联</option><option value="draft">草稿</option><option value="published">已上架</option><option value="offshelf">已下架</option></select><button onClick={()=>{setAppliedKeyword(keyword.trim());setPage(1);}} disabled={!verified}>筛选</button><button onClick={()=>{setKeyword("");setAppliedKeyword("");setState("");setPage(1);}}>重置</button><button onClick={refresh} disabled={busy}>刷新</button></div>
    {unknownRequest && <div className="mall-notice" role="alert">原请求结果尚待核对。未自动重发，也不会重复上架。<button disabled={busy} onClick={()=>void inspectRequest()}>核对原请求</button></div>}
    {!verified ? <p className="mall-notice">正在重新核验当前企业与权限，暂不可操作。</p> : status.isError ? <p className="mall-notice" role="alert">商城权限核验失败，请刷新；不会借用旧企业数据。</p> : status.isLoading ? <p>正在核验商城配置…</p> : !eligible ? <p className="mall-notice">{status.data?.eligibility.message ?? "商城尚未完成安全就绪"}。不会自动关联或上架历史物料。</p> : null}
    <div className="mall-table-wrap"><table><thead><tr><th>型号／品牌</th><th>封装／DC</th><th>现货上架／实际库存</th><th>货期</th><th>售价／阶梯价</th><th>MOQ／包装倍数</th><th>上架状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
      {rows.map(row=><tr key={row.inventoryId}><td><strong>{row.partNumber}</strong><small>{row.brand || "—"} · 库存ID {row.inventoryId}</small></td><td>{row.pkg || "—"}<small>DC {row.dateCode || "—"}</small></td><td>{count(row.qtyOnSale)} / {count(row.qtyStock)}<small>订货 {count(row.qtyOrder)}</small></td><td>{row.leadTime || "—"}</td><td>{money(row.priceEx)}<small>{row.taxIncluded ? "含税" : "未税·仅询价"}</small>{row.ladderPrices?.map((tier,i)=><small key={i}>{count(tier.minQty)}+　{money(tier.price)}</small>)}</td><td>{count(row.moq)} / {count(row.spq)}</td><td><span className={`mall-state ${row.publicationStatus || "unlinked"}`}>{row.publicationStatus ? statusNames[row.publicationStatus] : "未关联"}</span><small>原库存：{statusNames[row.status as keyof typeof statusNames] ?? row.status}</small></td><td>{new Date(row.inventoryUpdatedAt).toLocaleString("zh-CN", {hour12:false})}</td><td><div className="mall-row-actions">{!row.linked ? <button disabled={!canWrite || locked || row.status==="published"} title={row.status==="published" ? "请先在原库存页显式下架，再关联；不会自动商城化" : "确认引用真实库存为商城草稿"} onClick={()=>open("link",row)}>关联商城</button> : <><button disabled={!canWrite || locked || row.status==="published"} title="已上架需先下架，再修改并重新确认" onClick={()=>open("save",row)}>编辑</button>{row.publicationStatus==="published" || row.status==="published" ? <button disabled={!canPublish || locked} onClick={()=>open("offshelf",row)}>下架</button> : <button className="mall-primary" disabled={!canPublish || locked} onClick={()=>open("publish",row)}>上架</button>}</>}<button disabled={!row.isSelfOperated} onClick={()=>preview(row)}>前台预览</button></div></td></tr>)}
      {!rows.length && <tr><td colSpan={9} className="mall-empty">{list.isFetching ? "读取物料中…" : !eligible ? "商城未就绪" : list.isError ? "读取失败，请刷新" : "没有当前条件下的真实物料；不会用Demo价格或库存填充"}</td></tr>}
    </tbody></table></div>
    <footer className="mall-pagination"><span>共 {list.data?.total ?? 0} 条</span><button disabled={page<=1||list.isFetching} onClick={()=>setPage(p=>p-1)}>上一页</button><span>第 {page} 页</span><button disabled={page*30 >= (list.data?.total ?? 0)||list.isFetching} onClick={()=>setPage(p=>p+1)}>下一页</button></footer>
    {dialog && dialog.scope===identity && <div className="mall-dialog-overlay"><section className="mall-dialog" role="dialog" aria-modal="true" aria-labelledby="mall-dialog-title"><h2 id="mall-dialog-title">{dialog.kind==="create" ? "新增物料草稿" : dialog.kind==="save" ? "编辑商城草稿" : dialog.kind==="link" ? "关联真实库存" : dialog.kind==="publish" ? "确认上架" : "确认下架"}</h2>
      {dialog.row && <p><strong>{dialog.row.partNumber}</strong> · {dialog.row.brand} · 库存ID {dialog.row.inventoryId}</p>}
      {dialog.kind==="create" || dialog.kind==="save" ? <div className="mall-form">
        {([['partNumber','型号'],['brand','品牌'],['pkg','封装'],['dateCode','生产周期/DC'],['qtyStock','实际库存'],['qtyOnSale','现货上架量'],['qtyOrder','订货数量（未知可留空）'],['priceEx','单价（询价可留空）'],['moq','起订量MOQ'],['spq','包装倍数SPQ'],['leadTime','真实货期']] as const).map(([key,label])=><label key={key}>{label}<input value={form[key]} maxLength={['partNumber','brand','pkg','dateCode','leadTime'].includes(key)?128:32} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>)}
        <label>税口径<select value={form.taxIncluded ? "taxed":"untaxed"} onChange={e=>setForm(f=>({...f,taxIncluded:e.target.value==="taxed"}))}><option value="taxed">含税价</option><option value="untaxed">未税价（仅询价）</option></select></label>
        <fieldset className="mall-tiers"><legend>真实阶梯报价（留空不填演示价格）</legend>{form.tiers.map((tier,i)=><div key={i}><label>起订数量<input value={tier.minQty} onChange={e=>setForm(f=>({...f,tiers:f.tiers.map((t,j)=>j===i?{...t,minQty:e.target.value}:t)}))}/></label><span>+</span><label>单价<input value={tier.price} onChange={e=>setForm(f=>({...f,tiers:f.tiers.map((t,j)=>j===i?{...t,price:e.target.value}:t)}))}/></label></div>)}</fieldset>
        <label className="mall-wide">公开备注（最多50字）<input maxLength={50} value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/></label><p className="mall-wide">保存不自动上架。原库存产品图和附件保留；缺图、未知订货数量不虚构。</p>
      </div> : <p>{dialog.kind==="link" ? "仅建立商城草稿引用，不复制数量、不自动上架。" : dialog.kind==="publish" ? "将当前真实库存、价格、阶梯价和货期公开到51自营渠道。缺价或未税仅支持询价；购买继续原登录、企业、起订量及库存校验。" : "停止商城公开展示并下架原可售库存。旧订单和询价记录不删除，旧购物车结算会再次核验。"}</p>}
      <div className="mall-dialog-actions"><button disabled={busy} onClick={()=>setDialog(null)}>取消</button><button className="mall-primary" disabled={locked} onClick={()=>void submit()}>{busy ? "正在核验…" : dialog.kind==="create"||dialog.kind==="save" ? "保存草稿" : dialog.kind==="link" ? "确认关联" : dialog.kind==="publish" ? "确认上架" : "确认下架"}</button></div>
    </section></div>}
  </section>;
}
