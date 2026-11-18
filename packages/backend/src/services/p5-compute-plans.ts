import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { win32 } from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as Shared from "@drone/shared";
import { Budget } from "@gyoungwe/plugin-api/p5-inquiry";
import { FileReadback, Hash, Id, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { type TProperties, Type } from "typebox";
import { Check } from "typebox/value";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import type { StorageEntry, StorageRegistry } from "../storage/registry";
import { assertComputePreflight, type ComputePreflightJobSpec } from "./compute-preflight";
export interface P5ComputePlan {
	readonly preflightRef: string;
	readonly sha256: string;
	readonly scope: Scope;
	readonly profile: string;
	readonly image: string;
	readonly spec: ComputePreflightJobSpec;
	readonly collectionRoot: string;
	readonly expected: readonly FileReadback[];
	readonly budget: Budget;
}
type Storage = { readonly path: string; readonly json: JsonStore<P5ComputePlan[]> };
function closed<Fields extends TProperties>(fields: Fields) {
	return Type.Object(fields, { additionalProperties: false });
}
const text = Type.String({ minLength: 1 });
const scalar = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const specSchema = closed({
	...Shared.JobSpecSchema.properties,
	jobId: Id,
	lineage: Type.Optional(Shared.CausalEnvelopeSchema),
	contractHash: Type.Optional(Hash),
	authorization: Type.Optional(
		closed({
			...Shared.ComputeAuthorizationSchema.properties,
			approved: Type.Boolean(),
			contractHash: Hash,
		}),
	),
	dataDesign: Type.Optional(
		closed({
			dataset: Shared.ComputeDatasetVersionSchema,
			sampleSheet: Shared.ComputeSampleSheetSchema,
			analysisPlan: Shared.ComputeAnalysisPlanSchema,
			contract: Shared.ComputeDataDesignContractSchema,
			rows: Type.Array(Type.Record(Type.String(), scalar)),
			fetchRecords: Type.Optional(Type.Array(Shared.ComputePublicDataFetchRecordSchema)),
			confounding: Type.Optional(
				closed({
					treatment: text,
					blockingFactors: Type.Optional(Type.Array(text)),
					factors: Type.Optional(Type.Array(text)),
				}),
			),
		}),
	),
});
const planSchema = closed({
	preflightRef: Id,
	sha256: Hash,
	scope: Scope,
	profile: text,
	image: text,
	spec: specSchema,
	collectionRoot: text,
	expected: Type.Array(FileReadback, { minItems: 1 }),
	budget: Budget,
});
function planHash(plan: Omit<P5ComputePlan, "sha256">): string {
	const { spec, profile, image, collectionRoot, expected, budget, scope } = plan;
	return Shared.contractContentHash({ spec, profile, image, collectionRoot, expected, budget, scope });
}
function validatePlan(value: unknown): asserts value is P5ComputePlan {
	if (!Check(planSchema, value)) throw new Error("Invalid P5 compute plan");
	const plan = value as P5ComputePlan;
	const paths = plan.expected.map((entry) => entry.path);
	if (new Set(paths).size !== paths.length || paths.some((path) => win32.isAbsolute(path)))
		throw new Error("Invalid P5 compute expectations");
	assertComputePreflight(plan.spec);
}
function parsePlans(text: string, path: string): P5ComputePlan[] {
	try {
		const value: unknown = JSON.parse(text);
		if (!Array.isArray(value)) throw new Error("Invalid plan ledger");
		const refs = new Set<string>();
		for (const plan of value) {
			validatePlan(plan);
			if (refs.has(plan.preflightRef) || plan.sha256 !== planHash(plan)) throw new Error("Invalid binding");
			refs.add(plan.preflightRef);
		}
		return value;
	} catch {
		// Disk/preflight errors may contain private spec content; expose only the corrupt path.
		throw new JsonStoreCorruptedError(path);
	}
}
async function snapshot(path: string) {
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { plans: [], version: null };
		throw error;
	}
	return {
		plans: parsePlans(bytes.toString("utf8"), path),
		version: createHash("sha256").update(bytes).digest("hex"),
	};
}
function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function existingPlan(plans: P5ComputePlan[], plan: P5ComputePlan): P5ComputePlan | undefined {
	const existing = plans.find((entry) => entry.preflightRef === plan.preflightRef);
	if (existing && existing.sha256 !== plan.sha256) throw new Error("P5 compute plan reference conflict");
	return existing;
}
async function issue(storage: Storage, candidate: P5ComputePlan): Promise<P5ComputePlan> {
	validatePlan(candidate);
	const plan = JSON.parse(JSON.stringify(candidate)) as P5ComputePlan;
	const before = await snapshot(storage.path);
	const existing = existingPlan(before.plans, plan);
	if (existing) return freeze(existing);
	const next = [...before.plans, plan];
	const conflict = new Error("P5 compute plan state conflict");
	return storage.json
		.writeChecked(next, {
			check: async () => {
				if ((await snapshot(storage.path)).version !== before.version) throw conflict;
			},
			readBack: async () => {
				if (!isDeepStrictEqual((await snapshot(storage.path)).plans, next))
					throw new Error("P5 compute plan readback failed");
				return freeze(plan);
			},
		})
		.catch(async (error: unknown) => {
			if (error !== conflict) throw error;
			// Reconcile the same ref once; never retry a stale ledger write.
			const current = existingPlan((await snapshot(storage.path)).plans, plan);
			if (!current) throw error;
			return freeze(current);
		});
}
/** Host-only issuance; a stored plan reference conveys no execution authority. */
export function createP5ComputePlanStore(options: {
	readonly path: string;
	readonly registry: StorageRegistry;
}) {
	const entry: StorageEntry = {
		id: "agent-p5-compute-plans",
		path: options.path,
		owner: "services/p5-compute-plans",
		schema: 1,
		sensitivity: "private",
	};
	if (!options.registry.get(entry.id)) options.registry.register(entry);
	if (!isDeepStrictEqual(options.registry.assertRegistered(entry.id), entry))
		throw new Error("P5 compute plan storage registration mismatch");
	const storage: Storage = {
		path: options.path,
		json: new JsonStore<P5ComputePlan[]>({
			path: options.path,
			storageId: "agent-p5-compute-plans",
			defaultValue: () => [],
			parse: (text) => parsePlans(text, options.path),
			mode: 0o600,
		}),
	};
	return {
		issue(input: Omit<P5ComputePlan, "sha256" | "scope">, scope: Scope): Promise<P5ComputePlan> {
			const body = structuredClone({ ...input, scope });
			return issue(storage, { ...body, sha256: planHash(body) });
		},
		async resolve(ref: string, scope: Scope): Promise<P5ComputePlan | undefined> {
			const plan = (await snapshot(storage.path)).plans.find((entry) => entry.preflightRef === ref);
			return plan && isDeepStrictEqual(plan.scope, scope) ? freeze(plan) : undefined;
		},
	};
}
