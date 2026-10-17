/**
 * Public host contract for Drone capability plugins.
 *
 * Keep this module dependency-free. It is consumed by native Pi packages and
 * by the Desktop adapter, so it must not import Electron, the Pi SDK, or any
 * Drone implementation package. Runtime values are deliberately limited to
 * the API/contract identifiers and the pure negotiation helper below.
 */

export const PLUGIN_API_VERSION = 1 as const;
export const RESULT_CONTRACT = "drone-result/v3" as const;

export type PluginApiVersion = typeof PLUGIN_API_VERSION;
export type ResultContractVersion = typeof RESULT_CONTRACT;
export type PluginHost = "native-pi" | "drone-desktop";

/** Capability identifiers are open-ended so new host features remain additive. */
export type HostCapability =
	| "readSource"
	| "searchKnowledge"
	| "persistRun"
	| "runCompute"
	| "requestAuthorization"
	| (string & {});

export interface HostCapabilities {
	readonly host: PluginHost;
	readonly hostVersion: string;
	/** Drone Plugin API major implemented by this host. */
	readonly pluginApiVersion: number;
	/** Pi extension API version, kept separate from the Drone contract. */
	readonly piApiVersion?: number;
	readonly capabilities: readonly HostCapability[];
}

export interface PluginRequirements {
	readonly pluginApi: number;
	readonly minHostVersion?: string;
	readonly hosts?: readonly PluginHost[];
	readonly capabilities?: readonly HostCapability[];
}

/** v1 intentionally has no degraded/partial loading state. */
export type CapabilityNegotiationStatus = "compatible" | "incompatible";

export interface CapabilityNegotiation {
	readonly status: CapabilityNegotiationStatus;
	readonly host: PluginHost;
	readonly pluginApi: number;
	readonly missingCapabilities: readonly HostCapability[];
	readonly reason?: "plugin-api" | "host-version" | "host" | "capability";
	readonly message?: string;
}

/**
 * Compare the numeric components of a host version. Pre-release suffixes are
 * intentionally treated as the same patch for the v1 minimum-version gate;
 * the CI matrix is responsible for testing the exact supported Pi versions.
 */
export function compareHostVersions(left: string, right: string): number {
	const parse = (value: string): number[] =>
		value
			.trim()
			.replace(/^v/i, "")
			.split(".")
			.slice(0, 3)
			.map((part) => {
				const match = part.match(/^\d+/);
				return match ? Number(match[0]) : 0;
			});
	const a = parse(left);
	const b = parse(right);
	for (let i = 0; i < 3; i += 1) {
		const delta = (a[i] ?? 0) - (b[i] ?? 0);
		if (delta !== 0) return delta;
	}
	return 0;
}

/** Validate a plugin manifest's host requirements without loading its code. */
export function negotiateCapabilities(
	requirements: PluginRequirements,
	host: HostCapabilities,
): CapabilityNegotiation {
	if (requirements.pluginApi !== host.pluginApiVersion) {
		return {
			status: "incompatible",
			host: host.host,
			pluginApi: requirements.pluginApi,
			missingCapabilities: [],
			reason: "plugin-api",
			message: `Plugin API ${requirements.pluginApi} requires host API ${requirements.pluginApi}; host provides ${host.pluginApiVersion}.`,
		};
	}
	if (requirements.hosts && !requirements.hosts.includes(host.host)) {
		return {
			status: "incompatible",
			host: host.host,
			pluginApi: requirements.pluginApi,
			missingCapabilities: [],
			reason: "host",
			message: `Plugin does not declare support for ${host.host}.`,
		};
	}
	if (requirements.minHostVersion && compareHostVersions(host.hostVersion, requirements.minHostVersion) < 0) {
		return {
			status: "incompatible",
			host: host.host,
			pluginApi: requirements.pluginApi,
			missingCapabilities: [],
			reason: "host-version",
			message: `Host ${host.hostVersion} is below the required ${requirements.minHostVersion}.`,
		};
	}
	const available = new Set(host.capabilities);
	const missingCapabilities = (requirements.capabilities ?? []).filter(
		(capability) => !available.has(capability),
	);
	if (missingCapabilities.length) {
		return {
			status: "incompatible",
			host: host.host,
			pluginApi: requirements.pluginApi,
			missingCapabilities,
			reason: "capability",
			message: `Host is missing: ${missingCapabilities.join(", ")}.`,
		};
	}
	return {
		status: "compatible",
		host: host.host,
		pluginApi: requirements.pluginApi,
		missingCapabilities: [],
	};
}

