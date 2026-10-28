import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { SessionEngine } from "../src/session-engine/engine";

const privateThought = {
	type: "thinking",
	thinking: "PRIVATE_UNAVAILABLE_PROTOCOL",
	thinkingSignature: "actual-sdk-protocol-signature",
};
const protocol = () => [
	privateThought,
	{ type: "text", text: "PRIVATE_TOOL_PREFACE" },
	fauxToolCall("read", { path: "input.txt" }),
];
async function fixture({ transform, boundary = "unavailable", blocked = false } = {}) {
	const root = await mkdtemp(join(tmpdir(), "drone-sdk-private-protocol-"));
	await writeFile(join(root, "input.txt"), "actual bounded read\n");
	const settingsManager = SettingsManager.inMemory({});
	settingsManager.setProjectTrusted(true);
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
		extensionFactories: transform ? [(pi) => pi.on("context", transform)] : [],
	});
	await loader.reload();
	const runtime = await ModelRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "private-protocol-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-only");
	let release, entered;
	const waiting = new Promise((done) => {
			release = done;
		}),
		started = new Promise((done) => {
			entered = done;
		});
	const manager = SessionManager.inMemory(root);
	const { session } = await createAgentSession({
		cwd: root,
		agentDir: root,
		settingsManager,
		resourceLoader: loader,
		modelRuntime: runtime,
		model: faux.getModel(),
		sessionManager: manager,
		tools: ["read"],
		...(boundary === "none"
			? {}
			: {
					async hostDeliveryBoundary() {
						if (blocked) {
							entered();
							await waiting;
						}
						if (boundary === "unavailable") throw new Error("owner unavailable with private details");
					},
				}),
	});
	await session.bindExtensions({});
	return {
		root,
		session,
		faux,
		manager,
		started,
		release,
		async close() {
			release();
			await new SessionEngine().dispose(session);
			await rm(root, { recursive: true, force: true });
		},
	};
}
async function runCycle(f) {
	const raw = protocol();
	let next;
	f.faux.setResponses([
		fauxAssistantMessage(raw, { stopReason: "toolUse" }),
		(context) => {
			next = structuredClone(context.messages);
			return fauxAssistantMessage("UNPUBLISHED_NEXT_FINAL");
		},
	]);
	await f.session.prompt("Read input.txt and explain its bounded contents.");
	return { raw, next };
}
it("keeps real read and the next signed provider protocol across SDK empty-draft refresh while all public state stays neutral", async () => {
	const f = await fixture();
	try {
		const observed = [];
		f.session.subscribe((event) => {
			if (event.type === "message_end") observed.push(structuredClone(event.message));
		});
		const { raw, next } = await runCycle(f);
		expect(f.session.messages.find((message) => message.role === "toolResult")).toMatchObject({
			toolName: "read",
			isError: false,
			content: [expect.objectContaining({ text: "actual bounded read\n" })],
		});
		expect(next.find((message) => message.role === "assistant").content).toEqual(raw);
		for (const value of [f.session.messages, f.manager.getBranch(), observed])
			expect(JSON.stringify(value)).not.toMatch(
				/PRIVATE_UNAVAILABLE_PROTOCOL|PRIVATE_TOOL_PREFACE|UNPUBLISHED_NEXT_FINAL/,
			);
		expect(f.session.messages.findLast((message) => message.role === "assistant").stopReason).toBe("aborted");
	} finally {
		await f.close();
	}
});
for (const mode of ["replace", "remove", "mutate"])
	it(`does not restore a context hook's ${mode}d message`, async () => {
		const f = await fixture({
			transform: (event) => {
				const list = event.messages;
				if (mode === "remove")
					return {
						messages: list.filter((message) => message.role !== "assistant" && message.role !== "toolResult"),
					};
				if (mode === "replace")
					return {
						messages: list.map((message) =>
							message.role === "assistant" ? structuredClone(message) : message,
						),
					};
				for (const message of list)
					if (message.role === "assistant") message.content = [{ type: "text", text: "context replacement" }];
				return { messages: list };
			},
		});
		try {
			const { next } = await runCycle(f);
			expect(JSON.stringify(next)).not.toMatch(/PRIVATE_UNAVAILABLE_PROTOCOL|PRIVATE_TOOL_PREFACE/);
			if (mode === "remove") expect(next.some((message) => message.role === "assistant")).toBe(false);
			if (mode === "mutate") expect(JSON.stringify(next)).toContain("context replacement");
		} finally {
			await f.close();
		}
	});
for (const mode of ["reload", "branch", "new-session"])
	it(`clears protocol on actual ${mode} generation even when the branch keeps the tool entry`, async () => {
		const f = await fixture();
		try {
			const first = await runCycle(f);
			expect(first.next.find((message) => message.role === "assistant").content).toEqual(first.raw);
			if (mode === "reload") await f.session.reload();
			else if (mode === "new-session") {
				f.manager.newSession();
				f.session.refreshContext();
			} else {
				const entry = f.manager
					.getBranch()
					.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
				await f.session.navigateTree(entry.id, { summarize: false });
			}
			let next;
			f.faux.setResponses([
				(context) => {
					next = structuredClone(context.messages);
					return fauxAssistantMessage("AFTER_GENERATION_FINAL");
				},
			]);
			await f.session.prompt("A new generation.");
			expect(JSON.stringify(next)).not.toMatch(/PRIVATE_UNAVAILABLE_PROTOCOL|PRIVATE_TOOL_PREFACE/);
		} finally {
			await f.close();
		}
	});
it("never captures or restores an actual cancelled tool stage", async () => {
	const f = await fixture({ blocked: true });
	try {
		f.faux.setResponses([fauxAssistantMessage(protocol(), { stopReason: "toolUse" })]);
		const pending = f.session.prompt("Cancel before read.");
		await f.started;
		const stopping = f.session.abort();
		f.release();
		await Promise.all([pending, stopping]);
		expect(f.session.messages.some((message) => message.role === "toolResult")).toBe(false);
		let next;
		f.faux.setResponses([
			(context) => {
				next = structuredClone(context.messages);
				return fauxAssistantMessage("CANCELLED_NEXT_FINAL");
			},
		]);
		await f.session.prompt("After cancellation.");
		expect(JSON.stringify(next)).not.toMatch(/PRIVATE_UNAVAILABLE_PROTOCOL|PRIVATE_TOOL_PREFACE/);
	} finally {
		await f.close();
	}
});
for (const boundary of ["none", "success"])
	it(`keeps ordinary ${boundary} callback semantics and stores no private fallback protocol`, async () => {
		const f = await fixture({ boundary });
		try {
			const { raw, next } = await runCycle(f);
			expect(next.find((message) => message.role === "assistant").content).toEqual(raw);
			expect(f.session.messages.findLast((message) => message.role === "assistant").content).toEqual([
				{ type: "text", text: "UNPUBLISHED_NEXT_FINAL" },
			]);
			expect(f.session.messages.some((message) => f.session._hostProviderProtocol?.has(message))).toBe(false);
		} finally {
			await f.close();
		}
	});
