import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, parse, relative, resolve } from "node:path";
import type { RegisteredSession, SessionDirectory } from "../session/registry";
import type { PluginRuntimeSource } from "./coordinator";

/**
 * Host-issued task authorization (docs/superpowers/specs/2026-10-29-host-task-grant-design.md).
 * The user approves one task in a host-rendered dialog; the host keeps the grant, bound to the live
 * session entry, the requesting plugin source and the task contract. Nothing a plugin returns,
 * persists or restores can create or extend a grant.
 */
export interface TaskGrant {
	readonly id: string;
	readonly source: PluginRuntimeSource;
	readonly taskId: string;
	readonly contractHash: string;
	readonly writeRoots: readonly string[];
	readonly maxCalls: number;
	readonly maxAutoResumes: number;
	readonly issuedAt: string;
	/** External writes the user approved in the dialog, each admitted once without asking again. */
	readonly allowances: readonly TaskGrantAllowance[];
}

/**
 * One write allowance: the provider of a role member the requester consumes (resolved and shown by the
 * host) may make one `approval: "allowance"` write. Label and consent are the plugins' JSON; the host
 * renders the label and hands consent to that provider only, never interpreting either.
 */
export interface TaskGrantAllowance {
	readonly id: string;
	readonly role: string;
	readonly member: string;
	readonly label: string;
	readonly consent: unknown;
	readonly provider: { readonly pluginId: string; readonly contentHash: string };
}
const sameSource = (
	a: { pluginId: string; contentHash?: string },
	b: { pluginId: string; contentHash?: string },
) => a.pluginId === b.pluginId && !!a.contentHash && a.contentHash === b.contentHash;

export const MAX_TASK_WRITE_ROOTS = 8;

/**
 * Canonical existing project directories only: never a drive root, the home directory or one of
 * its parents. Resolved by the host before the dialog so the user approves what will be enforced.
 */
export function resolveTaskWriteRoots(cwd: string, directories: readonly string[]): string[] {
	if (directories.length > MAX_TASK_WRITE_ROOTS)
		throw new Error(`Choose at most ${MAX_TASK_WRITE_ROOTS} project directories.`);
	const home = realpathSync(homedir());
	const roots: string[] = [];
	for (const directory of directories) {
		const root = realpathSync(resolve(cwd, directory));
		const toHome = relative(root, home);
		if (root === parse(root).root || (!isAbsolute(toHome) && !toHome.startsWith("..")))
			throw new Error("Authorize a project directory, not a drive, home directory or its parent.");
		if (!statSync(root).isDirectory())
			throw new Error("Authorize an existing project directory; outputs may create subdirectories.");
		if (!roots.includes(root)) roots.push(root);
	}
	return roots;
}

export class TaskGrantStore {
	private readonly grants = new WeakMap<object, TaskGrant>();
	/** Automatic continuations already started under each grant (by grant id). */
	private readonly resumes = new Map<string, number>();
	private sourceCurrent: (source: PluginRuntimeSource) => boolean = () => false;
	private providerFor: (
		consumer: PluginRuntimeSource,
		role: string,
		member: string,
	) => PluginRuntimeSource | null = () => null;
	/** Allowances already used, by grant id. */
	private readonly used = new Map<string, Set<string>>();

	constructor(private readonly sessions: SessionDirectory) {}

	/** The plugin bridge supplies which installed sources are current; until then no grant is valid. */
	bindSourceValidator(current: (source: PluginRuntimeSource) => boolean): void {
		this.sourceCurrent = current;
	}

	/** The plugin bridge resolves role members from the installed catalog; until then none resolves. */
	bindProviderResolver(
		resolve: (consumer: PluginRuntimeSource, role: string, member: string) => PluginRuntimeSource | null,
	): void {
		this.providerFor = resolve;
	}

	provider(consumer: PluginRuntimeSource, role: string, member: string): PluginRuntimeSource | null {
		return this.providerFor(consumer, role, member);
	}

	/** Uses one allowance of the session's current grant held by exactly this provider source. */
	consumeAllowance(identity: object, caller: PluginRuntimeSource, id: string): boolean {
		const grant = this.current(identity);
		const allowance = grant?.allowances.find((item) => item.id === id);
		if (!grant || !allowance || !sameSource(allowance.provider, caller)) return false;
		const used = this.used.get(grant.id) ?? new Set<string>();
		if (used.has(id)) return false;
		used.add(id);
		this.used.set(grant.id, used);
		return true;
	}

	allowancesFor(identity: object, caller: PluginRuntimeSource) {
		const grant = this.current(identity);
		if (!grant) return null;
		const used = this.used.get(grant.id);
		return {
			taskId: grant.taskId,
			allowances: grant.allowances
				.filter((item) => sameSource(item.provider, caller))
				.map(({ id, role, member, consent }) => ({
					id,
					role,
					member,
					consent: consent ?? null,
					used: !!used?.has(id),
				})),
		};
	}

	allowance(identity: object, id: string): TaskGrantAllowance | undefined {
		return this.current(identity)?.allowances.find((item) => item.id === id);
	}

	/** Replaces one allowance after its own host dialog; the replacement is unused. */
	amend(
		identity: object,
		requester: PluginRuntimeSource,
		taskId: string,
		id: string,
		label: string,
		consent: unknown,
	) {
		const grant = this.current(identity);
		const index = grant ? grant.allowances.findIndex((item) => item.id === id) : -1;
		if (!grant || grant.taskId !== taskId || !sameSource(grant.source, requester) || index < 0)
			throw new Error("Only the authorized task's own plugin can change an allowance it holds");
		const allowances = [...grant.allowances];
		allowances[index] = { ...(allowances[index] as TaskGrantAllowance), label, consent };
		this.grants.set(identity, { ...grant, allowances });
		this.used.get(grant.id)?.delete(id);
	}

	issue(
		identity: object,
		grant: Omit<TaskGrant, "id" | "issuedAt" | "allowances"> & { allowances?: readonly TaskGrantAllowance[] },
	): TaskGrant {
		const issued = { allowances: [], ...grant, id: randomUUID(), issuedAt: new Date().toISOString() };
		// One active task grant per session: a new authorization replaces the previous one.
		this.grants.set(identity, issued);
		return issued;
	}

	/** The grant of a live session entry whose plugin source is still the current installed one. */
	current(identity: object): TaskGrant | undefined {
		const grant = this.grants.get(identity);
		if (!grant) return undefined;
		const entry = identity as RegisteredSession;
		if (
			this.sessions.get(entry.session.sessionId) !== entry ||
			this.sessions.signalFor(entry).aborted ||
			!this.sourceCurrent(grant.source)
		) {
			this.grants.delete(identity);
			return undefined;
		}
		return grant;
	}

	/** Reserve one automatic continuation of the grant's budget; false when the budget is spent. */
	reserveResume(grant: TaskGrant): boolean {
		const used = this.resumes.get(grant.id) ?? 0;
		if (used >= grant.maxAutoResumes) return false;
		this.resumes.set(grant.id, used + 1);
		return true;
	}

	resumesLeft(grant: TaskGrant): number {
		return grant.maxAutoResumes - (this.resumes.get(grant.id) ?? 0);
	}

	release(identity: object, taskId: string): boolean {
		const grant = this.current(identity);
		if (grant?.taskId !== taskId) return false;
		this.grants.delete(identity);
		return true;
	}

	/** Directories the permission gate may write without asking, for the session's current grant. */
	writeRoots(sessionId: string): readonly string[] | undefined {
		const entry = this.sessions.get(sessionId);
		return entry ? this.current(entry)?.writeRoots : undefined;
	}
}