export interface ReadSourceInput {
	readonly sourceRef: string;
	readonly revision?: string;
	readonly locator?: string;
}

export interface ReadReceipt {
	readonly sourceRef: string;
	readonly receiptRef: string;
	readonly contentHash: string;
	readonly readAt: string;
	readonly version?: string;
	readonly content: string;
}

export interface SearchInput {
	readonly query: string;
	readonly limit?: number;
	readonly scope?: string;
}

export interface SearchResultItem {
	readonly sourceRef: string;
	readonly title?: string;
	readonly snippet?: string;
	readonly contentHash?: string;
	readonly receiptRef?: string;
}

export interface SearchResult {
	readonly query: string;
	readonly items: readonly SearchResultItem[];
	readonly searchedAt: string;
}

export type ResultStatus =
	| "unknown"
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "blocked"
	| "cancelled";

export type ResultRedlineCode =
	| "missing-source"
	| "stale-source"
	| "hash-mismatch"
	| "authorization-required"
	| "missing-provenance"
	| "unknown";

export interface ResultRedline {
	readonly code: ResultRedlineCode;
	readonly message: string;
	readonly blocking: boolean;
	readonly sourceRefs?: readonly string[];
}

export interface RunSnapshot {
	readonly runId: string;
	readonly status: ResultStatus;
	readonly inputRefs: readonly string[];
	readonly outputRefs: readonly string[];
	readonly startedAt?: string;
	readonly finishedAt?: string;
	readonly redlines?: readonly ResultRedline[];
	readonly error?: string;
}

export interface RunReceipt {
	readonly contract: ResultContractVersion;
	readonly runId: string;
	readonly status: ResultStatus;
	readonly recordedAt: string;
	readonly outputRefs: readonly string[];
	readonly redlines: readonly ResultRedline[];
	readonly receiptRef: string;
	readonly error?: string;
}

export interface ComputeRequest {
	readonly runId: string;
	readonly workflowId: string;
	readonly inputRefs: readonly string[];
	readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
	readonly authorizationRef?: string;
}

export interface ComputeReceipt {
	readonly contract: ResultContractVersion;
	readonly runId: string;
	readonly status: ResultStatus;
	readonly receiptRef: string;
	readonly outputRefs: readonly string[];
	readonly redlines: readonly ResultRedline[];
	readonly submittedAt?: string;
	readonly finishedAt?: string;
	readonly error?: string;
}

export interface AuthorizationRequest {
	readonly action: string;
	readonly reason?: string;
	readonly scope?: string;
}

export interface AuthorizationReceipt {
	readonly granted: boolean;
	readonly authorizationRef?: string;
	readonly decidedAt: string;
	readonly reason?: string;
}

/** Stable host seam shared by native Pi and Drone Desktop adapters. */
export interface DroneHostPort {
	readonly host: PluginHost;
	capabilities(): HostCapabilities;
	readSource(input: ReadSourceInput): Promise<ReadReceipt>;
	searchKnowledge(input: SearchInput): Promise<SearchResult>;
	persistRun(snapshot: RunSnapshot): Promise<RunReceipt>;
	runCompute(input: ComputeRequest): Promise<ComputeReceipt>;
	requestAuthorization(input: AuthorizationRequest): Promise<AuthorizationReceipt>;
}
