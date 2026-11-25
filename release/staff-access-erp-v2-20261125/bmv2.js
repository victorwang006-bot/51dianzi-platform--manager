function __bmV2(P){
const{organization:O,frontUserId:U,canEditBiz:E,onSaveTeam:ST,onSaveAccess:SA,draft:D,toggleKey:TK,canErp:CE,busy:BZ,grantable:GR,member:MB,actorIsOwner:AO,readonlyNote:RN,apiRef:AR,onDirty:OD}=P;
const m=pe.useMemo(()=>O?.members?.find(x=>x.userId===U)??null,[O,U]);
const teams=pe.useMemo(()=>(O?.teams??[]).filter(t=>t.status==="active"),[O]);
const owner=!!MB?.isOwner;
const base=pe.useMemo(()=>{if(!m)return null;const g=k=>m.moduleAccess?.find(x=>x.module===k)??null;const c=g("customers"),d=g("demands"),s=g("stocks"),h=g("channels");if(!c||!d||!s||!h)return null;
return{teamId:m.teamId??null,role:m.teamId===null?null:(m.teamRole??"member"),cust:c.scope,stock:s.scope==="enterprise"?"team":s.scope,stockOn:!!(s.read&&h.read)}},[m]);
const[d,setD]=pe.useState(base);const[b,setB]=pe.useState(!1);const[er,setEr]=pe.useState(null);
const pb=pe.useRef({base,uid:m?.userId??null});const fr=pe.useRef(!1);
pe.useEffect(()=>{const prev=pb.current;const uid=m?.userId??null;pb.current={base,uid};const force=fr.current||prev.uid!==uid;fr.current=!1;setD(cur=>force||!cur||!prev.base||JSON.stringify(cur)===JSON.stringify(prev.base)?base:cur);if(force)setEr(null)},[base]);
const dirty=!!(base&&d&&!owner&&JSON.stringify(d)!==JSON.stringify(base));
pe.useEffect(()=>{OD&&OD(dirty)},[dirty]);
const save=async()=>{if(!m||!base||!d||owner)return;setB(!0);setEr(null);fr.current=!0;try{
 if(d.teamId!==base.teamId||d.role!==base.role){const r=await ST({teamId:d.teamId,teamRole:d.teamId===null?null:d.role,revision:m.revision});if(r&&r.warning)throw new Error(r.warning)}
 if(d.cust!==base.cust||d.stock!==base.stock||d.stockOn!==base.stockOn){const g=k=>m.moduleAccess.find(x=>x.module===k);const c=g("customers"),dm=g("demands"),s=g("stocks"),h=g("channels");
  const mods=[{module:"customers",read:c.read,write:c.write,scope:d.cust,expectedRevision:c.revision},{module:"demands",read:dm.read,write:dm.write,scope:d.cust,expectedRevision:dm.revision},
  {module:"channels",read:d.stockOn?(base.stockOn?h.read:!0):!1,write:d.stockOn?(base.stockOn?h.write:!0):!1,scope:"self",expectedRevision:h.revision},
  {module:"stocks",read:d.stockOn?(base.stockOn?s.read:!0):!1,write:d.stockOn?(base.stockOn?s.write:!0):!1,scope:d.stock,expectedRevision:s.revision}];
  await SA({userId:m.userId,modules:mods})}
 return!0}catch(x){fr.current=!1;setEr(x instanceof Error?x.message:"保存失败");throw x}finally{setB(!1)}};
pe.useEffect(()=>{if(AR)AR.current={dirty,save}});
const LB={self:"本人",team:"本团队",enterprise:"全公司"};
const has=k=>owner||D.erpPermissionKeys.includes(k);
const canK=k=>CE&&!BZ&&GR.has(k);
const dis=!E||b||BZ||owner||!d;
const role=d?.role??null;
const setRole=r=>setD(cur=>{if(!cur||cur.teamId===null)return cur;const x={...cur,role:r};if(r==="leader"){if(x.cust==="self")x.cust="team";if(x.stock==="self")x.stock="team"}else{if(x.cust==="team")x.cust="self";if(x.stock==="team")x.stock="self"}return x});
const setTeam=v=>setD(cur=>{if(!cur)return cur;const id=v===""?null:Number(v);const x={...cur,teamId:id,role:id===null?null:(cur.role??"member")};if(id===null){if(x.cust==="team")x.cust="self";x.stock="self"}else if(x.role!=="leader"&&x.cust==="team")x.cust="self";return x});
const custOpts=()=>{const o=["self"];if(role==="leader"&&d?.teamId!==null)o.push("team");if(owner||D.erpPermissionKeys.includes("customers.manage_all")||base?.cust==="enterprise")o.push("enterprise");if(d&&!o.includes(d.cust))o.push(d.cust);return o};
const stockOpts=()=>{const o=["self"];if(d?.teamId!==null)o.push("team");if(d&&!o.includes(d.stock))o.push(d.stock);return o};
const sel=(v,opts,on,lab,off)=>n("select",{"aria-label":lab,className:"h-8 rounded-md border bg-background px-2 text-sm",style:{minWidth:96},value:v,disabled:dis||off,onChange:e=>on(e.target.value),children:opts.map(o=>n("option",{value:o,children:LB[o]},o))});
const fixed=t=>n("span",{className:"inline-flex h-8 items-center rounded-md bg-muted px-3 text-sm text-muted-foreground",children:t});
const cb=(checked,disabled,on,lab)=>n("input",{type:"checkbox","aria-label":lab,className:"h-4 w-4 accent-primary",checked:checked,disabled:disabled,onChange:on});
const keyBox=(keys,lab)=>{const on=keys.some(has);const off=owner||!CE||BZ||!keys.some(k=>GR.has(k))||keys.some(k=>has(k)&&!GR.has(k));return cb(on,off,()=>{keys.forEach(k=>{if(!GR.has(k))return;if(on?has(k):!has(k))TK(k)})},lab+"开通")};
const custL=owner?"全公司":LB[d?.cust??"self"];
const purL=owner?"全公司":role==="leader"?"本团队":"本人";
const rows=[
 ["customers","客户","列表 · 跟进 · 需求",keyBox(["customers.manage"],"客户"),owner||!d?fixed(custL):sel(d.cust,custOpts(),v=>setD(c=>({...c,cust:v})),"客户数据范围",!has("customers.manage"))],
 ["inquiry","询价接待","分配给本人的询价",keyBox(["inquiry.receive"],"询价接待"),fixed("本人")],
 ["purchase","采购","需求报价 · 采购入库",keyBox(["procurement.demands","inventory.inbound"],"采购"),fixed(purL)],
 ["sales","销售订单",null,keyBox(["sales.business_orders"],"销售订单"),fixed(custL)],
 ["stocks","库存列表","含渠道库存",cb(owner||!!d?.stockOn,dis,e=>{const v=e.target.checked;setD(c=>({...c,stockOn:v}))},"库存列表开通"),owner||!d?fixed(owner?"全公司":LB[base?.stock??"self"]):sel(d.stock,stockOpts(),v=>setD(c=>({...c,stock:v})),"库存数据范围",!d.stockOn)],
 ["mall","商城物料",null,cb(owner||!!D.adminPermissions?.includes("officialInventory.read"),!0,()=>{},"商城物料开通"),fixed("全公司")]];
const segBtn=(r,l)=>n("button",{type:"button",disabled:dis||d?.teamId===null,onClick:()=>setRole(r),"aria-pressed":role===r,style:{height:32,padding:"0 16px",border:0,borderLeft:r==="leader"?"1px solid var(--border)":0,background:role===r?"var(--primary)":"var(--background)",color:role===r?"var(--primary-foreground)":"inherit",fontSize:14,cursor:dis?"not-allowed":"pointer"},children:l},r);
if(!MB)return n("div",{className:"rounded-md border border-dashed p-3 text-sm text-muted-foreground",children:"完成成员关联后可配置业务权限。"});
return i(Oe,{children:[
 RN?n("div",{role:"status",className:"rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground",children:RN}):null,
 i("section",{className:"space-y-2 rounded-md border p-3","data-staff-sheet-section":"business-team",children:[n("h3",{className:"text-sm font-medium",children:"团队身份"}),
  d&&!owner?i("div",{className:"flex flex-wrap items-center gap-3",children:[
   n("select",{"aria-label":"所属团队",className:"h-8 rounded-md border bg-background px-2 text-sm",value:d.teamId===null?"":String(d.teamId),disabled:dis,onChange:e=>setTeam(e.target.value),children:[n("option",{value:"",children:"未分组"},"none"),...teams.map(t=>n("option",{value:String(t.id),children:t.name},t.id))]}),
   i("div",{role:"group","aria-label":"团队岗位",style:{display:"inline-flex",border:"1px solid var(--border)",borderRadius:6,overflow:"hidden"},children:[segBtn("member","组员"),segBtn("leader","组长")]})]})
  :n("p",{className:"text-sm",children:owner?(teams.find(t=>t.id===m?.teamId)?.name??"")+" · 所有者":"—"})]}),
 i("section",{className:"space-y-2 rounded-md border p-3","data-staff-sheet-section":"business-access",children:[n("h3",{className:"text-sm font-medium",children:"业务权限"}),
  i("table",{className:"w-full text-sm",children:[n("thead",{children:i("tr",{className:"text-left text-xs text-muted-foreground",children:[n("th",{className:"py-1.5 font-normal",children:"模块"}),n("th",{className:"w-14 text-center font-normal",children:"开通"}),n("th",{className:"w-32 font-normal",children:"数据范围"})]})}),
  n("tbody",{children:rows.map(([k,l,sub,on,sc])=>i("tr",{className:"border-t",children:[i("td",{className:"py-2",children:[n("div",{children:l}),sub?n("div",{className:"text-xs text-muted-foreground",children:sub}):null]}),n("td",{className:"text-center",children:on}),n("td",{children:sc})]},k))})]}),
  er?n("p",{role:"alert",className:"text-xs text-destructive",children:er}):null]}),
 i("section",{className:"rounded-md border p-3","data-staff-sheet-section":"business-admin",children:[i("details",{className:"staff-permission-advanced",style:{borderTop:0,paddingTop:0},children:[n("summary",{className:"text-sm font-medium",children:"管理权限"}),
  i("div",{className:"grid gap-1.5 sm:grid-cols-2",children:[["enterprise.members.manage","用户与权限管理"],["customers.manage_all","客户分配与转移"]].map(([k,l])=>i("label",{className:"flex min-h-8 items-center gap-2 rounded-md border px-2 text-sm",children:[cb(has(k),!canK(k)||owner,()=>TK(k),l),n("span",{children:l})]},k))})]})]})
]})}
