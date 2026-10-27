import { describe, expect, it } from "vitest";
import { createBackend } from "../src/create-backend";
import {
	createResearchConnectorRegistryFromHost,
	createResearchWriteAdapterRegistryFromHost,
} from "../src/services/research-host-adapters";

const sourceReceipt = {
	sourceRef: "doi:10.1234/example",
	locator: "https://example.test/paper",
	sourceType: "literature" as const,
	accessedAt: "2026-10-27T00:00:00.000Z",
	contentHash: "hash",
	readOnly: true as const,
};

const hit = {
	id: "paper-1",
	title: "Example paper",
	summary: "A summary",
	locator: "https://example.test/paper",
	sourceType: "literature" as const,
	sourceReceipt,
	authors: ["A. Author"],
	year: 2026,
	doi: "10.1234/example",
};

describe("research plugin host adapters", () => {
	it("maps connector host search, recommendation, and connector descriptors", async () => {
		const calls: Array<{ query: string; connectorIds?: readonly string[] }> = [];
		const registry = createResearchConnectorRegistryFromHost({
			contractVersion: 1,
			load: () => ({
				contractVersion: 1,
				status: "ready",
				list: () => [
					{ id: "semantic-scholar", kind: "literature", label: "Semantic Scholar", enabled: true },
				],
				recommend: async () => ({ hits: [hit], failures: [] }),
				search: async (input) => {
					calls.push(input);
					return {
						query: input.query,
						hits: [hit],
						failures: [],
						connectors: ["semantic-scholar"],
						complete: true,
					};
				},
			}),
		});

		const connectors = registry.list();
		expect(connectors.map(({ id, kind, label }) => ({ id, kind, label }))).toEqual([
			{ id: "semantic-scholar", kind: "literature", label: "Semantic Scholar" },
		]);
		expect(await registry.search({ query: "kinase", connectorIds: ["semantic-scholar"] })).toEqual({
			query: "kinase",
			hits: [hit],
			failures: [],
			connectors: ["semantic-scholar"],
			complete: true,
		});
		expect(await connectors[0]?.search("kinase", { limit: 3 })).toEqual([hit]);
		expect(await registry.recommend("paper-0", "semantic-scholar")).toEqual({ hits: [hit], failures: [] });
		expect(calls).toEqual([
			{ query: "kinase", connectorIds: ["semantic-scholar"] },
			{ query: "kinase", connectorIds: ["semantic-scholar"], limit: 3 },
		]);
	});

	it("fails loudly when an installed connector host reports unavailable", () => {
		const registry = createResearchConnectorRegistryFromHost({
			contractVersion: 1,
			load: () => ({
				contractVersion: 1,
				status: "unavailable",
				list: () => [],
				recommend: async () => ({ hits: [], failures: [] }),
				search: async () => ({ query: "", hits: [], failures: [], connectors: [], complete: false }),
			}),
		});
		expect(() => registry.list()).toThrow("Research connector host is unavailable");
	});

	it("maps write host plans and receipts while preserving explicit approval", async () => {
		const plan = {
			id: "plan-1",
			adapterId: "zotero",
			targetRef: "zotero://library",
			payload: { title: "Example paper", authors: ["A. Author"] },
			action: "prepare" as const,
			sideEffect: "external-write" as const,
			requiresExplicitApproval: true as const,
			status: "ready" as const,
			createdAt: "2026-10-27T00:00:00.000Z",
		};
		let executed = false;
		const registry = createResearchWriteAdapterRegistryFromHost({
			contractVersion: 1,
			load: () => ({
				contractVersion: 1,
				status: "ready",
				descriptors: () => [
					{
						id: "zotero",
						label: "Zotero",
						enabled: true,
						writeEnabled: true,
						requiresExplicitApproval: true,
					},
				],
				prepare: () => plan,
				execute: async (input) => {
					executed = input.approved;
					return {
						planId: input.plan.id,
						adapterId: input.plan.adapterId,
						status: "executed",
						at: "2026-10-27T00:00:01.000Z",
						readBack: "verified",
						externalRef: "zotero:item-1",
					};
				},
			}),
		});

		expect(registry.descriptors()).toEqual([
			{ id: "zotero", label: "Zotero", enabled: true, writeEnabled: true, requiresExplicitApproval: true },
		]);
		const adapter = registry.get("zotero");
		expect(adapter).toBeDefined();
		expect(
			adapter?.prepare({
				adapterId: "zotero",
				targetRef: "zotero://library",
				payload: { title: "Example paper" },
				action: "prepare",
			}),
		).toEqual(plan);
		expect(await adapter?.execute(plan, { approved: true })).toMatchObject({
			planId: "plan-1",
			readBack: "verified",
		});
		expect(executed).toBe(true);
	});

	it("injects connector and write loaders through BackendOptions", async () => {
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			researchConnectorHostLoader: {
				contractVersion: 1,
				load: () => ({
					contractVersion: 1,
					status: "ready",
					list: () => [{ id: "plugin-connector", kind: "literature", label: "Plugin", enabled: true }],
					recommend: async () => ({ hits: [], failures: [] }),
					search: async (input) => ({
						query: input.query,
						hits: [],
						failures: [],
						connectors: ["plugin-connector"],
						complete: true,
					}),
				}),
			},
			researchWriteAdapterHostLoader: {
				contractVersion: 1,
				load: () => ({
					contractVersion: 1,
					status: "ready",
					descriptors: () => [
						{
							id: "plugin-writer",
							label: "Plugin writer",
							enabled: true,
							writeEnabled: false,
							requiresExplicitApproval: true,
						},
					],
					prepare: () => planForTest(),
					execute: async () => ({
						planId: "plugin-plan",
						adapterId: "plugin-writer",
						status: "blocked",
						at: "2026-10-27T00:00:00.000Z",
						readBack: "not-applicable",
					}),
				}),
			},
		});
		expect((await services.research.listConnectors()).map(({ id }) => id)).toEqual(["plugin-connector"]);
		expect(services.researchWrites.listAdapters().map(({ id }) => id)).toEqual(["plugin-writer"]);
		await services.dispose();
	});

	it("keeps explicit registries ahead of plugin host loaders", async () => {
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			researchConnectorRegistry: () => ({
				list: () => [
					{
						id: "explicit-connector",
						kind: "literature",
						label: "Explicit",
						search: async () => [],
					},
				],
				recommend: async () => ({ hits: [], failures: [] }),
				search: async (input) => ({
					query: input.query,
					hits: [],
					failures: [],
					connectors: [],
					complete: true,
				}),
			}),
			researchConnectorHostLoader: {
				contractVersion: 1,
				load: () => {
					throw new Error("loader must not be called when registry is supplied");
				},
			},
		});
		expect((await services.research.listConnectors()).map(({ id }) => id)).toEqual(["explicit-connector"]);
		await services.dispose();
	});
});

function planForTest() {
	return {
		id: "plugin-plan",
		adapterId: "plugin-writer",
		targetRef: "test://target",
		payload: { title: "Plugin plan" },
		action: "dry-run" as const,
		sideEffect: "none" as const,
		requiresExplicitApproval: true as const,
		status: "ready" as const,
		createdAt: "2026-10-27T00:00:00.000Z",
	};
}
