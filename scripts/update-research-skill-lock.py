#!/usr/bin/env python3
"""Refresh the pinned built-in research skill sources from their upstream main branches.

This updates only the source commit and archive checksum. A changed skill inventory is
reported as a review gate instead of being silently added to the release bundle. The
generated resources remain gitignored and are rebuilt by the normal release workflow.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "packages/shared/src/research-skill-sources.json"
MAX_ARCHIVE = 350 * 1024 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def request_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "Drone-research-skills-updater/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Unexpected GitHub response: {url}")
    return value


def download_archive(source: dict, commit: str, destination: Path) -> str:
    url = f"https://codeload.github.com/{source['repository']}/tar.gz/{commit}"
    request = urllib.request.Request(url, headers={"User-Agent": "Drone-research-skills-updater/1"})
    total = 0
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > MAX_ARCHIVE:
                raise ValueError(f"{source['id']}: archive exceeds size limit")
            output.write(block)
    return sha256(destination)


def archive_skill_paths(archive: Path) -> set[str]:
    paths: set[str] = set()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            parts = PurePosixPath(member.name).parts
            if len(parts) >= 3 and parts[0] and parts[1] == "skills" and parts[-1] == "SKILL.md":
                paths.add("/".join(parts[1:]))
    return paths


def refresh(source: dict, write_lock: bool) -> bool:
    branch = source.get("branch", "main")
    response = request_json(f"https://api.github.com/repos/{source['repository']}/commits/{branch}")
    commit = response.get("sha")
    if not isinstance(commit, str) or len(commit) != 40:
        raise ValueError(f"{source['id']}: GitHub did not return a full commit SHA")
    if commit == source["commit"]:
        print(f"{source['id']}: already current at {commit[:12]}")
        return False

    with tempfile.TemporaryDirectory(prefix=f"drone-{source['id']}-") as temporary:
        archive = Path(temporary) / "source.tar.gz"
        archive_sha = download_archive(source, commit, archive)
        actual = archive_skill_paths(archive)
    expected = {skill["path"] for skill in source["skills"] if skill.get("bundled")}
    missing = sorted(expected - actual)
    additions = sorted(actual - expected)
    if missing or additions:
        details = []
        if missing:
            details.append(f"removed skills: {', '.join(missing[:8])}")
        if additions:
            details.append(f"new skills: {', '.join(additions[:8])}")
        raise ValueError(f"{source['id']}: skill inventory changed; review the lock manually ({'; '.join(details)})")

    print(f"{source['id']}: {source['commit'][:12]} -> {commit[:12]} ({archive_sha})")
    if write_lock:
        source["commit"] = commit
        source["archiveSha256"] = archive_sha
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", nargs="+", choices=("nature", "scientific"), default=("nature", "scientific"))
    parser.add_argument("--write-lock", action="store_true", help="write the reviewed commit/checksum changes to the source lock")
    args = parser.parse_args()

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    changed = False
    for source in lock["sources"]:
        if source["id"] in args.sources:
            changed = refresh(source, args.write_lock) or changed
    if changed and args.write_lock:
        LOCK.write_text(json.dumps(lock, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
        print(f"Updated {LOCK}")
    elif changed:
        print("Updates are available; rerun with --write-lock to persist them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
