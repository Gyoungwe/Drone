/**
 * Host-neutral contracts for optional research connectors.
 *
 * This package deliberately contains no transport implementation. A host may
 * use these contracts to decide whether it can execute an operation and to
 * record a provenance receipt, but the package never opens a socket, reads a
 * credential, launches a browser, or performs a write/delete itself.
 */

export const CONNECTOR_CONTRACT_VERSION = 1 as const;
export const CONNECTOR_RECEIPT_CONTRACT = "drone-connector-receipt/v1" as const;

export type ConnectorContractVersion = typeof CONNECTOR_CONTRACT_VERSION;
export type ConnectorReceiptContract = typeof CONNECTOR_RECEIPT_CONTRACT;

export type ConnectorHost = "native-pi" | "drone-desktop";

export type ConnectorKind = "citation" | "storage" | "mcp" | "institutional" | "search" | "browser";

/** Operations are requests to a host; this package does not execute them. */
export type ConnectorOperation =
	| "search"
	| "list"
	| "read"
	| "resolve"
	| "invoke"
	| "browser-handoff"
	| "write"
	| "delete";

/** Capability names are intentionally additive so hosts can extend the catalog. */
export type ConnectorCapability =
	| "search"
	| "list"
	| "read"
	| "resolve"
	| "discover"
	| "invoke"
	| "browser-handoff"
	| (string & {});

export type ConnectorNetworkMode = "none" | "public" | "configured" | "institutional" | "local";

export type ConnectorCredentialSource =
	| "none"
	| "host-secret-store"
	| "environment"
	| "oauth"
	| "browser-session"
	| "mcp-config";

export type ConnectorExternalSideEffect =
	| "browser-navigation"
	| "credential-use"
	| "remote-write"
	| "remote-delete"
	| "subprocess"
	| (string & {});

export interface ConnectorNetworkDeclaration {
	readonly mode: ConnectorNetworkMode;
	/** Hostnames are policy labels, never URLs or credentials. */
	readonly allowedHosts: readonly string[];
	/** True when the host must apply its own allowlist before transport. */
	readonly hostAllowlistRequired: boolean;
}

export interface ConnectorCredentialDeclaration {
	/** A host must not infer or prompt for credentials when this is false. */
	readonly required: boolean;
	/** Opaque sources accepted by the host; secret values never cross this API. */
	readonly sources: readonly ConnectorCredentialSource[];
	/** Optional names only; values and tokens are never represented here. */
	readonly references?: readonly string[];
}

export interface ConnectorAccessDeclaration {
	readonly read: boolean;
	readonly write: boolean;
	readonly delete: boolean;
}

export interface ConnectorAuthorizationDeclaration {
	/** Operations that require a host-provided authorization reference. */
	readonly requiredFor: readonly ConnectorOperation[];
	readonly reason?: string;
}

/** Every descriptor makes its side effects explicit, including browser navigation. */
export interface ConnectorPermissionDeclaration {
	readonly capabilities: readonly ConnectorCapability[];
	readonly hosts: readonly ConnectorHost[];
	readonly network: ConnectorNetworkDeclaration;
	readonly credentials: ConnectorCredentialDeclaration;
	readonly access: ConnectorAccessDeclaration;
	/** Convenience flag for the common default profile. */
	readonly readOnly: boolean;
	readonly authorization: ConnectorAuthorizationDeclaration;
	readonly externalSideEffects: readonly ConnectorExternalSideEffect[];
}

export interface ConnectorDescriptor {
	readonly id: string;
	readonly version: string;
	readonly kind: ConnectorKind;
	readonly label: string;
	readonly description: string;
	readonly permissions: ConnectorPermissionDeclaration;
	/** Connectors are discovered only; the host decides when to enable one. */
	readonly enabledByDefault: boolean;
}

export type ConnectorReceiptStatus = "succeeded" | "blocked" | "failed" | "unknown";

export type ConnectorReceiptPhase = "attempt" | "readback" | "delete" | "absence-readback";

export interface ConnectorReceipt {
	readonly schemaVersion: ConnectorContractVersion;
	readonly contract: ConnectorReceiptContract;
	readonly receiptId: string;
	readonly connectorId: string;
	readonly host: ConnectorHost;
	readonly operation: ConnectorOperation;
	readonly phase: ConnectorReceiptPhase;
	readonly status: ConnectorReceiptStatus;
	readonly observedAt: string;
	readonly readOnly: boolean;
	readonly externalSideEffects: readonly ConnectorExternalSideEffect[];
	readonly sourceRef?: string;
	readonly locator?: string;
	readonly externalId?: string;
	readonly contentHash?: string;
	/** Opaque authorization/credential handles; never the values themselves. */
	readonly authorizationRef?: string;
	readonly credentialRef?: string;
	readonly parentReceiptId?: string;
	readonly message?: string;
}

export type ConnectorReceiptInput = Omit<ConnectorReceipt, "schemaVersion" | "contract"> &
	Partial<Pick<ConnectorReceipt, "schemaVersion" | "contract">>;

export interface ConnectorReceiptChain {
	readonly schemaVersion: ConnectorContractVersion;
	readonly contract: ConnectorReceiptContract;
	readonly chainId: string;
	readonly connectorId: string;
	readonly operation: "write" | "delete";
	readonly startedAt: string;
	readonly finishedAt?: string;
	readonly status: ConnectorReceiptStatus;
	readonly receipts: readonly ConnectorReceipt[];
}

export interface ConnectorReceiptChainInput
	extends Omit<ConnectorReceiptChain, "schemaVersion" | "contract" | "receipts"> {
	readonly receipts: readonly ConnectorReceipt[];
	readonly schemaVersion?: ConnectorContractVersion;
	readonly contract?: ConnectorReceiptContract;
}

