import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse, relative, resolve } from "node:path";

/** Maximum automatic continuations allowed for one authorized task. */
export const MAX_AUTO_RESUMES = 3;

export interface ConsentTask {
	id?: unknown;
	goal?: unknown;
	binding?: unknown;
	authorizationSummary?: unknown;
	writeRoots?: unknown;
	/** Optional remote-compute scope. It is part of the immutable contract hash. */
	compute?: unknown;
	milestones?: readonly {
		id?: unknown;
		title?: unknown;
		dependsOn?: unknown;
		acceptance?: unknown;
	}[];
	planApproved?: unknown;
	executionConsent?: unknown;
}

export interface ExecutionConsent {
	version?: unknown;
	contractHash?: unknown;
	maxCalls?: unknown;
	maxAutoResumes?: unknown;
	approvedAt?: unknown;
}

export function contractHash(task: ConsentTask): string {
	const contract: unknown[] = [
		task.id,
		task.goal,
		task.binding ?? null,
		task.authorizationSummary ?? "",
		task.writeRoots ?? [],
	];
	// Keep the pre-compute hash byte-for-byte stable for legacy tasks. A new
	// compute block is appended only when it was explicitly part of the plan.
	if (task.compute !== undefined) contract.push(task.compute ?? null);
	contract.push(
		(task.milestones || []).map(({ id, title, dependsOn, acceptance }) => ({
			id,
			title,
			dependsOn,
			acceptance,
		})),
	);
	return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

/** Only an explicit revision-checked task action creates this record. */
export function hasTaskConsent(task: ConsentTask | null | undefined, maxCalls: number): boolean {
	const consent = task?.executionConsent as ExecutionConsent | undefined;
	return Boolean(
		task?.planApproved &&
			task.milestones?.length &&
			consent?.version === 1 &&
			consent.contractHash === contractHash(task) &&
			consent.maxCalls === maxCalls &&
			consent.maxAutoResumes === MAX_AUTO_RESUMES &&
			typeof consent.approvedAt === "string",
	);
}

/** Resolve directories before approval, so the card shows the actual targets. */
export async function resolveWriteRoots(cwd: string, paths: readonly unknown[] = []): Promise<string[]> {
	if (!Array.isArray(paths) || paths.length > 8) throw new Error("Choose at most eight project directories.");
	const roots: string[] = [];
	const home = await realpath(homedir());
	for (const value of paths) {
		if (typeof value !== "string" || !value.trim() || value.length > 512)
			throw new Error("Invalid write directory.");
		const root = await realpath(resolve(cwd, value));
		const homeRelative = relative(root, home);
		if (root === parse(root).root || (!isAbsolute(homeRelative) && !homeRelative.startsWith("..")))
			throw new Error("Authorize a project directory, not a drive, home directory or its parent.");
		if (!(await stat(root)).isDirectory())
			throw new Error("Authorize an existing project directory; outputs may create subdirectories.");
		if (!roots.includes(root)) roots.push(root);
	}
	return roots;
}
