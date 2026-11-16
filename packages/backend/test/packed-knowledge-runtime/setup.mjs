import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { discoverInstalledPackages } from "../../../desktop/src/main/ui-plugins/installed-package-sources";
import { SessionRegistry } from "../../src/session/registry";
import { SessionRecordStore } from "../../src/session-engine/session-records";
import { StorageRegistry } from "../../src/storage/registry";
import { declaredPath, run, sha256 } from "./helpers.mjs";

export async function createContext(ctx) {
	if (process.platform === "win32") throw new Error("This artifact census requires a POSIX host with ps");
	ctx.artifact = await realpath(ctx.tarball);
	ctx.root = await realpath(await mkdtemp(join(tmpdir(), "drone-packed-knowledge-")));
	ctx.prefix = join(ctx.root, "installed");
	ctx.state = join(ctx.root, "state");
	ctx.vault = join(ctx.root, "Vault");
	ctx.workspace = join(ctx.root, "WorkspaceMixedCase");
	ctx.cache = join(ctx.root, "cache");
	ctx.leases = join(ctx.root, "leases");
	ctx.agentDir = join(ctx.root, "agent");
	ctx.controlsRoot = join(ctx.root, "effect-controls");
	for (const path of [
		ctx.prefix,
		ctx.state,
		ctx.vault,
		ctx.workspace,
		ctx.cache,
		ctx.leases,
		ctx.agentDir,
		ctx.controlsRoot,
	])
		await mkdir(path);
	ctx.bridge = undefined;
	ctx.bootstrap = undefined;
	ctx.session = undefined;
	ctx.writeSession = undefined;
	ctx.writeBootstrap = undefined;
	ctx.packageRoot = undefined;
	ctx.receipt = undefined;
	ctx.failure = undefined;
	ctx.sqliteReopened = 0;
	ctx.cleanup = [];
	ctx.stage = "clean-install";
	ctx.sessions = new SessionRegistry();
	ctx.records = new SessionRecordStore();
	return ctx;
}

async function installArtifact(ctx) {
	await run(
		"npm",
		[
			"install",
			"--prefix",
			ctx.prefix,
			"--ignore-scripts",
			"--omit=peer",
			"--no-audit",
			"--no-fund",
			"--registry=https://registry.npmjs.org",
			ctx.artifact,
			...(ctx.apiTarball ? [await realpath(ctx.apiTarball)] : []),
		],
		{ maxBuffer: 8 * 1024 * 1024 },
	);
	const lock = JSON.parse(await readFile(join(ctx.prefix, "package-lock.json"), "utf8"));
	const installed = Object.entries(lock.packages).find(
		([path, value]) => path.endsWith("/@gyoungwe/pi-knowledge") && value.resolved?.startsWith("file:"),
	);
	expect(installed, "local tarball must have a clean-install lock receipt").toBeDefined();
	ctx.packageRoot = await realpath(join(ctx.prefix, installed[0]));
	ctx.pkg = JSON.parse(await readFile(join(ctx.packageRoot, "package.json"), "utf8"));
	ctx.manifest = JSON.parse(await readFile(join(ctx.packageRoot, "plugin.manifest.json"), "utf8"));
	const catalog = await discoverInstalledPackages(join(ctx.prefix, "node_modules"));
	const selected = catalog.find((item) => !("error" in item) && item.packageName === ctx.pkg.name);
	expect(selected, JSON.stringify(catalog)).toBeDefined();
	ctx.source = selected.runtime;
	expect(ctx.source.pluginId).toBe(ctx.pkg.name);
	expect(ctx.source.packageRoot).toBe(ctx.packageRoot);
	expect(
		await Promise.all(ctx.pkg.pi.extensions.map((path) => declaredPath(ctx.packageRoot, path))),
	).toContain(ctx.source.nativeEntrypoint);
}

