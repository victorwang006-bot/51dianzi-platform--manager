#!/usr/bin/env python3
"""Bounded navigation/channel reference release; additive assets and exact owned CAS recovery."""
import argparse
import concurrent.futures
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import uuid
from decimal import Decimal
import urllib.error
import urllib.request
import urllib.parse

TASK = "CKSZQ7sVc7tADM21c3LWpu"
RUNTIME_ROOT = Path("/opt/ops/20261114-channel-reference-pricing-CKSZQ7s")
ROOT = RUNTIME_ROOT  # Package-read root; only isolated pure validators rebind it.
PUBLIC = Path("/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public")
COORD = Path("/opt/ops/51-project-release-coordination-20261027.json")
APIS = {
    "dianzi51-admin": "/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js",
}
OWNED_IDS = {191, 192}
FRONT_API = "/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js"
FIXED_FRONT_API_SHA256 = "db920e472f854dd41ae6f610f2c0d1c37df28c5260afee4ab3f924b24c83c2c9"
PROOF_FLAGS = ("sourceBound", "unrelatedNativeBytesUnchanged", "navigationAssetByteUnchanged", "noNavigationCompilation", "noCssOutput", "scopeAndArchiveNativeBytesUnchanged", "globalOrdersNativeBytesUnchanged", "maximumQuantityCompactQuotesActualBound", "noquoteOnlyActualBound", "currentPage20IdsActualBound", "latePageAndReadRevocationActualBound", "nativeReadinessActualBound")
LOCK_PATHS = ("/var/lock/dianzi51-public-deploy.lock", "/var/lock/dianzi51-production-code.lock")
PROTECTED_PATHS = {FRONT_API, "/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html", "/etc/nginx/conf.d/dianzi51-admin-subdomain.conf", "/root/.pm2/dump.pm2"}
HELPERS = {"channel-reference-service.mjs", "channel-reference-snapshot.json"}
COORD_PIN = None
HEX = re.compile(r"[0-9a-f]{64}")
MANIFEST_PIN = None


def safe_relative(relative):
    require(isinstance(relative, str) and 0 < len(relative) <= 240
        and re.fullmatch(r"[A-Za-z0-9._/-]+", relative), "UNSAFE_PATH")
    require(all(part not in ("", ".", "..") for part in relative.split("/"))
        and not Path(relative).is_absolute(), "UNSAFE_PATH")
    return Path(relative)


def inside(base, relative, regular=False):
    relative = safe_relative(relative)
    base = Path(base)
    path = base / relative
    require(path.resolve().is_relative_to(base.resolve()), "PATH_ESCAPE")
    current = path
    while current != base:
        require(not current.is_symlink(), "SYMLINK_REFUSED")
        current = current.parent
    if regular:
        require(stat.S_ISREG(path.lstat().st_mode), "REGULAR_FILE_REQUIRED")
    return path


def hash_items(items, key="relative"):
    require(isinstance(items, list) and all(isinstance(item, dict) for item in items), "HASH_LIST_REQUIRED")
    require(len({item[key] for item in items}) == len(items), "DUPLICATE_PATH")
    for item in items:
        require(isinstance(item.get("sha256"), str) and HEX.fullmatch(item["sha256"]), "SHA256_REQUIRED")


def verify_helpers(manifest):
    helpers = manifest["standaloneHelpers"]
    hash_items(helpers)
    require(manifest["runtimeHelpers"] == helpers and len(helpers) == 2
        and {item["relative"] for item in helpers} == HELPERS, "EXACT_SNAPSHOT_HELPERS_REQUIRED")
    require("browserPackage" not in manifest, "LEGACY_BROWSER_CONTRACT_REFUSED")
    require(not ROOT.is_symlink(), "NAMESPACE_SYMLINK_REFUSED")
    for item in helpers:
        require(set(item) == {"relative", "sha256"}, "EXACT_HELPER_FIELDS_REQUIRED")
        require(sha(inside(ROOT, item["relative"], regular=True)) == item["sha256"], "HELPER_SHA_CHANGED")
    return helpers


def source_contract(manifest, proofs):
    pins = manifest["sourceHashes"]
    previous_receipt = json.loads((ROOT / "previous-source-receipt.json").read_text())
    require(previous_receipt.get("gitCommit") == "aeaf9f87f2fc96e210a635eee17c491f43df757a", "PREVIOUS_C3_SOURCE_RECEIPT_REQUIRED")
    prior = previous_receipt["sourceHashes"]
    require(manifest["priorSourceHashes"] == prior and bool(prior), "PRIOR_SOURCE_UNION_REQUIRED")
    graph = manifest["newSourceGraphPaths"]
    require(isinstance(graph, list) and len(graph) == len(set(graph)) and graph, "NEW_SOURCE_GRAPH_REQUIRED")
    require(set(pins) == set(prior) | set(graph) and manifest["sourceHashSnapshot"] == pins, "CURRENT_SOURCE_SNAPSHOT_UNION_REQUIRED")
    bound = set()
    for proof in proofs:
        require(proof.get("sourceBound") is True and proof.get("sourceBindingsVerified") is True
            and isinstance(proof.get("sourceHashes"), dict) and proof["sourceHashes"], "REAL_SOURCE_BINDINGS_REQUIRED")
        for relative, expected in proof["sourceHashes"].items():
            require(pins.get(relative) == expected, "PROOF_SOURCE_PIN_MISMATCH")
        bound.update(proof["sourceHashes"])
    for metafile in ("service-metafile.json",):
        inputs = json.loads((ROOT / metafile).read_text())["inputs"]
        require(inputs and all(name.split("/")[0] in ("client", "server", "shared") for name in inputs), "BOUNDED_HELPER_SOURCE_GRAPH_REQUIRED")
        bound.update(inputs)
    require(set(graph) == bound, "COMPLETE_NEW_GRAPH_REQUIRED")
    for relative, expected in pins.items():
        path = safe_relative(relative)
        require((path.parts[0] in ("client", "server", "shared")
            or (relative in ("package.json", "pnpm-lock.yaml", "tsconfig.json")
                and relative in prior and relative not in graph))
            and HEX.fullmatch(expected), "UNSAFE_SOURCE_PIN")
        require(sha(inside(ROOT / "source-snapshot", relative, regular=True)) == expected, "SOURCE_SNAPSHOT_CHANGED")
        if relative not in graph:
            require(expected == prior[relative], "UNRELATED_PRIOR_SOURCE_CHANGED")


def owns_window(state, record=None):
    window = state.get("window", {})
    return state.get("shared_release_active") is True and window.get("owner_task") == TASK \
        and window.get("task") == TASK and (record is None or (window.get("openedAtUtc") == record.get("openedAtUtc") and window.get("attemptId") == record.get("attemptId")))


def save_coord(state):
    global COORD_PIN
    require(COORD_PIN is not None and sha(COORD) == COORD_PIN, "FULL_COORDINATION_CAS_FAILED")
    save(COORD, state)
    COORD_PIN = sha(COORD)


def assert_owner(record):
    require(COORD_PIN is not None and sha(COORD) == COORD_PIN, "FULL_COORDINATION_CAS_FAILED")
    state = json.loads(COORD.read_text())
    require(owns_window(state, record), "WINDOW_OWNERSHIP_LOST")
    require(MANIFEST_PIN is None or sha(ROOT / "manifest.json") == MANIFEST_PIN, "MANIFEST_RUNTIME_CAS_FAILED")
    verify_package(json.loads((ROOT / "manifest.json").read_text()))
    return state


def verify_frozen(manifest):
    for item in manifest["protectedFiles"]:
        require(sha(item["path"]) == item["sha256"], "PROTECTED_FILE_CHANGED")
    for item in manifest["baselineAssets"]:
        require(sha(inside(PUBLIC, item["relative"], regular=True)) == item["sha256"], "OLD_ASSET_CHANGED")


