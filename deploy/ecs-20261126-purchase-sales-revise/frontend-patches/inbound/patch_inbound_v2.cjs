#!/usr/bin/env node
'use strict';
// Usage: node patch_inbound_v2.cjs <input live.js> <output.js>
// Only __d51_procurement_inbound_get is changed. All anchors fail closed.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const deps = path.resolve(__dirname, '../node_modules');
const prettier = require(path.join(deps, 'prettier'));
const parser = require(path.join(deps, '@babel/parser'));
const traverse = require(path.join(deps, '@babel/traverse')).default;
const generate = require(path.join(deps, '@babel/generator')).default;
const t = require(path.join(deps, '@babel/types'));
const [, , inputPath, outputPath] = process.argv;
assert(inputPath && outputPath, 'Usage: node patch_inbound_v2.cjs <input.js> <output.js>');
function compileJSX(source) {
  const ast = parser.parse(source, {sourceType:'script',plugins:['jsx']});
  function tag(n) {
    if(t.isJSXIdentifier(n)) return /^[a-z]/.test(n.name) ? t.stringLiteral(n.name) : t.identifier(n.name);
    if(t.isJSXMemberExpression(n)) return t.memberExpression(tagMember(n.object),t.identifier(n.property.name));
    throw new Error('Unsupported JSX tag');
  }
  function tagMember(n) { return t.isJSXIdentifier(n) ? t.identifier(n.name) : t.memberExpression(tagMember(n.object),t.identifier(n.property.name)); }
  function children(nodes) {
    return nodes.flatMap(n => {
      if(t.isJSXText(n)) { const s = n.value.replace(/\r/g,'').split('\n').map((line,i,all) => all.length>1?line.trim():line).filter(Boolean).join(' '); return s ? [t.stringLiteral(s)] : []; }
      if(t.isJSXExpressionContainer(n)) return t.isJSXEmptyExpression(n.expression) ? [] : [n.expression];
      return [n];
    });
  }
  const call = args => t.callExpression(t.memberExpression(t.identifier('d'), t.identifier('createElement')),args);
  traverse(ast, {
    JSXElement: {exit(p) {
      const attrs=p.node.openingElement.attributes.map(a => {
        if(t.isJSXSpreadAttribute(a)) return t.spreadElement(a.argument);
        const value=a.value==null?t.booleanLiteral(true):t.isJSXExpressionContainer(a.value)?a.value.expression:a.value;
        return t.objectProperty(t.stringLiteral(a.name.name),value);
      });
      p.replaceWith(call([tag(p.node.openingElement.name),attrs.length?t.objectExpression(attrs):t.nullLiteral(),...children(p.node.children)]));
    }},
    JSXFragment: {exit(p) {p.replaceWith(call([t.memberExpression(t.identifier('d'),t.identifier('Fragment')),t.nullLiteral(),...children(p.node.children)]));}}
  });
  return generate(ast, {comments:true,jsescOption:{minimal:false}}).code;
}
(async () => {
  const input = fs.readFileSync(inputPath,'utf8');
  const raw = fs.readFileSync(path.join(__dirname,'original_module.js'),'utf8').replace(/^const __f\s*=\s*/, '').replace(/;\s*$/,'');
  const start=input.indexOf(raw);
  assert(start>=0 && input.indexOf(raw,start+1)<0,'Original procurement module must occur exactly once; input is already patched or incompatible.');
  let source=(await prettier.format(raw,{parser:'babel'})).trimEnd();
  function once(from,to,label) {
    const at=source.indexOf(from); assert(at>=0 && source.indexOf(from,at+1)<0,'Anchor not found/unique: '+label);
    source=source.slice(0,at)+to+source.slice(at+from.length);
  }
  function range(from,to,replacement,label) {
    const begin=source.indexOf(from); const end=source.indexOf(to,begin+from.length);
    assert(begin>=0&&end>begin&&source.indexOf(from,begin+1)<0&&source.indexOf(to,end+1)<0,'Range not found/unique: '+label);
    source=source.slice(0,begin)+replacement+source.slice(end);
  }
  const component=compileJSX(fs.readFileSync(path.join(__dirname,'inbound_v2.jsx'),'utf8'));
  const css='const __i2_CSS = '+JSON.stringify(fs.readFileSync(path.join(__dirname,'inbound_v2.css'),'utf8'))+';\nconst __i2_LIST_CSS = '+JSON.stringify(fs.readFileSync(path.join(__dirname,'inbound_list_v2.css'),'utf8'))+';\n';
  once('            var sr = 10,\n',css+component+'\n            var sr = 10,\n','new component scope');
  range('                    formOpen &&\n                      r(wt, {','                    confirmBulkClose &&',`                    formOpen && e(__i2_Dialog, {
                      key: storageScope + ':' + (editingRow?.id ?? createRequestId),
                      form, setForm, row: editingRow, draft: documentDraft, buyerScope, buyerError,
                      enabled: activeInboundIdentity, isCurrentScope: () => We() === storageScope,
                      requestId: createRequestId, onAuthorizationError,
                      retryBuyers: () => buyersQuery.refetch(), photoRef: photoInputRef,
                      uploadPhotos: uploadInboundPhotos, photoBusy: uploadPhotoMutation.isPending,
                      onClose: closeCreate,
                      onDone: () => { setBulkDirty(false); setBulkBusy(false); setFormOpen(false); setEditingRow(null); setDetailRow(null); refetch(); inboundUtils.overview.invalidate(); },
                      openPayment: (row) => { setFormOpen(false); openPayment(row); },
                      importer: e(go, {
                        documentOwnerScope: storageScope + ':bulk:' + createRequestId,
                        documentResponseFence: storageScope + ':' + contextVerification.authorizationVersion,
                        documentEnabled: activeInboundIdentity, uploadDocument, accessDocument, onAuthorizationError,
                        isCurrentDocumentScope: () => We() === storageScope,
                        buyerScope, buyerError, onRetryBuyers: () => buyersQuery.refetch(), buyerRetrying: buyersQuery.isFetching,
                        onCancel: closeCreate, onDirtyChange: setBulkDirty, onBusyChange: setBulkBusy,
                        onSuccess: () => { setBulkDirty(false); setBulkBusy(false); setFormOpen(false); refetch(); inboundUtils.overview.invalidate(); }
                      })
                    }),
`,'replace entire create/edit presentation');
  // Cancelled orders can open the same presentation; cost fields stay disabled.
  once(`                  if (row.status === "cancelled")
                    return p.error(
                      "\\u5DF2\\u4F5C\\u5E9F\\u5165\\u5E93\\u5355\\u4E0D\\u80FD\\u7F16\\u8F91",
                    );
`,'','open cancelled order');
  once(`                      inboundUtils.documents.fetch(
                        { id: row.id },
                        { staleTime: 0 },
                      ),`, `                      row.status === "cancelled" ? Promise.resolve([]) : inboundUtils.documents.fetch(
                        { id: row.id },
                        { staleTime: 0 },
                      ),`, 'cancelled read-only skips prohibited documents');
  // Existing entrypoints now all open the same editor, not a separate revise dialog.
  const click='                                              ) || setDetailRow(row);';
  once(click,'                                              ) || openEdit(row);','list row open');
  once('                                                  setDetailRow(row)));','                                                  openEdit(row)));','keyboard row open');
  once(`                                            children: "\\u6570\\u91CF / DC",`,`                                            children: "\\u6570\\u91CF / \\u5355\\u4EF7",`,'qty-price header');
  once(`                                          e("th", {
                                            children:
                                              "\\u8D27\\u7269\\u72B6\\u6001",
                                          }),`,`                                          e("th", { className: "inbound-numeric", children: "采购总成本" }),
                                          e("th", {
                                            children:
                                              "\\u8D27\\u7269\\u72B6\\u6001",
                                          }),`,'total cost header');
  const oldSub=`                                                  r("div", {
                                                    className:
                                                      "mt-0.5 text-[11px] text-muted-foreground",
                                                    children: [
                                                      "DC ",
                                                      row.prodYear || "\\u2014",
                                                    ],
                                                  }),`;
  const newSub=`                                                  e("div", {
                                                    className:"mt-0.5 text-[11px] text-muted-foreground",
                                                    children: row.priceMissing ? e("span", {className:"text-amber-700",children:"未录价格"}) : row.unitCostTaxIncluded == null ? "—" : "¥" + __i2_fmt(String(row.unitCostTaxIncluded), 4) + " 含税"
                                                  }),`;
  once(oldSub,newSub,'qty subline');
  once(newSub+`\n                                                ],
                                              }),`,newSub+`\n                                                ],
                                              }),
                                              e("td", { className: "inbound-numeric", children: row.costTotal === undefined ? "—" : row.costTotal == null || row.priceMissing ? "—" : r("div", {children:[
                                                e("div",{className:"font-semibold tabular-nums text-slate-800",children:"¥"+__i2_fmt(String(row.costTotal))}),
                                                row.unitCostTaxIncluded != null && __i2_scaled(row.costTotal,2) != null && __i2_scaled(row.unitCostTaxIncluded) != null && __i2_scaled(row.costTotal,2) > __i2_round(__i2_scaled(row.unitCostTaxIncluded)*BigInt(row.actualQty ?? row.qty),10000n) && e("div",{className:"mt-0.5 text-[11px] text-muted-foreground",children:"含费用 "+__i2_money(__i2_scaled(row.costTotal,2)-__i2_round(__i2_scaled(row.unitCostTaxIncluded)*BigInt(row.actualQty ?? row.qty),10000n))})
                                              ]}) }),`,'total cost cell');
  // Demo status tabs; counts are from authorized list(all), never guessed costs.
  once('                listQuery = Ue.inbound.list.useQuery(queryInput),', '                __i2AllRowsQuery = Ue.inbound.list.useQuery({status:"all"}),\n                listQuery = Ue.inbound.list.useQuery(queryInput),', 'authorized status counts');
  once('                  const next = {};', '                  const next = {status: filters.status || "all"};', 'all tab initial status');
  const tabStart = `                                r(Zn, {
                                  value: filterInput.status || "active",`;
  const tabEnd = `                                r(_e, {
                                  type: "button",
                                  size: "sm",
                                  variant: "outline",
                                  className:
                                    "h-8 min-w-[100px]`;
  range(tabStart, tabEnd, `                                e("div", { className:"i2-list-tabs", role:"tablist", "aria-label":"入库状态", children:[
                                  ["all","全部"],["in_transit","在途"],["received","已入库"],["cancelled","已作废"]
                                ].map(([status,label]) => e("button", {
                                  type:"button",role:"tab",key:status,
                                  "aria-selected": (filters.status || "all") === status,
                                  className: (filters.status || "all") === status ? "on" : "",
                                  onClick:() => { setFilterInput(value => ({...value,status})); setFilters(value => ({...value,status})); setPage(1); setSelectedIds(new Set()); },
                                  children:label + (__i2AllRowsQuery.data ? " " + __i2AllRowsQuery.data.filter(row => status === "all" || row.status === status).length : "")
                                })) }),
`, 'replace status dropdown with tabs');
  once(`                  children: [
                    r(Dr, {
                      className: "inbound-toolbar",`, `                  children: [
                    e("style", {children:__i2_LIST_CSS}),
                    r("div", {className:"i2-page-heading",children:[e("h1",{children:"采购入库"}),e("p",{children:"管理在途、入库、采购付款与验收记录"})]}),
                    r(Dr, {
                      className: "inbound-toolbar",`, 'list page heading');
  // Extra column in existing 8-col table. Keep sticky/batch behavior unchanged.
  once(`                                        e("col", { className: "w-[11%]" }),
                                        e("col", { className: "w-[10%]" }),`,`                                        e("col", { className: "w-[10%]" }),
                                        e("col", { className: "w-[11%]" }),
                                        e("col", { className: "w-[9%]" }),`,'list col widths');
  once('                              actionMenu.row.status !== "cancelled" &&\n                                e("button", {\n                                  role: "menuitem",\n                                  className: "erp-menu-item",\n                                  onClick: () => {\n                                    (openEdit(actionMenu.row),','                              e("button", {\n                                  role: "menuitem",\n                                  className: "erp-menu-item",\n                                  onClick: () => {\n                                    (openEdit(actionMenu.row),','cancelled edit menu');
  // Preserve no-undef baseline and ensure syntactic correctness before output.
  parser.parse('const __f = '+source+';',{sourceType:'module'});
  const result=input.slice(0,start)+source+input.slice(start+raw.length);
  assert(result.startsWith(input.slice(0,start))&&result.endsWith(input.slice(start+raw.length)),'Changes escaped procurement module');
  fs.writeFileSync(outputPath,result);
  fs.writeFileSync(path.join(__dirname,'compiled_module.js'),'const __f = '+source+';\n');
  fs.writeFileSync(path.join(__dirname,'component.runtime.js'),css+component+'\n');
  console.log('Procurement v2 patched:',start,raw.length,'->',source.length,'output:',outputPath);
})().catch(error => { console.error(error.message); process.exitCode=1; });
