import type {
	ResearchConnector,
	ResearchConnectorContext,
	ResearchConnectorHit,
	ResearchConnectorSourceReceipt,
	ResearchSearchRequest,
	ResearchSearchResponse,
	ResearchWriteAdapterDescriptor,
	ResearchWriteAdapterPort,
	ResearchWriteAdapterRegistryPort,
	ResearchWritePayload,
	ResearchWritePlan,
	ResearchWriteReceipt,
	ResearchWriteRequest,
} from "@drone/shared";
import type {
	ResearchConnectorHit as HostConnectorHit,
	ResearchConnectorSourceReceipt as HostConnectorSourceReceipt,
	ResearchSearchRequest as HostSearchRequest,
	ResearchSearchResponse as HostSearchResponse,
	ResearchWriteAdapterDescriptor as HostWriteAdapterDescriptor,
	ResearchWriteExecuteRequest as HostWriteExecuteRequest,
	ResearchWritePayload as HostWritePayload,
	ResearchWritePlan as HostWritePlan,
	ResearchWriteReceipt as HostWriteReceipt,
	ResearchWriteRequest as HostWriteRequest,
	ResearchConnectorHostAdapter,
	ResearchConnectorHostContext,
	ResearchConnectorHostLoader,
	ResearchWriteAdapterHostAdapter,
	ResearchWriteAdapterHostLoader,
} from "@gyoungwe/plugin-api/research";
import type { ResearchConnectorRegistryPort } from "./research-resource";

const RESEARCH_HOST_CONTRACT_VERSION = 1;

function assertContractVersion(version: number, role: string): void {
	if (version !== RESEARCH_HOST_CONTRACT_VERSION) {
		throw new Error(
			`Unsupported ${role} contract version ${version}; expected ${RESEARCH_HOST_CONTRACT_VERSION}`,
		);
	}
}

function loadConnectorHost(loader: ResearchConnectorHostLoader): ResearchConnectorHostAdapter {
	assertContractVersion(loader.contractVersion, "research connector loader");
	const host = loader.load();
	assertContractVersion(host.contractVersion, "research connector host");
	return host;
}

function loadWriteHost(loader: ResearchWriteAdapterHostLoader): ResearchWriteAdapterHostAdapter {
	assertContractVersion(loader.contractVersion, "research write loader");
	const host = loader.load();
	assertContractVersion(host.contractVersion, "research write host");
	return host;
}

function requireAvailable(status: "ready" | "degraded" | "unavailable", role: string): void {
	if (status === "unavailable") throw new Error(`${role} host is unavailable`);
}

function toHostContext(context?: ResearchConnectorContext): ResearchConnectorHostContext | undefined {
	if (!context) return undefined;
	return {
		...(context.cwd ? { cwd: context.cwd } : {}),
		...(context.signal ? { signal: context.signal } : {}),
		...(context.config ? { config: { ...context.config } } : {}),
	};
}

function toHostSearchRequest(input: ResearchSearchRequest): HostSearchRequest {
	return {
		query: input.query,
		...(input.cwd ? { cwd: input.cwd } : {}),
		...(input.connectorIds ? { connectorIds: [...input.connectorIds] } : {}),
		...(input.limit !== undefined ? { limit: input.limit } : {}),
		...(input.signal ? { signal: input.signal } : {}),
	};
}

function mapSourceReceipt(receipt: HostConnectorSourceReceipt): ResearchConnectorSourceReceipt {
	return {
		sourceRef: receipt.sourceRef,
		...(receipt.locator ? { locator: receipt.locator } : {}),
		sourceType: receipt.sourceType,
		...(receipt.title ? { title: receipt.title } : {}),
		...(receipt.version ? { version: receipt.version } : {}),
		...(receipt.license ? { license: receipt.license } : {}),
		accessedAt: receipt.accessedAt,
		contentHash: receipt.contentHash,
		readOnly: true,
		...(receipt.failureReason ? { failureReason: receipt.failureReason } : {}),
	};
}

function mapHit(hit: HostConnectorHit): ResearchConnectorHit {
	return {
		id: hit.id,
		title: hit.title,
		summary: hit.summary,
		locator: hit.locator,
		sourceType: hit.sourceType,
		sourceReceipt: mapSourceReceipt(hit.sourceReceipt),
		...(hit.authors ? { authors: [...hit.authors] } : {}),
		...(hit.year !== undefined ? { year: hit.year } : {}),
		...(hit.doi ? { doi: hit.doi } : {}),
		...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
		...(hit.arxivId ? { arxivId: hit.arxivId } : {}),
	};
}

function mapSearchResponse(response: HostSearchResponse): ResearchSearchResponse {
	return {
		query: response.query,
		hits: response.hits.map(mapHit),
		failures: response.failures.map((failure) => ({ ...failure })),
		connectors: [...response.connectors],
		complete: response.complete,
	};
}

