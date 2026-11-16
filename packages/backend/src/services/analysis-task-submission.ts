import { createHash } from "node:crypto";
import { stableJson } from "@drone/compute";
import type { AnalysisExecutionContext } from "@drone/shared";
import type { ComputePreflightJobSpec } from "./compute-preflight";

export function submissionHash(spec: ComputePreflightJobSpec): string {
	const { lineage: _lineage, ...content } = spec;
	return createHash("sha256").update(stableJson(content)).digest("hex");
}

export function workflowIdentity(spec: ComputePreflightJobSpec): { id: string; version: string } {
	const workflow = spec.workflow;
	return "name" in workflow
		? { id: workflow.name, version: workflow.version }
		: {
				id: "workflow-spec",
				version: `sha256:${createHash("sha256").update(stableJson(workflow)).digest("hex")}`,
			};
}

export function inputArtifacts(spec: ComputePreflightJobSpec) {
	const files = spec.dataDesign?.dataset.files ?? [];
	return files.map((file) => ({
		artifactId: `${spec.dataDesign?.dataset.datasetId}:${file.path}`,
		versionId: `sha256:${file.sha256}`,
		path: file.path,
		sha256: file.sha256,
		bytes: file.bytes,
		role: "input" as const,
		parentVersionIds: [],
	}));
}

export function hashValue(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function observedExecutionContext(
	value: Record<string, unknown>,
): AnalysisExecutionContext | undefined {
	const raw = value.executionContext;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const record = raw as Record<string, unknown>;
	const values: Record<string, string | number | boolean | null> = {};
	for (const [key, item] of Object.entries(record)) {
		if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null)
			values[key] = item;
	}
	if (!Object.keys(values).length) return undefined;
	return {
		schemaVersion: 1,
		revision: hashValue(values),
		observedAt: new Date().toISOString(),
		source: "host",
		values,
	};
}
