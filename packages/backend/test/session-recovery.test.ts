import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { SessionRecovery } from "../src/session/recovery";

function fixture() {
	let listener: (e: unknown) => void = () => {};
	let done!: () => void;
	const run = new Promise<void>((r) => {
		done = r;
	});
	// 只读恢复名单来自工具清单：只有声明 drone.recoverySafe 的工具会被重放（挂钩 1）
	const definitions: Record<string, { drone?: { recoverySafe?: boolean } }> = {
		bash: {},
		research_read_knowledge: { drone: { recoverySafe: true } },
		research_verify_literature: { drone: { recoverySafe: true } },
		research_deposit_knowledge: { drone: { recoverySafe: false } },
	};
	const session = {
		sessionId: "s",
		isIdle: true,
		pendingMessageCount: 0,
		messages: [
			{ role: "user", timestamp: 1 },
			{ role: "toolResult", isError: false },
			{ role: "assistant", timestamp: 2, stopReason: "error" },
		],
		getActiveToolNames: () => Object.keys(definitions),
		getAllTools: () => Object.keys(definitions).map((name) => ({ name })),
		getToolDefinition: (name: string) => (definitions[name] ? { name, ...definitions[name] } : undefined),
		setActiveToolsByName: vi.fn(),
		subscribe: vi.fn((cb) => {
			listener = cb;
			return vi.fn();
		}),
		sendCustomMessage: vi.fn(() => {
			listener({ type: "agent_start" });
			return run;
		}),
		waitForIdle: vi.fn(async () => {}),
	};
	return { raw: session, session: session as unknown as AgentSession, done };
}
describe("bounded read-only answer recovery", () => {
	it("deduplicates the same retry, retains history and never re-sends a user prompt", async () => {
		const f = fixture(),
			c = new SessionRecovery();
		const original = [...f.raw.messages];
		const a = c.retry(f.session, "card-1", 1),
			b = c.retry(f.session, "card-1", 1);
		expect(a).toBe(b);
		await a;
		expect(f.raw.sendCustomMessage).toHaveBeenCalledTimes(1);
		expect(f.raw.messages).toEqual(original);
		expect(f.raw.setActiveToolsByName.mock.calls[0][0]).toEqual([
			"research_read_knowledge",
			"research_verify_literature",
		]);
		expect(f.raw.sendCustomMessage.mock.calls[0][0]).toMatchObject({
			customType: "research-recovery",
			details: { completedToolResults: 1, mode: "read-only-recovery" },
		});
		await expect(c.retry(f.session, "other", 1)).rejects.toThrow("queued messages");
		f.done();
		await vi.waitFor(() => expect(f.raw.setActiveToolsByName).toHaveBeenCalledTimes(2));
		await c.retry(f.session, "card-1", 1);
		expect(f.raw.sendCustomMessage).toHaveBeenCalledTimes(1);
	});
	it.each(["busy", "queued", "stale", "complete"])(
		"refuses %s recovery without adding work",
		async (kind) => {
			const f = fixture();
			if (kind === "busy") f.raw.isIdle = false;
			if (kind === "queued") f.raw.pendingMessageCount = 1;
			if (kind === "complete") f.raw.messages[2].stopReason = "stop";
			await expect(
				new SessionRecovery().retry(f.session, "request", kind === "stale" ? 0 : 1),
			).rejects.toThrow();
			expect(f.raw.sendCustomMessage).not.toHaveBeenCalled();
		},
	);
	it("restores tools and releases the lock after preflight failure", async () => {
		const f = fixture(),
			c = new SessionRecovery();
		f.raw.sendCustomMessage.mockImplementation(() => Promise.reject(new Error("no model")));
		await expect(c.retry(f.session, "r", 1)).rejects.toThrow("no model");
		await vi.waitFor(() => expect(f.raw.setActiveToolsByName).toHaveBeenCalledTimes(2));
		await expect(c.retry(f.session, "next", 1)).rejects.toThrow("no model");
	});
});
