import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { PluginRuntimeRegistry } from "./runtime";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

const caller = {
	identity: {},
	scope: {
		kind: "session" as const,
		workspaceId: "project",
		workspaceDirectory: "/Work/Project",
		sessionId: "real",
	},
	signal: new AbortController().signal,
};
const handler = (execute: PluginCapabilityHandler["execute"]): PluginCapabilityHandler => ({
	inputSchema: Type.Null(),
	resultSchema: Type.String(),
	effect: "read",
	execute,
});
const policy = () => ({
	authorizeActivation: vi.fn(async () => true),
	authorizeInvocation: vi.fn<import("./runtime").PluginRuntimePolicy["authorizeInvocation"]>(
		async () => true,
	),
});

describe("plugin capability authority", () => {
	it("formats approval details only for schema-valid capability input and never trusts operation details", async () => {
		const authorization = policy();
		const execute = vi.fn(async () => "saved");
		const approvalDetail = vi.fn(() => "Host-selected configuration file");
		const registry = new PluginRuntimeRegistry(authorization, "app", {
			resources: [],
			handlers: {
				save: {
					inputSchema: Type.Object({ value: Type.String(), approvalDetail: Type.String() }),
					resultSchema: Type.String(),
					effect: "write",
					approvalDetail,
					execute,
				},
			},
		});
		registry.register("plugin", async () => ({
			operations: {
				save: {
					inputSchema: Type.Unknown(),
					resultSchema: Type.String(),
					effect: "write",
					execute: (input, context) => context.capabilities.call("save", input),
				},
			},
			dispose: async () => {},
		}));
		const client = await registry.activate("plugin", () => caller);
		await expect(client.invoke("save", { value: 42, approvalDetail: "Forged" })).rejects.toThrow(
			"Invalid plugin capability input",
		);
		expect(approvalDetail).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
		const forged = { value: "new", approvalDetail: "Forged" };
		expect(await client.invoke("save", forged)).toBe("saved");
		const requests = authorization.authorizeInvocation.mock.calls.map(([request]) => request);
		expect(requests.at(-2)).toMatchObject({ operation: "save", input: forged });
		expect(requests.at(-2)).not.toHaveProperty("approvalDetail");
		expect(requests.at(-1)).toMatchObject({
			operation: "capability:save",
			approvalDetail: "Host-selected configuration file",
		});
		expect(approvalDetail).toHaveBeenCalledWith(forged);
		await registry.deactivate("plugin");
	});

	it("reports an unawaited accepted capability failure after awaiting its cleanup", async () => {
		let finish!: () => void;
		const registry = new PluginRuntimeRegistry(policy(), "app", {
			resources: [],
			handlers: {
				read: handler(async () => {
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
					throw new Error("synthetic accepted read failed");
				}),
			},
		});
		registry.register("plugin", async () => ({
			operations: {
				read: {
					inputSchema: Type.Null(),
					resultSchema: Type.String(),
					effect: "read",
					execute: async (_input, context) => {
						void context.capabilities.call("read", null);
						await Promise.resolve();
						return "not-a-success";
					},
				},
			},
			dispose: async () => {},
		}));
		const client = await registry.activate("plugin", () => caller);
		const operation = client.invoke("read", null);
		const failed = expect(operation).rejects.toThrow("synthetic accepted read failed");
		await vi.waitFor(() => expect(finish).toBeDefined());
		finish();
		await failed;
		await registry.deactivate("plugin");
	});

	it("allows explicit recovery from a settled capability error without poisoning later reads", async () => {
		const registry = new PluginRuntimeRegistry(policy(), "app", {
			resources: [],
			handlers: {
				optional: handler(async () => {
					throw Object.assign(new Error("synthetic missing configuration"), { code: "ENOENT" });
				}),
			},
		});
		registry.register("plugin", async () => ({
			operations: {
				read: {
					inputSchema: Type.Null(),
					resultSchema: Type.String(),
					effect: "read",
					execute: async (_input, context) => {
						try {
							await context.capabilities.call("optional", null);
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
							return "explicit default configuration";
						}
						return "configured";
					},
				},
			},
			dispose: async () => {},
		}));
		const client = await registry.activate("plugin", () => caller);
		expect(await client.invoke("read", null)).toBe("explicit default configuration");
		expect(await client.invoke("read", null)).toBe("explicit default configuration");
		await registry.deactivate("plugin");
	});

	it("creates and disposes independent ports for each approved activation", async () => {
		const closed: string[] = [];
		let serial = 0;
		const provider = vi.fn(async () => {
			const handle = String(++serial);
			return {
				resources: [{ handle, kind: "state" as const }],
				handlers: {},
				dispose: async () => {
					closed.push(handle);
				},
			};
		});
		const registry = new PluginRuntimeRegistry(policy(), "app", provider);
		registry.register("plugin", async ({ resources }) => ({
			operations: {
				read: {
					inputSchema: Type.Null(),
					resultSchema: Type.String(),
					effect: "read",
					execute: async () => resources[0]!.handle,
				},
			},
			dispose: async () => {},
		}));
		let client = await registry.activate("plugin", () => caller);
		expect(await client.invoke("read", null)).toBe("1");
		await registry.deactivate("plugin");
		client = await registry.activate("plugin", () => caller);
		expect(await client.invoke("read", null)).toBe("2");
		await registry.deactivate("plugin");
		expect(closed).toEqual(["1", "2"]);
	});

	it("binds a factory-held port to each actual invocation and denies retained background authority", async () => {
		const contexts: PluginCapabilityContext[] = [];
		const registry = new PluginRuntimeRegistry(policy(), "app", {
			resources: [{ handle: "approved", kind: "state" }],
			handlers: {
				read: handler(async (_input, context) => {
					contexts.push(context);
					return context.scope.kind;
				}),
			},
		});
		let retained!: () => Promise<unknown>;
		registry.register("plugin", async ({ capabilities }) => {
			retained = () => capabilities.call("read", null);
			return {
				operations: {
					read: { inputSchema: Type.Null(), resultSchema: Type.String(), effect: "read", execute: retained },
				},
				dispose: async () => {},
			};
		});
		const client = await registry.activate("plugin", () => caller);
		expect(await client.invoke("read", null)).toBe("session");
		expect(contexts[0]?.callerIdentity).toBe(caller.identity);
		await expect(retained()).rejects.toThrow("no live caller");
		await registry.deactivate("plugin");
	});

	it("only permits explicit pre-approved bootstrap state handlers and never write escalation", async () => {
		const write = vi.fn(async () => "written");
		const access = policy();
		const registry = new PluginRuntimeRegistry(access, "app", {
			resources: [],
			handlers: {
				state: {
					...handler(async (_input, context) => (context.bootstrap ? "bootstrap" : "call")),
					bootstrap: true,
				},
				write: { ...handler(write), effect: "write" },
			},
		});
		registry.register("plugin", async ({ capabilities }) => {
			expect(await capabilities.call("state", null)).toBe("bootstrap");
			await expect(capabilities.call("write", null)).rejects.toThrow("Read-only");
			return {
				operations: {
					read: {
						inputSchema: Type.Null(),
						resultSchema: Type.String(),
						effect: "read",
						execute: () => capabilities.call("write", null),
					},
				},
				dispose: async () => {},
			};
		});
		const client = await registry.activate("plugin", () => caller);
		await expect(client.invoke("read", null)).rejects.toThrow("Read-only");
		expect(write).not.toHaveBeenCalled();
		await registry.deactivate("plugin");
	});

	it("cancels pending per-capability approval and never executes its late grant", async () => {
		let grant!: (value: boolean) => void;
		const read = vi.fn(async () => "read");
		const access = policy();
		access.authorizeInvocation.mockImplementation(async (request?: { operation: string }) =>
			request?.operation.startsWith("capability:")
				? new Promise((resolve) => {
						grant = resolve;
					})
				: true,
		);
		const registry = new PluginRuntimeRegistry(access, "app", {
			resources: [],
			handlers: { read: handler(read) },
		});
		registry.register("plugin", async () => ({
			operations: {
				read: {
					inputSchema: Type.Null(),
					resultSchema: Type.String(),
					effect: "read",
					execute: (_input, context) => context.capabilities.call("read", null),
				},
			},
			dispose: async () => {},
		}));
		const client = await registry.activate("plugin", () => caller);
		const invocation = client.invoke("read", null);
		const failed = expect(invocation).rejects.toThrow("deactivated");
		await vi.waitFor(() => expect(grant).toBeDefined());
		await registry.deactivate("plugin");
		grant(true);
		await failed;
		expect(read).not.toHaveBeenCalled();
	});
});
