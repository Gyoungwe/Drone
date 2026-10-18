import { CONNECTOR_CONTRACT_VERSION, type ConnectorDescriptor } from "./contracts";
import { type ConnectorRegistry, createConnectorRegistry, validateConnectorDescriptor } from "./registry";

export * from "./contracts";
export * from "./registry";

export interface PiConnectorsRegistrationOptions {
	readonly registry?: ConnectorRegistry;
}

function result(details: unknown) {
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
		details,
	};
}

function boundedId(value: unknown): string {
	const normalized = String(value ?? "")
		.normalize("NFKC")
		.trim();
	if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(normalized))
		throw new Error("connector id must be a non-empty bounded identifier");
	return normalized;
}

function descriptorView(descriptor: ConnectorDescriptor) {
	return {
		id: descriptor.id,
		version: descriptor.version,
		kind: descriptor.kind,
		label: descriptor.label,
		description: descriptor.description,
		enabledByDefault: descriptor.enabledByDefault,
		permissions: descriptor.permissions,
	};
}

/**
 * Register read-only discovery tools. They expose declarations only; no tool
 * in this package has a transport implementation or access to credentials.
 */
export function registerPiConnectors(
	pi: any,
	options: PiConnectorsRegistrationOptions = {},
): { readonly tools: readonly ["connector_list", "connector_get"]; readonly registry: ConnectorRegistry } {
	const registry = options.registry ?? createConnectorRegistry();
	pi.registerTool({
		name: "connector_list",
		label: "Connectors · list",
		description:
			"List host-neutral connector declarations, including capabilities, hosts, network scope, credentials and side effects. This performs no network or filesystem I/O.",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["connectors", "research"] },
		parameters: { type: "object", properties: {} },
		async execute() {
			return result({
				contractVersion: CONNECTOR_CONTRACT_VERSION,
				connectors: registry.list().map(descriptorView),
			});
		},
	});

	pi.registerTool({
		name: "connector_get",
		label: "Connectors · inspect",
		description:
			"Inspect one connector declaration. Execution, credentials, browser navigation and writes remain host responsibilities.",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["connectors", "research"] },
		parameters: {
			type: "object",
			properties: { id: { type: "string", minLength: 2, maxLength: 64 } },
			required: ["id"],
		},
		async execute(_id: string, params: { readonly id?: unknown }) {
			const descriptor = registry.require(boundedId(params?.id));
			return result({ contractVersion: CONNECTOR_CONTRACT_VERSION, connector: descriptorView(descriptor) });
		},
	});

	return { tools: ["connector_list", "connector_get"], registry };
}

/** Validate a descriptor before handing it to a host-side registry. */
export function assertConnectorDescriptor(descriptor: ConnectorDescriptor): ConnectorDescriptor {
	validateConnectorDescriptor(descriptor);
	return descriptor;
}

export default registerPiConnectors;
