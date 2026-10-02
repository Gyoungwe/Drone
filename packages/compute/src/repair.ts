import { compileWorkflow } from "./nextflow";
import type {
	CommandResult,
	CompiledWorkflow,
	ComputeWorkflowSpec,
	WorkflowFailureLookupPort,
	WorkflowFailureRecord,
} from "./types";
import { type WorkflowModuleCatalog, workflowSpecHash } from "./workflow";

export const MAX_AUTONOMOUS_REPAIR_ATTEMPTS = 3 as const;

export interface WorkflowFailure {
	readonly signature: string;
	readonly message: string;
	readonly step?: string;
	readonly code?: string;
	readonly at: string;
}

export interface WorkflowExecutionObservation {
	readonly ok: boolean;
	readonly failure?: WorkflowFailure;
	readonly summary?: string;
	readonly commandResult?: CommandResult;
}

/** A bounded, reviewable record for the report's “我替你决定的” section. */
export interface DecisionMadeForYou {
	readonly label: "我替你决定的";
	readonly attempt: number;
	readonly action: string;
	readonly rationale: string;
	readonly changedFields?: readonly string[];
	readonly at: string;
}

export interface WorkflowRepairContext {
	readonly attempt: number;
	readonly spec: ComputeWorkflowSpec;
	readonly failure: WorkflowFailure;
	readonly priorFailures: readonly WorkflowFailureRecord[];
	readonly negativeResults: readonly WorkflowFailureRecord[];
}

export interface WorkflowRepairProposal {
	readonly spec: ComputeWorkflowSpec;
	readonly decision: Omit<DecisionMadeForYou, "label" | "attempt" | "at"> & {
		readonly changedFields?: readonly string[];
	};
}

/**
 * Repair is a spec-to-spec transformation.  It cannot return a shell string,
 * executable path, or transport request, so a repair can never bypass the
 * fixed runner/authorization seams.
 */
export type WorkflowRepairer = (
	context: WorkflowRepairContext,
) => WorkflowRepairProposal | Promise<WorkflowRepairProposal>;

export interface AutonomousRepairOptions {
	readonly spec: ComputeWorkflowSpec;
	readonly catalog: WorkflowModuleCatalog;
	/** Run a compiled artifact (usually preview or a bounded test profile). */
	readonly execute?: (
		artifact: CompiledWorkflow,
		context: { readonly attempt: number; readonly spec: ComputeWorkflowSpec },
	) => WorkflowExecutionObservation | Promise<WorkflowExecutionObservation>;
	readonly lookup?: WorkflowFailureLookupPort;
	readonly repair?: WorkflowRepairer;
	readonly maxAttempts?: number;
	readonly now?: () => string;
}

export type AutonomousRepairStatus = "succeeded" | "failed" | "blocked";

export interface AutonomousRepairAttempt {
	readonly attempt: number;
	readonly workflowSpecSha256: string;
	readonly artifact?: CompiledWorkflow;
	readonly failure?: WorkflowFailure;
	readonly summary?: string;
}

export interface AutonomousRepairResult {
	readonly status: AutonomousRepairStatus;
	readonly spec: ComputeWorkflowSpec;
	readonly artifact?: CompiledWorkflow;
	readonly attempts: readonly AutonomousRepairAttempt[];
	readonly decisionsMadeForYou: readonly DecisionMadeForYou[];
	readonly failure?: WorkflowFailure;
	readonly reason?: string;
}

function failureFromError(error: unknown, at: string): WorkflowFailure {
	const message = error instanceof Error ? error.message : String(error);
	return {
		signature: `compile:${message}`,
		message,
		code: "compile-failure",
		at,
	};
}

function normalizeFailure(failure: WorkflowFailure, at: string): WorkflowFailure {
	return { ...failure, at, signature: failure.signature.trim() || `execution:${failure.message}` };
}

function sameSpec(a: ComputeWorkflowSpec, b: ComputeWorkflowSpec): boolean {
	return workflowSpecHash(a) === workflowSpecHash(b);
}

