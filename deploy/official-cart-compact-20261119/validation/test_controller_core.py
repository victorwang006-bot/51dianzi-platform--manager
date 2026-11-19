#!/usr/bin/env python3
"""Offline only: real CAS in private temporary fixtures; no prod observations/calls."""
import copy
from dataclasses import replace
import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("controller_core", Path(__file__).with_name("controller_core.py"))
c = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = c
spec.loader.exec_module(c)


class OfflineControllerTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="controller-offline-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.fs = c.OfflineFiles(self.root)
        self.before, self.after, self.owned = b"full-before\n", b"reviewed-after\n", b"owned-coordinate\n"
        self.fs.create("target", self.before)
        self.fs.create("coord", self.owned)
        self.active = c.canonical({"enabled": True, "ownerTask": c.OWNER, "nonce": "a" * 32})
        self.disabled = c.canonical({"enabled": False, "ownerTask": c.OWNER, "nonce": "a" * 32})

    def recover(self, **extra):
        return c.recover_owned(self.fs, target="target", before=self.before, after=self.after,
                               coord="coord", owned_coord=self.owned, marker="failclosed", **extra)

    def test_01_exact_cas_preserves_metadata_and_refuses_production_scope(self):
        path = self.root / "target"
        path.chmod(0o640)
        old = path.stat()
        self.fs.cas("target", self.before, self.after)
        new = path.stat()
        self.assertEqual(path.read_bytes(), self.after)
        self.assertEqual((stat.S_IMODE(new.st_mode), new.st_uid, new.st_gid), (0o640, old.st_uid, old.st_gid))
        for root in ("/opt", "/home/ubuntu/work/cart-compact-20261119/validation"):
            with self.subTest(root=root), self.assertRaisesRegex(RuntimeError, "FIXTURE_ROOT"):
                c.OfflineFiles(root)
        for name in ("../escape", "/opt/ops/anything", "nested/file"):
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "FILE_SCOPE"):
                self.fs.cas(name, self.before, self.after)
        (self.root / "link").symlink_to(path)
        with self.assertRaisesRegex(RuntimeError, "FILE_SCOPE"):
            self.fs.read("link")

    def test_02_initial_and_last_cas_reject_foreign_bytes(self):
        with self.assertRaisesRegex(RuntimeError, "FULL_BYTE_CAS"):
            self.fs.cas("target", b"stale", self.after)
        self.assertEqual(self.fs.read("target"), self.before)
        real_read = self.fs.read
        calls = []
        def drift(name):
            if name == "target":
                calls.append(1)
                if len(calls) == 2:
                    (self.root / name).write_bytes(b"foreign-before-replace")
            return real_read(name)
        with patch.object(self.fs, "read", side_effect=drift):
            with self.assertRaisesRegex(RuntimeError, "LAST_FULL_BYTE_CAS"):
                self.fs.cas("target", self.before, self.after)
        self.assertEqual(real_read("target"), b"foreign-before-replace")
        self.assertFalse(list(self.root.glob(".controller-cas-*")))

    def test_03_postrename_fsync_is_owned_commit_and_diagnostics_cannot_block_restore(self):
        with patch.object(self.fs, "syncdir", side_effect=OSError("injected directory fsync")):
            with self.assertRaises(OSError):
                self.fs.cas("target", self.before, self.after)
        self.assertEqual(c.observed_state(self.fs, "target", self.before, self.after), "owned-after")
        def broken_log(result):
            raise OSError("injected unavailable diagnostics")
        result = self.recover(diagnostic=broken_log)
        self.assertTrue(result["codeRollback"])
        self.assertTrue(result["markerWritten"])
        self.assertIn("DIAGNOSTIC_FAILURE", result["errors"])
        self.assertEqual(self.fs.read("target"), self.before)

    def test_04_foreign_coord_or_target_never_overwritten(self):
        for foreign in ("coord", "target"):
            with self.subTest(foreign=foreign):
                (self.root / "target").write_bytes(self.after)
                (self.root / "coord").write_bytes(self.owned)
                (self.root / foreign).write_bytes(b"foreign-writer")
                result = self.recover()
                self.assertFalse(result["codeRollback"])
                self.assertEqual(self.fs.read(foreign), b"foreign-writer")
                if foreign == "coord":
                    self.assertEqual(self.fs.read("target"), self.after)

    def test_05_activation_attempt_bars_rollback_even_after_disable(self):
        self.fs.cas("target", self.before, self.after)
        self.fs.create("flag", self.active)
        result = self.recover(flag="flag", owned_flag=self.active, disabled_flag=self.disabled,
                              activation_attempted=True)
        self.assertTrue(result["flagDisabled"])
        self.assertFalse(result["codeRollback"])
        self.assertEqual(self.fs.read("target"), self.after)
        self.assertEqual(self.fs.read("flag"), self.disabled)
        self.assertIn("POST_ACTIVATION_CODE_RETAINED", result["errors"])
        # Disabled flag alone does NOT prove that no new customer order was possible.
        result = self.recover(flag="flag", owned_flag=self.active, disabled_flag=self.disabled,
                              activation_attempted=True)
        self.assertFalse(result["codeRollback"])
        (self.root / "flag").write_bytes(self.active)
        result = self.recover(flag="flag", owned_flag=self.active, disabled_flag=self.disabled,
                              activation_attempted=False)
        self.assertFalse(result["codeRollback"])  # Visible active flag latches possible exposure.
        self.assertEqual(self.fs.read("target"), self.after)

    def test_06_flag_partial_commit_marker_and_log_failure_remain_failclosed(self):
        self.fs.cas("target", self.before, self.after)
        self.fs.create("flag", self.active)
        real_cas = self.fs.cas
        def fault(name, before, after):
            real_cas(name, before, after)
            if name == "flag":
                raise OSError("disable committed then directory fsync failed")
        with patch.object(self.fs, "cas", side_effect=fault), \
             patch.object(self.fs, "create", side_effect=OSError("marker disk full")):
            result = self.recover(flag="flag", owned_flag=self.active, disabled_flag=self.disabled,
                                  activation_attempted=True, diagnostic=lambda _: 1 / 0)
        self.assertTrue(result["flagDisabled"])
        self.assertFalse(result["codeRollback"])
        self.assertEqual(self.fs.read("target"), self.after)
        self.assertIn("FAILCLOSED_MARKER_FAILURE", result["errors"])
        self.assertIn("DIAGNOSTIC_FAILURE", result["errors"])
        (self.root / "flag").write_bytes(b"foreign-new-flag")
        result = self.recover(flag="flag", owned_flag=self.active, disabled_flag=self.disabled,
                              activation_attempted=True)
        self.assertEqual(self.fs.read("flag"), b"foreign-new-flag")
        self.assertIn("FOREIGN_FLAG_UNTOUCHED", result["errors"])

    def test_07_exact_four_transients_only_and_all_user_config_preserved(self):
        env = {"env": {"DATABASE_URL": "fixture-only", "business_rule": "keep", "NODE_ENV": "production"},
               "JWT_SECRET": "fixture-only", "CUSTOM_SETTING": "keep", "NODE_ENV": "production"}
        original = c.config_hash(env)
        encoded = {"env": dict(env["env"]), "topEnv": {k: v for k, v in env.items() if k.isupper()}}
        self.assertEqual(original, c.H(json.dumps(encoded, sort_keys=True, separators=(",", ":")).encode()))
        unicode_env = copy.deepcopy(env)
        unicode_env["env"]["business_rule"] = "测试配置"
        encoded["env"]["business_rule"] = "测试配置"
        self.assertEqual(c.config_hash(unicode_env), c.H(json.dumps(encoded, sort_keys=True, separators=(",", ":")).encode()))
        for key in c.VOLATILE:
            changed = copy.deepcopy(env)
            changed[key] = "generated-new"
            changed["env"][key] = "generated-new"
            self.assertEqual(c.config_hash(changed), original)
        for key in ("DATABASE_URL", "business_rule", "ALIPAY_ENABLED", "PATH", "NODE_ENV", "NODE_OPTIONS"):
            changed = copy.deepcopy(env)
            changed["env"][key] = "changed"
            self.assertNotEqual(c.config_hash(changed), original)
        for key in ("JWT_SECRET", "CUSTOM_SETTING", "DATABASE_URL", "NODE_OPTIONS", "PATH"):
            changed = copy.deepcopy(env)
            changed[key] = "changed"
            self.assertNotEqual(c.config_hash(changed), original)

    def processes(self):
        ids = (0, 190, 191, 192, 193, 194, 200, 201, 202, 203, 204, 205)
        return [dict(id=i, name="dianzi51" if i in (190, 193, 194, 200) else "other",
                     pid=1000 + i, status="online", script="/fixed", cwd="/fixed", mode="cluster",
                     configSha256="config" + str(i), actualUserSha256="actual" + str(i),
                     rawEnvSha256="real-proc-raw" + str(i)) for i in ids]

    def test_08_static_all_twelve_raw_exact_and_reload_only_five_actual_user_stable(self):
        before = self.processes()
        after = copy.deepcopy(before)
        self.assertTrue(c.compare_processes(before, after))
        for row in after:
            if row["id"] in c.RELOAD_IDS:
                row["pid"] += 10000
                row["rawEnvSha256"] += "new-pm2-embedded-metadata"
        with self.assertRaisesRegex(RuntimeError, "DRIFT"):
            c.compare_processes(before, after)  # Static scope has zero reload allowance.
        self.assertTrue(c.compare_processes(before, after, c.RELOAD_IDS))
        for pid, key in ((191, "pid"), (204, "rawEnvSha256"), (190, "configSha256"),
                         (190, "actualUserSha256"), (203, "actualUserSha256")):
            changed = copy.deepcopy(after)
            row = next(x for x in changed if x["id"] == pid)
            row[key] = row[key] + 1 if key == "pid" else "foreign-config"
            with self.subTest(pid=pid, key=key), self.assertRaisesRegex(RuntimeError, "DRIFT"):
                c.compare_processes(before, changed, c.RELOAD_IDS)

        # Separate adapter for ACTUAL protection-initial schema, not fake raw hashes.
        captured = [{k: row[k] for k in ("id", "name", "pid", "status", "script", "cwd")} |
                    {"envHash": c.H(row["configSha256"].encode())} for row in before]
        for row in captured:
            if row["id"] in (190, 193, 194, 200):
                row["name"] = "dianzi51"
                row["script"] = "/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js"
            elif row["id"] == 203:
                row["name"] = "dianzi51-refund"
                row["script"] = "/opt/releases/20261018-multi-enterprise-v1/web/dist/refundWorker.js"
        result = c.compare_captured_processes(captured, copy.deepcopy(captured))
        self.assertFalse(result["rawEnvironVerified"])
        changed = copy.deepcopy(captured)
        for row in changed:
            if row["id"] in c.RELOAD_IDS:
                row["pid"] += 100
        with self.assertRaisesRegex(RuntimeError, "DRIFT"):
            c.compare_captured_processes(captured, changed)
        with self.assertRaisesRegex(RuntimeError, "STATIC_ZERO_RELOAD"):
            c.compare_captured_processes(captured, changed, reloaded_ids=c.RELOAD_IDS)
        result = c.compare_captured_processes(captured, changed, stage="api", reloaded_ids=c.RELOAD_IDS)
        self.assertFalse(result["actualUserConfigVerified"])
        with self.assertRaisesRegex(RuntimeError, "DRIFT"):
            c.compare_captured_processes(captured, changed, stage="api")  # No implicit target allowance.
        changed[-1]["pid"] += 1
        with self.assertRaisesRegex(RuntimeError, "DRIFT"):
            c.compare_captured_processes(captured, changed, stage="api", reloaded_ids=c.RELOAD_IDS)

    def manifest(self):
        package = {"new-runtime.mjs": b"export const fixture=true;", "declarations.json": b"{}"}
        targets = [{"path": "/opt/releases/known/front/runtime/fixture.mjs", "beforeSha256": None,
                    "afterSha256": c.H(package["new-runtime.mjs"]), "packageFile": "new-runtime.mjs"}]
        m = dict(schemaVersion=1, ownerTask=c.OWNER, scope=c.SCOPE, mode="local-plan-only",
                 controllerSha256="1" * 64, sourceDeclarationSha256=c.H(package["declarations.json"]),
                 newModuleSha256=c.H(package["new-runtime.mjs"]),
                 reviewSha256="4" * 64, captureSha256="5" * 64, readinessFile=c.NEW_FLAG,
                 stageCanonical="/data/archive/backups/known-fixture-stage", reloadIds=list(c.RELOAD_IDS),
                 packageFiles={k: c.H(v) for k, v in package.items()}, targets=targets)
        raw = c.canonical(m)
        seal = c.ScopeSeal(c.H(raw), "1" * 64, m["sourceDeclarationSha256"], m["newModuleSha256"], "4" * 64, "5" * 64,
                           c.H(c.canonical(targets)), tuple(m["packageFiles"].items()), m["stageCanonical"], c.RELOAD_IDS)
        return m, raw, package, seal

    def test_09_sealed_package_closed_scope_rejects_manifest_self_authorization(self):
        m, raw, package, seal = self.manifest()
        result = c.validate_sealed(raw, package, seal)
        self.assertFalse(result["productionReady"])
        for mutate in (lambda x: x.update(command="sh arbitrary"),
                       lambda x: x.update(ownerTask="old-owner"),
                       lambda x: x.update(readinessFile=c.OLD_FLAG),
                       lambda x: x["targets"][0].update(path="/opt/releases/foreign/root.js"),
                       lambda x: x.update(reloadIds=[191]),
                       lambda x: x.update(stageCanonical="/data/archive/backups/foreign")):
            changed = copy.deepcopy(m)
            mutate(changed)
            changed_raw = c.canonical(changed)
            # Even repinning the manifest hash does NOT expand the independently sealed scope.
            with self.subTest(mutate=mutate), self.assertRaises(RuntimeError):
                c.validate_sealed(changed_raw, package, replace(seal, manifest_sha256=c.H(changed_raw)))
        for changed in ({**package, "unlisted.py": b"arbitrary"},
                        {**package, "new-runtime.mjs": b"foreign"}):
            with self.assertRaises(RuntimeError):
                c.validate_sealed(raw, changed, seal)
        with self.assertRaisesRegex(RuntimeError, "DUPLICATE_JSON"):
            c.decode(b'{"a":1,"a":2}')

    def proof(self):
        pins = dict(manifestSha256="1" * 64, runtimeSha256="2" * 64,
                    configFileSha256="3" * 64, sourceDeclarationSha256="4" * 64)
        w = dict(owner_task=c.OWNER, scope=c.SCOPE, nonce="a" * 32, status="verified",
                 closedAtUtc="2026-11-19T00:00:00Z", needsOperatorRecovery=False, **pins)
        coord = dict(shared_release_active=False, window=w, window_history=[copy.deepcopy(w)])
        args = dict(nonce="a" * 32, manifest_sha256="1" * 64, module_sha256="2" * 64,
                    config_sha256="3" * 64, declaration_sha256="4" * 64,
                    gates={key: True for key in c.GATES})
        return coord, args

    def test_10_no_activation_payload_without_own_exact_closed_history_and_all_gates(self):
        coord, args = self.proof()
        raw = c.canonical(coord)
        result = c.readiness_payload(raw, expected_closed_sha256=c.H(raw), **args)
        self.assertTrue(result["enabled"])
        self.assertEqual(result["proofMode"], "local-plan-only-not-activation")
        for mutate in (lambda x: x.update(shared_release_active=True),
                       lambda x: x.update(window_history=[]),
                       lambda x: x["window"].update(owner_task="foreign"),
                       lambda x: x["window"].update(status="recovery-required"),
                       lambda x: x["window"].update(configFileSha256="9" * 64),
                       lambda x: x["window_history"][0].update(nonce="b" * 32),
                       lambda x: x["window_history"].append(copy.deepcopy(x["window"]))):
            changed = copy.deepcopy(coord)
            mutate(changed)
            changed_raw = c.canonical(changed)
            with self.subTest(mutate=mutate), self.assertRaises(RuntimeError):
                c.readiness_payload(changed_raw, expected_closed_sha256=c.H(changed_raw), **args)
        for gate in c.GATES:
            changed = copy.deepcopy(args)
            changed["gates"][gate] = False
            with self.subTest(gate=gate), self.assertRaisesRegex(RuntimeError, "ALL_VERIFIED_GATES"):
                c.readiness_payload(raw, expected_closed_sha256=c.H(raw), **changed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