/**
 * An execution request is a host seam. `input` is provider-shaped metadata,
 * while credential and authorization fields are opaque references.
 */
export interface ConnectorOperationRequest {
	readonly connectorId: string;
	readonly operation: ConnectorOperation;
	readonly input: Readonly<Record<string, unknown>>;
	readonly authorizationRef?: string;
	readonly credentialRef?: string;
}

export interface ConnectorExecutionPort {
	/** Host-owned transport; implementations live outside this package. */
	execute(request: ConnectorOperationRequest): Promise<ConnectorReceipt>;
}

export type ConnectorPlanStatus = "allowed" | "requires-authorization" | "unsupported";

export interface ConnectorOperationPlan {
	readonly connectorId: string;
	readonly operation: ConnectorOperation;
	readonly status: ConnectorPlanStatus;
	readonly reason?: string;
}

function operationAllowed(access: ConnectorAccessDeclaration, operation: ConnectorOperation): boolean {
	if (operation === "write") return access.write;
	if (operation === "delete") return access.delete;
	return access.read;
}

/**
 * Plan an operation against a declaration without invoking a transport. This
 * is useful in both native Pi and Desktop composition roots for fail-closed UI.
 */
export function planConnectorOperation(
	descriptor: ConnectorDescriptor,
	operation: ConnectorOperation,
	authorizationRef?: string,
): ConnectorOperationPlan {
	if (!operationAllowed(descriptor.permissions.access, operation)) {
		return {
			connectorId: descriptor.id,
			operation,
			status: "unsupported",
			reason: `${descriptor.id} does not declare ${operation} access`,
		};
	}
	if (descriptor.permissions.authorization.requiredFor.includes(operation) && !authorizationRef) {
		return {
			connectorId: descriptor.id,
			operation,
			status: "requires-authorization",
			reason: descriptor.permissions.authorization.reason ?? "A host authorization reference is required",
		};
	}
	return { connectorId: descriptor.id, operation, status: "allowed" };
}

/** Create a frozen receipt envelope from host-observed metadata. */
export function createConnectorReceipt(input: ConnectorReceiptInput): ConnectorReceipt {
	const receipt: ConnectorReceipt = {
		schemaVersion: input.schemaVersion ?? CONNECTOR_CONTRACT_VERSION,
		contract: input.contract ?? CONNECTOR_RECEIPT_CONTRACT,
		receiptId: input.receiptId,
		connectorId: input.connectorId,
		host: input.host,
		operation: input.operation,
		phase: input.phase,
		status: input.status,
		observedAt: input.observedAt,
		readOnly: input.readOnly,
		externalSideEffects: [...input.externalSideEffects],
		...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
		...(input.locator ? { locator: input.locator } : {}),
		...(input.externalId ? { externalId: input.externalId } : {}),
		...(input.contentHash ? { contentHash: input.contentHash } : {}),
		...(input.authorizationRef ? { authorizationRef: input.authorizationRef } : {}),
		...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
		...(input.parentReceiptId ? { parentReceiptId: input.parentReceiptId } : {}),
		...(input.message ? { message: input.message } : {}),
	};
	validateConnectorReceipt(receipt);
	Object.freeze(receipt.externalSideEffects);
	return Object.freeze(receipt);
}

export function validateConnectorReceipt(receipt: ConnectorReceipt): void {
	if (receipt.schemaVersion !== CONNECTOR_CONTRACT_VERSION)
		throw new Error(`Unsupported connector receipt schema: ${receipt.schemaVersion}`);
	if (receipt.contract !== CONNECTOR_RECEIPT_CONTRACT)
		throw new Error(`Unsupported connector receipt contract: ${receipt.contract}`);
	if (!receipt.receiptId.trim() || !receipt.connectorId.trim() || !receipt.observedAt.trim())
		throw new Error("Connector receipt id, connector id and observedAt are required");
	if (receipt.operation === "write" || receipt.operation === "delete") {
		if (receipt.readOnly) throw new Error(`${receipt.operation} receipts cannot be readOnly`);
	} else if (!receipt.readOnly) {
		throw new Error(`${receipt.operation} receipts must be readOnly in the default contract`);
	}
	if (receipt.externalSideEffects.includes("remote-write") && receipt.readOnly)
		throw new Error("A readOnly receipt cannot declare a remote-write side effect");
	if (receipt.externalSideEffects.includes("remote-delete") && receipt.readOnly)
		throw new Error("A readOnly receipt cannot declare a remote-delete side effect");
}

export function createConnectorReceiptChain(input: ConnectorReceiptChainInput): ConnectorReceiptChain {
	if (input.operation !== "write" && input.operation !== "delete")
		throw new Error("Receipt chains must describe a write or delete operation");
	for (const receipt of input.receipts) {
		validateConnectorReceipt(receipt);
		if (receipt.connectorId !== input.connectorId)
			throw new Error("All receipts in a chain must use the same connector");
	}
	const chain: ConnectorReceiptChain = {
		schemaVersion: input.schemaVersion ?? CONNECTOR_CONTRACT_VERSION,
		contract: input.contract ?? CONNECTOR_RECEIPT_CONTRACT,
		chainId: input.chainId,
		connectorId: input.connectorId,
		operation: input.operation,
		startedAt: input.startedAt,
		...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
		status: input.status,
		receipts: [...input.receipts],
	};
	if (chain.schemaVersion !== CONNECTOR_CONTRACT_VERSION || chain.contract !== CONNECTOR_RECEIPT_CONTRACT)
		throw new Error("Unsupported connector receipt chain contract");
	Object.freeze(chain.receipts);
	return Object.freeze(chain);
}
