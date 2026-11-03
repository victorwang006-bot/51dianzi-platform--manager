import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({bound:true,scope:["business.inventory.read"] as string[],audit:vi.fn(),fence:vi.fn(),transport:vi.fn()}));
vi.mock("./db",async importOriginal=>({...await importOriginal<object>(),
  getActiveBusinessStaffBinding:async()=>state.bound?{frontUserId:10,bindingVersion:4}:null,
  getActiveBusinessMerchantScope:async()=>({scopeVersion:6,modulePermissions:state.scope}),
  getBusinessWorkbenchMerchantById:async()=>({id:51,merchantNo:"Synthetic",companyName:"Synthetic",crmStatus:"enabled",registrationRegion:"CN",businessLicense:"SYNTHETIC-CREDIT",crmOwnerPortalUserId:"99"}),
  withBusinessAuthorizationFence:async(key:unknown,fn:()=>Promise<unknown>)=>{state.fence(key);return fn();},
  recordBusinessCommandAccess:async(input:unknown)=>state.audit(input),
}));
import {businessRouter,BUSINESS_METHOD_CAPABILITIES} from "./businessRouter";
const ctx=(role="super_admin")=>({user:{id:303,role:"admin"},adminAccount:{id:303,status:"active",username:"Synthetic",displayName:"Operator",adminRole:role},adminPermissions:[],req:{headers:{"x-business-merchant-id":"51"},ip:"127.0.0.1"},res:{}} as never);
const input={materialId:101,content:"hello",requestId:"00000000-0000-4000-8000-000000000001"};
beforeEach(()=>{
  state.bound=true;state.scope=["business.inventory.read"];state.audit.mockClear();state.fence.mockClear();state.transport.mockClear();
  vi.stubEnv("NODE_ENV","test");vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS","51");vi.stubEnv("PLATFORM_API_BASE","http://synthetic.invalid");vi.stubEnv("PORTAL_API_KEY","synthetic-key");
  vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{state.transport(url,init);return new Response(JSON.stringify([{result:{data:{json:{item:{id:1,authorUserId:10,revision:1},idempotent:false}}}}]),{status:200,headers:{"content-type":"application/json"}});});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("fixed read-authorized collaboration BFF",()=>{
  it("only new collaboration commands remain mutations despite read capability",()=>{
    for(const name of ["collaborationNotesAdd","collaborationNotesEdit"]){expect(businessRouter._def.procedures[`channelInventory.${name}`]._def.type).toBe("mutation");expect(BUSINESS_METHOD_CAPABILITIES.find(c=>c.method===`channelInventory.${name}`)?.mode).toBe("read");}
    expect(BUSINESS_METHOD_CAPABILITIES.find(c=>c.method==="channelInventory.notesAdd")?.mode).toBe("write");
  });
  it("actual readonly caller enters unchanged current-binding/merchant fence and audits real staff",async()=>{
    expect(await businessRouter.createCaller(ctx()).channelInventory.collaborationNotesAdd(input)).toMatchObject({item:{authorUserId:10},idempotent:false});
    expect(state.fence).toHaveBeenCalledWith({adminUserId:303,merchantId:51});expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({staffUserId:10,merchantId:51,bindingVersion:4,scopeVersion:6,method:"channelInventory.collaborationNotesAdd"}));
    const [url,init]=state.transport.mock.calls[0];expect(url).toBe("http://synthetic.invalid/api/trpc/internalBusiness.execute?batch=1");expect(init.method).toBe("POST");
    const payload=JSON.parse(String(init.body))["0"].json;expect(payload).toMatchObject({staffUserId:10,expectedOwnerUserId:99,bindingVersion:4,params:input,adminActor:{id:303,role:"super_admin"}});
    expect(init.headers).not.toHaveProperty("Cookie");
    await businessRouter.createCaller(ctx()).channelInventory.collaborationNotesEdit({noteId:1,expectedRevision:1,content:"edit",requestId:input.requestId});
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({method:"channelInventory.collaborationNotesEdit"}));
  });
  it("public detail/update and old private mutation stay write-only",async()=>{
    const caller=businessRouter.createCaller(ctx()).channelInventory;
    await expect(caller.getTeamMaterialForEdit({id:101})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(caller.updateTeamMaterial({id:101,expectedRevision:1,qty:0,requestId:input.requestId})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(caller.notesAdd(input)).rejects.toMatchObject({code:"FORBIDDEN"});expect(state.transport).not.toHaveBeenCalled();
  });
  it("native superadmin cannot bypass binding/scope revocation",async()=>{
    state.bound=false;await expect(businessRouter.createCaller(ctx()).channelInventory.collaborationNotesAdd(input)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    state.bound=true;state.scope=[];await expect(businessRouter.createCaller(ctx()).channelInventory.collaborationNotesAdd(input)).rejects.toMatchObject({code:"FORBIDDEN"});expect(state.transport).not.toHaveBeenCalled();
  });
  it.each(["note","channelId","currency","responsibleUserId","enterpriseId","dataOwnerUserId"])("fixed schema rejects public update injected %s before forwarding",async field=>{
    state.scope.push("business.inventory.write");await expect(businessRouter.createCaller(ctx()).channelInventory.updateTeamMaterial({id:101,expectedRevision:1,qty:0,requestId:input.requestId,[field]:11})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(state.transport).not.toHaveBeenCalled();expect(state.audit).not.toHaveBeenCalled();
  });
});
