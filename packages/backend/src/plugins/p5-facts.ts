import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { contractContentHash } from "@drone/shared";
import { CollectInput, Fact, FactsResult, resultEnvelope } from "@gyoungwe/plugin-api/p5-inquiry";
import { type Code, Hash, type Result, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import type { StorageEntry, StorageRegistry } from "../storage/registry";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

type FactScope = Pick<Scope, "workspaceId" | "sessionId">;
type FactInput = Omit<Fact, "sequence">;
interface Entry extends FactScope {
	readonly sha256: string;
	readonly fact: Fact;
}
export const P5_FACT_STORAGE = {
	id: "agent-p5-facts",
	owner: "plugins/p5-facts",
	schema: 1,
	sensitivity: "private",
} as const satisfies Omit<StorageEntry, "path">;
const ledgerSchema = Type.Array(
	Type.Object(
		{
			workspaceId: Scope.properties.workspaceId,
			sessionId: Scope.properties.sessionId,
			sha256: Hash,
			fact: Fact,
		},
		{ additionalProperties: false },
	),
);

export class P5FactStoreError extends Error {
	constructor(
		readonly code: Extract<
			Code,
			"INVALID_INPUT" | "DUPLICATE_CONFLICT" | "STATE_CONFLICT" | "READBACK_FAILED"
		>,
	) {
		super(`P5 fact journal: ${code}`);
		this.name = "P5FactStoreError";
	}
}
function factHash(fact: Omit<Fact, "sequence" | "summary">): string {
	const identity = [fact.id, fact.kind, fact.entityId, fact.runReceiptRef, fact.basis];
	const observation = [fact.at, fact.status, fact.artifactRefs, fact.decisionKind];
	return contractContentHash([identity, observation]);
}
/** Host producers use this template; no supplied prose is journaled. */
export function p5FactSummary(fact: Omit<Fact, "sequence" | "summary">): string {
	return `${fact.kind} ${fact.id} sha256:${factHash(fact)}`;
}
function parseLedger(text: string, path: string): Entry[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		// JSON parse errors can contain source text; discard it at the disk boundary, as R1 does.
		throw new JsonStoreCorruptedError(path);
	}
	if (!Check(ledgerSchema, value)) throw new JsonStoreCorruptedError(path);
	const entries = value as Entry[];
	const sequences = new Map<string, number>();
	const ids = new Set<string>();
	for (const entry of entries) {
		const sequence = (sequences.get(entry.workspaceId) ?? 0) + 1;
		if (
			entry.fact.sequence !== sequence ||
			ids.has(entry.fact.id) ||
			entry.sha256 !== factHash(entry.fact) ||
			entry.fact.summary !== p5FactSummary(entry.fact)
		)
			throw new JsonStoreCorruptedError(path);
		sequences.set(entry.workspaceId, sequence);
		ids.add(entry.fact.id);
	}
	return entries;
}
async function snapshot(path: string) {
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], version: null };
		throw error;
	}
	return {
		entries: parseLedger(bytes.toString("utf8"), path),
		version: createHash("sha256").update(bytes).digest("hex"),
	};
}
type Storage = { readonly path: string; readonly json: JsonStore<Entry[]> };
const inScope = (entry: Entry, scope: FactScope) =>
	entry.workspaceId === scope.workspaceId && entry.sessionId === scope.sessionId;

async function append(storage: Storage, scope: FactScope, input: FactInput): Promise<Fact> {
	const candidate = structuredClone({ ...input, sequence: 1 });
	if (!Check(Fact, candidate) || candidate.summary !== p5FactSummary(candidate))
		throw new P5FactStoreError("INVALID_INPUT");
	const before = await snapshot(storage.path);
	const sha256 = factHash(candidate);
	const existing = before.entries.find((entry) => entry.fact.id === candidate.id);
	if (existing) {
		if (!inScope(existing, scope) || existing.sha256 !== sha256)
			throw new P5FactStoreError("DUPLICATE_CONFLICT");
		return existing.fact;
	}
	const sequence = before.entries.filter((entry) => entry.workspaceId === scope.workspaceId).length + 1;
	const fact = { ...candidate, sequence };
	const { workspaceId, sessionId } = scope;
	const next = [...before.entries, { workspaceId, sessionId, sha256, fact }];
	// R1's strict snapshot/CAS/readback pattern avoids JsonStore.read's corruption fallback.
	return storage.json.writeChecked(next, {
		check: async () => {
			if ((await snapshot(storage.path)).version !== before.version)
				throw new P5FactStoreError("STATE_CONFLICT");
		},
		readBack: async () => {
			if (!isDeepStrictEqual((await snapshot(storage.path)).entries, next))
				throw new P5FactStoreError("READBACK_FAILED");
			return fact;
		},
	});
}
async function read(path: string, scope: FactScope, input: CollectInput): Promise<FactsResult> {
	const entries = (await snapshot(path)).entries.filter((entry) => inScope(entry, scope));
	const cursor = entries.find((entry) => entry.fact.id === input.after);
	if (input.after !== null && !cursor) throw new P5FactStoreError("INVALID_INPUT");
	const facts = entries
		.filter((entry) => entry.fact.sequence > (cursor?.fact.sequence ?? 0))
		.slice(0, input.limit)
		.map((entry) => entry.fact);
	return { cursor: facts.at(-1)?.id ?? input.after, facts };
}
/** Host-only append port; composition supplies scope and verified metadata, never producer JSON. */
export function createP5FactStore(options: { readonly path: string; readonly registry: StorageRegistry }) {
	const entry = { ...P5_FACT_STORAGE, path: options.path };
	if (!options.registry.get(entry.id)) options.registry.register(entry);
	if (!isDeepStrictEqual(options.registry.assertRegistered(entry.id), entry))
		throw new Error("P5 fact storage registration does not match the journal");
	const json = new JsonStore<Entry[]>({
		path: entry.path,
		storageId: "agent-p5-facts",
		defaultValue: () => [],
		parse: (text) => parseLedger(text, entry.path),
		mode: 0o600,
	});
	if (json.storageId !== entry.id) throw new Error("P5 fact JsonStore has a different storage ID");
	return {
		append: (scope: FactScope, input: FactInput) => append({ path: entry.path, json }, scope, input),
		read: (scope: FactScope, input: CollectInput) => read(entry.path, scope, input),
	};
}

/** No approval or registration here; the caller identity is resolved by host composition. */
export function p5FactCapabilityHandlers(
	store: Pick<ReturnType<typeof createP5FactStore>, "read">,
	scopeOf: (context: PluginCapabilityContext) => FactScope | undefined,
): Record<"facts.read", PluginCapabilityHandler> {
	return {
		"facts.read": {
			effect: "read",
			inputSchema: CollectInput,
			resultSchema: resultEnvelope(FactsResult),
			execute: async (input, context): Promise<Result<FactsResult>> => {
				const scope = scopeOf(context);
				if (!scope) return { status: "failed", code: "DENIED", receiptRef: null };
				try {
					return { status: "ok", value: await store.read(scope, input as CollectInput) };
				} catch (error) {
					if (!(error instanceof P5FactStoreError)) throw error;
					return { status: "failed", code: error.code, receiptRef: null };
				}
			},
		},
	};
}
