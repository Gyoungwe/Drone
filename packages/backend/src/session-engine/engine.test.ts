import { describe, expect, it, vi } from "vitest";
import { type AgentSession, SessionEngine } from "./engine";

describe("SessionEngine lifecycle boundary", () => {
	it("delegates session operations through the SDK boundary", async () => {
		const session = {
			dispose: vi.fn(),
			abort: vi.fn(async () => {}),
			prompt: vi.fn(async () => {}),
			clearQueue: vi.fn(() => ({ steering: ["s"], followUp: ["f"] })),
			setModel: vi.fn(async () => {}),
			setThinkingLevel: vi.fn(),
			compact: vi.fn(async () => ({ summary: "ok" })),
			reload: vi.fn(async () => {}),
			setSessionName: vi.fn(),
			exportToHtml: vi.fn(async () => "<html />"),
			exportToJsonlForHost: vi.fn(async () => "{}\n"),
		} as unknown as AgentSession;
		const engine = new SessionEngine();

		await engine.dispose(session);
		await engine.abort(session);
		await engine.prompt(session, "hello");
		expect(engine.clearQueue(session)).toEqual({ steering: ["s"], followUp: ["f"] });
		await engine.setModel(session, undefined as never);
		engine.setThinkingLevel(session, "off");
		await engine.compact(session, "short");
		await engine.reload(session);
		engine.setSessionName(session, "Demo");
		expect(await engine.exportHtml(session)).toBe("<html />");
		expect(await engine.exportJsonl(session)).toBe("{}\n");

		expect(session.dispose).toHaveBeenCalledOnce();
		expect(session.abort).toHaveBeenCalledTimes(2);
		expect(session.prompt).toHaveBeenCalledWith("hello", undefined);
		expect(session.setModel).toHaveBeenCalledOnce();
		expect(session.setThinkingLevel).toHaveBeenCalledWith("off");
		expect(session.compact).toHaveBeenCalledWith("short");
		expect(session.reload).toHaveBeenCalledOnce();
		expect(session.setSessionName).toHaveBeenCalledWith("Demo");
		expect(session.exportToHtml).toHaveBeenCalledOnce();
		expect(session.exportToJsonlForHost).toHaveBeenCalledOnce();
	});
});

it("starts shutdown and abort together, waits before dispose and coalesces concurrent closes", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const events: string[] = [];
	const session = {
		extensionRunner: {
			onError: vi.fn(() => () => {}),
			emit: vi.fn(async (event) => {
				expect(event).toEqual({ type: "session_shutdown", reason: "quit" });
				events.push("shutdown");
				await gate;
			}),
		},
		abort: vi.fn(async () => {
			events.push("abort");
		}),
		dispose: vi.fn(() => {
			events.push("dispose");
		}),
	} as unknown as AgentSession;
	const engine = new SessionEngine();
	const a = engine.dispose(session);
	const b = engine.dispose(session);
	expect(a).toBe(b);
	await vi.waitFor(() => expect(events).toEqual(["shutdown", "abort"]));
	release();
	await Promise.all([a, b]);
	expect(events).toEqual(["shutdown", "abort", "dispose"]);
});

it("finishes every cleanup step and reports shutdown, abort and disposal failures together", async () => {
	const shutdownFailure = new Error("hook failed");
	const abortFailure = new Error("abort failed");
	const disposeFailure = new Error("dispose failed");
	const dispose = vi.fn(() => {
		throw disposeFailure;
	});
	const session = {
		extensionRunner: {
			onError: vi.fn(() => () => {}),
			emit: () => {
				throw shutdownFailure;
			},
		},
		abort: vi.fn(async () => {
			throw abortFailure;
		}),
		dispose,
	} as unknown as AgentSession;
	const engine = new SessionEngine();
	await expect(engine.dispose(session)).rejects.toMatchObject({
		message: "Session shutdown failed",
		errors: [shutdownFailure, abortFailure, disposeFailure],
	});
	expect(session.abort).toHaveBeenCalledOnce();
	expect(dispose).toHaveBeenCalledOnce();
	await expect(engine.dispose(session)).rejects.toThrow("Session shutdown failed");
	expect(dispose).toHaveBeenCalledOnce();
});
