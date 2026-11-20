"""Load reviewed sources only after verifying all three complete SHA256 pins.
No legacy Controller/main is invoked. Temporarily scoped imports prevent collisions.
"""
import hashlib
import os
from pathlib import Path
import stat
import sys
import types

PINS = {
    'release.py': '57cc80e961fde0cdbc3ab4742551bb016786c06fbbf1034cb7c17ea9797cb161',
    'safe_helpers.py': '655bc995a61aa6252e836a128eadf9a7f3ec18ea452846bc11e92f4e9543b882',
    'scope.py': '4de5c1db9166cbdf7bfa6dcd68df56950395138c6ecfb0befcae4aea42cfff21',
}
LIVE_REFERENCE = Path('/opt/ops/release-inline-20261119-4GJ2toNWchKZvE77eLiWZ1/controller')
HERE = Path(__file__).absolute().parent


def read_source(path):
    for p in (path, *path.parents):
        if p.is_symlink():
            raise RuntimeError('REFERENCE_SOURCE_SYMLINK')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise RuntimeError('REFERENCE_SOURCE_NOT_REGULAR')
        with os.fdopen(fd, 'rb', closefd=False) as f:
            data = f.read()
        end = os.fstat(fd)
        if (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns) != (
                end.st_dev, end.st_ino, end.st_size, end.st_mtime_ns, end.st_ctime_ns):
            raise RuntimeError('REFERENCE_SOURCE_CHANGED')
        return data
    finally:
        os.close(fd)


def verify_sources(directory):
    out = {}
    for name, digest in PINS.items():
        data = read_source(directory / name)
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError('REFERENCE_PIN_MISMATCH:' + name)
        out[name] = data
    return out


def load():
    sources = verify_sources(HERE / 'reference')
    saved = {name: sys.modules.get(name) for name in ('safe_helpers', 'scope', '_fast_reviewed_release')}
    modules = {}
    try:
        for name, filename in [('safe_helpers', 'safe_helpers.py'), ('scope', 'scope.py'),
                               ('_fast_reviewed_release', 'release.py')]:
            mod = types.ModuleType(name)
            mod.__file__ = str(HERE / 'reference' / filename)
            sys.modules[name] = mod
            exec(compile(sources[filename], mod.__file__, 'exec'), mod.__dict__)
            modules[name] = mod
    finally:
        for name, old in saved.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old
    return modules['_fast_reviewed_release'], modules['safe_helpers'], modules['scope']


R, H, S = load()
