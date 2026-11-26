import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedResources } from "@drone/shared";
import { expect, vi } from "vitest";
import type { PackageReplacementHost } from "../src/services/package-replacement";
import { SessionService } from "../src/session-service";

export async function writePiPackage(root: string, version: string, sentinel: string) {
	await mkdir(join(root, "skills", "fixture"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "fixture-extension",
			version,
			pi: { extensions: ["./extension.mjs"], skills: ["./skills"] },
		}),
	);
	await writeFile(
		join(root, "extension.mjs"),
		`export default pi => pi.registerTool({name:'${sentinel}',label:'Fixture',description:'Fixture',parameters:{type:'object'},execute:async()=>({content:[],details:{}})})`,
	);
	await writeFile(
		join(root, "skills", "fixture", "SKILL.md"),
		`---\nname: fixture\ndescription: Fixture\n---\n${sentinel}\n`,
	);
}

export async function sdkPackageFixture(root: string) {
	const agent = join(root, "agent");
	const cwd = join(root, "project");
	const name = "fixture-extension";
	const candidate = join(root, "candidate");
	const installer = join(root, "install.mjs");
	await mkdir(cwd);
	await writePiPackage(join(agent, "npm", "node_modules", name), "1.0.0", "fixture_v1");
	await writePiPackage(candidate, "2.0.0", "fixture_v2");
	await writeFile(
		installer,
		`import {cp,mkdir} from 'node:fs/promises';import {dirname,join} from 'node:path';
const dest=join(process.argv[process.argv.indexOf('--prefix')+1],'node_modules',${JSON.stringify(name)});
await mkdir(dirname(dest),{recursive:true});await cp(${JSON.stringify(candidate)},dest,{recursive:true});`,
	);
	await writeFile(
		join(agent, "settings.json"),
		JSON.stringify({ packages: [`npm:${name}`], npmCommand: [process.execPath, installer] }),
	);
	vi.stubEnv("PI_CODING_AGENT_DIR", agent);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	const backend = new SessionService({ defaultCwd: cwd, projectTrust: false, lazyCapabilities: false });
	const transition = vi.fn();
	const host = {
		inspect: async () => ({ sources: [] }),
		transition: async (_location, _sources, action) => {
			transition();
			return action(false, vi.fn());
		},
		probe: vi.fn(),
		rescan: vi.fn(),
	} satisfies PackageReplacementHost;
	return { backend, name, host, transition, cwd };
}

export function expectSessionPackage(
	resources: LoadedResources,
	currentVersion: string,
	nextSessionVersion?: string | null,
) {
	expect(resources.extensionErrors).toEqual([]);
	expect(resources.packageVersions).toEqual([
		{
			packageName: "fixture-extension",
			scope: "user",
			currentVersion,
			...(nextSessionVersion === undefined ? {} : { nextSessionVersion }),
		},
	]);
	expect(resources.extensions.flatMap(({ tools }) => tools)).toContain(`fixture_v${currentVersion[0]}`);
}

export async function closeWithLifecycleTrace(backend: SessionService, sessionId: string) {
	const directory = backend.requireSession(sessionId).session.sessionManager.getSessionDir();
	if (!directory) throw new Error("The SDK did not create a trace directory");
	await backend.closeSession(sessionId);
	const trace = await readFile(join(directory, "traces", `trace-${sessionId}.jsonl`), "utf8");
	const steps = trace
		.trim()
		.split("\n")
		.map((row) => JSON.parse(row) as { kind?: unknown; data?: unknown })
		.filter(({ kind }) => kind === "package_lifecycle")
		.map(({ data }) => data);
	return { trace, steps };
}
