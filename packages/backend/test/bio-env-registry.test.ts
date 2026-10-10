import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	canonicalTool,
	emptyRegistry,
	findReusable,
	loadRegistry,
	parseVerifyOutput,
	registryPath,
	remoteVerifyScript,
	upsertEnv,
	verifyArgv,
} from "../src/tools/bio/env-registry";
import { type BioEnvironment, formatEnvironment, parseRemoteProbe } from "../src/tools/bio/environment";
import { ENVIRONMENT_WORKFLOW } from "../src/tools/bio/extension";
import {
	defaultShell,
	formatPlatform,
	osName,
	parseNvidiaSmi,
	parseUname,
	platformLine,
} from "../src/tools/bio/platform";
import { makeEnvRegistryTool } from "../src/tools/bio/registry-tool";

const dirs: string[] = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function agentDir() {
	const d = await mkdtemp(join(tmpdir(), "drone-envreg-"));
	dirs.push(d);
	return d;
}
const call = async (tool: ReturnType<typeof makeEnvRegistryTool>, input: Record<string, unknown>) => {
	const r: any = await tool.execute("id", input as any, undefined as any, undefined as any, undefined as any);
	return { text: r.content[0].text as string, envs: r.details.envs as any[] };
};
/** fake `mamba run -n env tool --version`: tools listed are installed */
const fakeLocal = (installed: Record<string, string>) => async (argv: string[]) => {
	const tool = argv[4] ?? "";
	return installed[tool]
		? { code: 0, output: `${tool} v${installed[tool]}` }
		: { code: 1, output: "not found" };
};

describe("platform detection", () => {
	it("maps OS names and default shells", () => {
		expect(osName("win32")).toBe("windows");
		expect(osName("darwin")).toBe("macos");
		expect(osName("Linux")).toBe("linux");
		expect(osName("MINGW64_NT-10.0")).toBe("windows");
		expect(defaultShell("win32", { PSModulePath: "C:\\x" })).toBe("powershell");
		expect(defaultShell("win32", { MSYSTEM: "MINGW64" })).toMatch(/bash/);
		expect(defaultShell("linux", { SHELL: "/usr/bin/zsh" })).toBe("zsh");
	});
	it("parses nvidia-smi and uname", () => {
		expect(parseNvidiaSmi("NVIDIA GeForce RTX 3080, 10240 MiB, 560.94\n")).toEqual([
			{ name: "NVIDIA GeForce RTX 3080", memoryGb: 10, driver: "560.94" },
		]);
		expect(parseNvidiaSmi("NVIDIA-SMI has failed because it couldn't communicate")).toEqual([]);
		expect(parseUname("Linux 5.15.0-91-generic x86_64")).toEqual({
			os: "linux",
			release: "5.15.0-91-generic",
			arch: "x86_64",
		});
	});
	it("remote probe output carries platform, WSL and GPU", () => {
		const env = parseRemoteProbe(
			"hpc",
			["uname\tLinux 5.15 x86_64", "shell\tbash", "gpu\tNVIDIA A100, 81920 MiB, 535.1", "cpus\t64"].join(
				"\n",
			),
		);
		expect(env.platform).toMatchObject({ os: "linux", arch: "x86_64", shell: "bash" });
		expect(env.platform?.gpus[0]).toMatchObject({ name: "NVIDIA A100", memoryGb: 80 });
		expect(formatPlatform(env.platform!)).toMatch(
			/linux 5\.15 x86_64; shell bash; no WSL; GPU: NVIDIA A100 \(80 GB\)/,
		);
	});
	it("injects a compact platform line and the environment workflow", () => {
		expect(platformLine("win32", { PSModulePath: "x" })).toMatch(
			/^Host platform: windows .* default shell powershell.*WSL/,
		);
		expect(ENVIRONMENT_WORKFLOW).toMatch(
			/find \+ verify[\s\S]*record[\s\S]*host=<alias>[\s\S]*never passwords/,
		);
	});
});

