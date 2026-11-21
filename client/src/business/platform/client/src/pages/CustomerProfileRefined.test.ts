import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
const dir=path.dirname(new URL(import.meta.url).pathname);
const current=fs.readFileSync(path.join(dir,'CustomerDetail.tsx'),'utf8');
const before=fs.readFileSync(path.join(process.cwd(),'deploy/customer-profile-refined-20261121/source-before/CustomerDetail.tsx'),'utf8');
const a=ts.createSourceFile('current.tsx',current,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const b=ts.createSourceFile('before.tsx',before,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function collect(root:ts.Node,p:(node:ts.Node)=>boolean){const out:ts.Node[]=[];function walk(n:ts.Node){if(p(n))out.push(n);ts.forEachChild(n,walk);}walk(root);return out;}
function attrs(root:ts.SourceFile,names:string[]){return collect(root,n=>ts.isJsxAttribute(n)&&names.includes(n.name.getText(root))).map(n=>n.getText(root));}
const css=fs.readFileSync(path.join(dir,'CustomerProfileCompact.css'),'utf8');
const oldCss=fs.readFileSync(path.join(process.cwd(),'deploy/customer-profile-refined-20261121/source-before/CustomerProfileCompact.css'),'utf8');
const marker='/* Customer profile refined 20261121: confirmed compact demo, real data and handlers retained. */';
const delta=marker+css.split(marker)[1];
describe('confirmed compact customer profile display only',()=>{
 it('removes the framed header line without removing customer data or source fields',()=>{
  expect(current).not.toContain('<p className="customer-detail-meta mt-1">负责人：');
  expect(current).toContain('currentAssignee');expect(current).toContain('customer.assignedName');expect(current).toContain('customer.version');
 });
 it('retains all event handlers, disabled conditions and accessibility bindings exactly',()=>{
  expect(attrs(a,['onClick','onChange','onSelect','onOpenChange','disabled','aria-controls','aria-expanded'])).toEqual(attrs(b,['onClick','onChange','onSelect','onOpenChange','disabled','aria-controls','aria-expanded']));
 });
 it('retains all declarations and detail logic before final JSX return',()=>{
  const af=collect(a,ts.isFunctionDeclaration) as ts.FunctionDeclaration[];const bf=collect(b,ts.isFunctionDeclaration) as ts.FunctionDeclaration[];
  expect(af.map(f=>f.name?.text)).toEqual(bf.map(f=>f.name?.text));
  for(let i=0;i<af.length;i++){
   if(af[i].getText(a)===bf[i].getText(b))continue;
   expect(af[i].name?.text).toBe('CustomerDetailPage');
   expect(af[i].body?.statements.slice(0,-1).map(s=>s.getText(a))).toEqual(bf[i].body?.statements.slice(0,-1).map(s=>s.getText(b)));
  }
 });
 it('keeps real summary values and stages, not Demo fixtures',()=>{
  expect(current).toContain('<b>{getBusinessIndustryLabel(customer.industryCode)}</b>');
  expect(current).toContain('{CUSTOMER_STAGE_LABELS[form?.stage ?? customer.stage]}');
  expect(current).toContain('<b>{formatCustomerDateTime(customer.nextFollowUpAt)}</b>');
  for(const fixture of ['152****8367','pingshen****','initialContacts','initialFollows','profile-demo-root'])expect(current).not.toContain(fixture);
 });
 it('keeps original tabs, contact query, follow rows, forms and dirty/navigation guards',()=>{
  for(const term of ['CUSTOMER_WORKBENCH_TABS.map','CustomerWorkbenchContacts','CustomerContactsManager','FollowUpRow','CustomerFields','customerFollowUpSchema','captureReceiptGuard','pendingLeaveAction','blockedModuleLeave'])expect(current).toContain(term);
 });
 it('changes only required button appearance, keeping follow action primary',()=>{
  expect(current).toContain('className="crm-btn customer-profile-demand-action"');expect(current).toContain('className="crm-btn customer-profile-contact-action"');
  expect(current).toContain('className="crm-btn crm-btn-primary" onClick={() => openFollowUp()}');
 });
 it('keeps previous CSS prefix exact and confines every new selector',()=>{
  expect(css.startsWith(oldCss)).toBe(true);
  const ast=postcss.parse(delta);ast.walkRules(rule=>{for(const s of rule.selector.split(','))expect(s.trim()).toMatch(/^\.erp-ui\.customer-workbench\.customer-profile-tight /);});
  ast.walkAtRules(rule=>expect(rule.name).toBe('media'));expect(delta).not.toMatch(/url\s*\(|@import|@font-face/);
 });
 it('uses desktop contact columns, editor full span, mobile stacking and readable timeline',()=>{
  expect(delta).toContain('grid-template-columns: minmax(270px,.8fr) minmax(0,1.4fr)');
  expect(delta).toContain('grid-row: 3');expect(delta).toContain('@media (max-width: 680px)');expect(delta).toContain('display: block');expect(delta).toContain('font-size: 14px');expect(delta).toContain('.customer-profile-follow-record::before');
 });
});
