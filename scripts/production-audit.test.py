#!/usr/bin/env python3
"""Offline regression tests for the provenance collector; no PM2/SSH/DB calls."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("production_audit", Path(__file__).with_name("production-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ProductionAuditTests(unittest.TestCase):
    def test_import_map_and_root_reference(self):
        parser = audit.EntryParser()
        parser.feed('<script type="importmap">{"imports":{"/assets/old.js":"/assets/new.js"}}</script><script src="/assets/old.js"></script>')
        self.assertEqual(parser.maps["/assets/old.js"], "/assets/new.js")
        self.assertIn("/assets/old.js", parser.refs)

    def test_malformed_import_map_does_not_crash(self):
        parser = audit.EntryParser()
        parser.feed('<script type="importmap">invalid</script>')
        self.assertEqual(parser.maps, {})

    def test_non_string_import_map_value_is_ignored(self):
        parser = audit.EntryParser()
        parser.feed('<script type="importmap">{"imports":{"/bad.js":5,"/ok.js":"/new.js"}}</script>')
        self.assertEqual(parser.maps, {"/ok.js": "/new.js"})

    def test_multiple_import_maps_accumulate(self):
        parser = audit.EntryParser()
        parser.feed('<script type="importmap">{"imports":{"/a.js":"/b.js"}}</script><script type="importmap">{"imports":{"/c.js":"/d.js"}}</script>')
        self.assertEqual(parser.maps, {"/a.js": "/b.js", "/c.js": "/d.js"})

    def test_remote_reference_not_followed(self):
        parser = audit.EntryParser()
        parser.feed('<script src="https://remote.invalid/a.js"></script><link href="//remote.invalid/style.css"><script src="/local.js"></script>')
        self.assertEqual(parser.refs, ["/local.js"])

    def test_secret_and_upload_file_types_are_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in (".env", "runtime.env", "secret.key", "upload.pdf"):
                file = Path(directory) / name
                file.write_text("test fixture")
                self.assertFalse(audit.safe_file(file), name)

    def test_runtime_module_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "runtime.mjs"
            file.write_text("export const fixture = true;\n")
            self.assertTrue(audit.safe_file(file))


if __name__ == "__main__":
    unittest.main()
