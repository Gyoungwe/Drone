import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const version = "3.2.1";
const asset = "gyoungwe-plugin-api-3.2.1.tgz";
const script = new URL("release-plugin-api.mjs", import.meta.url);
const workflowDir = new URL("../.github/workflows/", import.meta.url);

function workspace(context) {
	const root = mkdtempSync(join(tmpdir(), "drone-plugin-api-release-test-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const packageDir = join(root, "packages", "plugin-api");
	mkdirSync(join(packageDir, "dist"), { recursive: true });
	mkdirSync(join(root, "scripts"));
	copyFileSync(script, join(root, "scripts", "release-plugin-api.mjs"));
	writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*"] }));
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({
			name: "@gyoungwe/plugin-api",
			version,
			type: "module",
			files: ["dist"],
			exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
		}),
	);
	writeFileSync(join(packageDir, "dist", "index.js"), "export const value = 1;\n");
	writeFileSync(join(packageDir, "dist", "index.d.ts"), "export declare const value: 1;\n");
	return root;
}

function release(root, ...args) {
	return spawnSync(process.execPath, [join(root, "scripts", "release-plugin-api.mjs"), ...args], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, npm_config_cache: join(root, "npm-cache") },
	});
}

function pack(root, directory) {
	const result = release(root, "--expected-version", version, "--out-dir", directory);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

function check(root, directory) {
	return release(root, "--expected-version", version, "--check", "--pack-dir", directory);
}

test("packs identical archives and verifies the exact checksum record after readback", (context) => {
	const root = workspace(context);
	const first = join(root, "first-pack");
	const second = join(root, "second-pack");
	const digest = pack(root, first);
	const archive = readFileSync(join(first, asset));
	assert.equal(digest, createHash("sha256").update(archive).digest("hex"));
	assert.equal(readFileSync(join(first, "SHA256SUMS"), "utf8"), `${digest}  ${asset}\n`);
	assert.equal(pack(root, second), digest);
	assert.deepEqual(readFileSync(join(second, asset)), archive);
	const readback = check(root, second);
	assert.equal(readback.status, 0, readback.stderr);
	assert.equal(readback.stdout.trim(), digest);
});

test("requires the dispatch version to match the package manifest", (context) => {
	const root = workspace(context);
	const match = release(root, "--expected-version", version);
	assert.equal(match.status, 0, match.stderr);
	assert.equal(match.stdout.trim(), version);
	const mismatch = release(root, "--expected-version", "3.2.2", "--out-dir", join(root, "pack"));
	assert.equal(mismatch.status, 1);
	assert.match(mismatch.stderr, /expected version 3\.2\.2.*package version 3\.2\.1/u);
	assert.equal(existsSync(join(root, "pack")), false);
	const prerelease = release(root, "--expected-version", `${version}-rc.1`);
	assert.equal(prerelease.status, 1);
	assert.match(prerelease.stderr, /must be a stable version/u);
});

test("rejects a changed archive and malformed checksum records", (context) => {
	const root = workspace(context);
	const directory = join(root, "pack");
	const digest = pack(root, directory);
	const archive = join(directory, asset);
	const original = readFileSync(archive);
	writeFileSync(archive, Buffer.concat([original, Buffer.from("changed")]));
	const corrupted = check(root, directory);
	assert.equal(corrupted.status, 1);
	assert.match(corrupted.stderr, /SHA256SUMS/u);
	writeFileSync(archive, original);
	for (const checksum of [`${digest}  wrong.tgz\n`, `${digest} ${asset}\n`, `${digest}  ${asset}\n\n`]) {
		writeFileSync(join(directory, "SHA256SUMS"), checksum);
		const malformed = check(root, directory);
		assert.equal(malformed.status, 1);
		assert.match(malformed.stderr, /SHA256SUMS/u);
	}
});

test("rejects a pack that omits a declared export target", (context) => {
	const root = workspace(context);
	rmSync(join(root, "packages", "plugin-api", "dist", "index.d.ts"));
	const result = release(root, "--expected-version", version, "--out-dir", join(root, "pack"));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /missing packed export.*dist\/index\.d\.ts/u);
});