async function writeNotes(ctx) {
	ctx.sharedNote = "Library/Methods/orchid.md";
	ctx.currentNote = "Projects/alpha/Methods/alpha.md";
	ctx.otherNote = "Projects/beta/Methods/beta.md";
	ctx.currentText =
		`# Alpha method\n[[${ctx.sharedNote.slice(0, -3)}]]\n` +
		Array.from({ length: 120 }, (_, index) => `alphasentinel line ${index} ${"a".repeat(90)}`).join("\n");
	for (const directory of ["Library/Methods", "Projects/alpha/Methods", "Projects/beta/Methods"])
		await mkdir(join(ctx.vault, directory), { recursive: true });
	await mkdir(join(ctx.workspace, ".pi"));
	await writeFile(
		join(ctx.workspace, ".pi/research-workspace.json"),
		JSON.stringify({ knowledgeProjectId: "alpha" }),
	);
	await writeFile(
		join(ctx.state, "binding.json"),
		JSON.stringify({
			version: 1,
			vault: ctx.vault,
			vaultId: sha256(ctx.vault).slice(0, 24),
			revision: 1,
			profile: "hybrid",
			depositMode: "verified",
			subagentPolicy: "read-local",
			updatedAt: new Date().toISOString(),
		}),
	);
	await writeFile(
		join(ctx.vault, ctx.sharedNote),
		`# Orchid method\nOrchid assay evidence.\n[[${ctx.currentNote.slice(0, -3)}]]\n[[${ctx.otherNote.slice(0, -3)}]]\n`,
	);
	await writeFile(join(ctx.vault, ctx.currentNote), ctx.currentText);
	await writeFile(
		join(ctx.vault, ctx.otherNote),
		`# Beta method\nprivatebetasentinel\n[[${ctx.sharedNote.slice(0, -3)}]]\n`,
	);
}

async function writeControls(ctx) {
	// Separate negative controls. The installed knowledge artifact remains byte-for-byte untouched.
	ctx.controls = {
		pluginId: "acceptance-effect-controls",
		packageRoot: ctx.controlsRoot,
		entrypoint: join(ctx.controlsRoot, "runtime.mjs"),
		nativeEntrypoint: join(ctx.controlsRoot, "extension.mjs"),
	};
	await writeFile(
		ctx.controls.nativeEntrypoint,
		'throw new Error("control must use managed native loading");',
	);
	await writeFile(
		ctx.controls.entrypoint,
		`export default async()=>{let executed=0;return {
 operations:{count:{inputSchema:{type:"null"},resultSchema:{type:"number"},effect:"read",execute:async()=>executed}},
 createNativeSession:()=>({toolEffects:{effect_probe_write:"write"},extension(pi){for(const name of ["effect_probe_unknown","effect_probe_write"])pi.registerTool({name,label:name,description:"Negative authorization control",drone:{readOnly:true,capabilities:["knowledge"]},parameters:{type:"object",properties:{}},async execute(){executed++;return {content:[{type:"text",text:"unexpected execution"}]};}});},dispose:async()=>{}}),dispose:async()=>{}};};`,
	);
	ctx.sources = new Map([
		["knowledge-artifact", ctx.source],
		["effect-controls", ctx.controls],
	]);
	ctx.approvals = [];
	ctx.grantStateWrite = false;
	ctx.denyStateWrite = false;
	ctx.grantFileWrite = false;
	ctx.denyReviewWrites = false;
	ctx.denyModelGeneration = false;
	ctx.failNextReviewRecord = false;
	ctx.storage = new StorageRegistry().register({
		id: "packed-plugin-state",
		path: ctx.state,
		owner: `plugin:${ctx.source.pluginId}`,
		schema: "plugin-owned",
		sensitivity: "private",
	});
	ctx.stateReceipt = { status: "NOT_DECLARED" };
	ctx.capabilityScopes = [];
}

export async function prepareArtifact(ctx) {
	await installArtifact(ctx);
	await writeNotes(ctx);
	await writeControls(ctx);
}
