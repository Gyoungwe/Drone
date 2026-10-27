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

export * from "./research.js";
export * from "./tasks.js";

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

/** Permission scopes that a Drone manifest may declare for host-mediated work. */
export type PluginFilesystemPermission =
	| "workspace-read"
	| "workspace"
	| "configured-vault"
	| "configured-vault-write"
	| "vault-read"
	/** Declares explicit state/lease roots; requires a scoped storage broker, not arbitrary file access. */
	| "application-state";

export interface PluginPermissionDeclaration {
	readonly filesystem: readonly PluginFilesystemPermission[];
	readonly network: readonly string[];
	readonly subprocess: readonly string[];
	readonly externalWrites: boolean;
}

export type PluginPermissionOperation =
	| "filesystem-read"
	| "filesystem-write"
	| "network"
	| "subprocess"
	| "external-write";

export interface PluginPermissionRequest {
	readonly pluginId: string;
	readonly operation: PluginPermissionOperation;
	readonly action: string;
	readonly reason?: string;
	readonly scope?: string;
}

/** Redacted, host-owned audit record. It deliberately contains no payload or credential values. */
export interface PluginPermissionAuditEvent {
	readonly pluginId: string;
	readonly operation: PluginPermissionOperation;
	readonly action: string;
	readonly granted: boolean;
	readonly at: string;
	readonly reason?: string;
}

export type PluginPermissionAuditSink = (event: PluginPermissionAuditEvent) => void;

export interface PermissionedHostPortOptions {
	readonly pluginId: string;
	readonly permissions: PluginPermissionDeclaration;
	readonly audit?: PluginPermissionAuditSink;
}

/**
 * Enforce manifest permissions at the host boundary used by a plugin.
 *
 * Plugins must route side effects through `DroneHostPort`; this wrapper turns
 * the declaration into an executable deny gate before asking the host/user for
 * authorization. Undeclared operations fail closed and are audited. Direct
 * filesystem/process access by plugin code remains outside this contract and
 * requires a separate process sandbox (tracked in the next-stage plan).
 */
