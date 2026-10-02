import { describe, expect, it, vi } from "vitest";
import { type RegisteredSession, SessionRegistry } from "../session/registry";
import { SessionLifecycleService } from "./session-lifecycle";

function entry(sessionId: string): RegisteredSession {
	const dispose = vi.fn();
	return {
		session: {
			sessionId,
			dispose,
		} as unknown as RegisteredSession["session"],
		unsubscribe: vi.fn(),
		cwd: "/tmp/project",
	};
}

describe("SessionLifecycleService", () => {
	it("keeps close ordering around SDK disposal and registry removal", async () => {
		const registry = new SessionRegistry();
		const first = entry("session-1");
		registry.add(first);
		const order: string[] = [];
		const engine = { dispose: vi.fn(() => order.push("engine")) } as never;
		const service = new SessionLifecycleService(registry, engine);

		const closed = await service.close("session-1", {
			beforeDispose: () => {
				order.push("before");
			},
			afterDispose: () => {
				order.push(`after:${registry.has("session-1")}`);
			},
		});

		expect(closed).toBe(true);
		expect(order).toEqual(["before", "engine", "after:false"]);
		expect(first.unsubscribe).toHaveBeenCalledOnce();
	});

	it("is idempotent for unknown sessions", async () => {
		const registry = new SessionRegistry();
		const dispose = vi.fn();
		const engine = { dispose } as never;
		const service = new SessionLifecycleService(registry, engine);
		expect(await service.close("missing")).toBe(false);
		expect(dispose).not.toHaveBeenCalled();
	});
});
