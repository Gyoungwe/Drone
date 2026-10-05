import { budgetStatus, type HarnessBudgetStatus, type TaskView } from "@drone/shared";
import { createLogger } from "../../log";
import type { ExtensionContext, InlineExtension } from "../sdk";
import { taskViewFromBranch } from "./branch";

const log = createLogger("harness-delivery");
const DELIVERY_TYPE = "drone-harness-delivery-v1";
export interface HarnessDeliveryStatus {
	taskId?: string;
	complete: boolean;
	missing: string[];
	unsettled: string[];
	budget: HarnessBudgetStatus;
}
/** Reuse host acceptance and operation states. This is not a new verifier. */
export function assessTaskDelivery(view: TaskView): HarnessDeliveryStatus {
	const task = view.tasks.find((task) => task.id === view.activeTaskId);
	if (!task) return { complete: false, missing: [], unsettled: [], budget: budgetStatus(0, 0) };
	const missing = task.milestones
		.filter((m) => m.state !== "completed")
		.map((m) => `${m.id}: ${m.title}${m.acceptance.path ? ` (${m.acceptance.path})` : ""}`)
		.slice(0, 8);
	const unsettled = [
		...task.operations
			.filter((o) => o.state === "started" || o.state === "unknown")
			.map((o) => `operation ${o.id}: ${o.state}`),
		...task.actions.filter((a) => a.state === "pending").map((a) => `user action ${a.id}: ${a.title}`),
	].slice(0, 8);
	return {
		taskId: task.id,
		complete: task.milestones.length > 0 && missing.length === 0 && unsettled.length === 0,
		missing,
		unsettled,
		budget: budgetStatus(task.budget.calls, view.limits.totalCalls),
	};
}
export function renderDeliveryStatus(status: HarnessDeliveryStatus): string {
	return `Host delivery check: ${status.complete ? "recorded acceptance satisfied" : "incomplete"}; missing: ${status.missing.join("; ") || "none recorded"}; unsettled: ${status.unsettled.join("; ") || "none"}; budget ${status.budget.used}/${status.budget.limit} (${status.budget.level}). Do not claim missing or unchecked deliverables are complete. Acceptance is operational, not scientific certification.`;
}
/** Observe delivery at the loop boundary; task runtime remains the only continuation owner. */
export interface HarnessDeliveryExtensionOptions {
	report?: (sessionId: string, kind: string, data: unknown) => void;
	recordUnit?: (sessionId: string, unit: "delivery", action: "gap") => void;
}

type HarnessDeliveryReporter = HarnessDeliveryExtensionOptions["report"];

export function makeHarnessDeliveryExtension(
	optionsOrReport: HarnessDeliveryExtensionOptions | HarnessDeliveryReporter = {},
): InlineExtension {
	const options = typeof optionsOrReport === "function" ? { report: optionsOrReport } : optionsOrReport;
	return {
		name: "harness-delivery",
		factory: (pi) => {
			let last = "";
			const restore = (_event: unknown, ctx: ExtensionContext) => {
				last = "";
				for (const entry of ctx.sessionManager.getBranch()) {
					if (entry.type === "custom" && entry.customType === DELIVERY_TYPE) {
						const data = entry.data as { fingerprint?: unknown } | undefined;
						if (typeof data?.fingerprint === "string") last = data.fingerprint;
					}
				}
			};
			pi.on("session_start", restore);
			pi.on("session_tree", restore);
			pi.on("agent_before_settle", (_event, ctx) => {
				try {
					const view = taskViewFromBranch(ctx.sessionManager.getBranch());
					if (!view) return;
					const status = assessTaskDelivery(view);
					const fingerprint = JSON.stringify(status);
					if (fingerprint === last) return;
					last = fingerprint;
					const data = { ...status, message: renderDeliveryStatus(status) };
					pi.appendEntry(DELIVERY_TYPE, { fingerprint, status });
					options.report?.(ctx.sessionManager.getSessionId(), "harness_delivery", data);
					if (!status.complete) {
						options.recordUnit?.(ctx.sessionManager.getSessionId(), "delivery", "gap");
					}
				} catch (error) {
					log.warn("harness delivery failed", { error: String(error) });
				}
			});
		},
	};
}
