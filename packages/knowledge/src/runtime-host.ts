/** Host seams used by knowledge runtime modules.
 *
 * The domain package owns the stateful implementation; desktop/CLI hosts inject
 * process event and runtime scheduling adapters at composition time. Defaults
 * are deterministic and safe for read-only package use and tests.
 */
export type RuntimeExclusive = <T>(namespace: string, key: string, work: () => Promise<T>) => Promise<T>;
export type ProcessEventEmitter = (event: unknown) => void;
export type ToolMetadataLookup = (toolName: string) => unknown;
export type FlowCardBuilder = (toolName: string) => unknown;
export type DeliveryContract = (prompt: string, options?: Record<string, unknown>) => unknown;

const locks = new Map<string, Promise<void>>();
const defaultRunRuntimeExclusive: RuntimeExclusive = async <T>(_namespace: string, key: string, work: () => Promise<T>) => {
	const previous = locks.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	locks.set(key, previous.then(() => current));
	await previous;
	try {
		return await work();
	} finally {
		release();
		if (locks.get(key) === current) locks.delete(key);
	}
};

let runtimeExclusive: RuntimeExclusive = defaultRunRuntimeExclusive;
let processEvent: ProcessEventEmitter = () => undefined;
let metadataLookup: ToolMetadataLookup = () => null;
let cardBuilderLookup: FlowCardBuilder = () => null;
let deliveryLookup: DeliveryContract = () => null;

export function configureKnowledgeRuntime(host: {
	runRuntimeExclusive?: RuntimeExclusive;
	emitProcessEvent?: ProcessEventEmitter;
	toolMeta?: ToolMetadataLookup;
	flowCardBuilder?: FlowCardBuilder;
	deliveryContract?: DeliveryContract;
} = {}): void {
	// Multiple compatibility adapters can load in one process. Merge seams
	// instead of resetting a previously installed host registry when another
	// adapter (for example the service worker) initializes later.
	if (host.runRuntimeExclusive) runtimeExclusive = host.runRuntimeExclusive;
	if (host.emitProcessEvent) processEvent = host.emitProcessEvent;
	if (host.toolMeta) metadataLookup = host.toolMeta;
	if (host.flowCardBuilder) cardBuilderLookup = host.flowCardBuilder;
	if (host.deliveryContract) deliveryLookup = host.deliveryContract;
}

export const runRuntimeExclusive: RuntimeExclusive = (namespace, key, work) =>
	runtimeExclusive(namespace, key, work);
export const emitProcessEvent: ProcessEventEmitter = (event) => processEvent(event);

const slots = new Map<string, unknown>();
export function runtimeSlot<T>(domain: string, key: string, factory: () => T): T {
	const slotKey = `${domain}:${key}`;
	if (!slots.has(slotKey)) slots.set(slotKey, factory());
	return slots.get(slotKey) as T;
}
export function diagnosticText(value: unknown, limit = 4096): string {
	if (typeof value !== "string" && typeof value !== "number") return "";
	return String(value)
		.slice(0, 8192)
		.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
			try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
			catch { return "[URL omitted]"; }
		})
		.replace(/(?:bearer\s+)[^\s,;"']+/gi, "Bearer [redacted]")
		.replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;]+)/gi, "$1[redacted]")
		.replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, "[redacted]")
		.replace(/[\u0000-\u001f\u007f<>]/g, " ")
		.slice(0, Math.max(0, limit));
}
export function toolMeta(_toolName: string): unknown {
	return metadataLookup(_toolName);
}
export function flowCardBuilder(_toolName: string): unknown {
	return cardBuilderLookup(_toolName);
}

export type KnowledgeWorkerFactory = (url: URL, options: Record<string, unknown>) => unknown;
let workerFactory: KnowledgeWorkerFactory = (url, options) => {
	throw new Error(`Knowledge worker host is not configured for ${url.href}`);
};
export function configureKnowledgeWorker(factory: KnowledgeWorkerFactory): void {
	workerFactory = factory;
}
export function createKnowledgeWorker(url: URL, options: Record<string, unknown>): unknown {
	return workerFactory(url, options);
}
export function configureKnowledgeEvidence(host: {
	requiresPaperEvidence?: (query: string) => boolean;
	hasPaperCitation?: (sources: unknown[]) => boolean;
}): void {
	if (host.requiresPaperEvidence) requiresPaperEvidence = host.requiresPaperEvidence;
	if (host.hasPaperCitation) hasPaperCitation = host.hasPaperCitation;
}
let requiresPaperEvidence = (query: string) => /paper|literature|article|文献|论文/i.test(query);
let hasPaperCitation = (sources: unknown[]) =>
	Array.isArray(sources) && sources.some((source) => /(?:^|\/)Library\/Papers\//.test(String((source as { path?: unknown })?.path ?? "")));
export { requiresPaperEvidence, hasPaperCitation };

export const deliveryContract: DeliveryContract = (prompt, options) => deliveryLookup(prompt, options);

export type WorkspaceConfigLoader = (cwd: string) => Promise<Record<string, unknown>>;
export type ExplainerPublisher = (input: Record<string, unknown>) => Promise<unknown>;
let workspaceConfigLoader: WorkspaceConfigLoader = async () => { throw new Error("Workspace config host is not configured"); };
let explainerPublisher: ExplainerPublisher = async () => { throw new Error("Explainer publisher host is not configured"); };
let reviewPreviewConsumer: (cwd: string, token: string) => unknown = () => null;
let specialistSettingsReader: () => Promise<Record<string, unknown>> = async () => ({ mode: "strict" });
export function configureKnowledgeHost(host: {
	loadWorkspaceConfig?: WorkspaceConfigLoader;
	publishExplainer?: ExplainerPublisher;
	consumeKnowledgeReviewPreview?: (cwd: string, token: string) => unknown;
	specialistSettings?: () => Promise<Record<string, unknown>>;
} = {}): void {
	if (host.loadWorkspaceConfig) workspaceConfigLoader = host.loadWorkspaceConfig;
	if (host.publishExplainer) explainerPublisher = host.publishExplainer;
	if (host.consumeKnowledgeReviewPreview) reviewPreviewConsumer = host.consumeKnowledgeReviewPreview;
	if (host.specialistSettings) specialistSettingsReader = host.specialistSettings;
}
export const loadWorkspaceConfig: WorkspaceConfigLoader = (cwd) => workspaceConfigLoader(cwd);
export const publishExplainer: ExplainerPublisher = (input) => explainerPublisher(input);
export const consumeKnowledgeReviewPreview = (cwd: string, token: string) => reviewPreviewConsumer(cwd, token);
export const specialistSettings = () => specialistSettingsReader();
