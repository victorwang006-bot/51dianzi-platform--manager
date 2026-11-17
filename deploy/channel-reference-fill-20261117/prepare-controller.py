from pathlib import Path
D=Path(__file__).resolve().parent;O=Path('/home/ubuntu/work/inbound-documents-20261117/release.py');s=O.read_text();s=s.replace('inbound-private-documents-v1','channel-reference-inbound-documents-v2');i=s.index('DBNODE=');j=s.index('def validate():',i);s=s[:i]+'''def db(mode):
 return {'ddlPerformed':False,'noDatabaseConnection':True,'noBusinessDml':True}
'''+s[j:]
s=s.replace("assert M['emptyTablesOnly'] is True and M['noBusinessDml'] is True and M['noBindingInstallation'] is True","assert M['noDdl'] is True and M['noDatabaseAccess'] is True and M['noBusinessDml'] is True and M['noBindingInstallation'] is True").replace("assert set(M['databases'])=={'front'}","assert M['databases']=={}").replace("expected={'front':['inbound_document_objects']}","expected={}").replace("p.suffix in ['js','mjs']","p.suffix in ['.js','.mjs']").replace("'emptyTablesOnly':True","'noDdl':True").replace("'newEmptyTablesPreserved':True","'noDatabaseConnection':True")
anchor=" assert not Path(M['bindingTarget']).exists() or H(M['bindingTarget'])==M['bindingSha256'],'OLD_BINDING_PROTECTION_DRIFT'"
extra=r'''
 assert M['referenceRoot']==str(R) and M['oldSuccessfulQuotesRetained']==213 and M['manualRefreshConfigured'] is False and M['cacheProvisioned'] is False,'REFERENCE_SCOPE_DRIFT'
 assert all(not(R/n).exists()for n in M['forbiddenConfigFiles']),'UNEXPECTED_PRODUCER_CONFIG'
 assert H(R/M['apiDeltaSource'])==M['apiDeltaSha256'],'REFERENCE_API_DELTA_DRIFT'
 import base64
 delta=json.loads((R/M['apiDeltaSource']).read_text());before=(R/M['apiBeforeSource']).read_bytes();after=(R/'api/admin.js').read_bytes();assert len(delta['patches'])==1 and delta['changedOnly']=='existing-reference-import-module-string','API_SINGLE_NODE_REQUIRED'
 patch=delta['patches'][0];pre=base64.b64decode(patch['beforeBase64']);post=base64.b64decode(patch['afterBase64']);assert pre==json.dumps(M['oldReferenceImport']).encode()and post==json.dumps(str(R/'channel-reference-service.mjs')).encode(),'REFERENCE_MODULE_STRING_ONLY'
 assert before[patch['start']:patch['end']]==pre and after[patch['afterStart']:patch['afterEnd']]==post and after[:patch['afterStart']]+pre+after[patch['afterEnd']:]==before,'REFERENCE_API_EXACT_INVERSE_REQUIRED'
 assert {d['role']for d in M['documentDeltas']}=={'front','admin'} and len(M['documentDeltas'])==2,'DOCUMENT_DELTA_SCOPE'
 for d in M['documentDeltas']:
  assert H(R/d['source'])==d['sha256'],'DOCUMENT_DELTA_DRIFT'
  doc=json.loads((R/d['source']).read_text());target=d['target'];assert d['beforeSha256']==B['files'][target],'DOCUMENT_APPROVED_PREIMAGE_DRIFT'
  candidate=before if d['role']=='admin'else(R/'api/front.js').read_bytes();assert hashlib.sha256(candidate).hexdigest()==d['afterSha256'],'DOCUMENT_CANDIDATE_DRIFT'
  units=candidate.decode('utf-8').encode('utf-16-le')
  for change in sorted(doc['patches'],key=lambda x:x['afterStart'],reverse=True):
   left=change['afterStart']*2;right=change['afterEnd']*2;old=change['before'].encode('utf-16-le');new=change['after'].encode('utf-16-le');assert units[left:right]==new,'DOCUMENT_DELTA_AFTER_BYTES_DRIFT';units=units[:left]+old+units[right:]
  assert hashlib.sha256(units.decode('utf-16-le').encode('utf-8')).hexdigest()==d['beforeSha256'],'DOCUMENT_API_EXACT_INVERSE_REQUIRED'
'''
assert s.count(anchor)==1;s=s.replace(anchor,anchor+extra)
assert not any(x in s for x in ['CREATE TABLE','mysql2','DATABASE_URL','ALI_OSS','c.query(','SET TRANSACTION']);(D/'release.py').write_text(s);print('COMBINED_CONTROLLER_NO_SQL_NO_DDL_SIX_API_ONLY_WITH_TWO_LAYER_INVERSE')
