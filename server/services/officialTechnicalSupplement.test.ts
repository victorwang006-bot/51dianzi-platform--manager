import "./officialTechnicalTestWorker";
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readOfficialTechnicalDictionaryRows, type OfficialTechnicalDictionaryRow } from "./officialTechnicalDictionary";
import { W25N04KVZEIR_TECHNICAL_SOURCE as source, supplementOfficialTechnicalRead, isReviewedW25N04KVZEIRExistingSource } from "./officialTechnicalSupplement";
import { projectPreparedOfficialTechnical, officialTechnicalDigest, type OfficialTechnicalIdentity } from "./officialTechnicalResource";
import { createOfficialTechnicalPreparedStore } from "./officialTechnicalPreparedStore";
const identity: OfficialTechnicalIdentity = { publicId: "OM_00000000-0000-4000-8000-000000000001", revision: 1, partNumber: "W25N04KVZEIR", brand: "WINBOND", pkg: "WSON-8" };
const row = (patch: Partial<OfficialTechnicalDictionaryRow> = {}): OfficialTechnicalDictionaryRow => ({ id: 1, partNumber: identity.partNumber, name: "Winbond NAND", brand: identity.brand, package: identity.pkg, category: "Flash", description: "", specs: null, datasheetUrl: null, updatedAt: "2026-11-19T00:00:00.000Z", ...patch });
const project = (item = identity, rows: OfficialTechnicalDictionaryRow[] = []) => projectPreparedOfficialTechnical(item, readOfficialTechnicalDictionaryRows([item], rows)[0]);
async function fixture(run: (path: string) => Promise<void>) { const dir = await mkdtemp(join(tmpdir(), "w25n04kvzeir-technical-")); try { await run(join(dir, "prepared.json")); } finally { await rm(dir, {recursive:true,force:true}); } }
describe("reviewed exact W25N04KVZEIR technical-only supplement", () => {
  it.each([[], [row()], [row({ specs: {} })], [row({ specs: "{}" })]].map(rows => ({ rows })))("fills a proven exact miss or genuinely empty parameters", ({ rows }) => {
    const value = project(identity, rows);
    expect(value.state).toBe("ready"); expect(value.resource?.parameters).toHaveLength(16);
    expect(Object.fromEntries(value.resource!.parameters.map(p => [p.name,p.value]))).toEqual(source.specs);
    expect(value.resource?.datasheetUrl).toBe(source.datasheetUrl);
    expect(value.resource?.partNumber).toBe(identity.partNumber);
    expect(value.resource?.parameters).toContainEqual({name:"存储容量",value:"4G-bit / 512M-Byte"});
    expect(value.resource?.parameters).toContainEqual({name:"BUF",value:"1（固定）"});
  });
  it.each(["W25N04KV", "W25N04KVxxIRU", "W25N04KVZEIT", "W25N04KVZEIR-TR", "W25N04KVZEIRU", "W25N02KVZEIR", "W25N04KWZEIR"])("never strips or guesses model suffix %s", partNumber => {
    expect(project({...identity,partNumber}).state).toBe("missing");
    const original = {state:"missing" as const,sourceVersion:officialTechnicalDigest([])};
    expect(supplementOfficialTechnicalRead({...identity,partNumber},original)).toBe(original);
  });
  it("uses only existing case normalization; whitespace identities still fail the original schema", () => {
    expect(project({...identity,partNumber:"w25n04kvzeir"}).state).toBe("ready");
    expect(() => project({...identity,partNumber:" w25n04kvzeir "})).toThrow();
  });
  it.each(["TI", "", "NOTWINBOND", "WINBOND/TI", "WINBOND-ST", "华邦代替"])("does not loosen the manufacturer gate %s", brand => { expect(project({...identity,brand:brand||"UNKNOWN"}).state).toBe("missing"); });
  it.each(["", "WSON-8(6x5mm)", "SOIC-8", "WSON-16", "WSON-8-TR"])("does not infer missing/incompatible package %s", pkg => { expect(project({...identity,pkg}).state).toBe("missing"); });
  it.each(["WSON8", "WSON-8(8x6mm)", "WSON-8 (8 × 6 mm)"])("retains reviewed pin/dimension compatibility %s", pkg => { expect(project({...identity,pkg}).state).toBe("ready"); });
  it.each(["INVALID JSON", "1", "[]", {Voltage:3.3}])("does not hide dictionary corruption %s", specs => { expect(project(identity,[row({specs})]).state).toBe("unavailable"); });
  it("does not hide ambiguous same-identity rows", () => { expect(project(identity,[row(),row({id:2})]).state).toBe("unavailable"); });
  it("never merges with or replaces existing nonempty dictionary parameters", () => {
    const existing = project(identity,[row({specs:{Voltage:"3.3 V"}})]);
    expect(existing.resource?.parameters).toEqual([{name:"Voltage",value:"3.3 V"}]);
  });
  it("retains financial/unusable nonempty source rejection instead of replacing with trusted-looking facts", () => {
    expect(project(identity,[row({specs:{stock:"3000"}})]).state).toBe("unavailable");
    expect(project(identity,[row({specs:{MOQ:""}})]).state).toBe("unavailable");
    const original = {state:"missing" as const,sourceVersion:"invalid"};
    expect(supplementOfficialTechnicalRead(identity,original)).toBe(original);
  });
  it("source version binds original source and all reviewed facts/provenance, consistent for same-model siblings", () => {
    const wrong = {...identity,publicId:"OM_00000000-0000-4000-8000-000000000002",brand:"TI",pkg:"SOIC8"};
    const values=readOfficialTechnicalDictionaryRows([identity,wrong],[]);
    expect(values[0].sourceVersion).toBe(values[1].sourceVersion);
    expect(values[0].sourceVersion).toBe(officialTechnicalDigest({originalSourceVersion:officialTechnicalDigest([]),reviewedSupplement:source}));
    expect(readOfficialTechnicalDictionaryRows([identity],[row()])[0].sourceVersion).not.toBe(values[0].sourceVersion);
  });
  it("prepares via the original store, persists no financial facts, preserves other model entries byte-equivalently", async () => fixture(async path => {
    const other={...identity,publicId:"OM_00000000-0000-4000-8000-000000000003",partNumber:"ANONYMOUS-OTHER",brand:"ST",pkg:"LQFP48"};
    const store=createOfficialTechnicalPreparedStore(path);
    await store.prepare([other],async items=>readOfficialTechnicalDictionaryRows(items,[]));
    const oldDoc=JSON.parse(await readFile(path,"utf8"));
    const results=await store.prepare([identity],async items=>readOfficialTechnicalDictionaryRows(items,[]));
    const newDoc=JSON.parse(await readFile(path,"utf8"));
    expect(newDoc.entries.find((e:any)=>e.identity.publicId===other.publicId)).toEqual(oldDoc.entries[0]);
    expect(newDoc.sources[oldDoc.entries[0].sourceKey]).toEqual(oldDoc.sources[oldDoc.entries[0].sourceKey]);
    expect(await createOfficialTechnicalPreparedStore(path).lookup([identity])).toEqual(results);
    expect(await readFile(path,"utf8")).not.toMatch(/price|moq|spq|qtyStock|qtyOrder|qtyOnSale|stock|inventory|库存|起订/i);
    expect(JSON.stringify(source)).not.toMatch(/price|moq|spq|stock|inventory|qtyOrder/i);
  }));
  it("does not bypass source writer tickets and lookup full identity fences", async () => fixture(async path => {
    const store=createOfficialTechnicalPreparedStore(path),read=async (items:readonly OfficialTechnicalIdentity[])=>readOfficialTechnicalDictionaryRows(items,[]);
    await store.prepare([identity],read);
    expect((await store.lookup([{...identity,partNumber:"W25N04KVZEIT"}]))[0].state).toBe("unavailable");
    const tickets=await store.beginSourceMutation([identity.partNumber]);
    await expect(store.prepare([identity],read)).rejects.toThrow();
    expect((await store.lookup([identity]))[0].state).toBe("unavailable");
    await store.abortSourceMutation(tickets); await store.prepare([identity],read);
    expect((await createOfficialTechnicalPreparedStore(path).lookup([identity]))[0].state).toBe("ready");
  }));
});

