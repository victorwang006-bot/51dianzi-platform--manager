'use strict';
const B=require('./backend-native.cjs');
const {C,S,ts,sha,assert,parse}=B;
const vm=require('node:vm'),orm=require('drizzle-orm'),mysql=require('drizzle-orm/mysql-core');
const {DatabaseSync}=require('node:sqlite');
function exactStatement(p,d){return ts.isVariableDeclaration(d.node)?B.variableStatement(d.node).getText(p.sf):d.node.getText(p.sf);}
function createHarness(record){
 const p=record.candidate,effects=[],loaded=new Set(),executed=[],context=vm.createContext({Buffer,Date,JSON,Map,Set,Math,Number,String,Array,Object,RegExp,Error,Promise,console:{log(){},warn(){},error(){}},process:{env:{}},URL});
 const overrides=new Map(),tables=new Map();
 function define(name,value){context[name]=value;overrides.set(name,value);}
 function load(name){if(loaded.has(name)||overrides.has(name))return context[name];const d=p.byName(name);loaded.add(name);if(d.import){const allowed={'drizzle-orm':orm,'drizzle-orm/mysql-core':mysql,'zod':require('zod'),'@trpc/server':require('@trpc/server'),'node:crypto':require('node:crypto')};assert(allowed[d.import]&&allowed[d.import][d.exported]!==undefined,'HARNESS_IMPORT_FORBIDDEN '+d.import+'#'+d.exported);context[name]=allowed[d.import][d.exported];return context[name];}
  assert(!['getDb','appRouter'].includes(name),'HARNESS_NATIVE_ENTRYPOINT_FORBIDDEN '+name);
  assert(!/(?:_core\/|adminAuth|sms\.ts)/.test(d.module||''),'HARNESS_EFFECT_OWNER_FORBIDDEN '+d.module+'#'+name);
  for(const r of C.refs(p,d.node))if(r.name!==name)load(r.name);
  const code=exactStatement(p,d);vm.runInContext(code,context,{timeout:5000});executed.push({runtimeName:name,module:d.module,candidateDeclarationSha256:sha(d.node.getText(p.sf)),candidateBytes:true});return context[name];
 }
 for(const name of ['adminUsers','adminStaffArchives','adminUserPermissions','adminUserSalesScopes','salesStaff','auditLogs','adminUserPermissionAudits']){const d=p.decls.filter(d=>d.module==='drizzle/schema.ts'&&d.name===name);assert(d.length===1,'EXACT_NATIVE_SCHEMA_OWNER '+name);tables.set(name,load(name));}
 const sqlite=new DatabaseSync(':memory:'),dialect=new mysql.MySqlDialect(),queries=[],transactions=[],fault={audit:false,cas:false,afterUpdate:null};
 const quote=n=>'`'+String(n).replace(/`/g,'``')+'`';
 const tableInfo=new Map();
 for(const [name,table] of tables){const cfg=mysql.getTableConfig(table);tableInfo.set(cfg.name,{table,cfg});const columns=cfg.columns.map(c=>quote(c.name)+' '+(c.name==='id'?'INTEGER PRIMARY KEY AUTOINCREMENT':/Int|Serial|Boolean/.test(c.columnType)?'INTEGER':'TEXT')+(c.name==='createdAt'||c.name==='updatedAt'?' DEFAULT CURRENT_TIMESTAMP':c.name==='sessionVersion'?' DEFAULT 1':''));sqlite.exec('CREATE TABLE '+quote(cfg.name)+' ('+columns.join(',')+')');}
 // Deliberately independent frontend/customer/member stores: no owner may
 // reference them; unchanged sentinel bytes are asserted in directed tests.
 sqlite.exec('CREATE TABLE frontend_members(id INTEGER PRIMARY KEY,status TEXT,sessionVersion INTEGER,passwordHash TEXT); INSERT INTO frontend_members VALUES(1,\'active\',9,\'front-secret\'); CREATE TABLE frontend_customers(id INTEGER PRIMARY KEY,payload TEXT); INSERT INTO frontend_customers VALUES(1,\'protected\');');
 function param(v){if(v===undefined)return null;if(v instanceof Date)return v.toISOString();if(typeof v==='boolean')return Number(v);if(typeof v==='object'&&v!==null)return JSON.stringify(v);return v;}
 function decode(rows){return rows.map(row=>{const out={...row};for(const [key,value] of Object.entries(out)){if(typeof value==='string'&&['beforeValue','afterValue','beforePermissions','afterPermissions','metadata','snapshot'].includes(key))try{out[key]=JSON.parse(value);}catch{}}return out;});}
 function run(text,params=[],select=false){assert(!/\b(?:frontend_|users|merchants|customers|portal_)\b/i.test(text),'HARNESS_FOREIGN_WRITE_OR_READ '+text);const sql=text.replace(/\s+FOR UPDATE\b/gi,'').replace(/<=>/g,'IS').replace(/\bNOW\(\)/gi,'CURRENT_TIMESTAMP');queries.push({sql:text,params:params.map(param),select});const statement=sqlite.prepare(sql);if(select)return decode(statement.all(...params.map(param)));const result=statement.run(...params.map(param));return {affectedRows:Number(result.changes),insertId:Number(result.lastInsertRowid)};}
 const fragment=q=>dialect.sqlToQuery(typeof q.toQuery==='function'?q:orm.sql`${q}`),tableName=t=>orm.getTableName(t),columnName=(table,key)=>table[key]?.name||key;
 function builder(kind,table,values,fields){let predicate=null,ordering=[],limit=null,offset=null,joins=[];const b={from(t){table=t;return b;},where(v){predicate=v;return b;},set(v){values=v;return b;},values(v){values=v;return b;},orderBy(...v){ordering=v;return b;},limit(v){limit=v;return b;},offset(v){offset=v;return b;},for(){return b;},innerJoin(t,on){joins.push({table:t,on,kind:'INNER'});return b;},leftJoin(t,on){joins.push({table:t,on,kind:'LEFT'});return b;},then(resolve,reject){return Promise.resolve().then(()=>{
   const params=[],add=q=>{const f=fragment(q);params.push(...f.params);return f.sql;};let text;
   if(kind==='select'){let projection='*';if(fields)projection=Object.entries(fields).map(([key,value])=>add(value)+' AS '+quote(key)).join(', ');text='SELECT '+projection+' FROM '+quote(tableName(table));for(const j of joins)text+=' '+j.kind+' JOIN '+quote(tableName(j.table))+' ON '+add(j.on);}
   else if(kind==='delete')text='DELETE FROM '+quote(tableName(table));
   else if(kind==='update'){text='UPDATE '+quote(tableName(table))+' SET '+Object.entries(values).map(([key,value])=>{if(value&&typeof value.getSQL==='function')return quote(columnName(table,key))+' = '+add(value);params.push(value);return quote(columnName(table,key))+' = ?';}).join(', ');}
   else {if(fault.audit&&tableName(table)==='audit_logs')throw new Error('MOCK_AUDIT_FAILURE');const rows=Array.isArray(values)?values:[values];if(!rows.length)return [{affectedRows:0,insertId:0}];const keys=Object.keys(rows[0]);text='INSERT INTO '+quote(tableName(table))+' ('+keys.map(k=>quote(columnName(table,k))).join(', ')+') VALUES '+rows.map(row=>'('+keys.map(k=>{params.push(row[k]);return '?';}).join(', ')+')').join(', ');}
   if(predicate)text+=' WHERE '+add(predicate);if(ordering.length)text+=' ORDER BY '+add(orm.sql.join(ordering,orm.sql`, `));if(limit!==null)text+=' LIMIT '+Number(limit);if(offset!==null)text+=' OFFSET '+Number(offset);
   if(kind==='update'&&tableName(table)==='admin_users'&&fault.cas){fault.cas=false;queries.push({sql:text,params:params.map(param),forcedAffectedRows:0});return [{affectedRows:0,insertId:0}];}
   const result=run(text,params,kind==='select');if(kind==='update'&&tableName(table)==='admin_users'&&fault.afterUpdate)fault.afterUpdate(sqlite);return kind==='select'?result:[result];
  }).then(resolve,reject);}};return b;}
 const db={select:fields=>builder('select',null,null,fields),update:t=>builder('update',t),insert:t=>builder('insert',t),delete:t=>builder('delete',t),transaction:async fn=>{sqlite.exec('BEGIN');transactions.push({state:'begin'});try{const result=await fn(db);sqlite.exec('COMMIT');transactions.push({state:'commit'});return result;}catch(error){sqlite.exec('ROLLBACK');transactions.push({state:'rollback',error:error.message});throw error;}},execute:async query=>{const q=fragment(query);return [run(q.sql,q.params,/^\s*SELECT\b/i.test(q.sql)),{}];}};
 define('getDb',async()=>db);
 // Current native lifecycle and its referenced native dependencies only; all
 // declarations are exact candidate slices, never recompiled source copies.
 for(const name of ['updateAdminUser','toggleAdminUserStatus','mapAdminLifecycleError','auditActorFromContext','permissionAuditFromContext','getAdminUsers','getAdminUserById'])load(name);
 const trpc=require('@trpc/server'),t=trpc.initTRPC.context().create();
 define('router',t.router);
 // Real candidate native middleware/procedure objects. protectedProcedure is
 // an offline authentication boundary; native adminRole/grant checks remain.
 const protectedD=p.decls.find(d=>d.name==='protectedProcedure'&&d.module==='server/_core/trpc.ts');assert(protectedD,'PROTECTED_PROCEDURE_OWNER');define(protectedD.name,t.procedure.use(({ctx,next})=>{if(!ctx.user)throw new trpc.TRPCError({code:'UNAUTHORIZED'});return next({ctx});}));
 let hashes=0;define('hashPassword',async()=>{hashes++;throw new Error('PASSWORD_HASH_NOT_ALLOWED_IN_STATUS_TEST');});
 const app=p.byName('appRouter');for(const name of ['update','toggleStatus','list']){const prop=B.route(p,name);for(const d of C.refs(p,prop))if(d.name!==app.name)load(d.name);}
 const routeCode='var __staffRouter = router({'+['update','toggleStatus','list'].map(n=>B.route(p,n).getText(p.sf)).join(',\n')+'});';vm.runInContext(routeCode,context,{timeout:5000});executed.push(...['update','toggleStatus','list'].map(name=>({runtimeName:'adminUser.'+name,module:'server/routers.ts',candidateDeclarationSha256:sha(B.route(p,name).getText(p.sf)),candidateBytes:true})));
 function account(id,status='active',role='merchant_mgr'){return {id,userId:0,username:'staff-'+id,usernameCanonical:'staff-'+id,displayName:'Staff '+id,status,adminRole:role,passwordHash:'original-hash-'+id,sessionVersion:3};}
 function seed(){for(const {cfg} of tableInfo.values())sqlite.exec('DELETE FROM '+quote(cfg.name));for(const row of [account(10,'active','super_admin'),account(11,'active','super_admin'),account(20),account(21,'disabled'),account(22,'locked')]){const keys=Object.keys(row);run('INSERT INTO admin_users ('+keys.map(quote).join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',keys.map(k=>row[k]));run('INSERT INTO sales_staff(adminUserId,staffCode,displayName,status,sortOrder) VALUES (?,?,?,?,?)',[row.id,'staff-'+row.id,row.displayName,row.status==='active'?'active':'inactive',row.id]);run('INSERT INTO admin_user_sales_scopes(adminUserId,staffCode) VALUES (?,?)',[row.id,'staff-'+row.id]);run('INSERT INTO admin_user_permissions(adminUserId,permission) VALUES (?,?)',[row.id,'profile.manage']);run('INSERT INTO admin_user_permissions(adminUserId,permission) VALUES (?,?)',[row.id,'business.customers.read']);}queries.length=0;transactions.length=0;fault.audit=false;fault.cas=false;fault.afterUpdate=null;}
 function ctx(id=10,extra={}){return {user:{id,name:'Offline actor',role:'admin'},adminAccount:account(id,'active',id===10||id===11?'super_admin':'merchant_mgr'),adminPermissions:[],req:{headers:{'x-forwarded-for':'192.0.2.1','user-agent':'offline-test'},ip:'192.0.2.1'},...extra};}
 function state(){return JSON.stringify([...tableInfo.keys()].map(name=>{const cfg=tableInfo.get(name).cfg;return [name,sqlite.prepare('SELECT * FROM '+quote(cfg.name)+' ORDER BY id').all()];}).concat([['frontend_members',sqlite.prepare('SELECT * FROM frontend_members').all()],['frontend_customers',sqlite.prepare('SELECT * FROM frontend_customers').all()]]));}
 function protectedState(id=20){return JSON.stringify({account:sqlite.prepare('SELECT username,displayName,passwordHash,adminRole,phone,email FROM admin_users WHERE id=?').get(id),grants:sqlite.prepare('SELECT permission FROM admin_user_permissions WHERE adminUserId=? ORDER BY permission').all(id),scopes:sqlite.prepare('SELECT * FROM admin_user_sales_scopes WHERE adminUserId=? ORDER BY id').all(id),front:sqlite.prepare('SELECT * FROM frontend_members').all(),customers:sqlite.prepare('SELECT * FROM frontend_customers').all()});}
 seed();return {p,context,load,db,sqlite,queries,transactions,fault,executed,effects,seed,ctx,state,protectedState,caller:c=>context.__staffRouter.createCaller(c||ctx()),hashCount:()=>hashes,close:()=>sqlite.close()};
}
module.exports={createHarness,exactStatement};
