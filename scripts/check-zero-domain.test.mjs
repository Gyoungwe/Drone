import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectZeroDomainFindings, compareToBaseline } from "./check-zero-domain.mjs";

const baselinePath = "scripts/fixtures/zero-domain-baseline.json";
const emptyBaseline = {
	lockEntries: [],
	builtinEntries: [],
	hostDependencies: [],
	hostSourceImports: [],
	hostCatalogEntries: [],
	builderResources: [],
	rootScripts: [],
	domainIpcChannels: [],
};

function fixture(context, baseline = emptyBaseline) {
	const root = mkdtempSync(join(tmpdir(), "drone-zero-domain-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (file, text) => {
		const path = join(root, file);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	};
	write(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	for (const file of ["check-zero-domain.mjs", "is-main-module.mjs"]) {
		copyFileSync(new URL(file, import.meta.url), join(root, "scripts", file));
	}
	mkdirSync(join(root, "node_modules"));
	symlinkSync(
		fileURLToPath(new URL(".", import.meta.resolve("typescript/package.json"))),
		join(root, "node_modules/typescript"),
		"junction",
	);
	const run = (...args) =>
		spawnSync(process.execPath, ["scripts/check-zero-domain.mjs", ...args], { cwd: root, encoding: "utf8" });
	return { root, write, run, readBaseline: () => readFileSync(join(root, baselinePath)) };
}

function writeDomainManifests(write) {
	write(
		"plugins.lock.json",
		JSON.stringify({
			plugins: [
				{ name: "@gyoungwe/pi-research", builtin: true },
				{ name: "@gyoungwe/pi-core", builtin: false },
			],
		}),
	);
	write(
		"package.json",
		JSON.stringify({
			devDependencies: { "@gyoungwe/pi-core": "1", "@gyoungwe/pi-core-extra": "1" },
			scripts: {
				prepare: "npm run fetch:plugins",
				build: "npm run build:pi-research",
				"build:core": "node scripts/prepare.mjs && npm run build:pi-core",
				"verify:runtime": "npm run check:knowledge-runtime",
				"verify:core": "npm run check:pi-core",
				"verify:research": "npm run check:pi-research",
				"verify:builtin": "npm run check:builtin-plugins",
				unrelated: "npm run check:pi-core-extra",
			},
		}),
	);
	write(
		"packages/host/package.json",
		JSON.stringify({
			dependencies: { "@drone/extensions": "1", "@drone/research": "1", "@drone/compute": "1" },
			devDependencies: { "@drone/extensions": "1", "@gyoungwe/pi-analysis": "1" },
		}),
	);
}

function writeDomainSeams(write) {
	write(
		"packages/host/src/entry.mts",
		`import "@gyoungwe/pi-knowledge/host";
const key = '@gyoungwe/pi-knowledge';
const other = \`@gyoungwe/pi-core\`;
const unrelated = "@gyoungwe/pi-analysis-extra";`,
	);
	for (const path of ["entry.test.ts", "test/nested.ts", "dist/entry.ts", "out/entry.ts"]) {
		write(`packages/host/src/${path}`, 'import "@gyoungwe/pi-analysis/host";');
	}
	write(
		"packages/desktop/electron-builder.yml",
		`beforePack: "../../scripts/verify-research-release.cjs"
extraResources:
  - from: "../../.pi/extensions"
  - from: '../../.pi/skills/research-vault'
  - from: resources/research-workbench # bundled
  - from: resources/compute-runner
otherResources:
  - from: "../../vendor/plugins/outside"
mac:
  extraResources:
    - from: ../../vendor/plugins/knowledge
    - from: plugin-packages/node_modules
`,
	);
	write(
		"packages/shared/src/ipc.ts",
		`export const IpcChannels = {
	KnowledgeRead: "knowledge:read",
	ResearchSearch: 'research:search',
	ZoteroStatus: "zotero:status",
	AnalysisRun: "analysis:run",
	EvidenceReplay: "evidence:replay",
	DiscoveryList: "discovery:list",
	InquiryList: "inquiry:list",
	ComputeStatus: "compute:status",
};`,
	);
}

test("inventories every category, without including host-owned or test seams", (context) => {
	const { root, write } = fixture(context);
	writeDomainManifests(write);
	writeDomainSeams(write);
	assert.deepEqual(collectZeroDomainFindings(root), {
		lockEntries: ["@gyoungwe/pi-core", "@gyoungwe/pi-research"],
		builtinEntries: ["@gyoungwe/pi-research"],
		hostDependencies: [
			"package.json:@gyoungwe/pi-core",
			"packages/host/package.json:@drone/extensions",
			"packages/host/package.json:@drone/research",
			"packages/host/package.json:@gyoungwe/pi-analysis",
		],
		hostSourceImports: [
			"packages/host/src/entry.mts:@gyoungwe/pi-core",
			"packages/host/src/entry.mts:@gyoungwe/pi-knowledge",
		],
		hostCatalogEntries: [],
		builderResources: [
			"../../.pi/extensions",
			"../../.pi/skills/research-vault",
			"../../vendor/plugins/knowledge",
			"beforePack:../../scripts/verify-research-release.cjs",
			"plugin-packages/node_modules",
			"resources/research-workbench",
		],
		rootScripts: [
			"build",
			"build:core",
			"prepare",
			"verify:builtin",
			"verify:core",
			"verify:research",
			"verify:runtime",
		],
		domainIpcChannels: [
			"analysis:run",
			"discovery:list",
			"evidence:replay",
			"inquiry:list",
			"knowledge:read",
			"research:search",
			"zotero:status",
		],
	});
});

test("a new host import fails the CLI check", (context) => {
	const { write, run } = fixture(context);
	write("packages/backend/src/new.ts", 'import "@gyoungwe/pi-core/host";');
	const result = run();
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /hostSourceImports: packages\/backend\/src\/new\.ts:@gyoungwe\/pi-core/);
});

test("a new domain IPC channel fails the CLI check", (context) => {
	const { write, run } = fixture(context);
	write("packages/shared/src/ipc.ts", 'export const IpcChannels = { EvidenceList: "evidence:list" };');
	const result = run();
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /domainIpcChannels: evidence:list/);
});

