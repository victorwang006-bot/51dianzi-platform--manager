import {ts,nodes,one,assert,patch} from './native-core.mjs';
const literal=(n,t)=>ts.isStringLiteralLike(n)&&n.text===t;
const enclosing=(n,p)=>{while(n&&!p(n))n=n.parent;assert(n,'missing enclosing AST node');return n;};
function nearestFunction(n){return enclosing(n,ts.isFunctionDeclaration);}
/** Only active paths: A host CustomerList -> Ww; B host wrapper -> customer module -> ez -> updated getter -> vt -> MN. */
export function customerUIDelta(a){
 const b=a.text.includes('__CW_CUSTOMER_LIST_UPDATED_20261116_GET');
 const list=b?one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__CW_CUSTOMER_LIST_UPDATED_20261116_GET'),'B active updated customer getter'):one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name&&n.end-n.pos<100000&&nodes(n,x=>ts.isStringLiteralLike(x)&&x.text.startsWith('客户已保存，当前筛选')).length),'A active customer list');
 const info=one(nodes(list,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='info'&&n.arguments.some(x=>ts.isStringLiteralLike(x)&&x.text.startsWith('客户已保存，当前筛选'))),'active list saved info');
 const listComponent=nearestFunction(info);
 const formName=b?'MN':'Ww';
 const form=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===formName&&nodes(n,x=>literal(x,'customer-create-form')).length),'active customer create form');
 if(b){
  const wrapper=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Jw'&&n.getText(a).includes('__customer_workbench_manager_v1.CustomerList')),'B host actual CustomerList wrapper');
  const ez=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ez'&&n.getText(a).includes('__CW_CUSTOMER_LIST_UPDATED_20261116_GET().default')),'B updated customer wrapper');
  assert(nodes(list,n=>ts.isIdentifier(n)&&n.text===formName).length,'B getter native table actually captures active create form');
  assert(a.text.includes('CustomerList:()=>ez'),'B module exported list path');
 }else{
  assert(nodes(list,n=>ts.isCallExpression(n)&&n.arguments.some(x=>ts.isIdentifier(x)&&x.text===formName)).length,'A list actually renders create form');
  assert(nodes(a,n=>ts.isPropertyAssignment(n)&&n.name?.text==='CustomerList'&&n.initializer.getText(a)===list.name.text).length,'A host actual list slot');
 }
 const changes=[],reason='active customer '+(b?'B updated getter':'A host')+' minimal UI only';
 const success=one(nodes(form,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='success'&&nodes(n,x=>literal(x,'客户已保存')).length),'one active customer success toast');
 changes.push(patch(a,success,'void 0',reason+' no save success toast; original await/request-id/completion/guards byte unchanged'));
 const tutorial=one(nodes(form,n=>ts.isCallExpression(n)&&nodes(n,x=>literal(x,'客户基本资料与联系人分开维护；每位联系人均需姓名和至少一种有效联系方式。')).length&&n.arguments.some(x=>literal(x,'p'))),'one tutorial JSX');
 changes.push(patch(a,tutorial,'null',reason+' remove tutorial paragraph'));
 const saving=one(nodes(form,n=>literal(n,'正在保存本次客户资料；切换页面后会继续使用同一请求编号确认结果。')),'one pending hint');
 changes.push(patch(a,saving,JSON.stringify('保存中…'),reason+' short saving status'));
 changes.push(patch(a,info,'void 0',reason+' no saved-filter info toast; refresh promise and eligibility guard remain'));
 const warning=one(nodes(list,n=>ts.isStringLiteralLike(n)&&n.text==='客户已保存，但列表刷新失败，请重试刷新列表，不要重复录入。'),'one list refresh error');
 changes.push(patch(a,warning,JSON.stringify('列表刷新失败，请重试刷新；客户无需重复录入。'),reason+' preserve one short refresh error'));
 assert(nodes(form,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='mutateAsync').length===1,'original single customer mutation call');
 return {changes,evidence:{moduleKind:b?'B':'A',listGetter:list.name.text,listComponent:listComponent.name.text,formComponent:formName,formStart:form.getStart(a),listStart:listComponent.getStart(a),actualPath:b?'host Jw -> __customer_workbench_manager_v1.CustomerList -> ez -> __CW_CUSTOMER_LIST_UPDATED_20261116_GET().default -> vt -> captured MN':'host CustomerList:Jw -> Jw JSX -> Ww',patchCount:changes.length,originalSubmitIdempotencyAndPermissionsPreserved:true,originalFailureInlinePreserved:true,shortRefreshWarningPreserved:true,deadOriginalBFormUntouched:b}};
}
