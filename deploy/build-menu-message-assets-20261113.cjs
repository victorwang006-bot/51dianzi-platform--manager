const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto'),path=require('path'),ts=require('typescript');
const BASE='/home/ubuntu/work/menu-production-baseline',OUT='/home/ubuntu/work/menu-candidate';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const proof=JSON.parse(fs.readFileSync('/home/ubuntu/work/admin-message-refresh-production-patch-points.json'));
const layoutRows=proof.patches.filter(x=>x.name.startsWith('operations-'));
fs.mkdirSync(OUT,{recursive:true});
const extras=layoutRows.map(x=>{const s=fs.readFileSync(x.baselineFile,'utf8'),i=s.indexOf(x.old);assert(i>=0&&s.indexOf(x.old,i+1)<0);return {start:i,end:i+x.old.length,before:x.old,after:x.new,reason:x.name};});
fs.writeFileSync(OUT+'/layout-extra-patches.json',JSON.stringify(extras,null,2)+'\n');
const rows=proof.patches.filter(x=>!x.name.startsWith('operations-')),file=rows[0].baselineFile,before=fs.readFileSync(file,'utf8'),beforeUrl=file.split('/menu-production-baseline')[1],edits=[];
for(const x of rows){let i=-1,count=0;while((i=before.indexOf(x.old,i+1))>=0){edits.push({start:i,end:i+x.old.length,before:x.old,after:x.new,reason:x.name});count++;}assert.equal(count,x.expectedMatches);}
edits.sort((a,b)=>a.start-b.start);let after=before;for(const p of [...edits].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);let delta=0;for(const p of edits){p.afterStart=p.start+delta;p.afterEnd=p.afterStart+p.after.length;delta+=p.after.length-p.before.length;}let inverse=after;for(const p of [...edits].reverse())inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);assert.equal(inverse,before);
// Keep exactly the old directory so relative imports continue resolving identically.
const url=path.posix.dirname(beforeUrl)+'/Messages-operations-unread-refresh-'+sha(after)+'.js';fs.mkdirSync(path.dirname(OUT+url),{recursive:true});fs.writeFileSync(OUT+url,after);
fs.writeFileSync(OUT+'/messages-patches.json',JSON.stringify(edits,null,2)+'\n');fs.writeFileSync(OUT+'/messages-build-proof.json',JSON.stringify({beforeUrl,url,beforeSha256:sha(before),sha256:sha(after),patches:edits.length,exactInverse:true,allNonpatchBytesUnchanged:true},null,2)+'\n');
if(process.argv.includes('--html')){
 const layout=JSON.parse(fs.readFileSync(OUT+'/layout-build-proof.json')),htmlBefore=fs.readFileSync(BASE+'/admin-before.html','utf8');
 const regex=/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g,matches=[...htmlBefore.matchAll(regex)];assert.equal(matches.length,1);
 const match=matches[0],mapBefore=JSON.parse(match[1]),relocations={[layout.beforeUrl]:layout.url,[beforeUrl]:url};let mapText=match[1];const changed=[];
 for(const [oldUrl,newUrl] of Object.entries(relocations)){
  const literal=JSON.stringify(oldUrl),escaped=literal.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('("(?:[^"\\\\]|\\\\.)+"\\s*:\\s*)'+escaped,'g');let n=0;
  mapText=mapText.replace(pattern,(_,prefix)=>{n++;return prefix+JSON.stringify(newUrl)});assert(n>0,'existing importmap alias target '+oldUrl);changed.push({oldUrl,newUrl,occurrences:n});
 }
 let mapAfter=JSON.parse(mapText);const clonedScopes=[];
 for(const [oldUrl,newUrl] of Object.entries(relocations)){
  const oldScopes=Object.keys(mapAfter.scopes??{}).filter(scope=>oldUrl.startsWith(scope)&&!newUrl.startsWith(scope)).sort((a,b)=>b.length-a.length);
  if(oldScopes.length){const scope=oldScopes[0];assert(!mapAfter.scopes[newUrl]);clonedScopes.push({oldScope:scope,newScope:newUrl,table:mapAfter.scopes[scope]});}
 }
 if(clonedScopes.length){
  const ast=ts.parseJsonText('importmap.json',mapText);assert.equal(ast.parseDiagnostics.length,0);const scopesNode=ast.statements[0].expression.properties.find(p=>p.name.text==='scopes').initializer;
  const insertion=clonedScopes.map(x=>JSON.stringify(x.newScope)+':'+JSON.stringify(x.table)).join(',');mapText=mapText.slice(0,scopesNode.end-1)+','+insertion+mapText.slice(scopesNode.end-1);mapAfter=JSON.parse(mapText);
 }
 assert.deepEqual(Object.keys(mapBefore.imports),Object.keys(mapAfter.imports));
 for(const [k,v] of Object.entries(mapBefore.imports))assert.equal(mapAfter.imports[k],relocations[v]??v);
 assert.deepEqual(Object.keys(mapAfter.scopes??{}),[...Object.keys(mapBefore.scopes??{}),...clonedScopes.map(x=>x.newScope)]);
 for(const [scope,table] of Object.entries(mapBefore.scopes??{})){assert.deepEqual(Object.keys(table),Object.keys(mapAfter.scopes[scope]));for(const [k,v]of Object.entries(table))assert.equal(mapAfter.scopes[scope][k],relocations[v]??v);}
 for(const x of clonedScopes)assert.deepEqual(mapAfter.scopes[x.newScope],mapAfter.scopes[x.oldScope],'preserved exact scoped dependencies');
 const start=match.index+match[0].indexOf(match[1]);let htmlAfter=htmlBefore.slice(0,start)+mapText+htmlBefore.slice(start+match[1].length);assert(htmlAfter.includes('</head>'));htmlAfter=htmlAfter.replace('</head>',`<link rel="stylesheet" href="${layout.cssUrl}" data-primary-menu-reminders="20261113">\n</head>`);
 fs.writeFileSync(OUT+'/index.html',htmlAfter);
 const records=[{relative:'index.html',sha256:sha(htmlAfter)},{relative:layout.url.slice(1),sha256:layout.sha256},{relative:url.slice(1),sha256:sha(after)},{relative:layout.cssUrl.slice(1),sha256:layout.cssSha256}];
 fs.writeFileSync(OUT+'/files.json',JSON.stringify(records,null,2)+'\n');fs.writeFileSync(OUT+'/html-build-proof.json',JSON.stringify({beforeSha256:sha(htmlBefore),sha256:sha(htmlAfter),relocations,changed,preservedImportKeys:true,preservedScopes:true,clonedScopes:clonedScopes.map(({oldScope,newScope})=>({oldScope,newScope})),onlyNewStylesheet:layout.cssUrl},null,2)+'\n');console.log(JSON.stringify({messages:url,files:records.length,htmlSha256:sha(htmlAfter),changed}));
}else console.log(JSON.stringify({messages:url,layoutExtras:extras.length}));