test("moving IPC channels to a host API contract preserves the channel inventory", (context) => {
	const { root, write } = fixture(context);
	const ipc = "packages/shared/src/ipc.ts";
	write(ipc, 'export const IpcChannels = { EvidenceList: "evidence:list" };');
	write(
		"packages/shared/src/host-api/evidence.ts",
		`export const EvidenceContract = defineDomain("evidence", {
	methods: { list: listSchema },
	events: { "replay-finished": replaySchema },
});`,
	);
	const channels = ["evidence:list", "evidence:replay-finished"];
	assert.deepEqual(collectZeroDomainFindings(root).domainIpcChannels, channels);
	write(ipc, "");
	assert.deepEqual(collectZeroDomainFindings(root).domainIpcChannels, channels);
});

test("new domain IPC channels in host API files fail the CLI check", (context) => {
	const { write, run } = fixture(context);
	write(
		"packages/shared/src/host-api/research.ts",
		`export const legacyChannel = "research:legacy";
export const ResearchContract = defineDomain("research", {
	methods: { search: searchSchema },
	events: { searchFinished: searchFinishedSchema },
});`,
	);
	const result = run();
	assert.equal(result.status, 1, result.stderr);
	for (const channel of ["research:legacy", "research:search", "research:searchFinished"]) {
		assert(result.stderr.split("\n").includes(`New domainIpcChannels: ${channel}`));
	}
});

test("a removed lock entry is reported as fixed and can be ratcheted down", (context) => {
	const { root, write, run, readBaseline } = fixture(context, {
		...emptyBaseline,
		lockEntries: ["@gyoungwe/pi-core", "@gyoungwe/pi-research"],
	});
	write("plugins.lock.json", JSON.stringify({ plugins: [{ name: "@gyoungwe/pi-research" }] }));
	const result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout + result.stderr, /fixed, run with --update/);
	assert.match(result.stdout + result.stderr, /lockEntries: @gyoungwe\/pi-core/);
	assert.equal(JSON.parse(result.stdout).status, "PARTIAL");
	const update = run("--update");
	assert.equal(update.status, 0, update.stderr);
	const updatedBaseline = { ...emptyBaseline, lockEntries: ["@gyoungwe/pi-research"] };
	assert.deepEqual(JSON.parse(readBaseline()), updatedBaseline);
	assert.deepEqual(compareToBaseline(collectZeroDomainFindings(root), updatedBaseline), {
		added: emptyBaseline,
		removed: emptyBaseline,
	});
});

test("--update refuses a new key even if another key disappeared, without writing", (context) => {
	const { write, run, readBaseline } = fixture(context, {
		...emptyBaseline,
		lockEntries: ["@gyoungwe/pi-core"],
	});
	const before = readBaseline();
	write("plugins.lock.json", JSON.stringify({ plugins: [{ name: "@gyoungwe/pi-analysis" }] }));
	const result = run("--update");
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /lockEntries: @gyoungwe\/pi-analysis/);
	assert.deepEqual(readBaseline(), before);
});

test("a test file importing a domain package is ignored", (context) => {
	const { write, run } = fixture(context);
	write("packages/backend/src/entry.test.mjs", 'import "@gyoungwe/pi-core/host";');
	const result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).counts.hostSourceImports, 0);
});

test("an empty tree reports ZERO with all counts present", (context) => {
	const { run } = fixture(context);
	const result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		status: "ZERO",
		counts: {
			lockEntries: 0,
			builtinEntries: 0,
			hostDependencies: 0,
			hostSourceImports: 0,
			hostCatalogEntries: 0,
			builderResources: 0,
			rootScripts: 0,
			domainIpcChannels: 0,
		},
	});
});

test("a first-party package the host has not imported yet is still ratcheted", (context) => {
	const { write, run } = fixture(context);
	write("packages/backend/src/new.ts", 'import "@gyoungwe/pi-evidence/host";');
	const result = run();
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /hostSourceImports: packages\/backend\/src\/new\.ts:@gyoungwe\/pi-evidence/);
});

test("a research-flavoured IPC channel is ratcheted even when its prefix is not `research`", (context) => {
	const { write, run } = fixture(context);
	write("packages/shared/src/ipc.ts", 'export const IpcChannels = { Skills: "researchSkills:update" };');
	const result = run();
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /domainIpcChannels: researchSkills:update/);
});

test("a package the host offers through its catalog is ratcheted too", (context) => {
	const { write, run } = fixture(context);
	write(
		"packages/shared/resources/first-party-packages.json",
		JSON.stringify({ packages: [{ name: "@gyoungwe/pi-evidence" }] }),
	);
	const result = run();
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /hostCatalogEntries: @gyoungwe\/pi-evidence/);
});