describe("task-owner verified live identity (temporary store only, not production)", () => {
  const live: OfficialTechnicalIdentity = {publicId:"OM_237be1a0-7e70-4040-87d1-499f0d9731c8",revision:7,partNumber:"W25N04KVZEIR",brand:"Winbond(华邦)",pkg:"WSON-8(6x8)"};
  it("projects and recovers all 16 official parameters while preserving exact public identity", async () => fixture(async path => {
    const store=createOfficialTechnicalPreparedStore(path);
    const values=await store.prepare([live],async items=>readOfficialTechnicalDictionaryRows(items,[]));
    expect(values[0].state).toBe("ready");
    expect(values[0].resource).toMatchObject(live);
    expect(values[0].resource?.parameters).toHaveLength(16);
    expect(values[0].resource?.parameters).toContainEqual({name:"封装尺寸",value:"8 × 6 mm"});
    expect(await createOfficialTechnicalPreparedStore(path).lookup([live])).toEqual(values);
  }));
  it("authenticates complete source before any composite-brand exception; tampering remains unavailable", () => {
    const original=readOfficialTechnicalDictionaryRows([live],[])[0];
    if(original.state!=="matched")throw Error("Expected exact reviewed supplement");
    for(const patch of [{specs:{...original.dictionary.specs,库存:"3000"}},{specs:{...original.dictionary.specs,"工作电压":"999 V"}},{datasheetUrl:"https://example.com/unreviewed.pdf"},{description:"Changed metadata"}]){
      expect(projectPreparedOfficialTechnical(live,{...original,dictionary:{...original.dictionary,...patch}}).state).toBe("unavailable");
    }
    expect(project({...live,partNumber:"W25N04KVZEIT"}).state).toBe("missing");
    expect(project({...live,pkg:"WSON-8(5x6)"}).state).toBe("missing");
  });
});

