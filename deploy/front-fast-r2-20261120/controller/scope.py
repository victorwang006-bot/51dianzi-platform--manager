"""New release identity only; all production base paths come from pinned old scope."""
from pathlib import Path
from pinned_reference import S

OWNER = 'qp4e5jVmsAp0UHKwymyD5X'
SCOPE = 'front-fast-r2-20261120-qp4e5jVm'
STAGE = '/opt/ops/' + SCOPE
TTL = 900
EXPECTED_PROTECTED_FILES = 19588
ALL_IDS = S.ALL_IDS
ADMIN_IDS = S.ADMIN_IDS
FRONT_IDS = S.FRONT_IDS
RELOAD_IDS = S.RELOAD_IDS
TARGET_ROLES = ('admin-api', 'front-api', 'main-html', 'technical-store')
TARGET_PARTS = ('STM8S003F3P6TR', 'W25N04KVZEIR')
SOURCE_SEQUENCE = dict(beforeAdminReload=True, afterAdminBeforeFront=True,
                       eachObservedLiveChange=True, againBeforeClose=True, noStoreRepair=True)
STORE_POLICY = 'strict-initial-CAS-then-each-live-observation-current-source-verified'
FORBIDDEN = {key: False for key in (
    'businessDatabaseWrites', 'ddl', 'environmentWrites', 'nginxWrites',
    'workerJobChanges', 'workerReloads', 'adminHtmlWrites', 'frontendstaticWrites',
    'customerChannelInventoryChanges', 'aliasChanges', 'waitBudgetIncrease')}


class Config(S.Config):
    @property
    def stage(self):
        return self.path(STAGE)

    @property
    def targets(self):
        return {'admin-api': self.admin_api, 'front-api': self.api,
                'main-html': self.html, 'technical-store': self.path(S.TECH_STORE)}

    @property
    def runtime_roots(self):
        return {'front-runtime': self.api.parent.parent / 'runtime',
                'front-helper': self.api.parent.parent / 'runtime',
                'admin-runtime': self.admin_api.parent.parent / 'runtime',
                'technical-helper': self.admin_api.parent.parent / 'runtime'}