function assertInOrder(script, commands) {
	let offset = 0;
	for (const command of commands) {
		const index = script.indexOf(command, offset);
		assert(index >= 0, `missing or out of order: ${command}`);
		offset = index + command.length;
	}
}

test("dispatches only on protected main and separates build from release authority", () => {
	const source = readFileSync(new URL("publish-plugin-api.yml", workflowDir), "utf8");
	assert.doesNotMatch(source, /id-token:|registry-url:|npm\s+publish\b/u);
	assert.equal(existsSync(new URL("publish-pi-core.yml", workflowDir)), false);
	const workflow = parse(source);
	assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
	assert.equal(workflow.on.workflow_dispatch.inputs.expected_version.required, true);
	assert.equal(workflow.concurrency["cancel-in-progress"], false);
	assert.deepEqual(workflow.permissions, {});
	const { build, release } = workflow.jobs;
	assert.deepEqual(build.permissions, { contents: "read" });
	assert.deepEqual(release.permissions, { contents: "write" });
	assert.equal(build.if, "github.ref == 'refs/heads/main' && github.ref_protected");
	assert.equal(release.needs, "build");
	for (const job of [build, release]) {
		const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
		assert.match(checkout.with.ref, /^\$\{\{ github\.sha \}\}$/u);
		assert.equal(checkout.with["persist-credentials"], false);
	}
	assert(!build.steps.some((step) => step.env?.GH_TOKEN));
	assertInOrder(build.steps.map((step) => step.run).join("\n"), [
		'node scripts/release-plugin-api.mjs --expected-version "$EXPECTED_VERSION"',
		"npm ci",
		"npm run test -w @gyoungwe/plugin-api",
		"node packages/desktop/scripts/gen-plugin-api.mjs --check",
		'--out-dir "$asset_dir"',
		"node scripts/check-plugin-api.mjs --package-only --lifecycle",
		'--release-tarball "$asset_dir/$asset" --sha256 "$sha256"',
	]);
});

test("checks release collisions and verifies the draft readback before publishing", () => {
	const workflow = parse(readFileSync(new URL("publish-plugin-api.yml", workflowDir), "utf8"));
	const writer = workflow.jobs.release.steps.find((step) => step.env?.GH_TOKEN);
	assert.ok(writer, "release writer must use a step-scoped GitHub token");
	assert.match(writer.env.GH_TOKEN, /^\$\{\{ github\.token \}\}$/u);
	assert.match(writer.env.BUILD_SHA256, /^\$\{\{ needs\.build\.outputs\.sha256 \}\}$/u);
	assert.doesNotMatch(writer.run, /--clobber|--force|--latest(?:\s|$)/u);
	assert.deepEqual(writer.run.match(/--latest=\S+/gu), ["--latest=false", "--latest=false"]);
	assert.match(writer.run, /git\/matching-refs\/tags\//u);
	assert.match(writer.run, /gh api --paginate .*\/releases\?per_page=100/u);
	assertInOrder(writer.run, [
		'test "$artifact_sha256" = "$BUILD_SHA256"',
		'tag_ref="$(matching_tag)"',
		'existing_release="$(tagged_release)"',
		'if [[ -n "$tag_ref" || -n "$existing_release" ]]; then',
		'gh release create "$tag"',
		'--target "$GITHUB_SHA" --draft --latest=false',
		'draft="$(tagged_release)"',
		'mktemp -d "$RUNNER_TEMP/plugin-api-readback.XXXXXX"',
		'gh release download "$tag"',
		'--check --pack-dir "$readback"',
		'test "$readback_sha256" = "$BUILD_SHA256"',
		'cmp "$asset_dir/SHA256SUMS" "$readback/SHA256SUMS"',
		'cmp "$asset_dir/$asset" "$readback/$asset"',
		'gh release edit "$tag" --repo "$GITHUB_REPOSITORY" --draft=false --latest=false',
		'published_commit="$(tag_commit)"',
		'test "$published_commit" = "$GITHUB_SHA"',
	]);
});
