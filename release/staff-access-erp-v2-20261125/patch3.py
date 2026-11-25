import hashlib
s=open('/home/ubuntu/work/p1/staff-new.js',encoding='utf-8').read()
BM=open('/home/ubuntu/work/p1/bmv3.js',encoding='utf-8').read().strip()+'\n'
A=140000
def rep1(old,new,start=A):
    global s
    i=s.find(old,start); assert i>0,old
    assert s.find(old,i+1)<0 or start>0
    s=s[:i]+new+s[i+len(old):]
# 1 component def before old __bmAccess
k='function __bmAccess(P)'; assert s.count(k)==1
s=s.replace(k,BM+k)
A=s.find('businessTeam:x,onOpenChange:R,onSave:$}){'); assert A>0
# 2 hooks
rep1('[oe,we]=p(!1),','[oe,we]=p(!1),[__bD,__sBD]=p(!1),__bR=V(null),',A)
# 3 dirty & close confirm
rep1('qe=u==="official-team"?Z.dirty:Vt(h,Y)','qe=u==="official-team"?Z.dirty:(Vt(h,Y)||u==="erp"&&__bD)',A)
rep1('(Ae||Z.dirty)','(Ae||Z.dirty||__bD)',A)
# 4 footer save
rep1('if(u!=="admin"&&u!=="erp")return;','if(u!=="admin"&&u!=="erp")return;if(u==="erp"&&__bD&&!Vt(h,Y)){we(!0);try{await __bR.current?.save();Re.success("已保存")}catch(x9){Re.error("本页未保存",{description:x9 instanceof Error?x9.message:"请稍后重试"})}finally{we(!1)}return}',A)
rep1('let f=await $(Y,h);if(!k.current||ge.current!==l)return;','let f=await $(Y,h);if(!k.current||ge.current!==l)return;if(u==="erp"&&__bD){try{await __bR.current?.save()}catch(x9){Re.error("业务权限未保存",{description:x9 instanceof Error?x9.message:"请稍后重试"})}}',A)
# 5 replace ERP tab content
st='id:"staff-panel-erp","aria-labelledby":"staff-tab-erp",hidden:u!=="erp",className:"staff-permission-panel space-y-3",children:['
en=']}),i("div",{role:"tabpanel",id:"staff-panel-status"'
a=s.find(st,A); assert a>0 and s.count(st)==1
a+=len(st); b=s.find(en,a); assert b>a
old=s[a:b]; assert 'staff-scope-title' in old and '__bmAccess' in old and 'staff-erp-permissions-title' in old
RN='Pe.length&&a.available?"当前权限中包含你不能调整的项目，本页只读。":!ye?(G.allowed?"不能修改自己的权限。":G.reason):!x?.canEdit&&x?.reason?x.reason:null'
new='n(__bmV2,{organization:x?.overview,frontUserId:x?.frontUserId??null,canEditBiz:!!x?.canEdit&&!!x?.onSaveAccess&&!X,onSaveTeam:o=>x.onSave(o),onSaveAccess:o=>x.onSaveAccess(o),draft:P,toggleKey:S,canErp:re,busy:ee,grantable:We,member:M,actorIsOwner:a.actorIsOwner,readonlyNote:'+RN+',apiRef:__bR,onDirty:__sBD,adminId:N?.id??null,adminRole:N?.adminRole??null,adminActive:N?.status==="active",ov:T,refetchOv:A,actorSelf:X})'
s=s[:a]+new+s[b:]
open('/home/ubuntu/work/p1/staff-v3.js','w',encoding='utf-8').write(s)
h=hashlib.sha256(s.encode()).hexdigest(); print(len(s),h)
open('/home/ubuntu/work/p1/v3sha.txt','w').write(h)