export function createPermissionedHostPort(
	base: DroneHostPort,
	options: PermissionedHostPortOptions,
): DroneHostPort {
	const audit = (
		operation: PluginPermissionOperation,
		input: AuthorizationRequest,
		granted: boolean,
		reason?: string,
	) => {
		options.audit?.({
			pluginId: options.pluginId,
			operation,
			action: input.action,
			granted,
			at: new Date().toISOString(),
			...(reason ? { reason } : {}),
		});
	};
	const allows = (operation: PluginPermissionOperation): boolean => {
		switch (operation) {
			case "filesystem-read":
				return options.permissions.filesystem.some((scope) =>
					[
						"workspace-read",
						"workspace",
						"configured-vault",
						"configured-vault-write",
						"vault-read",
					].includes(scope),
				);
			case "filesystem-write":
				return options.permissions.filesystem.some((scope) =>
					["workspace", "configured-vault-write"].includes(scope),
				);
			case "network":
				return options.permissions.network.length > 0;
			case "subprocess":
				return options.permissions.subprocess.length > 0;
			case "external-write":
				return options.permissions.externalWrites;
		}
	};
	const classify = (action: string): PluginPermissionOperation | undefined => {
		const normalized = action.trim().toLowerCase();
		if (/^(?:delete|external[-_ ]?write|publish|remote[-_ ]?write|write\b)/u.test(normalized))
			return "external-write";
		if (/^(?:subprocess|exec|shell|command)\b/u.test(normalized)) return "subprocess";
		if (/^(?:network|fetch|http|https)\b/u.test(normalized)) return "network";
		if (/^(?:filesystem[-_ ]?write|file[-_ ]?write)\b/u.test(normalized)) return "filesystem-write";
		if (/^(?:filesystem[-_ ]?read|file[-_ ]?read)\b/u.test(normalized)) return "filesystem-read";
		return undefined;
	};
	return {
		...base,
		requestAuthorization: async (input) => {
			const operation = classify(input.action);
			if (!operation) return base.requestAuthorization(input);
			if (!allows(operation)) {
				const reason = `Plugin ${options.pluginId} did not declare permission for ${operation}`;
				audit(operation, input, false, reason);
				return { granted: false, decidedAt: new Date().toISOString(), reason };
			}
			const receipt = await base.requestAuthorization(input);
			audit(operation, input, receipt.granted, receipt.reason);
			return receipt;
		},
	};
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

export * from "./knowledge.js";

/** Public, host-neutral analysis contract used by native Pi packages. */
export const ANALYSIS_CONTRACT_VERSION = 1 as const;
export type AnalysisMode = "exploratory" | "inferential";
export type AnalysisDomain = "bioinformatics" | "genomics" | "transcriptomics" | "proteomics" | "other";
export type AnalysisResearchStage = "design" | "readiness" | "execution" | "review" | "delivery";
export type AnalysisSideEffect =
	| "read-only"
	| "network"
	| "project-write"
	| "code-execution"
	| "external-service";
export type AnalysisGateSeverity = "pause" | "block";
export type AnalysisGateCode =
	| "scientific-ambiguity"
	| "missing-data"
	| "missing-biological-replicates"
	| "reference-mismatch"
	| "unsupported-method";

export interface AnalysisIdentity {
	readonly id: string;
	readonly version: string;
}

export interface AnalysisGate {
	readonly code: AnalysisGateCode;
	readonly severity: AnalysisGateSeverity;
	readonly message: string;
	readonly evidenceKey: string;
}

export interface AnalysisReadiness {
	readonly ok: boolean;
	readonly inferentialClaimsAllowed: boolean;
	readonly gates: readonly AnalysisGate[];
	readonly warnings: readonly string[];
}

export interface AnalysisContext {
	readonly version: typeof ANALYSIS_CONTRACT_VERSION;
	readonly id: string;
	readonly question: string;
	readonly assay: string;
	readonly mode: AnalysisMode;
	readonly adapter?: AnalysisIdentity;
}

export interface AnalysisSchemaField {
	readonly id: string;
	readonly type: "file" | "table" | "metadata" | "metric" | "report";
	readonly required: boolean;
	readonly formats?: readonly string[];
}

export interface AnalysisDatasetFileRef {
	readonly path: string;
	readonly bytes?: number;
	readonly sha256?: string;
}

/** Host maps its ComputePreflightJobSpec into this immutable portable shape. */
export interface AnalysisComputePlanInput {
	readonly outputs?: readonly (string | { readonly path: string })[];
	readonly dataDesign?: {
		readonly rows?: readonly Readonly<Record<string, unknown>>[];
		readonly dataset?: { readonly files?: readonly AnalysisDatasetFileRef[] };
	};
}

export interface AnalysisAdapterContract {
	readonly schemaVersion: typeof ANALYSIS_CONTRACT_VERSION;
	readonly assay: string;
	readonly domain: AnalysisDomain;
	readonly researchStages: readonly AnalysisResearchStage[];
	readonly inputs: readonly AnalysisSchemaField[];
	readonly outputs: readonly AnalysisSchemaField[];
	readonly capabilities: readonly string[];
	readonly sideEffects: readonly AnalysisSideEffect[];
	readonly evidenceTypes: readonly string[];
	readonly workflow?: AnalysisIdentity;
}

export interface AnalysisArtifactEvidence {
	readonly path: string;
	readonly bytes?: number;
	readonly sha256?: string;
	readonly text?: string;
}

export interface AnalysisReviewCheck {
	readonly id: string;
	readonly passed: boolean;
	readonly detail: string;
}

export interface AnalysisAdapterPlan {
	readonly method: AnalysisIdentity;
	readonly requiredOutputs: readonly string[];
	readonly assessment: AnalysisReadiness;
	readonly adapterSnapshotSha256: string;
}

export interface AnalysisAdapter {
	readonly identity: AnalysisIdentity;
	readonly contract: AnalysisAdapterContract;
	supports(assay: string): boolean;
	buildPlan(context: AnalysisContext, spec: AnalysisComputePlanInput, evidence: unknown): AnalysisAdapterPlan;
	reviewResults(
		context: AnalysisContext,
		artifacts: readonly AnalysisArtifactEvidence[],
	): readonly AnalysisReviewCheck[];
	readonly reviewInstructions: string;
}

/** Versioned registry surface exposed by an analysis plugin to its host. */
export interface AnalysisAdapterRegistryPort {
	resolve(assay: string, identity?: AnalysisIdentity): AnalysisAdapter;
	list(): readonly AnalysisAdapter[];
	find(identity: AnalysisIdentity): AnalysisAdapter | undefined;
	findByAssay(assay: string): readonly AnalysisAdapter[];
}

/** Stable host entry contract for plugins that provide analysis adapters. */
export interface AnalysisHostPort {
	readonly contractVersion: 1;
	readonly registry: AnalysisAdapterRegistryPort;
}

/** Loader contract keeps host composition independent of adapter implementations. */
export interface AnalysisHostLoader {
	readonly contractVersion: 1;
	load(): AnalysisHostPort;
}

/** Read-only knowledge surface exposed by an installed knowledge plugin. */
export interface KnowledgeReadHostPort {
	readonly contractVersion: 1;
	overview(input: unknown): Promise<unknown>;
	search(input: unknown): Promise<unknown>;
	read(input: unknown): Promise<unknown>;
	noteLinks(input: unknown): Promise<unknown>;
	graph(input: unknown): Promise<unknown>;
	/** Optional knowledge review UI operations supplied by the installed plugin. */
	reviews?(input: unknown): Promise<unknown>;
	preview?(input: unknown): Promise<unknown>;
	decide?(input: unknown): Promise<unknown>;
	setupPreview?(input: unknown): Promise<unknown>;
	specialistSettings?(input: unknown): Promise<unknown>;
	openTarget?(input: unknown): Promise<unknown>;
	semantic?: {
		status(input: unknown): Promise<unknown>;
		saveSettings(input: unknown): Promise<unknown>;
		testProvider(input: unknown): Promise<unknown>;
		index(input: unknown): Promise<unknown>;
		cancelIndex(input: unknown): Promise<unknown>;
	};
	/** Optional UI operations supplied by the installed knowledge plugin. */
	jobs?(input: unknown): Promise<unknown>;
	maintenance?(input: unknown): Promise<unknown>;
}

/** Stable host entry contract for the knowledge capability. */
export interface KnowledgeHostPort extends KnowledgeReadHostPort {}

/** Loader contract keeps the host independent of the knowledge implementation. */
export interface KnowledgeHostLoader {
	readonly contractVersion: 1;
	load(): KnowledgeHostPort;
}

/** Read-only tool surface exposed by an installed evidence plugin. */
export interface EvidenceHostTool {
	execute(input: unknown): Promise<unknown> | unknown;
}

export type EvidenceHostToolName =
	| "analysis_prepare_evidence"
	| "evidence_validate_manifest"
	| "evidence_verify_replay";

export interface EvidenceHostManifest {
	readonly tools: readonly string[];
}

/** Stable host entry contract for the optional evidence capability. */
export interface EvidenceHostPort {
	/** Optional for compatibility with pre-loader host fixtures; loaders return version 1. */
	readonly contractVersion?: 1;
	readonly manifest: EvidenceHostManifest;
	readonly tools: Readonly<Partial<Record<EvidenceHostToolName, EvidenceHostTool>>>;
}

/** Loader contract keeps the host independent of evidence implementation details. */
export interface EvidenceHostLoader {
	readonly contractVersion: 1;
	load(): EvidenceHostPort;
}

function stableContractJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableContractJson).join(",")}]`;
	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableContractJson(object[key])}`)
		.join(",")}}`;
}

// Small dependency-free SHA-256 implementation keeps the public contract
// usable from native Pi, Electron preload and browser-based hosts alike.
function sha256Hex(input: string): string {
	const encoded = encodeURIComponent(input);
	const utf8: number[] = [];
	for (let i = 0; i < encoded.length; i += 1) {
		if (encoded[i] === "%") {
			utf8.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
			i += 2;
		} else {
			utf8.push(encoded.charCodeAt(i));
		}
	}
	const bytes = Uint8Array.from(utf8);
	const words = new Array<number>(64).fill(0);
	const hash: number[] = [
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	];
	const constants: number[] = [
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
		0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	];
	const readNumber = (values: readonly number[], index: number): number => {
		const value = values[index];
		if (value === undefined) throw new Error(`SHA-256 state index ${index} is out of bounds`);
		return value;
	};
	const bitLength = bytes.length * 8;
	const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 4, bitLength >>> 0);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4);
		for (let i = 16; i < 64; i += 1) {
			const value = readNumber(words, i - 15);
			const smallSigma0 = ((value >>> 7) | (value << 25)) ^ ((value >>> 18) | (value << 14)) ^ (value >>> 3);
			const previous = readNumber(words, i - 2);
			const smallSigma1 =
				((previous >>> 17) | (previous << 15)) ^ ((previous >>> 19) | (previous << 13)) ^ (previous >>> 10);
			words[i] = (readNumber(words, i - 16) + smallSigma0 + readNumber(words, i - 7) + smallSigma1) >>> 0;
		}
		let a = readNumber(hash, 0);
		let b = readNumber(hash, 1);
		let c = readNumber(hash, 2);
		let d = readNumber(hash, 3);
		let e = readNumber(hash, 4);
		let f = readNumber(hash, 5);
		let g = readNumber(hash, 6);
		let h = readNumber(hash, 7);
		for (let i = 0; i < 64; i += 1) {
			const bigSigma1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
			const choose = (e & f) ^ (~e & g);
			const temp1 = (h + bigSigma1 + choose + readNumber(constants, i) + readNumber(words, i)) >>> 0;
			const bigSigma0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (bigSigma0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + temp1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) >>> 0;
		}
		hash[0] = (readNumber(hash, 0) + a) >>> 0;
		hash[1] = (readNumber(hash, 1) + b) >>> 0;
		hash[2] = (readNumber(hash, 2) + c) >>> 0;
		hash[3] = (readNumber(hash, 3) + d) >>> 0;
		hash[4] = (readNumber(hash, 4) + e) >>> 0;
		hash[5] = (readNumber(hash, 5) + f) >>> 0;
		hash[6] = (readNumber(hash, 6) + g) >>> 0;
		hash[7] = (readNumber(hash, 7) + h) >>> 0;
	}
	return [...hash].map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function analysisAdapterSnapshotSha256(
	adapter: Pick<AnalysisAdapter, "identity" | "contract">,
): string {
	return sha256Hex(stableContractJson({ identity: adapter.identity, contract: adapter.contract }));
}

export function createAnalysisContext(input: {
	id: string;
	question: string;
	assay: string;
	mode: AnalysisMode;
	adapter: AnalysisIdentity;
}): AnalysisContext {
	const clean = (value: string, label: string, max: number) => {
		const text = value.normalize("NFKC").replace(/\s+/g, " ").trim();
		if (!text || text.length > max) throw new Error(`${label} must be a non-empty bounded string`);
		return text;
	};
	const id = clean(input.id, "Analysis id", 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new Error("Analysis id contains unsafe characters");
	return {
		version: ANALYSIS_CONTRACT_VERSION,
		id,
		question: clean(input.question, "Analysis question", 512),
		assay: clean(input.assay, "Assay", 128),
		mode: input.mode,
		adapter: input.adapter,
	};
}
