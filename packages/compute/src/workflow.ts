import { createHash } from "node:crypto";
import type {
	ComputeWorkflowSpec,
	ComputeWorkflowStep,
	WorkflowModule,
	WorkflowReference,
	WorkflowRegistration,
	WorkflowRegistrationPort,
	WorkflowValidationIssue,
	WorkflowValidationResult,
} from "./types";

export interface WorkflowModuleCatalog {
	get(id: string): WorkflowModule | undefined;
	list(): readonly WorkflowModule[];
}

export class InMemoryWorkflowModuleCatalog implements WorkflowModuleCatalog {
	private readonly modules: Map<string, WorkflowModule>;

	constructor(modules: readonly WorkflowModule[] = []) {
		this.modules = new Map(modules.map((module) => [module.id, module]));
	}

	get(id: string): WorkflowModule | undefined {
		return this.modules.get(id);
	}

	list(): readonly WorkflowModule[] {
		return [...this.modules.values()];
	}

	register(module: WorkflowModule): void {
		this.modules.set(module.id, module);
	}
}

export function moduleCatalog(modules: readonly WorkflowModule[]): WorkflowModuleCatalog {
	return new InMemoryWorkflowModuleCatalog(modules);
}

/**
 * Small in-memory host port used by tests and by adapters that do not persist
 * registrations themselves.  The production host should replace this with a
 * JsonStore/SQLite-backed implementation; the compute package never writes
 * files on its own.
 */
export class InMemoryWorkflowRegistrationPort implements WorkflowRegistrationPort {
	private readonly registrations = new Map<string, WorkflowRegistration>();

	get(workflowSpecSha256: string): WorkflowRegistration | undefined {
		return this.registrations.get(workflowSpecSha256);
	}

	register(input: {
		readonly spec: ComputeWorkflowSpec;
		readonly workflowSpecSha256: string;
		readonly moduleIds: readonly string[];
	}): WorkflowRegistration {
		const existing = this.registrations.get(input.workflowSpecSha256);
		if (existing) return existing;
		if (!input.spec.prior?.id) throw new Error("Workflow prior must be registered before the workflow");
		const registration: WorkflowRegistration = {
			workflowSpecSha256: input.workflowSpecSha256,
			workflowId: input.spec.id,
			moduleIds: [...input.moduleIds],
			priorId: input.spec.prior.id,
			registeredAt: new Date().toISOString(),
		};
		this.registrations.set(input.workflowSpecSha256, registration);
		return registration;
	}
}

export function referenceKey(reference: WorkflowReference): string {
	if (typeof reference === "string") return reference;
	if ("input" in reference) return `input:${reference.input}`;
	return `step:${reference.step}.${reference.output}`;
}

