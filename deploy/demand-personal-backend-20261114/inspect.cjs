'use strict';
const C = require('./core.cjs');
const { fs, ts, path, sha, assert, read, parse, walk, refs } = C;
const PINNED = { admin: '7c3f46be547e356fd35b853efa6cec2bed77cf23e393aa9003b646f2797eb442', front: '51dd6c3116ee2e8b2cd52c10c69274f168e2c0a094485fefc38948825ac1e735' };
function describe(p, d) {
  const start=d.node.getStart(p.sf), end=d.node.end;
  return {name:d.name,module:d.module,kind:ts.SyntaxKind[d.node.kind],start,end,byteStart:Buffer.byteLength(p.text.slice(0,start)),byteEnd:Buffer.byteLength(p.text.slice(0,end)),sha256:sha(p.text.slice(start,end)),import:d.import,exported:d.exported,refs:refs(p,d.node).map(r=>({name:r.name,module:r.module,import:r.import,exported:r.exported}))};
}
function inspect(baselineDir) {
  const report={pins:PINNED,apis:{}};
  for(const key of ['admin','front']) {
    const file=path.join(baselineDir,key+'-index.js'), bytes=fs.readFileSync(file);
    assert(sha(bytes)===PINNED[key],'LIVE_BASELINE_PIN '+key);
    const p=parse(file,bytes.toString('utf8'));
    assert(bytes.equals(Buffer.from(p.text)),'BASELINE_UTF8 '+key);
    const app=p.byName('appRouter');
    const owner={...describe(p,app),properties:[]};
    let object=app.node.initializer?.arguments?.find(n=>ts.isObjectLiteralExpression(n));
    if(!object) {
      const factory=refs(p,app.node).filter(d=>ts.isFunctionDeclaration(d.node));
      for(const d of factory) {const objects=[];walk(d.node,n=>{if(ts.isObjectLiteralExpression(n)&&n.properties.some(x=>x.name?.text==='auth'))objects.push(n);});if(objects.length===1){object=objects[0];owner.factory=describe(p,d);break;}}
    }
    assert(object,'APP_ROUTER_OBJECT_MISSING '+key);
    owner.objectStart=object.getStart(p.sf);owner.objectEnd=object.end;
    owner.properties=object.properties.map(n=>({name:n.name?.text,kind:ts.SyntaxKind[n.kind],text:n.getText(p.sf),start:n.getStart(p.sf),end:n.end}));
    const relevant=p.decls.filter(d=> /customerDemands|customerDemand\.ts|shared\/customerDemands|personal|server\/_core\/trpc\.ts|server\/db\.ts|server\/adminAuth\.ts|shared\/erpPermissions/.test(d.module||''));
    report.apis[key]={file,sha256:sha(bytes),bytes:bytes.length,declarationCount:p.decls.length,appRouter:owner,relevantDeclarations:relevant.map(d=>describe(p,d))};
  }
  return report;
}
if(require.main===module){const report=inspect(process.argv[2]||'/home/ubuntu/work/demand-personal-center/baseline');const out=process.argv[3];if(out){fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(out);}else console.log(JSON.stringify(report,null,2));}
module.exports={inspect,PINNED,describe};
