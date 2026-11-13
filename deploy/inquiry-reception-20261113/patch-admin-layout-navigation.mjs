import assert from 'node:assert/strict';
import ts from 'typescript';
import {nodes} from './build-admin-mapping.mjs';
export function patchOriginalNavigation(before,ast,source,model){
 const edits=[],nav=nodes(ast,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='__admin_workbench_nav_v1')[0];assert.ok(nav);
 const local=(kind,name)=>{const found=nodes(nav,n=>kind(n)&&n.name?.getText(ast)===name);assert.equal(found.length,1,'unique original nav lexical '+name);return found[0];};
 const tabs=local(ts.isFunctionDeclaration,'Ee'),location=local(ts.isFunctionDeclaration,'Ve'),groups=local(ts.isVariableDeclaration,'Ce');
 const change=(start,end,text,reason)=>edits.push({start,end,before:before.slice(start,end),text,reason});
 const cas=(root,from,to,reason)=>{const text=root.getText(ast),i=text.indexOf(from);assert.ok(i>=0,'NAV_CAS:'+reason);assert.equal(text.indexOf(from,i+1),-1,'NAV_CAS_UNIQUE:'+reason);change(root.getStart(ast)+i,root.getStart(ast)+i+from.length,to,reason);};
 assert.ok(source.includes('const receptionItem = items.find(item => item.path === "/workbench/inquiries")')&&source.includes('data-workspace-nav-target="inquiries"'));
 assert.ok(model.includes('label: "销售管理"'));
 const customers=groups.initializer.elements.find(n=>n.properties.some(p=>p.name?.getText(ast)==='id'&&p.initializer?.text==='customers'));assert.ok(customers);
 const label=customers.properties.find(n=>n.name?.getText(ast)==='label'),paths=customers.properties.find(n=>n.name?.getText(ast)==='paths');
 assert.deepEqual(paths.initializer.elements.map(n=>n.text),['/workbench/inquiries','/workbench/orders']);
 change(label.initializer.getStart(ast),label.initializer.end,'"销售管理"','nav-original-Ce-customers-label-only');
 change(paths.initializer.getStart(ast),paths.initializer.end,'["/workbench/orders"]','nav-original-Ce-remove-inquiries-only');
 cas(tabs,'channelItem=items.find(item=>item.path===O),','channelItem=items.find(item=>item.path===O),receptionItem=items.find(item=>item.path==="/workbench/inquiries"),','nav-authorized-reception-item');
 cas(tabs,'item.path!==O&&item.path!=="/workbench/customers"','item.path!==O&&item.path!=="/workbench/customers"&&item.path!=="/workbench/inquiries"','nav-exclude-inquiries-from-business-dropdown');
 cas(tabs,'customerActive=!!customerItem&&state.route?.canonicalPath==="/workbench/customers",','customerActive=!!customerItem&&state.route?.canonicalPath==="/workbench/customers",receptionActive=!!receptionItem&&state.route?.canonicalPath==="/workbench/inquiries",','nav-active-original-canonical-state');
 cas(tabs,'[O,"/workbench/customers"].includes','[O,"/workbench/customers","/workbench/inquiries"].includes','nav-primary-not-business-active');
 cas(tabs,'!customerItem&&!channelItem&&!workspaces.length','!customerItem&&!channelItem&&!receptionItem&&!workspaces.length','nav-inquiry-only-authorized-header');
 const conditionals=nodes(tabs,n=>ts.isConditionalExpression(n)&&n.condition.getText(ast)==='customerItem');assert.equal(conditionals.length,1);
 const template=conditionals[0].getText(ast),button=template.replaceAll('customerItem','receptionItem').replaceAll('customerActive','receptionActive').replace('"data-workspace-nav-target":"customers"','"data-workspace-nav-target":"inquiries"').replace(/"(?:\\u5BA2\\u6237\\u5217\\u8868|客户列表)"/,'"询价接待"');assert.notEqual(button,template);assert.ok(button.includes('renderBadge?.(receptionItem)'));
 const calls=nodes(tabs,n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='workspaces.map');assert.equal(calls.length,1);
 change(calls[0].getStart(ast),calls[0].getStart(ast),button+',','nav-independent-primary-button-cloned-original-handlers');
 cas(location,'customer=activeItem.path==="/workbench/customers",','customer=activeItem.path==="/workbench/customers",reception=activeItem.path==="/workbench/inquiries",','nav-location-original-active-item-reception');
 cas(location,':[activeWorkspace.label,...entry?.kind===',' :reception?["询价接待"]:[activeWorkspace.label,...entry?.kind===','nav-location-inquiry-only-original-list-location-helper');
 return edits;
}
