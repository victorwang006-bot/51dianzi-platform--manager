import importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('owned',Path(__file__).with_name('complete-owned-image.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class CaptureModes(unittest.TestCase):
 def rows(self):
  return [{'pm_id':i,'name':'dianzi51'if i==190 else'other','pid':i+1000,'pm2_env':{'status':'online','pm_exec_path':'/fixed','pm_cwd':'/fixed','exec_mode':'cluster_mode'if i==190 else'fork_mode','env':{'SYNTH':'value'}}}for i in [0,190,201]]
 def test_nonfront_fork_needs_no_embedded_json_and_keeps_full_raw_hash(self):
  rows=self.rows();raw={1000:b'PUBLIC_SYNTH=x\0',1190:b'pm2_env='+json.dumps({'env':{'SYNTH':'value'},'pm_uptime':123}).encode()+b'\0NODE_UNIQUE_ID=2\0',1201:b'WORKER_SYNTH=x\0'}
  with patch.object(m.subprocess,'check_output',return_value=json.dumps(rows).encode()),patch.object(m,'read',side_effect=lambda p:raw[int(p.parent.name)]):
   current,embedded=m.capture()
  self.assertEqual(len(current),3);self.assertEqual(set(embedded),{190});self.assertEqual(embedded[190],m.H(m.canonical({'SYNTH':'value'})));self.assertEqual(current[0]['rawEnvSha256'],m.H(raw[1000]));self.assertEqual(current[2]['rawEnvSha256'],m.H(raw[1201]))
 def test_target_cluster_still_rejects_missing_embedded_config(self):
  with patch.object(m.subprocess,'check_output',return_value=json.dumps(self.rows()).encode()),patch.object(m,'read',return_value=b'SYNTH=x\0'):
   with self.assertRaisesRegex(RuntimeError,'RAW_PM2_ENV_REQUIRED'):m.capture()
if __name__=='__main__':unittest.main()
