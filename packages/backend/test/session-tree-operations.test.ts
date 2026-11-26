import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { SessionRegistry } from "../src/session/registry";
import { SessionService } from "../src/session-service";

interface SessionState {
	isStreaming: boolean;
	isCompacting: boolean;
}

/** Inject a minimal session so guard behavior stays isolated from the SDK and filesystem. */
function makeBackend(state: SessionState): SessionService {
	const backend = new SessionService({ projectTrust: false, permissionGates: false });
	const registry = (backend as unknown as { registry: SessionRegistry }).registry;
	registry.add({
		session: { sessionId: "s1", ...state } as unknown as AgentSession,
		unsubscribe: () => {},
		cwd: "/tmp",
	});
	return backend;
}

describe("SessionService session tree operation guards", () => {
	it("rejects fork while context compaction is rewriting the source session", async () => {
		const backend = makeBackend({ isStreaming: false, isCompacting: true });

		await expect(backend.forkSession("s1", { entryId: "target" })).rejects.toThrow(
			"Cannot fork while the agent is running or context is compacting",
		);
	});

	it("rejects recall while context compaction is rewriting the source session", async () => {
		const backend = makeBackend({ isStreaming: false, isCompacting: true });

		await expect(backend.recallMessage("s1", { entryId: "target" })).rejects.toThrow(
			"Cannot recall while the agent is running or context is compacting",
		);
	});
});
