import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve the bundled research workbench without coupling callers to a source-tree URL. */
export function researchWorkbenchRoot(): string {
	return (
		process.env.DRONE_RESEARCH_WORKBENCH_ROOT ??
		join(fileURLToPath(new URL("../../../../", import.meta.url)), ".pi")
	);
}