describe("exact live brand/package source ambiguity remains fail-closed", () => {
  const live={...identity,brand:"Winbond(华邦)",pkg:"WSON-8(6x8)"};
  it("fills one truly empty live-alias row but rejects corruption and duplicate rows", () => {
    const liveRow=row({brand:live.brand,package:live.pkg});
    expect(project(live,[liveRow]).state).toBe("ready");
    expect(project(live,[{...liveRow,specs:"INVALID JSON"}]).state).toBe("unavailable");
    expect(project(live,[liveRow,{...liveRow,id:2}]).state).toBe("unavailable");
  });
});

// ST never receives invented specs: these are the task owner read-only verified 12 existing values.
import { STM8S003F3P6TR_DATASHEET_SOURCE as stSource } from "./officialTechnicalSupplement";
const stIdentity: OfficialTechnicalIdentity = {publicId:"OM_bba7cf49-fd93-401e-bf11-8ac2ab33eb14",revision:2,partNumber:"STM8S003F3P6TR",brand:"ST(意法半导体)",pkg:"TSSOP-20"};
const stSpecs = {"CPU位数":"8 Bit","CPU内核":"STM8","I/O数量":"16","RAM容量":"1KB","ADC(位数)":"10bit","EEPROM容量":"128Byte","工作温度":"-40℃~+85℃","工作电压":"2.95V~5.5V","CPU最大主频":"16MHz","振荡器类型":"内置","程序存储容量":"8KB","程序存储器类型":"FLASH"};
const stRow = (patch:Partial<OfficialTechnicalDictionaryRow>={}):OfficialTechnicalDictionaryRow => row({id:28,partNumber:stIdentity.partNumber,name:"STM8S003F3 MCU",brand:"ST",package:"TSSOP-20",category:"MCU",description:"Existing technical description",specs:stSpecs,...patch});
describe("reviewed STM8S003F3P6TR PDF-only recovery",()=>{
  it("adds ONLY empty datasheetUrl and binds complete official provenance",()=>{
    const original=stRow(); const read=readOfficialTechnicalDictionaryRows([stIdentity],[original])[0];
    expect(read.state).toBe("matched"); if(read.state!=="matched")throw Error("matched expected");
    expect(read.dictionary).toEqual({partNumber:original.partNumber,name:original.name,brand:original.brand,package:original.package,category:original.category,description:original.description,specs:stSpecs,datasheetUrl:stSource.datasheetUrl});
    expect(read.sourceVersion).toBe(officialTechnicalDigest({originalSourceVersion:officialTechnicalDigest([original]),reviewedSupplement:stSource}));
    const result=projectPreparedOfficialTechnical(stIdentity,read);
    expect(result.state).toBe("ready"); expect(result.resource?.parameters).toHaveLength(12);
    expect(Object.fromEntries(result.resource!.parameters.map(p=>[p.name,p.value]))).toEqual(stSpecs);
    expect(result.resource?.datasheetUrl).toBe(stSource.datasheetUrl);
  });
  it.each([undefined,""])("fills genuinely empty URL %s",datasheetUrl=>{
    const read=readOfficialTechnicalDictionaryRows([stIdentity],[stRow({datasheetUrl:datasheetUrl as any})])[0];
    expect(projectPreparedOfficialTechnical(stIdentity,read).resource?.datasheetUrl).toBe(stSource.datasheetUrl);
  });
  it("preserves an already valid real URL, parameters and all metadata",()=>{
    const result=project(stIdentity,[stRow({datasheetUrl:"https://www.st.com/resource/en/datasheet/existing.pdf"})]);
    expect(result.resource?.datasheetUrl).toBe("https://www.st.com/resource/en/datasheet/existing.pdf");
    expect(result.resource?.parameters).toHaveLength(12); expect(result.resource?.description).toBe("Existing technical description");
  });
  it.each(["STM8S003F3", "STM8S003F3P6", "STM8S003F3P6TRX", "STM8S003F3U6TR", "STM8S003F3P3TR"])("does not guess or strip suffix %s",partNumber=>{
    const item={...stIdentity,partNumber}; expect(project(item,[stRow({partNumber})]).resource?.datasheetUrl).toBeNull();
    expect(project(stIdentity,[stRow({partNumber})]).state).toBe("missing");
  });
  it.each(["TI","ST(先科)","NOTST","ST/TI"])("does not bless wrong brand %s",brand=>{
    expect(project({...stIdentity,brand},[stRow({brand})]).resource?.datasheetUrl).toBeNull();
    expect(project(stIdentity,[stRow({brand})]).state).toBe("missing");
  });
  it.each(["","SOIC-20","TSSOP-16","TSSOP-20-TR","TSSOP-20(99x99)"])("does not infer package %s",pkg=>{
    expect(project({...stIdentity,pkg},[stRow({package:pkg})]).resource?.datasheetUrl).toBeNull();
  });
  it.each(["http://www.st.com/a.pdf","javascript:alert(1)","https://127.0.0.1/a.pdf","https://www.st.com/a.pdf?token=secret"])("rejects supplied bad URL rather than hiding/replacing it %s",datasheetUrl=>{
    expect(project(stIdentity,[stRow({datasheetUrl})]).state).toBe("unavailable");
  });
  it.each(["bad-json", "[]", "3", {Voltage:3}])("does not mask corrupt specs %s",specs=>expect(project(stIdentity,[stRow({specs})]).state).toBe("unavailable"));
  it.each(["price","MOQ","SPQ","stock","qtyStock","qtyOrder","qtyOnSale","起订量","库存"])("rejects nonempty commercial field %s instead of making ready",name=>{
    const read=readOfficialTechnicalDictionaryRows([stIdentity],[stRow({specs:{...stSpecs,[name]:"100"}})])[0];
    expect(read.state==="matched"&&read.dictionary.datasheetUrl).toBeUndefined();
    expect(projectPreparedOfficialTechnical(stIdentity,read).state).toBe("unavailable");
  });
  it("keeps errors/ambiguity and strict sourceVersion fail closed",()=>{
    expect(project(stIdentity,[stRow(),stRow({id:29})]).state).toBe("unavailable");
    for(const sourceVersion of ["bad", "A".repeat(64), "a".repeat(63), "a".repeat(65)]){
      const original={state:"matched" as const,sourceVersion,dictionary:{partNumber:stIdentity.partNumber,brand:"ST",package:"TSSOP-20",name:"MCU",category:"MCU",description:"",specs:stSpecs}};
      expect(supplementOfficialTechnicalRead(stIdentity,original)).toBe(original);
      expect(projectPreparedOfficialTechnical(stIdentity,original).state).toBe("unavailable");
    }
    const original={state:"unavailable" as const,sourceVersion:officialTechnicalDigest([])};
    expect(supplementOfficialTechnicalRead(stIdentity,original).state).toBe("unavailable");
  });
  it("distinguishes empty parameters from PDF-only state without concealing real PDF",()=>{
    const missing=project(stIdentity,[stRow({specs:{}})]); expect(missing.state).toBe("missing"); expect(missing.resource?.datasheetUrl).toBeNull();
    const pdfOnly=project(stIdentity,[stRow({specs:{},datasheetUrl:stSource.datasheetUrl})]);
    expect(pdfOnly.state).toBe("missing"); expect(pdfOnly.resource?.parameters).toEqual([]); expect(pdfOnly.resource?.datasheetUrl).toBe(stSource.datasheetUrl);
    expect(project(stIdentity,[]).state).toBe("missing");
  });
  it("keeps source digest identical for incompatible siblings and changes it with original source",()=>{
    const wrong={...stIdentity,brand:"TI",pkg:"SOIC-20"};
    const values=readOfficialTechnicalDictionaryRows([stIdentity,wrong],[stRow()]);
    expect(values[0].sourceVersion).toBe(values[1].sourceVersion);
    expect(values[0].sourceVersion).not.toBe(readOfficialTechnicalDictionaryRows([stIdentity],[stRow({updatedAt:"2026-11-20"})])[0].sourceVersion);
  });
  it("restores both fixed complaints after restart and fences both source mutation tickets",async()=>fixture(async path=>{
    const wb={...identity,publicId:"OM_237be1a0-7e70-4040-87d1-499f0d9731c8",revision:7,brand:"Winbond(华邦)",pkg:"WSON-8(6x8)"};
    const items=[wb,stIdentity], reader=async(items:readonly OfficialTechnicalIdentity[])=>readOfficialTechnicalDictionaryRows(items,[stRow()]);
    const store=createOfficialTechnicalPreparedStore(path); const results=await store.prepare(items,reader);
    expect(results.map(value=>value.resource?.parameters.length)).toEqual([16,12]);
    expect(await createOfficialTechnicalPreparedStore(path).lookup(items)).toEqual(results);
    const ticket=await store.beginSourceMutation(items.map(i=>i.partNumber));
    expect((await store.lookup(items)).map(value=>value.state)).toEqual(["unavailable","unavailable"]);
    await expect(store.prepare(items,reader)).rejects.toThrow(); await store.abortSourceMutation(ticket);
    const recovered=await store.prepare(items,reader); expect(recovered.map(value=>value.state)).toEqual(["ready","ready"]);
    const old=await store.invalidate(items.map(i=>i.partNumber)); await store.invalidate(items.map(i=>i.partNumber));
    await expect(store.complete(items,old,reader)).rejects.toThrow();
    expect((await store.lookup(items)).every(value=>value.state==="unavailable")).toBe(true);
    await store.prepare(items,reader); expect((await createOfficialTechnicalPreparedStore(path).lookup(items)).map(value=>value.resource?.datasheetUrl)).toEqual([source.datasheetUrl,stSource.datasheetUrl]);
  }));
});