def strict_baseline(manifest, rows):
    require(rows == manifest["baselineProcesses"], "FRESH_PROCESS_CAS_FAILED")
    require(len(rows) == 12 and all(row["status"] == "online" and row["pid"] > 0 for row in rows), "FRESH_ALL_ONLINE_REQUIRED")
    group = [row for row in rows if row["name"] in APIS]
    require({row["id"] for row in group} == OWNED_IDS and len(group) == 2
        and all(row["script"] == APIS[row["name"]] and row["execMode"] == "cluster_mode" for row in group), "EXACT_ADMIN_BASELINE_REQUIRED")


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
    fd, tmp = tempfile.mkstemp(prefix=".channel-reference-pricing-", dir=path.parent)
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
    try:
        result = subprocess.run(["node", str(ROOT / "reload-channel-reference-api.cjs"), "--snapshot"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("EXISTING_PM2_SNAPSHOT_FAILED") from None
    require(result.returncode == 0, "EXISTING_PM2_SNAPSHOT_FAILED")
    return sorted(json.loads(result.stdout), key=lambda row: row["id"])


def compatible(before, after, recovery_ids=()):
    """Config/identity always frozen; only exact owned recovery ids may lack liveness."""
    require(set(recovery_ids) <= OWNED_IDS, "FOREIGN_RECOVERY_ID")
    allowed_pid_ids = set()
    if (ROOT / "reload-intents.json").exists():
        backends = json.loads((ROOT / "manifest.json").read_text())["backendFiles"]
        _, allowed_pid_ids = reload_intents(backends, before)
    require(set(recovery_ids) <= allowed_pid_ids, "PERSISTED_RECOVERY_INTENT_REQUIRED")
    before, after = sorted(before, key=lambda row: row["id"]), sorted(after, key=lambda row: row["id"])
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
            require(old["id"] in allowed_pid_ids or old["pid"] == current["pid"], "UNOWNED_ADMIN_PID_CHANGED")
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
        started = json.loads((ROOT / "activation-started.json").read_text())
        require(intent.get("attemptId") == started.get("attemptId") and intent.get("attemptId"), "RELOAD_INTENT_ATTEMPT_CHANGED")
        row = next((row for row in before if row["id"] == intent.get("id")), None)
        item = next((item for item in backends if item["processName"] == intent.get("name")), None)
        require(row is not None and item is not None and row["name"] == intent.get("name")
            and row["script"] == item["path"] == APIS.get(row["name"])
            and intent.get("apiHash") == item["sha256"] and row["id"] in OWNED_IDS and row["id"] not in ids, "RELOAD_INTENT_TARGET_CHANGED")
        ids.add(row["id"])
    return intents, ids


def reload_instance(row, rollback=False):
    require(row["id"] in OWNED_IDS and row["name"] in APIS and row["script"] == APIS[row["name"]], "EXACT_RELOAD_ID_REQUIRED")
    validate_manifest(json.loads((ROOT / "manifest.json").read_text()))
    command = ["node", str(ROOT / "reload-channel-reference-api.cjs")]
    if rollback:
        command.append("--rollback")
    command.extend(["--id", str(row["id"])])
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("TARGETED_RELOAD_FAILED_OUTPUT_SUPPRESSED") from None
    require(result.returncode == 0, "TARGETED_RELOAD_FAILED_OUTPUT_SUPPRESSED")
    print("Verified rolling API reload: " + row["name"] + " instance " + str(row["id"]), flush=True)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
        require(response.status == 200, "HTTP_FAILED")
        return {"url": url, "status": response.status, "sha256": hashlib.sha256(body).hexdigest(), "contentType": response.headers.get("Content-Type", "")}, body


def protected_api_health(process_name, procedure="channelReference.lookup"):
    require(process_name == "dianzi51-admin" and procedure in ("channelReference.lookup", "personalCenter.profile", "adminUser.list"), "READONLY_HEALTH_ROUTE_REQUIRED")
    headers = {"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache", "Accept": "application/json", "Accept-Encoding": "identity"}
    if procedure == "channelReference.lookup":
        # Fixed numeric scope is schema-valid but not authenticated; authorization
        # throws before the fence/DB/upstream/public helper can run.
        payload = {"json": {"listInput": {"page": 1, "pageSize": 20}, "materialIds": [1]}}
        url = "https://admin.51dianzi.com/api/business-trpc/channelReference.lookup?" + urllib.parse.urlencode({"input": json.dumps(payload, separators=(",", ":"))})
        headers["x-business-merchant-id"] = "1"
    else:
        url = "https://admin.51dianzi.com/api/trpc/" + procedure
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            code, body, content_type = response.status, response.read(65537), response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        code, body, content_type = error.code, error.read(65537), error.headers.get("Content-Type", "")
    require(code in (401, 403), "NEW_API_ANONYMOUS_AUTH_REQUIRED")
    require(len(body) <= 65536 and content_type.split(";", 1)[0].strip().lower() == "application/json", "STRICT_JSON_AUTH_REQUIRED")
    payload = json.loads(body)
    require(isinstance(payload, dict) and set(payload) == {"error"} and isinstance(payload["error"], dict)
        and set(payload["error"]) == {"json"}, "STRICT_TRPC_ERROR_REQUIRED")
    error = payload["error"]["json"]
    require(isinstance(error, dict) and isinstance(error.get("data"), dict), "STRICT_TRPC_ERROR_REQUIRED")
    expected = ("UNAUTHORIZED", -32001) if code == 401 else ("FORBIDDEN", -32003)
    require(error["data"].get("code") == expected[0] and error.get("code") == expected[1]
        and error["data"].get("httpStatus") == code and error["data"].get("path") == procedure, "NEW_API_ROUTE_REGISTRATION_FAILED")
    return {"url": url, "status": code, "newRouteRegistered": True, "anonymousAccessDenied": True, "productionRecordWrites": 0}


def restore_backends(backends, before, record):
    """CAS only our exact API bytes; never restore over another task's version."""
    assert_owner(record)
    restored = []
    _, owned_ids = reload_intents(backends, before)
    compatible(before, processes(), owned_ids)
    # Validate every owned file and backup before the first recovery write.
    for item in backends:
        require(sha(item["path"]) in (item["sha256"], item["beforeSha256"]), "BACKEND_ROLLBACK_CAS_FAILED")
        require(sha(ROOT / ("before-" + item["processName"] + ".js")) == item["beforeSha256"], "BACKEND_BACKUP_CHANGED")
    for item in reversed(backends):
        assert_owner(record)
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
                assert_owner(record)
                reload_instance(row, rollback=True)
        require(sha(item["path"]) == item["beforeSha256"], "BACKEND_RESTORE_NOT_CONFIRMED")
        restored.append(item["processName"])
    compatible(before, processes())
    return restored


def json_file(relative):
    return json.loads(inside(ROOT, relative, regular=True).read_text(encoding="utf-8"))


def live_evidence(value):
    require(value.get("fixtureOnly") is False, "SIMULATED_EVIDENCE_NOT_LIVE")


def verify_package(manifest):
    """Complete finite deployment package; prior stage browser may exist but is not a dependency."""
    pins = manifest["packageHashes"]
    require(isinstance(pins, dict) and pins and "manifest.json" not in pins, "PACKAGE_HASHES_REQUIRED")
    expected = {Path(__file__).name, "driver-test-offline.py"} | set(manifest["evidenceHashes"])
    expected |= {"candidate/" + item["relative"] for item in manifest["files"] + manifest["backendFiles"]}
    expected |= {item["relative"] for item in manifest["standaloneHelpers"]}
    expected |= {"source-snapshot/" + name for name in manifest["sourceHashes"]}
    expected |= {"baseline/index.html", "baseline/admin-index.js"}
    expected |= {"baseline/" + item["relative"] for item in manifest["baselineAssets"]}
    receipt = json_file("collection-receipt.json")
    require(isinstance(receipt.get("observations"), list), "COLLECTION_OBSERVATIONS_REQUIRED")
    expected |= {row["file"] for row in receipt["observations"]}
    require(set(pins) == expected, "EXACT_COMPLETE_PACKAGE_REQUIRED")
    for relative, expected_hash in pins.items():
        require(isinstance(expected_hash, str) and HEX.fullmatch(expected_hash), "PACKAGE_SHA256_REQUIRED")
        require(not relative.startswith("browser/") and relative not in ("channel-reference-worker.mjs", "worker-metafile.json"), "WORKER_DEPLOYMENT_REFUSED")
        require(sha(inside(ROOT, relative, regular=True)) == expected_hash, "PACKAGE_CHANGED")
    require(pins[Path(__file__).name] == manifest["driverSha256"], "PACKAGE_DRIVER_BINDING_REQUIRED")
    for name, expected_hash in manifest["evidenceHashes"].items():
        require(pins[name] == expected_hash, "PACKAGE_EVIDENCE_BINDING_REQUIRED")
    for item in manifest["standaloneHelpers"]:
        require(pins[item["relative"]] == item["sha256"], "PACKAGE_HELPER_BINDING_REQUIRED")
    for relative, expected_hash in manifest["sourceHashes"].items():
        require(pins["source-snapshot/" + relative] == expected_hash, "PACKAGE_SOURCE_BINDING_REQUIRED")
    require(pins["baseline/index.html"] == manifest["beforeHtmlSha256"]
        and pins["baseline/admin-index.js"] == manifest["backendFiles"][0]["beforeSha256"], "PACKAGE_BASELINE_BINDING_REQUIRED")
    for item in manifest["baselineAssets"]:
        require(pins["baseline/" + item["relative"]] == item["sha256"], "ALL_CAPTURED_ASSETS_REQUIRED")


def raw_sha(data):
    return hashlib.sha256(data).hexdigest()


def inverse_bytes(before, after, patches, partitions=None, js_offsets=False, insert_only=False):
    """Recalculate actual ranges and reconstruct inverse; flags alone never prove bytes."""
    require(isinstance(patches, list) and patches and len(patches) <= 64, "REAL_PATCHES_REQUIRED")
    if js_offsets:
        old = before.decode("utf-8").encode("utf-16-le", errors="surrogatepass")
        new = after.decode("utf-8").encode("utf-16-le", errors="surrogatepass")
        def piece(data, start, end):
            return data[start * 2:end * 2].decode("utf-16-le", errors="surrogatepass").encode("utf-8")
        oldlen, newlen = len(old) // 2, len(new) // 2
    else:
        old, new = before, after
        piece = lambda data, start, end: data[start:end]
        oldlen, newlen = len(old), len(new)
    op = np = 0
    inverse = []
    calculated = []
    for p in patches:
        if js_offsets:
            start, end, ns, ne = (p[k] for k in ("start", "end", "afterStart", "afterEnd"))
            oh, nh = p["beforeSha256"], p["afterSha256"]
        else:
            start, end, ns, ne = (p[k] for k in ("oldByteStart", "oldByteEnd", "newByteStart", "newByteEnd"))
            oh, nh = p["oldSha256"], p["newSha256"]
        require(all(type(n) is int for n in (start, end, ns, ne)) and op <= start <= end <= oldlen
            and np <= ns <= ne <= newlen, "NATIVE_RANGE_INVALID")
        require(not insert_only or start == end, "BACKEND_INSERT_ONLY_REQUIRED")
        a, b = piece(old, op, start), piece(new, np, ns)
        require(a == b, "NATIVE_NONPATCH_BYTES_CHANGED")
        require(raw_sha(piece(old, start, end)) == oh and raw_sha(piece(new, ns, ne)) == nh, "NATIVE_PATCH_HASH_CHANGED")
        calculated.append({"beforeStart": op, "beforeEnd": start, "afterStart": np, "afterEnd": ns, "sha256": raw_sha(a)})
        inverse.extend((b, piece(old, start, end)))
        op, np = end, ne
    a, b = piece(old, op, oldlen), piece(new, np, newlen)
    require(a == b, "NATIVE_TAIL_BYTES_CHANGED")
    inverse.append(b)
    calculated.append({"beforeStart": op, "beforeEnd": oldlen, "afterStart": np, "afterEnd": newlen, "sha256": raw_sha(a)})
    require(b"".join(inverse) == before, "NATIVE_REAL_INVERSE_FAILED")
    if partitions is not None:
        require(partitions == calculated, "REAL_UNCHANGED_PARTITIONS_REQUIRED")


def importmap(html):
    matches = list(re.finditer(r'<script\b[^>]*\btype=[\"\']importmap[\"\'][^>]*>([\s\S]*?)</script>', html))
    require(len(matches) == 1, "EXACT_ACTUAL_HTML_IMPORTMAP_REQUIRED")
    m = matches[0]
    value = json.loads(m.group(1))
    require(isinstance(value, dict) and set(value) <= {"imports", "scopes"}
        and isinstance(value.get("imports"), dict) and isinstance(value.get("scopes", {}), dict), "HTML_MAP_SCHEMA_REQUIRED")
    return value, html[:m.start(1)], html[m.end(1):]


def verify_native_bytes(manifest, proof, backend):
    old_hashes = {item["sha256"]: item["relative"] for item in manifest["baselineAssets"]}
    new_files = {item["sha256"]: item["relative"] for item in manifest["files"] if item["relative"].endswith(".js")}
    require(len(new_files) == 2 and len(proof["nativeProofEvidence"]) == 2, "EXACT_TWO_WORKBENCH_PROOFS_REQUIRED")
    relocations = {}
    for name in proof["nativeProofEvidence"]:
        p = json_file(name)
        before_relative, after_relative = old_hashes[p["beforeSha256"]], new_files[p["sha256"]]
        require(p.get("beforeUrl") == "/" + before_relative and p.get("url") == "/" + after_relative, "ACTUAL_WORKBENCH_URL_REQUIRED")
        require(Path(before_relative).name.startswith("BusinessWorkbenchPage-"), "ONLY_NATIVE_WORKBENCH_PATCH_REQUIRED")
        inverse_bytes(inside(ROOT / "baseline", before_relative, regular=True).read_bytes(),
            inside(ROOT / "candidate", after_relative, regular=True).read_bytes(), p["patches"], p["unchangedPartitions"], js_offsets=True)
        relocations["/" + before_relative] = "/" + after_relative
    require(len(relocations) == 2, "DISTINCT_WORKBENCHES_REQUIRED")
    old_map, prefix, suffix = importmap(json_file_text("baseline/index.html"))
    new_map, nprefix, nsuffix = importmap(json_file_text("candidate/index.html"))
    require(prefix == nprefix and suffix == nsuffix, "HTML_NONMAP_BYTES_CHANGED")
    html = json_file("html-build-proof.json")
    require(html.get("status") == "PASS" and html.get("relocations") == relocations
        and html.get("beforeSha256") == manifest["beforeHtmlSha256"]
        and html.get("sha256") == next(x["sha256"] for x in manifest["files"] if x["relative"] == "index.html")
        and all(html.get(k) is True for k in ("exactInverse", "htmlOnlyImportmap", "noCssAdded", "allOldTagsByteIdentical", "oldNativeEntryByteAndUrlUnchanged", "allOldStylesheetTagsByteRetained")), "REAL_HTML_PROOF_REQUIRED")
    expected_map = json.loads(json.dumps(old_map))
    require(set(new_map) == set(old_map), "HTML_MAP_KEYS_CHANGED")
    for table in [expected_map["imports"], *expected_map.get("scopes", {}).values()]:
        for key, value in table.items():
            table[key] = relocations.get(value, value)
    scopes = expected_map.get("scopes", {})
    for old_url, new_url in relocations.items():
        if old_url not in expected_map["imports"]:
            expected_map["imports"][old_url] = new_url
        inherited = sorted((key for key in scopes if old_url.startswith(key) and not new_url.startswith(key)), key=len)
        if inherited:
            require(new_url not in scopes, "HTML_SCOPE_COLLISION")
            scopes[new_url] = {}
            for key in inherited:
                scopes[new_url].update(scopes[key])
    require(new_map == expected_map, "EXACT_ACTUAL_HTML_MAP_REQUIRED")
    values = set(new_map["imports"].values())
    require(set(relocations.values()) <= values, "BOTH_WORKBENCHES_ACTUALLY_REFERENCED_REQUIRED")
    before = inside(ROOT / "baseline", "admin-index.js", regular=True).read_bytes()
    after = inside(ROOT / "candidate", "api/admin-index.js", regular=True).read_bytes()
    inverse_bytes(before, after, backend["nativePatches"], insert_only=True)
    require(len(backend["nativePatches"]) == 8 and backend["inverse"].get("sha256") == raw_sha(before)
        and backend["inverse"].get("allOutsideSlotsByteIdentical") is True, "EXACT_BACKEND_INSERTIONS_REQUIRED")
    require(backend.get("productionEntryExecuted") is False and backend.get("entireApiBundled") is False
        and backend.get("frontUnchanged") is True and backend.get("appRouterProfileStaffBytesUnchanged") is True, "NO_BROAD_BACKEND_BUILD_REQUIRED")
    # Native proof lists must contain actual hashes/names/ranges, not a fake count.
    declarations = backend["protectedDeclarations"]
    rows = declarations.get("declarations", declarations.get("items", []))
    require(len(rows) == 1092 and len({r.get("name") for r in rows}) == 1092, "ALL_1092_DECLARATION_PROOFS_REQUIRED")
    for row in rows:
        require(type(row.get("bytes")) is int and row["bytes"] > 0 and HEX.fullmatch(row.get("sha256", "")), "NATIVE_DECLARATION_STRUCTURE_REQUIRED")
    imports = backend["importDelta"].get("oldImports")
    require(isinstance(imports, list) and len(imports) == 130 and all(isinstance(r.get("text"), str) and r["text"] for r in imports), "ALL_130_IMPORT_PROOFS_REQUIRED")
    for row in imports:
        value = row["text"].encode()
        require(value in before and value in after, "OLD_IMPORT_BYTES_CHANGED")
    properties = backend["rootProtection"].get("protectedProperties", [])
    require(isinstance(properties, list) and len(properties) == 24
        and len({r.get("name") for r in properties}) == 24, "ALL_24_ROOT_PROOFS_REQUIRED")
    for row in properties:
        require(type(row.get("bytes")) is int and row["bytes"] > 0 and HEX.fullmatch(row.get("sha256", "")), "OLD_ROOT_STRUCTURE_REQUIRED")


def copy_json(value):
    return json.loads(json.dumps(value))


def json_file_text(relative):
    return inside(ROOT, relative, regular=True).read_bytes().decode("utf-8")


def timestamp(value, latest=None):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value), "REAL_COLLECTION_TIMESTAMP_REQUIRED")
    parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") == value
        and datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) <= parsed
        <= (latest or datetime.datetime.now(datetime.timezone.utc)), "COLLECTION_TIME_INVALID")
    return parsed