function createConnector(
	host: ResearchConnectorHostAdapter,
	descriptor: ReturnType<ResearchConnectorHostAdapter["list"]>[number],
): ResearchConnector {
	return {
		id: descriptor.id,
		kind: descriptor.kind,
		label: descriptor.label,
		enabled: descriptor.enabled,
		search: async (query, options) => {
			const response = await host.search(
				{
					query,
					connectorIds: [descriptor.id],
					...(options?.limit !== undefined ? { limit: options.limit } : {}),
					...(options?.signal ? { signal: options.signal } : {}),
				},
				toHostContext(options),
			);
			return response.hits.map(mapHit);
		},
		recommend: async (seed, options) => {
			const response = await host.recommend(seed, descriptor.id, {
				...toHostContext(options),
				...(options?.limit !== undefined ? { limit: options.limit } : {}),
			});
			return response.hits.map(mapHit);
		},
	};
}

/** Adapt an installed plugin's connector host contract to the backend registry port. */
export function createResearchConnectorRegistryFromHost(
	loader: ResearchConnectorHostLoader,
): ResearchConnectorRegistryPort {
	const host = loadConnectorHost(loader);
	return {
		list: () => {
			requireAvailable(host.status, "Research connector");
			return host.list().map((descriptor) => createConnector(host, descriptor));
		},
		recommend: async (seed, connectorId, context, limit) => {
			requireAvailable(host.status, "Research connector");
			const response = await host.recommend(seed, connectorId, {
				...toHostContext(context),
				...(limit !== undefined ? { limit } : {}),
			});
			return {
				hits: response.hits.map(mapHit),
				failures: response.failures.map((failure) => ({ ...failure })),
			};
		},
		search: async (input, context) => {
			requireAvailable(host.status, "Research connector");
			return mapSearchResponse(await host.search(toHostSearchRequest(input), toHostContext(context)));
		},
	};
}

function mapWritePayload(payload: HostWritePayload): ResearchWritePayload {
	return {
		title: payload.title,
		...(payload.doi ? { doi: payload.doi } : {}),
		...(payload.authors ? { authors: [...payload.authors] } : {}),
		...(payload.abstract ? { abstract: payload.abstract } : {}),
	};
}

function mapWritePlan(plan: HostWritePlan): ResearchWritePlan {
	return {
		id: plan.id,
		adapterId: plan.adapterId,
		targetRef: plan.targetRef,
		payload: mapWritePayload(plan.payload),
		action: plan.action,
		sideEffect: plan.sideEffect,
		requiresExplicitApproval: true,
		status: plan.status,
		createdAt: plan.createdAt,
	};
}

function mapWriteReceipt(receipt: HostWriteReceipt): ResearchWriteReceipt {
	return {
		planId: receipt.planId,
		adapterId: receipt.adapterId,
		status: receipt.status,
		at: receipt.at,
		readBack: receipt.readBack,
		...(receipt.externalRef ? { externalRef: receipt.externalRef } : {}),
		...(receipt.failureReason ? { failureReason: receipt.failureReason } : {}),
	};
}

function toHostWriteRequest(input: ResearchWriteRequest): HostWriteRequest {
	return {
		adapterId: input.adapterId,
		targetRef: input.targetRef,
		payload: mapWritePayload(input.payload),
		action: input.action,
	};
}

function toHostWritePlan(plan: ResearchWritePlan): HostWritePlan {
	return {
		id: plan.id,
		adapterId: plan.adapterId,
		targetRef: plan.targetRef,
		payload: mapWritePayload(plan.payload),
		action: plan.action,
		sideEffect: plan.sideEffect,
		requiresExplicitApproval: true,
		status: plan.status,
		createdAt: plan.createdAt,
	};
}

function toHostWriteExecuteRequest(input: {
	readonly plan: ResearchWritePlan;
	readonly approved: boolean;
	readonly signal?: AbortSignal;
}): HostWriteExecuteRequest {
	return {
		plan: toHostWritePlan(input.plan),
		approved: input.approved,
		...(input.signal ? { signal: input.signal } : {}),
	};
}

function mapWriteDescriptor(descriptor: HostWriteAdapterDescriptor): ResearchWriteAdapterDescriptor {
	return {
		id: descriptor.id,
		label: descriptor.label,
		enabled: descriptor.enabled,
		writeEnabled: descriptor.writeEnabled,
		requiresExplicitApproval: true,
	};
}

/** Adapt an installed plugin's write host contract to the backend registry port. */
export function createResearchWriteAdapterRegistryFromHost(
	loader: ResearchWriteAdapterHostLoader,
): ResearchWriteAdapterRegistryPort {
	const host = loadWriteHost(loader);
	return {
		descriptors: () => {
			requireAvailable(host.status, "Research write");
			return host.descriptors().map(mapWriteDescriptor);
		},
		get: (id) => {
			requireAvailable(host.status, "Research write");
			const descriptor = host.descriptors().find((item) => item.id === id);
			if (!descriptor?.enabled) return undefined;
			return {
				id: descriptor.id,
				label: descriptor.label,
				writeEnabled: descriptor.writeEnabled,
				prepare: (input) => mapWritePlan(host.prepare(toHostWriteRequest(input))),
				execute: async (plan, context) =>
					mapWriteReceipt(
						await host.execute(
							toHostWriteExecuteRequest({
								plan,
								approved: context.approved,
								...(context.signal ? { signal: context.signal } : {}),
							}),
						),
					),
			} satisfies ResearchWriteAdapterPort;
		},
	};
}
