import regionLevels from "@province-city-china/level/level.json";

type RawRegion = {code:string; name:string; province:string; city?:string; area?:string|0; children?:RawRegion[]};
export type RegionArea = {code:string; name:string; province:string; city:string; area:string|0; terminalCity?:boolean};
export type RegionCity = {code:string; name:string; province:string; city:string; children?:RegionArea[]; municipality?:boolean};
export type RegionProvince = {code:string; name:string; province:string; children?:RegionCity[]};
export type RegionPath = {province:RegionProvince; city:RegionCity; district:RegionArea};
export type RegionSelection = {provinceCode:string;cityCode:string;regionCode:string;region:string};
const asArea=(row:RawRegion,terminalCity=false):RegionArea=>({code:row.code,name:row.name,province:row.province,city:row.city??"00",area:row.area??0,...(terminalCity?{terminalCity:true}:{})});
/** Normalize display levels only. Terminal codes always come from the shipped dictionary. */
export const REGION_PROVINCES:RegionProvince[]=(regionLevels as RawRegion[]).map(province=>{
 const children=province.children??[];
 const directlyContainsDistricts=children.length>0&&children.every(child=>!child.children?.length&&Boolean(child.area));
 const cities:RegionCity[]=directlyContainsDistricts
  ?[{code:province.code,name:province.name,province:province.province,city:"00",municipality:true,children:children.map(child=>asArea(child))}]
  :children.map(city=>({code:city.code,name:city.name,province:city.province,city:city.city??"00",children:city.children?.length?city.children.map(child=>asArea(child)):[asArea(city,true)]}));
 return {code:province.code,name:province.name,province:province.province,children:cities};
});
export function getRegionCities(provinceCode:string){return REGION_PROVINCES.find(x=>x.code===provinceCode)?.children??[];}
export function getRegionDistricts(provinceCode:string,cityCode:string){return getRegionCities(provinceCode).find(x=>x.code===cityCode)?.children??[];}
const paths=new Map<string,RegionPath>();
for(const province of REGION_PROVINCES)for(const city of province.children??[])for(const district of city.children??[])paths.set(district.code,{province,city,district});
export function findRegionPathByCode(regionCode?:string|null):RegionPath|null{return regionCode?paths.get(regionCode)??null:null;}
const isGroupingName=(name:string)=>/^(市辖区|县)$|直辖县级行政区划$/.test(name);
export function formatRegionPath(path:RegionPath){
 const names=[path.province.name];
 if(!isGroupingName(path.city.name)&&path.city.name!==path.province.name)names.push(path.city.name);
 if(path.district.name!==names[names.length-1])names.push(path.district.name);
 return names.join(" ");
}
export function inferRegionPath(regionLabel?:string|null):RegionPath|null{
 const label=regionLabel?.replace(/\s+/g,"")??"";if(!label)return null;
 const matches:Array<{path:RegionPath;score:number}>=[];
 paths.forEach(path=>{
  if(!label.includes(path.district.name))return;
  const provinceMatches=label.includes(path.province.name)||label.includes(path.province.name.replace(/[省市]$/,""));
  const cityMatches=!isGroupingName(path.city.name)&&label.includes(path.city.name);
  if(!provinceMatches&&!cityMatches)return;
  matches.push({path,score:Number(provinceMatches)*2+Number(cityMatches)});
 });
 const best=matches.sort((a,b)=>b.score-a.score);
 return best.length&&(!best[1]||best[0].score>best[1].score)?best[0].path:null;
}
export function resolveRegionPath(regionCode?:string|null,regionLabel?:string|null){return findRegionPathByCode(regionCode)??inferRegionPath(regionLabel);}
export function selectRegionCity(provinceCode:string,cityCode:string):RegionSelection{
 const city=getRegionCities(provinceCode).find(x=>x.code===cityCode);
 const result={provinceCode,cityCode:city?.code??"",regionCode:"",region:""};
 const districts=city?.children??[];
 if(districts.length===1){const path=findRegionPathByCode(districts[0].code);if(path){result.regionCode=path.district.code;result.region=formatRegionPath(path);}}
 return result;
}
export function selectRegionProvince(provinceCode:string):RegionSelection{
 const cities=getRegionCities(provinceCode);
 return selectRegionCity(provinceCode,cities.length===1?cities[0].code:"");
}
