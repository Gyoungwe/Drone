import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { SessionTraces } from "../src/session/traces";
import { runSubagent } from "../src/tools/subagent/runner";
import { packedKnowledgeAvailable, withPackedKnowledgeOwner } from "./fixtures/packed-knowledge-owner.mjs";

// A subagent child loads only packages that declared read-only child support, through the same
// installed source and broker as the primary session. Its facts carry no grant: the knowledge
// package decides Vault reads from its own binding, and every write effect is refused.

const reader = {
	name: "vault-reader",
	description: "Reads the knowledge Vault for the parent",
	tools: ["read", "knowledge_status", "knowledge_search"],
	systemPrompt: "Search the knowledge Vault and report what you found.",
	source: "user",
};

async function child(f, { projectTrusted, script, agent = reader }) {
	f.faux.setResponses(script);
	const registered = [];
	const deps = {
		getModelRuntime: async () => f.modelRuntime,
		getSubagentModel: async () => undefined,
		gate: { confirm: async () => false },
		traces: new SessionTraces(),
		nativeChildren: () => ({
			integration: f.backend.options.desktopIntegration.nativeRuntime,
			register: (entry) => {
				registered.push({
					id: entry.session.sessionId,
					readOnly: entry.readOnly,
					kind: entry.nativeKind,
					files: entry.nativeChildFiles,
					listed: f.backend.registry.has(entry.session.sessionId),
				});
				const unregister = f.backend.registerChildSession(entry);
				registered.at(-1).resolvable = f.sessions.get(entry.session.sessionId) === entry;
				return unregister;
			},
		}),
	};
	const result = await runSubagent(deps, {
		agent,
		task: "Find what the Vault says about Orchid.",
		cwd: f.workspace,
		projectTrusted,
		model: f.faux.getModel(),
	});
	return { result, registered };
}

it.skipIf(!packedKnowledgeAvailable)(
	"serves a read-local subagent child the installed knowledge read interface with read-only facts",
	async () => {
		await withPackedKnowledgeOwner(async (f) => {
			expect(f.source.nativeChildSessions).toBe("read-only");
			const before = f.calls.length;
			const { result, registered } = await child(f, {
				projectTrusted: true,
				script: [
					fauxAssistantMessage(fauxToolCall("knowledge_search", { query: "Orchid" })),
					fauxAssistantMessage("Orchid appears under condition A in the Vault."),
				],
			});
			expect(result.exitCode, result.error).toBe(0);
			expect(registered).toEqual([
				{
					id: result.sessionId,
					readOnly: true,
					kind: "child",
					files: "read",
					listed: false,
					resolvable: true,
				},
			]);
			// The child's actual knowledge reads went through the broker under its own session scope.
			const childCalls = f.calls.slice(before).filter((call) => call.session === result.sessionId);
			expect(childCalls.length).toBeGreaterThan(0);
			// Only read capabilities: binding/roots/Vault reads and the plugin's own search index resource.
			const reads = new Set([
				"state.readJson",
				"session.inspect",
				"roots.resolve",
				"files.list",
				"files.stat",
				"files.readText",
				"resource.create",
				"resource.invoke",
			]);
			for (const call of childCalls) expect(reads, call.name).toContain(call.name);
			// The package labels the child's answer as unverified material, not a checked parent answer.
			expect(result.content).toContain("尚未核实的补充材料");
			expect(result.content).toContain("Orchid appears under condition A");
			// Finished children are revoked and never appear among the primary sessions.
			expect(f.sessions.get(result.sessionId)).toBeUndefined();
			expect(f.backend.registry.list().map((entry) => entry.session.sessionId)).not.toContain(
				result.sessionId,
			);
			expect(f.errors).toEqual([]);
		});
	},
	240000,
);

it.skipIf(!packedKnowledgeAvailable)(
	"gives a child whose definition has no file access no Vault tool but still labels its answer",
	async () => {
		await withPackedKnowledgeOwner(async (f) => {
			const before = f.calls.length;
			const { result, registered } = await child(f, {
				projectTrusted: true,
				agent: { ...reader, mcpAccess: "none" },
				script: [
					fauxAssistantMessage(fauxToolCall("knowledge_search", { query: "Orchid" })),
					fauxAssistantMessage("No Vault access."),
				],
			});
			expect(result.exitCode, result.error).toBe(0);
			expect(registered).toEqual([
				{
					id: result.sessionId,
					readOnly: true,
					kind: "child",
					files: "none",
					listed: false,
					resolvable: true,
				},
			]);
			// knowledge_search is not registered for this child, and the binding is never read for it.
			expect(result.content).toContain("尚未核实的补充材料");
			expect(result.content).toContain("No Vault access.");
			const childCalls = f.calls.slice(before).filter((call) => call.session === result.sessionId);
			expect(childCalls.map((call) => call.name)).not.toContain("files.readText");
			expect(childCalls.map((call) => call.name)).not.toContain("state.readJson");
			expect(f.sessions.get(result.sessionId)).toBeUndefined();
		});
	},
	240000,
);

it.skipIf(!packedKnowledgeAvailable)(
	"loads no plugin into a child of an untrusted project, where plugins never run",
	async () => {
		await withPackedKnowledgeOwner(async (f) => {
			const { result, registered } = await child(f, {
				projectTrusted: false,
				script: [fauxAssistantMessage("Plain answer.")],
			});
			expect(result.exitCode, result.error).toBe(0);
			expect(registered).toEqual([]);
			expect(result.content).toBe("Plain answer.");
		});
	},
	240000,
);
