#!/usr/bin/env python3
"""Local exact API merge. Does not execute an API entry or connect to production."""
from pathlib import Path
import argparse, base64, hashlib, json, shutil, subprocess
H=lambda b:hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--admin-baseline',required=True);a=p.parse_args();root=Path(a.root).resolve();R=root/'release';base=Path(a.admin_baseline);b=base.read_bytes();h=H(b)
 assert h=='d42442c67011e07bb1f67a73a45aa7761efd29e6794f989a0c1c5a6af7e40b87'
 assert not (R/'api/admin-index.js').exists(),'ONE_BUILD_ONLY'
 m=json.loads((R/'evidence/registration-plan.json').read_text())['runtime'];old=m['oldImport'].encode();new=m['newImport'].encode();assert b.count(old)==1;st=b.index(old)
 material={'beforeSha256':h,'patches':[{'oldByteStart':st,'oldByteEnd':st+len(old),'oldBase64':base64.b64encode(old).decode(),'newBase64':base64.b64encode(new).decode(),'reason':'one officialMall runtime import only'}]}
 original=json.loads((R/'evidence/admin-schema-delta.json').read_text());assert original['baselineSha256']==h;patches=[]
 for q in original['hunks']:
  before=q['before'].encode();after=q['after'].encode();assert b[q['start']:q['end']]==before
  patches.append({'oldByteStart':q['start'],'oldByteEnd':q['end'],'oldBase64':base64.b64encode(before).decode(),'newBase64':base64.b64encode(after).decode(),'reason':q['label']})
 customer={'beforeSha256':h,'patches':patches}
 paths=[]
 for name,value in [('admin-material-import-delta.json',material),('admin-customer-normalized-delta.json',customer)]:
  f=R/'evidence'/name;f.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');paths.append(str(f))
 selection={'units':[{'base':str(base),'expectedSha256':h,'output':str(R/'api/admin-index.js'),'patchManifests':paths}]}
 f=R/'admin-merge-selection.json';f.write_text(json.dumps(selection)+'\n');subprocess.run(['python3',str(root/'merge-local-byte-deltas.py'),str(f)],check=True)
 Path(str(R/'api/admin-index.js')+'.delta.json').rename(R/'evidence/admin-api-delta.json')
 shutil.copy2(base,R/'admin-api-baseline.js')
 print(json.dumps({'adminCandidateSha256':H((R/'api/admin-index.js').read_bytes()),'inverseVerified':True,'schemaAndMallImportOnly':True}))
if __name__=='__main__':main()
