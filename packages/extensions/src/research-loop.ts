import {
	describeProject,
	resolveWorkspaceProject,
	sessionEntriesOf,
} from "@drone/knowledge/project-identity";
import { verifyLiteratureReceipt } from "@drone/research/literature-receipt";
import { createResearchReceiptJournal } from "@drone/research/receipt-journal";
import { createResearchLoop, type ResearchLoopPorts } from "@drone/research/research-loop";
import { observeExecutionReceipt } from "@drone/research/run-provenance";
import { sourceStatus as typedSourceStatus } from "@drone/research/source-archive";
import { registerTool } from "@drone/tasks/tool-manifest-runtime";
import { bindExtensionRuntime, runExtensionExclusive } from "./internal/runtime";
import { loadWorkspaceConfig } from "./workspace-config";

const CLAIM_BINDING_SCHEMA = {
	type: "array",
	maxItems: 24,
	items: { type: "object", additionalProperties: true },
};
const USER_QUESTION_FOCUS =
	"Answer the user's current question. Use evidence for factual research claims, not unrelated citations for ordinary chat. For substantive tasks, do bounded read-only preparation and consolidate scope, assumptions, needed permissions and deliverables into one task_plan for one user authorization. After authorization, carry out routine steps and recoverable checks within that scope without repeatedly asking whether to continue. Respect prior decisions, especially declined installs. New risks or scope, missing credentials and genuinely unavailable user data still require a specific request; never infer consent. At completion, explain what changed, link actual outputs or show key figures, separate execution from validation, and give one next step only if needed. Keep internal counters and tool logs out of the main answer.";

type Tool = {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	drone?: Record<string, unknown>;
	execute: (...args: any[]) => Promise<unknown>;
};
type Pi = {
	events?: {
		on?: (event: string, listener: (...args: any[]) => any) => unknown;
		emit?: (...args: any[]) => unknown;
	};
	registerTool(definition: Tool): void;
	on?: (event: string, listener: (...args: any[]) => any) => unknown;
};
type Loop = ReturnType<typeof createResearchLoop>;

type SessionState = {
	journals: Map<string, ReturnType<typeof createResearchReceiptJournal>>;
	pending: Map<
		string,
		{ args: Record<string, unknown>; journal: ReturnType<typeof createResearchReceiptJournal>; key: string }
	>;
	awaitingUserStart: Set<string>;
};

function sessionKey(ctx: any): string {
	return ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || ctx?.cwd || "";
}

