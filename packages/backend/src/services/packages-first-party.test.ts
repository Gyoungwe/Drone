import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_PARTY_PACKAGES } from "@drone/shared";
import { expect, it, vi } from "vitest";
import { PackageAdmin } from "../packages/admin";
import {
	createFirstPartyReleaseResolver,
	type FirstPartyReleaseFetcher,
} from "../packages/first-party-releases";
import { SessionRegistry } from "../session/registry";
import type { PackageReplacementHost } from "./package-replacement";
import { PackageService } from "./packages";

const offered = FIRST_PARTY_PACKAGES.find(({ builtIn }) => !builtIn);
const builtin = FIRST_PARTY_PACKAGES.find(({ builtIn }) => builtIn);
if (!offered || !builtin) throw new Error("Expected optional and built-in packages");
const { name } = offered;
const builtinName = builtin.name;
const source = `npm:${name}`;
const prior = { source, autoload: false, extensions: ["+extension.mjs"] };
const catalogUrl = "https://api.github.com/repos/Gyoungwe/drone-plugins/releases";

async function makeRelease(root: string, version: string, routes: Map<string, () => Response>) {
	const directory = await mkdtemp(join(root, "asset-"));
	await mkdir(join(directory, "package"));
	await writeFile(join(directory, "package", "package.json"), JSON.stringify({ name, version }));
	const slug = name.split("/").at(-1);
	const tag = `${slug}-v${version}`;
	const filename = `gyoungwe-${slug}-${version}.tgz`;
	const archive = join(directory, filename);
	execFileSync("tar", ["-czf", archive, "-C", directory, "package"]);
	const bytes = await readFile(archive);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const base = `https://github.com/Gyoungwe/drone-plugins/releases/download/${tag}`;
	const tarball = { name: filename, browser_download_url: `${base}/${filename}`, digest: `sha256:${sha256}` };
	const checksum = { name: "SHA256SUMS", browser_download_url: `${base}/SHA256SUMS` };
	routes.set(tarball.browser_download_url, () => new Response(bytes));
	routes.set(checksum.browser_download_url, () => new Response(`${sha256}  ${filename}\n`));
	return { tag_name: tag, draft: false, prerelease: false, assets: [tarball, checksum], tarball };
}