function boundedLimit(value: number | undefined): number {
	if (value === undefined) return MAX_AUTONOMOUS_REPAIR_ATTEMPTS;
	if (!Number.isInteger(value) || value < 1 || value > MAX_AUTONOMOUS_REPAIR_ATTEMPTS)
		throw new Error(`maxAttempts must be an integer between 1 and ${MAX_AUTONOMOUS_REPAIR_ATTEMPTS}`);
	return value;
}

/**
 * Run compile → preview/execute → inspect history → spec repair.  At most three
 * attempts are allowed, and a repeated failure signature closes the loop
 * rather than blindly replaying the same failed operation.
 */
export async function runAutonomousRepair(options: AutonomousRepairOptions): Promise<AutonomousRepairResult> {
	const maxAttempts = boundedLimit(options.maxAttempts);
	const now = options.now ?? (() => new Date().toISOString());
	let spec = options.spec;
	const attempts: AutonomousRepairAttempt[] = [];
	const decisionsMadeForYou: DecisionMadeForYou[] = [];
	const seenFailures = new Set<string>();

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const at = now();
		let artifact: CompiledWorkflow | undefined;
		let failure: WorkflowFailure | undefined;
		try {
			artifact = compileWorkflow(spec, options.catalog);
		} catch (error) {
			failure = failureFromError(error, at);
			attempts.push({ attempt, workflowSpecSha256: workflowSpecHash(spec), failure });
		}

		if (!failure && artifact) {
			let observation: WorkflowExecutionObservation;
			try {
				observation = options.execute
					? await options.execute(artifact, { attempt, spec })
					: { ok: true, summary: "Workflow compiled successfully" };
			} catch (error) {
				observation = {
					ok: false,
					failure: {
						signature: `execution:${error instanceof Error ? error.message : String(error)}`,
						message: error instanceof Error ? error.message : String(error),
						at,
					},
				};
			}
			if (observation.ok) {
				attempts.push({
					attempt,
					workflowSpecSha256: artifact.workflowSpecSha256,
					artifact,
					summary: observation.summary,
				});
				return { status: "succeeded", spec, artifact, attempts, decisionsMadeForYou };
			}
			failure = normalizeFailure(
				observation.failure ?? {
					signature: "execution:unspecified",
					message: observation.summary ?? "Workflow execution failed",
					at,
				},
				at,
			);
			attempts.push({
				attempt,
				workflowSpecSha256: artifact.workflowSpecSha256,
				artifact,
				failure,
				summary: observation.summary,
			});
		}

		if (!failure) throw new Error("Autonomous repair produced no execution result");
		if (seenFailures.has(failure.signature)) {
			return {
				status: "blocked",
				spec,
				attempts,
				decisionsMadeForYou,
				failure,
				reason: "The same failure signature repeated; automatic repair stopped",
			};
		}
		seenFailures.add(failure.signature);
		if (attempt >= maxAttempts || !options.repair) {
			return {
				status: "failed",
				spec,
				attempts,
				decisionsMadeForYou,
				failure,
				reason:
					attempt >= maxAttempts
						? "Autonomous repair attempt limit reached"
						: "No repair strategy was provided",
			};
		}

		const [priorFailures, negativeResults] = options.lookup
			? await Promise.all([
					options.lookup.lookupFailures({ workflowId: spec.id, signature: failure.signature, limit: 8 }),
					options.lookup.lookupNegativeResults({
						workflowId: spec.id,
						signature: failure.signature,
						limit: 8,
					}),
				])
			: [[], []];
		const proposal = await options.repair({
			attempt,
			spec,
			failure,
			priorFailures,
			negativeResults,
		});
		if (!proposal?.spec || sameSpec(proposal.spec, spec)) {
			return {
				status: "blocked",
				spec,
				attempts,
				decisionsMadeForYou,
				failure,
				reason: "Repair did not produce a changed WorkflowSpec",
			};
		}
		decisionsMadeForYou.push({
			label: "我替你决定的",
			attempt,
			action: proposal.decision.action,
			rationale: proposal.decision.rationale,
			...(proposal.decision.changedFields ? { changedFields: proposal.decision.changedFields } : {}),
			at: now(),
		});
		spec = proposal.spec;
	}

	throw new Error("Autonomous repair loop exited unexpectedly");
}

/** Alias used by host adapters that expose the loop as a workflow repair operation. */
export const repairWorkflow = runAutonomousRepair;