def clean_text(value, limit):
    return isinstance(value, str) and len(value.encode("utf-16-le")) // 2 <= limit and not re.search(r"[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]", value)


def observation_text(value, limit):
    """Private captured prose only; preserve original bytes and identity rules."""
    if not isinstance(value, str) or len(value.encode("utf-16-le")) // 2 > limit:
        return False
    # LCSC's original DOM text includes U+200B after packaging codes before the
    # Packaging heading. Only this exact layout position is exempted for prose.
    checked = re.sub(r"(?<=[A-Za-z0-9])\u200b(?=\n包装方式)", "", value)
    checked = checked.replace("\n", "").replace("\r", "").replace("\t", "")
    return clean_text(checked, limit)


def exact_fields(value, expected, message):
    require(isinstance(value, dict) and set(value) == set(expected), message)


def source_url(source, value, detail=False):
    require(clean_text(value, 2048) and value.isascii() and not re.search(r"[\s\\]", value), "SOURCE_URL_INVALID")
    parsed = urllib.parse.urlsplit(value)
    host = "item.szlcsc.com" if source == "lcsc" else "www.ickey.cn"
    allowed = {"item.szlcsc.com", "www.szlcsc.com", "so.szlcsc.com"} if source == "lcsc" else {"www.ickey.cn", "search.ickey.cn"}
    require(parsed.scheme == "https" and parsed.netloc in allowed and not parsed.fragment, "SOURCE_IDENTITY_REQUIRED")
    if detail:
        require(parsed.netloc == host and not parsed.query, "SOURCE_DETAIL_URL_REQUIRED")
        if source == "lcsc":
            require(parsed.path == "/mro/6710007.html" or re.fullmatch(r"/[1-9]\d*\.html", parsed.path), "SOURCE_DETAIL_URL_REQUIRED")
        else:
            require(re.fullmatch(r"/detail/[1-9]\d*/[^/]+\.html", parsed.path), "SOURCE_DETAIL_URL_REQUIRED")
            # One actual percent-23 MPN path, never broad decoded-fragment permission.
            if parsed.path != "/detail/1003001031268591/LT3045IMSE%23TRPBF.html":
                segment = urllib.parse.unquote(parsed.path.split("/")[3], errors="strict")
                require(not re.search(r"[/\\?#%\s\x00-\x1f\x7f]", segment) and segment != ".html" and ".." not in segment, "SOURCE_DETAIL_URL_REQUIRED")
    require(urllib.parse.urlunsplit(parsed) == value, "CANONICAL_SOURCE_URL_REQUIRED")


