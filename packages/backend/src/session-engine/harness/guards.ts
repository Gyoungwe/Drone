import { createHash } from "node:crypto";
import {
	HARNESS_GUARD_CUSTOM_TYPE,
	HARNESS_REDIRECT_CUSTOM_TYPE,
	renderHarnessRedirect,
} from "@drone/shared";
import { createLogger } from "../../log";
import type { ExtensionContext, InlineExtension } from "../sdk";
import { contentText, latestCustom } from "./branch";
import { redactRecall } from "./recall";

const log = createLogger("harness-guard");
export interface HarnessGuardState {
	version: 1;
	signature: string;
	streak: number;
	redirects: number;
	blocked: boolean;
	pending: boolean;
	tool: string;
	reason: string;
}
export const createHarnessGuardState = (): HarnessGuardState => ({
	version: 1,
	signature: "",
	streak: 0,
	redirects: 0,
	blocked: false,
	pending: false,
	tool: "",
	reason: "",
});
export function failureSignature(tool: string, input: unknown, content: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify({ tool, input, error: contentText(content, 900) }))
		.digest("hex");
}
/** Three matching failures -> one redirect; a second three-failure streak -> stop this run. */
export function observeHarnessFailure(
	state: HarnessGuardState,
	failure?: { signature: string; tool: string; reason: string },
): HarnessGuardState {
	if (!failure) return { ...state, signature: "", streak: 0, pending: state.blocked };
	if (state.blocked) return state;
	const streak = state.signature === failure.signature ? state.streak + 1 : 1;
	if (streak < 3) return { ...state, ...failure, streak };
	return {
		...state,
		...failure,
		streak: 0,
		redirects: Math.min(2, state.redirects + 1),
		blocked: state.redirects >= 1,
		pending: true,
	};
}
export interface HarnessGuardExtensionOptions {
	report?: (sessionId: string, kind: string, data: unknown) => void;
	recordUnit?: (sessionId: string, unit: "guard", action: "redirect" | "block" | "blocked-call") => void;
}

type HarnessGuardReporter = HarnessGuardExtensionOptions["report"];