describe("environment registry", () => {
	it("reuses an env recorded in an earlier session (new tool instance, same agent dir)", async () => {
		const dir = await agentDir();
		const installed = { mafft: "7.526", iqtree2: "2.3.6", FastTree: "2.1.11" };
		const session1 = makeEnvRegistryTool({
			agentDir: dir,
			verifyLocal: fakeLocal(installed),
			now: () => "2026-10-08T01:00:00Z",
		});
		const recorded = await call(session1, {
			action: "record",
			name: "phylogeny",
			manager: "mamba",
			tools: ["mafft", "iqtree2", "FastTree"],
			purpose: "DHX16 trees",
		});
		expect(recorded.envs[0]).toMatchObject({ status: "ok", tools: { mafft: "7.526", iqtree2: "2.3.6" } });
		const file = JSON.parse(await readFile(registryPath(dir), "utf8"));
		expect(file).toMatchObject({ kind: "drone.bio.environment-registry", version: 1, scope: "agent" });
		expect(file.data.envs[0]).toMatchObject({ name: "phylogeny", host: "local", manager: "mamba" });

		const session2 = makeEnvRegistryTool({
			agentDir: dir,
			verifyLocal: fakeLocal(installed),
			now: () => "2026-10-09T01:00:00Z",
		});
		const found = await call(session2, { action: "find", tools: ["mafft", "iqtree"] });
		expect(found.envs.map((e) => e.name)).toEqual(["phylogeny"]);
		const verified = await call(session2, { action: "verify", name: "phylogeny" });
		expect(verified.envs[0]).toMatchObject({ status: "ok", verifiedAt: "2026-10-09T01:00:00Z" });
	});
	it("verify marks a broken env and suggests installing the missing tools", async () => {
		const dir = await agentDir();
		const ok = makeEnvRegistryTool({
			agentDir: dir,
			verifyLocal: fakeLocal({ mafft: "7.5", iqtree2: "2.3" }),
		});
		await call(ok, { action: "record", name: "phylogeny", tools: ["mafft", "iqtree2"] });
		const later = makeEnvRegistryTool({ agentDir: dir, verifyLocal: fakeLocal({ mafft: "7.5" }) });
		const r = await call(later, { action: "verify", name: "phylogeny" });
		expect(r.text).toMatch(/Missing now: iqtree2[\s\S]*mamba install -n phylogeny/);
		const broken = makeEnvRegistryTool({ agentDir: dir, verifyLocal: fakeLocal({}) });
		expect(
			(await call(broken, { action: "verify", name: "phylogeny", tools: ["mafft"] })).envs[0].status,
		).toBe("broken");
		expect((await call(broken, { action: "find", tools: ["mafft"] })).envs).toEqual([]);
	});
	it("find without a match tells how to create one", async () => {
		const tool = makeEnvRegistryTool({ agentDir: await agentDir() });
		expect((await call(tool, { action: "find", tools: ["mafft"] })).text).toMatch(
			/mamba create -n <name> -c conda-forge -c bioconda mafft/,
		);
	});
	it("remote envs live in the same registry with a host and need approval to verify", async () => {
		const dir = await agentDir();
		let approvals = 0;
		const tool = makeEnvRegistryTool({
			agentDir: dir,
			hosts: async () => [{ alias: "hpc", displayName: "Lab HPC", kind: "ssh" }],
			confirm: async () => {
				approvals++;
				return true;
			},
			run: async (args) => {
				expect(args.join(" ")).toMatch(/hpc/);
				return { exitCode: 0, stdout: "tool\tmafft\tv7.520\ntool\tiqtree2\tMISSING\n", stderr: "" } as any;
			},
		});
		const r = await call(tool, {
			action: "record",
			host: "Lab HPC",
			name: "phylo",
			tools: ["mafft", "iqtree2"],
		});
		expect(approvals).toBe(1);
		expect(r.envs[0]).toMatchObject({ host: "hpc", tools: { mafft: "7.520" }, status: "ok" });
		const denied = makeEnvRegistryTool({ agentDir: dir, confirm: async () => false });
		await expect(call(denied, { action: "verify", host: "hpc", name: "phylo" })).rejects.toThrow(/approval/);
		expect((await call(denied, { action: "list", host: "hpc" })).envs).toHaveLength(1);
		expect((await call(denied, { action: "list", host: "local" })).envs).toHaveLength(0);
	});
	it("helpers: aliases, argv, remote script", () => {
		expect(canonicalTool("IQTREE2")).toBe("iqtree");
		const reg = upsertEnv(emptyRegistry(), {
			name: "phylo",
			host: "local",
			manager: "mamba",
			tools: { iqtree3: "3.0" },
			createdAt: "x",
			status: "ok",
		});
		expect(findReusable(reg, "local", ["iqtree2"])).toHaveLength(1);
		expect(verifyArgv({ manager: "mamba", name: "phylo" }, "mafft")).toEqual([
			"mamba",
			"run",
			"-n",
			"phylo",
			"mafft",
			"--version",
		]);
		const script = remoteVerifyScript(reg.envs[0]!, ["mafft"]);
		expect(script).toMatch(/^if out=\$\(mamba run -n phylo mafft --version 2>&1\); then/);
		expect(parseVerifyOutput("tool\tmafft\tMAFFT v7.520 (2023/Mar/22)\ntool\tx\tMISSING")).toEqual({
			mafft: "7.520",
			x: null,
		});
	});
	it("reads the pre-envelope registry format during migration", async () => {
		const dir = await agentDir();
		await (await import("node:fs/promises")).writeFile(
			registryPath(dir),
			JSON.stringify({ version: 1, envs: [{ name: "legacy", host: "local", manager: "mamba", tools: {} }] }),
		);
		expect((await loadRegistry(dir)).envs[0]).toMatchObject({ name: "legacy", manager: "mamba" });
	});
});

describe("bio_environment reuse hints", () => {
	const env = (tools: Record<string, string | null>): BioEnvironment => ({
		where: "local",
		tools,
		envManager: "mamba",
		condaEnvs: ["phylogeny"],
		containers: [],
		cpus: 8,
		memoryGb: 32,
		freeMemoryGb: 20,
		freeDiskGb: 100,
	});
	it("points to the registered env instead of creating a new one", () => {
		const text = formatEnvironment(env({ mafft: null, iqtree2: null }), [
			{
				name: "phylogeny",
				manager: "mamba",
				tools: { mafft: "7.5", iqtree2: "2.3" },
				verifiedAt: "2026-10-08T00:00:00Z",
			},
		]);
		expect(text).toMatch(
			/Registered analysis environments here[\s\S]*phylogeny \[mafft, iqtree2\] verified 2026-10-08/,
		);
		expect(text).toMatch(/reuse the registered env "phylogeny"/);
		expect(text).not.toMatch(/mamba create -n phylogeny/);
	});
});
