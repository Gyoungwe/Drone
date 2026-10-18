export * from "./artifacts";
export * from "./capsule";
export * from "./checkpoints";
export * from "./digest";
export * from "./provenance";
export * from "./replay";

import { validateArtifactManifest } from "./artifacts";
import { validateCapsuleImport } from "./capsule";
import { verifyReplay } from "./replay";

function result(details: unknown) {
	return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}

function readObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

/** Read-only native Pi registration. Hosts own bytes, persistence and execution. */
export function registerPiEvidence(pi: any) {
	pi.registerTool({
		name: "evidence_validate_manifest",
		label: "Evidence · validate manifest",
		description: "Validate content-addressed artifact metadata without reading files or writing state.",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["evidence", "files"] },
		parameters: { type: "object", properties: { manifest: { type: "object" } }, required: ["manifest"] },
		async execute(_id: string, params: unknown) {
			const input = readObject(params, "params");
			return result(validateArtifactManifest(input.manifest as never, { requireIdentity: true }));
		},
	});
	pi.registerTool({
		name: "evidence_validate_capsule",
		label: "Evidence · validate capsule",
		description:
			"Validate an imported evidence capsule, omission list and every blob digest without importing it.",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["evidence", "files"] },
		parameters: {
			type: "object",
			properties: { capsule: { type: "object" }, serialized: { type: "string" } },
		},
		async execute(_id: string, params: unknown) {
			const input = readObject(params, "params");
			const checkpoint = validateCapsuleImport(
				input.serialized !== undefined ? String(input.serialized) : (input.capsule as never),
			);
			return result({ valid: true, checkpointId: checkpoint.id, analysisId: checkpoint.analysis.id });
		},
	});
	pi.registerTool({
		name: "evidence_verify_replay",
		label: "Evidence · verify replay",
		description:
			"Compare host-provided output metadata and environment fingerprint with a frozen checkpoint.",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["evidence", "files"] },
		parameters: {
			type: "object",
			properties: {
				checkpoint: { type: "object" },
				environmentFingerprint: { type: "string" },
				outputs: { type: "array" },
			},
			required: ["checkpoint", "outputs"],
		},
		async execute(_id: string, params: unknown) {
			const input = readObject(params, "params");
			return result(
				verifyReplay(input.checkpoint as never, {
					environmentFingerprint:
						input.environmentFingerprint === undefined ? undefined : String(input.environmentFingerprint),
					outputs: Array.isArray(input.outputs) ? (input.outputs as never) : [],
				}),
			);
		},
	});
	return {
		tools: ["evidence_validate_manifest", "evidence_validate_capsule", "evidence_verify_replay"],
	} as const;
}

export default registerPiEvidence;
