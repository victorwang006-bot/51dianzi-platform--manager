// Execute on ECS via stdin. SELECT/SHOW only, no application import or DML.
const cp=require('child_process');
const {createRequire}=require('module');
const root='/opt/releases/20261020-erp-certification-unified-v1/admin';
const req=createRequire(root+'/package.json');
const mysql=req('mysql2/promise');
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).filter(p=>p.name==='dianzi51-admin');
if(apps.length!==2||apps.some(p=>p.pm2_env.pm_cwd!==root))throw Error('Unexpected PM2 target');
const env=apps[0].pm2_env,uri=env.DATABASE_URL||env.env?.DATABASE_URL;
const platform=env.PLATFORM_DB_NAME||env.env?.PLATFORM_DB_NAME||'dianzi51';
if(!uri||!/^[A-Za-z0-9_]+$/.test(platform))throw Error('Invalid database configuration');
(async()=>{
 const db=await mysql.createConnection(uri);
 try{
  await db.query('START TRANSACTION READ ONLY');
  const [[current]]=await db.query('SELECT DATABASE() AS adminSchema');
  const admin=current.adminSchema;if(!admin)throw Error('Missing admin schema');
  const [engines]=await db.query('SELECT TABLE_SCHEMA AS tableSchema,TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE (TABLE_SCHEMA=? AND TABLE_NAME IN (?,?)) OR (TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?,?))',[admin,'merchants','audit_logs',platform,'companies','enterprises','enterprise_members','users']);
  const allInnoDB=engines.length===6&&engines.every(x=>String(x.engine).toUpperCase()==='INNODB');
  const [[column]]=await db.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[admin,'merchants','legalPersonName']);
  const legalPersonColumnExists=Number(column.n)===1;
  const [grantRows]=await db.query('SHOW GRANTS FOR CURRENT_USER');
  const grants=grantRows.flatMap(x=>Object.values(x).map(String));
  function hasPrivilege(schema,table,privilege){return grants.some(g=>{
   const m=g.match(/^GRANT (.*?) ON ([^\s]+) TO /i);if(!m)return false;
   const target=m[2].replace(/`/g,'').split('.');
   const permitted=/ALL PRIVILEGES/i.test(m[1])||m[1].split(/,\s*/).some(x=>x.toUpperCase()===privilege);
   return permitted&&(target[0]==='*'||target[0]===schema)&&(target[1]==='*'||target[1]===table);
  });}
  const privileges={merchantUpdate:hasPrivilege(admin,'merchants','UPDATE'),companyUpdate:hasPrivilege(platform,'companies','UPDATE'),enterpriseUpdate:hasPrivilege(platform,'enterprises','UPDATE'),auditInsert:hasPrivilege(admin,'audit_logs','INSERT')};
  const valid=allInnoDB&&legalPersonColumnExists&&Object.values(privileges).every(Boolean);
  console.log(JSON.stringify({preflight:valid?'PASS':'FAIL',sameConnectionCrossSchema:true,allRelatedTablesInnoDB:allInnoDB,legalPersonColumnExists,engines,declaredPrivileges:privileges,dmlExecuted:false}));
  await db.rollback();if(!valid)process.exitCode=1;
 }finally{await db.end();}
})().catch(e=>{console.error('Readonly transaction preflight failed:',e.code||e.message);process.exitCode=1;});
