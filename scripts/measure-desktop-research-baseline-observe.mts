import { isDeepStrictEqual } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	containedRealPath,
	validateDesktopObservation,
} from "./measure-desktop-research-baseline-contract.mts";
import { type DesktopFixture } from "./measure-desktop-research-baseline-fixture.mts";
import { objectFields } from "./measure-desktop-research-baseline-faux.mts";
import { checked, readJson } from "./research-baseline-io.mts";

const text = Type.String({ minLength: 1 });
const count = Type.Integer({ minimum: 0 });
const sources = Type.Array(Type.Object({ path: text, hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
	read_receipt_id: text, originalFulltextReadThisTurn: Type.Literal(false) }));
const metadataSchema = Type.Object({
	mode: Type.Enum(["deep_research", "fast_readonly"]),
	status: text,
	evidence_gate: Type.Object({
		stage: text, status: text, answerable: Type.Boolean(), archive_count: count, reuse_count: count,
		claim_bindings: Type.Array(Type.Object({ sources, scientificallyVerified: Type.Literal(false) })),
	}),
	breaker_receipt: Type.Optional(Type.Object({ id: text, reason: text, limitKind: text,
		limits: Type.Object({ maxBilledTokens: count }), measured: Type.Object({ steps: count }) })),
});

export async function snapshotVault(root: string, directory = root): Promise<{ path: string; bytes: Buffer | null }[]> {
	const snapshot = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
		const path = await containedRealPath(root, join(directory, entry.name));
		if (!entry.isDirectory() && !entry.isFile()) throw new Error("Unsupported Vault snapshot entry");
		snapshot.push({ path, bytes: entry.isFile() ? await readFile(path) : null });
		if (entry.isDirectory()) snapshot.push(...await snapshotVault(root, path));
	}
	return snapshot;
}

function codes(value: unknown): string[] {
	return Array.isArray(value) ? value.flatMap((item: unknown) => {
		const { code } = objectFields(item);
		return typeof code === "string" && /^[a-z0-9-]+$/.test(code) ? [code] : [];
	}) : [];
}

export function observeDesktopEvents() {
	const state = { preflight: { checked: false, ok: null as boolean | null, warnings: [] as string[], errors: [] as string[] },
		publication: { published: false, rejected: false, warnings: [] as string[], errors: [] as string[] },
		usage: [] as null[], checkedCitations: 0, assistantStop: "", publicationStatus: "", failedTools: [] as string[] };
	function observe(event: AgentSessionEvent) {
		if (event.type === "message_end" && event.message.role === "assistant") {
			state.usage.push(null);
			state.assistantStop = event.message.stopReason;
			const proof = objectFields(objectFields(event.message).knowledgePublication);
			if (proof.status === "tool-only") return;
			state.publicationStatus = typeof proof.status === "string" ? proof.status : "absent";
			state.publication = { published: proof.status === "released" || proof.status === "no-hits",
				rejected: proof.status === "blocked", warnings: codes(proof.warnings), errors: codes([{ code: proof.reason }]) };
			state.checkedCitations = Array.isArray(proof.sources) ? new Set(proof.sources.flatMap((item: unknown) => {
				const { path } = objectFields(item);
				return typeof path === "string" ? [path] : [];
			})).size : 0;
		}
		if (event.type !== "tool_execution_end") return;
		if (event.isError) state.failedTools.push(event.toolName);
		if (event.toolName !== "research_check_answer") return;
		const details = objectFields(objectFields(event.result).details);
		state.preflight = { checked: true, ok: !event.isError && details.ok === true,
			warnings: [...codes(details.warnings), ...codes(objectFields(details.proof).warnings)],
			errors: event.isError ? ["tool-error"] : codes([details]) };
	}
	return { observe, state };
}

type Events = ReturnType<typeof observeDesktopEvents>["state"];
type Counters = { toolCalls: string[]; requested: number; denied: number; depositExecuteEntered: number; limitReached: boolean };

function stopReason(events: Events, counters: Counters, status: string, breakerReason?: string) {
	if (breakerReason) return breakerReason;
	if (counters.limitReached) return "harness-tool-limit";
	if (events.assistantStop === "error") return "error";
	if (events.assistantStop === "aborted") return "user-abort";
	if (status !== "completed") return "voluntary-stop";
	return counters.denied ? "completed-with-write-denied" : "completed";
}

export async function finishObservation(input: {
	fixture: DesktopFixture; runDir: string; contextWindow: number; toolSet: string[]; events: Events; counters: Counters;
	vaultBefore: Awaited<ReturnType<typeof snapshotVault>>; elapsedMs: number; networkViolations: number;
}) {
	const { fixture, runDir, events, counters } = input;
	const path = await containedRealPath(runDir, join(runDir, "metadata.json"));
	const native = checked(metadataSchema, await readJson(path), "native research metadata");
	const gate = native.evidence_gate, breakerReceipt = native.breaker_receipt ?? null;
	const boundPaths = new Set(gate.claim_bindings.flatMap(({ sources: bindings }) => bindings.map(({ path }) => path)));
	const reason = stopReason(events, counters, native.status, breakerReceipt?.reason);
	const expected = fixture.scenario.expected;
	const approvalRequests = fixture.scenario.id === "external-write" ? 1 : 0;
	const sequence = fixture.scenario.fauxCalls.map(({ name }) => name);
	return validateDesktopObservation({
		scenarioId: fixture.scenario.id, contextWindow: input.contextWindow, toolSet: input.toolSet,
		toolCalls: counters.toolCalls, usage: events.usage, elapsedMs: input.elapsedMs, networkViolations: input.networkViolations,
		routeObserved: native.mode, runStatus: native.status,
		evidence: { gateStage: gate.stage, gateStatus: gate.status, answerable: gate.answerable,
			boundSourceCount: boundPaths.size, identityVerifiedNoteCount: gate.reuse_count, archiveVerifiedCount: gate.archive_count,
			publicationCheckedVaultCitationCount: events.checkedCitations,
			archivedTextRead: gate.archive_count > 0 && [...boundPaths].some((path) => path.startsWith(`${runDir}/sources/`)),
			originalFulltextReadThisTurn: false, scientificallyVerified: false },
		preflight: events.preflight, publication: events.publication,
		stop: { reason, breakerReceipt },
		approvals: { requested: counters.requested, denied: counters.denied, approved: 0, depositExecuteEntered: counters.depositExecuteEntered,
			vaultUnchanged: isDeepStrictEqual(input.vaultBefore, await snapshotVault(fixture.vault)) },
		expectationMatched: expected.gateStage === gate.stage && expected.runStatus === native.status && expected.stopReason === reason &&
			isDeepStrictEqual(sequence, counters.toolCalls) && counters.requested === approvalRequests,
	});
}
