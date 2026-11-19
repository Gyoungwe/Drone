import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import type { PluginRootGrant } from "./file-capabilities";
import { checkRoot, resolveRootPath } from "./plugin-root-checks";

export interface P5AdoptedWriter {
	readonly attachment: object;
	readonly scope: Scope;
	readonly rootHandle: string;
	readonly relativeDirectory: string;
	readonly signal: AbortSignal;
}
export interface PluginWriterAuthorityView {
	isReserved(writer: P5AdoptedWriter): Promise<boolean>;
}

/** Only PluginFileCapabilities supplies the captured roots and its actual reservation owner. */
export function createPluginWriterAuthorityView(
	roots: ReadonlyMap<string, PluginRootGrant & { readonly identity: Stats }>,
	reservations: Pick<PluginResourceReservations, "assertReserved">,
): PluginWriterAuthorityView {
	return Object.freeze({
		async isReserved(writer: P5AdoptedWriter): Promise<boolean> {
			try {
				writer.signal.throwIfAborted();
				const root = roots.get(writer.rootHandle);
				if (!root || (root.kind !== "state" && root.kind !== "binary-state")) return false;
				if (root.scope.kind === "workspace" && root.scope.workspaceId !== writer.scope.workspaceId)
					return false;
				const grant = root.kind === "state" ? root.stateWrite : root.binaryStateWrite;
				if (!grant) return false;
				const path = writer.relativeDirectory;
				if (
					isAbsolute(path) ||
					path.includes("\\") ||
					path.includes("\0") ||
					(path !== "" && path.split("/").some((part) => !part || part === "." || part === ".."))
				)
					return false;
				if ((await realpath(grant.registry.assertRegistered(grant.storageId).path)) !== root.path)
					return false;
				const directory = await resolveRootPath(root, path);
				if (!(await lstat(directory)).isDirectory()) return false;
				await checkRoot(root);
				writer.signal.throwIfAborted();
				reservations.assertReserved("state-writers", directory);
				return true;
			} catch {
				// Failed authority checks deny delivery; filesystem diagnostics must stay host-private.
				return false;
			}
		},
	});
}

function matches(writer: P5AdoptedWriter, current: P5AdoptedWriter | undefined): boolean {
	return (
		current !== undefined &&
		!writer.signal.aborted &&
		!current.signal.aborted &&
		writer.attachment === current.attachment &&
		writer.rootHandle === current.rootHandle &&
		writer.relativeDirectory === current.relativeDirectory &&
		writer.scope.workspaceId === current.scope.workspaceId &&
		writer.scope.sessionId === current.scope.sessionId &&
		writer.scope.callerSourceHash === current.scope.callerSourceHash &&
		writer.scope.providerSourceHash === current.scope.providerSourceHash
	);
}

/** MAIN supplies only the live adoption for the currently selected S write grant; revocation removes it. */
export function createPluginWriterAuthority(
	view: PluginWriterAuthorityView,
	currentWriter: () => P5AdoptedWriter | undefined,
): { authorizeDelivery(writer: P5AdoptedWriter): Promise<boolean> } {
	return {
		async authorizeDelivery(writer) {
			try {
				if (!matches(writer, currentWriter())) return false;
				if (!(await view.isReserved(writer))) return false;
				return matches(writer, currentWriter());
			} catch {
				// A failed selected-grant lookup is a denial, never a new grant or a path-bearing error.
				return false;
			}
		},
	};
}
