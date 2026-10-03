import { join } from "node:path";
import {
	buildROCrateManifest,
	type DatasetVersionInput,
	exportROCrate,
	type ROCrateInput,
	registerDatasetVersion,
	validatePublicDataFetchRecord,
} from "@drone/compute";
import type { ComputeDatasetVersion, ComputePublicDataFetchRecord } from "@drone/shared";
import { JsonStore } from "../json-store";
import { getAgentDir } from "../session-engine/engine";
import type { StorageRegistry } from "../storage/registry";

interface DataDesignDocument {
	readonly version: 1;
	readonly datasets: readonly ComputeDatasetVersion[];
	readonly fetchRecords: readonly ComputePublicDataFetchRecord[];
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.filter((key) => record[key] !== undefined)
		.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
		.join(",")}}`;
}

export interface ComputeDataDesignServiceOptions {
	readonly storage?: StorageRegistry;
	readonly agentDir?: string;
}

export interface ComputeDataDesignServicePort {
	registerDatasetVersion(input: DatasetVersionInput): Promise<ComputeDatasetVersion>;
	getDatasetVersion(datasetId: string, versionId?: string): Promise<ComputeDatasetVersion | null>;
	listDatasetVersions(datasetId?: string): Promise<readonly ComputeDatasetVersion[]>;
	registerPublicDataFetchRecord(record: ComputePublicDataFetchRecord): Promise<ComputePublicDataFetchRecord>;
	getPublicDataFetchRecord(id: string): Promise<ComputePublicDataFetchRecord | null>;
	listPublicDataFetchRecords(): Promise<readonly ComputePublicDataFetchRecord[]>;
	exportROCrate(input: ROCrateInput): Promise<string>;
	buildROCrateManifest(input: ROCrateInput): ReturnType<typeof buildROCrateManifest>;
}

/**
 * Durable host-facing B7 registry. Dataset versions and public fetch records
 * are immutable by content/id; updates that would change scientific records
 * fail closed. RO-Crate generation remains deterministic and side-effect free.
 */
export class ComputeDataDesignService implements ComputeDataDesignServicePort {
	private readonly store: JsonStore<DataDesignDocument>;

	constructor(options: ComputeDataDesignServiceOptions = {}) {
		const root = join(options.agentDir ?? getAgentDir(), "compute");
		const path = join(root, "data-design.json");
		if (options.storage && !options.storage.get("agent-compute-data-design")) {
			options.storage.register({
				id: "agent-compute-data-design",
				path,
				owner: "compute/data-design",
				schema: 1,
				sensitivity: "private",
			});
		}
		this.store = new JsonStore<DataDesignDocument>({
			path,
			storageId: "agent-compute-data-design",
			defaultValue: () => ({ version: 1, datasets: [], fetchRecords: [] }),
			parse: (raw) => {
				const value = JSON.parse(raw) as Partial<DataDesignDocument>;
				if (value.version !== 1 || !Array.isArray(value.datasets) || !Array.isArray(value.fetchRecords))
					throw new Error("Invalid compute data-design document");
				return value as DataDesignDocument;
			},
		});
	}

	async registerDatasetVersion(input: DatasetVersionInput): Promise<ComputeDatasetVersion> {
		const dataset = registerDatasetVersion(input);
		await this.store.update((document) => {
			const current = document.datasets.find(
				(item) => item.datasetId === dataset.datasetId && item.versionId === dataset.versionId,
			);
			if (current) {
				if (canonical(current) !== canonical(dataset))
					throw new Error(`Dataset version already exists with different contents: ${dataset.versionId}`);
				return document;
			}
			return { ...document, datasets: [...document.datasets, dataset] };
		});
		return structuredClone(dataset);
	}

	async getDatasetVersion(datasetId: string, versionId?: string): Promise<ComputeDatasetVersion | null> {
		const values = await this.listDatasetVersions(datasetId);
		const item = versionId ? values.find((value) => value.versionId === versionId) : values.at(-1);
		return item ? structuredClone(item) : null;
	}

	async listDatasetVersions(datasetId?: string): Promise<readonly ComputeDatasetVersion[]> {
		const document = await this.store.read();
		return structuredClone(
			document.datasets.filter((dataset) => datasetId === undefined || dataset.datasetId === datasetId),
		);
	}

	async registerPublicDataFetchRecord(
		record: ComputePublicDataFetchRecord,
	): Promise<ComputePublicDataFetchRecord> {
		validatePublicDataFetchRecord(record);
		await this.store.update((document) => {
			const current = document.fetchRecords.find((item) => item.id === record.id);
			if (current) {
				if (canonical(current) !== canonical(record))
					throw new Error(`Public data fetch record already exists with different contents: ${record.id}`);
				return document;
			}
			return { ...document, fetchRecords: [...document.fetchRecords, structuredClone(record)] };
		});
		return structuredClone(record);
	}

	async getPublicDataFetchRecord(id: string): Promise<ComputePublicDataFetchRecord | null> {
		const value = (await this.store.read()).fetchRecords.find((record) => record.id === id);
		return value ? structuredClone(value) : null;
	}

	async listPublicDataFetchRecords(): Promise<readonly ComputePublicDataFetchRecord[]> {
		return structuredClone((await this.store.read()).fetchRecords);
	}

	exportROCrate(input: ROCrateInput): Promise<string> {
		return Promise.resolve(exportROCrate(input));
	}

	buildROCrateManifest(input: ROCrateInput): ReturnType<typeof buildROCrateManifest> {
		return buildROCrateManifest(input);
	}
}

export function createComputeDataDesignService(
	options: ComputeDataDesignServiceOptions = {},
): ComputeDataDesignServicePort {
	return new ComputeDataDesignService(options);
}
