import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FactArtifact } from "@gyoungwe/plugin-api/p5-inquiry";
import type { FileReadback, Receipt, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import type { P5RerunLifecyclePorts, P5RerunRun } from "../plugins/p5-rerun-lifecycle";
import type { P5RerunSubmitPorts } from "../plugins/p5-rerun-submit";
import type { PluginCapabilityContext } from "../plugins/runtime-capabilities";
import type { ComputeServicePort } from "./compute";

export interface P5RerunLifecyclePortOptions {
	readonly compute: Pick<ComputeServicePort, "status" | "cancel" | "collect">;
	/** The Q1 ports; the lifecycle shares their receipt store and live scope. */
	readonly submit: Pick<P5RerunSubmitPorts, "store" | "scope" | "now">;
	/** Host-owned writable root that receives collected outputs. */
	readonly outputRoot: string;
	/**
	 * Host lookup of the durable run behind a rerun receipt. The lookup is
	 * confined to the receipt's scope and never submits.
	 */
	runOf(receipt: Receipt, scope: Scope): Promise<P5RerunRun | undefined>;
	/** Host-owned path of the verified source artifact behind a run. */
	sourcePathOf(run: P5RerunRun): string;
}

/** The compute job states the lifecycle reports. */
type RunStatus = P5RerunRun["status"];

/** Terminal compute states never downgrade into a running state. */
const TERMINAL: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);

/** Compute job states that map onto a rerun run state. */
function runStatusOf(job: { readonly status: string }): RunStatus {
	switch (job.status) {
		case "succeeded":
			return "succeeded";
		case "failed":
		case "blocked":
		case "partial":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "running":
		case "collecting":
		case "cancelling":
			return "running";
		case "queued":
		case "draft":
		case "authorized":
		case "prepared":
		case "submitting":
			return "accepted";
		default:
			return "outcome-unknown";
	}
}

/** The sha256 and byte count of the bytes actually on disk. */
async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
	const body = await readFile(path);
	return { sha256: createHash("sha256").update(body).digest("hex"), bytes: body.byteLength };
}

/**
 * The Q2 host ports over the real `ComputeService`: lookup, status, collect
 * and cancel for a rerun run.
 *
 * Every port reads actual bytes and actual job state. A terminal state never
 * downgrades, and a collect reports the bytes it actually read rather than
 * the reviewed expectation.
 */
export function createP5RerunLifecyclePorts(options: P5RerunLifecyclePortOptions): P5RerunLifecyclePorts {
	const statusOf = async (
		run: P5RerunRun,
	): Promise<{ status: RunStatus; artifacts: readonly FactArtifact[] }> => {
		// A terminal state is preserved even when the job reports something else.
		if (TERMINAL.has(run.status)) return { status: run.status, artifacts: run.artifacts };
		const job = await options.compute.status(run.jobId);
		if (!job) return { status: "outcome-unknown", artifacts: [] };
		const status = runStatusOf(job);
		// A succeeded job reports the run's own declared artifacts; the collect
		// then verifies the actual bytes against them.
		return { status, artifacts: status === "succeeded" ? run.artifacts : [] };
	};

	return {
		store: options.submit.store,
		scope: (context: PluginCapabilityContext): Scope => options.submit.scope(context),
		now: options.submit.now,
		findRun: (receipt, scope) => options.runOf(receipt, scope),
		status: (run) => statusOf(run),
		async collect(run) {
			const targetDir = join(options.outputRoot, run.jobId);
			// The collection only accepts a succeeded job, and the job's stored
			// status is stale until it has been reconciled. Reconcile first so a
			// finished job can actually be collected.
			await statusOf(run);
			await options.compute.collect(run.jobId, {
				targetDir,
				expected: run.artifacts.map(({ path }) => path),
			});
			// The source hash and every output hash come from the bytes on disk.
			const sourceSha256 = (await hashFile(options.sourcePathOf(run))).sha256;
			const readback: FileReadback[] = [];
			for (const artifact of run.artifacts) {
				const actual = await hashFile(join(targetDir, artifact.path));
				readback.push({ path: artifact.path, bytes: actual.bytes, sha256: actual.sha256 });
			}
			return { sourceSha256, readback };
		},
		async cancel(run) {
			// A cancel of a job that is already terminal must not downgrade it.
			const current = await statusOf(run);
			// Only a terminal run state can be returned; anything else is unknown.
			if (current.status === "succeeded") return "succeeded";
			if (current.status === "failed") return "failed";
			if (current.status === "cancelled") return "cancelled";
			const job = await options.compute.cancel(run.jobId);
			if (!job) return "outcome-unknown";
			const status = runStatusOf(job);
			// A cancel that did not reach a terminal state has an unknown outcome.
			if (status === "cancelled") return "cancelled";
			if (status === "failed") return "failed";
			if (status === "succeeded") return "succeeded";
			return "outcome-unknown";
		},
	};
}