QUOTE_KEYS = ("source", "status", "matchedPartNumber", "matchedBrand", "productCode", "pageUrl", "stockQuantity", "unitPrice", "tierQuantity", "tiers", "currency", "unit", "taxStatus", "packaging", "fetchedAt", "expiresAt", "stockInsufficientForTier", "message")
EVIDENCE_KEYS = ("expectedPartNumber", "observedPartNumber", "expectedBrand", "observedBrand", "brandMatch", "literalReason", "pageUrl", "collectedAt", "observedMaxQuantity", "observedMaxUnitPrice", "maxTierConfirmed")
NEGATIVE = {"not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"}


def verify_quote(q, e, source, record, latest):
    exact_fields(q, QUOTE_KEYS, "EXACT_QUOTE_SCHEMA_REQUIRED")
    require(q["source"] == source and q["expiresAt"] is None and q["message"] is None, "DURABLE_QUOTE_SOURCE_REQUIRED")
    if q["fetchedAt"] is not None:
        timestamp(q["fetchedAt"], latest)
    if q["status"] in NEGATIVE:
        require(e is None and q["tiers"] == [] and q["taxStatus"] == "unknown" and q["stockInsufficientForTier"] is False, "CLEAN_NEGATIVE_REQUIRED")
        for name in ("matchedPartNumber", "matchedBrand", "productCode", "pageUrl", "stockQuantity", "unitPrice", "tierQuantity", "currency", "unit", "packaging"):
            require(q[name] is None, "NEGATIVE_NUMBERS_OR_METADATA_REFUSED")
        return
    require(q["status"] == "ok", "NO_PENDING_OR_UNKNOWN_STATUS")
    exact_fields(e, EVIDENCE_KEYS, "EXACT_POSITIVE_EVIDENCE_REQUIRED")
    timestamp(q["fetchedAt"], latest)
    require(clean_text(q["matchedPartNumber"], 128) and record["partNumber"].strip()
        and q["matchedPartNumber"].strip().upper() == record["partNumber"].strip().upper(), "FULL_MPN_MATCH_REQUIRED")
    require(clean_text(q["matchedBrand"], 256), "OBSERVED_BRAND_REQUIRED")
    for left, right in (("expectedPartNumber", record["partNumber"]), ("expectedBrand", record["brand"]),
        ("observedPartNumber", q["matchedPartNumber"]), ("observedBrand", q["matchedBrand"]), ("pageUrl", q["pageUrl"]), ("collectedAt", q["fetchedAt"]),
        ("observedMaxQuantity", q["tierQuantity"]), ("observedMaxUnitPrice", q["unitPrice"])):
        require(e[left] == right, "SOURCE_IDENTITY_EVIDENCE_MISMATCH")
    require(e["maxTierConfirmed"] is True, "ACTUAL_MAX_TIER_CONFIRMATION_REQUIRED")
    # Proof only; same ECMAScript whitespace/fullwidth ASCII rules as snapshot.ts.
    # Do not normalize record identities or apply general Unicode NFKC.
    norm = lambda v: re.sub(r"[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]", "",
        re.sub(r"[\uff01-\uff5e]", lambda c: chr(ord(c[0]) - 0xfee0), v)).upper()
    wanted, seen = norm(record["brand"]), norm(q["matchedBrand"])
    require(wanted and seen, "NONEMPTY_BRAND_REQUIRED")
    if wanted == seen:
        require(e["brandMatch"] == "exact" and e["literalReason"] is None, "EXACT_BRAND_EVIDENCE_REQUIRED")
    else:
        observed = q["matchedBrand"]
        require(e["brandMatch"] == "explicit_alias" and e["literalReason"] == observed
            and ("(" in observed) == (")" in observed) and ("（" in observed) == ("）" in observed), "LITERAL_BRAND_ALIAS_REQUIRED")
        # 66 finite directions / 57 full literals, synchronized with TS/assembler.
        # Legacy pairs plus evidence-backed research-final-original.json difference.
        # No dynamic research-table load, splitting, transitivity or typo correction.
        # ST -> 意法半导体 only; 先科 -> ST(先科) only. Geehy is unproven.
        aliases = {
            ("MURATA", "MURATA(村田)"),
            ("MURATA", "村田(MURATA)"),
            ("村田", "MURATA(村田)"),
            ("村田", "村田(MURATA)"),
            ("TI", "TI(德州仪器)"),
            ("TI", "德州仪器(TI)"),
            ("德州仪器", "TI(德州仪器)"),
            ("德州仪器", "德州仪器(TI)"),
            ("TEXASINSTRUMENTS", "TEXASINSTRUMENTS(德州仪器)"),
            ("TEXASINSTRUMENTS", "德州仪器(TEXASINSTRUMENTS)"),
            ("德州仪器", "TEXASINSTRUMENTS(德州仪器)"),
            ("德州仪器", "德州仪器(TEXASINSTRUMENTS)"),
            ("YAGEO", "YAGEO(国巨)"),
            ("康奈特", "CNNT/康奈特"),
            ("伊萨普兰", "ISABELLENHUETTE(伊萨普兰)"),
            ("VISHAY", "VISHAY(威世)"),
            ("FH", "FH(风华)"),
            ("FH", "FH/广东风华高科"),
            ("WALSIN", "WALSIN(华新科)"),
            ("承兴", "CHENGX(承兴)"),
            ("HUAWEI", "HUAWEI(华威集团)"),
            ("云星", "YUNXING(云星)"),
            ("顺络", "SUNLORD(顺络)"),
            ("SUNLORD", "SUNLORD(顺络)"),
            ("CJIANG", "CJIANG(长江微电)"),
            ("MORNSUN", "MORNSUN(金升阳)"),
            ("MORNSUN", "MORNSUN/广州金升阳科技"),
            ("金航标", "KINGHELM(金航标)"),
            ("金航标", "KINGHELM/深圳金航标电子"),
            ("明硕", "MINTRON(明硕)"),
            ("RAINSUN", "RAINSUN(霖昱微)"),
            ("灿科盟", "CKMTW(灿科盟)"),
            ("XFCN", "XFCN(兴飞)"),
            ("兆星", "MEGASTAR(兆星)"),
            ("INFINEON", "INFINEON(英飞凌)"),
            ("ST", "ST(意法半导体)"),
            ("先科", "ST(先科)"),
            ("PRISEMI", "PRISEMI(芯导)"),
            ("PRISEMI", "PRISEMI/上海芯导电子"),
            ("BRIGHTKING", "BRIGHTKING(君耀电子)"),
            ("扬杰", "YANGJIE(扬杰)"),
            ("MDD", "MDD(辰达半导体)"),
            ("FAILONG", "FAILONG/广东惠伦晶体"),
            ("TST", "TST(嘉硕)"),
            ("ON", "ON(安森美)"),
            ("BROADCOM", "BROADCOM(博通)"),
            ("LITEON", "LITEON(光宝)"),
            ("LITEON", "LITEON(台湾光宝)"),
            ("MICRONE", "MICRONE(南京微盟)"),
            ("3PEAK", "3PEAK(思瑞浦)"),
            ("UMW", "UMW(友台半导体)"),
            ("UMW", "UMW/友台半导体"),
            ("英飞凌", "INFINEON(英飞凌)"),
            ("瑞隆源", "RUILON(瑞隆源)"),
            ("成都芯进", "CROSSCHIP(成都芯进)"),
            ("金升阳", "MORNSUN(金升阳)"),
            ("ADI", "ADI(亚德诺)"),
            ("ADI", "ADI(亚德诺)/LINEAR"),
            ("昂宝", "OB(昂宝)"),
            ("台湾强茂", "PANJIT/台湾强茂"),
            ("NXP", "NXP(恩智浦)"),
            ("LEM", "LEM(莱姆)"),
            ("IXYS", "LITTELFUSE/IXYS"),
            ("长电", "CJ/江苏长晶(长电)"),
            ("圣邦微", "SGMICRO(圣邦微)"),
            ("INTEL", "INTEL/ALTERA"),
        }
        require((wanted, seen) in aliases, "UNPROVEN_BRAND_ALIAS_REFUSED")
    source_url(source, q["pageUrl"], detail=True)
    for field in ("productCode", "unit", "packaging"):
        require(q[field] is None or clean_text(q[field], 256), "QUOTE_TEXT_INVALID")
    require(q["currency"] in ("CNY", "USD", "HKD") and q["taxStatus"] in ("included", "excluded", "unknown"), "QUOTE_CURRENCY_TAX_INVALID")
    require(q["stockQuantity"] is None or (type(q["stockQuantity"]) is int and 0 <= q["stockQuantity"] <= 9007199254740991), "STOCK_INVALID")
    require(isinstance(q["tiers"], list) and 1 <= len(q["tiers"]) <= 50, "TIERS_REQUIRED")
    previous = 0
    for tier in q["tiers"]:
        exact_fields(tier, ("minQuantity", "unitPrice"), "EXACT_TIER_SCHEMA_REQUIRED")
        require(type(tier["minQuantity"]) is int and previous < tier["minQuantity"] <= 9007199254740991
            and isinstance(tier["unitPrice"], str) and len(tier["unitPrice"]) <= 64
            and re.fullmatch(r"\d+(?:\.\d+)?", tier["unitPrice"]) and Decimal(tier["unitPrice"]) > 0, "REAL_POSITIVE_ORDERED_TIERS_REQUIRED")
        previous = tier["minQuantity"]
    last = q["tiers"][-1]
    require(q["unitPrice"] == last["unitPrice"] and type(q["tierQuantity"]) is int and q["tierQuantity"] == last["minQuantity"]
        and q["stockInsufficientForTier"] is (q["stockQuantity"] is not None and q["stockQuantity"] < previous), "MAX_TIER_BINDING_REQUIRED")


