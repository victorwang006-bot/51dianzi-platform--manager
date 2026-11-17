import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchChannelReferenceBrand, VERIFIED_ICKEY_CHANNEL_REFERENCE_BRAND_EQUIVALENCES, VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS } from '../../shared/channelReferenceBrand';
import { validateChannelReferenceSnapshot } from './snapshot';
const root='/home/ubuntu/work/channel-reference-fill-20261117';
const final=JSON.parse(readFileSync(root+'/data-final/channel-reference-snapshot.staged.json','utf8'));
const original=JSON.parse(readFileSync(root+'/data/before-snapshot.exact.json','utf8'));
describe('saved snapshot uses the actual quote source for new ICKey brand literals',()=>{
 it('keeps the actual final data valid and every original successful quote and proof unchanged',()=>{
  expect(validateChannelReferenceSnapshot(Buffer.from(JSON.stringify(final))).allValid).toBe(true);
  const records=new Map(final.records.map((r:any)=>[JSON.stringify([r.partNumber,r.brand]),r]));
  let n=0;
  for(const old of original.records) for(const source of ['lcsc','ickey']) if(old.references[source].status==='ok'){
   const row:any=records.get(JSON.stringify([old.partNumber,old.brand]));
   expect(row.references[source]).toEqual(old.references[source]);expect(row.evidence[source]).toEqual(old.evidence[source]);n++;
  }
  expect(n).toBe(213);
 });
 it('disables only the new ICKey edges for LCSC saved proof while keeping historical LCSC rules',()=>{
  let blocked=0;
  for(const[a,b]of VERIFIED_ICKEY_CHANNEL_REFERENCE_BRAND_EQUIVALENCES) for(const[x,y]of [[a,b],[b,a]]){
   const denied=matchChannelReferenceBrand(x,y,{profile:'snapshot',allowIckeyEquivalences:false});
   expect(denied).toBe(matchChannelReferenceBrand(x,y,{profile:'lcsc'}));
   expect(matchChannelReferenceBrand(x,y,{profile:'snapshot',allowIckeyEquivalences:true})).not.toBeNull();
   if(denied===null) blocked++;
  }
  expect(blocked).toBeGreaterThan(0);
  for(const[a,b]of VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS) expect(matchChannelReferenceBrand(a,b,{profile:'snapshot',allowIckeyEquivalences:false})).not.toBeNull();
 });
 it('rejects a negative mutation relabeling an actual new ICKey quote as a LCSC proof',()=>{
  const row=final.records.find((r:any)=>r.references.ickey.status==='ok'&&matchChannelReferenceBrand(r.brand,r.references.ickey.matchedBrand,{profile:'snapshot',allowIckeyEquivalences:false})===null);
  expect(row).toBeTruthy();
  const q=structuredClone(row.references.ickey),e=structuredClone(row.evidence.ickey);
  // Deliberate invalid source mutation, never a price/source observation or saved application input.
  q.source='lcsc';q.pageUrl='https://item.szlcsc.com/1.html';e.pageUrl=q.pageUrl;
  const d=structuredClone(final);d.records=[{partNumber:row.partNumber,brand:row.brand,references:{lcsc:q,ickey:row.references.ickey},evidence:{lcsc:e,ickey:row.evidence.ickey}}];
  expect(validateChannelReferenceSnapshot(Buffer.from(JSON.stringify(d))).allValid).toBe(false);
 });
});
