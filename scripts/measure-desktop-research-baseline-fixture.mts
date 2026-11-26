import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Type } from "typebox";
import { containedRealPath, type DesktopScenario, type FixtureIdentity, fixtureIdentities,
	validateDesktopScenario, validateFixtureIdentity } from "./measure-desktop-research-baseline-contract.mts";
import { checked, readJson, sha256 } from "./research-baseline-io.mts";

const repo = resolve(import.meta.dirname, "..");
const skillFiles = ["SKILL.md", "references/answer-shape.md", "references/research-design.md",
	"references/delivery-and-explainers.md", "references/wiki-maintenance.md", "references/evidence-loop.md",
	"references/interruption-budget.md", "references/claims-and-recovery.md", "references/knowledge-specialists.md"];
const archiveNames = ["winterglass-first.md", "winterglass-second.md"] as const;
const text = Type.String({ minLength: 1 }), count = Type.Integer({ minimum: 0 });
const manifestSchema = Type.Object({ version: Type.Literal(1), run_dir: text, updated_at: text,
	items: Type.Array(Type.Object({ id: text, path: text, size_bytes: count, sha256: text,
		status: Type.Literal("downloaded"), acquisition: Type.Literal("fixture-copy") }, { additionalProperties: false }), { minItems: 2, maxItems: 2 }) }, { additionalProperties: false });

export async function prepareDesktopFixture(sandbox: string, scenario: DesktopScenario) {
	// Reuse the trust-boundary validator before creating even a partial fixture.
	const selected = validateDesktopScenario(scenario);
	const root = await realpath(sandbox);
	if ((await readdir(root)).length) throw new Error("Fixture sandbox must be empty");
	const paths = { root, workspace: join(root, "workspace"), vault: join(root, "Vault"), app: join(root, "app"),
		home: join(root, "home"), agentDir: join(root, "agent"), tmp: join(root, "tmp"),
		config: join(root, "config"), cache: join(root, "cache"), data: join(root, "data") };
	for (const path of Object.values(paths).filter((path) => path !== root)) await mkdir(path);
	const resultsRoot = join(paths.workspace, "results");
	await mkdir(resultsRoot);
	await mkdir(join(paths.workspace, ".pi"));
	await writeFile(join(paths.workspace, ".pi/research-workspace.json"), `${JSON.stringify({ resultsRoot, knowledgeProjectId: "baseline-project" })}\n`, { flag: "wx" });
	for (const [path, body] of Object.entries(selected.files)) {
		const base = path.startsWith("vault/") ? paths.vault : paths.workspace;
		const target = join(base, path.startsWith("vault/") ? path.slice(6) : path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, body, { flag: "wx" });
		if (await readFile(target, "utf8") !== body) throw new Error("Fixture file read-back mismatch");
	}
	const skillRoot = join(paths.agentDir, "skills/research-workflow");
	const resources = [];
	for (const name of skillFiles) {
		const bytes = await readFile(join(repo, ".pi/skills/research-workflow", name)), path = join(skillRoot, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes, { flag: "wx" });
		if (sha256(await readFile(path)) !== sha256(bytes)) throw new Error("Skill copy read-back mismatch");
		resources.push({ path, sha256: sha256(bytes) });
	}
	const archives = archiveNames.flatMap((name) => {
		const body = selected.files[`sources/archive/${name}`];
		return body === undefined ? [] : [Object.freeze({ name, sha256: sha256(body), size_bytes: Buffer.byteLength(body) })];
	});
	return { ...paths, resultsRoot, skillPath: join(skillRoot, "SKILL.md"), resources,
		archives: Object.freeze(archives), identities: fixtureIdentities(selected), scenario: structuredClone(selected) };
}
export type DesktopFixture = Awaited<ReturnType<typeof prepareDesktopFixture>>;

type SetupRequest = { fixture: DesktopFixture; toolName: "research_setup_obsidian";
	input: { path: string; project: "baseline-project"; profile: "hybrid"; deposit_mode: "verified"; subagent_mcp: "none" } };
type SetupReceipt = { vault: string; project: string; bindingRevision: number; indexReady: boolean };
export type DesktopSetupRunner = (request: SetupRequest) => Promise<SetupReceipt>;

// Ticket B owns the separate SDK setup session, confirmation callback, binding read-back,
// public getKnowledgeService reconciliation and disposal. No handwritten binding is seeded here.
export async function setupDesktopFixture(fixture: DesktopFixture, runSetup?: DesktopSetupRunner) {
	if (!runSetup) throw new Error("Ticket B must supply the unmeasured SDK setup runner");
	const receipt = await runSetup({ fixture, toolName: "research_setup_obsidian", input: { path: fixture.vault,
		project: "baseline-project", profile: "hybrid", deposit_mode: "verified", subagent_mcp: "none" } });
	if (receipt.vault !== fixture.vault || receipt.project !== "baseline-project" ||
		!Number.isSafeInteger(receipt.bindingRevision) || receipt.bindingRevision < 1 || receipt.indexReady !== true) {
		throw new Error("Invalid SDK setup binding/project/index read-back");
	}
	return { ...receipt, setupConsent: "synthetic-unmeasured" as const };
}

