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
			exportToJsonl: vi.fn(() => "{}\n"),
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
		expect(engine.exportJsonl(session)).toBe("{}\n");

		expect(session.dispose).toHaveBeenCalledOnce();
		expect(session.abort).toHaveBeenCalledTimes(2);
		expect(session.prompt).toHaveBeenCalledWith("hello", undefined);
		expect(session.setModel).toHaveBeenCalledOnce();
		expect(session.setThinkingLevel).toHaveBeenCalledWith("off");
		expect(session.compact).toHaveBeenCalledWith("short");
		expect(session.reload).toHaveBeenCalledOnce();
		expect(session.setSessionName).toHaveBeenCalledWith("Demo");
		expect(session.exportToHtml).toHaveBeenCalledOnce();
		expect(session.exportToJsonl).toHaveBeenCalledOnce();
	});
});

it("waits for extension shutdown before abort/dispose and coalesces concurrent closes", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const events: string[] = [];
	const session = {
		extensionRunner: {
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
	await Promise.resolve();
	expect(events).toEqual(["shutdown"]);
	release();
	await Promise.all([a, b]);
	expect(events).toEqual(["shutdown", "abort", "dispose"]);
});
