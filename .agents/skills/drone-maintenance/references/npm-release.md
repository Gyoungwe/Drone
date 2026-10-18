# npm release and rollback runbook

## Preflight

Publishing is a user-authorized mutation. Before it, verify:

```sh
npm whoami --registry=https://registry.npmjs.org
npm profile get --json --registry=https://registry.npmjs.org
git status --short --branch
git -C ../drone-plugins status --short --branch
```

The npm account must use the configured security-key 2FA. Do not paste a password, OTP, access token, or browser callback URL into chat, files, CI logs, or shell history. If npm requests browser/security-key authentication, complete it on the local machine and resume the same command.

## Package order and versioning

The first public order is:

1. `@gyoungwe/plugin-api`
2. `@gyoungwe/pi-core`, `@gyoungwe/pi-knowledge`, `@gyoungwe/pi-research`
3. `@gyoungwe/research-suite`
4. v1.1 packages: `@gyoungwe/pi-analysis`, `@gyoungwe/pi-evidence`, `@gyoungwe/pi-connectors`, then the complete `@gyoungwe/desktop-ui-pack`.

Versions are immutable. Check the registry before publishing, choose a new patch/minor version, and update the root evidence and install examples. The research suite must declare and actually contain its bundled plugin dependencies; workspace symlinks are not release evidence.

## Build, pack, publish

Run the package repository check first:

```sh
cd ../drone-plugins
npm ci
npm run check
```

For a package whose source is still in Drone, run the root package build/check and stage a clean release directory. For `research-suite`, use the host gate because it stages real tarballs and checks the public release shape:

```sh
cd ../Drone
npm ci
npm run build
npm run check:plugin-api
npm run check:pi-compat -- --targets locked,latest
npm run check:research-suite
```

Publish from the clean package directory or tarball selected by the package owner:

```sh
npm publish --access public --registry=https://registry.npmjs.org
```

Do not publish the workspace root, a directory containing symlinked workspace dependencies, or a package whose manifest still points at a local path. `npm publish` must be run once per immutable version, in dependency order.

## Public verification

Immediately after each publish, verify metadata and the actual tarball:

```sh
npm view @gyoungwe/<package>@<version> version dist.tarball dist.integrity dist.shasum --json --registry=https://registry.npmjs.org
npm pack @gyoungwe/<package>@<version> --pack-destination "$TMPDIR/drone-npm-check"
npm install --ignore-scripts --prefix "$TMPDIR/drone-npm-install" "$TMPDIR/drone-npm-check"/*.tgz
```

Inspect the tarball contents, package manifest, bundled dependencies, extension/skill paths, and a clean install smoke. Record tarball URL, integrity, shasum, versions, and the verification result in `docs/releases/<release>-npm-packages.json`. Do not record tokens or session output.

## Failure and rollback

- If a publish command fails before the registry accepts the version, fix the staging directory and retry the same unpublished version only after confirming `npm view` returns 404.
- If the registry accepted a defective version, stop using it, publish a new patch version, and add a deprecation note if the defect affects consumers. Do not delete or overwrite a version as a normal rollback.
- If a public tarball differs from the local expectation, mark the release `BLOCKED`, do not update the plan to PASS, and repair the package metadata/bundling before the next version.
