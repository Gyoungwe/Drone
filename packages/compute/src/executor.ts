import type { CompiledWorkflow, ExecutorConfig, ExecutorLaunch } from "./types";

function positiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

export function validateExecutorConfig(config: ExecutorConfig): void {
	if (config.kind !== "direct" && config.kind !== "slurm")
		throw new Error(`Unsupported executor ${config.kind}`);
	positiveInteger(config.cpus, "cpus");
	positiveInteger(config.memoryMb, "memoryMb");
	positiveInteger(config.walltimeMinutes, "walltimeMinutes");
	if (config.queue && !/^[A-Za-z0-9_.-]+$/.test(config.queue)) throw new Error("Invalid Slurm queue");
	if (config.partition && !/^[A-Za-z0-9_.-]+$/.test(config.partition))
		throw new Error("Invalid Slurm partition");
	if (config.profile && !/^[A-Za-z0-9_.-]+$/.test(config.profile))
		throw new Error("Invalid Nextflow profile");
}

export function executorConfigForNextflow(config: ExecutorConfig): string {
	validateExecutorConfig(config);
	const lines = [
		`executor = '${config.kind === "direct" ? "local" : "slurm"}'`,
		`cpus = ${config.cpus}`,
		`memory = '${config.memoryMb} MB'`,
		`time = '${config.walltimeMinutes}m'`,
	];
	if (config.queue) lines.push(`queue = '${config.queue}'`);
	return lines.join("\n");
}

/** Build argv/env for the fixed runner seam. Callers still inject transport/runner. */
export function buildExecutorLaunch(workflow: CompiledWorkflow, config: ExecutorConfig): ExecutorLaunch {
	validateExecutorConfig(config);
	const args = [
		"run",
		"main.nf",
		"-c",
		"nextflow.config",
		"-process.executor",
		config.kind === "direct" ? "local" : "slurm",
	];
	if (config.profile) args.push("-profile", config.profile);
	if (config.kind === "slurm" && config.queue) args.push("-process.queue", config.queue);
	if (config.kind === "slurm" && config.partition)
		args.push("-process.clusterOptions", `--partition=${config.partition}`);
	return {
		command: "nextflow",
		args,
		environment: {
			DRONE_WORKFLOW_SPEC_SHA256: workflow.workflowSpecSha256,
			DRONE_EXECUTOR: config.kind,
			DRONE_CPUS: String(config.cpus),
			DRONE_MEMORY_MB: String(config.memoryMb),
		},
	};
}

export interface ExecutorAdapter {
	readonly kind: ExecutorConfig["kind"];
	buildLaunch(workflow: CompiledWorkflow, config: ExecutorConfig): ExecutorLaunch;
}

export const directExecutor: ExecutorAdapter = {
	kind: "direct",
	buildLaunch: (workflow, config) => buildExecutorLaunch(workflow, { ...config, kind: "direct" }),
};

export const slurmExecutor: ExecutorAdapter = {
	kind: "slurm",
	buildLaunch: (workflow, config) => buildExecutorLaunch(workflow, { ...config, kind: "slurm" }),
};
