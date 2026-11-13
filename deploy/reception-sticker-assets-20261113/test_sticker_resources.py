#!/usr/bin/env python3
"""Resource-only tests; all write tests run in a disposable temporary directory."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest

import verify_sticker_resources as audit


class StickerResourceTests(unittest.TestCase):
    def test_actual_manager_manifest_and_catalog(self):
        manifest = json.loads((audit.HERE / "manifest.json").read_text())
        result = audit.verify(manifest, audit.DEFAULT_TARGET)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["missing"], 0)
        self.assertEqual(result["catalogStickerCount"], 156)
        self.assertEqual(result["referenceCoverage"]["src"], 156)
        self.assertEqual(result["referenceCoverage"]["thumb"], 156)
        self.assertEqual(result["referenceCoverage"]["tab"], 4)
        self.assertEqual(result["uniquePublicCatalogUrls"], 159)
        self.assertEqual(result["bundledModuleFiles"], 16)

    def test_manifest_hash_fields_and_full_directory_retention(self):
        manifest = json.loads((audit.HERE / "manifest.json").read_text())
        self.assertLess(manifest["summary"]["publicBytes"], 20_000_000)
        for row in manifest["resources"]:
            self.assertTrue(Path(row["sourcePath"]).is_file())
            self.assertEqual(row["url"], "/" + row["targetRelative"])
            self.assertGreater(row["bytes"], 0)
            self.assertRegex(row["sha256"], r"^[a-f0-9]{64}$")
        source_root = audit.DEFAULT_SOURCE / "client/public"
        actual_source = {p.relative_to(source_root).as_posix() for name in audit.PUBLIC_DIRS for p in (source_root / name).rglob("*") if p.is_file()}
        self.assertEqual(actual_source, {r["targetRelative"] for r in manifest["resources"]})

    def test_empty_html_and_wrong_image_signature_rejected(self):
        for data in (b"", b"<!DOCTYPE html><html><body>404</body></html>", b"<html>SPA fallback</html>", b"not an image"):
            with self.subTest(data=data), self.assertRaises(ValueError):
                audit.image_check(Path("test.png"), data)
        with self.assertRaises(ValueError):
            audit.image_check(Path("test.svg"), b"<html>not svg</html>")

    def test_copy_never_overwrites_conflict_and_detects_missing(self):
        with tempfile.TemporaryDirectory(prefix="sticker-resource-tests-") as tmp:
            target = Path(tmp) / "manager"
            target.mkdir()
            shutil.copyfile(audit.DEFAULT_TARGET / "vite.config.ts", target / "vite.config.ts")
            module_relative = Path("client/src/business/platform/client/src/assets/stickers")
            shutil.copytree(audit.DEFAULT_TARGET / module_relative, target / module_relative)
            public = target / "client/public"
            public.mkdir(parents=True)
            source_public = audit.DEFAULT_SOURCE / "client/public"
            conflict_path = public / "chat-stickers/emoji-smile.png"
            conflict_path.parent.mkdir()
            different_bytes = (source_public / "chat-stickers/emoji-laugh.png").read_bytes()
            conflict_path.write_bytes(different_bytes)
            same_path = public / "chat-stickers/emoji-joy.png"
            same_path.write_bytes((source_public / "chat-stickers/emoji-joy.png").read_bytes())
            manifest = audit.copy_resources(audit.DEFAULT_SOURCE, target, Path(tmp) / "manifest.json")
            self.assertEqual(conflict_path.read_bytes(), different_bytes)
            self.assertEqual(manifest["summary"]["conflicts"], 1)
            self.assertEqual(manifest["summary"]["alreadyIdentical"], 1)
            self.assertEqual(manifest["conflicts"][0]["url"], "/chat-stickers/emoji-smile.png")
            report = audit.verify(manifest, target)
            self.assertFalse(report["ok"])
            self.assertEqual(report["hashMismatchCount"], 1)
            (public / "chat-sticker-tabs/emoji.png").unlink()
            report = audit.verify(manifest, target)
            self.assertEqual(report["missing"], 1)
            self.assertIn("/chat-sticker-tabs/emoji.png", report["missingResources"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
