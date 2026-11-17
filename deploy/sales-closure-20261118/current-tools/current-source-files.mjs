import fs from 'node:fs';
import {C} from './static-core.mjs';
function walk(d){if(!fs.existsSync(d))return[];return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+'/'+e.name):/\.(tsx?|jsx?)$/.test(e.name)&&!e.name.includes('.test.')?[d+'/'+e.name]:[]);}
export function sourceFiles(){return [...new Set([C+'pages/CrmSalesOrders.tsx',C+'pages/InboundManagement.tsx',...walk(C+'components/companyStock'),...walk(C+'components/customers'),...walk(C+'hooks'),...walk(C+'lib')])];}
