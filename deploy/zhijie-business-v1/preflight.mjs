import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import cp from 'node:child_process';
const processes=JSON.parse(cp.execSync('pm2 jlist',{encoding:'utf8'}));const admins=processes.filter(x=>x.name==='dianzi51-admin');
if(!admins.length)throw Error('admin unavailable');
const require=createRequire(admins[0].pm2_env.pm_cwd+'/package.json');
require('dotenv').config({path:'/opt/config/dianzi51-admin/runtime.env',override:true});
for(const key of ['DATABASE_URL','JWT_SECRET']){
 if(!process.env[key]||admins.some(p=>p.pm2_env[key]!==process.env[key]))throw Error('runtime credential differs from active admin; stop without printing values');
}
const mysql=require('mysql2/promise');const db=await mysql.createConnection(process.env.DATABASE_URL);
try{
 const [[row]]=await db.query('SELECT DATABASE() AS db, VERSION() AS version');if(row.db!=='dianzi51_admin')throw Error('unexpected admin DB');
 const [existing]=await db.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN('zhijie_staff_access','zhijie_access_audits')");
 const source=await import(pathToFileURL(process.argv[2]).href);const snapshot=await new source.MysqlZhijieSourceAdapter().loadSnapshot();
 const result={adminDatabase:row.db,databaseEngine:row.version,credentialsMatchActiveProcesses:true,enterpriseId:snapshot.enterprise.id,sourceMembers:snapshot.members.length,sourceActiveTeams:snapshot.teams.filter(t=>t.status==='active').length,existingAccessTables:existing.map(r=>r.name),businessTablesRead:false,sourceWrites:false};
 console.log(JSON.stringify(result));
}catch{console.error('Preflight rejected: runtime or source organization unavailable. No secrets were emitted.');process.exitCode=1;}finally{await db.end();}