export function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
		.join(",")}}`;
}

export function workflowSpecHash(spec: ComputeWorkflowSpec): string {
	return createHash("sha256").update(stableJson(spec)).digest("hex");
}

const idPattern = /^[a-z][a-z0-9_-]*$/;

function addIssue(issues: WorkflowValidationIssue[], code: string, message: string, path?: string): void {
	issues.push(path ? { code, message, path } : { code, message });
}

function addIssueOnce(issues: WorkflowValidationIssue[], issue: WorkflowValidationIssue): void {
	if (!issues.some((candidate) => candidate.code === issue.code && candidate.path === issue.path))
		issues.push(issue);
}

function parseReference(
	reference: WorkflowReference,
): { kind: "input" | "step"; owner: string; output?: string } | null {
	if (typeof reference !== "string") {
		if ("input" in reference)
			return idPattern.test(reference.input) ? { kind: "input", owner: reference.input } : null;
		return idPattern.test(reference.step) && idPattern.test(reference.output)
			? { kind: "step", owner: reference.step, output: reference.output }
			: null;
	}
	if (reference.startsWith("input:")) {
		const owner = reference.slice(6);
		return idPattern.test(owner) ? { kind: "input", owner } : null;
	}
	const match = /^step:([a-z][a-z0-9_-]*)\.([a-z][a-z0-9_-]*)$/.exec(reference);
	if (match?.[1] && match[2]) return { kind: "step", owner: match[1], output: match[2] };
	return null;
}

function compatible(source: string, target: string): boolean {
	return source === target || source === "any" || target === "any";
}

/** Validate the declarative graph before any Nextflow source is written or run. */
export function validateWorkflowSpec(
	spec: ComputeWorkflowSpec,
	catalog: WorkflowModuleCatalog,
): WorkflowValidationResult {
	const errors: WorkflowValidationIssue[] = [];
	const warnings: WorkflowValidationIssue[] = [];
	if (spec?.version !== 1)
		addIssue(errors, "unsupported-version", "ComputeWorkflowSpec version must be 1", "version");
	if (!spec?.id || !idPattern.test(spec.id))
		addIssue(errors, "invalid-id", "ComputeWorkflowSpec id must be a safe identifier", "id");
	if (!spec?.name?.trim()) addIssue(errors, "missing-name", "ComputeWorkflowSpec name is required", "name");
	if (spec?.entrypoint && !idPattern.test(spec.entrypoint))
		addIssue(errors, "invalid-entrypoint", "Entrypoint must be a safe identifier", "entrypoint");

	const inputs = new Map<string, string>();
	for (const [index, input] of (spec.inputs ?? []).entries()) {
		if (!input || !idPattern.test(input.name))
			addIssue(errors, "invalid-input", "Input name is invalid", `inputs.${index}.name`);
		else if (inputs.has(input.name))
			addIssue(
				errors,
				"duplicate-input",
				`Input ${input.name} is declared more than once`,
				`inputs.${index}.name`,
			);
		else inputs.set(input.name, input.type);
	}
	const steps = new Map<string, ComputeWorkflowStep>();
	const modules = new Map<string, WorkflowModule>();
	const declaredModules = spec.modules ? new Set(spec.modules) : undefined;
	if (declaredModules) {
		for (const moduleId of declaredModules) {
			if (!catalog.get(moduleId))
				addIssue(
					errors,
					"module-not-found",
					`Module ${moduleId} is not present in the approved catalogue`,
					"modules",
				);
		}
	}
	for (const [index, step] of (spec.steps ?? []).entries()) {
		if (!step || !idPattern.test(step.id)) {
			addIssue(errors, "invalid-step", "Step id must be a safe identifier", `steps.${index}.id`);
			continue;
		}
		if (steps.has(step.id))
			addIssue(errors, "duplicate-step", `Step ${step.id} is declared more than once`, `steps.${index}.id`);
		steps.set(step.id, step);
		if (declaredModules && !declaredModules.has(step.module))
			addIssue(
				errors,
				"module-not-declared",
				`Step ${step.id} uses module ${step.module} without declaring it in modules`,
				`steps.${index}.module`,
			);
		const module = catalog.get(step.module);
		if (!module) {
			addIssue(
				errors,
				"module-not-found",
				`Module ${step.module} is not present in the approved catalogue`,
				`steps.${index}.module`,
			);
			continue;
		}
		modules.set(step.module, module);
		if (!module.commit || !module.version)
			addIssue(
				errors,
				"unversioned-module",
				`Module ${step.module} must have a fixed version and commit`,
				`steps.${index}.module`,
			);
		if (["latest", "main", "master"].includes(module.commit))
			addIssue(
				errors,
				"mutable-module",
				`Module ${step.module} must use an immutable commit`,
				`steps.${index}.module`,
			);
		if (!module.containerDigest?.startsWith("sha256:"))
			addIssue(
				errors,
				"unpinned-container",
				`Module ${step.module} must declare a sha256 container digest`,
				`steps.${index}.module`,
			);
		else if (module.execution !== "fixture" && !/^sha256:[0-9a-f]{64}$/i.test(module.containerDigest))
			addIssue(
				errors,
				"unresolved-container",
				`Module ${step.module} must use a resolved sha256 container digest before submission`,
				`steps.${index}.module`,
			);
		if (module.execution === "fixture")
			warnings.push({
				code: "fixture-module",
				message: `Module ${module.id} is a preview fixture and cannot be submitted to a remote runner`,
				path: `steps.${index}.module`,
			});
		if (!/^[-A-Za-z0-9_./]+$/.test(module.path) || module.path.startsWith("/") || module.path.includes(".."))
			addIssue(
				errors,
				"unsafe-module-path",
				`Module ${step.module} has an unsafe catalogue path`,
				`steps.${index}.module`,
			);
		if (module.source === "agent")
			warnings.push({
				code: "agent-module",
				message: `Agent module ${module.id} requires agentCode authorization`,
				path: `steps.${index}.module`,
			});
		const ports = new Map(module.inputs.map((port) => [port.name, port]));
		for (const [portName, reference] of Object.entries(step.inputs ?? {})) {
			const port = ports.get(portName);
			if (!port) {
				addIssue(
					errors,
					"unknown-input-port",
					`Module ${module.id} has no input port ${portName}`,
					`steps.${index}.inputs.${portName}`,
				);
				continue;
			}
			const parsed = parseReference(reference);
			if (!parsed) {
				addIssue(
					errors,
					"invalid-reference",
					`Reference ${referenceKey(reference)} must name an input or step output`,
					`steps.${index}.inputs.${portName}`,
				);
				continue;
			}
			if (parsed.kind === "input") {
				const sourceType = inputs.get(parsed.owner);
				if (!sourceType)
					addIssue(
						errors,
						"missing-input",
						`Input ${parsed.owner} is not declared`,
						`steps.${index}.inputs.${portName}`,
					);
				else if (!compatible(sourceType, port.type))
					addIssue(
						errors,
						"type-mismatch",
						`Input ${parsed.owner} (${sourceType}) cannot connect to ${module.id}.${portName} (${port.type})`,
						`steps.${index}.inputs.${portName}`,
					);
			} else {
				const sourceStep = steps.get(parsed.owner);
				if (sourceStep) {
					const sourceModule = catalog.get(sourceStep.module);
					const sourcePort = sourceModule?.outputs.find((candidate) => candidate.name === parsed.output);
					if (!sourcePort)
						addIssue(
							errors,
							"unknown-output-port",
							`Step ${parsed.owner} has no output port ${parsed.output}`,
							`steps.${index}.inputs.${portName}`,
						);
					else if (!compatible(sourcePort.type, port.type))
						addIssue(
							errors,
							"type-mismatch",
							`Step ${parsed.owner}.${parsed.output} (${sourcePort.type}) cannot connect to ${module.id}.${portName} (${port.type})`,
							`steps.${index}.inputs.${portName}`,
						);
				}
			}
		}
		for (const port of module.inputs) {
			if (port.required && !(port.name in (step.inputs ?? {})))
				addIssue(
					errors,
					"missing-required-input",
					`Required input ${module.id}.${port.name} is not connected`,
					`steps.${index}.inputs`,
				);
		}
	}

	// Re-check step references after the complete step map exists so forward references
	// receive the same missing-output and type validation as backward references.
	for (const [index, step] of (spec.steps ?? []).entries()) {
		for (const [portName, reference] of Object.entries(step.inputs ?? {})) {
			const parsed = parseReference(reference);
			if (parsed?.kind !== "step") continue;
			const sourceStep = steps.get(parsed.owner);
			if (!sourceStep) {
				addIssueOnce(errors, {
					code: "missing-step",
					message: `Step ${parsed.owner} is not declared`,
					path: `steps.${index}.inputs.${portName}`,
				});
				continue;
			}
			const sourceModule = catalog.get(sourceStep.module);
			const sourcePort = sourceModule?.outputs.find((candidate) => candidate.name === parsed.output);
			const targetModule = catalog.get(step.module);
			const targetPort = targetModule?.inputs.find((candidate) => candidate.name === portName);
			if (!sourcePort) {
				addIssueOnce(errors, {
					code: "unknown-output-port",
					message: `Step ${parsed.owner} has no output port ${parsed.output}`,
					path: `steps.${index}.inputs.${portName}`,
				});
			} else if (targetPort && !compatible(sourcePort.type, targetPort.type)) {
				addIssueOnce(errors, {
					code: "type-mismatch",
					message: `Step ${parsed.owner}.${parsed.output} (${sourcePort.type}) cannot connect to ${targetModule?.id ?? step.module}.${portName} (${targetPort.type})`,
					path: `steps.${index}.inputs.${portName}`,
				});
			}
		}
	}

	const outputs = new Set<string>();
	for (const [index, output] of (spec.outputs ?? []).entries()) {
		if (!output || !idPattern.test(output.name))
			addIssue(errors, "invalid-output", "Output name must be a safe identifier", `outputs.${index}.name`);
		if (outputs.has(output.name))
			addIssue(
				errors,
				"duplicate-output",
				`Output ${output.name} is declared more than once`,
				`outputs.${index}.name`,
			);
		outputs.add(output.name);
		const parsed = parseReference(output.from);
		if (parsed?.kind !== "step")
			addIssue(
				errors,
				"invalid-output-reference",
				`Output ${output.name} must reference a step output`,
				`outputs.${index}.from`,
			);
		else {
			const sourceStep = steps.get(parsed.owner);
			const sourceModule = sourceStep ? catalog.get(sourceStep.module) : undefined;
			const sourcePort = sourceModule?.outputs.find((candidate) => candidate.name === parsed.output);
			if (!sourceStep)
				addIssue(
					errors,
					"missing-output-step",
					`Output ${output.name} references missing step ${parsed.owner}`,
					`outputs.${index}.from`,
				);
			else if (!sourcePort)
				addIssue(
					errors,
					"missing-output-port",
					`Output ${output.name} references missing port ${parsed.output}`,
					`outputs.${index}.from`,
				);
			else if (!compatible(sourcePort.type, output.type))
				addIssue(
					errors,
					"type-mismatch",
					`Output ${output.name} (${output.type}) does not match ${sourcePort.type}`,
					`outputs.${index}.from`,
				);
		}
	}

	// Detect cycles from step-to-step references. Unknown owners are already reported above.
	const edges = new Map<string, string[]>();
	for (const step of steps.values()) {
		const deps = Object.values(step.inputs ?? {})
			.map(parseReference)
			.filter((ref): ref is { kind: "step"; owner: string; output?: string } => ref?.kind === "step")
			.map((ref) => ref.owner);
		edges.set(step.id, deps);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) {
			addIssue(errors, "cycle", `Workflow graph contains a cycle at step ${id}`, `steps.${id}`);
			return;
		}
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of edges.get(id) ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of steps.keys()) visit(id);
	if (spec.entrypoint && !steps.has(spec.entrypoint))
		addIssue(
			errors,
			"missing-entrypoint",
			`Entrypoint ${spec.entrypoint} is not a declared step`,
			"entrypoint",
		);

	return errors.length
		? { ok: false, errors, warnings }
		: { ok: true, errors, warnings, workflowSpecSha256: workflowSpecHash(spec) };
}

export function assertValidWorkflowSpec(spec: ComputeWorkflowSpec, catalog: WorkflowModuleCatalog): string {
	const result = validateWorkflowSpec(spec, catalog);
	if (!result.ok)
		throw new Error(
			`Invalid ComputeWorkflowSpec: ${result.errors.map((issue) => `${issue.code} at ${issue.path ?? "root"}`).join(", ")}`,
		);
	return result.workflowSpecSha256 as string;
}

/**
 * Register a validated workflow and its prior before a caller can submit it.
 * This is deliberately separate from compilation: preview/dry-run remains
 * useful for L0/L1 tasks, while remote submission must use this host-issued
 * registration record.
 */
export function registerWorkflowSpec(
	spec: ComputeWorkflowSpec,
	catalog: WorkflowModuleCatalog,
	port: WorkflowRegistrationPort,
): WorkflowRegistration | Promise<WorkflowRegistration> {
	const hash = assertValidWorkflowSpec(spec, catalog);
	if (!spec.prior?.id || !spec.prior.statement.trim())
		throw new Error("Workflow prior must be recorded before submission");
	const moduleIds = [...new Set(spec.steps.map((step) => step.module))];
	return port.register({ spec, workflowSpecSha256: hash, moduleIds });
}

/** Resolve a registration and fail closed when it is absent or stale. */
export async function assertWorkflowRegistered(
	spec: ComputeWorkflowSpec,
	catalog: WorkflowModuleCatalog,
	port: WorkflowRegistrationPort,
): Promise<WorkflowRegistration> {
	const hash = assertValidWorkflowSpec(spec, catalog);
	const registration = await port.get(hash);
	if (!registration) throw new Error("Workflow must be registered before submission");
	if (registration.workflowSpecSha256 !== hash)
		throw new Error("Workflow registration does not match the current specification");
	if (registration.workflowId !== spec.id || registration.priorId !== spec.prior?.id)
		throw new Error("Workflow registration does not match the workflow prior");
	const moduleIds = new Set(spec.steps.map((step) => step.module));
	if (
		registration.moduleIds.length !== moduleIds.size ||
		registration.moduleIds.some((id) => !moduleIds.has(id))
	)
		throw new Error("Workflow registration does not match the approved module set");
	return registration;
}

export function createWorkflowSpec(input: Omit<ComputeWorkflowSpec, "version">): ComputeWorkflowSpec {
	return { ...input, version: 1 };
}