def verify_snapshot(manifest):
    binding = manifest["snapshotBinding"]
    exact_fields(binding, ("snapshotFile", "fileSha256", "collectedAt", "collectionReceiptSha256", "inventoryCaptureSha256", "identityMapSha256", "notGitPrivateInventory"), "EXACT_SNAPSHOT_BINDING_REQUIRED")
    require(binding["snapshotFile"] == "channel-reference-snapshot.json" and binding["notGitPrivateInventory"] is True, "SEPARATE_PUBLIC_SNAPSHOT_REQUIRED")
    require(binding["fileSha256"] == sha(inside(ROOT, binding["snapshotFile"], regular=True))
        and binding["collectionReceiptSha256"] == sha(ROOT / "collection-receipt.json")
        and binding["inventoryCaptureSha256"] == sha(ROOT / "inventory-input.json"), "SNAPSHOT_REAL_FILE_HASH_REQUIRED")
    blob = inside(ROOT, binding["snapshotFile"], regular=True).read_bytes()
    require(0 < len(blob) <= 5 * 1024 * 1024, "SNAPSHOT_BOUNDED_FILE_REQUIRED")
    snapshot = json.loads(blob.decode("utf-8"))
    exact_fields(snapshot, ("schemaVersion", "collectionMode", "generatedAt", "records"), "EXACT_PUBLIC_SNAPSHOT_SCHEMA_REQUIRED")
    require(type(snapshot["schemaVersion"]) is int and snapshot["schemaVersion"] == 1 and snapshot["collectionMode"] == "public-web-batch", "SNAPSHOT_SCHEMA_VERSION_REQUIRED")
    latest = timestamp(snapshot["generatedAt"])
    require(binding["collectedAt"] == snapshot["generatedAt"], "SNAPSHOT_COLLECTION_TIME_BOUND_REQUIRED")
    inventory = json_file("inventory-input.json")
    scope = inventory["scopeEvidence"]
    require(inventory["count"] == 299 and len(inventory["records"]) == 299 and scope.get("confirmed") is True
        and scope.get("nativeVisibleCount") == 299 and scope.get("uniquePairCount") == 294
        and scope.get("optionalNarrowingFiltersApplied") == [] and scope.get("stockFieldsSelected") == ["materialId", "partNumber", "brand"]
        and scope.get("moduleReadConfirmed") is True and scope.get("officialSuperAdminBusinessLeaderReadProofConfirmed") is True
        and scope.get("deployedFrontSourcePath") == FRONT_API and scope.get("deployedFrontSourceSha256") == FIXED_FRONT_API_SHA256
        and scope.get("deployedAdminSourcePath") == APIS["dianzi51-admin"]
        and scope.get("deployedAdminSourceSha256") == manifest["backendFiles"][0]["beforeSha256"], "FULL_SCOPE_CAPTURE_SOURCEIDENTITY_REQUIRED")
    timestamp(inventory["capturedAt"])
    pairs, ids = {}, set()
    for row in inventory["records"]:
        exact_fields(row, ("materialId", "partNumber", "brand"), "PRIVATE_CAPTURE_ONLY_MINIMAL_FIELDS_REQUIRED")
        require(type(row["materialId"]) is int and row["materialId"] > 0 and row["materialId"] not in ids
            and clean_text(row["partNumber"], 128) and clean_text(row["brand"], 64), "CAPTURE_IDENTITY_INVALID")
        ids.add(row["materialId"])
        pairs.setdefault((row["partNumber"], row["brand"]), []).append(row["materialId"])
    require(len(pairs) == 294 and isinstance(snapshot["records"], list) and len(snapshot["records"]) == 294, "294_RECORDS_COVER_299_CAPTURED_REQUIRED")
    identity_map = [{"partNumber": p, "brand": b, "materialIds": sorted(ids)} for (p, b), ids in sorted(pairs.items())]
    require(binding["identityMapSha256"] == digest(identity_map), "EXACT_CAPTURE_MAPPING_REQUIRED")
    receipt = json_file("collection-receipt.json")
    live_evidence(receipt)
    require(receipt.get("contractVersion") == "public-web-collection-v1" and receipt.get("ownerTask") == TASK
        and receipt.get("collectionMode") == "public-web-batch" and receipt.get("collectedAt") == binding["collectedAt"]
        and receipt.get("snapshotFileSha256") == binding["fileSha256"] and receipt.get("inventoryCaptureSha256") == binding["inventoryCaptureSha256"]
        and receipt.get("identityMapSha256") == binding["identityMapSha256"], "REAL_COLLECTION_RECEIPT_REQUIRED")
    observations = receipt["observations"]
    hash_items(observations, "file")
    require(len(observations) == 588, "BOTH_SOURCES_ACTUALLY_QUERIED_REQUIRED")
    observed = {}
    for row in observations:
        exact_fields(row, ("partNumber", "brand", "source", "status", "queryPerformed", "collectedAt", "sourceUrl", "file", "sha256"), "EXACT_COLLECTION_OBSERVATION_REQUIRED")
        key = (row["partNumber"], row["brand"], row["source"])
        require(key not in observed and key[:2] in pairs and row["source"] in ("lcsc", "ickey")
            and row["queryPerformed"] is True, "UNCHECKED_NOT_NEGATIVE_REQUIRED")
        timestamp(row["collectedAt"], latest)
        source_url(row["source"], row["sourceUrl"])
        require(row["file"].startswith("collection-evidence/") and row["file"].endswith(".json")
            and sha(inside(ROOT, row["file"], regular=True)) == row["sha256"], "REAL_COLLECTION_EVIDENCE_FILE_REQUIRED")
        evidence = json_file(row["file"])
        live_evidence(evidence)
        require(evidence.get("queryPerformed") is True
            and all(evidence.get(k) == row[k] for k in ("partNumber", "brand", "source", "status", "collectedAt", "sourceUrl"))
            and observation_text(evidence.get("observedText"), 100000) and len(evidence["observedText"].strip()) >= 8
            and evidence.get("observationKind") in ("product-detail", "search-results", "access-denied", "upstream-failure"), "NONSTUB_COLLECTION_EVIDENCE_REQUIRED")
        observed[key] = (row, evidence)
    actual = set()
    for record in snapshot["records"]:
        exact_fields(record, ("partNumber", "brand", "references", "evidence"), "NO_PRIVATE_DATA_IN_SNAPSHOT_REQUIRED")
        key = (record["partNumber"], record["brand"])
        require(key in pairs and key not in actual, "RAW_SNAPSHOT_IDENTITY_REQUIRED")
        actual.add(key)
        exact_fields(record["references"], ("lcsc", "ickey"), "BOTH_SNAPSHOT_SOURCES_REQUIRED")
        exact_fields(record["evidence"], ("lcsc", "ickey"), "BOTH_SNAPSHOT_EVIDENCE_REQUIRED")
        for source in ("lcsc", "ickey"):
            q, e = record["references"][source], record["evidence"][source]
            verify_quote(q, e, source, record, latest)
            row, observation = observed[(*key, source)]
            require(q["status"] == row["status"] and q["fetchedAt"] == row["collectedAt"], "ACTUAL_QUERY_TIME_STATUS_BINDING_REQUIRED")
            if q["status"] == "ok":
                require(row["sourceUrl"] == q["pageUrl"] and observation.get("positiveEvidence") == e
                    and observation.get("observationKind") == "product-detail", "ACTUAL_POSITIVE_IDENTITY_REQUIRED")
                require(all(str(v) in observation["observedText"] for v in (q["matchedPartNumber"], q["matchedBrand"], q["unitPrice"], q["tierQuantity"])), "OBSERVED_LITERAL_PRICE_IDENTITY_REQUIRED")
            else:
                require(observation_text(observation.get("negativeReason"), 4096) and len(observation["negativeReason"].strip()) >= 8
                    and observation.get("positiveEvidence") is None, "ACTUAL_NEGATIVE_REASON_REQUIRED")
    require(actual == set(pairs), "COMPLETE_RECORD_COVERAGE_REQUIRED")
    proof = json_file("snapshot-readiness-proof.json")
    live_evidence(proof)
    require(proof.get("status") == "PASS" and proof.get("ready") is True and proof.get("snapshotBinding") == binding
        and proof.get("recordCount") == 294 and proof.get("capturedCount") == 299 and proof.get("queriedSourcePairs") == 588
        and proof.get("identityMap") == identity_map and proof.get("sourceIdentityRechecked") is True
        and proof.get("snapshotSchemaStrictlyValidated") is True, "SNAPSHOT_READINESS_REQUIRED")


