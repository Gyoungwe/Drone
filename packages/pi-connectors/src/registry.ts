import type {
	ConnectorAccessDeclaration,
	ConnectorCapability,
	ConnectorCredentialDeclaration,
	ConnectorDescriptor,
	ConnectorHost,
	ConnectorKind,
	ConnectorNetworkDeclaration,
	ConnectorPermissionDeclaration,
} from "./contracts";

export interface ConnectorPermissionAudit {
	readonly id: string;
	readonly kind: ConnectorKind;
	readonly hosts: readonly ConnectorHost[];
	readonly capabilities: readonly ConnectorCapability[];
	readonly network: ConnectorNetworkDeclaration;
	readonly credentials: ConnectorCredentialDeclaration;
	readonly access: ConnectorAccessDeclaration;
	readonly readOnly: boolean;
	readonly externalSideEffects: ConnectorPermissionDeclaration["externalSideEffects"];
	readonly enabledByDefault: boolean;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/u;

function nonEmpty(value: string, label: string): void {
	if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function unique(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate values`);
}

function validatePermissions(id: string, permissions: ConnectorPermissionDeclaration): void {
	if (!permissions.capabilities.length) throw new Error(`Connector ${id} must declare capabilities`);
	if (!permissions.hosts.length) throw new Error(`Connector ${id} must declare at least one host`);
	unique(permissions.capabilities, `${id} capabilities`);
	unique(permissions.hosts, `${id} hosts`);
	unique(permissions.network.allowedHosts, `${id} network.allowedHosts`);
	unique(permissions.credentials.sources, `${id} credential sources`);
	unique(permissions.authorization.requiredFor, `${id} authorization.requiredFor`);
	unique(permissions.externalSideEffects, `${id} externalSideEffects`);
	if (!permissions.access.read && !permissions.access.write && !permissions.access.delete)
		throw new Error(`Connector ${id} must declare at least one access mode`);
	const expectedReadOnly = !permissions.access.write && !permissions.access.delete;
	if (permissions.readOnly !== expectedReadOnly)
		throw new Error(`Connector ${id} readOnly must match write/delete access`);
	if (permissions.network.mode === "none") {
		if (permissions.network.allowedHosts.length || permissions.network.hostAllowlistRequired)
			throw new Error(`Connector ${id} network=none cannot declare hosts or an allowlist`);
	} else {
		if (!permissions.network.allowedHosts.length)
			throw new Error(`Connector ${id} network access requires an explicit host label`);
		if (!permissions.network.hostAllowlistRequired)
			throw new Error(`Connector ${id} network access must require a host allowlist`);
	}
	if (!permissions.credentials.required && permissions.credentials.sources.includes("none")) {
		if (permissions.credentials.sources.length !== 1)
			throw new Error(`Connector ${id} cannot mix none and credential sources`);
	} else if (permissions.credentials.required && permissions.credentials.sources.includes("none")) {
		throw new Error(`Connector ${id} cannot require credentials from source none`);
	}
	for (const host of permissions.hosts) {
		if (host !== "native-pi" && host !== "drone-desktop")
			throw new Error(`Connector ${id} declares an unknown host: ${host}`);
	}
}

export function validateConnectorDescriptor(descriptor: ConnectorDescriptor): void {
	if (!ID_PATTERN.test(descriptor.id)) throw new Error(`Invalid connector id: ${descriptor.id}`);
	nonEmpty(descriptor.version, `${descriptor.id} version`);
	nonEmpty(descriptor.label, `${descriptor.id} label`);
	nonEmpty(descriptor.description, `${descriptor.id} description`);
	validatePermissions(descriptor.id, descriptor.permissions);
}

function freezeDescriptor(input: ConnectorDescriptor): ConnectorDescriptor {
	validateConnectorDescriptor(input);
	const network = Object.freeze({
		...input.permissions.network,
		allowedHosts: Object.freeze([...input.permissions.network.allowedHosts]),
	});
	const credentials = Object.freeze({
		...input.permissions.credentials,
		sources: Object.freeze([...input.permissions.credentials.sources]),
		...(input.permissions.credentials.references
			? { references: Object.freeze([...input.permissions.credentials.references]) }
			: {}),
	});
	const authorization = Object.freeze({
		...input.permissions.authorization,
		requiredFor: Object.freeze([...input.permissions.authorization.requiredFor]),
	});
	const permissions = Object.freeze({
		...input.permissions,
		capabilities: Object.freeze([...input.permissions.capabilities]),
		hosts: Object.freeze([...input.permissions.hosts]),
		network,
		credentials,
		access: Object.freeze({ ...input.permissions.access }),
		authorization,
		externalSideEffects: Object.freeze([...input.permissions.externalSideEffects]),
	});
	return Object.freeze({ ...input, permissions });
}

const readOnlyAuthorization = Object.freeze({ requiredFor: [] as const });

/**
 * Built-in declarations are intentionally conservative. They describe the
 * shape of a connector that a host may implement; none of them performs I/O.
 */
export const DEFAULT_CONNECTOR_DESCRIPTORS: readonly ConnectorDescriptor[] = [
	{
		id: "zotero",
		version: "1",
		kind: "citation",
		label: "Zotero",
		description: "Read Zotero library metadata and citation records through a host-owned API adapter.",
		permissions: {
			capabilities: ["search", "read", "resolve"],
			hosts: ["native-pi", "drone-desktop"],
			network: {
				mode: "public",
				allowedHosts: ["api.zotero.org"],
				hostAllowlistRequired: true,
			},
			credentials: {
				required: false,
				sources: ["host-secret-store", "environment"],
				references: ["zotero-api-key"],
			},
			access: { read: true, write: false, delete: false },
			readOnly: true,
			authorization: readOnlyAuthorization,
			externalSideEffects: [],
		},
		enabledByDefault: false,
	},
	{
		id: "webdav",
		version: "1",
		kind: "storage",
		label: "WebDAV",
		description: "Read files and directory metadata from a configured WebDAV endpoint.",
		permissions: {
			capabilities: ["list", "read", "resolve"],
			hosts: ["native-pi", "drone-desktop"],
			network: {
				mode: "configured",
				allowedHosts: ["configured-webdav-host"],
				hostAllowlistRequired: true,
			},
			credentials: {
				required: true,
				sources: ["host-secret-store", "environment"],
				references: ["webdav-credential-ref"],
			},
			access: { read: true, write: false, delete: false },
			readOnly: true,
			authorization: readOnlyAuthorization,
			externalSideEffects: [],
		},
		enabledByDefault: false,
	},
	{
		id: "generic-mcp",
		version: "1",
		kind: "mcp",
		label: "Generic MCP",
		description:
			"Discover and invoke host-selected read-only MCP tools; server writes require a separate host contract.",
		permissions: {
			capabilities: ["discover", "read", "invoke"],
			hosts: ["native-pi", "drone-desktop"],
			network: {
				mode: "configured",
				allowedHosts: ["host-configured-mcp-endpoint"],
				hostAllowlistRequired: true,
			},
			credentials: {
				required: false,
				sources: ["mcp-config", "host-secret-store"],
				references: ["mcp-server-config"],
			},
			access: { read: true, write: false, delete: false },
			readOnly: true,
			authorization: {
				requiredFor: ["invoke"],
				reason: "The host must approve each selected MCP tool surface.",
			},
			externalSideEffects: [],
		},
		enabledByDefault: false,
	},
	{
		id: "institutional",
		version: "1",
		kind: "institutional",
		label: "Institutional access",
		description:
			"Resolve and read institutionally accessible sources through a host-managed session or browser handoff.",
		permissions: {
			capabilities: ["search", "read", "resolve", "browser-handoff"],
			hosts: ["native-pi", "drone-desktop"],
			network: {
				mode: "institutional",
				allowedHosts: ["configured-institutional-host"],
				hostAllowlistRequired: true,
			},
			credentials: {
				required: true,
				sources: ["browser-session", "oauth"],
				references: ["institutional-session-ref"],
			},
			access: { read: true, write: false, delete: false },
			readOnly: true,
			authorization: {
				requiredFor: ["browser-handoff"],
				reason: "A human-approved browser handoff is required for login or challenge pages.",
			},
			externalSideEffects: ["browser-navigation"],
		},
		enabledByDefault: false,
	},
	{
		id: "search",
		version: "1",
		kind: "search",
		label: "External search",
		description: "Search declared public providers and return provider-neutral source leads with receipts.",
		permissions: {
			capabilities: ["search", "read", "resolve"],
			hosts: ["native-pi", "drone-desktop"],
			network: {
				mode: "public",
				allowedHosts: ["declared-search-provider"],
				hostAllowlistRequired: true,
			},
			credentials: { required: false, sources: ["none"] },
			access: { read: true, write: false, delete: false },
			readOnly: true,
			authorization: readOnlyAuthorization,
			externalSideEffects: [],
		},
		enabledByDefault: false,
	},
	{
		id: "browser",
		version: "1",
		kind: "browser",
		label: "Browser source reader",
		description: "Read an explicitly approved browser target and return a bounded source receipt.",
		permissions: {
			capabilities: ["search", "read", "browser-handoff"],
			hosts: ["native-pi", "drone-desktop"],
			network: {
				mode: "public",
				allowedHosts: ["host-approved-navigation-target"],
				hostAllowlistRequired: true,
			},
			credentials: { required: false, sources: ["browser-session"] },
			access: { read: true, write: false, delete: false },
			readOnly: true,
			authorization: {
				requiredFor: ["browser-handoff"],
				reason: "Navigation must be explicitly approved by the host/user.",
			},
			externalSideEffects: ["browser-navigation"],
		},
		enabledByDefault: false,
	},
] as const;

export function defaultConnectorDescriptors(): readonly ConnectorDescriptor[] {
	return DEFAULT_CONNECTOR_DESCRIPTORS.map(freezeDescriptor);
}

export class ConnectorRegistry {
	private readonly descriptors = new Map<string, ConnectorDescriptor>();

	constructor(descriptors: readonly ConnectorDescriptor[] = defaultConnectorDescriptors()) {
		for (const descriptor of descriptors) this.register(descriptor);
	}

	register(descriptor: ConnectorDescriptor): void {
		const frozen = freezeDescriptor(descriptor);
		if (this.descriptors.has(frozen.id)) throw new Error(`Connector already registered: ${frozen.id}`);
		this.descriptors.set(frozen.id, frozen);
	}

	get(id: string): ConnectorDescriptor | undefined {
		return this.descriptors.get(id);
	}

	require(id: string): ConnectorDescriptor {
		const descriptor = this.get(id);
		if (!descriptor) throw new Error(`Unknown connector: ${id}`);
		return descriptor;
	}

	list(): readonly ConnectorDescriptor[] {
		return [...this.descriptors.values()].sort((left, right) => left.id.localeCompare(right.id));
	}

	findByKind(kind: ConnectorKind): readonly ConnectorDescriptor[] {
		return this.list().filter((descriptor) => descriptor.kind === kind);
	}

	forHost(host: ConnectorHost): readonly ConnectorDescriptor[] {
		return this.list().filter((descriptor) => descriptor.permissions.hosts.includes(host));
	}

	permissionAudit(): readonly ConnectorPermissionAudit[] {
		return this.list().map((descriptor) => ({
			id: descriptor.id,
			kind: descriptor.kind,
			hosts: descriptor.permissions.hosts,
			capabilities: descriptor.permissions.capabilities,
			network: descriptor.permissions.network,
			credentials: descriptor.permissions.credentials,
			access: descriptor.permissions.access,
			readOnly: descriptor.permissions.readOnly,
			externalSideEffects: descriptor.permissions.externalSideEffects,
			enabledByDefault: descriptor.enabledByDefault,
		}));
	}
}

export function createConnectorRegistry(descriptors?: readonly ConnectorDescriptor[]): ConnectorRegistry {
	return new ConnectorRegistry(descriptors);
}
