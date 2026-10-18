import { type EvidenceArtifact, isSafeEvidencePath } from "./artifacts";
import { type EvidenceCheckpoint, validateCheckpoint } from "./checkpoints";
import { isSha256 } from "./digest";

export interface ReplayOutput {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
}

export interface ReplayOutputCheck {
	readonly path: string;
	readonly matched: boolean;
}

export interface ReplayVerification {
	readonly status: "reproduced" | "failed";
	readonly detail: string;
	readonly outputChecks: readonly ReplayOutputCheck[];
	readonly environmentMatched: boolean;
}

export interface EvidenceReplayReceipt extends ReplayVerification {
	readonly id: string;
	readonly checkpointId: string;
	readonly completedAt: string;
}

function outputFiles(checkpoint: EvidenceCheckpoint): readonly EvidenceArtifact[] {
	return checkpoint.files.filter((file) => file.kind === "output").map((file) => file.artifact);
}

function validateOutput(value: ReplayOutput): void {
	if (
		!isSafeEvidencePath(value.path) ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes < 0 ||
		!isSha256(value.sha256)
	)
		throw new Error(`Invalid replay output: ${value.path}`);
}

/** Compare host-produced output records with frozen evidence without reading files. */
export function verifyReplay(
	checkpoint: EvidenceCheckpoint,
	input: { readonly environmentFingerprint?: string; readonly outputs: readonly ReplayOutput[] },
): ReplayVerification {
	validateCheckpoint(checkpoint);
	const seenOutputs = new Set<string>();
	for (const output of input.outputs) {
		validateOutput(output);
		if (seenOutputs.has(output.path)) throw new Error(`Duplicate replay output: ${output.path}`);
		seenOutputs.add(output.path);
	}
	const expected = outputFiles(checkpoint);
	const actualByPath = new Map(input.outputs.map((output) => [output.path, output]));
	const checks = expected.map((artifact) => {
		const actual = actualByPath.get(artifact.path);
		return {
			path: artifact.path,
			matched:
				!!actual &&
				actual.bytes === artifact.bytes &&
				actual.sha256.toLowerCase() === artifact.sha256.toLowerCase(),
		};
	});
	const expectedPaths = new Set(expected.map((artifact) => artifact.path));
	const unexpected = input.outputs.some((output) => !expectedPaths.has(output.path));
	const environmentMatched =
		checkpoint.environmentFingerprint !== undefined &&
		input.environmentFingerprint === checkpoint.environmentFingerprint;
	const reproduced =
		environmentMatched &&
		checks.length === expected.length &&
		checks.every((check) => check.matched) &&
		!unexpected;
	return {
		status: reproduced ? "reproduced" : "failed",
		detail: reproduced
			? "Exact output bytes and environment matched"
			: "Output or environment differs from frozen evidence",
		outputChecks: checks,
		environmentMatched,
	};
}

export function createReplayReceipt(input: {
	readonly id: string;
	readonly checkpoint: EvidenceCheckpoint;
	readonly completedAt: string;
	readonly environmentFingerprint?: string;
	readonly outputs: readonly ReplayOutput[];
}): EvidenceReplayReceipt {
	const verification = verifyReplay(input.checkpoint, {
		environmentFingerprint: input.environmentFingerprint,
		outputs: input.outputs,
	});
	if (!input.id || !input.completedAt || Number.isNaN(Date.parse(input.completedAt)))
		throw new Error("Invalid replay receipt identity");
	return { ...verification, id: input.id, checkpointId: input.checkpoint.id, completedAt: input.completedAt };
}

export function validateReplayReceipt(receipt: EvidenceReplayReceipt): void {
	if (
		!receipt.id ||
		!isSha256(receipt.checkpointId) ||
		Number.isNaN(Date.parse(receipt.completedAt)) ||
		(receipt.status === "reproduced" &&
			(!receipt.environmentMatched || receipt.outputChecks.some((check) => !check.matched)))
	)
		throw new Error("Invalid replay receipt");
	const seenPaths = new Set<string>();
	for (const check of receipt.outputChecks) {
		if (!isSafeEvidencePath(check.path) || seenPaths.has(check.path))
			throw new Error("Invalid replay output check path");
		seenPaths.add(check.path);
	}
}

export const replayProof = verifyReplay;