def verify_validation(manifest):
    proof = json_file("validation-proof.json")
    live_evidence(proof)
    require(proof.get("contractVersion") == "offline-validation-v1" and proof.get("ownerTask") == TASK
        and proof.get("status") == "PASS"
        and proof.get("sourceHashes") == manifest["sourceHashes"], "REAL_VALIDATION_STRUCTURE_REQUIRED")
    checks = proof.get("checks")
    require(isinstance(checks, list) and {r.get("kind") for r in checks} == {"typecheck", "source-tests", "frontend-native-tests", "backend-native-tests", "driver-offline-tests", "review"}, "ALL_VALIDATION_CHECKS_REQUIRED")
    require(len(checks) == 6, "EXACT_VALIDATION_CHECKS_REQUIRED")
    for row in checks:
        require(row.get("status") == "PASS" and type(row.get("exitCode")) is int and row["exitCode"] == 0
            and isinstance(row.get("command"), list) and row["command"] and all(isinstance(x, str) for x in row["command"])
            and row.get("evidenceFile") in manifest["evidenceHashes"]
            and row.get("evidenceSha256") == manifest["evidenceHashes"][row["evidenceFile"]], "VALIDATION_FILE_BOUND_REQUIRED")
        require(timestamp(row.get("completedAt")), "VALIDATION_TIME_REQUIRED")
        evidence = json_file_text(row["evidenceFile"])
        require(len(evidence.strip()) >= 20, "NONEMPTY_VALIDATION_EVIDENCE_REQUIRED")
        if row["kind"].endswith("tests"):
            require(type(row.get("passed")) is int and row["passed"] > 0 and type(row.get("failed")) is int and row["failed"] == 0, "REAL_TEST_COUNTS_REQUIRED")
        if row["kind"] == "review":
            report = json_file(row["evidenceFile"])
            live_evidence(report)
            require(report.get("status") == "PASS"
                and report.get("sourceHashes") == manifest["sourceHashes"]
                and isinstance(report.get("checks"), list) and report["checks"]
                and all(isinstance(r, dict) and r.get("status") == "PASS" and isinstance(r.get("finding"), str) and len(r["finding"]) >= 8 for r in report["checks"]), "REAL_REVIEW_FINDINGS_REQUIRED")


def verify_service_graph(manifest):
    graph = json_file("service-graph-proof.json")
    meta = json_file("service-metafile.json")
    live_evidence(graph)
    require(graph.get("status") == "PASS" and graph.get("snapshotOnly") is True
        and graph.get("independentlyBuiltTwice") is True and graph.get("outputAndMetafileReproductionByteExact") is True
        and graph.get("artifact") == "channel-reference-service.mjs" and graph.get("artifactSha256") == sha(ROOT / "channel-reference-service.mjs")
        and graph.get("metafileSha256") == sha(ROOT / "service-metafile.json")
        and graph.get("sourceHashes") == {name: manifest["sourceHashes"].get(name) for name in meta["inputs"]}, "FINAL_SNAPSHOT_ESM_GRAPH_REQUIRED")
    require(graph.get("executed") is False and graph.get("networkExecution") is False and graph.get("databaseAccess") is False
        and graph.get("browserWorkerRequired") is False, "SNAPSHOT_RUNTIME_ONLY_REQUIRED")
    require("server/channelReference/snapshot.ts" in meta["inputs"] and "server/channelReference/service.ts" in meta["inputs"]
        and all(name.startswith(("server/channelReference/", "shared/")) for name in meta["inputs"]), "BOUNDED_FINAL_SERVICE_INPUTS_REQUIRED")
    require(isinstance(meta.get("outputs"), dict) and len(meta["outputs"]) == 1, "SINGLE_FINAL_ESM_OUTPUT_REQUIRED")
    output = next(iter(meta["outputs"].values()))
    require(output.get("entryPoint") == "server/channelReference/service.ts" and "lookupChannelReferences" in output.get("exports", [])
        and all(i.get("external") is True and i.get("path", "").startswith("node:") for i in output.get("imports", [])), "SOURCE_SERVICE_ESM_EXPORT_REQUIRED")
    service = json_file_text("source-snapshot/server/channelReference/service.ts")
    snapshot_source = json_file_text("source-snapshot/server/channelReference/snapshot.ts")
    require('from "./snapshot"' in service and "createChannelReferenceSnapshotService()" in service
        and re.search(r"export\s+const\s+lookupChannelReferences\s*=\s*service\.lookup", service)
        and 'new URL("./channel-reference-snapshot.json", import.meta.url)' in snapshot_source, "DEFAULT_EXPORT_SNAPSHOT_ONLY_REQUIRED")


