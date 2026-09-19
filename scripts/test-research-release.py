"""Offline release-gate regression tests; no upstream execution or downloads."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("sync_skills", Path(__file__).with_name("sync-research-skills.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.destination = Path(self.temporary.name)
        self.root = self.destination / "academic"
        self.root.mkdir()
        self.source = {"id": "academic", "commit": "fixed", "skills": [{"name": "paper", "path": "paper/SKILL.md"}], "licenseFiles": ["LICENSE", "NOTICE.md"], "runtimeFiles": []}
        files = {}
        for name in ["paper/SKILL.md", "LICENSE", "NOTICE.md"]:
            path = self.root / name
            path.parent.mkdir(exist_ok=True)
            path.write_text("fixture", encoding="utf-8")
            files[name] = hashlib.sha256(b"fixture").hexdigest()
        self.receipt = {"version": 1, "commit": "fixed", "skills": self.source["skills"], "layout": "pi-complete-v1", "licenseAuthorization": "separate-permission", "files": files}
        self.save()
    def save(self):
        (self.root / ".drone-pack.json").write_text(json.dumps(self.receipt), encoding="utf-8")
    def test_separate_permission_passes(self):
        self.assertEqual(sync.verify(self.source, self.destination, for_release=True), (1, 3))
    def test_noncommercial_is_a_release_basis(self):
        self.receipt["licenseAuthorization"] = "noncommercial"
        self.save()
        self.assertEqual(sync.verify(self.source, self.destination), (1, 3))
        self.assertEqual(sync.verify(self.source, self.destination, for_release=True), (1, 3))
    def test_no_acknowledgment_fails(self):
        self.receipt["licenseAuthorization"] = ""
        self.save()
        with self.assertRaisesRegex(ValueError, "ARS requires --acknowledge"):
            sync.verify(self.source, self.destination, for_release=True)
        with self.assertRaisesRegex(ValueError, "ARS requires --acknowledge"):
            sync.verify(self.source, self.destination)
    def test_unreceipted_file_cannot_ship(self):
        (self.root / ".env").write_text("fixture-not-a-real-secret", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unreceipted release files"):
            sync.verify(self.source, self.destination, for_release=True)
    def test_missing_pack_fails(self):
        (self.root / ".drone-pack.json").unlink()
        with self.assertRaises(OSError): sync.verify(self.source, self.destination, for_release=True)
    def test_modified_file_fails(self):
        (self.root / "paper/SKILL.md").write_text("changed", encoding="utf-8")
        with self.assertRaises(ValueError): sync.verify(self.source, self.destination, for_release=True)
    def test_missing_notice_fails(self):
        del self.receipt["files"]["NOTICE.md"]
        self.save()
        with self.assertRaisesRegex(ValueError, "Missing license"):
            sync.verify(self.source, self.destination, for_release=True)
    def test_cannot_check_partial_release(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("sync-research-skills.py")), "--check", "--sources", "academic", "--for-release"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires --check --sources", result.stderr)
    def test_cannot_install_as_release_check(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("sync-research-skills.py")), "--sources", "nature", "scientific", "academic", "--for-release"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires --check --sources", result.stderr)

if __name__ == "__main__": unittest.main(verbosity=2)
