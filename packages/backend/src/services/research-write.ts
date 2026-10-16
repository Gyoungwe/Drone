import { createHash } from "node:crypto";
import type {
\tResearchWriteAdapterDescriptor,
\tResearchWriteAuditRecord,
\tResearchWriteExecuteRequest,
\tResearchWritePlan,
\tResearchWriteReceipt,
\tResearchWriteRequest,
} from "@drone/shared";
import {
\tResearchWriteAdapterRegistry,
\ttype ResearchWriteAdapter,
} from "@drone/research";
import type { JsonStore } from "../json-store";

export interface ResearchWriteLedger {
\tversion: 1;
\tplans: ResearchWritePlan[];
\taudit: ResearchWriteAuditRecord[];
}

export const emptyResearchWriteLedger: ResearchWriteLedger = {
\tversion: 1,
\tplans: [],
\taudit: [],
};

export interface ResearchWriteServiceOptions {
\treadonly store: JsonStore<ResearchWriteLedger>;
\treadonly adapters?: ResearchWriteAdapterRegistry;
}

function auditId(planId: string, status: string): string {
\treturn `research-write-audit-${createHash("sha256").update(`${planId}:${status}:${Date.now()}`).digest("hex").slice(0, 24)}`;
}

function payloadHash(plan: ResearchWritePlan): string {
\treturn createHash("sha256").update(JSON.stringify(plan.payload)).digest("hex");
}

/**
 * Host-side write coordinator. It only persists bounded plans and metadata;
 * adapters perform external work after a fresh, per-call user approval.
 */