def validate_manifest(manifest):
    require(manifest.get("contractVersion") == "snapshot-pricing-v1" and manifest.get("snapshotOnly") is True, "SNAPSHOT_ONLY_CONTRACT_REQUIRED")
    require(manifest["ownerTask"] == TASK, "BOUNDED_OWNER_SCOPE_REQUIRED")
    files, backends = manifest["files"], manifest["backendFiles"]
    hash_items(files)
    core = manifest["coreAssetPaths"]
    require(isinstance(core, list) and len(core) == 2 and len(set(core)) == len(core)
        and "index.html" not in core and {x["relative"] for x in files} == {"index.html", *core}, "EXACT_ASSET_ALLOWLIST_REQUIRED")
    for item in files:
        relative = safe_relative(item["relative"])
        require(item["relative"] == "index.html" or (len(relative.parts) == 2 and relative.parts[0] == "assets"
            and "channel-reference-pricing" in relative.name and relative.suffix == ".js" and re.fullmatch(r"BusinessWorkbenchPage-[01]-channel-reference-pricing-[0-9a-f]{64}\.js", relative.name)), "CUSTOMER_ASSET_NAMESPACE_REQUIRED")
        inside(PUBLIC, item["relative"])
        require(sha(inside(ROOT / "candidate", item["relative"], regular=True)) == item["sha256"], "CANDIDATE_CHANGED")
    require(len(backends) == 1 and backends[0]["processName"] == "dianzi51-admin"
        and backends[0]["path"] == APIS["dianzi51-admin"] and backends[0]["relative"] == "api/admin-index.js", "EXACT_API_ALLOWLIST_REQUIRED")
    hash_items(backends, "path")
    require(HEX.fullmatch(backends[0]["beforeSha256"]) and sha(inside(ROOT / "candidate", backends[0]["relative"], regular=True)) == backends[0]["sha256"], "API_CANDIDATE_CHANGED")
    require(sha(ROOT / Path(__file__).name) == manifest["driverSha256"], "DRIVER_CHANGED")
    required_evidence = {"candidate-proof.json", "backend-candidate-proof.json", "reload-channel-reference-api.cjs", "bind-source.py", "live-baseline-current.json", "previous-source-receipt.json", "service-metafile.json", "snapshot-readiness-proof.json", "collection-receipt.json", "inventory-input.json", "validation-proof.json", "service-graph-proof.json", "html-build-proof.json"}
    evidence = manifest["evidenceHashes"]
    require(required_evidence <= set(evidence) and len(evidence) <= 64, "CORE_EVIDENCE_HASHES_REQUIRED")
    for name, expected in evidence.items():
        require(safe_relative(name).name == name and HEX.fullmatch(expected)
            and sha(inside(ROOT, name, regular=True)) == expected, "EVIDENCE_CHANGED")
    proof = json.loads((ROOT / "candidate-proof.json").read_text())
    backend_proof = json.loads((ROOT / "backend-candidate-proof.json").read_text())
    require(proof["status"] == "PASS" and all(proof.get(flag) is True for flag in PROOF_FLAGS), "FRONTEND_PROOF_REQUIRED")
    require(backend_proof["status"] == "PASS" and all(backend_proof.get(flag) is True
        for flag in ("sourceBound", "sourceBindingsVerified", "unrelatedBytesUnchanged", "newRootRegistered", "anonymousAuthorizationBeforeBusinessIO", "runtimeHelperSourceGraphVerified")), "BACKEND_SOURCE_PROOF_REQUIRED")
    require(proof.get("files") == files and backend_proof.get("backendFiles") == backends, "PROOF_OUTPUT_BINDING_REQUIRED")
    native_names = proof["nativeProofEvidence"]
    require(isinstance(native_names, list) and native_names and len(native_names) == len(set(native_names))
        and len(native_names) <= 8 and set(native_names) <= set(evidence), "NATIVE_FRONTEND_EVIDENCE_REQUIRED")
    js_hashes = {item["sha256"] for item in files if item["relative"].endswith(".js")}
    old_hashes = {item["sha256"] for item in manifest["baselineAssets"]}
    proven_hashes = set()
    for name in native_names:
        require(name.endswith(".json"), "NATIVE_BYTE_JSON_REQUIRED")
        inverse = json.loads((ROOT / name).read_text())
        require(inverse.get("sha256") in js_hashes and inverse.get("beforeSha256") in old_hashes
            and all(inverse.get(flag) is True for flag in ("exactInverse", "allNonpatchBytesUnchanged", "allOldSpecifiersPreserved", "importsByteIdentical", "exportsByteIdentical"))
            and isinstance(inverse.get("unchangedPartitions"), list) and inverse["unchangedPartitions"]
            and isinstance(inverse.get("patches"), list) and inverse["patches"], "REAL_FRONTEND_BYTE_INVERSE_REQUIRED")
        proven_hashes.add(inverse["sha256"])
    require(proven_hashes == js_hashes, "ALL_NEW_JS_BYTE_PROOFS_REQUIRED")
    native_name = backend_proof["nativeProofEvidence"]
    require(isinstance(native_name, str) and native_name in evidence and native_name.endswith(".json"), "NATIVE_BACKEND_EVIDENCE_REQUIRED")
    native = json.loads((ROOT / native_name).read_text())
    require(native.get("status") == "PASS" and native.get("candidateSha256") == backends[0]["sha256"]
        and native.get("sourceBound") is True and native.get("unrelatedBytesUnchanged") is True
        and native.get("inverse", {}).get("byteExact") is True
        and native.get("protectedDeclarations", {}).get("count") == 1092
        and native.get("importDelta", {}).get("oldCount") == 130
        and native.get("rootProtection", {}).get("protectedCount") == 24
        and native.get("serviceImportBridge", {}).get("serviceArtifact", {}).get("sourceGraphReproductionProved") is True, "REAL_BACKEND_NATIVE_PROOF_REQUIRED")
    require(isinstance(native.get("sourcePins"), dict) and native["sourcePins"]
        and all(manifest["sourceHashes"].get(relative) == expected for relative, expected in native["sourcePins"].items()), "NATIVE_BACKEND_SOURCE_BINDING_REQUIRED")
    bridge = native["serviceImportBridge"]
    artifact = bridge["serviceArtifact"]
    require(bridge.get("fixedImport") == str(RUNTIME_ROOT / "channel-reference-service.mjs")
        and bridge.get("sourceModule") == "server/channelReference/service.ts" and bridge.get("sourceExport") == "lookupChannelReferences"
        and artifact.get("sha256") == next(item["sha256"] for item in manifest["standaloneHelpers"] if item["relative"] == "channel-reference-service.mjs")
        and artifact.get("metafileSha256") == evidence["service-metafile.json"]
        and artifact.get("sourceSha256") == manifest["sourceHashes"].get("server/channelReference/service.ts"), "SERVICE_ARTIFACT_SOURCE_BOUND_METADATA_REQUIRED")
    require(all(manifest.get(flag) is True for flag in ("tscPassed", "candidateTestsPassed", "backendCandidateTestsPassed", "reviewPassed"))
        and type(manifest["sourceTestFailures"]) is int and manifest["sourceTestFailures"] == 0, "VALIDATION_REQUIRED")
    baseline = json.loads((ROOT / "live-baseline-current.json").read_text())
    require(manifest["baselineAssets"] == baseline["baselineAssets"] and manifest["protectedFiles"] == baseline["protectedFiles"]
        and manifest["baselineProcesses"] == baseline["processes"] and manifest["beforeHtmlSha256"] == baseline["beforeHtmlSha256"]
        and backends[0]["beforeSha256"] == baseline["api"]["admin"] and manifest["untouchedFrontApiSha256"] == baseline["api"]["front"]
        and manifest["capturedCoordSha256"] == baseline["coordSha256"] and baseline["sharedReleaseActive"] is False
        and baseline["publicRoot"] == str(PUBLIC) and baseline["apiPaths"] == {"admin": APIS["dianzi51-admin"], "front": FRONT_API}, "FRESH_BASELINE_BINDING_REQUIRED")
    hash_items(manifest["baselineAssets"])
    hash_items(manifest["protectedFiles"], "path")
    require({item["path"] for item in manifest["protectedFiles"]} == PROTECTED_PATHS
        and len(manifest["baselineAssets"]) >= 1, "EXACT_PROTECTED_FILES_REQUIRED")
    require(any(item["path"] == FRONT_API and item["sha256"] == manifest["untouchedFrontApiSha256"] for item in manifest["protectedFiles"]), "FRONT_API_PROTECTION_REQUIRED")
    require(manifest["untouchedFrontApiSha256"] == FIXED_FRONT_API_SHA256, "FIXED_FRONT_API_HASH_REQUIRED")
    require(not set(core) & {item["relative"] for item in manifest["baselineAssets"]}, "ADDITIVE_ASSETS_REQUIRED")
    for item in manifest["baselineAssets"]:
        require(safe_relative(item["relative"]).parts[0] == "assets", "OLD_ASSET_PATH_REQUIRED")
        inside(PUBLIC, item["relative"])
    dependencies = manifest["dependencies"]
    require(isinstance(dependencies, list) and len(dependencies) == len(set(dependencies)) and len(dependencies) <= 512, "BOUNDED_DEPENDENCIES_REQUIRED")
    allowed = {"/" + item["relative"] for item in manifest["baselineAssets"]} | {"/" + item for item in core}
    require(set(dependencies) <= allowed, "DEPENDENCY_ALLOWLIST_REQUIRED")
    strict_baseline(manifest, manifest["baselineProcesses"])
    verify_helpers(manifest)
    require(proof.get("standaloneHelpers") == backend_proof.get("standaloneHelpers") == manifest["standaloneHelpers"], "HELPER_PROOF_BINDING_REQUIRED")
    verify_package(manifest)
    verify_native_bytes(manifest, proof, native)
    verify_snapshot(manifest)
    verify_validation(manifest)
    verify_service_graph(manifest)
    source_contract(manifest, (proof, backend_proof))
    return files, backends


