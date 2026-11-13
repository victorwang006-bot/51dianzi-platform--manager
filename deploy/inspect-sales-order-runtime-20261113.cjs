const fs=require('fs'),ts=require('typescript');
const B='/home/ubuntu/work/orders-baseline';
function ns(r,p){const o=[];function v(n){if(p(n))o.push(n);n.forEachChild(v)}v(r);return o}
for(const u of JSON.parse(fs.readFileSync(B+'/selected-urls.json'))){
 const s=fs.readFileSync(B+u,'utf8'),a=ts.createSourceFile(u,s,99,true,1);console.log('\nFILE',u);
 if(u.includes('DashboardLayout')){const cap=ns(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__admin_workbench_nav_v1')[0];console.log('CAP',cap.getStart(a),cap.end);for(const n of ns(cap,n=>ts.isFunctionDeclaration(n)&&['Ee','Ve','pe','te'].includes(n.name?.text)))console.log(n.name.text,n.getText(a).slice(0,1800));continue}
 for(const n of a.statements){
  const t=n.getText(a);
  if(ts.isImportDeclaration(n))console.log(t.slice(0,1600));
  if(ts.isFunctionDeclaration(n)&&(/marketplace\.seller|crm\.sales_orders|BusinessWorkbenchAccessProvider is required/.test(t)||t.includes('path:"/orders"')||t.includes('path:"/outbound"')))console.log('FUNC',n.name.text,t.slice(0,22000));
 }
}
