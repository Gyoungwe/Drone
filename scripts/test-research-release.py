"""Offline release-gate regression tests; no upstream execution or downloads."""
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

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
        self.source = {"id": "academic", "commit": "fixed", "archiveSha256": "a" * 64, "skills": [{"name": "paper", "path": "paper/SKILL.md"}], "licenseFiles": ["LICENSE", "NOTICE.md"], "runtimeFiles": []}
        files = {}
        for name in ["paper/SKILL.md", "LICENSE", "NOTICE.md"]:
            path = self.root / name
            path.parent.mkdir(exist_ok=True)
            path.write_text("fixture", encoding="utf-8")
            files[name] = hashlib.sha256(b"fixture").hexdigest()
        self.receipt = {"version": 1, "commit": "fixed", "archiveSha256": self.source["archiveSha256"], "skills": self.source["skills"], "layout": "pi-complete-v1", "licenseAuthorization": "separate-permission", "files": files}
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

    def test_receipt_archive_checksum_must_match_lock(self):
        self.receipt["archiveSha256"] = "b" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "missing or stale skill receipt"):
            sync.verify(self.source, self.destination, for_release=True)
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


class ArchiveCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.destination = root / "resources"
        self.cache = root / "cache"
        files = {
            "LICENSE": b"fixture license\n",
            "skills/cache-fixture/SKILL.md": b"# cached skill\n",
        }
        archive_bytes = io.BytesIO()
        with tarfile.open(fileobj=archive_bytes, mode="w:gz") as bundle:
            for relative, contents in files.items():
                member = tarfile.TarInfo(f"fixture-root/{relative}")
                member.size = len(contents)
                member.mtime = 0
                bundle.addfile(member, io.BytesIO(contents))
        archive = archive_bytes.getvalue()
        self.source = {
            "id": "nature",
            "repository": "fixture/repo",
            "commit": "deadbeef",
            "archiveSha256": hashlib.sha256(archive).hexdigest(),
            "license": "Apache-2.0",
            "licenseFiles": ["LICENSE"],
            "skills": [{"name": "cache-fixture", "path": "skills/cache-fixture/SKILL.md", "bundled": True}],
        }
        cached_archive = sync.cache_archive_path(self.source, self.cache)
        cached_archive.parent.mkdir(parents=True)
        cached_archive.write_bytes(archive)
        self.cached_archive = cached_archive

    def test_download_closes_temporary_before_checksum_and_publication(self):
        archive = self.cached_archive.read_bytes()
        self.cached_archive.unlink()
        streams = []
        create_temporary = sync.tempfile.NamedTemporaryFile
        digest = sync.digest
        replace = sync.os.replace

        def tracked_temporary(*args, **kwargs):
            stream = create_temporary(*args, **kwargs)
            streams.append(stream)
            return stream

        def checked_digest(path):
            self.assertTrue(streams[-1].closed)
            return digest(path)

        def checked_replace(source, destination):
            self.assertTrue(streams[-1].closed)
            self.assertFalse(destination.exists())
            replace(source, destination)

        with (
            patch.object(sync.urllib.request, "urlopen", return_value=io.BytesIO(archive)) as download,
            patch.object(sync.tempfile, "NamedTemporaryFile", side_effect=tracked_temporary),
            patch.object(sync, "digest", side_effect=checked_digest),
            patch.object(sync.os, "replace", side_effect=checked_replace),
        ):
            self.assertEqual(sync._download_archive(self.source, self.cache), self.cached_archive)
        self.assertEqual(download.call_count, 1)
        self.assertEqual(download.call_args.args[0].full_url, "https://codeload.github.com/fixture/repo/tar.gz/deadbeef")
        self.assertEqual(self.cached_archive.read_bytes(), archive)
        self.assertEqual([path.resolve() for path in self.cache.iterdir()], [self.cached_archive])

    def test_download_checksum_failure_cleans_temporary_without_publishing(self):
        self.cached_archive.unlink()
        with patch.object(sync.urllib.request, "urlopen", return_value=io.BytesIO(b"unreviewed content")):
            with self.assertRaisesRegex(ValueError, "Archive checksum mismatch"):
                sync._download_archive(self.source, self.cache)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_download_interruption_cleans_temporary_without_publishing(self):
        self.cached_archive.unlink()
        with patch.object(sync.urllib.request, "urlopen", side_effect=OSError("fixture download interrupted")):
            with self.assertRaisesRegex(OSError, "fixture download interrupted"):
                sync._download_archive(self.source, self.cache)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_cache_hit_avoids_network_and_restores_atomically(self):
        original_urlopen = sync.urllib.request.urlopen

        def unexpected_network(*args, **kwargs):
            raise AssertionError("cache hit attempted a network download")

        sync.urllib.request.urlopen = unexpected_network
        try:
            sync.install(self.source, self.destination, cache_dir=self.cache)
        finally:
            sync.urllib.request.urlopen = original_urlopen
        self.assertTrue((self.destination / "nature/.drone-pack.json").is_file())
        self.assertEqual(sync.verify(self.source, self.destination), (1, 2))

    def test_offline_mode_rejects_missing_cache(self):
        self.cached_archive.unlink()
        with self.assertRaisesRegex(ValueError, "Offline mode requires a verified cached archive"):
            sync.install(self.source, self.destination, cache_dir=self.cache, offline=True)
        self.assertFalse(self.destination.exists())
        self.assertFalse((self.destination / "nature").exists())

    def test_corrupt_cache_is_rejected_without_network_fallback(self):
        self.cached_archive.write_bytes(b"tampered")
        original_urlopen = sync.urllib.request.urlopen

        def unexpected_network(*args, **kwargs):
            raise AssertionError("corrupt cache must not trigger a network replacement")

        sync.urllib.request.urlopen = unexpected_network
        try:
            with self.assertRaisesRegex(ValueError, "Cached archive checksum mismatch"):
                sync.install(self.source, self.destination, cache_dir=self.cache)
        finally:
            sync.urllib.request.urlopen = original_urlopen
        self.assertFalse((self.destination / "nature").exists())

if __name__ == "__main__": unittest.main(verbosity=2)
