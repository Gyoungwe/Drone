import { Type } from "typebox";
import { expect, it, vi } from "vitest";
import { PluginRuntimeBridge } from "./coordinator";
import type { P5ApprovalReview } from "./p5-approval-review";
import { PluginCapabilityBroker, type PluginCapabilityHandler } from "./runtime-capabilities";

const review: P5ApprovalReview = {
	kind: "byte-write",
	pluginId: "example",
	root: "/exports/demo",
	file: { path: "reports/result.bin", bytes: 13, sha256: "a".repeat(64) },
};

const brokerContext = {
	scope: {
		kind: "session" as const,
		workspaceId: "project",
		workspaceDirectory: "/Work/Project",
		sessionId: "real",
	},
	pluginId: "plugin",
	applicationId: "app",
	callerIdentity: {},
	signal: new AbortController().signal,
	bootstrap: false,
};

/**
 * The review travels from the capability handler to the user without ever
 * carrying its own copy: the backend produces the facts and the desktop
 * renders them with the approved table.
 */
it("hands the host-authored review to the authority beside the string detail", async () => {
	const authorize = vi.fn(async () => true);
	const handler: PluginCapabilityHandler = {
		inputSchema: Type.Null(),
		resultSchema: Type.String(),
		effect: "write",
		approvalDetail: () => "application-state-write",
		approvalReview: () => review,
		execute: async () => "done",
	};
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: { save: handler },
	});
	await broker.run({ ...brokerContext, bootstrap: false }, "write", vi.fn(), authorize, () =>
		broker.port.call("save", null),
	);
	expect(authorize).toHaveBeenCalledWith(
		"save",
		null,
		"write",
		"application-state-write",
		expect.anything(),
		undefined,
		review,
	);
});

const source = { pluginId: "example", packageRoot: "/example", entrypoint: "/example/runtime.mjs" };
const owner = { id: 1, isDestroyed: () => false };

it("hands the capability's review to the host approval callback", async () => {
	let received: unknown;
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		getSessionContext: () => undefined,
		approve: async (_owner, _source, _operation, _detail, _signal, given) => {
			received = given;
			return true;
		},
		capabilities: () => ({
			resources: [],
			handlers: {
				"bytes.write": {
					inputSchema: { type: "null" },
					resultSchema: { type: "null" },
					effect: "write" as const,
					approval: "always" as const,
					approvalDetail: () => "application-state-write",
					approvalReview: () => review,
					execute: async () => null,
				},
			},
		}),
		factory: () => async () => ({
			operations: {
				write: {
					inputSchema: { type: "null" },
					resultSchema: { type: "null" },
					effect: "write" as const,
					execute: async (_input: unknown, context) => context.capabilities.call("bytes.write", null),
				},
			},
			dispose: async () => undefined,
		}),
	});
	const token = await bridge.bind("ui", owner);
	if (!token) throw new Error("Missing runtime binding");
	const selected = bridge.selectSession(owner, null);
	await bridge.invoke(owner, token, "write", null, selected, "review-approval");
	expect(received).toStrictEqual(review);
	await bridge.close();
});
