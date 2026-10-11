import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { hostText } from "../reply-language";
import {
	planRnaseqExecution,
	preflightRnaseqExecution,
	type RnaseqIntentInput,
} from "../services/execution-route";

const params = Type.Object({
	intent: Type.String({
		minLength: 1,
		maxLength: 400,
		description:
			"The user's research request. Use the user's wording; do not invent a command or shell script.",
	}),
	samplesheet: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 1024,
			description: "Approved samplesheet path, if already known.",
		}),
	),
	hostAlias: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 128,
			description: "Registered compute host alias only; omit to keep placement unresolved.",
		}),
	),
	profile: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	genome: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	executionMode: Type.Optional(Type.Union([Type.Literal("fixture"), Type.Literal("production")])),
});

export interface ComputeRouteToolDetails {
	readonly route: ReturnType<typeof preflightRnaseqExecution>["route"];
	readonly plan?: {
		workflowId: string;
		pipeline: string;
		workflowSpecSha256: string;
		hostAlias: string;
		executionMode: string;
		resources: { cpus?: number; memoryBytes?: number; wallTimeSeconds?: number } | undefined;
	};
	readonly preflight: {
		ok: boolean;
		errors: readonly string[];
		warnings: readonly string[];
	};
}

/**
 * Model-facing route declaration. It only returns a bounded plan; it never
 * opens SSH, writes a workflow, or submits a job. Durable compute must pass
 * through the host's approval and preflight gates afterwards.
 */
export function makeComputeRouteTool(): ToolDefinition<typeof params> {
	return {
		name: "compute_route",
		label: "Plan compute route",
		description:
			"Translate a supported bulk RNA-seq request into a structured, reviewable execution route. This is declaration-only: it cannot connect to SSH, run commands, submit jobs, or approve a host. After reviewing the route, use the desktop compute panel or an approved compute workflow to execute it.",
		promptSnippet: "compute_route({intent, samplesheet?, hostAlias?, profile?, genome?, executionMode?})",
		parameters: params,
		execute: async (_id, input): Promise<AgentToolResult<ComputeRouteToolDetails>> => {
			const request: RnaseqIntentInput = {
				intent: input.intent,
				...(input.samplesheet ? { samplesheet: input.samplesheet } : {}),
				...(input.hostAlias ? { hostAlias: input.hostAlias } : {}),
				...(input.profile ? { profile: input.profile } : {}),
				...(input.genome ? { genome: input.genome } : {}),
				...(input.executionMode ? { executionMode: input.executionMode } : {}),
			};
			const preflight = preflightRnaseqExecution(request);
			if (!preflight.ok || !preflight.route || !preflight.binding || !preflight.workflowSpecSha256) {
				const details: ComputeRouteToolDetails = {
					route: preflight.route,
					preflight: { ok: false, errors: preflight.errors, warnings: preflight.warnings },
				};
				return {
					content: [
						{
							type: "text",
							text: hostText(
								`执行路线暂不可用：${preflight.errors.join("；")}`,
								`The compute route is not ready: ${preflight.errors.join("; ")}`,
							),
						},
					],
					details,
				};
			}
			const plan = planRnaseqExecution(request);
			const details: ComputeRouteToolDetails = {
				route: preflight.route,
				plan: {
					workflowId: plan.workflowSpec.id,
					pipeline: plan.route.pipeline,
					workflowSpecSha256: preflight.workflowSpecSha256,
					hostAlias: plan.binding.hostAlias,
					executionMode: plan.binding.executionMode,
					resources: plan.job.resources,
				},
				preflight: { ok: true, errors: [], warnings: preflight.warnings },
			};
			return {
				content: [
					{
						type: "text",
						text: hostText(
							`已生成执行路线：${plan.route.pipeline} ${plan.binding.revision}，主机 ${plan.binding.hostAlias}，工作流哈希 ${preflight.workflowSpecSha256}。下一步需要主机预检和一次执行确认。`,
							`Execution route prepared: ${plan.route.pipeline} ${plan.binding.revision} on ${plan.binding.hostAlias}, workflow hash ${preflight.workflowSpecSha256}. Host preflight and one approval are still required before execution.`,
						),
					},
				],
				details,
			};
		},
	};
}
