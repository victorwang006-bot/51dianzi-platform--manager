import{ts,need,program,walk}from'./parity-core.mjs';import{patch}from'./incremental-core.mjs';
const canonical=n=>ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,n,n.getSourceFile());
function arrows(text){const p=program('const __result = '+text+';');const nodes=[];walk(p.file,n=>{if(ts.isArrowFunction(n))nodes.push(n)});return{file:p.file,nodes,offset:'const __result = '.length}}
export function freezeCallbacks(oldText,newText,allowPresentationIIFE=false){
 const old=arrows(oldText),next=arrows(newText),newOuter=next.nodes.find(n=>allowPresentationIIFE&&ts.isBlock(n.body)&&n.body.statements.some(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(next.file).startsWith('__demoB_'))));
 const oldMap=new Map();for(const n of old.nodes){const key=canonical(n);if(!oldMap.has(key))oldMap.set(key,[]);oldMap.get(key).push(n)}
 const nextMap=new Map();for(const n of next.nodes){if(n===newOuter)continue;const key=canonical(n);need(oldMap.has(key),'NEW_OR_CHANGED_COMPILED_CALLBACK');if(!nextMap.has(key))nextMap.set(key,[]);nextMap.get(key).push(n)}
 for(const[k,v]of oldMap)need(nextMap.get(k)?.length===v.length,'COMPILED_CALLBACK_COUNT_CHANGED');
 const candidates=[];for(const[k,v]of nextMap)for(let i=0;i<v.length;i++)candidates.push({node:v[i],old:oldMap.get(k)[i]});
 const top=candidates.filter(r=>!candidates.some(p=>p!==r&&p.node.getStart(next.file)<=r.node.getStart(next.file)&&p.node.end>=r.node.end));
 const edits=top.map(r=>({start:r.node.getStart(next.file)-next.offset,end:r.node.end-next.offset,after:r.old.getText(old.file),reason:'Existing compiled callback bytes exact copied'}));
 const result=patch(newText,edits);const after=arrows(result.bytes.toString());for(const[k,v]of oldMap){const found=after.nodes.filter(n=>canonical(n)===k);need(found.length===v.length,'FROZEN_CALLBACK_COUNT');for(let i=0;i<v.length;i++)need(found[i].getText(after.file)===v[i].getText(old.file),'CALLBACK_BYTES_EXACT')}
 return{expression:result.bytes.toString(),proof:{compiledCallbacks:vCount(oldMap),maximalRawCallbacksCopied:top.length,allOriginalCallbackBytesExact:true,newPureRenderIIFE:!!newOuter}};
}
function vCount(m){return[...m.values()].reduce((s,x)=>s+x.length,0)}
