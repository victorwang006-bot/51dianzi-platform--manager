#!/usr/bin/env python3
"""One-off scoped source edit; never imports controller or touches production."""
from pathlib import Path
import hashlib
ROOT = Path(__file__).absolute().parent.parent
p = ROOT/'release.py'
s = p.read_text()
s = s.replace("SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R2'", "SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R3'")
s = s.replace("Path('/opt/config/dianzi51/runtime.env'),)", "Path('/opt/config/dianzi51/runtime.env'),\n                              Path('/var/lib/dianzi51-private'),)")
start = s.index('def raw_semantics(')
end = s.index('\ndef permissions(', start)
s = s[:start] + '''# These measured generating/reset sources define the ONLY serialized exceptions.
# Node/Daemon and both complete vendor trees remain separately source/META pinned.
PM2_GENERATION_PINS = {
    'lib/God.js': 'f598e5113890418827e31dd52fc3538e8f19287fad212cafd9388b0216fe500d',
    'lib/God/ClusterMode.js': 'b4a9304e12f468f87a039c174c6ea4a1001f21d9dd1f5317121ed217bc389119',
    'lib/God/Reload.js': '5e90112e447c4634009ea35005ffd477aab93064f55390288c56b51eee25992e',
    'lib/God/Methods.js': '577a8505074225dfe73ce2c955c844662c6bc9d76c31d8102f809a1691262044',
    'lib/Utility.js': '66cd15711be69f40f6ee3c3f60adcf07e58d0bcdec9552ec5104530b22ba28f1',
    'lib/ProcessContainer.js': '712b414f248a460f58d4365898fa7b27d39bf7f571ac889359e3a7b6a32419d1',
    'constants.js': '5a4adce0c3c277d4974c0ebdefb22d62ffcad74edcf910bfeeff287dacb8a853',
    'package.json': 'f2819cffb2aae16bb813596575410877570a253be11949260caa33c8038788d6',
}
PM2_RAW_GENERATED = ('pm_uptime', 'restart_time', 'created_at',
                     'unstable_restarts', 'prev_restart_delay')

def raw_values(data):
    need(data.endswith(b'\\0'), 'RAW_NUL_REQUIRED')
    values = {}
    for entry in data[:-1].split(b'\\0'):
        need(b'=' in entry, 'RAW_ENTRY_REQUIRED')
        k, v = entry.split(b'=', 1)
        need(k and k not in values, 'RAW_DUPLICATE_OR_EMPTY')
        values[k] = v
    return values

def raw_semantics(data, own=False, serialized=None):
    values = raw_values(data)
    if own:
        need(b'NODE_UNIQUE_ID' in values and re.fullmatch(rb'[0-9]+', values[b'NODE_UNIQUE_ID']),
             'OWN_OUTER_NODE_UNIQUE_ID_DECIMAL')
        del values[b'NODE_UNIQUE_ID']
        if serialized is not None:
            need(b'pm2_env' in values, 'PM2_SERIALIZED_CONTAINER_REQUIRED')
            values[b'pm2_env'] = serialized
    # No recursive canonicalization: each retained value is its original byte string.
    norm = {k.decode('utf8', 'surrogateescape'): v.decode('utf8', 'surrogateescape')
            for k, v in values.items()}
    return H(encode(norm))

def pm2_top_tokens(raw):
    """Strict JSON first; then locate just top value spans without re-encoding them."""
    value = decode(raw)
    need(isinstance(value, dict), 'PM2_SERIALIZED_OBJECT')
    try:
        text = raw.decode('utf8')
        scanner = json.JSONDecoder()
        def ws(i):
            while i < len(text) and text[i] in ' \\t\\r\\n':
                i += 1
            return i
        i = ws(0)
        need(text[i:i+1] == '{', 'PM2_TOP_OBJECT')
        i = ws(i+1); spans = {}
        while text[i:i+1] != '}':
            key, i = scanner.raw_decode(text, i)
            need(isinstance(key, str) and key not in spans, 'PM2_TOP_KEY')
            i = ws(i); need(text[i:i+1] == ':', 'PM2_TOP_COLON')
            a = ws(i+1); _, b = scanner.raw_decode(text, a)
            spans[key] = (a, b)
            i = ws(b)
            if text[i:i+1] == '}':
                break
            need(text[i:i+1] == ',', 'PM2_TOP_COMMA'); i = ws(i+1)
        need(text[i:i+1] == '}' and ws(i+1) == len(text) and set(spans) == set(value),
             'PM2_TOP_COMPLETE')
        return value, text, spans
    except (ValueError, UnicodeError, IndexError) as exc:
        raise ReleaseError('PM2_TOP_INVALID') from exc

def pm2_project(raw):
    value, text, spans = pm2_top_tokens(raw)
    replacements = []
    for key in PM2_RAW_GENERATED:
        if key in value:
            a, b = spans[key]
            need(integer(value[key]) and 0 <= value[key] < 2**53
                 and re.fullmatch(r'0|[1-9][0-9]*', text[a:b]), 'PM2_GENERATED_INTEGER_TOKEN')
            replacements.append((a, b))
    for a, b in sorted(replacements, reverse=True):
        text = text[:a] + '0' + text[b:]
    return text.encode('utf8')

def pm2_raw_binding(raw, model):
    """Source-defined narrow proof; unresolved monitor/fork bytes yield not-ready.
    No new/deleted top field, application escape or opaque byte gets an exception.
    """
    outer = raw_values(raw)
    need(b'pm2_env' in outer, 'PM2_SERIALIZED_CONTAINER_REQUIRED')
    data = outer[b'pm2_env']; value, _, _ = pm2_top_tokens(data)
    e = model['pm2_env']
    need(isinstance(e, dict) and isinstance(e.get('env'), dict)
         and isinstance(value.get('env'), dict), 'PM2_ENV_OBJECT_REQUIRED')
    bindings = {'name': model['name'], 'pm_id': model['pm_id'],
                'pm_exec_path': e['pm_exec_path'], 'pm_cwd': e['pm_cwd'],
                'exec_mode': 'cluster_mode', '_pm2_version': '7.0.3'}
    need(integer(model['pm_id']) and model['pm_id'] >= 0
         and all(isinstance(bindings[k], str) and bindings[k] for k in
                 ('name', 'pm_exec_path', 'pm_cwd'))
         and all(k in value and encode(value[k]) == encode(v) for k, v in bindings.items())
         and e.get('pm_id') == model['pm_id'] and e.get('name') == model['name']
         and e.get('exec_mode') == 'cluster_mode', 'PM2_RAW_IDENTITY_BINDING')
    generated = set(PM2_RAW_GENERATED) | {'status', 'axm_actions', 'axm_monitor', 'axm_options', 'axm_dynamic'}
    need(not (set(e['env']) & (set(bindings) | generated | {'autostart', 'wait_ready'})),
         'PM2_ENV_OVERRIDE_AMBIGUITY')
    need(encode(value['env']) == encode(e['env']), 'PM2_RAW_MODEL_ENV_BINDING')
    need(e.get('autostart') is True and not e.get('wait_ready')
         and value.get('autostart') is True and not value.get('wait_ready')
         and value.get('status') == 'launching' and e.get('status') == 'online'
         and value.get('axm_actions') == []
         and all(value.get(k) == {} for k in ('axm_monitor', 'axm_options', 'axm_dynamic')),
         'PM2_GENERATION_SOURCE_SHAPE')
    need(all(k in value for k in ('pm_uptime', 'restart_time', 'created_at')),
         'PM2_REQUIRED_GENERATED_FIELDS')
    projected = pm2_project(data)
    metadata = {k: value.get(k) for k in PM2_RAW_GENERATED}
    need(all(k not in value or (k in e and encode(value[k]) == encode(e[k]))
             for k in PM2_RAW_GENERATED), 'PM2_RAW_MODEL_GENERATED_BINDING')
    need(metadata['pm_uptime'] > 0 and metadata['created_at'] > 0,
         'PM2_GENERATED_TIME_POSITIVE')
    # Conservative forecast of Reload -> resetState -> executeApp -> cluster.fork.
    # Python serialization is used ONLY as a byte-equality gate, never to replace
    # retained application bytes. A JS/Python escape/order difference blocks.
    forecast = copy.deepcopy(e)
    for k, v in e['env'].items():
        need(not isinstance(v, (dict, list)), 'PM2_ENV_MERGE_COERCION_AMBIGUITY')
        if v != '[object Object]':
            forecast[k] = v
    forecast.update(status='launching', pm_uptime=0, restart_time=0,
                    created_at=0, unstable_restarts=0, prev_restart_delay=0,
                    axm_actions=[], axm_monitor={}, axm_options={}, axm_dynamic={})
    forecast['vizion_running'] = forecast.get('vizion_running', False)
    forecast['_pm2_version'] = '7.0.3'
    predicted = json.dumps(forecast, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    ready = pm2_project(predicted) == projected
    return raw_semantics(raw, True, projected), metadata, ready

def pm2_meta_transition(before, after, earliest, latest):
    exact(before, ' '.join(PM2_RAW_GENERATED), 'PM2_BEFORE_META_SCHEMA')
    exact(after, ' '.join(PM2_RAW_GENERATED), 'PM2_AFTER_META_SCHEMA')
    need(all(integer(v) and 0 <= v < 2**53 for v in before.values())
         and all(integer(v) and 0 <= v < 2**53 for v in after.values()), 'PM2_TRANSITION_META_INTEGER')
    need(after['restart_time'] == before['restart_time'] + 1
         and earliest <= after['created_at'] <= after['pm_uptime'] <= latest
         and after['pm_uptime'] > before['pm_uptime']
         and after['created_at'] > before['created_at']
         and after['unstable_restarts'] == after['prev_restart_delay'] == 0,
         'PM2_SOURCE_DEFINED_EXACT_TRANSITION')

''' + s[end:]
s = s.replace("sources = [cfg.node, cfg.pm2_base / 'lib/God/Reload.js', cfg.pm2_base / 'lib/Daemon.js',\n               cfg.pm2_base / 'package.json']", "sources = [cfg.node, cfg.pm2_base / 'lib/Daemon.js',\n               *(cfg.pm2_base / n for n in PM2_GENERATION_PINS)]")
s = s.replace("pins = {str(p): H(regular(p)) for p in sources}\n", "pins = {str(p): H(regular(p)) for p in sources}\n    need(all(pins[str(cfg.pm2_base/n)] == h for n, h in PM2_GENERATION_PINS.items()),\n         'PM2_GENERATION_SOURCE_PIN_DRIFT')\n")
s = s.replace("raw = (cfg.proc / str(pid) / 'environ').read_bytes()\n        out.append", "raw = (cfg.proc / str(pid) / 'environ').read_bytes()\n        semantic, metadata, ready = pm2_raw_binding(raw, r) if own else (raw_semantics(raw), None, None)\n        out.append")
s = s.replace("rawSha256=H(raw), semanticSha256=raw_semantics(raw, own),", "rawSha256=H(raw), semanticSha256=semantic, pm2RawMeta=metadata, pm2ReloadReady=ready,")
s = s.replace("'childConfigSha256 rawSha256 semanticSha256 nodeUniqueId permissionsSha256', 'PROCESS_SCHEMA')", "'childConfigSha256 rawSha256 semanticSha256 nodeUniqueId permissionsSha256 pm2RawMeta pm2ReloadReady', 'PROCESS_SCHEMA')")
s = s.replace("and integer(r['nodeUniqueId']) and r['nodeUniqueId'] >= 0 for r in group)", "and integer(r['nodeUniqueId']) and r['nodeUniqueId'] >= 0\n             and type(r['pm2ReloadReady']) is bool and isinstance(r['pm2RawMeta'], dict)\n             and set(r['pm2RawMeta']) == set(PM2_RAW_GENERATED)\n             and r['pm2RawMeta']['restart_time'] == r['restarts']\n             and all(v is None or (integer(v) and 0 <= v < 2**53)\n                     for v in r['pm2RawMeta'].values()) for r in group)")
s = s.replace("need(len(set(ids)) == 6, 'EXACT_SIX_OWN_SLOTS')", "need(all(r['pm2RawMeta'] is None and r['pm2ReloadReady'] is None\n             for r in rows if r['id'] not in ids), 'UNOWNED_RAW_NO_EXCEPTION')\n    need(len(set(ids)) == 6, 'EXACT_SIX_OWN_SLOTS')")
s = s.replace("expected = {i:dict(pid=x['pid'],restarts=x['restarts'],rawSha256=x['rawSha256'],nodeUniqueId=x['nodeUniqueId'])", "expected = {i:dict(pid=x['pid'],restarts=x['restarts'],rawSha256=x['rawSha256'],nodeUniqueId=x['nodeUniqueId'],\n                          pm2RawMeta=x['pm2RawMeta'])")
s = s.replace("'apiSha256 beforeRawSha256 afterRawSha256 semanticSha256 beforeUniqueId afterUniqueId', 'EVENT_EXACT_SCHEMA')", "'apiSha256 beforeRawSha256 afterRawSha256 semanticSha256 beforeUniqueId afterUniqueId '\n                  'beforePm2RawMeta afterPm2RawMeta attemptSha256 intentStateSha256 intentSequence observedAtUtc',\n                  'EVENT_EXACT_SCHEMA')")
s = s.replace("i = e['id']\n            need", "i = e['id']\n            need(i in expected and e['beforePm2RawMeta'] == expected[i]['pm2RawMeta'],\n                 'STATE_PM2_META_CHAIN')\n            need(integer(e['intentSequence']) and e['intentSequence'] > 0\n                 and e['attemptSha256'] == self.attempt_hash, 'STATE_DURABLE_INTENT_ATTEMPT')\n            intent_raw = regular(self.cfg.receipt/('state-%06d.json' % e['intentSequence']))\n            intent = decode(intent_raw)\n            need(H(intent_raw) == pin(e['intentStateSha256'])\n                 and intent.get('attemptSha256') == self.attempt_hash\n                 and intent.get('sequence') == e['intentSequence']\n                 and all(intent.get(k) == v for k,v in self.common().items())\n                 and intent.get('operation') == (('rollback-reload-intent-' if e['rollback'] else 'reload-intent-') + str(i))\n                 and intent['state']['events'] == st['events'][:st['events'].index(e)]\n                 and intent['state']['transport'] == self.b['c']['transport']\n                 and next(x for x in intent['state']['processes'] if x['id'] == i)['rawSha256'] == e['beforeRawSha256'],\n                 'STATE_DURABLE_SINGLE_SLOT_INTENT')\n            need")
s = s.replace("if e['observedPidChange']:\n                need", "if e['observedPidChange']:\n                pm2_meta_transition(e['beforePm2RawMeta'], e['afterPm2RawMeta'],\n                    int(dt.datetime.fromisoformat(intent['recordedAtUtc']).timestamp()*1000),\n                    int(dt.datetime.fromisoformat(e['observedAtUtc']).timestamp()*1000))\n                need")
s = s.replace("and e['beforeUniqueId'] == e['afterUniqueId'] == expected[i]['nodeUniqueId'], 'STATE_NONTRANSITION_EXACT')", "and e['beforeUniqueId'] == e['afterUniqueId'] == expected[i]['nodeUniqueId']\n                     and e['beforePm2RawMeta'] == e['afterPm2RawMeta'], 'STATE_NONTRANSITION_EXACT')")
s = s.replace("expected[i] = dict(pid=e['afterPid'],restarts=e['afterRestart'],rawSha256=e['afterRawSha256'],nodeUniqueId=e['afterUniqueId'])", "expected[i] = dict(pid=e['afterPid'],restarts=e['afterRestart'],rawSha256=e['afterRawSha256'],\n                               nodeUniqueId=e['afterUniqueId'],pm2RawMeta=e['afterPm2RawMeta'])")
s = s.replace("ignore = {'pid','restarts','rawSha256','nodeUniqueId'}", "ignore = {'pid','restarts','rawSha256','nodeUniqueId','pm2RawMeta'}")
s = s.replace("# Bind exact target API and all adapter source bytes inside the actual Node RPC.", "need(before['pm2ReloadReady'] is True, 'PM2_MODEL_FORK_RETAINED_BYTES_UNPROVEN_NO_RELOAD')\n        # Bind exact target API and all adapter source bytes inside the actual Node RPC.")
s = s.replace("self.checkpoint('rollback-reload-intent-%d' % slot if rollback else 'reload-intent-%d' % slot)", "intent = self.checkpoint('rollback-reload-intent-%d' % slot if rollback else 'reload-intent-%d' % slot)\n        intent_sha, intent_sequence = self.state_hash, self.sequence")
s = s.replace("changed = row['pid'] != before['pid']", "changed = row['pid'] != before['pid']\n        observed_at = now()")
s = s.replace("if changed:\n            need(row['restarts']", "if changed:\n            pm2_meta_transition(before['pm2RawMeta'], row['pm2RawMeta'],\n                int(dt.datetime.fromisoformat(intent['recordedAtUtc']).timestamp()*1000),\n                int(dt.datetime.fromisoformat(observed_at).timestamp()*1000))\n            need(row['restarts']")
s = s.replace("event = dict(id=slot, rollback=rollback", "# Prove source, all twelve rows, permissions and full META BEFORE observation\n        # becomes a journal fact. Failed validation leaves only the durable intent.\n        snap = self.current_snapshot()\n        need(snap == dict(processes=observed, protectedFiles=self.st['protectedFiles'], transport=tr),\n             'OBSERVED_SOURCE_FULLMETA_SET_DRIFT')\n        event = dict(id=slot, rollback=rollback")
s = s.replace("semanticSha256=row['semanticSha256'])", "semanticSha256=row['semanticSha256'], beforePm2RawMeta=before['pm2RawMeta'],\n            afterPm2RawMeta=row['pm2RawMeta'], attemptSha256=self.attempt_hash,\n            intentStateSha256=intent_sha, intentSequence=intent_sequence, observedAtUtc=observed_at)")
p.write_text(s)
sha = hashlib.sha256(p.read_bytes()).hexdigest()
p = ROOT/'prepare-local.py'; s=p.read_text(); s=s.replace("CONTROLLER_SHA = 'd6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec'", "CONTROLLER_SHA = '"+sha+"'"); p.write_text(s)
print(sha)
