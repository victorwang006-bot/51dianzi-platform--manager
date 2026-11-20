"""Fixed release boundaries; no environment variables or CLI scope overrides.
Technical paths MUST be replaced/pinned after the backend agent's final package.
Changing this file changes the source bundle hash and invalidates capture/review.
"""
from dataclasses import dataclass
from pathlib import Path
import os
import stat

OWNER = '4GJ2toNWchKZvE77eLiWZ1'
SCOPE = 'release-inline-20261119-4GJ2toNWchKZvE77eLiWZ1'
TTL = 900
ALL_IDS = (0, 190, 191, 192, 193, 194, 200, 201, 202, 203, 204, 205)
FRONT_IDS = (190, 193, 194, 200)
ADMIN_IDS = (191, 192)
RELOAD_IDS = ADMIN_IDS + FRONT_IDS
FRONT_API = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
ADMIN_API = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'
FRONT_CWD = '/opt/releases/20261031-forum-quote-v34/front'
ADMIN_CWD = '/opt/releases/20261031-wechat-chat-entry-v33/admin'
FRONT_PUBLIC = '/opt/releases/20261031-homepage-banner-v39/front/dist/public'
ADMIN_PUBLIC = '/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
STAGE = '/opt/ops/' + SCOPE
COORD = '/opt/ops/51-project-release-coordination-20261027.json'
LOCKS = ('/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock')
SEVEN_LINKS = {
 '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/public': ADMIN_PUBLIC,
 '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/public': FRONT_PUBLIC,
 **{'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/'+name:
    '/opt/releases/20261104-admin-upload-stars-layout-v22/front/dist/'+name
    for name in ('forumPdfScanWorker.mjs','marketSnapshotRefresh.js','publicHotSnapshotRefresh.js',
                 'recommendationValueRefresh.js','server')}}
PM2_PINS = {
 '/usr/local/lib/node_modules/pm2/lib/God/Reload.js':
 '5e90112e447c4634009ea35005ffd477aab93064f55390288c56b51eee25992e',
 '/usr/local/lib/node_modules/pm2/lib/Daemon.js':
 'c4e27c6a2b0f380c9846e298b7a1ef4c745c8f33f00bbd61d9a10eee19ee2fb9'}
EXTRA_PROTECTED = tuple(PM2_PINS) + (
 '/opt/config/dianzi51-admin/runtime.env', '/opt/config/dianzi51/runtime.env', '/root/.pm2/dump.pm2')
# Fixed final candidate paths; source precheck passed, NOT production approval.
TECH_SCOPE_READY = True
FRONT_RUNTIME = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/runtime/officialMall.front.0228652b747000065cdc706661a225fc8f2194a10a0900a7c88dc1174c3d3724.runtime.mjs'
ADMIN_RUNTIME = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/runtime/officialMall.admin.inline.73650c633f4a76ea7133bf528c4b8cc28abe4626836a085a0dbc464a9cdd0641.runtime.mjs'
TECH_HELPER = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/runtime/officialTechnical.9b8758fe8f8b42c4c33eb6c4931656baa901bf48717b1a9df26a0ed1b0e3bba8.runtime.mjs'
TECH_STORE = '/var/lib/dianzi51-private/official-technical/prepared-v1.json'
TECH_DIRECTORIES = ('/var/lib/dianzi51-private', '/var/lib/dianzi51-private/official-technical')
# Final standalone helper must be independently reviewed: --verify only, readonly SQL,
# existing ADMIN_DB_URL inherited, no environment replacement or store repair.
SOURCE_VERIFIER_FILE = 'evidence/prepare-official-technical.mjs'
SOURCE_VERIFIER_SHA = '32b300f64ace7feef5df417de3d2f1ef9f13d587b4d03bf44025cbc0d2f2bbc1'

@dataclass(frozen=True)
class Config:
    """Production is fixed. root remapping is accepted ONLY for anonymous /tmp fixtures.
    No per-path, owner, ID, TTL, protections, semantic or adapter pin overrides.
    """
    fixture_root: Path | None = None

    def __post_init__(self):
        if self.fixture_root is not None:
            p = self.fixture_root
            if not isinstance(p, Path) or not p.is_absolute() or not str(p).startswith('/tmp/'):
                raise ValueError('ANONYMOUS_TMP_FIXTURE_ROOT_ONLY')
            for parent in (p, *p.parents):
                if parent.is_symlink():
                    raise ValueError('FIXTURE_ROOT_SYMLINK')
            s = p.stat()
            if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) & 0o077:
                raise ValueError('PRIVATE_FIXTURE_ROOT_REQUIRED')

    def path(self, value):
        return Path(value) if self.fixture_root is None else self.fixture_root / value.lstrip('/')

    @property
    def public(self): return self.path(ADMIN_PUBLIC)
    @property
    def front(self): return self.path(FRONT_PUBLIC)
    @property
    def html(self): return self.front/'index.html'
    @property
    def api(self): return self.path(FRONT_API)
    @property
    def admin_api(self): return self.path(ADMIN_API)
    @property
    def coord(self): return self.path(COORD)
    @property
    def stage(self): return self.path(STAGE)
    @property
    def package(self): return self.stage/'package'
    @property
    def receipt(self): return self.stage/'receipt'
    @property
    def locks(self): return tuple(self.path(p) for p in LOCKS)
    @property
    def nginx(self): return self.path('/etc/nginx')
    @property
    def ops(self): return self.path('/opt/ops')
    @property
    def proc(self): return self.path('/proc')
    @property
    def server_alias(self): return self.path(next(a for a in SEVEN_LINKS if a.endswith('/server')))
    @property
    def server_target(self): return self.path(SEVEN_LINKS[next(a for a in SEVEN_LINKS if a.endswith('/server'))])
    @property
    def extra_links(self): return tuple((self.path(a), self.path(t)) for a,t in sorted(SEVEN_LINKS.items()))
    @property
    def extra_protected(self):
        store_root=self.path(TECH_DIRECTORIES[0])
        return tuple(self.path(p) for p in EXTRA_PROTECTED) + ((store_root,) if store_root.exists() else ())
    @property
    def technical_directories(self): return tuple(self.path(p) for p in TECH_DIRECTORIES)
    @property
    def technical_paths(self):
        return {'front-runtime': self.path(FRONT_RUNTIME), 'admin-runtime': self.path(ADMIN_RUNTIME),
                'technical-helper': self.path(TECH_HELPER), 'technical-store': self.path(TECH_STORE)}
    @property
    def technical_ready(self): return TECH_SCOPE_READY or self.fixture_root is not None
