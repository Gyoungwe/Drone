import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildSshArgs,
	resolveRegisteredHost,
	runLocalSsh,
	type SshApproval,
	type SshHostEntry,
	type SshRunner,
} from "../ssh";
import { envsOnHost, loadRegistry } from "./env-registry";
import {
	type BioEnvironment,
	formatEnvironment,
	parseRemoteProbe,
	probeLocal,
	remoteProbeScript,
} from "./environment";

export interface BioEnvironmentToolOptions {
	confirm?: SshApproval;
	hosts?: () => Promise<SshHostEntry[]>;
	run?: SshRunner;
	probe?: (cwd: string) => Promise<BioEnvironment>;
	/** Agent dir holding environments.json; registered envs for the probed host are listed for reuse. */
	agentDir?: string;
}

const params = Type.Object({
	host: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 255,
			description: "Registered SSH host alias or display name; omit to inspect this machine",
		}),
	),
});

/**
 * bio_environment：看清楚能在哪里跑。本地探测不需要审批（只跑各工具的版本参数）；
 * 远程探测走 SSH，和 ssh 工具一样每次连接都要用户批准。
 */
export function makeBioEnvironmentTool(
	options: BioEnvironmentToolOptions = {},
): ToolDefinition<typeof params> {
	const registered = async (host: string) =>
		options.agentDir ? envsOnHost(await loadRegistry(options.agentDir), host) : [];
	return {
		name: "bio_environment",
		label: "Bioinformatics environment",
		description:
			"Inspect where analyses can run: OS/arch/shell/WSL/GPU, installed bioinformatics tools with versions (samtools, bcftools, minimap2, STAR, BLAST, HMMER, BUSCO, IQ-TREE, Nextflow, Snakemake…), conda/mamba environments, container runtimes (Apptainer/Singularity/Docker), CPUs, memory, free disk and the analysis environments already registered with bio_env_registry (reuse them before creating new ones). Omit host for this machine; pass a registered host (see ssh_hosts) to inspect it over SSH (needs the user's approval).",
		promptSnippet: "bio_environment({host?})",
		parameters: params,
		execute: async (_id, input, signal, _update, ctx): Promise<AgentToolResult<BioEnvironment>> => {
			const cwd = (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
			if (!input.host) {
				const env = await (options.probe ?? probeLocal)(cwd);
				return {
					content: [{ type: "text", text: formatEnvironment(env, await registered("local")) }],
					details: env,
				};
			}
			const host = options.hosts ? resolveRegisteredHost(input.host, await options.hosts()) : input.host;
			const { args } = buildSshArgs({ host, command: remoteProbeScript() });
			const approved = options.confirm
				? await options.confirm(
						`SSH access: ${host} :: bio_environment probe`,
						[
							"The agent wants to inspect the bioinformatics environment on a remote host.",
							`Host: ${host}`,
							"It only runs tool version flags, `conda env list`, nproc, /proc/meminfo and df; nothing is changed.",
						].join("\n"),
					)
				: false;
			if (!approved) throw new Error("bio_environment: user approval required for the remote probe");
			const result = await (options.run ?? runLocalSsh)(args, { signal, timeoutMs: 60_000 });
			if (result.exitCode !== 0 && !result.stdout)
				throw new Error(`bio_environment: probe on ${host} failed: ${result.stderr.slice(0, 400)}`);
			const env = parseRemoteProbe(host, result.stdout);
			return {
				content: [{ type: "text", text: formatEnvironment(env, await registered(host)) }],
				details: env,
			};
		},
	};
}
