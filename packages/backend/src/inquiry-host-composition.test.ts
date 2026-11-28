import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { afterEach, expect, it, vi } from "vitest";
import { attachInquiryHostComposition } from "./inquiry-host-composition";
import { HostEventBridge } from "./plugins/host-event-bridge";
import { canonicalProjectId } from "./project-id";
import {
	type InquiryComputeEvent,
	type InquiryDecisionEvent,
	InquiryService,
	type InquiryTaskTerminalEvent,
} from "./services/inquiry";

const roots: string[] = [];
afterEach(async () => rmRoots());

type ComputeTestEvent = InquiryComputeEvent | { readonly type: "cleanup"; readonly jobId: string };

async function rmRoots(): Promise<void> {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

async function fixture(enabled: boolean) {
	const root = await mkdtemp(join(tmpdir(), "inquiry-host-events-"));
	roots.push(root);
	const inquiry = new InquiryService(
		enabled ? { inquiryDir: root, projectId: root } : {},
		new PluginResourceReservations(root),
	);
	const inquiryEvents = {
		compute: [] as InquiryComputeEvent[],
		task: [] as InquiryTaskTerminalEvent[],
		decision: [] as InquiryDecisionEvent[],
	};
	vi.spyOn(inquiry, "recordComputeEvent").mockImplementation(
		async (event) => void inquiryEvents.compute.push(event),
	);
	vi.spyOn(inquiry, "recordTaskTerminal").mockImplementation(
		async (event) => void inquiryEvents.task.push(event),
	);
	vi.spyOn(inquiry, "recordDecision").mockImplementation(
		async (event) => void inquiryEvents.decision.push(event as InquiryDecisionEvent),
	);
	const computeHandlers = new Set<(event: ComputeTestEvent) => void>();
	const sessionHandlers = new Set<(sessionId: string, event: AgentSessionEvent) => void>();
	const decisionHandlers = new Set<(event: unknown) => void>();
	const bridge = new HostEventBridge();
	const hostEvents = bridge.source(
		["inquiry.compute", "inquiry.task-terminal", "inquiry.decision"],
		new AbortController().signal,
	);
	const hostPayloads: unknown[] = [];
	for (const topic of ["inquiry.compute", "inquiry.task-terminal", "inquiry.decision"] as const)
		hostEvents.subscribe(topic, (event) => hostPayloads.push(event));
	const compute = {
		onEvent: (handler: (event: ComputeTestEvent) => void) => {
			computeHandlers.add(handler);
			return () => computeHandlers.delete(handler);
		},
		getJob: async () => null,
	};
	const sessions = {
		hostEvents: bridge,
		registry: { get: () => ({ cwd: root }) },
		onEvent: (handler: (sessionId: string, event: AgentSessionEvent) => void) => {
			sessionHandlers.add(handler);
			return () => sessionHandlers.delete(handler);
		},
		onDecision: (handler: (event: unknown) => void) => {
			decisionHandlers.add(handler);
			return () => decisionHandlers.delete(handler);
		},
	};
	const detach = attachInquiryHostComposition(
		inquiry,
		sessions as never,
		compute as never,
		{} as never,
		{ defaultCwd: root },
		root,
	);
	return {
		root,
		inquiry,
		inquiryEvents,
		computeHandlers,
		sessionHandlers,
		decisionHandlers,
		hostPayloads,
		detach,
	};
}

it("attaches and clears the Inquiry rerun port with the host composition", async () => {
	const inquiry = new InquiryService({});
	const ports: unknown[] = [];
	const sessions = {
		hostEvents: new HostEventBridge(),
		registry: { get: () => undefined },
		onEvent: () => () => undefined,
		onDecision: () => () => undefined,
		setInquiryRerunPort: (port: unknown) => ports.push(port),
	};
	const compute = { onEvent: () => () => undefined };
	const detach = attachInquiryHostComposition(
		inquiry,
		sessions as never,
		compute as never,
		{} as never,
		{},
		"",
	);
	try {
		expect(ports).toEqual([inquiry]);
		detach();
		expect(ports).toEqual([inquiry, undefined]);
	} finally {
		await inquiry.dispose();
	}
});

const computeEvent: InquiryComputeEvent = {
	id: "compute-event",
	jobId: "job-1",
	type: "collected",
	at: "2026-11-28T00:00:00Z",
	status: "succeeded",
	cursor: "cursor-1",
	detail: "collected",
	runId: "run-1",
	startedAt: "2026-11-27T23:59:00Z",
	codeFingerprint: "a".repeat(64),
	parameters: { seed: 7 },
	hostId: "host-1",
	sessionId: "session-1",
	turn: 3,
	runProvenance: { workflow: "local", modules: ["analysis"] },
	artifacts: [{ path: "result.csv", bytes: 8, sha256: "b".repeat(64), sourceKind: "run", sourceId: "job-1" }],
	manifest: { entries: [{ path: "result.csv", bytes: 8, sha256: "b".repeat(64) }] },
	projectId: "/old-project",
};

it("sends the same compute, task-terminal and decision objects to Inquiry and host subscribers", async () => {
	const test = await fixture(true);
	const expectedProjectId = canonicalProjectId(test.root);
	try {
		for (const handler of test.computeHandlers) handler({ type: "cleanup", jobId: "job-1" });
		expect(test.hostPayloads).toHaveLength(0);
		for (const handler of test.computeHandlers) handler(computeEvent);
		for (const handler of test.sessionHandlers)
			handler("session-1", { type: "agent_end", messages: [], willRetry: true });
		const decision: InquiryDecisionEvent = {
			id: "decision-1",
			kind: "task-authorization",
			summary: "accepted",
			basis: ["artifact-1"],
			affectedArtifactIds: ["artifact-1"],
			at: "2026-11-28T00:00:00Z",
			projectId: test.root,
		};
		for (const handler of test.decisionHandlers) handler(decision);
		await vi.waitFor(() => expect(test.hostPayloads).toHaveLength(3));

		const computeEnvelope = test.hostPayloads.find(
			(value) => (value as { topic: string }).topic === "inquiry.compute",
		) as { payload: unknown };
		const taskEnvelope = test.hostPayloads.find(
			(value) => (value as { topic: string }).topic === "inquiry.task-terminal",
		) as { payload: unknown };
		const decisionEnvelope = test.hostPayloads.find(
			(value) => (value as { topic: string }).topic === "inquiry.decision",
		) as { payload: unknown };
		expect(computeEnvelope.payload).toBe(test.inquiryEvents.compute[0]);
		expect(taskEnvelope.payload).toBe(test.inquiryEvents.task[0]);
		expect(decisionEnvelope.payload).toBe(test.inquiryEvents.decision[0]);
		expect(computeEnvelope.payload).toMatchObject({ ...computeEvent, projectId: expectedProjectId });
		expect(taskEnvelope.payload).toMatchObject({
			id: expect.stringMatching(/^session:session-1:/),
			taskId: "session-1",
			status: "partial",
			at: expect.any(Number),
			projectId: expectedProjectId,
			sessionId: "session-1",
		});
		expect(decisionEnvelope.payload).toEqual(decision);
		expect(test.computeHandlers.size).toBe(1);
	} finally {
		test.detach();
		await test.inquiry.dispose();
	}
});

it("delivers host events when Inquiry is disabled and detaches both paths", async () => {
	const test = await fixture(false);
	try {
		expect(test.computeHandlers.size).toBe(1);
		for (const handler of test.computeHandlers) handler(computeEvent);
		for (const handler of test.sessionHandlers)
			handler("session-2", { type: "agent_end", messages: [], willRetry: false });
		for (const handler of test.decisionHandlers)
			handler({ id: "decision-2", kind: "task-authorization", summary: "observed" });
		await vi.waitFor(() => expect(test.hostPayloads).toHaveLength(3));
		expect(test.inquiryEvents.compute).toHaveLength(0);
		expect(test.inquiryEvents.task).toHaveLength(0);
		expect(test.inquiryEvents.decision).toHaveLength(0);
		test.detach();
		for (const handler of test.computeHandlers) handler(computeEvent);
		for (const handler of test.sessionHandlers)
			handler("session-2", { type: "agent_end", messages: [], willRetry: false });
		for (const handler of test.decisionHandlers)
			handler({ id: "decision-3", kind: "task-authorization", summary: "detached" });
		await Promise.resolve();
		expect(test.hostPayloads).toHaveLength(3);
		expect(test.computeHandlers.size).toBe(0);
		expect(test.sessionHandlers.size).toBe(0);
		expect(test.decisionHandlers.size).toBe(0);
	} finally {
		await test.inquiry.dispose();
	}
});
