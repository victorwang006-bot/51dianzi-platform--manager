#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).absolute().parent.parent
p=ROOT/'test_release.py'; s=p.read_text().replace('import importlib.util\n','import importlib.util\nimport json\nimport time\n')
a=s.index('            raw = b\'ROLE=\''); b=s.index('        self.tr = ',a)
s=s[:a]+'''            env = dict(CUSTOM_VALUE='synthetic-only', NODE_UNIQUE_ID='nested-must-stay', pid='app-value')
            e = dict(status='online', name=name, pm_id=i, pm_exec_path=str(script),
                pm_cwd=str(script.parent.parent), exec_mode='cluster_mode' if own else 'fork_mode',
                restart_time=0, PORT='5100' if i < 4 else '5200' if own else None,
                env=env, NODE_APP_INSTANCE=str(i), NODE_CHANNEL_FD='3',
                autostart=True, pm_uptime=1000000, created_at=900000, unstable_restarts=0,
                prev_restart_delay=0, axm_actions=[], axm_monitor={}, axm_options={}, axm_dynamic={},
                vizion_running=False, _pm2_version='7.0.3')
            e.update(env)
            serialized = json.dumps(dict(e, status='launching'), ensure_ascii=False, separators=(',', ':')).encode()
            raw = b'ROLE='+name.encode()+b'\\0NODE_APP_INSTANCE='+str(i).encode()+b'\\0NODE_CHANNEL_FD=3\\0'
            raw += b'CUSTOM_VALUE=synthetic-only\\0pm_uptime=application-value\\0'
            raw += b'pm2_env='+serialized+b'\\0'
            if own:
                raw += b'NODE_UNIQUE_ID='+str(i+10).encode()+b'\\0'
            (proc/'environ').write_bytes(raw)
            (proc/'status').write_bytes(b'Uid:\\t1000 1000 1000 1000\\nGid:\\t1000 1000 1000 1000\\nGroups:\\t1000\\nUmask:\\t0022\\n')
            self.raw_rows.append(dict(pm_id=i, name=name, pid=pid, pm2_env=e))
''' +s[b:]
a=s.index('        (new/\'environ\').write_bytes(raw)'); b=s.index('\n    def api_fixture(',a)
s=s[:a]+'''        time.sleep(0.002)  # deterministic distinct millis, no production timer/budget change
        stamp = int(dt.datetime.now(dt.timezone.utc).timestamp()*1000)
        old_serialized = r.raw_values(raw)[b'pm2_env']
        serialized = r.decode(old_serialized)
        serialized.update(pm_uptime=stamp, created_at=stamp,
                          restart_time=before['restarts']+1, unstable_restarts=0, prev_restart_delay=0)
        raw = raw.replace(b'pm2_env='+old_serialized+b'\\0',
                          b'pm2_env='+json.dumps(serialized, ensure_ascii=False, separators=(',', ':')).encode()+b'\\0')
        (new/'environ').write_bytes(raw)
        (new/'status').write_bytes((old/'status').read_bytes())
        row['pid'] = newpid
        row['pm2_env'].update({k: serialized[k] for k in r.PM2_RAW_GENERATED})
''' +s[b:]
s=s.replace('/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R2','/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R3')
s=s.replace("        (self.cfg.pm2_base/'lib/God/Reload.js').write_bytes(b'synthetic God reload source')", "        measured = Path('/home/ubuntu/work/customer-batch/pm2-live-source')\n        for name, digest in r.PM2_GENERATION_PINS.items():\n            file = self.cfg.pm2_base/name; file.parent.mkdir(parents=True, exist_ok=True)\n            data = (measured/name).read_bytes(); self.assertEqual(r.H(data), digest)\n            file.write_bytes(data)  # measured source bytes pinned, never evaluated/imported")
s=s.replace("        (self.cfg.pm2_base/'package.json').write_bytes(b'{\"name\":\"pm2\",\"synthetic\":true}\\n')\n",'')
s=s.replace("original = {str(self.cfg.node), str(self.cfg.pm2_base/'lib/God/Reload.js'),\n                    str(self.cfg.pm2_base/'lib/Daemon.js'), str(self.cfg.pm2_base/'package.json')}", "original = {str(self.cfg.node), str(self.cfg.pm2_base/'lib/Daemon.js'),\n                    *(str(self.cfg.pm2_base/n) for n in r.PM2_GENERATION_PINS)}")
p.write_text(s)
p=ROOT/'test_prepare_local.py'; s=p.read_text()
s=s.replace("nodeUniqueId=i if own else None, **{k:", "nodeUniqueId=i if own else None, pm2ReloadReady=True if own else None,\n                             pm2RawMeta={k: 0 for k in R.PM2_RAW_GENERATED} if own else None, **{k:")
s=s.replace("test_r2_current_controller_sha_and_scope_fixed", "test_r3_current_controller_sha_and_scope_fixed")
s=s.replace("customer-batch-actions-20261120-6Lfttf6o-R2", "customer-batch-actions-20261120-6Lfttf6o-R3")
p.write_text(s)
print('temp-only mock fixtures adapted; no builders executed')