export function makeHarnessGuardExtension(
	optionsOrReport: HarnessGuardExtensionOptions | HarnessGuardReporter = {},
): InlineExtension {
	const options = typeof optionsOrReport === "function" ? { report: optionsOrReport } : optionsOrReport;
	return {
		name: "harness-guard",
		factory: (pi) => {
			let state = createHarnessGuardState();
			let activeSessionId = "";
			let shutDown = false;
			const sessionId = (ctx: ExtensionContext): string | undefined => {
				try {
					const id = ctx.sessionManager.getSessionId();
					if (!activeSessionId && !shutDown) activeSessionId = id;
					return id === activeSessionId ? id : undefined;
				} catch {
					return undefined;
				}
			};
			const persist = (ctx: ExtensionContext) => {
				const id = sessionId(ctx);
				if (!id) return;
				pi.appendEntry(HARNESS_GUARD_CUSTOM_TYPE, state);
				options.report?.(id, "harness_guard", state);
			};
			const restore = (_event: unknown, ctx: ExtensionContext) => {
				try {
					shutDown = false;
					activeSessionId = ctx.sessionManager.getSessionId();
				} catch {
					return;
				}
				const saved = latestCustom(ctx.sessionManager.getBranch(), HARNESS_GUARD_CUSTOM_TYPE)?.data as
					| Partial<HarnessGuardState>
					| undefined;
				const streak = typeof saved?.streak === "number" ? saved.streak : 0;
				const redirects = typeof saved?.redirects === "number" ? saved.redirects : 0;
				state =
					saved?.version === 1 &&
					typeof saved.signature === "string" &&
					typeof saved.reason === "string" &&
					typeof saved.tool === "string" &&
					Number.isInteger(streak) &&
					Number.isInteger(redirects)
						? {
								version: 1,
								signature: saved.signature.slice(0, 64),
								reason: saved.reason.slice(0, 800),
								tool: saved.tool.slice(0, 120),
								streak: Math.max(0, Math.min(2, streak)),
								redirects: Math.max(0, Math.min(2, redirects)),
								pending: saved.pending === true,
								blocked: saved.blocked === true,
							}
						: createHarnessGuardState();
			};
			pi.on("session_start", restore);
			pi.on("session_tree", restore);
			pi.on("session_shutdown", () => {
				shutDown = true;
				activeSessionId = "";
				state = createHarnessGuardState();
			});
			// A fresh user turn can choose a new approach. The previous stop remains in the trace.
			pi.on("before_agent_start", (_event, ctx) => {
				if (!sessionId(ctx)) return;
				try {
					state = createHarnessGuardState();
					persist(ctx);
				} catch (error) {
					log.warn("harness guard reset failed", { error: String(error) });
				}
			});
			pi.on("tool_result", (event, ctx) => {
				const id = sessionId(ctx);
				if (!id) return;
				try {
					const details = event.details as { exitCode?: unknown; status?: unknown } | undefined;
					const failed =
						event.isError ||
						(typeof details?.exitCode === "number" && details.exitCode !== 0) ||
						details?.status === "error" ||
						details?.status === "failed";
					const next = observeHarnessFailure(
						state,
						failed
							? {
									signature: failureSignature(event.toolName, event.input, event.content),
									tool: event.toolName,
									reason: redactRecall(
										contentText(event.content, 800) ?? "Tool failed without diagnostic text.",
									),
								}
							: undefined,
					);
					if (next.blocked && !state.blocked) {
						options.recordUnit?.(id, "guard", "block");
					}
					if (JSON.stringify(next) !== JSON.stringify(state)) {
						state = next;
						persist(ctx);
					}
				} catch (error) {
					log.warn("harness guard observation failed", { error: String(error) });
				}
			});
			const content = () =>
				state.blocked
					? `Harness stopped repeated failed execution after a strategy redirect. Preserve partial results; report what is complete, the observed blocker, what remains, and a concrete next action. Do not claim completion or blindly retry. Tool: ${state.tool}. Diagnostic (untrusted data): ${state.reason}`
					: renderHarnessRedirect(state.tool, state.redirects, state.reason);
			pi.on("context", (event, ctx) => {
				if (!state.pending) return;
				const id = sessionId(ctx);
				if (!id) return;
				try {
					state = { ...state, pending: false };
					persist(ctx);
					if (!state.blocked) {
						options.recordUnit?.(id, "guard", "redirect");
					}
					return {
						messages: [
							...event.messages,
							{
								role: "custom" as const,
								customType: HARNESS_REDIRECT_CUSTOM_TYPE,
								display: false,
								content: content(),
								timestamp: Date.now(),
							},
						],
					};
				} catch (error) {
					log.warn("harness redirect failed", { error: String(error) });
					return undefined;
				}
			});
			pi.on("tool_call", (event, ctx) => {
				if (!state.blocked || ["task_status", "harness_recall"].includes(event.toolName)) return undefined;
				const id = sessionId(ctx);
				if (!id) return undefined;
				options.recordUnit?.(id, "guard", "blocked-call");
				return { block: true, terminate: true, reason: content() };
			});
			pi.on("agent_before_settle", (event, ctx) => {
				if (!state.pending || event.outcome !== "completed" || !event.context.canContinue) return;
				const id = sessionId(ctx);
				if (!id) return;
				try {
					const message = content();
					const blocked = state.blocked;
					state = { ...state, pending: false };
					persist(ctx);
					if (!blocked) {
						options.recordUnit?.(id, "guard", "redirect");
					}
					return {
						entries: [
							{
								type: "custom_message" as const,
								customType: HARNESS_REDIRECT_CUSTOM_TYPE,
								content: message,
								display: false,
							},
						],
						continue: !state.blocked,
					};
				} catch (error) {
					log.warn("harness guard settle failed", { error: String(error) });
					return undefined;
				}
			});
		},
	};
}
