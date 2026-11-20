#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).absolute().parent.parent
p=ROOT/'test_release.py'; s=p.read_text()
addition=r'''
class R3RawTests(unittest.TestCase):
    """Strict source-derived raw transformations; synthetic bytes, no Node or RPC."""
    def setUp(self):
        self.env = dict(APP='A', NODE_UNIQUE_ID='nested-keep', pid='application-pid',
                        opaque='{"pm_uptime":123,"NODE_UNIQUE_ID":"app"}')
        self.e = dict(name='dianzi51', pm_id=190, pm_exec_path='/fixed/front/dist/index.js',
                      pm_cwd='/fixed/front', exec_mode='cluster_mode', status='online',
                      autostart=True, wait_ready=False, env=self.env.copy(),
                      pm_uptime=1000, created_at=900, restart_time=2, unstable_restarts=3,
                      prev_restart_delay=4, axm_actions=[], axm_monitor={}, axm_options={},
                      axm_dynamic={}, vizion_running=False, _pm2_version='7.0.3',
                      nested=dict(pm_uptime='app', created_at='app', NODE_UNIQUE_ID='nested'))
        self.e.update(self.env)
        self.model = dict(name='dianzi51', pm_id=190, pid=9001, pm2_env=self.e)
        self.v = dict(self.e, status='launching')
        self.raw = self.bytes(self.v)

    def bytes(self, value, outer=b'pm_uptime=app\0created_at=app\0restart_time=app\0pid=app\0status=app\0'):
        return outer+b'pm2_env='+json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()+b'\0NODE_UNIQUE_ID=15\0'

    def semantic(self, raw, model=None):
        return r.pm2_raw_binding(raw, model or self.model)[0]

    def test_exact_source_generated_projection_preserves_all_retained_bytes(self):
        semantic, meta, ready = r.pm2_raw_binding(self.raw, self.model)
        self.assertTrue(ready)
        after = dict(self.v, pm_uptime=1201, created_at=1200, restart_time=3,
                     unstable_restarts=0, prev_restart_delay=0)
        model = copy.deepcopy(self.model); model['pm2_env'].update({k:after[k] for k in r.PM2_RAW_GENERATED})
        self.assertEqual(semantic, self.semantic(self.bytes(after), model))
        r.pm2_meta_transition(meta, {k:after[k] for k in r.PM2_RAW_GENERATED}, 1100, 1300)
        self.assertNotEqual(r.H(self.raw),r.H(self.bytes(after)))
        projected=r.pm2_project(r.raw_values(self.raw)[b'pm2_env'])
        self.assertIn(b'"env":{"APP":"A","NODE_UNIQUE_ID":"nested-keep","pid":"application-pid"',projected)
        self.assertIn(b'"nested":{"pm_uptime":"app","created_at":"app","NODE_UNIQUE_ID":"nested"}',projected)

    def test_every_outer_lifecycle_looking_application_value_is_byte_exact(self):
        for key in sorted(r.LIFECYCLE | {'NODE_APP_INSTANCE','NODE_CHANNEL_FD'}):
            original = self.bytes(self.v, (key+'=app\0').encode())
            changed = self.bytes(self.v, (key+'=changed\0').encode())
            with self.subTest(key=key):
                self.assertNotEqual(self.semantic(original), self.semantic(changed))

    def test_env_lifecycle_values_not_deleted_even_when_monitor_strip_would(self):
        for key in sorted(r.LIFECYCLE):
            model=copy.deepcopy(self.model); value=copy.deepcopy(self.v)
            model['pm2_env']['env'][key]='app'; value['env'][key]='app'
            raw=self.bytes(value)
            with self.subTest(key=key):
                if key in set(r.PM2_RAW_GENERATED) | {'pm_id','status','axm_actions','axm_monitor','axm_dynamic'}:
                    with self.assertRaisesRegex(r.ReleaseError,'OVERRIDE_AMBIGUITY'):
                        self.semantic(raw,model)
                else:
                    first=self.semantic(raw,model)
                    value['env'][key]='changed'; model['pm2_env']['env'][key]='changed'
                    self.assertNotEqual(first,self.semantic(self.bytes(value),model))

    def test_nested_life_values_and_nested_unique_never_transform(self):
        for key in ('pm_uptime','created_at','NODE_UNIQUE_ID'):
            value=copy.deepcopy(self.v); value['nested'][key]='changed'
            with self.subTest(key=key):
                self.assertNotEqual(self.semantic(self.raw),self.semantic(self.bytes(value)))
        value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
        value['env']['NODE_UNIQUE_ID']='changed'; model['pm2_env']['env']['NODE_UNIQUE_ID']='changed'
        self.assertNotEqual(self.semantic(self.raw),self.semantic(self.bytes(value),model))

    def test_application_escape_bytes_not_recursive_canonicalized(self):
        # Identical JSON values, different retained bytes must have different SHA.
        changed=self.raw.replace(b'"APP":"A"', b'"APP":"\u0041"')
        self.assertEqual(r.decode(r.raw_values(self.raw)[b'pm2_env']),r.decode(r.raw_values(changed)[b'pm2_env']))
        self.assertNotEqual(self.semantic(self.raw),self.semantic(changed))
        self.assertFalse(r.pm2_raw_binding(changed,self.model)[2])
        changed=self.raw.replace(b'"pm_uptime":"app"', b'"pm_uptime":"\u0061pp"')
        self.assertNotEqual(self.semantic(self.raw),self.semantic(changed))
        changed=self.raw.replace(b'\"app\"',b'\"\u0061pp\"')
        self.assertNotEqual(self.semantic(self.raw),self.semantic(changed))

    def test_top_order_whitespace_and_unproved_field_exact(self):
        for raw in (self.raw.replace(b'"nested":',b'"nested" :'),
                    self.bytes(dict(self.v, node_version='unproved-new')),
                    self.bytes(dict(self.v, arbitrary='unproved')),
                    self.raw.replace(b'"vizion_running":false',b'"vizion_running":true')):
            self.assertNotEqual(self.semantic(self.raw),self.semantic(raw))
        value=dict(reversed(list(self.v.items())))
        self.assertNotEqual(self.semantic(self.raw),self.semantic(self.bytes(value)))

    def test_duplicate_keys_at_top_env_nested_and_escaped_alias_rejected(self):
        old=r.raw_values(self.raw)[b'pm2_env']
        for changed in (old[:-1]+b',"pm_id":190}',old.replace(b'"APP":"A"',b'"APP":"A","APP":"A"'),
                        old.replace(b'"pm_uptime":"app"',b'"pm_uptime":"app","pm_\u0075ptime":"app"')):
            with self.subTest(raw=changed),self.assertRaisesRegex(r.ReleaseError,'DUPLICATE_JSON_KEY'):
                self.semantic(self.raw.replace(old,changed))

    def test_generated_integer_types_and_noncanonical_tokens_refused(self):
        for key in r.PM2_RAW_GENERATED:
            for bad in (True,None,'1000',1.5,-1,2**53):
                value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
                value[key]=bad; model['pm2_env'][key]=bad
                with self.subTest(key=key,bad=bad),self.assertRaises(r.ReleaseError):
                    self.semantic(self.bytes(value),model)
        for token in (b'1e3',b'1000.0',b'-0'):
            changed=self.raw.replace(b'"pm_uptime":1000',b'"pm_uptime":'+token)
            with self.subTest(token=token),self.assertRaises(r.ReleaseError):self.semantic(changed)

    def test_stable_identity_and_wrong_container_types_rejected(self):
        for key,value in [('name','other'),('pm_id','190'),('pm_id',True),('pm_exec_path','/other'),
                          ('pm_cwd','/other'),('exec_mode','fork_mode'),('_pm2_version','other')]:
            with self.subTest(key=key),self.assertRaisesRegex(r.ReleaseError,'IDENTITY_BINDING'):
                self.semantic(self.bytes(dict(self.v,**{key:value})))
        for value in ([],{}, {'env':[]}):
            with self.assertRaises(r.ReleaseError):self.semantic(self.bytes(value))

    def test_current_model_generated_relation_required(self):
        for key in r.PM2_RAW_GENERATED:
            model=copy.deepcopy(self.model); model['pm2_env'][key]+=1
            with self.subTest(key=key),self.assertRaisesRegex(r.ReleaseError,'GENERATED_BINDING'):
                self.semantic(self.raw,model)

    def test_generation_override_and_container_override_ambiguity_refused(self):
        for key in set(r.PM2_RAW_GENERATED)|{'pm_id','name','pm2_env','__proto__','pm_exec_path'}:
            value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
            model['pm2_env']['env'][key]=value['env'][key]='app'
            with self.subTest(key=key),self.assertRaisesRegex(r.ReleaseError,'OVERRIDE_AMBIGUITY'):
                self.semantic(self.bytes(value),model)

    def test_monitor_added_field_is_not_proven_reload_ready(self):
        model=copy.deepcopy(self.model); model['pm2_env']['version']='monitor-added'
        self.assertFalse(r.pm2_raw_binding(self.raw,model)[2])
        value=dict(self.v); value.pop('prev_restart_delay'); model=copy.deepcopy(self.model)
        model['pm2_env'].pop('prev_restart_delay')
        self.assertFalse(r.pm2_raw_binding(self.bytes(value),model)[2])

    def test_merge_object_coercion_ambiguity_refused(self):
        for app in ({'nested':'app'}, ['nested-app']):
            value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
            value['env']['APP']=app; model['pm2_env']['env']['APP']=app
            with self.assertRaisesRegex(r.ReleaseError,'COERCION_AMBIGUITY'):
                self.semantic(self.bytes(value),model)

    def test_restart_time_reset_and_time_window_are_exact_not_whitelisted(self):
        before={k:self.v[k] for k in r.PM2_RAW_GENERATED}
        good=dict(pm_uptime=1201,created_at=1200,restart_time=3,unstable_restarts=0,prev_restart_delay=0)
        for key,value in [('restart_time',2),('restart_time',4),('unstable_restarts',1),
                          ('prev_restart_delay',1),('created_at',900),('created_at',1400),
                          ('pm_uptime',1000),('pm_uptime',1500),('restart_time',True)]:
            with self.subTest(key=key,value=value),self.assertRaises(r.ReleaseError):
                r.pm2_meta_transition(before,dict(good,**{key:value}),1100,1300)

class R3ProtocolTests(unittest.TestCase):
    def fixture(self):
        case=SafetyTests('test_new_identity_and_fixed_boundary'); case.setUp()
        self.addCleanup(case.doCleanups)
        return case

    def test_no_reload_intent_when_current_model_forecast_unproved(self):
        case=self.fixture(); case.raw_rows[0]['pm2_env']['version']='monitor-added'
        case.make_synthetic_package(); c=case.prepare_state()
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True); sequence=c.sequence
            with self.assertRaisesRegex(r.ReleaseError,'UNPROVEN_NO_RELOAD'):c.reload_one(0)
        self.assertEqual(c.sequence,sequence); self.assertEqual(case.reload_calls,[])
        self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])

    def test_illegal_observation_leaves_only_intent_never_loaded_or_unlock(self):
        case=self.fixture(); c=case.prepare_state(); base=case.simulate_reload
        def adapter(cfg,tr,before):
            base(cfg,tr,before)
            row=next(v for v in case.raw_rows if v['pm_id']==before['id'])
            path=cfg.proc/str(row['pid'])/'environ'
            path.write_bytes(path.read_bytes().replace(b'pm_uptime=application-value',b'pm_uptime=changed'))
        c.reload_adapter=adapter
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True)
            with self.assertRaisesRegex(r.ReleaseError,'NODE_PM2_ONLY_LIFECYCLE'):c.reload_one(0)
            latest=r.decode((case.cfg.receipt/('state-%06d.json'%c.sequence)).read_bytes())
            self.assertEqual(latest['operation'],'reload-intent-0')
            self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])
            self.assertEqual(c.st['processes'][0]['pid'],30000)
            result=c.fail(r.ReleaseError('illegal raw observation'))
            self.assertFalse(result['successProven']); self.assertEqual(len(r.ACTIVE_LOCKS),2)
            self.assertTrue(r.decode(case.cfg.coord.read_bytes())['shared_release_active'])

    def test_partial_journal_intent_cannot_forge_observed_transition(self):
        case=self.fixture(); c=case.prepare_state()
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True); c.reload_one(0)
            good=copy.deepcopy(c.st)
            for field,value in [('intentStateSha256','0'*64),('attemptSha256','0'*64),
                                ('intentSequence',1),('afterPm2RawMeta',{})]:
                bad=copy.deepcopy(good); bad['events'][0][field]=value
                with self.subTest(field=field),self.assertRaises(r.ReleaseError):c.state_invariants(bad)
            bad=copy.deepcopy(good); bad['events']=[]
            with self.assertRaises(r.ReleaseError):c.state_invariants(bad)

    def test_multiple_slot_unique_collision_and_unrolled_raw_are_rejected(self):
        for drift in ('two-pid','own-unique','unowned-raw','own-unrolled-generated'):
            case=self.fixture(); c=case.prepare_state(); base=case.simulate_reload
            def adapter(cfg,tr,before):
                base(cfg,tr,before)
                if drift=='two-pid':base(cfg,tr,c.st['processes'][1])
                elif drift=='own-unique':
                    row=case.raw_rows[0]; path=cfg.proc/str(row['pid'])/'environ'
                    path.write_bytes(path.read_bytes().replace(b'NODE_UNIQUE_ID=110\0',b'NODE_UNIQUE_ID=11\0'))
                else:
                    pid=30011 if drift=='unowned-raw' else 30001
                    path=cfg.proc/str(pid)/'environ'; path.write_bytes(path.read_bytes()+b'UNROLLED_DRIFT=1\0')
            c.reload_adapter=adapter
            with r.locked(case.cfg):
                case.open_window(c); c.change_file('front',True,True)
                with self.subTest(drift=drift),self.assertRaises(r.ReleaseError):c.reload_one(0)
            self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])

    def test_observed_source_drift_rejected_before_event_is_recorded(self):
        case=self.fixture(); c=case.prepare_state(); base=case.simulate_reload
        def adapter(cfg,tr,before):
            base(cfg,tr,before); case.tr['sourceDrift']='different source'
        c.reload_adapter=adapter
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True)
            with self.assertRaisesRegex(r.ReleaseError,'SOURCE_DRIFT'):c.reload_one(0)
        self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])

    def test_exact_default_private_root_keeps_all_prior_protection(self):
        cfg=r.Config()
        self.assertEqual(cfg.extra_protected,(Path('/opt/config/dianzi51-admin/runtime.env'),
            Path('/opt/config/dianzi51/runtime.env'),Path('/var/lib/dianzi51-private')))
        self.assertNotIn(Path('/var/lib'),cfg.extra_protected)
        self.assertEqual(len(cfg.aliases),7)

    def test_private_root_full_files_emptydirs_meta_set_and_existing_union(self):
        case=self.fixture(); root=case.root/'private'; (root/'official-technical').mkdir(parents=True)
        (root/'empty').mkdir(); store=root/'official-technical/prepared-v1.json'; store.write_bytes(b'{"synthetic":true}')
        cfg=replace(case.cfg,extra_protected=(root,))
        paths,links=r.union(cfg,case.original_coord)
        original=r.inventory(cfg,case.cap['processes'],paths,links)
        self.assertTrue({str(p) for p in (root,*root.rglob('*'))}<=set(original))
        self.assertEqual(original[str(root/'empty')],r.describe(root/'empty'))
        store.chmod(0o600)
        self.assertNotEqual(r.inventory(cfg,case.cap['processes'],paths,links),original)
        store.write_bytes(b'{"synthetic":false}')
        self.assertNotEqual(r.inventory(cfg,case.cap['processes'],paths,links),original)
        (root/'new-empty').mkdir()
        self.assertNotEqual(set(r.inventory(cfg,case.cap['processes'],paths,links)),set(original))
        (root/'empty').rmdir()
        self.assertNotIn(str(root/'empty'),r.inventory(cfg,case.cap['processes'],paths,links))

    def test_private_root_special_entry_fail_closed(self):
        case=self.fixture(); root=case.root/'private'; root.mkdir(); os.mkfifo(root/'fifo')
        with self.assertRaisesRegex(r.ReleaseError,'SPECIAL_FILE_REFUSED'):
            r.inventory(case.cfg,case.cap['processes'],(root,))

class R3SourcePinTests(AdapterFilesTests):
    # Do not duplicate inherited adapter tests in the suite: this class is loaded
    # below by selecting only its own two methods.
    def test_generation_pins_all_measured_exact_no_missing_sources(self):
        tr=r.transport(self.cfg)
        for name,digest in r.PM2_GENERATION_PINS.items():
            self.assertEqual(tr['sources'][str(self.cfg.pm2_base/name)],digest)
        for name in ('lib/God.js','lib/God/ClusterMode.js','lib/God/Methods.js',
                     'lib/Utility.js','lib/ProcessContainer.js','constants.js'):
            self.assertIn(name,r.PM2_GENERATION_PINS)

    def test_each_generating_source_drift_fail_closed(self):
        for name in r.PM2_GENERATION_PINS:
            path=self.cfg.pm2_base/name; original=path.read_bytes(); path.write_bytes(original+b'\n// drift')
            with self.subTest(name=name),self.assertRaisesRegex(r.ReleaseError,'GENERATION_SOURCE_PIN_DRIFT'):
                r.transport(self.cfg)
            path.write_bytes(original)

# Keep inherited setup/helper implementations but avoid counting old tests twice.
for _name in tuple(vars(AdapterFilesTests)):
    if _name.startswith('test_'):
        setattr(R3SourcePinTests,_name,None)

'''
s=s.replace("\n\nif __name__ == '__main__':\n",'\n\n'+addition+"if __name__ == '__main__':\n")
p.write_text(s)
p=ROOT/'test_prepare_local.py'; s=p.read_text()
a='''    def test_r2_scope_and_d6_controller_capture_not_reusable_in_r3(self):
        for key,value in [('scope','customer-batch-actions-20261120-6Lfttf6o-R2'),
                          ('controllerSha256','d6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec')]:
            old=self.cap[key]; self.cap[key]=value; self.save_capture()
            with self.subTest(key=key),self.assertRaisesRegex(P.PrepareError,'fixed production capture binding'):
                P.prepare(self.args)
            self.cap[key]=old
        self.assertEqual(self.calls,[]); self.assertFalse(self.out.exists())

    def test_r3_private_root_union_cannot_be_omitted_from_capture(self):
        root='/var/lib/dianzi51-private'
        self.assertIn(root,self.cap['protectionUnion']['paths'])
        self.cap['protectionUnion']['paths'].remove(root); self.save_capture()
        with self.assertRaisesRegex(P.PrepareError,'protection union mismatch'):P.prepare(self.args)
        self.assertEqual(self.calls,[]); self.assertFalse(self.out.exists())

'''
s=s.replace("\n\nif __name__ == '__main__':\n",'\n\n'+a+"if __name__ == '__main__':\n")
p.write_text(s)
print('R3 counterexample tests added')
