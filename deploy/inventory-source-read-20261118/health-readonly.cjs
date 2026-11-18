const fs=require('node:fs'),cp=require('node:child_process');
const dotenv=require('/opt/releases/20261031-forum-quote-v34/front/node_modules/dotenv');
(async()=>{
  const admin=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).find(p=>p.name==='dianzi51-admin');
  if(!admin)throw Error('ACTIVE_ADMIN_CONFIGURATION_REQUIRED');
  const config={...dotenv.parse(fs.readFileSync('/opt/config/dianzi51-admin/runtime.env')),...admin.pm2_env.env,...admin.pm2_env};
  if(!config.PORTAL_API_KEY)throw Error('PORTAL_CONFIGURATION_REQUIRED');
  // Same existing loopback service credential, held only in memory. GET health
  // has no ERP context/synchronization, browser cookie, session or business DML.
  const url='http://127.0.0.1:3000/api/trpc/system.health?input=%7B%22json%22%3A%7B%22timestamp%22%3A0%7D%7D';
  const r=await fetch(url,{headers:{'x-portal-key':config.PORTAL_API_KEY},signal:AbortSignal.timeout(5000)});
  const data=await r.json(),ok=r.status===200&&(data.result?.data?.json?.ok===true||data.result?.data?.ok===true);
  console.log(JSON.stringify({httpStatus:r.status,ok}));if(!ok)process.exitCode=1;
})().catch(()=>{console.log(JSON.stringify({ok:false,failure:'AUTHORIZED_HEALTH_READ_FAILED',detailsSuppressed:true}));process.exitCode=1});
