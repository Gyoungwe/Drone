import { randomUUID } from "node:crypto";
import type { PluginAgentSlotReleaseInput } from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { acquireNativeSubagentSlot } from "../tools/subagent/slots";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

const leases = new Map<
	string,
	{
		release: () => void;
		pluginId: string;
		applicationId: string;
		token: object;
	}
>();

function releaseIfHeld(lease: string): boolean {
	const held = leases.get(lease);
	if (!held) return false;
	leases.delete(lease);
	held.release();
	return true;
}

async function acquireLease(acquire: typeof acquireNativeSubagentSlot, context: PluginCapabilityContext) {
	if (context.scope.kind === "application") throw new Error("Agent slot needs a workspace caller");
	const { invocationToken, onInvocationSettled } = context;
	if (!invocationToken || !onInvocationSettled) throw new Error("Agent slot needs an operation invocation");
	const release = await acquire(context.scope.workspaceDirectory, context.signal);
	const lease = randomUUID();
	leases.set(lease, {
		release,
		pluginId: context.pluginId,
		applicationId: context.applicationId,
		token: invocationToken,
	});
	try {
		onInvocationSettled(() => {
			releaseIfHeld(lease);
		});
	} catch (error) {
		releaseIfHeld(lease);
		throw error;
	}
	return { lease };
}

export function agentSlotCapabilityHandlers(deps: { acquire?: typeof acquireNativeSubagentSlot } = {}): {
	"agent.slot.acquire": PluginCapabilityHandler;
	"agent.slot.release": PluginCapabilityHandler;
} {
	return {
		"agent.slot.acquire": {
			effect: "read",
			inputSchema: Type.Object({}, { additionalProperties: false }),
			resultSchema: Type.Object({ lease: Type.String() }, { additionalProperties: false }),
			execute: (_input, context) => acquireLease(deps.acquire ?? acquireNativeSubagentSlot, context),
		},
		"agent.slot.release": {
			effect: "read",
			inputSchema: Type.Object(
				{ lease: Type.String({ minLength: 1, maxLength: 128 }) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ released: Type.Boolean() }, { additionalProperties: false }),
			execute: async (raw, context) => {
				const { lease } = raw as PluginAgentSlotReleaseInput;
				const held = leases.get(lease);
				if (
					held &&
					(held.pluginId !== context.pluginId ||
						held.applicationId !== context.applicationId ||
						held.token !== context.invocationToken)
				)
					throw new Error("Agent slot lease belongs to another caller");
				return { released: releaseIfHeld(lease) };
			},
		},
	};
}
