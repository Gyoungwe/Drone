import { createEvidenceRecovery as createPackageEvidenceRecovery } from "@drone/tasks/evidence";
import { inspectTaskFile } from "./workbench.mjs";

/** Runtime adapter: file scope and hashing remain host-owned. */
export function createEvidenceRecovery(options) {
	return createPackageEvidenceRecovery({ ...options, inspectTaskFile });
}