export default function researchLoop(pi: Pi): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	bindExtensionRuntime(pi);
	const state: SessionState = { journals: new Map(), pending: new Map(), awaitingUserStart: new Set() };
	let loop: Loop;
	const ports: ResearchLoopPorts = {
		workspace: async (cwd) => (await loadWorkspaceConfig(cwd)) as any,
		verifyLiteratureReceipt: (input) => verifyLiteratureReceipt(input as any),
		sourceStatus: async ({ cwd, run_dir, verify }) => {
			return typedSourceStatus(
				{ cwd, run_dir, verify },
				{
					workspace: async (workspaceCwd) => (await loadWorkspaceConfig(workspaceCwd)) as any,
					publishSourceNote: async () => ({}),
					exclusive: (key, work) => runExtensionExclusive(pi, key, work),
				},
			);
		},
	};
	loop = createResearchLoop(ports);
	const run = <T>(operation: () => T | Promise<T>) => runExtensionExclusive(pi, "research-loop", operation);
	const journalFor = (ctx: any) => {
		const key = sessionKey(ctx);
		let journal = state.journals.get(key);
		if (!journal) {
			journal = createResearchReceiptJournal(ctx.cwd, {
				sessionId: key,
				ports: {
					workspace: async (cwd) => (await loadWorkspaceConfig(cwd)) as any,
					status: async (cwd, runDir) => loop.updateResearchLoop({ cwd, runDir, action: "status" }),
					flush: async (cwd, runDir) => loop.flushResearchReceipts({ cwd, runDir }),
					reset: (cwd, runDir) => loop.resetResearchReceipts({ cwd, runDir }),
					observeExecution: (event) => observeExecutionReceipt(event as any),
					observeResearch: (event) => loop.observeResearchReceipt(event as any),
				},
			});
			state.journals.set(key, journal);
		}
		return journal;
	};
	registerTool(pi, {
		name: "research_loop",
		label: "Research evidence loop",
		drone: {
			libraryMode: true,
			recoverySafe: true,
			capabilities: ["research"],
			activity: { text: "正在检查研究证据链…", phase: "verification" },
		},
		description:
			"Create or inspect a scientific evidence gate. Prefer start and status; the host advances search, inspection, archive, claims and finalize from successful tools. Structured claim_bindings with observed source excerpts are required before complete/finalize; claim_refs alone do not establish support.",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"start",
						"record_local",
						"record_external",
						"inspect_sources",
						"verify_archive",
						"bind_claims",
						"finalize",
						"complete",
						"status",
					],
				},
				run_dir: { type: "string" },
				project: {
					type: "string",
					description:
						"Optional. The host resolves the project from the workspace (or the daily-space session choice); a different value is ignored.",
				},
				result_slug: { type: "string" },
				query: { type: "string" },
				requires_provenance: { type: "boolean" },
				source_refs: { type: "array", items: { type: "string" } },
				claim_refs: { type: "array", items: { type: "string" } },
				claim_bindings: CLAIM_BINDING_SCHEMA,
				outcome: { type: "string" },
				notes: { type: "string" },
			},
			required: ["action"],
		},
		async execute(_id, params: any, _signal, _update, ctx: any) {
			return run(async () => {
				const journal = journalFor(ctx);
				const runDir = params.run_dir || journal.currentRun();
				if (params.action === "status" && !runDir) {
					const value = {
						run_dir: null,
						evidence_gate: { stage: "not-started", answerable: false },
						next_action: "start",
						guidance: "Call research_loop(action=start,query=the research question).",
					};
					return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
				}
				// One project identity per workspace (or per daily-space session); a different
				// model-supplied project is ignored and reported back.
				const projectResolution =
					params.action === "start"
						? await resolveWorkspaceProject({
								cwd: ctx.cwd,
								sessionEntries: sessionEntriesOf(ctx),
								requested: params.project,
							})
						: null;
				const result: any = await journal.execute(runDir, async () =>
					params.action === "start"
						? loop.startResearchRun({
								cwd: ctx.cwd,
								project: projectResolution?.project,
								resultSlug: params.result_slug,
								query: params.query,
								requiresProvenance: params.requires_provenance === true,
							})
						: loop.updateResearchLoop({
								cwd: ctx.cwd,
								runDir,
								action: params.action,
								query: params.query,
								sourceRefs: params.source_refs || [],
								claimRefs: params.claim_refs || [],
								claimBindings: params.claim_bindings || [],
								outcome: params.outcome,
								notes: params.notes,
							}),
				);
				const gate = result?.evidence_gate;
				const visible =
					params.action === "status"
						? result
						: {
								run_dir: result?.run_dir,
								topic_id: result?.metadata?.topic_id,
								evidence_gate: gate && {
									stage: gate.stage,
									answerable: gate.answerable,
									archive_count: gate.archive_count,
									reuse_count: gate.reuse_count,
									source_refs: gate.source_refs,
									claim_count: gate.claim_refs.length,
									structured_claim_count: gate.claim_bindings.length,
									warnings: gate.warnings,
									scientificallyVerified: false,
								},
								receipt_journal: result?.receipt_journal,
								...(projectResolution ? { project: describeProject(projectResolution) } : {}),
							};
				return { content: [{ type: "text", text: JSON.stringify(visible, null, 2) }], details: result };
			});
		},
	});
	const on = pi.on?.bind(pi);
	on?.("tool_execution_start", (event: any, ctx: any) =>
		run(() => {
			if (state.pending.size > 256) state.pending.delete(state.pending.keys().next().value as string);
			state.pending.set(event.toolCallId, {
				args: event.args || {},
				journal: journalFor(ctx),
				key: sessionKey(ctx),
			});
		}),
	);
	on?.("tool_execution_end", (event: any, ctx: any) =>
		run(async () => {
			const started = state.pending.get(event.toolCallId);
			state.pending.delete(event.toolCallId);
			if (
				!started ||
				started.key !== sessionKey(ctx) ||
				started.journal !== state.journals.get(started.key) ||
				event.toolName === "research_loop"
			)
				return;
			await started.journal.record({
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: started.args,
				details: event.result?.details || {},
				...(event.toolName === "read" ? { content: event.result?.content || [] } : {}),
				isError: !!event.isError,
			});
		}),
	);
	on?.("before_agent_start", (event: any, ctx: any) =>
		run(async () => {
			const key = sessionKey(ctx);
			state.awaitingUserStart.add(key);
			const previous = state.journals.get(key);
			state.journals.set(
				key,
				createResearchReceiptJournal(ctx.cwd, {
					sessionId: key,
					ports: {
						workspace: async (cwd) => (await loadWorkspaceConfig(cwd)) as any,
						status: async (cwd, runDir) => loop.updateResearchLoop({ cwd, runDir, action: "status" }),
						flush: async (cwd, runDir) => loop.flushResearchReceipts({ cwd, runDir }),
						reset: (cwd, runDir) => loop.resetResearchReceipts({ cwd, runDir }),
						observeExecution: (e) => observeExecutionReceipt(e as any),
						observeResearch: (e) => loop.observeResearchReceipt(e as any),
					},
				}),
			);
			state.pending.forEach((item, id) => {
				if (item.key === key) state.pending.delete(id);
			});
			await previous?.close();
			return {
				systemPrompt: `${event.systemPrompt}\n\nFor substantive research, use research_loop(action=start) when a tracked run is needed. The host checks provenance, not scientific truth. ${USER_QUESTION_FOCUS}`,
			};
		}),
	);
	on?.("message_start", (event: any, ctx: any) => {
		if (event.message?.role !== "user") return;
		return run(async () => {
			const key = sessionKey(ctx);
			if (state.awaitingUserStart.delete(key)) return;
			await state.journals.get(key)?.close();
			state.journals.delete(key);
		});
	});
	on?.("session_shutdown", (_event: any, ctx: any) =>
		run(async () => {
			const key = sessionKey(ctx);
			await state.journals.get(key)?.close();
			state.journals.delete(key);
			state.pending.forEach((item, id) => {
				if (item.key === key) state.pending.delete(id);
			});
			loop.dispose();
		}),
	);
}
