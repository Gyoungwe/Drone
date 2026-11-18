import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";

/** MAIN-only candidates supplied by host grant selection, never capability request JSON. */
export interface P5ResourceRootGrant {
	readonly kind: string;
	readonly handle: string;
	readonly path: string;
}

export class P5ResourceRootLease {
	private closed = false;
	private closing?: Promise<void>;
	constructor(
		private readonly rootOf: () => string,
		readonly reservations: PluginResourceReservations,
	) {}

	root(): string {
		if (this.closed) throw new Error("P5 root lease is closed");
		const root = this.rootOf();
		this.reservations.assertReserved("state-writers", root);
		return root;
	}

	/** Invalidate first; only successful cleanup permits release, including after revocation. */
	close(cleanup: () => Promise<void>): Promise<void> {
		this.closed = true;
		if (!this.closing) {
			this.closing = Promise.resolve()
				.then(cleanup)
				.then(() => this.reservations.dispose())
				.catch((error: unknown) => {
					// Failed cleanup keeps reservations held until an explicit recovery attempt succeeds.
					this.closing = undefined;
					throw error;
				});
		}
		return this.closing;
	}
}

/** Host selection owns kind eligibility and aborts the signal on selection switch/close.
 * Existing JSON, binary-state and text grants do not authorize generic staged output. */
export function selectP5ResourceRoot(
	grants: readonly P5ResourceRootGrant[],
	selected: Pick<P5ResourceRootGrant, "kind" | "handle">,
	signal: AbortSignal,
	/** Internal test seam; production uses the same local-user leases as state writers. */
	leaseDirectory?: string,
) {
	signal.throwIfAborted();
	const matches = grants.filter((grant) => grant.kind === selected.kind && grant.handle === selected.handle);
	const [grant] = matches;
	if (matches.length !== 1 || !grant) throw new Error("P5 root selection requires exactly one grant");
	const root = realpathSync(grant.path);
	if (root !== resolve(grant.path)) throw new Error("P5 root must not traverse symlinks");
	const identity = lstatSync(root);
	const currentRoot = () => {
		signal.throwIfAborted();
		const current = lstatSync(root);
		if (
			!current.isDirectory() ||
			current.dev !== identity.dev ||
			current.ino !== identity.ino ||
			realpathSync(root) !== root
		)
			throw new Error("P5 root changed after selection");
		return root;
	};
	currentRoot();
	return {
		root: currentRoot,
		acquire: () => {
			const root = currentRoot();
			const reservations = new PluginResourceReservations(leaseDirectory);
			reservations.reserve("state-writers", [root]);
			return new P5ResourceRootLease(currentRoot, reservations);
		},
	};
}
