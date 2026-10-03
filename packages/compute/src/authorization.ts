import { createHash } from "node:crypto";
import type {
	ComputeAuthorization,
	ComputeWorkflowJobSpec,
	ComputeWorkflowSpec,
	WorkflowRegistrationPort,
} from "./types";
import {
	assertWorkflowRegistered,
	stableJson,
	type WorkflowModuleCatalog,
	workflowSpecHash,
} from "./workflow";

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
				executionMode: job.workflow.executionMode,
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
	if (job.workflow.executionMode !== "ready")
		return { ok: false, reason: "workflow is a preview fixture and cannot be submitted" };
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

/**
 * Submission gate for hosts that have adopted B5c.  Existing callers can keep
 * using `checkJobAuthorization` for B1–B4 compatibility; new submit paths
 * should call this stricter async gate so the prior and module registration
 * are checked immediately before the remote side effect.
 */
export async function checkRegisteredJobAuthorization(
	job: ComputeWorkflowJobSpec,
	spec: ComputeWorkflowSpec,
	catalog: WorkflowModuleCatalog,
	registrations: WorkflowRegistrationPort,
	expectedContractHash?: string,
): Promise<AuthorizationCheck> {
	const base = checkJobAuthorization(job, expectedContractHash);
	if (!base.ok) return base;
	if (job.workflow.workflowSpecSha256 !== workflowSpecHash(spec))
		return { ok: false, reason: "compiled workflow does not match the submitted specification" };
	try {
		await assertWorkflowRegistered(spec, catalog, registrations);
		return { ok: true };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** Throwing companion for adapters that must stop before invoking a runner. */
export async function assertRegisteredJobAuthorized(
	job: ComputeWorkflowJobSpec,
	spec: ComputeWorkflowSpec,
	catalog: WorkflowModuleCatalog,
	registrations: WorkflowRegistrationPort,
	expectedContractHash?: string,
): Promise<void> {
	const result = await checkRegisteredJobAuthorization(
		job,
		spec,
		catalog,
		registrations,
		expectedContractHash,
	);
	if (!result.ok) throw new Error(result.reason);
}