async function writeNpmFixture(root: string) {
	const command = join(root, "fixture-package-manager.cjs");
	await writeFile(
		command,
		`
const { execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { fileURLToPath } = require("node:url");
const args = process.argv.slice(2);
const spec = args.find((arg) => arg.startsWith(${JSON.stringify(`${name}@file://`)}));
if (!args.includes("install") || !spec) throw new Error("Expected a verified local archive spec");
const root = args[args.indexOf("--prefix") + 1];
const path = join(root, "node_modules", ${JSON.stringify(name)});
mkdirSync(path, { recursive: true });
execFileSync("tar", ["-xzf", fileURLToPath(spec.slice(${name.length + 1})), "--strip-components", "1", "-C", path]);
if (args.includes("--wrong-version")) writeFileSync(join(path, "package.json"), ${JSON.stringify(JSON.stringify({ name, version: "99.0.0" }))});
`,
	);
	return [process.execPath, command];
}

async function fixture(root: string) {
	const agentDir = join(root, "agent profile");
	const live = join(agentDir, "npm", "node_modules", name);
	const settingsPath = join(agentDir, "settings.json");
	const npmPath = join(agentDir, "npm", "package.json");
	const routes = new Map<string, () => Response>();
	const [older, newer] = await Promise.all([
		makeRelease(root, "1.0.0", routes),
		makeRelease(root, "2.0.0", routes),
	]);
	routes.set(catalogUrl, () => Response.json([older, newer]));
	const fetcher = vi.fn<FirstPartyReleaseFetcher>(
		async (url) => routes.get(url)?.() ?? new Response(null, { status: 404 }),
	);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	const firstPartyReleaseResolver = createFirstPartyReleaseResolver(agentDir, { fetcher });
	const admin = new PackageAdmin({
		registry: new SessionRegistry(),
		defaultCwd: root,
		firstPartyReleaseResolver,
	});
	const host = {
		inspect: vi.fn(async () => ({ sources: [] })),
		transition: (_location, _sources, action) => action(false, () => undefined),
		probe: vi.fn(async () => undefined),
		rescan: vi.fn(async () => undefined),
	} satisfies PackageReplacementHost;
	async function configure(entry: string | typeof prior | undefined, wrongVersion = false) {
		await mkdir(live, { recursive: true });
		const npmCommand = await writeNpmFixture(root);
		if (wrongVersion) npmCommand.push("--wrong-version");
		await writeFile(settingsPath, JSON.stringify({ npmCommand, packages: entry ? [entry] : [] }));
		await writeFile(npmPath, JSON.stringify({ dependencies: entry ? { [name]: "0.9.0" } : {} }));
		if (entry) await writeFile(join(live, "package.json"), JSON.stringify({ name, version: "0.9.0" }));
		else await rm(live, { recursive: true });
	}
	const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
	return {
		root,
		live,
		npmPath,
		settingsPath,
		routes,
		newer,
		fetcher,
		admin,
		host,
		configure,
		readJson,
		firstPartyReleaseResolver,
	};
}

function testPackages(label: string, test: (state: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
	it(label, async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-release-service-")));
		try {
			await test(await fixture(root));
		} finally {
			vi.unstubAllEnvs();
			vi.unstubAllGlobals();
			await rm(root, { recursive: true, force: true });
		}
	});
}

testPackages(
	"adopts a legacy SDK entry, persists the file dependency, rolls back and removes it",
	async (state) => {
		await state.configure(prior);
		const installed = await state.admin.updatePackage(name, state.host);
		expect(installed).toMatchObject({ status: "succeeded", previousVersion: "0.9.0", version: "2.0.0" });
		expect(installed.source).toMatch(/^npm:.*@file:\/\//u);
		const dependency = installed.source.slice(`${source}@`.length);
		await expect(state.readJson(state.settingsPath)).resolves.toMatchObject({
			packages: [{ ...prior, source: installed.source }],
		});
		await expect(state.readJson(state.npmPath)).resolves.toMatchObject({
			dependencies: { [name]: dependency },
		});
		await expect(state.readJson(join(state.live, "package.json"))).resolves.toEqual({
			name,
			version: "2.0.0",
		});

		const restored = await state.admin.rollbackPackage(name, "1.0.0", state.host);
		expect(restored).toMatchObject({ status: "succeeded", previousVersion: "2.0.0", version: "1.0.0" });
		expect(restored.events.at(-1)?.type).toBe("rolled_back");
		expect(restored.source).not.toBe(installed.source);
		await expect(state.readJson(state.settingsPath)).resolves.toMatchObject({
			packages: [{ ...prior, source: restored.source }],
		});
		await expect(state.readJson(state.npmPath)).resolves.toMatchObject({
			dependencies: { [name]: restored.source.slice(`${source}@`.length) },
		});
		await expect(state.admin.removePackage(restored.source, "user", state.host)).resolves.toMatchObject({
			status: "succeeded",
		});
		await expect(state.readJson(state.settingsPath)).resolves.toMatchObject({ packages: [] });
		await expect(state.readJson(state.npmPath)).resolves.toMatchObject({ dependencies: {} });
		await expect(access(state.live)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(access(fileURLToPath(dependency))).resolves.toBeUndefined();
	},
);

testPackages(
	"installs a verified archive into the agent cache through the default resolver",
	async (state) => {
		await state.configure(undefined);
		vi.stubGlobal("fetch", state.fetcher);
		const admin = new PackageAdmin({ registry: new SessionRegistry(), defaultCwd: state.root });
		const receipt = await admin.installPackage(name, state.host);
		expect(receipt).toMatchObject({ status: "succeeded", version: "2.0.0" });
		expect(fileURLToPath(receipt.source.slice(`${source}@`.length))).toContain(
			join(state.root, "agent profile", "release-cache"),
		);
		await expect(state.readJson(state.settingsPath)).resolves.toMatchObject({ packages: [receipt.source] });
	},
);

testPackages(
	"keeps the old package and settings when the archive or staged version is wrong",
	async (state) => {
		await state.configure(prior, true);
		const manifestPath = join(state.live, "package.json");
		const before = await Promise.all(
			[state.settingsPath, state.npmPath, manifestPath].map((path) => readFile(path)),
		);
		const archiveUrl = state.newer.tarball.browser_download_url;
		const archive = state.routes.get(archiveUrl);
		if (!archive) throw new Error("Missing fixture tarball");
		state.routes.set(archiveUrl, () => new Response("tampered"));
		await expect(state.admin.updatePackage(name, state.host)).resolves.toMatchObject({
			status: "failed",
			error: { code: "operation-failed" },
		});
		expect(state.host.inspect).not.toHaveBeenCalled();
		state.routes.set(archiveUrl, archive);
		await expect(state.admin.updatePackage(name, state.host)).resolves.toMatchObject({
			status: "failed",
			error: { code: "operation-failed" },
		});
		expect(state.host.rescan).not.toHaveBeenCalled();
		expect(
			await Promise.all([state.settingsPath, state.npmPath, manifestPath].map((path) => readFile(path))),
		).toEqual(before);
		await expect(state.admin.removePackage(source, "user", state.host)).resolves.toMatchObject({
			status: "succeeded",
		});
	},
);

testPackages(
	"rolls back and updates through the legacy manager using only exact file sources",
	async (state) => {
		await state.configure(prior);
		const manager = {
			listConfiguredPackages: () => [{ source, scope: "user" as const }],
			getInstalledPath: () => state.live,
			installAndPersist: vi.fn(async (selected: string) => {
				const archive = fileURLToPath(selected.slice(`${source}@`.length));
				execFileSync("tar", ["-xzf", archive, "--strip-components", "1", "-C", state.live]);
			}),
			update: vi.fn(async () => undefined),
			removeAndPersist: vi.fn(async () => true),
		};
		const service = new PackageService({
			registry: new SessionRegistry(),
			packageManagerFactory: () => manager,
			firstPartyReleaseResolver: state.firstPartyReleaseResolver,
		});
		const update = await service.updatePackage(name);
		const rollback = await service.rollbackPackage(name, "1.0.0");
		expect(update).toMatchObject({ status: "succeeded", version: "2.0.0" });
		expect(rollback).toMatchObject({ status: "succeeded", version: "1.0.0" });
		expect(manager.installAndPersist.mock.calls).toEqual([[update.source], [rollback.source]]);
		expect(manager.update).not.toHaveBeenCalled();
		manager.installAndPersist.mockResolvedValueOnce(undefined);
		await expect(service.rollbackPackage(name, "2.0.0")).resolves.toMatchObject({
			status: "failed",
			error: { code: "operation-failed" },
		});
	},
);

testPackages(
	"fails before creating a manager for unoffered names, missing versions and invalid operations",
	async (state) => {
		const packageManagerFactory = vi.fn(() => {
			throw new Error("Should not start the package manager");
		});
		const service = new PackageService({
			registry: new SessionRegistry(),
			packageManagerFactory,
			firstPartyReleaseResolver: state.firstPartyReleaseResolver,
		});
		await expect(service.installPackage("@gyoungwe/not-in-the-inventory")).resolves.toMatchObject({
			error: { code: "unavailable" },
		});
		await expect(service.updatePackage("@GYOUNGWE/not-in-the-inventory")).resolves.toMatchObject({
			error: { code: "unavailable" },
		});
		await expect(service.installPackage(builtinName)).resolves.toMatchObject({ error: { code: "builtin" } });
		await expect(service.installPackage(`${name}@2.0.0`)).resolves.toMatchObject({
			error: { code: "invalid-source" },
		});
		await expect(service.rollbackPackage(name, "latest")).resolves.toMatchObject({
			error: { code: "invalid-source" },
		});
		expect(state.fetcher).not.toHaveBeenCalled();
		await expect(service.rollbackPackage(name, "3.0.0")).resolves.toMatchObject({
			error: { code: "unavailable" },
		});
		expect(packageManagerFactory).not.toHaveBeenCalled();
	},
);
