import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { win32 } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ComputeRerunInput } from "@gyoungwe/plugin-api/p5-inquiry";
import { FileReadback, Hash, Id, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import type { P5ReceiptStore } from "../plugins/p5-receipt-store";
import type { P5RerunSource } from "../plugins/p5-rerun-submit";
import type { StorageEntry, StorageRegistry } from "../storage/registry";

export interface P5ComputeSourceBinding {
	readonly scope: Scope;
	readonly sourceRunReceiptRef: string;
	readonly runId: string;
	readonly jobId: string;
	readonly profile: string;
	readonly artifact: FileReadback & { readonly id: string };
	readonly collectionRoot: string;
	readonly planSha256: string;
}
interface SourcePorts {
	readonly getByRef: P5ReceiptStore["getByRef"];
	/** Verify current job/profile/scope and unchanged authorized root identity; missing/revoked roots
	 * or artifacts return undefined. Read a stable confined byte snapshot, never receipt metadata. */
	readback(
		binding: P5ComputeSourceBinding,
	): Promise<{ readonly collectionRoot: string; readonly bytes: Uint8Array } | undefined>;
}
type Storage = { readonly path: string; readonly json: JsonStore<P5ComputeSourceBinding[]> };
const bindingSchema = Type.Object(
	{
		scope: Scope,
		sourceRunReceiptRef: Id,
		runId: Id,
		jobId: Id,
		profile: Id,
		artifact: Type.Object({ ...FileReadback.properties, id: Id }, { additionalProperties: false }),
		collectionRoot: Type.String({ minLength: 1 }),
		planSha256: Hash,
	},
	{ additionalProperties: false },
);
function sourceKey(binding: P5ComputeSourceBinding): string {
	const { workspaceId, sessionId, callerSourceHash, providerSourceHash } = binding.scope;
	return JSON.stringify([
		workspaceId,
		sessionId,
		callerSourceHash,
		providerSourceHash,
		binding.sourceRunReceiptRef,
		binding.artifact.id,
	]);
}
function parseBindings(raw: string, path: string): P5ComputeSourceBinding[] {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		// JSON parse diagnostics can expose file bodies; report only the ledger path.
		throw new JsonStoreCorruptedError(path);
	}
	if (!Check(Type.Array(bindingSchema), value)) throw new JsonStoreCorruptedError(path);
	const bindings = value as P5ComputeSourceBinding[];
	const keys = bindings.map(sourceKey);
	if (new Set(keys).size !== keys.length || bindings.some((b) => win32.isAbsolute(b.artifact.path)))
		throw new JsonStoreCorruptedError(path);
	return bindings;
}
async function snapshot(path: string) {
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bindings: [], version: null };
		throw error;
	}
	return {
		bindings: parseBindings(bytes.toString("utf8"), path),
		version: createHash("sha256").update(bytes).digest("hex"),
	};
}
async function verified(binding: P5ComputeSourceBinding, ports: SourcePorts): Promise<boolean> {
	const receipt = await ports.getByRef({ receiptRef: binding.sourceRunReceiptRef });
	const { id: _id, ...expected } = binding.artifact;
	if (
		receipt?.decision !== "approved" ||
		receipt.status !== "succeeded" ||
		receipt.receiptRef !== binding.sourceRunReceiptRef ||
		!isDeepStrictEqual(receipt.scope, binding.scope) ||
		!receipt.readback.some((file) => isDeepStrictEqual(file, expected))
	)
		return false;
	const actual = await ports.readback(binding);
	return (
		actual !== undefined &&
		actual.collectionRoot === binding.collectionRoot &&
		actual.bytes.byteLength === expected.bytes &&
		createHash("sha256").update(actual.bytes).digest("hex") === expected.sha256
	);
}
async function issue(storage: Storage, ports: SourcePorts, input: P5ComputeSourceBinding): Promise<void> {
	if (!Check(bindingSchema, input) || win32.isAbsolute(input.artifact.path))
		throw new Error("Invalid P5 compute source binding");
	const binding = structuredClone(input);
	if (!(await verified(binding, ports))) throw new Error("P5 compute source readback failed");
	const before = await snapshot(storage.path);
	const existing = before.bindings.find((entry) => sourceKey(entry) === sourceKey(binding));
	if (existing) {
		if (!isDeepStrictEqual(existing, binding)) throw new Error("P5 compute source binding conflict");
		return;
	}
	const next = [...before.bindings, binding];
	await storage.json.writeChecked(next, {
		check: async () => {
			if ((await snapshot(storage.path)).version !== before.version)
				throw new Error("P5 compute source state conflict");
		},
		readBack: async () => {
			if (!isDeepStrictEqual((await snapshot(storage.path)).bindings, next))
				throw new Error("P5 compute source persistence readback failed");
		},
	});
}
/** Host-only associations; restored metadata never replaces current source verification or C approval. */
export function createP5ComputeSourceStore(
	options: SourcePorts & {
		readonly path: string;
		readonly registry: StorageRegistry;
	},
) {
	const entry: StorageEntry = {
		id: "agent-p5-compute-sources",
		path: options.path,
		owner: "services/p5-compute-sources",
		schema: 1,
		sensitivity: "private",
	};
	if (!options.registry.get(entry.id)) options.registry.register(entry);
	if (!isDeepStrictEqual(options.registry.assertRegistered(entry.id), entry))
		throw new Error("P5 compute source storage registration mismatch");
	const storage: Storage = {
		path: options.path,
		json: new JsonStore<P5ComputeSourceBinding[]>({
			path: options.path,
			storageId: "agent-p5-compute-sources",
			defaultValue: () => [],
			parse: (raw) => parseBindings(raw, options.path),
			mode: 0o600,
		}),
	};
	return {
		issue: (binding: P5ComputeSourceBinding) => issue(storage, options, binding),
		async resolveSource(input: ComputeRerunInput, scope: Scope): Promise<P5RerunSource | undefined> {
			const binding = (await storage.json.read()).find(
				(entry) =>
					isDeepStrictEqual(entry.scope, scope) &&
					entry.sourceRunReceiptRef === input.sourceRunReceiptRef &&
					entry.artifact.id === input.artifactId &&
					entry.profile === input.profile &&
					entry.artifact.sha256 === input.expectedSha256,
			);
			if (!binding || !(await verified(binding, options))) return undefined;
			return {
				runId: binding.runId,
				sourceRunReceiptRef: binding.sourceRunReceiptRef,
				workspaceId: binding.scope.workspaceId,
				artifactId: binding.artifact.id,
				verifiedSha256: binding.artifact.sha256,
				profile: binding.profile,
			};
		},
	};
}