def main():
    global MANIFEST_PIN, COORD_PIN
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    require(sum((args.apply, args.rollback, args.plan)) <= 1, "ONE_ACTION_REQUIRED")
    manifest = json.loads((ROOT / "manifest.json").read_text())
    MANIFEST_PIN = sha(ROOT / "manifest.json")
    files, backends = validate_manifest(manifest)
    target = PUBLIC / "index.html"
    html = next(item for item in files if item["relative"] == "index.html")
    if not args.apply and not args.rollback:
        print(json.dumps({"planOnly": True, "frontendFiles": len(files), "backendFiles": 1,
            "standaloneHelpers": len(manifest["standaloneHelpers"]), "databaseOperations": 0, "rollingReloadInstances": 2, "frontReloadInstances": 0, "globalRestart": False, "snapshotOnly": True, "snapshotReady": True, "liveEvidenceGeneratedByDriver": False}))
        return
    locks, installed_backends = [], []
    opened = switched = False
    before = None
    record = {"owner_task": TASK, "task": TASK, "status": "preflight", "scope": "snapshot-only channel reference pricing; two native workbenches; admin API only; no business writes", "openedAtUtc": now(), "attemptId": uuid.uuid4().hex}
    try:
        for name in LOCK_PATHS:
            lock = open(name, "a+")
            locks.append(lock)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        COORD_PIN = sha(COORD)
        state = json.loads(COORD.read_text())
        require(sha(COORD) == COORD_PIN, "FULL_COORDINATION_CAS_FAILED")
        if not args.rollback:
            require(COORD_PIN == manifest["capturedCoordSha256"], "FRESH_COMPLETE_COORDINATION_CAS_FAILED")
        own_recovery = args.rollback and owns_window(state) \
            and state.get("window", {}).get("status") == "recovery-required"
        require(not state.get("shared_release_active") or own_recovery, "OTHER_RELEASE_ACTIVE")
        if args.rollback:
            if own_recovery:
                record = dict(state["window"])
                opened = True
            else:
                require(state.get("window", {}).get("owner_task") == TASK and state["window"].get("task") == TASK, "ROLLBACK_WINDOW_OWNER_REQUIRED")
                record = dict(state["window"])
            require(sha(target) in (html["sha256"], manifest["beforeHtmlSha256"])
                and sha(ROOT / "index-before.html") == manifest["beforeHtmlSha256"], "HTML_ROLLBACK_CAS_FAILED")
            before = json.loads((ROOT / "process-before.json").read_text())
            _, recovery_ids = reload_intents(backends, before)
            compatible(before, processes(), recovery_ids)
            verify_frozen(manifest)
            installed_backends = list(backends)
            if not opened:
                record["status"] = "rolling-back"
                state.update(shared_release_active=True, window=record, updated_at=now())
                save_coord(state)
                opened = True
            assert_owner(record)
            if sha(target) == html["sha256"]:
                atomic(target, (ROOT / "index-before.html").read_bytes())
            restored = restore_backends(backends, before, record)
            require(sha(target) == manifest["beforeHtmlSha256"], "HTML_RESTORE_NOT_CONFIRMED")
            verify_frozen(manifest)
            state = assert_owner(record)
            record.update(status="rolled-back", closedAtUtc=now(), manualRecoveryRequired=False)
            record.pop("recoveryError", None)
            state.update(shared_release_active=False, window=record, updated_at=now())
            state.setdefault("window_history", []).append(dict(record))
            save_coord(state)
            save(ROOT / "rolled-back.json", {"status": "rolled-back", "atUtc": now(), "restoredHtmlSha256": sha(target), "exactBackendRollback": restored})
            print("Exact owned HTML/API rollback complete")
            return
        require(not (ROOT / "reload-intents.json").exists() and not (ROOT / "process-before.json").exists(), "UNIQUE_ATTEMPT_REQUIRED")
        require(not (ROOT / "verified.json").exists() and not (ROOT / "activation-started.json").exists(), "PREVIOUS_ATTEMPT_INSPECT_REQUIRED")
        require(not (ROOT / "failed.json").exists() or not json.loads((ROOT / "failed.json").read_text()).get("manualRecoveryRequired"), "MANUAL_RECOVERY_INSPECT_REQUIRED")
        require(sha(target) == manifest["beforeHtmlSha256"], "BASELINE_CAS_FAILED")
        before = processes()
        for name, count in (("dianzi51-admin", 2),):
            group = [row for row in before if row["name"] == name]
            require(len(group) == count and all(row["status"] == "online" and row["pid"] > 0 and row["execMode"] == "cluster_mode"
                and row["script"] == APIS[name] for row in group)
                and {row["id"] for row in group} == OWNED_IDS, "API_BASELINE_NOT_ONLINE")
        strict_baseline(manifest, before)
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
        require(front_before["sha256"] == next(item["sha256"] for item in manifest["protectedFiles"] if item["path"].endswith("front/dist/public/index.html")), "FRONT_BASELINE_HTML_REQUIRED")
        require(get("https://admin.51dianzi.com/workbench/customers")[0]["sha256"] == manifest["beforeHtmlSha256"], "PUBLIC_BASELINE_MISMATCH")
        require(sha(COORD) == COORD_PIN, "FULL_COORDINATION_CAS_FAILED")
        state = json.loads(COORD.read_text())
        require(not state.get("shared_release_active") and sha(target) == manifest["beforeHtmlSha256"], "WINDOW_CHANGED")
        strict_baseline(manifest, processes())
        verify_frozen(manifest)
        validate_manifest(manifest)
        for item in backends:
            require(sha(item["path"]) == item["beforeSha256"], "FINAL_API_CAS_FAILED")
        record["status"] = "activating"
        state.update(shared_release_active=True, window=record, updated_at=now())
        save_coord(state)
        opened = True
        save(ROOT / "activation-started.json", {"atUtc": now(), "ownerTask": TASK, "openedAtUtc": record["openedAtUtc"], "manifestSha256": MANIFEST_PIN, "attemptId": record["attemptId"]})
        print("Installing isolated assets while original HTML remains active", flush=True)
        for item in files:
            assert_owner(record)
            verify_frozen(manifest)
            compatible(before, processes())
            if item["relative"] != "index.html" and not (PUBLIC / item["relative"]).exists():
                require(sha(ROOT / "candidate" / item["relative"]) == item["sha256"], "FINAL_STATIC_CANDIDATE_CAS_FAILED")
                require(sha(target) == manifest["beforeHtmlSha256"], "FINAL_OLD_HTML_CAS_FAILED")
                atomic(PUBLIC / item["relative"], (ROOT / "candidate" / item["relative"]).read_bytes())
        def verify(item):
            check, body = get("https://admin.51dianzi.com/" + item["relative"])
            require(check["sha256"] == item["sha256"] and "text/html" not in check.get("contentType", "").lower()
                and not body.lstrip().lower().startswith((b"<!doctype html", b"<html")), "PUBLIC_ASSET_FAILED")
            return check
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            checks = list(pool.map(verify, [x for x in files if x["relative"] != "index.html"]))
        api_health = []
        for name in ("dianzi51-admin",):
            item = next(value for value in backends if value["processName"] == name)
            assert_owner(record)
            verify_frozen(manifest)
            verify_helpers(manifest)
            compatible(before, processes())
            require(sha(target) == manifest["beforeHtmlSha256"], "FINAL_OLD_HTML_CAS_FAILED")
            require(sha(item["path"]) == item["beforeSha256"], "FINAL_API_CAS_FAILED")
            require(sha(ROOT / "candidate" / item["relative"]) == item["sha256"], "FINAL_API_CANDIDATE_CAS_FAILED")
            atomic(item["path"], (ROOT / "candidate" / item["relative"]).read_bytes())
            installed_backends.append(item)
            for row in before:
                if row["name"] == name:
                    assert_owner(record)
                    verify_frozen(manifest)
                    verify_helpers(manifest)
                    intents, _ = reload_intents(installed_backends, before)
                    intents.append({"ownerTask": TASK, "attemptId": record["attemptId"], "id": row["id"], "name": name, "apiHash": item["sha256"], "atUtc": now()})
                    save(ROOT / "reload-intents.json", intents)
                    reload_instance(row)
                    compatible(before, processes())
            api_health.append(protected_api_health(name))
            api_health.append(protected_api_health(name, "personalCenter.profile"))
            api_health.append(protected_api_health(name, "adminUser.list"))
            require(get("https://www.51dianzi.com/")[0]["sha256"] == front_before["sha256"], "FRONT_PAGE_CHANGED")
        assert_owner(record)
        verify_frozen(manifest)
        verify_helpers(manifest)
        compatible(before, processes())
        for item in backends:
            require(sha(item["path"]) == item["sha256"], "FINAL_NEW_API_CAS_FAILED")
        require(sha(target) == manifest["beforeHtmlSha256"], "FINAL_HTML_CAS_FAILED")
        require(sha(ROOT / "candidate/index.html") == html["sha256"], "FINAL_HTML_CANDIDATE_CAS_FAILED")
        atomic(target, (ROOT / "candidate/index.html").read_bytes())
        switched = True
        health = []
        for url in ("https://admin.51dianzi.com/", "https://admin.51dianzi.com/login", "https://admin.51dianzi.com/profile", "https://admin.51dianzi.com/workbench/customers",
            "https://admin.51dianzi.com/staff", "https://admin.51dianzi.com/workbench/procurement-demands",
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
        require(sha(target) == html["sha256"], "FINAL_NEW_HTML_CAS_FAILED")
        verify_helpers(manifest)
        for item in files:
            require(sha(PUBLIC / item["relative"]) == item["sha256"], "FINAL_STATIC_RUNTIME_CAS_FAILED")
        state = assert_owner(record)
        record.update(status="verified", closedAtUtc=now(), receipt=str(ROOT / "verified.json"))
        receipt = {"status": "verified", "atUtc": now(), "htmlSha256": html["sha256"], "files": files, "backendFiles": backends,
            "publicAssets": checks, "health": health, **{flag: True for flag in PROOF_FLAGS}, "allProtectedFilesUnchanged": True,
            "independentWorkersUnchanged": True, "apiPathsAndEnvironmentsUnchanged": True, "oldAssetsUnchanged": True,
            "backendChanges": 1, "databaseOperations": 0, "permissionAssignmentsChanged": 0, "rollingReloadInstances": 2,
            "frontReloadInstances": 0, "standaloneHelpers": manifest["standaloneHelpers"], "snapshotBinding": manifest["snapshotBinding"], "attemptId": record["attemptId"],
            "runtimeHelperHashesVerified": True, "sourceHashSnapshot": manifest["sourceHashSnapshot"], "manifestSha256": MANIFEST_PIN, "driverSha256": manifest["driverSha256"],
            "globalRestart": False, "startupDumpChanged": False, "productionRecordWrites": 0, "loggedInBrowserAcceptancePerformed": False}
        receipt["newProtectedApiHealth"] = api_health
        save(ROOT / "verified.json", receipt)
        state = assert_owner(record)
        state.update(shared_release_active=False, window=record, updated_at=now())
        state.setdefault("window_history", []).append(dict(record))
        save_coord(state)
        print(json.dumps({"status": "verified", "receipt": str(ROOT / "verified.json"), "files": len(files), "backendFiles": 1}))
    except BaseException as error:
        restored_html, restored_apis, recovery_errors = False, [], []
        html_confirmed = not opened
        if opened:
            try:
                assert_owner(record)
                _, recovery_ids = reload_intents(backends, before)
                compatible(before, processes(), recovery_ids)
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
                restored_apis = restore_backends(backends, before, record)
            except BaseException:
                recovery_errors.append("EXACT_API_RECOVERY_NOT_CONFIRMED")
        elif opened:
            recovery_errors.append("ORIGINAL_PROCESS_RECOVERY_NOT_CONFIRMED")
        if opened:
            try:
                verify_frozen(manifest)
            except BaseException:
                recovery_errors.append("PROTECTED_BYTES_RECOVERY_NOT_CONFIRMED")
        recovery_required = opened and (not html_confirmed or bool(recovery_errors))
        if opened:
            try:
                state = json.loads(COORD.read_text())
                own_window = owns_window(state, record) and sha(COORD) == COORD_PIN
            except BaseException:
                state, own_window = None, False
            if not own_window:
                recovery_errors.append("WINDOW_OWNERSHIP_LOST")
                recovery_required = True
            record.update(status="recovery-required" if recovery_required else "failed",
                manualRecoveryRequired=recovery_required)
            if recovery_required:
                record.pop("closedAtUtc", None)
                record["recoveryError"] = "; ".join(recovery_errors) + "; manual exact recovery required; do not replay apply"
            else:
                record["closedAtUtc"] = now()
            if own_window:
                state.update(shared_release_active=recovery_required, window=record, updated_at=now())
                state.setdefault("window_history", []).append(dict(record))
                try:
                    save_coord(state)
                except BaseException:
                    recovery_errors.append("COORDINATION_RECOVERY_NOT_CONFIRMED")
                    recovery_required = True
            # Foreign coordination is byte-for-byte untouched; local failed receipt
            # carries manual-recovery requirement. Never reopen/overwrite its window.
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
