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

		engine.dispose(session);
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
		expect(session.abort).toHaveBeenCalledOnce();
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
