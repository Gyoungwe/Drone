import { describe, expect, it, vi } from "vitest";
import { NativeSessionDelivery } from "../plugins/native-delivery";
import { createDroneRuntime } from "../runtime";
import { SessionMessageService } from "./session-messages";

function fixture(policy) {
	const raw = [
		{
			role: "assistant",
			content: [{ type: "text", text: "unpublished draft" }],
			timestamp: 1,
			stopReason: "stop",
		},
	];
	const projectSnapshot = vi.fn((messages) =>
		messages.map((message) => ({
			...message,
			content: [{ type: "text", text: "legacy projection" }],
		})),
	);
	const snapshot = vi.fn(async (messages) =>
		messages.map((message) => ({
			...message,
			content: [{ type: "text", text: "managed projection" }],
		})),
	);
	const runtime = createDroneRuntime();
	runtime.knowledge.publication = { projectSnapshot };
	const source = {
		pluginId: "publication-owner",
		packageRoot: "/publication-owner",
		entrypoint: "/publication-owner/runtime.mjs",
		contentHash: "owner-hash",
		deliveryProjection: "required",
	};
	const nativeDelivery = new NativeSessionDelivery(
		() => (policy === "ordinary" ? { kind: "ordinary" } : { kind: "managed", source, state: "enabled" }),
		(a, b) => a === b,
		() => [{ source, state: "enabled" }],
	);
	nativeDelivery.attach(
		source,
		{ hostProjection: { snapshot, finalize: async (event) => event } },
		() => true,
	);
	if (policy !== "closed") nativeDelivery.confirmSelection(["owner"]);
	return messageServiceFixture({ policy, raw, runtime, nativeDelivery, projectSnapshot, snapshot });
}

function messageServiceFixture(input) {
	const { policy, raw, runtime, nativeDelivery } = input;
	const entry = {
		session: { messages: raw, sessionManager: { getBranch: () => [] } },
		...(policy === "absent" ? {} : { nativeDelivery }),
	};
	const service = new SessionMessageService({
		runtime,
		requireSession: () => entry,
		sessionEngine: { historicalMessageOrigin: () => undefined },
		subagentPanel: { listRuns: () => [] },
	});
	return { ...input, service };
}

describe("session snapshot publication owner", () => {
	it.each(["absent", "ordinary"])("uses the legacy owner with %s native delivery", async (policy) => {
		const f = fixture(policy);
		expect(await f.service.getSessionMessages("session")).toMatchObject([
			{ role: "assistant", text: "legacy projection" },
		]);
		expect(f.projectSnapshot).toHaveBeenCalledExactlyOnceWith(f.raw, []);
		expect(f.snapshot).not.toHaveBeenCalled();
		expect(f.raw[0].content[0].text).toBe("unpublished draft");
	});

	it.each(["required", "closed"])("keeps %s native delivery authoritative", async (policy) => {
		const f = fixture(policy);
		const messages = await f.service.getSessionMessages("session");
		expect(f.projectSnapshot).not.toHaveBeenCalled();
		expect(JSON.stringify(messages)).not.toContain("unpublished draft");
		if (policy === "required") {
			expect(messages).toMatchObject([{ role: "assistant", text: "managed projection" }]);
			expect(f.snapshot).toHaveBeenCalledExactlyOnceWith(f.raw, [], undefined);
		} else {
			expect(f.snapshot).not.toHaveBeenCalled();
		}
	});

	it("preserves ordinary messages when no legacy owner is registered", async () => {
		const f = fixture("ordinary");
		delete f.runtime.knowledge.publication;
		expect(await f.service.getSessionMessages("session")).toMatchObject([
			{ role: "assistant", text: "unpublished draft" },
		]);
		expect(f.projectSnapshot).not.toHaveBeenCalled();
		expect(f.snapshot).not.toHaveBeenCalled();
	});
});

describe("native delivery ordinary query", () => {
	it("keeps a required run authoritative after selection becomes ordinary", () => {
		const { nativeDelivery } = fixture("required");
		nativeDelivery.start(new AbortController().signal);
		nativeDelivery.confirmSelection([]);
		expect(nativeDelivery.isOrdinary()).toBe(false);
		expect(nativeDelivery.projectEvent({ type: "message_update" })).toBeNull();
	});

	it("keeps an ordinary run ordinary until delivery closes", async () => {
		const { nativeDelivery } = fixture("required");
		nativeDelivery.confirmSelection([]);
		nativeDelivery.start(new AbortController().signal);
		nativeDelivery.confirmSelection(["owner"]);
		const event = { type: "message_update" };
		expect(nativeDelivery.isOrdinary()).toBe(true);
		expect(nativeDelivery.projectEvent(event)).toBe(event);
		await nativeDelivery.dispose();
		expect(nativeDelivery.isOrdinary()).toBe(false);
	});
});