export class ResearchWriteService {
\tprivate readonly adapters: ResearchWriteAdapterRegistry;

\tconstructor(private readonly options: ResearchWriteServiceOptions) {
\t\tthis.adapters = options.adapters ?? new ResearchWriteAdapterRegistry();
\t}

\tlistAdapters(): readonly ResearchWriteAdapterDescriptor[] {
\t\treturn this.adapters.descriptors();
\t}

\tasync prepare(input: ResearchWriteRequest): Promise<ResearchWritePlan> {
\t\tconst adapter = this.requireAdapter(input.adapterId);
\t\tconst plan = adapter.prepare(input);
\t\tawait this.options.store.update((state) => {
\t\t\tstate.version = 1;
\t\t\tconst existing = state.plans.find((item) => item.id === plan.id);
\t\t\tif (!existing) state.plans.push(plan);
\t\t\tstate.audit.push({
\t\t\t\tid: auditId(plan.id, "prepared"),
\t\t\t\tplanId: plan.id,
\t\t\t\tadapterId: plan.adapterId,
\t\t\t\ttargetRef: plan.targetRef,
\t\t\t\tpayloadHash: payloadHash(plan),
\t\t\t\tstatus: "prepared",
\t\t\t\tapproval: "missing",
\t\t\t\tat: new Date().toISOString(),
\t\t\t});
\t\t\tstate.audit = state.audit.slice(-500);
\t\t});
\t\treturn plan;
\t}

\tasync execute(input: ResearchWriteExecuteRequest): Promise<ResearchWriteReceipt> {
\t\tconst state = await this.options.store.read();
\t\tconst plan = state.plans.find((item) => item.id === input.planId);
\t\tif (!plan) throw new Error(`Research write plan not found: ${input.planId}`);
\t\tif (plan.status !== "ready") {
\t\t\treturn this.blocked(plan, "Research write plan is revoked or already consumed");
\t\t}
\t\tif (!input.approved) return this.blocked(plan, "Explicit user approval is required");
\t\tconst adapter = this.requireAdapter(plan.adapterId);
\t\tlet receipt: ResearchWriteReceipt;
\t\ttry {
\t\t\treceipt = await adapter.execute(plan, { approved: true });
\t\t} catch (cause) {
\t\t\treceipt = {
\t\t\t\tplanId: plan.id,
\t\t\t\tadapterId: plan.adapterId,
\t\t\t\tstatus: "failed",
\t\t\t\tat: new Date().toISOString(),
\t\t\t\treadBack: "not-applicable",
\t\t\t\tfailureReason: cause instanceof Error ? cause.message.slice(0, 500) : String(cause).slice(0, 500),
\t\t\t};
\t\t}
\t\tawait this.options.store.update((next) => {
\t\t\tconst found = next.plans.find((item) => item.id === plan.id);
\t\t\tif (found) found.status = "revoked";
\t\t\tnext.audit.push({
\t\t\t\tid: auditId(plan.id, receipt.status),
\t\t\t\tplanId: plan.id,
\t\t\t\tadapterId: plan.adapterId,
\t\t\t\ttargetRef: plan.targetRef,
\t\t\t\tpayloadHash: payloadHash(plan),
\t\t\t\tstatus: receipt.status,
\t\t\t\tapproval: "explicit",
\t\t\t\tat: receipt.at,
\t\t\t\t...(receipt.externalRef ? { externalRef: receipt.externalRef } : {}),
\t\t\t\t...(receipt.failureReason ? { failureReason: receipt.failureReason } : {}),
\t\t\t});
\t\t\tnext.audit = next.audit.slice(-500);
\t\t});
\t\treturn receipt;
\t}

\tasync revoke(planId: string): Promise<boolean> {
\t\tlet changed = false;
\t\tawait this.options.store.update((state) => {
\t\t\tconst plan = state.plans.find((item) => item.id === planId);
\t\t\tif (!plan || plan.status !== "ready") return;
\t\t\tplan.status = "revoked";
\t\t\tchanged = true;
\t\t\tstate.audit.push({
\t\t\t\tid: auditId(plan.id, "revoked"),
\t\t\t\tplanId: plan.id,
\t\t\t\tadapterId: plan.adapterId,
\t\t\t\ttargetRef: plan.targetRef,
\t\t\t\tpayloadHash: payloadHash(plan),
\t\t\t\tstatus: "revoked",
\t\t\t\tapproval: "missing",
\t\t\t\tat: new Date().toISOString(),
\t\t\t});
\t\t\tstate.audit = state.audit.slice(-500);
\t\t});
\t\treturn changed;
\t}

\tasync listAudit(limit = 100): Promise<readonly ResearchWriteAuditRecord[]> {
\t\tconst state = await this.options.store.read();
\t\treturn [...state.audit].slice(-Math.max(1, Math.min(500, Math.trunc(limit)))).reverse();
\t}

\tprivate requireAdapter(id: string): ResearchWriteAdapter {
\t\tconst adapter = this.adapters.get(id);
\t\tif (!adapter) throw new Error(`Research write adapter not found: ${id}`);
\t\treturn adapter;
\t}

\tprivate async blocked(plan: ResearchWritePlan, reason: string): Promise<ResearchWriteReceipt> {
\t\tconst receipt: ResearchWriteReceipt = {
\t\t\tplanId: plan.id,
\t\t\tadapterId: plan.adapterId,
\t\t\tstatus: "blocked",
\t\t\t at: new Date().toISOString(),
\t\t\treadBack: "not-applicable",
\t\t\tfailureReason: reason,
\t\t};
\t\tawait this.options.store.update((state) => {
\t\t\tstate.audit.push({
\t\t\t\tid: auditId(plan.id, "blocked"),
\t\t\t\tplanId: plan.id,
\t\t\t\tadapterId: plan.adapterId,
\t\t\t\ttargetRef: plan.targetRef,
\t\t\t\tpayloadHash: payloadHash(plan),
\t\t\t\tstatus: "blocked",
\t\t\t\tapproval: "missing",
\t\t\t\tat: receipt.at,
\t\t\t\tfailureReason: reason,
\t\t\t});
\t\t\tstate.audit = state.audit.slice(-500);
\t\t});
\t\treturn receipt;
\t}
}
