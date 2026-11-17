/** Opt-in artifact acceptance; see docs/pluginization/packed-knowledge-runtime-acceptance.md. */
import { join, resolve } from "node:path";
import { it } from "vitest";
import {
	cleanupRuntime,
	collectReceipt,
	finishEvidence,
	recordFailure,
	verifyRetainedUiOwner,
} from "./packed-knowledge-runtime/evidence.mjs";
import { verifyModelReview } from "./packed-knowledge-runtime/model-review.mjs";
import { verifyModelReviewVerdicts } from "./packed-knowledge-runtime/model-review-verdicts.mjs";
import { verifyStatePolicy } from "./packed-knowledge-runtime/policy.mjs";
import { verifyApplicationReading, verifySessionReading } from "./packed-knowledge-runtime/reading.mjs";
import { prepareReviewProposals, verifyReviewPreview } from "./packed-knowledge-runtime/review-preview.mjs";
import { verifyReviewWrites } from "./packed-knowledge-runtime/review-writes.mjs";
import { createRuntime } from "./packed-knowledge-runtime/runtime.mjs";
import {
	createReadOnlySession,
	createWritableSession,
	verifyReadOnlySession,
} from "./packed-knowledge-runtime/sdk-sessions.mjs";
import { createContext, prepareArtifact } from "./packed-knowledge-runtime/setup.mjs";

const tarball = process.env.DRONE_KNOWLEDGE_TARBALL;
const apiTarball = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);

it.skipIf(!tarball)(
	"installed knowledge tarball shares one process owner for SDK reads and UI review writes, then releases both processes",
	async () => {
		const ctx = await createContext({
			tarball,
			apiTarball,
			runtimeDirectory,
			testDirectory: import.meta.dirname,
		});
		try {
			await prepareArtifact(ctx);
			await createRuntime(ctx);
			await verifyStatePolicy(ctx);
			await verifyApplicationReading(ctx);
			await createReadOnlySession(ctx);
			await verifyReadOnlySession(ctx);
			await verifySessionReading(ctx);
			await prepareReviewProposals(ctx);
			await verifyReviewPreview(ctx);
			await createWritableSession(ctx);
			await verifyReviewWrites(ctx);
			await verifyModelReview(ctx);
			await verifyModelReviewVerdicts(ctx);
			await verifyRetainedUiOwner(ctx);
			await collectReceipt(ctx);
		} catch (error) {
			await recordFailure(ctx, error);
		} finally {
			await cleanupRuntime(ctx);
		}
		await finishEvidence(ctx);
	},
	120000,
);
