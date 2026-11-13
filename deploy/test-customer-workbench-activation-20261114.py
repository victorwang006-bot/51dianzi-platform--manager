#!/usr/bin/env python3
"""Synthetic filesystem/PM2/HTTP checks. No server, database or network use."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("customer_activate", HERE / "activate-customer-workbench-20261114.py")
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class Activation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.root = self.base / "ops"
        self.public = self.base / "public"
        self.root.mkdir()
        (self.public / "assets").mkdir(parents=True)
        (self.root / "candidate/assets").mkdir(parents=True)
        (self.root / "candidate/api").mkdir()
        self.coord = self.base / "coord.json"
        self.coord.write_text(json.dumps({"shared_release_active": False, "unrelated": {"keep": 42}}))
        (self.public / "index.html").write_text("old html")
        (self.public / "assets/old.js").write_text("unrelated original asset")
        (self.root / "candidate/index.html").write_text("new customer html")
        (self.root / "candidate/assets/customer-workbench-a.js").write_text("customer source-bound asset")
        for name in ("activate-customer-workbench-20261114.py", "reload-customer-inventory-api-20261114.cjs"):
            shutil.copy2(HERE / name, self.root / name)
        self.apis = {"dianzi51": str(self.base / "front.js"), "dianzi51-admin": str(self.base / "admin.js")}
        self.backend = []
        for name, rel in (("dianzi51", "api/front-index.js"), ("dianzi51-admin", "api/admin-index.js")):
            Path(self.apis[name]).write_text("old " + name)
            (self.root / "candidate" / rel).write_text("new " + name)
            self.backend.append({"processName": name, "relative": rel, "path": self.apis[name], "sha256": driver.sha(self.root / "candidate" / rel), "beforeSha256": driver.sha(self.apis[name])})
        self.before = [{"id": i, "name": "dianzi51" if i < 4 else "dianzi51-admin", "pid": i + 101,
            "status": "online", "script": self.apis["dianzi51" if i < 4 else "dianzi51-admin"], "cwd": "/original/cwd",
            "execMode": "cluster_mode", "environmentHash": "safe-env-hash"} for i in range(6)]
        self.before.append({"id": 99, "name": "inventory-worker", "pid": 999, "status": "online", "script": "/original/worker", "cwd": "/original/worker-cwd", "execMode": "fork_mode", "environmentHash": "worker-env-hash"})
        self.current = json.loads(json.dumps(self.before))
        self.reloaded = []
        for name, proof in (("candidate-proof.json", {"status": "PASS", **{flag: True for flag in driver.PROOF_FLAGS}}), ("backend-candidate-proof.json", {"status": "PASS", "sourceBound": True, "unrelatedBytesUnchanged": True})):
            (self.root / name).write_text(json.dumps(proof))
        self.manifest = {"ownerTask": driver.TASK, "files": [{"relative": rel, "sha256": driver.sha(self.root / "candidate" / rel)} for rel in ("index.html", "assets/customer-workbench-a.js")],
            "coreAssetPaths": ["assets/customer-workbench-a.js"], "backendFiles": self.backend,
            "driverSha256": driver.sha(self.root / "activate-customer-workbench-20261114.py"),
            "evidenceHashes": {name: driver.sha(self.root / name) for name in ("candidate-proof.json", "backend-candidate-proof.json", "reload-customer-inventory-api-20261114.cjs")},
            "tscPassed": True, "sourceTestFailures": 0, "candidateTestsPassed": True, "backendCandidateTestsPassed": True, "reviewPassed": True,
            "beforeHtmlSha256": driver.sha(self.public / "index.html"), "protectedFiles": [],
            "baselineAssets": [{"relative": "assets/old.js", "sha256": driver.sha(self.public / "assets/old.js")}], "dependencies": ["/assets/old.js", "/assets/customer-workbench-a.js"]}
        self.save_manifest()
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(driver, ROOT=self.root, PUBLIC=self.public, COORD=self.coord, APIS=self.apis))
        self.stack.enter_context(patch.object(driver, "processes", side_effect=lambda: json.loads(json.dumps(self.current))))
        self.stack.enter_context(patch.object(driver, "get", side_effect=self.http))
        self.stack.enter_context(patch.object(driver, "reload_instance", side_effect=self.reload))
        self.stack.enter_context(patch.object(driver.fcntl, "flock"))
        native_open = open
        def local_open(path, *args, **kwargs):
            if str(path).startswith("/var/lock/"):
                path = self.base / Path(path).name
            return native_open(path, *args, **kwargs)
        self.stack.enter_context(patch("builtins.open", side_effect=local_open))

    def tearDown(self):
        self.stack.close()
        self.temporary.cleanup()

    def save_manifest(self):
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))

    def http(self, url):
        body = b"unchanged main site" if url.startswith("https://www.") else (self.public / url.split("51dianzi.com/", 1)[1].split("?", 1)[0]).read_bytes() if "/assets/" in url else (self.public / "index.html").read_bytes()
        return {"url": url, "status": 200, "sha256": hashlib.sha256(body).hexdigest()}, body

    def reload(self, row, rollback=False):
        self.reloaded.append((row["id"], rollback))
        intents = json.loads((self.root / "reload-intents.json").read_text())
        item = next(item for item in self.backend if item["processName"] == row["name"])
        self.assertTrue(any(intent["ownerTask"] == driver.TASK and intent["id"] == row["id"]
            and intent["name"] == row["name"] and intent["apiHash"] == item["sha256"] for intent in intents))
        current = next(value for value in self.current if value["id"] == row["id"])
        current["pid"] = max(current["pid"], row["pid"]) + 100
        current["status"] = "online"

    def run_driver(self, *args):
        with patch.object(sys, "argv", ["activate", *args]), contextlib.redirect_stdout(io.StringIO()):
            driver.main()

    def test_plan_never_contacts_processes_or_http(self):
        with patch.object(driver, "processes", side_effect=AssertionError("PM2 in plan")), patch.object(driver, "get", side_effect=AssertionError("HTTP in plan")):
            self.run_driver()
        self.assertFalse((self.root / "activation-started.json").exists())

    def test_success_keeps_old_assets_workers_coord_and_original_api_paths(self):
        self.run_driver("--apply")
        receipt = json.loads((self.root / "verified.json").read_text())
        self.assertEqual(receipt["status"], "verified")
        self.assertEqual(len(self.reloaded), 6)
        self.assertEqual(self.current[-1], self.before[-1])
        self.assertEqual((self.public / "assets/old.js").read_text(), "unrelated original asset")
        self.assertEqual(json.loads(self.coord.read_text())["unrelated"], {"keep": 42})
        self.assertFalse(json.loads(self.coord.read_text())["shared_release_active"])
        self.assertTrue(all(driver.sha(item["path"]) == item["sha256"] for item in self.backend))

    def test_html_baseline_drift_refuses_all_api_writes(self):
        (self.public / "index.html").write_text("another task html")
        with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertFalse(self.reloaded)
        self.assertEqual(Path(self.apis["dianzi51"]).read_text(), "old dianzi51")

    def test_active_other_task_refuses_release(self):
        self.coord.write_text(json.dumps({"shared_release_active": True}))
        with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertFalse(self.reloaded)

    def test_unsafe_asset_namespace_rejected(self):
        self.manifest["files"][1]["relative"] = "assets/index.js"
        self.manifest["coreAssetPaths"] = ["assets/index.js"]
        self.save_manifest()
        with self.assertRaises(RuntimeError): self.run_driver()

    def test_api_baseline_drift_never_overwrites_other_task(self):
        Path(self.apis["dianzi51"]).write_text("newer other API")
        with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(Path(self.apis["dianzi51"]).read_text(), "newer other API")
        self.assertFalse(self.reloaded)

    def test_failure_after_api_and_html_restores_exact_owned_versions(self):
        original_http = self.http
        def failed_health(url):
            if (self.public / "index.html").read_text() == "new customer html" and url.endswith("/login"):
                raise RuntimeError("synthetic health failure")
            return original_http(url)
        with patch.object(driver, "get", side_effect=failed_health):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        failure = json.loads((self.root / "failed.json").read_text())
        self.assertTrue(failure["exactHtmlRollback"])
        self.assertEqual(set(failure["exactBackendRollback"]), set(self.apis))
        self.assertEqual((self.public / "index.html").read_text(), "old html")
        self.assertTrue(all(driver.sha(item["path"]) == item["beforeSha256"] for item in self.backend))
        self.assertEqual(self.current[-1], self.before[-1])

    def test_backend_rollback_cas_rejects_foreign_bytes(self):
        driver.save(self.root / "process-before.json", self.before)
        for item in self.backend:
            (self.root / ("before-" + item["processName"] + ".js")).write_text("old " + item["processName"])
        Path(self.apis["dianzi51-admin"]).write_text("newer foreign API")
        with self.assertRaises(RuntimeError): driver.restore_backends(self.backend, self.before)
        self.assertEqual(Path(self.apis["dianzi51-admin"]).read_text(), "newer foreign API")
        self.assertFalse(self.reloaded)

    def test_missing_backend_proof_stops_before_activation(self):
        proof = {"status": "PASS", "sourceBound": False, "unrelatedBytesUnchanged": True}
        (self.root / "backend-candidate-proof.json").write_text(json.dumps(proof))
        self.manifest["evidenceHashes"]["backend-candidate-proof.json"] = driver.sha(self.root / "backend-candidate-proof.json")
        self.save_manifest()
        with self.assertRaises(RuntimeError): self.run_driver("--apply")
        self.assertFalse(self.reloaded)

    def seed_owned_recovery(self, ids=(0,)):
        driver.save(self.root / "process-before.json", self.before)
        for item in self.backend:
            (self.root / ("before-" + item["processName"] + ".js")).write_text("old " + item["processName"])
            Path(item["path"]).write_text("new " + item["processName"])
        driver.save(self.root / "reload-intents.json", [{"ownerTask": driver.TASK, "id": row["id"],
            "name": row["name"], "apiHash": next(item["sha256"] for item in self.backend if item["processName"] == row["name"])}
            for row in self.before if row["id"] in ids])

    def assert_coord_recovery_required(self):
        coord = json.loads(self.coord.read_text())
        failure = json.loads((self.root / "failed.json").read_text())
        self.assertTrue(coord["shared_release_active"])
        self.assertEqual(coord["window"]["owner_task"], driver.TASK)
        self.assertEqual(coord["window"]["status"], "recovery-required")
        self.assertNotIn("closedAtUtc", coord["window"])
        self.assertTrue(coord["window"]["manualRecoveryRequired"])
        self.assertEqual(failure["status"], "recovery-required")
        self.assertIn("manual exact recovery required", failure["recoveryError"])
        self.assertEqual(coord["unrelated"], {"keep": 42})
        unlocks = [call for call in driver.fcntl.flock.call_args_list if call.args[1] == driver.fcntl.LOCK_UN]
        self.assertGreaterEqual(len(unlocks), 2, "advisory locks must release while coordination stays occupied")
        calls = len(self.reloaded)
        with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(len(self.reloaded), calls, "next apply must be blocked by occupied coordination")
        self.assertEqual(json.loads((self.root / "failed.json").read_text())["status"], "recovery-required")

    def test_owned_unhealthy_statuses_restore_original_bytes_and_online(self):
        for status, pid in (("errored", 0), ("stopped", 0), ("launching", 0), ("stopping", 0), ("online", 0)):
            with self.subTest(status=status, pid=pid):
                self.seed_owned_recovery()
                self.current = json.loads(json.dumps(self.before))
                self.current[0].update(status=status, pid=pid)
                self.reloaded.clear()
                with self.assertRaises(RuntimeError): driver.compatible(self.before, self.current)
                self.assertEqual(set(driver.restore_backends(self.backend, self.before)), set(self.apis))
                self.assertEqual(self.reloaded, [(0, True)])
                self.assertTrue(all(driver.sha(item["path"]) == item["beforeSha256"] for item in self.backend))
                self.assertEqual(self.current[0]["status"], "online")
                self.assertGreater(self.current[0]["pid"], 0)
                self.assertEqual(self.current[-1], self.before[-1])

    def test_failed_candidate_reload_recovers_only_its_persisted_original_id(self):
        def fail_once(row, rollback=False):
            if not rollback:
                self.current[row["id"]].update(status="errored", pid=0)
                raise RuntimeError("synthetic owned candidate failure")
            self.reload(row, rollback=True)
        with patch.object(driver, "reload_instance", side_effect=fail_once):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(self.reloaded, [(0, True)])
        self.assertEqual(len(json.loads((self.root / "reload-intents.json").read_text())), 1)
        self.assertFalse(json.loads(self.coord.read_text())["shared_release_active"])
        self.assertEqual(json.loads(self.coord.read_text())["window"]["status"], "failed")
        self.assertTrue(all(driver.sha(item["path"]) == item["beforeSha256"] for item in self.backend))
        self.assertEqual((self.public / "index.html").read_text(), "old html")

    def test_missing_intent_does_not_authorize_unhealthy_target(self):
        self.seed_owned_recovery(ids=())
        (self.root / "reload-intents.json").unlink()
        self.current[0].update(status="errored", pid=0)
        with self.assertRaises(RuntimeError): driver.restore_backends(self.backend, self.before)
        self.assertFalse(self.reloaded)
        self.assertTrue(all(driver.sha(item["path"]) == item["sha256"] for item in self.backend))

    def test_foreign_intent_owner_id_name_hash_and_duplicates_are_refused(self):
        for field, value in (("ownerTask", "foreign-task"), ("id", 1), ("name", "dianzi51-admin"), ("apiHash", "foreign"), ("duplicate", True)):
            with self.subTest(field=field):
                self.seed_owned_recovery()
                self.current[0].update(status="stopped", pid=0)
                intents = json.loads((self.root / "reload-intents.json").read_text())
                if field == "duplicate": intents.append(dict(intents[0]))
                else: intents[0][field] = value
                driver.save(self.root / "reload-intents.json", intents)
                with self.assertRaises(RuntimeError): driver.restore_backends(self.backend, self.before)
                self.assertFalse(self.reloaded)
                self.assertTrue(all(driver.sha(item["path"]) == item["sha256"] for item in self.backend))

    def test_owned_intent_never_bypasses_foreign_identity_or_config(self):
        for field, value in (("id", 20), ("name", "foreign-api"), ("script", "/foreign/api"), ("cwd", "/foreign/cwd"),
            ("environmentHash", "foreign-env"), ("execMode", "fork_mode")):
            with self.subTest(field=field):
                self.seed_owned_recovery()
                self.current = json.loads(json.dumps(self.before))
                self.current[0].update(status="errored", pid=0)
                self.current[0][field] = value
                with self.assertRaises(RuntimeError): driver.restore_backends(self.backend, self.before)
                self.assertFalse(self.reloaded)
                self.assertTrue(all(driver.sha(item["path"]) == item["sha256"] for item in self.backend))

    def test_other_api_without_its_own_intent_cannot_bypass_health(self):
        self.seed_owned_recovery()
        self.current[1].update(status="errored", pid=0)
        with self.assertRaises(RuntimeError): driver.restore_backends(self.backend, self.before)
        self.assertFalse(self.reloaded)
        self.assertTrue(all(driver.sha(item["path"]) == item["sha256"] for item in self.backend))

    def test_independent_worker_drift_blocks_owned_recovery_before_cas(self):
        self.seed_owned_recovery()
        self.current[0].update(status="errored", pid=0)
        self.current[-1]["pid"] += 1
        with self.assertRaises(RuntimeError): driver.restore_backends(self.backend, self.before)
        self.assertFalse(self.reloaded)
        self.assertTrue(all(driver.sha(item["path"]) == item["sha256"] for item in self.backend))

    def test_foreign_api_and_backup_bytes_block_all_restore_writes(self):
        for target in ("api", "backup"):
            with self.subTest(target=target):
                self.seed_owned_recovery()
                self.current[0].update(status="errored", pid=0)
                path = Path(self.apis["dianzi51"]) if target == "api" else self.root / "before-dianzi51.js"
                path.write_text("foreign bytes")
                with self.assertRaises(RuntimeError): driver.restore_backends(self.backend, self.before)
                self.assertFalse(self.reloaded)
                self.assertEqual(path.read_text(), "foreign bytes")
                self.assertEqual(driver.sha(self.apis["dianzi51-admin"]), self.backend[1]["sha256"])

    def test_restore_still_unhealthy_keeps_coord_occupied_and_releases_locks(self):
        def stays_failed(row, rollback=False):
            self.current[row["id"]].update(status="errored", pid=0)
            if not rollback: raise RuntimeError("synthetic candidate failure")
            self.reloaded.append((row["id"], True))
        with patch.object(driver, "reload_instance", side_effect=stays_failed):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(self.reloaded, [(0, True)])
        self.assertEqual(Path(self.apis["dianzi51"]).read_text(), "old dianzi51")
        self.assert_coord_recovery_required()

    def test_restore_exception_keeps_coord_occupied(self):
        def fails(row, rollback=False):
            self.current[row["id"]].update(status="stopped", pid=0)
            raise RuntimeError("synthetic reload failure")
        with patch.object(driver, "reload_instance", side_effect=fails):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assert_coord_recovery_required()

    def test_lost_intent_after_candidate_failure_keeps_coord_occupied(self):
        def loses_intent(row, rollback=False):
            self.current[row["id"]].update(status="launching", pid=0)
            (self.root / "reload-intents.json").unlink()
            raise RuntimeError("synthetic intent loss")
        with patch.object(driver, "reload_instance", side_effect=loses_intent):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(Path(self.apis["dianzi51"]).read_text(), "new dianzi51")
        self.assert_coord_recovery_required()

    def test_foreign_html_after_switch_is_preserved_and_coord_stays_occupied(self):
        def foreign_html(url):
            if (self.public / "index.html").read_text() == "new customer html":
                (self.public / "index.html").write_text("foreign html")
                raise RuntimeError("foreign HTML after switch")
            return self.http(url)
        with patch.object(driver, "get", side_effect=foreign_html):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual((self.public / "index.html").read_text(), "foreign html")
        self.assertTrue(all(driver.sha(item["path"]) == item["beforeSha256"] for item in self.backend))
        self.assert_coord_recovery_required()

    def test_html_restore_write_failure_does_not_skip_api_recovery_or_close_coord(self):
        original_atomic = driver.atomic
        def fails_restore(path, data, mode=None):
            if Path(path) == self.public / "index.html" and data == b"old html":
                raise OSError("synthetic restore write failure")
            original_atomic(path, data, mode)
        def failed_health(url):
            if (self.public / "index.html").read_text() == "new customer html": raise RuntimeError("synthetic health failure")
            return self.http(url)
        with patch.object(driver, "atomic", side_effect=fails_restore), patch.object(driver, "get", side_effect=failed_health):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual((self.public / "index.html").read_text(), "new customer html")
        self.assertTrue(all(driver.sha(item["path"]) == item["beforeSha256"] for item in self.backend))
        self.assert_coord_recovery_required()

    def test_foreign_environment_after_reload_failure_keeps_coord_occupied(self):
        def foreign_environment(row, rollback=False):
            self.current[row["id"]].update(status="errored", pid=0, environmentHash="foreign-env")
            raise RuntimeError("synthetic foreign environment")
        with patch.object(driver, "reload_instance", side_effect=foreign_environment):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(self.current[0]["environmentHash"], "foreign-env")
        self.assertEqual(Path(self.apis["dianzi51"]).read_text(), "new dianzi51")
        self.assert_coord_recovery_required()

    def test_foreign_worker_after_reload_failure_keeps_coord_occupied(self):
        def foreign_worker(row, rollback=False):
            self.current[row["id"]].update(status="stopped", pid=0)
            self.current[-1]["pid"] += 1
            raise RuntimeError("synthetic foreign worker")
        with patch.object(driver, "reload_instance", side_effect=foreign_worker):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(self.current[-1]["pid"], self.before[-1]["pid"] + 1)
        self.assertFalse(self.reloaded)
        self.assert_coord_recovery_required()

    def test_foreign_api_after_reload_failure_keeps_bytes_and_coord_occupied(self):
        def foreign_api(row, rollback=False):
            self.current[row["id"]].update(status="launching", pid=0)
            Path(self.apis[row["name"]]).write_text("foreign API bytes")
            raise RuntimeError("synthetic foreign API")
        with patch.object(driver, "reload_instance", side_effect=foreign_api):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertEqual(Path(self.apis["dianzi51"]).read_text(), "foreign API bytes")
        self.assertFalse(self.reloaded)
        self.assert_coord_recovery_required()

    def test_owned_manual_recovery_from_restored_html_closes_window_only_after_online(self):
        self.seed_owned_recovery()
        (self.root / "index-before.html").write_text("old html")
        self.current[0].update(status="errored", pid=0)
        state = json.loads(self.coord.read_text())
        state.update(shared_release_active=True, window={"owner_task": driver.TASK, "status": "recovery-required",
            "manualRecoveryRequired": True, "recoveryError": "previous failed recovery"})
        driver.save(self.coord, state)
        self.run_driver("--rollback")
        state = json.loads(self.coord.read_text())
        self.assertFalse(state["shared_release_active"])
        self.assertEqual(state["window"]["status"], "rolled-back")
        self.assertFalse(state["window"]["manualRecoveryRequired"])
        self.assertNotIn("recoveryError", state["window"])
        self.assertEqual(self.reloaded, [(0, True)])
        self.assertEqual(self.current[0]["status"], "online")
        self.assertTrue(all(driver.sha(item["path"]) == item["beforeSha256"] for item in self.backend))
        self.assertEqual((self.public / "index.html").read_text(), "old html")

    def test_foreign_coord_window_is_not_replaced_but_recovery_still_blocks_apply(self):
        foreign_window = {"owner_task": "foreign-task", "status": "foreign-state", "preserve": 42}
        def loses_window(row, rollback=False):
            if not rollback:
                self.current[row["id"]].update(status="stopped", pid=0)
                state = json.loads(self.coord.read_text())
                state.update(shared_release_active=False, window=foreign_window)
                driver.save(self.coord, state)
                raise RuntimeError("synthetic coordination loss")
            self.reload(row, rollback=True)
        with patch.object(driver, "reload_instance", side_effect=loses_window):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        state = json.loads(self.coord.read_text())
        self.assertTrue(state["shared_release_active"])
        self.assertEqual(state["window"], foreign_window)
        self.assertEqual(state["recovery_required_windows"][-1]["status"], "recovery-required")
        self.assertEqual(state["recovery_required_windows"][-1]["owner_task"], driver.TASK)

    def test_completed_api_write_interrupted_before_bookkeeping_is_cas_restored(self):
        original_atomic = driver.atomic
        def interrupted(path, data, mode=None):
            original_atomic(path, data, mode)
            if Path(path) == Path(self.apis["dianzi51"]) and data == b"new dianzi51":
                raise RuntimeError("synthetic interruption after atomic install")
        with patch.object(driver, "atomic", side_effect=interrupted):
            with self.assertRaises(SystemExit): self.run_driver("--apply")
        self.assertTrue(all(driver.sha(item["path"]) == item["beforeSha256"] for item in self.backend))
        self.assertFalse(self.reloaded, "no persisted reload intent means no target was reloaded")
        self.assertEqual(json.loads((self.root / "reload-intents.json").read_text()), [])
        self.assertFalse(json.loads(self.coord.read_text())["shared_release_active"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