export async function assertFixtureIdentity(fixture: DesktopFixture, identity: FixtureIdentity,
	read?: { hash: string; bindingRevision: number }, bindingRevision?: number) {
	if (read && bindingRevision !== read.bindingRevision) throw new Error("Binding revision changed after read");
	validateFixtureIdentity(fixture.scenario, identity);
	const path = await containedRealPath(fixture.vault, join(fixture.vault, identity.note_path)), bytes = await readFile(path);
	if (read && sha256(bytes) !== read.hash) throw new Error("Source bytes changed after read");
	validateFixtureIdentity({ ...fixture.scenario, files: { ...fixture.scenario.files, [`vault/${identity.note_path}`]: bytes.toString("utf8") } }, identity);
}

async function archiveDirectory(run: string) {
	await mkdir(join(run, "sources"), { recursive: true });
	const sources = await containedRealPath(run, join(run, "sources"));
	await mkdir(join(sources, "archive"), { recursive: true });
	return containedRealPath(sources, join(sources, "archive"));
}

export async function acquireFixtureArchive(fixture: DesktopFixture, runDir: string, query: string) {
	const run = await containedRealPath(fixture.resultsRoot, runDir);
	if (fixture.scenario.id !== "deep-research" || query !== "winterglass calibration") throw new Error("Invalid fixture acquisition query");
	if (fixture.archives.length !== 2) throw new Error("Missing synthetic archive data");
	const archive = await archiveDirectory(run), items = [];
	for (const original of fixture.archives) {
		const source = await containedRealPath(fixture.workspace, join(fixture.workspace, "sources/archive", original.name));
		const bytes = await readFile(source);
		if (sha256(bytes) !== original.sha256 || bytes.byteLength !== original.size_bytes) throw new Error("Fixture archive bytes changed");
		const path = join(archive, original.name);
		await writeFile(path, bytes, { flag: "wx" });
		items.push({ id: original.name.slice(0, -3), path, size_bytes: bytes.byteLength, sha256: sha256(bytes),
			status: "downloaded" as const, acquisition: "fixture-copy" as const });
	}
	const manifest = { version: 1, run_dir: run, updated_at: new Date().toISOString(), items };
	await writeFile(join(run, "sources/download-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
	await assertFixtureArchive(fixture, run);
	return { acquisition: "fixture-copy" as const, run_dir: run,
		archiveFirstPath: join(archive, archiveNames[0]), archiveSecondPath: join(archive, archiveNames[1]) };
}

export async function assertFixtureArchive(fixture: DesktopFixture, runDir: string) {
	const run = await containedRealPath(fixture.resultsRoot, runDir);
	const sources = await containedRealPath(run, join(run, "sources"));
	const path = await containedRealPath(sources, join(sources, "download-manifest.json"));
	const manifest = checked(manifestSchema, await readJson(path), "fixture archive manifest");
	if (manifest.run_dir !== run || fixture.archives.length !== 2) throw new Error("Invalid archive run path");
	for (const [index, item] of manifest.items.entries()) {
		const original = fixture.archives[index];
		if (!original || item.path !== join(sources, "archive", original.name)) throw new Error("Invalid archive path");
		const target = await containedRealPath(sources, item.path), bytes = await readFile(target);
		if (item.sha256 !== original.sha256 || sha256(bytes) !== original.sha256) throw new Error("Archive bytes/hash mismatch");
		if (item.size_bytes !== original.size_bytes || bytes.byteLength !== original.size_bytes) throw new Error("Archive size mismatch");
	}
	return manifest;
}

export async function assertFixtureRead(fixture: DesktopFixture, path: string, runDir?: string) {
	const resource = fixture.resources.find((item) => item.path === path);
	if (resource) {
		await containedRealPath(fixture.agentDir, path);
		if (sha256(await readFile(path)) !== resource.sha256) throw new Error("Pinned skill bytes changed");
		return;
	}
	if (!runDir) throw new Error("Raw read requires a current run archive path");
	const manifest = await assertFixtureArchive(fixture, runDir);
	if (!manifest.items.some((item) => item.path === path)) throw new Error("Raw read outside current synthetic archive");
}

export function installFixtureFetch(identities: readonly FixtureIdentity[]) {
	const original = globalThis.fetch, responses = new Map<string, object>();
	for (const identity of identities) {
		const url = `http://127.0.0.1:23119/api/users/0/items/${identity.zotero_key}`;
		responses.set(url, { data: { DOI: identity.doi } }); responses.set(`${url}/children`, []);
	}
	const violations: { reason: string }[] = [];
	const guarded: typeof fetch = async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const method = init?.method ?? (input instanceof Request ? input.method : "GET");
		const body = responses.get(url);
		if (method !== "GET" || init?.body != null || body === undefined) {
			violations.push({ reason: "forbidden-fetch" });
			throw new Error("Fixture fetch forbidden");
		}
		return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
	};
	globalThis.fetch = guarded;
	return { violations, restore: () => { globalThis.fetch = original; },
		assertClean: () => { if (violations.length) throw new Error("Fixture fetch forbidden requests observed"); } };
}
