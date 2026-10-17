import { createHash } from "node:crypto";
import { type ResearchWriteAdapter, ResearchWriteAdapterRegistry } from "@drone/research";
import type {
	ResearchWriteAdapterDescriptor,
	ResearchWriteAuditRecord,
	ResearchWriteExecuteRequest,
	ResearchWritePlan,
	ResearchWriteReceipt,
	ResearchWriteRequest,
} from "@drone/shared";
import type { JsonStore } from "../json-store";

export interface ResearchWriteLedger {
	version: 1;
	plans: ResearchWritePlan[];
	audit: ResearchWriteAuditRecord[];
}

export function createEmptyResearchWriteLedger(): ResearchWriteLedger {
	return {
		version: 1,
		plans: [],
		audit: [],
	};
}

export const emptyResearchWriteLedger: ResearchWriteLedger = createEmptyResearchWriteLedger();

export interface ResearchWriteServiceOptions {
	readonly store: JsonStore<ResearchWriteLedger>;
	readonly adapters?: ResearchWriteAdapterRegistry;
}

function auditId(planId: string, status: string): string {
	return `research-write-audit-${createHash("sha256").update(`${planId}:${status}:${Date.now()}`).digest("hex").slice(0, 24)}`;
}

function payloadHash(plan: ResearchWritePlan): string {
	return createHash("sha256").update(JSON.stringify(plan.payload)).digest("hex");
}

/**
 * Host-side write coordinator. It only persists bounded plans and metadata;
 * adapters perform external work after a fresh, per-call user approval.
 */
export class ResearchWriteService {
	private readonly adapters: ResearchWriteAdapterRegistry;

	constructor(private readonly options: ResearchWriteServiceOptions) {
		this.adapters = options.adapters ?? new ResearchWriteAdapterRegistry();
	}

	listAdapters(): readonly ResearchWriteAdapterDescriptor[] {
		return this.adapters.descriptors();
	}

	async prepare(input: ResearchWriteRequest): Promise<ResearchWritePlan> {
		const adapter = this.requireAdapter(input.adapterId);
		const plan = adapter.prepare(input);
		await this.options.store.update((state) => {
			state.version = 1;
			const existing = state.plans.find((item) => item.id === plan.id);
			if (!existing) state.plans.push(plan);
			state.audit.push({
				id: auditId(plan.id, "prepared"),
				planId: plan.id,
				adapterId: plan.adapterId,
				targetRef: plan.targetRef,
				payloadHash: payloadHash(plan),
				status: "prepared",
				approval: "missing",
				at: new Date().toISOString(),
			});
			state.audit = state.audit.slice(-500);
		});
		return plan;
	}