describe("actual W25N04KVZEIR 13-parameter source is not overwritten",()=>{
  const live:OfficialTechnicalIdentity={publicId:"OM_237be1a0-7e70-4040-87d1-499f0d9731c8",revision:7,partNumber:source.partNumber,brand:"Winbond(华邦)",pkg:"WSON-8(6x8)"};
  const actual=()=>row({partNumber:live.partNumber,brand:live.brand,package:live.pkg,name:"W25N04KVZEIR",description:"Original verified description",specs:{...source.preservedSpecs}});
  const completedSpecs = { ...source.preservedSpecs, ...source.preservedSourceAdditions };
  it("retains all 13 keys/values and metadata; appends only eight absent official concepts and missing PDF",()=>{
    const original=actual(); const read=readOfficialTechnicalDictionaryRows([live],[original])[0];
    if(read.state!=="matched")throw Error("matched expected");
    expect(read.dictionary.specs).toEqual(completedSpecs); expect(Object.keys(read.dictionary.specs)).toHaveLength(21);
    for(const [name,value] of Object.entries(source.preservedSpecs))expect(read.dictionary.specs[name]).toBe(value);
    expect(Object.keys(read.dictionary.specs).slice(0,13)).toEqual(Object.keys(source.preservedSpecs));
    expect(read.dictionary.name).toBe(original.name); expect(read.dictionary.description).toBe(original.description);
    expect(read.dictionary.brand).toBe(original.brand); expect(read.dictionary.package).toBe(original.package);
    const value=projectPreparedOfficialTechnical(live,read); expect(value.state).toBe("ready");
    expect(value.resource?.parameters).toHaveLength(21); expect(value.resource?.datasheetUrl).toBe(source.datasheetUrl);
    expect(Object.fromEntries(value.resource!.parameters.map(p=>[p.name,p.value]))).toEqual(completedSpecs);
    for(const name of ["接口","最大时钟频率","编程/擦除循环","数据保持"])expect(read.dictionary.specs).not.toHaveProperty(name);
    expect(source.version).toBe("winbond-w25n04kvzeir-revc-20220207-v4");
    expect(read.sourceVersion).toBe(officialTechnicalDigest({originalSourceVersion:officialTechnicalDigest([original]),reviewedSupplement:source}));
  });
  it("authenticates only original13 or exact merged21, rejects missing/extra/tampered fields before alias projection",()=>{
    const toDictionary=(specs:Record<string,string>)=>({partNumber:live.partNumber,brand:live.brand,package:live.pkg,name:"W25N04KVZEIR",category:"Flash",description:"Original verified description",specs,datasheetUrl:source.datasheetUrl});
    for(const specs of [source.preservedSpecs,completedSpecs,Object.fromEntries(Object.entries(completedSpecs).reverse())])expect(isReviewedW25N04KVZEIRExistingSource(live,toDictionary(specs))).toBe(true);
    const missing={...completedSpecs};delete (missing as Record<string,string>).BUF;
    for(const specs of [missing,{...completedSpecs,BUF:"0"},{...completedSpecs,"工作电压":"999 V"},{...completedSpecs,MOQ:"100"},{...completedSpecs,unknown:"invented"},{Voltage:"3.3 V"}]){
      const dictionary=toDictionary(specs);
      expect(isReviewedW25N04KVZEIRExistingSource(live,dictionary)).toBe(false);
      expect(projectPreparedOfficialTechnical(live,{state:"matched",sourceVersion:officialTechnicalDigest(specs),dictionary}).state).toBe("unavailable");
      const read=readOfficialTechnicalDictionaryRows([live],[{...actual(),specs}])[0];
      expect(projectPreparedOfficialTechnical(live,read).state).toBe("unavailable");
    }
  });
  it("keeps an existing safe PDF unchanged while completing original13 and exact merged21 without duplicate rows",()=>{
    const datasheetUrl="https://www.winbond.com/resource-files/existing-reviewed.pdf";
    for(const specs of [source.preservedSpecs,completedSpecs]){
      const original={...actual(),specs,datasheetUrl};
      const read=readOfficialTechnicalDictionaryRows([live],[original])[0];
      if(read.state!=="matched")throw Error("matched expected");
      expect(read.dictionary).toMatchObject({name:original.name,description:original.description,datasheetUrl,specs:completedSpecs});
      expect(Object.keys(read.dictionary.specs)).toHaveLength(21);
      expect(projectPreparedOfficialTechnical(live,read).resource?.datasheetUrl).toBe(datasheetUrl);
      expect(original.specs).toBe(specs);
    }
  });
  it.each(["W25N04KV","W25N04KVxxIRU","W25N04KVZEIT","W25N04KVZEIR-TR","W25N04KVZEIRU","W25N02KVZEIR"])("never applies the reviewed13 append branch to other ordering code %s",partNumber=>{
    const item={...live,partNumber};
    const dictionary={partNumber,brand:item.brand,package:item.pkg,name:partNumber,category:"Flash",description:"",specs:source.preservedSpecs};
    expect(isReviewedW25N04KVZEIRExistingSource(item,dictionary)).toBe(false);
    const original={state:"matched" as const,sourceVersion:officialTechnicalDigest(dictionary),dictionary};
    expect(supplementOfficialTechnicalRead(item,original)).toBe(original);
  });
  it("keeps v4 source digest equal for rejected same-model siblings and changes it with fresh original source",()=>{
    const wrong={...live,publicId:"OM_00000000-0000-4000-8000-000000000002",brand:"TI",pkg:"SOIC-8"};
    const reads=readOfficialTechnicalDictionaryRows([live,wrong],[actual()]);
    expect(reads[0].sourceVersion).toBe(reads[1].sourceVersion);
    expect(reads[0].sourceVersion).not.toBe(readOfficialTechnicalDictionaryRows([live],[{...actual(),updatedAt:"2026-11-20"}])[0].sourceVersion);
  });
  it("keeps mismatched source suffix, brand, package, corrupt specs, unsafe URL and duplicate rows fail closed",()=>{
    expect(project(live,[{...actual(),partNumber:"W25N04KVZEIT"}]).resource?.parameters).not.toHaveLength(21);
    expect(project(live,[{...actual(),brand:"TI"}]).resource?.parameters).not.toHaveLength(21);
    expect(project(live,[{...actual(),package:"SOIC-8"}]).resource?.parameters).not.toHaveLength(21);
    expect(project(live,[{...actual(),specs:"bad"}]).state).toBe("unavailable");
    expect(project(live,[{...actual(),datasheetUrl:"http://www.winbond.com/a.pdf"}]).state).toBe("unavailable");
    expect(project(live,[actual(),{...actual(),id:2}]).state).toBe("unavailable");
    expect(project(live,[{...actual(),specs:{...source.preservedSpecs,MOQ:"100"}}]).state).toBe("unavailable");
    expect(project(live,[{...actual(),specs:{...source.preservedSpecs,"工作电压":"999 V"}}]).state).toBe("unavailable");
  });
  it("prepares and recovers the real pair as 21+12 parameters without replacing existing values",async()=>fixture(async path=>{
    const items=[live,stIdentity], reader=async(items:readonly OfficialTechnicalIdentity[])=>readOfficialTechnicalDictionaryRows(items,[actual(),stRow()]);
    const store=createOfficialTechnicalPreparedStore(path); const values=await store.prepare(items,reader);
    expect(values.map(value=>value.resource?.parameters.length)).toEqual([21,12]);
    expect(await createOfficialTechnicalPreparedStore(path).lookup(items)).toEqual(values);
  }));
});

