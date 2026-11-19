#!/usr/bin/env python3
"""Local safety primitives only. NO apply/SSH/PM2/SQL/network/dynamic execution.

All file writes are restricted to a canonical /tmp/controller-offline-* fixture.
Pure manifest/proof functions consume already supplied bytes; they neither collect
production state nor establish independent review or readiness on their own.
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import uuid

OWNER = "yOJKWq2DYYh42oMQkoK7ow"
SCOPE = "official-cart-compact"
NEW_FLAG = "/opt/ops/official-cart-active-20261119.json"
OLD_FLAG = "/opt/ops/official-checkout-active-20261118.json"
COORD = "/opt/ops/51-project-release-coordination-20261027.json"
LOCKS = ("/var/lock/dianzi51-public-deploy.lock", "/var/lock/dianzi51-production-code.lock")
RELOAD_IDS = (190, 193, 194, 200, 203)  # Initial observation; final capture must repin.
VOLATILE = frozenset(("unique_id", "NODE_UNIQUE_ID", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"))
GATES = frozenset(("sourceBinding", "api", "stock", "schema", "getProbe", "static", "durableHistory"))


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def H(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=_unique_json)


@dataclass(frozen=True)
class ScopeSeal:
    """Trusted root-review inputs, never populated from the candidate manifest."""
    manifest_sha256: str
    controller_sha256: str
    declaration_sha256: str
    module_sha256: str
    review_sha256: str
    capture_sha256: str
    targets_sha256: str
    package_files: tuple  # Exact (relative filename, SHA256) tuples.
    stage_canonical: str
    reload_ids: tuple


def validate_sealed(raw, package, seal):
    """Validate a closed byte package; do not import or execute ANY package file."""
    need(H(raw) == seal.manifest_sha256, "MANIFEST_PIN")
    m = decode(raw)
    fields = {"schemaVersion", "ownerTask", "scope", "mode", "controllerSha256",
              "sourceDeclarationSha256", "newModuleSha256", "reviewSha256", "captureSha256",
              "readinessFile", "stageCanonical", "reloadIds", "packageFiles", "targets"}
    need(set(m) == fields, "EXACT_MANIFEST_SCHEMA_NO_COMMANDS")
    need(m["schemaVersion"] == 1 and m["mode"] == "local-plan-only" and
         m["ownerTask"] == OWNER and m["scope"] == SCOPE, "EXACT_OWNER_SCOPE")
    for field, expected in (("controllerSha256", seal.controller_sha256),
                            ("sourceDeclarationSha256", seal.declaration_sha256),
                            ("newModuleSha256", seal.module_sha256),
                            ("reviewSha256", seal.review_sha256),
                            ("captureSha256", seal.capture_sha256)):
        need(digest(expected) and m[field] == expected, "REVIEW_BINDING")
    need(m["readinessFile"] == NEW_FLAG, "ONLY_NEW_READINESS")
    need(m["stageCanonical"] == seal.stage_canonical and
         str(PurePosixPath(seal.stage_canonical)) == seal.stage_canonical and
         PurePosixPath(seal.stage_canonical).parent == PurePosixPath("/data/archive/backups") and
         ".." not in PurePosixPath(seal.stage_canonical).parts, "EXACT_CANONICAL_STAGE")
    need(tuple(m["reloadIds"]) == seal.reload_ids and
         seal.reload_ids in ((), RELOAD_IDS), "EXACT_STATIC_ZERO_OR_FIVE_RELOADS")
    expected = dict(seal.package_files)
    need(len(expected) == len(seal.package_files) and expected and
         m["packageFiles"] == expected and set(package) == set(expected), "CLOSED_PACKAGE_FILES")
    for name, sha in expected.items():
        p = PurePosixPath(name)
        need(not p.is_absolute() and ".." not in p.parts and name == str(p) and
             "\\" not in name and digest(sha), "PACKAGE_PATH_OR_HASH")
        need(isinstance(package[name], bytes) and H(package[name]) == sha, "PACKAGE_BYTE_PIN")
    need(seal.module_sha256 in expected.values() and seal.declaration_sha256 in expected.values(),
         "ACTUAL_MODULE_AND_DECLARATION_BYTES_REQUIRED")
    need(isinstance(m["targets"], list) and m["targets"] and
         H(canonical(m["targets"])) == seal.targets_sha256, "ROOT_REVIEW_TARGET_ALLOWLIST")
    seen = set()
    for target in m["targets"]:
        need(set(target) == {"path", "beforeSha256", "afterSha256", "packageFile"}, "EXACT_TARGET_FIELDS")
        path = PurePosixPath(target["path"])
        need(path.is_absolute() and str(path) == target["path"] and ".." not in path.parts and
             path.is_relative_to("/opt/releases") and target["path"] not in seen, "TARGET_SCOPE")
        seen.add(target["path"])
        need(target["beforeSha256"] is None or digest(target["beforeSha256"]), "BEFORE_PIN")
        need(target["packageFile"] in expected and digest(target["afterSha256"]) and
             expected[target["packageFile"]] == target["afterSha256"], "AFTER_PIN")
    need(any(t["afterSha256"] == seal.module_sha256 for t in m["targets"]), "NEW_MODULE_INSTALL_BINDING")
    return {"status": "sealed-local-plan-valid", "productionReady": False, "activeWrites": 0}


def config_hash(pm2_env):
    """Retain ALL nested user keys and ALL uppercase top keys except exactly four."""
    need(isinstance(pm2_env, dict) and isinstance(pm2_env.get("env"), dict), "ENV_SHAPE")
    value = {"env": {k: v for k, v in pm2_env["env"].items() if k not in VOLATILE},
             "topEnv": {k: v for k, v in pm2_env.items() if k.isupper() and k not in VOLATILE}}
    # EXACT release_common.processes() byte encoding, including ensure_ascii=True.
    return H(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())


def compare_captured_processes(before, after, *, stage="static", reloaded_ids=()):
    """Consume protection-initial.json's REAL schema; never invent raw/actual hashes.

    This proves only captured configured envHash/PID/path stability. /proc raw and
    effective user configuration require independent actual evidence, not conversion
    from envHash. Static defaults to NO PID allowance. API allowance is explicit.
    """
    fields = {"id", "name", "pid", "status", "script", "cwd", "envHash"}
    need(stage in ("static", "api"), "EXACT_RELEASE_STAGE")
    need(len(before) == len(after) == 12 and all(set(r) == fields for r in before + after),
         "EXACT_CAPTURED_PROCESS_SCHEMA")
    a, b = {r["id"]: r for r in before}, {r["id"]: r for r in after}
    need(len(a) == len(b) == 12 and set(a) == set(b), "EXACT_CAPTURED_PROCESS_IDS")
    front = [r["id"] for r in before if r["name"] == "dianzi51" and r["script"] ==
             "/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js"]
    refund = [r["id"] for r in before if r["name"] == "dianzi51-refund" and r["script"] ==
              "/opt/releases/20261018-multi-enterprise-v1/web/dist/refundWorker.js"]
    need(len(front) == 4 and len(refund) == 1, "CAPTURED_FRONT4_REFUND1_PARTITION")
    planned = set(reloaded_ids)
    need(len(planned) == len(reloaded_ids) and planned <= set(front + refund), "PLANNED_CAPTURED_RELOAD_SCOPE")
    need(stage == "api" or not planned, "STATIC_ZERO_RELOAD_REQUIRED")
    for pid in sorted(a):
        x, y = a[pid], b[pid]
        need(x["status"] == y["status"] == "online" and x["pid"] > 0 and y["pid"] > 0 and
             digest(x["envHash"]) and digest(y["envHash"]), "CAPTURED_ONLINE_ENVHASH")
        ignore = {"pid"} if pid in planned else set()
        need({k: v for k, v in x.items() if k not in ignore} ==
             {k: v for k, v in y.items() if k not in ignore}, "CAPTURED_PROCESS_CONFIG_OR_PID_DRIFT")
    return {"configuredEnvAndPidVerified": True, "rawEnvironVerified": False,
            "actualUserConfigVerified": False, "reloadIds": sorted(planned)}


def compare_processes(before, after, reloaded_ids=()):
    """Inputs must include real /proc raw hash + separately verified actual user hash."""
    a, b = {r["id"]: r for r in before}, {r["id"]: r for r in after}
    need(len(a) == len(b) == len(before) == len(after) == 12 and set(a) == set(b), "TWELVE_PROCESS_IDS")
    changing = set(reloaded_ids)
    need(changing <= set(RELOAD_IDS), "RELOAD_SCOPE")
    fields = {"id", "name", "pid", "status", "script", "cwd", "mode", "configSha256",
              "actualUserSha256", "rawEnvSha256"}
    for pid in sorted(a):
        x, y = a[pid], b[pid]
        need(set(x) == set(y) == fields and y["status"] == "online" and y["pid"] > 0, "PROCESS_SHAPE_ONLINE")
        ignore = {"pid", "rawEnvSha256"} if pid in changing else set()
        need({k: v for k, v in x.items() if k not in ignore} ==
             {k: v for k, v in y.items() if k not in ignore}, "PROCESS_CONFIG_OR_FOREIGN_RAW_DRIFT")
    return True


class OfflineFiles:
    """This implementation deliberately cannot be bound to /opt or application roots."""
    def __init__(self, root):
        self.root = Path(root)
        base = Path(tempfile.gettempdir()).resolve()
        need(self.root.is_dir() and not self.root.is_symlink() and
             self.root.resolve() == self.root and self.root.parent == base and
             self.root.name.startswith("controller-offline-"), "OFFLINE_FIXTURE_ROOT_ONLY")

    def path(self, name):
        p = self.root / name
        need(not Path(name).is_absolute() and ".." not in Path(name).parts and
             p.parent == self.root and not p.is_symlink(), "OFFLINE_FILE_SCOPE")
        return p

    def read(self, name):
        p = self.path(name)
        need(p.is_file(), "REGULAR_FILE_REQUIRED")
        return p.read_bytes()

    def syncdir(self):
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def cas(self, name, before, after):
        p = self.path(name)
        need(self.read(name) == before, "FULL_BYTE_CAS")
        mode = p.stat()
        temp = self.root / (".controller-cas-" + uuid.uuid4().hex)
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IMODE(mode.st_mode))
        try:
            with os.fdopen(fd, "wb") as out:
                os.fchmod(out.fileno(), stat.S_IMODE(mode.st_mode))
                os.fchown(out.fileno(), mode.st_uid, mode.st_gid)
                out.write(after)
                out.flush()
                os.fsync(out.fileno())
            need(self.read(name) == before, "LAST_FULL_BYTE_CAS")
            os.replace(temp, p)
            self.syncdir()  # Failure here MUST be treated as a possible commit.
        finally:
            if temp.exists():
                temp.unlink()

    def create(self, name, data):
        p = self.path(name)
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        self.syncdir()


def observed_state(fs, name, before, after):
    value = fs.read(name)
    return "before" if value == before else "owned-after" if value == after else "foreign"


def recover_owned(fs, *, target, before, after, coord, owned_coord, marker,
                  flag=None, owned_flag=None, disabled_flag=None,
                  activation_attempted=False, diagnostic=lambda result: None):
    """Never overwrite foreign state; post-activation intent permanently bars rollback.

    Caller must mark activation_attempted BEFORE attempting flag CAS, even when it
    subsequently raises. This conservative exposure latch cannot be reset by a
    missing/disabled flag. Returned status is offline recovery, not prod verification.
    """
    result = {"status": "recovery-required", "codeRollback": False, "flagDisabled": False,
              "markerWritten": False, "errors": []}
    exposure = activation_attempted
    if flag is not None:
        try:
            current = fs.read(flag)
            if current == owned_flag:
                exposure = exposure or decode(current).get("enabled") is True
                fs.cas(flag, owned_flag, disabled_flag)
                result["flagDisabled"] = fs.read(flag) == disabled_flag
            elif current == disabled_flag:
                result["flagDisabled"] = True
            else:
                exposure = True  # Foreign flag cannot establish never-enabled proof.
                result["errors"].append("FOREIGN_FLAG_UNTOUCHED")
        except BaseException:
            exposure = True
            # A directory-fsync failure can follow a committed disable.
            try:
                result["flagDisabled"] = fs.read(flag) == disabled_flag
            except BaseException:
                pass
            result["errors"].append("FLAG_DISABLE_FAILURE")
    try:
        fs.create(marker, canonical({"status": "failclosed", "activationAttemptedOrPossible": exposure}))
        result["markerWritten"] = True
    except BaseException:
        result["errors"].append("FAILCLOSED_MARKER_FAILURE")
    if not exposure:
        try:
            need(fs.read(coord) == owned_coord, "FOREIGN_COORD_UNTOUCHED")
            state = observed_state(fs, target, before, after)
            need(state != "foreign", "FOREIGN_TARGET_UNTOUCHED")
            if state == "owned-after":
                fs.cas(target, after, before)
            result["codeRollback"] = fs.read(target) == before
            result["status"] = "owned-code-restored-offline"
        except BaseException:
            result["errors"].append("OWNED_RECOVERY_FAILURE")
    else:
        result["errors"].append("POST_ACTIVATION_CODE_RETAINED")
    try:
        diagnostic(dict(result))
    except BaseException:
        result["errors"].append("DIAGNOSTIC_FAILURE")
    return result


def readiness_payload(closed_raw, *, expected_closed_sha256, nonce, manifest_sha256,
                      module_sha256, config_sha256, declaration_sha256, gates):
    """Pure plan payload; NOT a writer and NOT sufficient production evidence."""
    pins = {"manifestSha256": manifest_sha256, "runtimeSha256": module_sha256,
            "configFileSha256": config_sha256, "sourceDeclarationSha256": declaration_sha256}
    need(all(digest(v) for v in pins.values()) and digest(expected_closed_sha256) and
         H(closed_raw) == expected_closed_sha256, "DURABLE_CLOSED_BYTES_PIN")
    need(isinstance(nonce, str) and re.fullmatch(r"[a-f0-9]{32}", nonce), "OWN_NONCE")
    need(set(gates) == GATES and all(v is True for v in gates.values()), "ALL_VERIFIED_GATES_REQUIRED")
    c = decode(closed_raw)
    need(c.get("shared_release_active") is False, "FORMAL_WINDOW_NOT_CLOSED")
    w = c.get("window", {})
    need(w.get("owner_task") == OWNER and w.get("scope") == SCOPE and
         w.get("nonce") == nonce and w.get("status") == "verified" and
         isinstance(w.get("closedAtUtc"), str) and bool(w["closedAtUtc"]) and
         w.get("needsOperatorRecovery") is False and
         all(w.get(k) == v for k, v in pins.items()), "OWN_VERIFIED_CLOSURE_REQUIRED")
    matches = [h for h in c.get("window_history", []) if h.get("nonce") == nonce]
    need(len(matches) == 1 and matches[0] == w, "EXACT_OWN_DURABLE_HISTORY")
    return {"schemaVersion": 1, "enabled": True, "ownerTask": OWNER, "scope": SCOPE,
            "nonce": nonce, **pins, "closureSha256": expected_closed_sha256,
            "proofMode": "local-plan-only-not-activation"}


if __name__ == "__main__":
    print(json.dumps({"status": "LOCAL_PREPARATION_ONLY", "productionApplySupported": False,
                      "activeWrites": 0, "productionReady": False}))
