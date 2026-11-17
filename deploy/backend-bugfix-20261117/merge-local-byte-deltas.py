#!/usr/bin/env python3
"""Local-only merger. Never SSHs, modifies repos, or deploys. Inputs must share one exact baseline.
Selection JSON: {"units":[{"base":"/local/file","expectedSha256":"...","output":"/tmp/merged.js","patchManifests":["/local/patch.json"]}]}.
Each patch manifest has patches[] with oldByteStart/oldByteEnd + oldBase64/newBase64 (mature byte delta),
or start/end + before/after (JS UTF-16 positions, as the inbound tool records). Overlap fails closed.
"""
from pathlib import Path
import argparse,base64,hashlib,json
H=lambda x:hashlib.sha256(x).hexdigest()
def need(ok,code):
    if not ok:raise RuntimeError(code)
def utf16_offset(text,pos):
    raw=text.encode('utf-16-le');part=raw[:pos*2];decoded=part.decode('utf-16-le');return len(decoded.encode('utf-8'))
def main():
    p=argparse.ArgumentParser();p.add_argument('selection');a=p.parse_args();s=json.loads(Path(a.selection).read_text());results=[]
    for u in s['units']:
        buf=Path(u['base']).read_bytes();need(H(buf)==u['expectedSha256'],'BASELINE_DRIFT');text=buf.decode('utf-8');ps=[]
        for source in u['patchManifests']:
            m=json.loads(Path(source).read_text());declared=m.get('beforeSha256') or m.get('sourceSha256');need(not declared or declared==H(buf),'PATCH_BASELINE_MISMATCH')
            for q in m['patches']:
                if 'oldByteStart' in q:
                    st,en=q['oldByteStart'],q['oldByteEnd'];old,new=base64.b64decode(q['oldBase64']),base64.b64decode(q['newBase64'])
                else:
                    st,en=utf16_offset(text,q['start']),utf16_offset(text,q['end']);old,new=q['before'].encode(),q['after'].encode()
                need(buf[st:en]==old,'EXACT_PREIMAGE_MISMATCH');ps.append({'st':st,'en':en,'old':old,'new':new,'source':source,'reason':q.get('reason','')})
        ps.sort(key=lambda q:(q['st'],q['en']));dedup=[]
        for q in ps:
            if dedup and q['st']==dedup[-1]['st'] and q['en']==dedup[-1]['en'] and q['old']==dedup[-1]['old'] and q['new']==dedup[-1]['new']:continue
            if dedup:
                prev=dedup[-1];need(q['st']>=prev['en'] and not(q['st']==prev['st'] and(q['st']==q['en'] or prev['st']==prev['en'])),'OVERLAPPING_COMMON_FACTORY_HUNKS_REGENERATE_JOINTLY')
            dedup.append(q)
        out=buf
        for q in reversed(dedup):out=out[:q['st']]+q['new']+out[q['en']:]
        records=[];shift=0
        for q in dedup:
            ns=q['st']+shift;ne=ns+len(q['new']);shift+=len(q['new'])-len(q['old']);records.append({'oldByteStart':q['st'],'oldByteEnd':q['en'],'newByteStart':ns,'newByteEnd':ne,'oldBase64':base64.b64encode(q['old']).decode(),'newBase64':base64.b64encode(q['new']).decode(),'reason':q['reason'],'source':q['source']})
        inverse=out
        for q in reversed(records):
            old,new=base64.b64decode(q['oldBase64']),base64.b64decode(q['newBase64']);need(inverse[q['newByteStart']:q['newByteEnd']]==new,'INVERSE_HUNK_FAILED');inverse=inverse[:q['newByteStart']]+old+inverse[q['newByteEnd']:]
        need(inverse==buf,'OUTSIDE_HUNK_PRESERVATION_FAILED');target=Path(u['output']).resolve();need(str(target).startswith('/tmp/') or str(target).startswith('/home/ubuntu/work/bugfix-20261117/'),'LOCAL_OUTPUT_ONLY');need(not target.exists(),'NO_OVERWRITE_EXISTING_CANDIDATE');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(out)
        record={'status':'LOCAL_MERGED_NOT_DEPLOYED','base':u['base'],'beforeSha256':H(buf),'afterSha256':H(out),'output':str(target),'patches':records,'inverseVerified':True,'allOutsideHunkBytesPreserved':True};Path(str(target)+'.delta.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');results.append({k:v for k,v in record.items() if k!='patches'})
    print(json.dumps(results,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