	async execute(input: ResearchWriteExecuteRequest): Promise<ResearchWriteReceipt> {
		const state = await this.options.store.read();
		const current = state.plans.find((item) => item.id === input.planId);
		if (!current) throw new Error(`Research write plan not found: ${input.planId}`);
		if (current.status !== "ready") {
			return this.blocked(
				current,
				current.status === "executing"
					? "Research write plan is already executing"
					: "Research write plan is revoked or already consumed",
				input.approved ? "explicit" : "missing",
			);
		}
		if (!input.approved) return this.blocked(current, "Explicit user approval is required", "missing");

		// Reserve the plan in the JsonStore queue before invoking any external port.
		// A concurrent caller observes executing/revoked and cannot double-write.
		let reservedPlan: ResearchWritePlan | undefined;
		await this.options.store.update((next) => {
			const candidate = next.plans.find((item) => item.id === input.planId);
			if (candidate?.status !== "ready") return;
			const index = next.plans.indexOf(candidate);
			const reservation = { ...candidate, status: "executing" as const };
			reservedPlan = reservation;
			next.plans[index] = reservation;
			next.audit.push({
				id: auditId(candidate.id, "executing"),
				planId: candidate.id,
				adapterId: candidate.adapterId,
				targetRef: candidate.targetRef,
				payloadHash: payloadHash(candidate),
				status: "executing",
				approval: "explicit",
				at: new Date().toISOString(),
			});
			next.audit = next.audit.slice(-500);
		});
		if (!reservedPlan) {
			const latest = await this.options.store.read();
			const observed = latest.plans.find((item) => item.id === input.planId);
			if (!observed) throw new Error(`Research write plan not found: ${input.planId}`);
			return this.blocked(
				observed,
				observed.status === "executing"
					? "Research write plan is already executing"
					: "Research write plan is revoked or already consumed",
				"explicit",
			);
		}
		const plan = reservedPlan;
		let receipt: ResearchWriteReceipt;
		try {
			const adapter = this.requireAdapter(plan.adapterId);
			receipt = await adapter.execute(plan, { approved: true });
		} catch (cause) {
			receipt = {
				planId: plan.id,
				adapterId: plan.adapterId,
				status: "failed",
				at: new Date().toISOString(),
				readBack: "not-applicable",
				failureReason: cause instanceof Error ? cause.message.slice(0, 500) : String(cause).slice(0, 500),
			};
		}
		await this.options.store.update((next) => {
			const found = next.plans.find((item) => item.id === plan.id);
			if (found) {
				const index = next.plans.indexOf(found);
				next.plans[index] = { ...found, status: "revoked" };
			}
			next.audit.push({
				id: auditId(plan.id, receipt.status),
				planId: plan.id,
				adapterId: plan.adapterId,
				targetRef: plan.targetRef,
				payloadHash: payloadHash(plan),
				status: receipt.status,
				approval: "explicit",
				at: receipt.at,
				...(receipt.externalRef ? { externalRef: receipt.externalRef } : {}),
				...(receipt.failureReason ? { failureReason: receipt.failureReason } : {}),
				...(receipt.deleted ? { deleted: receipt.deleted } : {}),
			});
			next.audit = next.audit.slice(-500);
		});
		return receipt;
	}

	async revoke(planId: string): Promise<boolean> {
		let changed = false;
		await this.options.store.update((state) => {
			const plan = state.plans.find((item) => item.id === planId);
			if (plan?.status !== "ready") return;
			const index = state.plans.indexOf(plan);
			state.plans[index] = { ...plan, status: "revoked" };
			changed = true;
			state.audit.push({
				id: auditId(plan.id, "revoked"),
				planId: plan.id,
				adapterId: plan.adapterId,
				targetRef: plan.targetRef,
				payloadHash: payloadHash(plan),
				status: "revoked",
				approval: "missing",
				at: new Date().toISOString(),
			});
			state.audit = state.audit.slice(-500);
		});
		return changed;
	}

	async listAudit(limit = 100): Promise<readonly ResearchWriteAuditRecord[]> {
		const state = await this.options.store.read();
		return [...state.audit].slice(-Math.max(1, Math.min(500, Math.trunc(limit)))).reverse();
	}

	private requireAdapter(id: string): ResearchWriteAdapter {
		const adapter = this.adapters.get(id);
		if (!adapter) throw new Error(`Research write adapter not found: ${id}`);
		return adapter;
	}

	private async blocked(
		plan: ResearchWritePlan,
		reason: string,
		approval: "explicit" | "missing",
	): Promise<ResearchWriteReceipt> {
		const receipt: ResearchWriteReceipt = {
			planId: plan.id,
			adapterId: plan.adapterId,
			status: "blocked",
			at: new Date().toISOString(),
			readBack: "not-applicable",
			failureReason: reason,
		};
		await this.options.store.update((state) => {
			const found = state.plans.find((item) => item.id === plan.id);
			if (found?.status === "ready") {
				const index = state.plans.indexOf(found);
				state.plans[index] = { ...found, status: "revoked" };
			}
			state.audit.push({
				id: auditId(plan.id, "blocked"),
				planId: plan.id,
				adapterId: plan.adapterId,
				targetRef: plan.targetRef,
				payloadHash: payloadHash(plan),
				status: "blocked",
				approval,
				at: receipt.at,
				failureReason: reason,
			});
			state.audit = state.audit.slice(-500);
		});
		return receipt;
	}
}
