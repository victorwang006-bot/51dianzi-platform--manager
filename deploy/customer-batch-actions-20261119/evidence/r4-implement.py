from pathlib import Path
import hashlib

base = Path('/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119')
p = base / 'release.py'
s = p.read_text()
assert hashlib.sha256(p.read_bytes()).hexdigest() == 'bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab'
s = s.replace("SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R3'", "SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R4'")
s = s.replace("                              Path('/var/lib/dianzi51-private'),)", "                              Path('/var/lib/dianzi51-private'),\n                              Path('/opt/ops/dianzi51-recommendation'),\n                              Path('/opt/releases/20261009T170014Z-memory-isolation/dianzi51-platform'))")
helper = '''# Fixed non-PM2 protection: no CLI selector, discovery, fallback or lifecycle action.
EXTERNAL_PARENT_PID = 2060125
EXTERNAL_CHILD_PID = 2060126
EXTERNAL_OPS = Path('/opt/ops/dianzi51-recommendation')
EXTERNAL_CWD = Path('/opt/releases/20261009T170014Z-memory-isolation/dianzi51-platform')
EXTERNAL_SCRIPT = EXTERNAL_OPS / 'releases/20261112-forum12-1255b7b84aa3adac09cb8c05/worker-runtime-bootstrap.mjs'

def external_proc_identity(cfg, pid):
    # procfs bytes are virtual (often st_size=0): use the existing read_bytes
    # semantics, not regular-file size checks. State is live-only, not normalized.
    data = (cfg.proc / str(pid) / 'stat').read_bytes()
    head, sep, tail = data.rpartition(b') ')
    prefix = str(pid).encode() + b' ('
    fields = tail.split()
    need(sep and head.startswith(prefix) and len(fields) >= 20
         and fields[0] not in (b'Z', b'X', b'x')
         and re.fullmatch(rb'[0-9]+', fields[1])
         and re.fullmatch(rb'[1-9][0-9]*', fields[19]), 'EXTERNAL_PROC_STAT_IDENTITY')
    return dict(pid=pid, ppid=int(fields[1]), startTicks=int(fields[19]),
                nameSha256=H(head[len(prefix):]))

def external_proc_link(cfg, pid, name):
    value = os.readlink(cfg.proc / str(pid) / name)
    p = Path(value)
    need(p.is_absolute() and str(p) == value and '..' not in p.parts
         and not value.endswith(' (deleted)'), 'EXTERNAL_DELETED_OR_NONCANONICAL_LINK')
    # Only the kernel's actual path is used; unsupported file links fail closed.
    return no_link(p)

def external_source(path):
    record = describe(no_link(path))
    need(record['kind'] == 'file' and record['nlink'] == 1,
         'EXTERNAL_SINGLE_REGULAR_SOURCE')
    need(describe(path) == record, 'EXTERNAL_SOURCE_META_READ_RACE')
    return record

def external_proc_sample(cfg, pid, expected_exe, script=None, cwd=None):
    identity_before = external_proc_identity(cfg, pid)
    proc = no_link(cfg.proc / str(pid))
    proc_record = meta(proc)
    need(stat.S_ISDIR(proc_record['statmode']), 'EXTERNAL_PROC_DIRECTORY')
    exe = external_proc_link(cfg, pid, 'exe')
    current_cwd = external_proc_link(cfg, pid, 'cwd')
    link_meta = {name: meta(proc / name) for name in ('exe', 'cwd')}
    need(exe.name == expected_exe, 'EXTERNAL_ACTUAL_EXE_NAME')
    cwd_record = describe(current_cwd)
    need(cwd_record['kind'] == 'directory', 'EXTERNAL_CWD_DIRECTORY')
    if cwd is not None:
        need(current_cwd == cwd, 'EXTERNAL_EXACT_CHILD_CWD')
    cmdline = (proc / 'cmdline').read_bytes()
    need(cmdline.endswith(b'\\0'), 'EXTERNAL_CMDLINE_NUL')
    args = cmdline[:-1].split(b'\\0')
    need(args and all(args) and Path(os.fsdecode(args[0])).name == expected_exe,
         'EXTERNAL_CMDLINE_EXE_BINDING')
    if script is not None:
        # Only plain known bootstrap argv is supported. Unknown loader/flags
        # are not inferred, executed or excused by opaque-byte equality.
        need(len(args) == 2 and args[1] == os.fsencode(script),
             'EXTERNAL_EXACT_CHILD_SCRIPT_ARGV')
    raw = (proc / 'environ').read_bytes()
    need(not raw or raw.endswith(b'\\0'), 'EXTERNAL_ENV_NUL')
    permission_hash = permissions(cfg, pid)
    record = dict(identity_before, exeName=expected_exe, exe=str(exe), cwd=str(current_cwd),
                  knownScript=str(script) if script is not None else None,
                  rawSha256=H(raw), cmdlineSha256=H(cmdline),
                  permissionsSha256=permission_hash, procMeta=proc_record,
                  kernelLinkMeta=link_meta, cwdMeta=cwd_record)
    need(external_proc_identity(cfg, pid) == identity_before
         and meta(proc) == proc_record
         and all(external_proc_link(cfg, pid, name) == path
                 for name, path in (('exe', exe), ('cwd', current_cwd)))
         and {name: meta(proc / name) for name in ('exe', 'cwd')} == link_meta,
         'EXTERNAL_PROC_IDENTITY_READ_RACE')
    return record

def external_protection_sample(cfg, ops, cwd, script):
    roots = {str(p): describe(no_link(p)) for p in (ops, cwd)}
    need(all(v['kind'] == 'directory' for v in roots.values()), 'EXTERNAL_ROOT_DIRECTORIES')
    parent = external_proc_sample(cfg, EXTERNAL_PARENT_PID, 'flock')
    child = external_proc_sample(cfg, EXTERNAL_CHILD_PID, 'node-22', script, cwd)
    need(child['ppid'] == parent['pid'] and parent['ppid'] not in
         (parent['pid'], child['pid']), 'EXTERNAL_EXACT_PARENT_CHILD')
    files = {Path(parent['exe']), Path(child['exe']), cfg.node, script}
    source_meta = {str(p): external_source(p) for p in sorted(files)}
    need(source_meta[child['exe']]['sha256'] == source_meta[str(cfg.node)]['sha256'],
         'EXTERNAL_NODE_FULL_SHA_BINDING')
    need({str(p): describe(p) for p in (ops, cwd)} == roots,
         'EXTERNAL_ROOT_META_READ_RACE')
    return dict(fixtureOnly=cfg.mock, processes=[parent, child],
                sources={p: v['sha256'] for p, v in source_meta.items()},
                fullSourceMeta=source_meta, rootMeta=roots)

def external_protection(cfg, fixture=None):
    """Pure readonly, two COMPLETE samples; fixture routing exists only in mock.
    Parent cwd is observed shallowly, never guessed or recursively enumerated.
    Dependency/loader semantics still require actual-source/full-tree review.
    """
    need(fixture is None or cfg.mock, 'EXTERNAL_FIXTURE_ONLY_NO_PRODUCTION_OVERRIDE')
    if cfg.mock and fixture is None:
        return dict(fixtureOnly=True, processes=[], sources={}, fullSourceMeta={}, rootMeta={})
    if fixture is None:
        need(cfg.proc == Path('/proc'), 'EXTERNAL_FIXED_PRODUCTION_PROC')
        ops, cwd, script = EXTERNAL_OPS, EXTERNAL_CWD, EXTERNAL_SCRIPT
    else:
        exact(fixture, 'ops cwd script', 'EXTERNAL_FIXTURE_PATH_SCHEMA')
        ops, cwd, script = (no_link(fixture[k]) for k in ('ops', 'cwd', 'script'))
    need(ops in cfg.extra_protected and cwd in cfg.extra_protected
         and ops in script.parents, 'EXTERNAL_REQUIRED_EXACT_ROOTS')
    first = external_protection_sample(cfg, ops, cwd, script)
    second = external_protection_sample(cfg, ops, cwd, script)
    need(first == second, 'EXTERNAL_TWO_SAMPLE_DRIFT')
    return first

'''
assert s.count('def transport(cfg):\n') == 1
s = s.replace('def transport(cfg):\n', helper + 'def transport(cfg):\n    external = external_protection(cfg)\n')
s = s.replace("    pins = {str(p): H(regular(p)) for p in sources}\n", "    pins = {str(p): H(regular(p)) for p in sources}\n    need(all(p not in pins or pins[p] == h for p, h in external['sources'].items()),\n         'EXTERNAL_TRANSPORT_SOURCE_COLLISION')\n    pins.update(external['sources'])\n")
s = s.replace("    need(adapter_files(cfg, entries) == adapters, 'ADAPTER_FULL_META_SET_DRIFT')\n", "    need(adapter_files(cfg, entries) == adapters, 'ADAPTER_FULL_META_SET_DRIFT')\n    need(external_protection(cfg) == external, 'EXTERNAL_TRANSPORT_DRIFT')\n")
s = s.replace('                sources=pins, fullAdapterMeta=adapters,\n', '                sources=pins, fullAdapterMeta=adapters, externalProtection=external,\n')
p.write_text(s)
pin = hashlib.sha256(p.read_bytes()).hexdigest()
p = base / 'prepare-local.py'
s = p.read_text().replace("CONTROLLER_SHA = 'bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab'", "CONTROLLER_SHA = '" + pin + "'")
p.write_text(s)
print('R4 controller SHA256:', pin)