it("pair preparation preserves all other 20,000 prepared entries and unrelated source byte-equivalent",async()=>fixture(async path=>{
  const other=Array.from({length:20000},(_,i):OfficialTechnicalIdentity=>({publicId:`OM_10000000-0000-4000-8000-${i.toString(16).padStart(12,"0")}`,revision:1,partNumber:"PRESERVED-OTHER",brand:"ST",pkg:"TSSOP-20"}));
  const store=createOfficialTechnicalPreparedStore(path);
  await store.prepare(other,async items=>readOfficialTechnicalDictionaryRows(items,[]));
  const before=JSON.parse(await readFile(path,"utf8"));
  const wb:OfficialTechnicalIdentity={publicId:"OM_237be1a0-7e70-4040-87d1-499f0d9731c8",revision:7,partNumber:source.partNumber,brand:"Winbond(华邦)",pkg:"WSON-8(6x8)"};
  const wbRow=row({partNumber:wb.partNumber,brand:wb.brand,package:wb.pkg,specs:source.preservedSpecs});
  await store.prepare([wb,stIdentity],async items=>readOfficialTechnicalDictionaryRows(items,[wbRow,stRow()]));
  const after=JSON.parse(await readFile(path,"utf8"));
  expect(after.entries).toHaveLength(20002);
  expect(officialTechnicalDigest(after.entries.filter((entry:any)=>entry.identity.partNumber==="PRESERVED-OTHER"))).toBe(officialTechnicalDigest(before.entries));
  for(const key of Object.keys(before.sources))expect(after.sources[key]).toEqual(before.sources[key]);
  expect((await createOfficialTechnicalPreparedStore(path).lookup([wb,stIdentity])).map(value=>value.resource?.parameters.length)).toEqual([21,12]);
}),60000);
