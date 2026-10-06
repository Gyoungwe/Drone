import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	formatEnvironment,
	parseCondaEnvs,
	parseRemoteProbe,
	parseVersion,
	remoteProbeScript,
} from "../src/tools/bio/environment";
import { LARGE_BIO_FILE_BYTES, largeBioFileReason, placementGuidance } from "../src/tools/bio/extension";
import { makeBioEnvironmentTool } from "../src/tools/bio/tool";

let dir = "";
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("bio environment probe", () => {
	it("parses tool versions, conda envs and remote probe output", () => {
		expect(parseVersion("samtools 1.19.2\nUsing htslib 1.19.1")).toBe("1.19.2");
		expect(parseVersion("usage only")).toBe("installed");
		expect(parseVersion("STAR_2.7.11b")).toBe("2.7.11b");
		expect(parseVersion("Version: 0.7.17-r1188")).toBe("0.7.17-r1188");
		expect(parseVersion("gatk 4.5.0.0\nHTSJDK Version: 4.1.0")).toBe("4.5.0.0");
		expect(parseVersion("nextflow version 24.04.4.5917")).toBe("24.04.4.5917");
		expect(
			parseCondaEnvs("# conda environments:\nbase  *  /opt/conda\nbusco    /opt/conda/envs/busco\n"),
		).toEqual(["base", "busco"]);
		const env = parseRemoteProbe(
			"hpc-01",
			[
				"tool\tsamtools\tsamtools 1.17  Using htslib 1.17",
				"tool\tbusco\tBUSCO 5.7.1",
				"manager\tmamba",
				"env\tbase   /opt/mamba",
				"env\tannot  /opt/mamba/envs/annot",
				"container\tapptainer",
				"cpus\t64",
				"memkb\t263870040",
				"memfreekb\t200000000",
				"diskfreekb\t1048576000",
			].join("\n"),
		);
		expect(env).toMatchObject({
			where: "remote",
			host: "hpc-01",
			envManager: "mamba",
			condaEnvs: ["base", "annot"],
			containers: ["apptainer"],
			cpus: 64,
		});
		expect(env.tools.samtools).toBe("1.17");
		expect(env.tools.STAR).toBeNull();
		expect(env.memoryGb).toBeGreaterThan(200);
		const text = formatEnvironment(env);
		expect(text).toContain("samtools 1.17");
		expect(text).toContain("Not found:");
	});

	it("builds a read-only remote probe script", () => {
		const script = remoteProbeScript();
		expect(script).toContain("command -v samtools");
		expect(script).toContain("env list");
		expect(script).not.toMatch(/\b(?:rm|mv|cp|tee)\b|>\s*\/(?!dev\/null)/);
	});

	it("probes this machine without approval but asks before probing a remote host", async () => {
		const local = {
			where: "local" as const,
			tools: { samtools: "1.19" },
			envManager: null,
			condaEnvs: [],
			containers: [],
			cpus: 8,
			memoryGb: 32,
			freeMemoryGb: 16,
			freeDiskGb: 100,
		};
		const confirm = vi.fn(async () => false);
		const run = vi.fn(async () => ({
			stdout: "cpus\t64",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			truncated: false,
		}));
		const tool = makeBioEnvironmentTool({
			probe: async () => local,
			confirm,
			run,
			hosts: async () => [{ alias: "hpc-01", displayName: "实验室 HPC", kind: "ssh" }],
		});
		const own = await tool.execute("1", {}, undefined, undefined, { cwd: "/tmp" } as never);
		expect(own.details).toBe(local);
		expect(confirm).not.toHaveBeenCalled();
		await expect(
			tool.execute("2", { host: "实验室 HPC" }, undefined, undefined, {} as never),
		).rejects.toThrow("approval");
		expect(run).not.toHaveBeenCalled();
		confirm.mockResolvedValueOnce(true);
		const remote = await tool.execute("3", { host: "实验室 HPC" }, undefined, undefined, {} as never);
		expect(run.mock.calls[0]?.[0]).toContain("hpc-01");
		expect(remote.details).toMatchObject({ where: "remote", host: "hpc-01", cpus: 64 });
	});
});

describe("large bio file guard and placement", () => {
	it("blocks reading a large FASTQ whole and suggests preview commands, but allows small files", async () => {
		dir = await mkdtemp(join(tmpdir(), "bio-guard-"));
		await writeFile(join(dir, "reads.fastq"), Buffer.alloc(LARGE_BIO_FILE_BYTES + 1, 65));
		await writeFile(join(dir, "small.vcf"), "##fileformat=VCFv4.2\n");
		const reason = await largeBioFileReason(dir, "reads.fastq");
		expect(reason).toContain("FASTQ");
		expect(reason).toContain("seqkit stats reads.fastq");
		expect(await largeBioFileReason(dir, "small.vcf")).toBeNull();
		expect(await largeBioFileReason(dir, "notes.md")).toBeNull();
		expect(await largeBioFileReason(dir, "missing.bam")).toBeNull();
	});

	it("tells the model where to run: user choice first, otherwise decide and explain", () => {
		expect(placementGuidance("local")).toContain("LOCAL");
		expect(placementGuidance({ host: "hpc-01" })).toContain('"hpc-01"');
		const auto = placementGuidance("auto");
		expect(auto).toContain("bio_environment");
		expect(auto).toContain("/run-on");
	});
});
