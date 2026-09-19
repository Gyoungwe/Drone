#!/usr/bin/env python3
"""Acquire pinned upstream skill DATA; never run upstream installers, hooks or scripts.
Python 3.10+. Default packs: Nature + license-filtered Scientific. ARS acquisition requires explicit permission; the release profile includes all three.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'packages/shared/src/research-skill-sources.json'
DEST = ROOT / 'packages/desktop/resources/research-skills'
MAX_ARCHIVE = 350 * 1024 * 1024
MAX_EXTRACTED = 150 * 1024 * 1024


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def selected_skills(source, acknowledge=False):
    if source['id'] == 'academic':
        if not acknowledge:
            raise ValueError('ARS requires --acknowledge-noncommercial or --acknowledge-commercial-permission. The latter records your existing separate permission; it does not grant a license or authorize redistribution.')
        return source['skills']
    return [skill for skill in source['skills'] if skill['bundled']]


def verify(source, destination, acknowledge=False, for_release=False):
    root = destination / source['id']
    receipt = json.loads((root / '.drone-pack.json').read_text(encoding='utf-8'))
    skills = selected_skills(source, acknowledge or receipt.get('licenseAuthorization') in ('noncommercial', 'separate-permission'))
    expected = [{'name': skill['name'], 'path': skill['path']} for skill in skills]
    if receipt.get('version') != 1 or receipt.get('commit') != source['commit'] or receipt.get('skills') != expected:
        raise ValueError(f"{source['id']}: missing or stale skill receipt; run skills:sync")
    if source['id'] == 'academic' and (receipt.get('layout') != 'pi-complete-v1' or receipt.get('licenseAuthorization') not in ('noncommercial', 'separate-permission')):
        raise ValueError('ARS Pi layout or license authorization missing')
    if for_release and source['id'] == 'academic' and receipt.get('licenseAuthorization') != 'separate-permission':
        raise ValueError('ARS release requires separately held redistribution permission; a noncommercial/local acknowledgment is insufficient')
    hashes = receipt.get('files', {})
    for item in expected:
        if item['path'] not in hashes:
            raise ValueError(f"Missing hash for {item['path']}")
    for license_file in source['licenseFiles']:
        if license_file not in hashes:
            raise ValueError(f'Missing license: {license_file}')
    for relative, expected_hash in hashes.items():
        relative_path = PurePosixPath(relative)
        if relative_path.is_absolute() or '..' in relative_path.parts or '\\' in relative or ':' in relative:
            raise ValueError('Unsafe receipt path')
        path = root.joinpath(*relative_path.parts)
        if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink() or not path.is_file() or digest(path) != expected_hash:
            raise ValueError(f'Changed/missing upstream file: {relative}')
    if for_release:
        # Only immutable, receipted source files may leave this checkout.
        actual_files = set()
        canonical_root = root.resolve()
        for path in root.rglob('*'):
            rel = path.relative_to(root)
            if path.is_symlink() or path.resolve() != canonical_root / rel:
                raise ValueError(f'Redirected release resource: {rel}')
            if path.is_file():
                actual_files.add(rel.as_posix())
        extras = actual_files - (set(hashes) | {'.drone-pack.json'})
        if extras:
            raise ValueError(f'Unreceipted release files: {sorted(extras)}')
    for runtime_file in source.get('runtimeFiles', []):
        if hashes.get(runtime_file['path']) != runtime_file['sha256']:
            raise ValueError(f"Unpinned ARS runtime: {runtime_file['path']}")
    return len(expected), len(hashes)


def install(source, destination, acknowledge=False, commercial_permission=False):
    acknowledge = acknowledge or commercial_permission
    selected = selected_skills(source, acknowledge)
    prefixes = [str(PurePosixPath(skill['path']).parent) + '/' for skill in selected]
    if source['id'] == 'academic':
        # Full ordinary-file repository, not a hand-picked subset. Registration remains explicit.
        prefixes = ['']
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / source['id']
    if target.exists():
        try:
            count, files = verify(source, destination, acknowledge)
            print(f"{source['id']}: already verified, {count} skills / {files} files")
            return
        except (ValueError, OSError, KeyError):
            raise ValueError(f'{target} exists but is modified or stale. Move it aside explicitly before syncing; no local edits will be overwritten.')
    with tempfile.TemporaryDirectory(prefix='.skill-stage-', dir=destination) as temporary:
        stage = Path(temporary)
        archive = stage / 'source.tar.gz'
        url = f"https://codeload.github.com/{source['repository']}/tar.gz/{source['commit']}"
        print(f"Downloading {source['id']} @ {source['commit'][:12]}", flush=True)
        request = urllib.request.Request(url, headers={'User-Agent': 'Drone-research-skills/1'})
        total = 0
        with urllib.request.urlopen(request, timeout=90) as response, archive.open('wb') as output:
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > MAX_ARCHIVE:
                    raise ValueError('Archive exceeds size limit')
                output.write(block)
        if digest(archive) != source['archiveSha256']:
            raise ValueError('Archive checksum mismatch; refuse unreviewed upstream content')
        payload = stage / 'payload'
        payload.mkdir()
        extracted = 0
        hashes = {}
        seen = set()
        with tarfile.open(archive, 'r:gz') as bundle:
            for member in bundle:
                parts = PurePosixPath(member.name).parts
                if not parts or '..' in parts or member.name.startswith('/') or '\\' in member.name or ':' in member.name:
                    raise ValueError('Unsafe archive path')
                relative = '/'.join(parts[1:])
                included = relative in source['licenseFiles'] or any(relative.startswith(prefix) for prefix in prefixes)
                # The host never discovers .claude configuration, commands or extensions here.
                if source['id'] == 'academic' and relative == '.claude/CLAUDE.md':
                    included = True  # referenced documentation only, NOT an agent config path
                if not included or member.isdir():
                    continue
                if source['id'] == 'academic' and member.issym() and relative in {
                    'skills/deep-research', 'skills/academic-paper', 'skills/academic-paper-reviewer', 'skills/academic-pipeline'
                } and member.linkname == '../' + relative.split('/')[-1]:
                    # The Pi manifests use the real root trees. Omit only these redundant facade
                    # symlinks for Windows portability; no executable/config resources are registered.
                    continue
                if not member.isfile():
                    raise ValueError(f'Non-regular file refused: {relative}')
                if relative.casefold() in seen:
                    raise ValueError(f'Duplicate/case-colliding archive path: {relative}')
                seen.add(relative.casefold())
                extracted += member.size
                if member.size > 32 * 1024 * 1024 or extracted > MAX_EXTRACTED:
                    raise ValueError('Extracted files exceed size limit')
                path = payload.joinpath(*PurePosixPath(relative).parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as input_stream, path.open('wb') as output:
                    shutil.copyfileobj(input_stream, output)
                hashes[relative] = digest(path)
        receipt = {
            'version': 1, 'source': source['id'], 'repository': source['repository'],
            'commit': source['commit'], 'archiveSha256': source['archiveSha256'],
            'license': source['license'], 'noncommercialAcknowledged': source['id'] == 'academic' and acknowledge and not commercial_permission,
            'licenseAuthorization': ('separate-permission' if commercial_permission else 'noncommercial') if source['id'] == 'academic' else 'source-license',
            'layout': 'pi-complete-v1' if source['id'] == 'academic' else 'skills-v1',
            'skills': [{'name': skill['name'], 'path': skill['path']} for skill in selected],
            'files': hashes,
        }
        for required in source['licenseFiles'] + [skill['path'] for skill in selected]:
            if required not in hashes:
                raise ValueError(f'Missing required file in pinned archive: {required}')
        for runtime_file in source.get('runtimeFiles', []):
            if hashes.get(runtime_file['path']) != runtime_file['sha256']:
                raise ValueError(f"Runtime integrity mismatch: {runtime_file['path']}")
        (payload / '.drone-pack.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.rename(payload, target)  # publish the complete staged source, never a partial download
    count, files = verify(source, destination, acknowledge)
    print(f"{source['id']}: verified {count} skills / {files} files; upstream code was not executed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', nargs='+', choices=['nature', 'scientific', 'academic'], default=['nature', 'scientific'])
    authorization = parser.add_mutually_exclusive_group()
    authorization.add_argument('--acknowledge-noncommercial', action='store_true')
    authorization.add_argument('--acknowledge-commercial-permission', action='store_true', help='Attest that separate permission already covers this local use; not a redistribution authorization')
    parser.add_argument('--check', action='store_true', help='Offline checksum validation; no downloads or writes')
    parser.add_argument('--for-release', action='store_true', help='Verify all release sources; require separate ARS permission. This does not grant rights.')
    args = parser.parse_args()
    if args.for_release and (not args.check or set(args.sources) != {'nature', 'scientific', 'academic'}):
        parser.error('--for-release requires --check --sources nature scientific academic')
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    for source in lock['sources']:
        if source['id'] not in args.sources:
            continue
        if args.check:
            count, files = verify(source, DEST, args.acknowledge_noncommercial, args.for_release)
            print(f"{source['id']}: OK ({count} skills, {files} files)")
        else:
            install(source, DEST, args.acknowledge_noncommercial, args.acknowledge_commercial_permission)


if __name__ == '__main__':
    main()
