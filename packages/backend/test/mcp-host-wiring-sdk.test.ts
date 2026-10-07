import type { McpStatus } from "@drone/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PiBackend } from "../src/pi-backend";
import type { SessionRegistry } from "../src/session/registry";
import { buildSessionCustomTools } from "../src/session-engine/extensions";

const backends: PiBackend[] = [];
afterEach(async () => {
	for (const backend of backends.splice(0)) await backend.dispose?.();
});

function make(options: ConstructorParameters<typeof PiBackend>[0] = {}) {
	const backend = new PiBackend({
		defaultCwd: "/tmp",
		projectTrust: false,
		permissionGates: false,
		...options,
	});
	backends.push(backend);
	return backend;
}

describe("MCP host wiring", () => {
	it("publishes runtime status to onMcpStatus subscribers, normalized for the IPC schema", () => {
		const backend = make();
		const seen: Array<{ cwd: string; status: McpStatus }> = [];
		backend.onMcpStatus((cwd, status) => seen.push({ cwd, status }));
		// Raw pi-mcp-adapter payload: extra fields and a "blocked" project server.
		backend.setMcpStatus("/projects/a", {
			version: 1,
			servers: [
				{
					name: "pw",
					status: "connected",
					listenState: "idle",
					toolCount: 21,
					directToolCount: 0,
					disabled: false,
				},
				{ name: "repo", status: "blocked", toolCount: 0, disabled: false, blockedReason: "project server" },
			],
			totalTools: 21,
			totalResources: 0,
			connectedCount: 1,
			disabledCount: 0,
			extra: true,
		} as unknown as McpStatus);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.status.runtime).toBe("running");
		expect(seen[0]?.status.servers.map((server) => server.status)).toEqual(["connected", "blocked"]);
		expect(backend.mcp.getStatus("/projects/a").totalTools).toBe(21);
		expect("extra" in (seen[0]?.status ?? {})).toBe(false);
	});

	it("reloads every idle session after a user-level MCP change", async () => {
		const backend = make();
		const internal = backend as unknown as {
			registry: SessionRegistry;
			sessionEngine: { reload: (session: unknown) => Promise<void> };
		};
		const reloaded: string[] = [];
		internal.sessionEngine.reload = async (session) => {
			reloaded.push((session as { sessionId: string }).sessionId);
		};
		for (const [id, cwd] of [
			["a", "/projects/a"],
			["b", "/projects/b"],
		] as const)
			internal.registry.add({
				session: { sessionId: id, isStreaming: false, isCompacting: false, dispose: () => {} },
				unsubscribe: () => {},
				cwd,
			} as never);
		await backend.reloadMcpSessions();
		expect(reloaded.sort()).toEqual(["a", "b"]);
		reloaded.length = 0;
		await backend.reloadMcpSessions("/projects/b");
		expect(reloaded).toEqual(["b"]);
	});

	it("registers ssh_hosts whenever the host provides a registry (ssh guideline references it)", () => {
		const backend = make({ listSshHosts: async () => [] });
		const deps = backend.sessionExtensionDependencies();
		expect(deps.listSshHosts).toBeTypeOf("function");
		const names = buildSessionCustomTools(
			deps,
			{ confirm: async () => true } as never,
			{ ask: async () => "" } as never,
		).map((tool) => tool.name);
		expect(names).toContain("ssh");
		expect(names).toContain("ssh_hosts");
	});
});
