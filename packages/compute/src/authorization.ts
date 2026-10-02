import { createHash } from "node:crypto";
import type { ComputeAuthorization, ComputeWorkflowJobSpec } from "./types";
import { stableJson } from "./workflow";

export function computeContractHash(authorization: Omit<ComputeAuthorization, "contractHash">): string {
	return createHash("sha256").update(stableJson(authorization)).digest("hex");
}

export function createComputeAuthorization(
	authorization: Omit<ComputeAuthorization, "contractHash">,
): ComputeAuthorization {
	return { ...authorization, contractHash: computeContractHash(authorization) };
}

export function computeJobContractHash(
	job: Pick<
		ComputeWorkflowJobSpec,
		"jobId" | "host" | "workflow" | "executor" | "remoteRead" | "remoteWrite" | "authorization"
	>,
): string {
	const { contractHash: _ignored, ...authorization } = job.authorization;
	return createHash("sha256")
		.update(
			stableJson({
				jobId: job.jobId,
				host: job.host,
				authorization,
				workflowSpecSha256: job.workflow.workflowSpecSha256,
				moduleCommits: job.workflow.moduleCommits,
				containerDigests: job.workflow.containerDigests,
				executor: job.executor,
				remoteRead: job.remoteRead,
				remoteWrite: job.remoteWrite,
			}),
		)
		.digest("hex");
}

function withinRoots(path: string, roots: readonly string[]): boolean {
	return roots.some((root) => {
		const normalizedRoot = root.replace(/\/+$/, "") || "/";
		return path === normalizedRoot || path.startsWith(normalizedRoot === "/" ? "/" : `${normalizedRoot}/`);
	});
}

export interface AuthorizationCheck {
	ok: boolean;
	reason?: string;
}

/** Host-side gate. A model/tool may request a ComputeWorkflowJobSpec, but cannot bypass this check. */
export function checkJobAuthorization(
	job: ComputeWorkflowJobSpec,
	expectedContractHash?: string,
): AuthorizationCheck {
	const auth = job.authorization;
	if (!auth.approved) return { ok: false, reason: "compute authorization is not approved" };
	const { contractHash: suppliedHash, ...unsignedAuthorization } = auth;
	if (!suppliedHash || suppliedHash !== computeContractHash(unsignedAuthorization)) {
		return { ok: false, reason: "compute authorization contract hash is invalid" };
	}
	if (expectedContractHash && suppliedHash !== expectedContractHash)
		return { ok: false, reason: "compute authorization does not match the approved task contract" };
	if (job.contractHash !== computeJobContractHash(job))
		return { ok: false, reason: "job contract hash is invalid" };
	if (!auth.hosts.includes(job.host))
		return { ok: false, reason: `host ${job.host} is outside the approved scope` };
	if (
		!auth.workflows.some(
			(workflow) =>
				workflow === "*" || Object.keys(job.workflow.moduleCommits).some((module) => module === workflow),
		)
	) {
		return { ok: false, reason: "workflow is outside the approved scope" };
	}
	if (job.remoteRead.some((path) => !validRemotePath(path) || !withinRoots(path, auth.remoteRead)))
		return { ok: false, reason: "remote read path is outside the approved scope" };
	if (job.remoteWrite.some((path) => !validRemotePath(path) || !withinRoots(path, auth.remoteWrite)))
		return { ok: false, reason: "remote write path is outside the approved scope" };
	const coreHours = (job.executor.cpus * job.executor.walltimeMinutes) / 60;
	if (coreHours > auth.budget.maxCoreHours)
		return { ok: false, reason: "job exceeds the approved core-hour budget" };
	if (job.executor.walltimeMinutes > auth.budget.maxWalltimeMinutes)
		return { ok: false, reason: "job exceeds the approved wall-time budget" };
	if (
		Object.keys(job.workflow.moduleCommits).some((module) => module.startsWith("agent/") && !auth.agentCode)
	)
		return { ok: false, reason: "agent modules require agentCode authorization" };
	return { ok: true };
}

function validRemotePath(path: string): boolean {
	return (
		Boolean(path) &&
		!path.startsWith("-") &&
		!path.includes("\\") &&
		!path.split("/").includes("..") &&
		!path.includes("//")
	);
}

export function assertJobAuthorized(job: ComputeWorkflowJobSpec, expectedContractHash?: string): void {
	const result = checkJobAuthorization(job, expectedContractHash);
	if (!result.ok) throw new Error(result.reason);
}
