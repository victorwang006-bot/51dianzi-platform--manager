#!/usr/bin/env python3
"""Bounded customer release: source-bound APIs, additive UI, locks and exact CAS rollback."""
import argparse
import concurrent.futures
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.request

TASK = "CKSZQ7sVc7tADM21c3LWpu"
ROOT = Path("/opt/ops/20261114-demand-personal-center-CKSZQ7s-r2")
PUBLIC = Path("/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public")
COORD = Path("/opt/ops/51-project-release-coordination-20261027.json")
APIS = {
    "dianzi51": "/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js",
    "dianzi51-admin": "/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js",
}
PROOF_FLAGS = ("unrelatedNativeBytesUnchanged", "mallOperationsUnchanged", "scopeAndArchiveUnchanged", "latestGlobalOrdersBytesPreserved")


def require(ok, text):
    if not ok:
        raise RuntimeError(text)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def atomic(path, data, mode=None):
    path = Path(path)
    previous = path.stat() if path.exists() else None
    fd, tmp = tempfile.mkstemp(prefix=".customer-workbench-", dir=path.parent)
    try:
        os.fchmod(fd, mode if mode is not None else (previous.st_mode & 0o777 if previous else 0o644))
        if previous:
            os.fchown(fd, previous.st_uid, previous.st_gid)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def save(path, obj):
    atomic(path, (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode(), 0o600)


def processes():
    rows = json.loads(subprocess.check_output(["pm2", "jlist"], timeout=30))
    return sorted([{"id": r["pm_id"], "name": r["name"], "pid": r["pid"],
        "status": r["pm2_env"]["status"], "script": r["pm2_env"]["pm_exec_path"],
        "cwd": r["pm2_env"]["pm_cwd"], "execMode": r["pm2_env"]["exec_mode"],
        "environmentHash": digest(r["pm2_env"].get("env", {}))} for r in rows], key=lambda row: row["id"])


def compatible(before, after, recovery_ids=()):
    """Config/identity always frozen; only exact owned recovery ids may lack liveness."""
    require(len(before) == len(after), "PROCESS_COUNT_CHANGED")
    require(len({row["id"] for row in before}) == len(before)
        and len({row["id"] for row in after}) == len(after), "DUPLICATE_PROCESS_ID")
    for old, current in zip(before, after):
        if old["name"] not in APIS:
            require(old == current, "INDEPENDENT_WORKER_CHANGED")
        else:
            require({k: v for k, v in old.items() if k not in ("pid", "status")}
                == {k: v for k, v in current.items() if k not in ("pid", "status")}
                and old["status"] == "online" and old["pid"] > 0, "API_PATH_OR_ENVIRONMENT_CHANGED")
            require(old["id"] in recovery_ids or (current["pid"] > 0 and current["status"] == "online"),
                "API_LIVENESS_NOT_CONFIRMED")


def reload_intents(backends, before):
    """No missing/foreign intent can authorize an unhealthy original process."""
    path = ROOT / "reload-intents.json"
    intents = json.loads(path.read_text()) if path.exists() else []
    require(isinstance(intents, list), "RELOAD_INTENTS_INVALID")
    ids = set()
    for intent in intents:
        require(isinstance(intent, dict) and intent.get("ownerTask") == TASK, "RELOAD_INTENT_OWNER_CHANGED")
        row = next((row for row in before if row["id"] == intent.get("id")), None)
        item = next((item for item in backends if item["processName"] == intent.get("name")), None)
        require(row is not None and item is not None and row["name"] == intent.get("name")
            and row["script"] == item["path"] == APIS.get(row["name"])
            and intent.get("apiHash") == item["sha256"] and row["id"] not in ids, "RELOAD_INTENT_TARGET_CHANGED")
        ids.add(row["id"])
    return intents, ids


def reload_instance(row, rollback=False):
    env = dict(os.environ)
    if rollback:
        env["D51_EXACT_ROLLBACK"] = "1"
    else:
        env.pop("D51_EXACT_ROLLBACK", None)
    command = ["node", str(ROOT / "reload-demand-personal-api-20261114.cjs"), "--id", str(row["id"])]
    try:
        result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("TARGETED_RELOAD_FAILED_OUTPUT_SUPPRESSED") from None
    require(result.returncode == 0, "TARGETED_RELOAD_FAILED_OUTPUT_SUPPRESSED")
    print("Verified rolling API reload: " + row["name"] + " instance " + str(row["id"]), flush=True)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
        require(response.status == 200, "HTTP_FAILED")
        return {"url": url, "status": response.status, "sha256": hashlib.sha256(body).hexdigest()}, body


def protected_api_health(process_name):
    url = "https://admin.51dianzi.com/api/trpc/personalCenter.profile" if process_name == "dianzi51-admin" else \
        "https://www.51dianzi.com/api/trpc/personalPerformance.summary?input=%7B%22json%22%3A%7B%22month%22%3A%222026-11%22%7D%7D"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            code, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        code, body = error.code, error.read()
    require(code in (401, 403), "NEW_API_ANONYMOUS_AUTH_REQUIRED")
    payload = json.loads(body)
    def codes(value):
        if isinstance(value, dict):
            return [value.get("code")] + [item for nested in value.values() for item in codes(nested)]
        if isinstance(value, list):
            return [item for nested in value for item in codes(nested)]
        return []
    require(any(value in ("UNAUTHORIZED", "FORBIDDEN") for value in codes(payload)), "NEW_API_ROUTE_REGISTRATION_FAILED")
    return {"url": url, "status": code, "newRouteRegistered": True, "anonymousAccessDenied": True, "productionRecordWrites": 0}


def restore_backends(backends, before):
    """CAS only our exact API bytes; never restore over another task's version."""
    restored = []
    _, owned_ids = reload_intents(backends, before)
    compatible(before, processes(), owned_ids)
    # Validate every owned file and backup before the first recovery write.
    for item in backends:
        require(sha(item["path"]) in (item["sha256"], item["beforeSha256"]), "BACKEND_ROLLBACK_CAS_FAILED")
        require(sha(ROOT / ("before-" + item["processName"] + ".js")) == item["beforeSha256"], "BACKEND_BACKUP_CHANGED")
    for item in reversed(backends):
        compatible(before, processes(), owned_ids)
        require(sha(item["path"]) in (item["sha256"], item["beforeSha256"]), "BACKEND_ROLLBACK_CAS_FAILED")
        backup = ROOT / ("before-" + item["processName"] + ".js")
        require(sha(backup) == item["beforeSha256"], "BACKEND_BACKUP_CHANGED")
        if sha(item["path"]) == item["sha256"]:
            atomic(item["path"], backup.read_bytes())
        # An interrupted reload may have loaded either version. Reload each target
        # with a persisted intent; untouched ids still have their original code.
        for row in before:
            if row["name"] == item["processName"] and row["id"] in owned_ids:
                reload_instance(row, rollback=True)
        require(sha(item["path"]) == item["beforeSha256"], "BACKEND_RESTORE_NOT_CONFIRMED")
        restored.append(item["processName"])
    compatible(before, processes())
    return restored


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    require(not (args.apply and args.rollback), "ONE_ACTION_REQUIRED")
    manifest = json.loads((ROOT / "manifest.json").read_text())
    files, backends = manifest["files"], manifest["backendFiles"]
    target = PUBLIC / "index.html"
    require(manifest["ownerTask"] == TASK and 2 <= len(files) <= 14, "BOUNDED_OWNER_SCOPE_REQUIRED")
    require(len({x["relative"] for x in files}) == len(files), "DUPLICATE_PATH")
    require({x["relative"] for x in files} == {"index.html", *manifest["coreAssetPaths"]}, "EXACT_ASSET_ALLOWLIST_REQUIRED")
    for item in files:
        rel = Path(item["relative"])
        require(not rel.is_absolute() and ".." not in rel.parts, "UNSAFE_PATH")
        require(item["relative"] == "index.html" or (len(rel.parts) in (2, 3) and rel.parts[0] == "assets"
            and ("demand-personal" in rel.name or "personal-center" in rel.name) and rel.suffix in (".js", ".css")), "CUSTOMER_ASSET_NAMESPACE_REQUIRED")
        require((PUBLIC / rel).resolve().is_relative_to(PUBLIC.resolve()), "OUTSIDE_PUBLIC")
        require(sha(ROOT / "candidate" / rel) == item["sha256"], "CANDIDATE_CHANGED")
    require(len(backends) == 2 and {x["processName"] for x in backends} == set(APIS), "EXACT_API_ALLOWLIST_REQUIRED")
    for item in backends:
        relative = "api/front-index.js" if item["processName"] == "dianzi51" else "api/admin-index.js"
        require(item["path"] == APIS[item["processName"]] and item["relative"] == relative, "UNSAFE_API_TARGET")
        require(sha(ROOT / "candidate" / item["relative"]) == item["sha256"], "API_CANDIDATE_CHANGED")
    require(sha(ROOT / Path(__file__).name) == manifest["driverSha256"], "DRIVER_CHANGED")
    require({"candidate-proof.json", "backend-candidate-proof.json", "reload-demand-personal-api-20261114.cjs"}
        <= set(manifest["evidenceHashes"]), "CORE_EVIDENCE_HASHES_REQUIRED")
    for name, expected in manifest["evidenceHashes"].items():
        require(Path(name).name == name and sha(ROOT / name) == expected, "EVIDENCE_CHANGED")
    proof = json.loads((ROOT / "candidate-proof.json").read_text())
    backend_proof = json.loads((ROOT / "backend-candidate-proof.json").read_text())
    require(proof["status"] == "PASS" and all(proof.get(flag) is True for flag in PROOF_FLAGS), "FRONTEND_PROOF_REQUIRED")
    require(backend_proof["status"] == "PASS" and backend_proof.get("sourceBound") is True
        and backend_proof.get("unrelatedBytesUnchanged") is True, "BACKEND_SOURCE_PROOF_REQUIRED")
    require(manifest["tscPassed"] and manifest["sourceTestFailures"] == 0 and manifest["candidateTestsPassed"]
        and manifest["backendCandidateTestsPassed"] and manifest["reviewPassed"], "VALIDATION_REQUIRED")
    html = next(item for item in files if item["relative"] == "index.html")
    if not args.apply and not args.rollback:
        print(json.dumps({"planOnly": True, "frontendFiles": len(files), "backendFiles": 2,
            "databaseOperations": 0, "rollingReloadInstances": 6, "globalRestart": False}))
        return
    locks, installed_backends = [], []
    opened = switched = False
    before = None
    record = {"owner_task": TASK, "status": "preflight", "scope": "customer demand quote confirmation, quoted state, personal center security and own performance; no schema/data changes", "openedAtUtc": now()}
    try:
        for name in ("/var/lock/dianzi51-public-deploy.lock", "/var/lock/dianzi51-production-code.lock"):
            lock = open(name, "a+")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locks.append(lock)
        state = json.loads(COORD.read_text())
        own_recovery = args.rollback and state.get("shared_release_active") and state.get("window", {}).get("owner_task") == TASK \
            and state.get("window", {}).get("status") == "recovery-required"
        require(not state.get("shared_release_active") or own_recovery, "OTHER_RELEASE_ACTIVE")
        if args.rollback:
            if own_recovery:
                record = dict(state["window"])
                opened = True
            require(sha(target) in (html["sha256"], manifest["beforeHtmlSha256"])
                and sha(ROOT / "index-before.html") == manifest["beforeHtmlSha256"], "HTML_ROLLBACK_CAS_FAILED")
            before = json.loads((ROOT / "process-before.json").read_text())
            installed_backends = list(backends)
            if not opened:
                record["status"] = "rolling-back"
                state.update(shared_release_active=True, window=record, updated_at=now())
                save(COORD, state)
                opened = True
            if sha(target) == html["sha256"]:
                atomic(target, (ROOT / "index-before.html").read_bytes())
            restored = restore_backends(backends, before)
            require(sha(target) == manifest["beforeHtmlSha256"], "HTML_RESTORE_NOT_CONFIRMED")
            state = json.loads(COORD.read_text())
            require(state.get("window", {}).get("owner_task") == TASK, "WINDOW_OWNERSHIP_LOST")
            record.update(status="rolled-back", closedAtUtc=now(), manualRecoveryRequired=False)
            record.pop("recoveryError", None)
            state.update(shared_release_active=False, window=record, updated_at=now())
            state.setdefault("window_history", []).append(dict(record))
            save(COORD, state)
            save(ROOT / "rolled-back.json", {"status": "rolled-back", "atUtc": now(), "restoredHtmlSha256": sha(target), "exactBackendRollback": restored})
            print("Exact owned HTML/API rollback complete")
            return
        require(not (ROOT / "verified.json").exists() and not (ROOT / "activation-started.json").exists(), "PREVIOUS_ATTEMPT_INSPECT_REQUIRED")
        require(sha(target) == manifest["beforeHtmlSha256"], "BASELINE_CAS_FAILED")
        before = processes()
        for name, count in (("dianzi51", 4), ("dianzi51-admin", 2)):
            group = [row for row in before if row["name"] == name]
            require(len(group) == count and all(row["status"] == "online" and row["pid"] > 0 and row["execMode"] == "cluster_mode"
                and row["script"] == APIS[name] for row in group), "API_BASELINE_NOT_ONLINE")
        for item in manifest["protectedFiles"]:
            require(sha(item["path"]) == item["sha256"], "PROTECTED_BASELINE_CHANGED")
        for item in backends:
            require(sha(item["path"]) == item["beforeSha256"], "API_BASELINE_CHANGED")
        for item in manifest["baselineAssets"]:
            require(sha(PUBLIC / item["relative"]) == item["sha256"], "OLD_ASSET_CHANGED")
        for dependency in manifest["dependencies"]:
            require(dependency.startswith("/assets/"), "DEPENDENCY_PREFIX_FAILED")
            require((PUBLIC / dependency.lstrip("/")).is_file() or dependency.lstrip("/") in manifest["coreAssetPaths"], "DEPENDENCY_MISSING")
        for item in files:
            if item["relative"] != "index.html" and (PUBLIC / item["relative"]).exists():
                require(sha(PUBLIC / item["relative"]) == item["sha256"], "ASSET_OVERWRITE_REFUSED")
        save(ROOT / "process-before.json", before)
        save(ROOT / "reload-intents.json", [])
        atomic(ROOT / "index-before.html", target.read_bytes(), 0o600)
        for item in backends:
            atomic(ROOT / ("before-" + item["processName"] + ".js"), Path(item["path"]).read_bytes(), 0o600)
        front_before = get("https://www.51dianzi.com/")[0]
        require(get("https://admin.51dianzi.com/workbench/customers")[0]["sha256"] == manifest["beforeHtmlSha256"], "PUBLIC_BASELINE_MISMATCH")
        state = json.loads(COORD.read_text())
        require(not state.get("shared_release_active") and sha(target) == manifest["beforeHtmlSha256"], "WINDOW_CHANGED")
        record["status"] = "activating"
        state.update(shared_release_active=True, window=record, updated_at=now())
        save(COORD, state)
        opened = True
        save(ROOT / "activation-started.json", {"atUtc": now(), "ownerTask": TASK})
        print("Installing isolated assets while original HTML remains active", flush=True)
        for item in files:
            if item["relative"] != "index.html" and not (PUBLIC / item["relative"]).exists():
                atomic(PUBLIC / item["relative"], (ROOT / "candidate" / item["relative"]).read_bytes())
        def verify(item):
            check, body = get("https://admin.51dianzi.com/" + item["relative"])
            require(check["sha256"] == item["sha256"] and not body.lstrip().lower().startswith(b"<!doctype html"), "PUBLIC_ASSET_FAILED")
            return check
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            checks = list(pool.map(verify, [x for x in files if x["relative"] != "index.html"]))
        api_health = []
        for name in ("dianzi51", "dianzi51-admin"):
            item = next(value for value in backends if value["processName"] == name)
            require(sha(item["path"]) == item["beforeSha256"], "FINAL_API_CAS_FAILED")
            atomic(item["path"], (ROOT / "candidate" / item["relative"]).read_bytes())
            installed_backends.append(item)
            for row in before:
                if row["name"] == name:
                    intents, _ = reload_intents(installed_backends, before)
                    intents.append({"ownerTask": TASK, "id": row["id"], "name": name, "apiHash": item["sha256"], "atUtc": now()})
                    save(ROOT / "reload-intents.json", intents)
                    reload_instance(row)
                    compatible(before, processes())
            api_health.append(protected_api_health(name))
            require(get("https://www.51dianzi.com/")[0]["sha256"] == front_before["sha256"], "FRONT_PAGE_CHANGED")
        require(sha(target) == manifest["beforeHtmlSha256"], "FINAL_HTML_CAS_FAILED")
        atomic(target, (ROOT / "candidate/index.html").read_bytes())
        switched = True
        health = []
        for url in ("https://admin.51dianzi.com/", "https://admin.51dianzi.com/login", "https://admin.51dianzi.com/profile", "https://admin.51dianzi.com/workbench/customers",
            "https://admin.51dianzi.com/workbench/procurement-demands",
            "https://admin.51dianzi.com/workbench/channel-inventory", "https://admin.51dianzi.com/workbench/orders?orderSource=business",
            "https://admin.51dianzi.com/workbench/orders?orderSource=mall", "https://admin.51dianzi.com/workbench/inquiries"):
            check, _ = get(url)
            require(check["sha256"] == html["sha256"], "PUBLIC_HTML_FAILED")
            health.append(check)
        require(get("https://www.51dianzi.com/")[0]["sha256"] == front_before["sha256"], "FRONT_CHANGED")
        compatible(before, processes())
        for item in manifest["protectedFiles"]:
            require(sha(item["path"]) == item["sha256"], "PROTECTED_FILE_CHANGED")
        for item in backends:
            require(sha(item["path"]) == item["sha256"], "API_CANDIDATE_DRIFT")
        for item in manifest["baselineAssets"]:
            require(sha(PUBLIC / item["relative"]) == item["sha256"], "OLD_ASSET_CHANGED")
        state = json.loads(COORD.read_text())
        require(state.get("window", {}).get("owner_task") == TASK, "WINDOW_OWNERSHIP_LOST")
        record.update(status="verified", closedAtUtc=now(), receipt=str(ROOT / "verified.json"))
        state.update(shared_release_active=False, window=record, updated_at=now())
        state.setdefault("window_history", []).append(record)
        save(COORD, state)
        receipt = {"status": "verified", "atUtc": now(), "htmlSha256": html["sha256"], "files": files, "backendFiles": backends,
            "publicAssets": checks, "health": health, **{flag: True for flag in PROOF_FLAGS}, "allProtectedFilesUnchanged": True,
            "independentWorkersUnchanged": True, "apiPathsAndEnvironmentsUnchanged": True, "oldAssetsUnchanged": True,
            "backendChanges": 2, "databaseOperations": 0, "permissionAssignmentsChanged": 0, "rollingReloadInstances": 6,
            "globalRestart": False, "startupDumpChanged": False, "productionRecordWrites": 0, "loggedInBrowserAcceptancePerformed": False}
        receipt["newProtectedApiHealth"] = api_health
        save(ROOT / "verified.json", receipt)
        print(json.dumps({"status": "verified", "receipt": str(ROOT / "verified.json"), "files": len(files), "backendFiles": 2}))
    except BaseException as error:
        restored_html, restored_apis, recovery_errors = False, [], []
        html_confirmed = not opened
        if opened:
            try:
                current_html = sha(target)
                if current_html == html["sha256"]:
                    require(sha(ROOT / "index-before.html") == manifest["beforeHtmlSha256"], "HTML_BACKUP_CHANGED")
                    atomic(target, (ROOT / "index-before.html").read_bytes())
                    restored_html = True
                require(sha(target) == manifest["beforeHtmlSha256"], "HTML_ROLLBACK_CAS_FAILED")
                html_confirmed = True
            except BaseException:
                recovery_errors.append("EXACT_HTML_RECOVERY_NOT_CONFIRMED")
        if opened and before:
            try:
                # Backups precede window opening. Confirm both bounded API bytes,
                # even if an atomic install completed just before bookkeeping failed.
                restored_apis = restore_backends(backends, before)
            except BaseException:
                recovery_errors.append("EXACT_API_RECOVERY_NOT_CONFIRMED")
        elif opened:
            recovery_errors.append("ORIGINAL_PROCESS_RECOVERY_NOT_CONFIRMED")
        recovery_required = opened and (not html_confirmed or bool(recovery_errors))
        if opened:
            state = json.loads(COORD.read_text())
            owns_window = state.get("window", {}).get("owner_task") == TASK
            if not owns_window:
                recovery_errors.append("WINDOW_OWNERSHIP_LOST")
                recovery_required = True
            record.update(status="recovery-required" if recovery_required else "failed",
                manualRecoveryRequired=recovery_required)
            if recovery_required:
                record.pop("closedAtUtc", None)
                record["recoveryError"] = "; ".join(recovery_errors) + "; manual exact recovery required; do not replay apply"
            else:
                record["closedAtUtc"] = now()
            if owns_window:
                state.update(shared_release_active=recovery_required, window=record, updated_at=now())
                state.setdefault("window_history", []).append(dict(record))
            else:
                # Never replace a foreign coordination window, but do not advertise
                # availability while our own recovery/ownership is unconfirmed.
                state.update(shared_release_active=True, updated_at=now())
                state.setdefault("recovery_required_windows", []).append(dict(record))
            save(COORD, state)
        failure = {"status": "recovery-required" if recovery_required else "failed", "reason": str(error),
            "exactHtmlRollback": restored_html, "htmlRecoveryConfirmed": html_confirmed,
            "exactBackendRollback": restored_apis, "manualRecoveryRequired": recovery_required,
            "recoveryError": "; ".join(recovery_errors) + "; manual exact recovery required; do not replay apply" if recovery_errors else None, "atUtc": now()}
        failure_path = ROOT / "failed.json"
        # A blocked replay must not erase the receipt requiring manual recovery.
        if opened or not failure_path.exists() or json.loads(failure_path.read_text()).get("status") != "recovery-required":
            save(failure_path, failure)
        print(json.dumps(failure))
        raise SystemExit(1)
    finally:
        for lock in reversed(locks):
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()


if __name__ == "__main__":
    main()
