import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ResearchFileEntry {
	readonly name: string;
	readonly kind: "file" | "directory" | "symlink" | "other";
}

export interface ResearchHostPort {
	resolveRoot(path: string): Promise<{ handle: string }>;
	readText(root: string, path: string): Promise<string>;
	listFiles(root: string, path: string): Promise<readonly ResearchFileEntry[]>;
}

export interface ResearchRunListInput {
	readonly workspace: string;
	readonly project?: string | null;
	readonly limit?: number;
}

export interface ResearchRunStatusInput extends ResearchRunListInput {
	readonly runDir?: string | null;
}

/** Inputs accepted by a provider that owns the complete run-detail projection. */
export interface ResearchRunDetailInput extends ResearchRunStatusInput {
	readonly runId?: string | null;
}

export interface ResearchRunSummary {
	readonly runId: string;
	readonly resultSlug: string;
	readonly project: string;
	readonly topicId: string | null;
	readonly query: string;
	readonly status: string;
	readonly stage: string;
	readonly answerable: boolean;
	readonly startedAt: string | null;
	readonly updatedAt: string | null;
	readonly runDir: string;
}

export interface ResearchRunListResult {
	readonly items: readonly ResearchRunSummary[];
	readonly total: number;
}

export interface ResearchHostOperations {
	status(input: ResearchRunStatusInput): Promise<ResearchRunListResult | { item: ResearchRunSummary }>;
	listRuns(input: ResearchRunListInput): Promise<ResearchRunListResult>;
	/** Optional full evidence projection; metadata-only providers remain valid. */
	detail?(input: ResearchRunDetailInput): Promise<unknown>;
}

export interface ResearchHostAdapter {
	readonly contractVersion: 1;
	readonly operations: ResearchHostOperations;
}

export interface ResearchHostLoader {
	readonly contractVersion: 1;
	load(port: ResearchHostPort): ResearchHostAdapter;
}

function confined(root: string, path: string): string {
	if (isAbsolute(path)) throw new Error("Research host path must be relative to its granted root");
	const resolvedRoot = resolve(root);
	const candidate = resolve(resolvedRoot, path);
	const rel = relative(resolvedRoot, candidate);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new Error("Research host path escapes its granted root");
	return candidate;
}

export function createResearchHostPort(): ResearchHostPort {
	return {
		async resolveRoot(path) {
			return { handle: resolve(path) };
		},
		async readText(root, path) {
			return readFile(confined(root, path), "utf8");
		},
		async listFiles(root, path) {
			const entries = await readdir(confined(root, path), { withFileTypes: true });
			return entries.map((entry) => ({
				name: entry.name,
				kind: entry.isDirectory()
					? "directory"
					: entry.isFile()
						? "file"
						: entry.isSymbolicLink()
							? "symlink"
							: "other",
			}));
		},
	};
}
