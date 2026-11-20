import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CriticInput, CriticResult } from "@gyoungwe/plugin-api/p5-discovery";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, onTestFinished } from "vitest";
import { createP5BackgroundScheduler } from "../services/p5-background-scheduler";
import { createP5JobSpend } from "../services/p5-job-spend";
import { createP5SpendLedger } from "../services/p5-spend-ledger";
import { StorageRegistry } from "../storage/registry";
import { createP5CriticHandler, type P5CriticPorts } from "./p5-critic-capability";
import { createP5PrimaryRunResolver } from "./p5-primary-run-facts";
import { createP5ReceiptStore } from "./p5-receipt-store";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const scope: Scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const request: CriticInput = {
	requestId: "critic-1",
	findingId: "finding-1",
	findingStatement: "Synthetic finding",
	artifactIds: ["artifact-1"],
	primaryRunReceiptRef: "primary-1",
	profile: "critic",
	budget: { maxTokens: 1_000, maxCost: null, timeoutMs: 1000, maxOutputBytes: 10000 },
};
const answer: CriticResult = {
	status: "complete",
	provider: "model-asserted",
	questions: [],
	modelReceiptRef: "asserted-ref",
	journalVersion: null,
	inquiryReceiptRefs: [],
};
const reported = {
	inputTokens: 120,
	outputTokens: 30,
	cacheReadTokens: 200,
	cacheWriteTokens: 10,
	cost: null,
};
const instant = "2026-11-18T12:00:00Z";
const clock = () => new Date(instant);

function criticBroker(ports: Pick<P5CriticPorts, "store" | "spend" | "generateStructured">) {
	const primary = createP5PrimaryRunResolver({
		runOf: async () => ({
			primaryRunReceiptRef: request.primaryRunReceiptRef,
			workspaceId: scope.workspaceId,
			sessionId: scope.sessionId,
			sourceHash: scope.callerSourceHash,
			origin: "host",
			findingIds: [request.findingId],
			provider: { providerId: "primary-provider", modelId: "primary-model" },
		}),
	});
	const handler = createP5CriticHandler({
		...ports,
		primary,
		now: () => instant,
		scope: () => scope,
		metered: true,
		resolveProfile: async () => ({ providerId: "critic-provider", modelId: "critic-model" }),
	});
	return new PluginCapabilityBroker({ resources: [], handlers: { "model.critic.review": handler } });
}

async function scheduledReview(generateStructured: P5CriticPorts["generateStructured"]) {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-critic-job-"));
	onTestFinished(() => rm(directory, { recursive: true }));
	const path = join(directory, "spend.json");
	const ledger = createP5SpendLedger({
		path,
		clock,
		localDayKey: (date) => date.toISOString().slice(0, 10),
		limitFor: () => 1_000,
	});
	const scheduler = createP5BackgroundScheduler({ spend: ledger, clock, isEnabled: () => true });
	const store = createP5ReceiptStore({
		path: join(directory, "receipts.json"),
		registry: new StorageRegistry(),
	});
	await scheduler.enqueue({
		jobId: "review-job",
		workspaceId: scope.workspaceId,
		async run(signal) {
			const jobSpend = createP5JobSpend(ledger, scope.workspaceId);
			const broker = criticBroker({ store, spend: jobSpend.gate, generateStructured });
			const caller = {
				pluginId: "fixture",
				applicationId: "fixture",
				callerIdentity: {},
				bootstrap: false,
				scope: {
					kind: "session" as const,
					workspaceId: scope.workspaceId,
					sessionId: scope.sessionId,
					workspaceDirectory: directory,
				},
				signal,
			};
			for (const requestId of ["critic-1", "critic-2"]) {
				const result = await broker.run(
					caller,
					"write",
					() => undefined,
					async () => true,
					() => broker.port.call("model.critic.review", { ...request, requestId }),
				);
				expect(result).toMatchObject({ status: "ok" });
			}
			return jobSpend.usage();
		},
	});
	await scheduler.dispose();
	return { ledger, path };
}

it("records two critic calls as one job entry without doubling the tokens", async () => {
	const { path } = await scheduledReview(async () => ({ value: answer, usage: reported }));
	expect(JSON.parse(await readFile(path, "utf8"))).toStrictEqual([
		{
			workspaceId: scope.workspaceId,
			dayKey: "2026-11-18",
			tokens: 320,
			inputTokens: 240,
			outputTokens: 60,
			cacheReadTokens: 400,
			cacheWriteTokens: 20,
			items: 1,
			unknownUsage: false,
		},
	]);
});

it("denies further spend in the workspace after a critic reports unknown usage", async () => {
	const { ledger, path } = await scheduledReview(async ({ request }) => ({
		value: answer,
		usage: request.requestId === "critic-2" ? { ...reported, inputTokens: null } : reported,
	}));
	expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject([
		{ workspaceId: scope.workspaceId, dayKey: "2026-11-18", items: 1, unknownUsage: true },
	]);
	await expect(ledger.check({ workspaceId: scope.workspaceId, metered: true })).resolves.toBe("denied");
});
