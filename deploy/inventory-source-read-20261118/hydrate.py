#!/usr/bin/env python3
"""Rebuild pinned UI files in a non-active package. No active file writes or reload."""
import argparse, base64, hashlib, json, pathlib
PUBLIC=pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
def sha(b):return hashlib.sha256(b).hexdigest()
def need(ok,message):
    if not ok:raise RuntimeError(message)
def apply(before,records):
    after=before
    for r in reversed(records):
        old=base64.b64decode(r['oldBase64']);new=base64.b64decode(r['newBase64']);need(before[r['byteStart']:r['byteEnd']]==old and sha(old)==r['oldSha256'] and sha(new)==r['newSha256'],'EXACT_DELTA_PREIMAGE')
        after=after[:r['byteStart']]+new+after[r['byteEnd']:]
    inverse=after
    for r in reversed(records):
        need(inverse[r['newByteStart']:r['newByteEnd']]==base64.b64decode(r['newBase64']),'INVERSE_NEW_BYTES');inverse=inverse[:r['newByteStart']]+base64.b64decode(r['oldBase64'])+inverse[r['newByteEnd']:]
    need(inverse==before,'INVERSE_FULL_BYTES');return after
def main():
    a=argparse.ArgumentParser();a.add_argument('--package',required=True);a.add_argument('--manifest-sha256',required=True);args=a.parse_args();pack=pathlib.Path(args.package).resolve();need(pack.is_relative_to(pathlib.Path('/opt/ops/20261118-customer-diagnosis-WJQ7iBxD')),'PRIVATE_STAGE_CONTAINMENT')
    mb=(pack/'release-manifest.json').read_bytes();need(sha(mb)==args.manifest_sha256,'MANIFEST_PIN');m=json.loads(mb);u=json.loads((pack/'ui-delta.json').read_bytes());need(sha((pack/'ui-delta.json').read_bytes())==m['uiDeltaSha256'],'UI_DELTA_PIN')
    jobs=[{'oldRelative':'index.html','relative':'index.html','before':m['beforeHtmlSha256'],'after':m['afterHtmlSha256'],'records':u['html']['records']}]
    for r in u['assets']:
        jobs.append({'oldRelative':r['oldAsset'].lstrip('/'),'relative':r['newAsset'].lstrip('/'),'before':r['beforeSha256'],'after':r['afterSha256'],'records':r['records']})
    for r in jobs:
        need('..' not in pathlib.PurePosixPath(r['relative']).parts and '..' not in pathlib.PurePosixPath(r['oldRelative']).parts,'FIXED_RELATIVE_PATHS')
        before=(PUBLIC/r['oldRelative']).read_bytes();need(sha(before)==r['before'],'CURRENT_PREIMAGE_DRIFT_NO_HYDRATE');after=apply(before,r['records']);need(sha(after)==r['after'],'FINAL_CANDIDATE_PIN')
        target=pack/r['relative'];target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():need(target.read_bytes()==after,'STAGE_ALREADY_EXISTS_DIFFERENT_BYTES')
        else:target.write_bytes(after)
        if r['relative']=='index.html':
            b=pack/'baseline-index.html'
            if b.exists():need(b.read_bytes()==before,'STAGED_HTML_BASELINE_DRIFT')
            else:b.write_bytes(before)
    print(json.dumps({'status':'PRIVATE_STAGE_HYDRATED','activeWrites':0,'assets':len(u['assets']),'htmlSha256':m['afterHtmlSha256']}))
if __name__=='__main__':main()
