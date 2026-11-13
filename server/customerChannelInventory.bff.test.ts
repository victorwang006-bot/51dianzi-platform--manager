import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyOfficialInventoryGrant, bindOfficialInventoryGrant, officialInventoryGrantForRequest } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";
const state=vi.hoisted(()=>({scope:[] as string[],scopeReads:0,revokeAtFinal:false,result:{} as unknown,fence:vi.fn(),transport:vi.fn(),audit:vi.fn()}));
vi.mock("./services/officialChannelProfileRead",()=>({withOfficialChannelProfileRead:async(_ctx:unknown,_staff:unknown,run:(proof:undefined)=>Promise<unknown>)=>run(undefined)}));
vi.mock("./db",()=>({
  getAdminUserById:async()=>({id:303,status:"active",adminRole:"merchant_mgr",sessionVersion:1}),
  getAdminUserPermissions:async()=>["officialInventory.read"],
  getActiveBusinessStaffBinding:async()=>({frontUserId:10,bindingVersion:7}),
  getActiveBusinessMerchantScope:async()=>{state.scopeReads++;return {scopeVersion:9,modulePermissions:state.revokeAtFinal && state.scopeReads%2===0 ? state.scope.filter(k=>k!=="business.customers.read") : state.scope};},
  getBusinessWorkbenchMerchantById:async()=>({id:51,merchantNo:"fixture",companyName:"fixture",crmStatus:"enabled",registrationRegion:"CN",businessLicense:"SYNTHETIC-CREDIT",crmOwnerPortalUserId:"99"}),
  withBusinessAuthorizationFence:async(key:unknown,run:()=>Promise<unknown>)=>{state.fence(key);return run();},
  recordBusinessCommandAccess:async(value:unknown)=>state.audit(value),
  getDb:async()=>{throw new Error("REAL DATABASE FORBIDDEN");},
}));
import { businessRouter } from "./businessRouter";
const ctx=()=>({user:{id:303,role:"admin"},adminAccount:{id:303,status:"active",username:"fixture",displayName:"fixture",adminRole:"merchant_mgr"},adminPermissions:[],req:{headers:{"x-business-merchant-id":"51"}},res:{}} as never);
const query={customerId:1,expectedEnterpriseId:1,expectedActorUserId:10,page:1,pageSize:20};
const empty={customerId:1,bindingCount:0,items:[],total:0,page:1,pageSize:20,pageCount:0,canWrite:false,canFilterSource:false};
beforeEach(()=>{
  state.scope=["business.inventory.read","business.customers.read"];state.scopeReads=0;state.revokeAtFinal=false;state.result={...empty};
  state.fence.mockClear();state.transport.mockClear();state.audit.mockClear();
  vi.stubEnv("NODE_ENV","test");vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS","51");vi.stubEnv("PLATFORM_API_BASE","https://synthetic.invalid");vi.stubEnv("PORTAL_API_KEY","synthetic-offline-key");
  vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{state.transport(url,init);return new Response(JSON.stringify([{result:{data:{json:state.result}}}]),{status:200});});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const payload=()=>JSON.parse(String(state.transport.mock.calls.at(-1)![1].body))["0"].json;
const target=(p:ReturnType<typeof payload>)=>({creditCode:"SYNTHETIC-CREDIT",expectedOwnerUserId:99,staffUserId:10,adminAccountId:303,bindingVersion:7,method:"channelInventory.listTeamMaterials",requestId:p.requestId});

describe("customer-only inventory BFF scope and real signed grant",()=>{
  it("customer mode requires both local scopes; native inventory override still works only globally",async()=>{
    for(const local of [[],["business.customers.read"],["business.inventory.read"],["business.inventory.read","business.customers.write"]]){
      state.scope=local;state.scopeReads=0;
      await expect(businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials(query)).rejects.toMatchObject({code:"FORBIDDEN"});
    }
    expect(state.transport).not.toHaveBeenCalled();expect(state.audit).not.toHaveBeenCalled();
    state.scope=[];state.result={items:[],total:0,page:1,pageSize:20,pageCount:0};
    await expect(businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials({page:1,pageSize:20})).resolves.toMatchObject({items:[]});
    expect(payload().params).not.toHaveProperty("customerId");expect(payload().officialInventoryGrant.permissions.customerScopeRead).toBe(false);
  });
  it("forwards exact validated customer input with signed CRM overlay inside the original fence",async()=>{
    expect(await businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials(query)).toEqual(empty);
    const p=payload();expect(p.params).toEqual(query);expect(p).toMatchObject({staffUserId:10,bindingVersion:7,expectedOwnerUserId:99});
    expect(verifyOfficialInventoryGrant(p.officialInventoryGrant,target(p))).toMatchObject({read:true,write:false,customerScopeRead:true});
    expect(state.fence).toHaveBeenCalledWith({adminUserId:303,merchantId:51});
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({method:"channelInventory.listTeamMaterials",staffUserId:10,scopeVersion:9}));
  });
  it("final in-fence CRM revocation denies even if the first snapshot allowed",async()=>{
    state.revokeAtFinal=true;
    await expect(businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials(query)).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(state.scopeReads).toBe(2);expect(state.transport).not.toHaveBeenCalled();
  });
  it("real HMAC rejects forged customerScopeRead, wrong actor/owner/action and expired action proof",async()=>{
    await businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials(query);const p=payload(),t=target(p);
    expect(()=>verifyOfficialInventoryGrant({...p.officialInventoryGrant,permissions:{...p.officialInventoryGrant.permissions,customerScopeRead:false}},t)).toThrow("渠道库存受信授权无效");
    for(const change of [{staffUserId:20},{expectedOwnerUserId:999},{method:"channelInventory.getTeamMaterialSource"},{requestId:"other-request"}])expect(()=>verifyOfficialInventoryGrant(p.officialInventoryGrant,{...t,...change})).toThrow("渠道库存受信授权无效");
    const delegation={staffUserId:10,adminAccountId:303,bindingVersion:7,requestId:p.requestId,enterpriseId:1} as never;
    bindOfficialInventoryGrant(delegation,verifyOfficialInventoryGrant(p.officialInventoryGrant,t));
    expect(officialInventoryGrantForRequest(delegation,t.method)?.customerScopeRead).toBe(true);
    expect(officialInventoryGrantForRequest(delegation,"channelInventory.getTeamMaterialSource")).toBeUndefined();
    vi.spyOn(Date,"now").mockReturnValue(p.officialInventoryGrant.expiresAt+1);
    expect(officialInventoryGrantForRequest(delegation,t.method)).toBeUndefined();
    expect(()=>verifyOfficialInventoryGrant(p.officialInventoryGrant,t)).toThrow("渠道库存受信授权已过期");
    vi.restoreAllMocks();
  });
  it.each([{customerId:0},{customerId:-1},{customerId:1.5},{customerId:"1"},{customerId:null},{customerId:1,customerScopeRead:true},{customerId:1,companyName:"guess"}])("rejects invalid or authority-bearing customer input before transport: %j",async extra=>{
    await expect(businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials({...query,...extra})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(state.transport).not.toHaveBeenCalled();
  });
  it.each([null,{}, {...empty,customerId:2},{...empty,bindingCount:-1},{...empty,bindingCount:1.5},{...empty,bindingCount:undefined},{...empty,total:-1},{...empty,page:2},{...empty,pageSize:100},{...empty,pageCount:1},{...empty,total:1,pageCount:1},{...empty,bindingCount:1,total:1,pageCount:1,items:[{id:101,canViewSource:false}]},{...empty,bindingCount:1,total:1,pageCount:1,items:[{id:101,canViewSource:true,company:{id:2,name:"wrong"}}]}])("fails closed on unproved scope/source or wrong company result",async result=>{
    state.result=result;await expect(businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials(query)).rejects.toMatchObject({code:"INTERNAL_SERVER_ERROR"});expect(state.audit).not.toHaveBeenCalled();
  });
  it("keeps only authorized company projection and never trusts upstream recorder name",async()=>{
    state.result={...empty,bindingCount:1,total:1,pageCount:1,items:[{id:101,canViewSource:true,company:{id:1,name:"当前CRM名称"},originalRecorderName:"untrusted",recorderAdminAccountId:null}]};
    const result=await businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials(query) as any;
    expect(result.items[0]).toMatchObject({company:{id:1,name:"当前CRM名称"},originalRecorderName:null});expect(result.items[0]).not.toHaveProperty("recorderAdminAccountId");
  });
});
