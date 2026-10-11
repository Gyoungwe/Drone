import { type Static, Type } from "typebox";
import { defineDomain } from "./define";

const Id = Type.String({ minLength: 1, maxLength: 256, pattern: "^[^\\u0000-\\u001f]+$" });
const Hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const Audience = Type.Union([Type.Literal("public"), Type.Literal("restricted"), Type.Literal("private")]);
const Checkpoint = Type.Object({
	id: Hash,
	analysisId: Id,
	assay: Type.String(),
	createdAt: Type.String(),
	files: Type.Array(
		Type.Object({ path: Type.String(), kind: Type.String(), bytes: Type.Number(), sha256: Hash }),
	),
	environmentFingerprint: Type.Optional(Type.String()),
	replayReady: Type.Boolean(),
});
const Branch = Type.Object({
	id: Id,
	checkpointId: Hash,
	workspace: Type.String(),
	status: Type.Union([Type.Literal("preparing"), Type.Literal("ready"), Type.Literal("failed")]),
});
const Replay = Type.Object({
	id: Id,
	checkpointId: Hash,
	status: Type.Union([Type.Literal("reproduced"), Type.Literal("failed")]),
	detail: Type.String(),
	outputChecks: Type.Array(Type.Object({ path: Type.String(), matched: Type.Boolean() })),
	environmentMatched: Type.Boolean(),
	completedAt: Type.String(),
});
const Overview = Type.Object({
	analyses: Type.Array(
		Type.Object({
			id: Id,
			question: Type.String(),
			assay: Type.String(),
			stage: Type.String(),
			artifactCount: Type.Number(),
		}),
	),
	checkpoints: Type.Array(Checkpoint),
	branches: Type.Array(Branch),
	replays: Type.Array(Replay),
});
/** Local application only. No capsule bytes or executor callbacks cross the bridge. */
export const EvidenceContract = defineDomain("evidence", {
	methods: {
		getEvidenceOverview: { args: Type.Tuple([]), result: Overview },
		freezeAnalysisEvidence: {
			args: Type.Tuple([
				Id,
				Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000-\\u001f]+$" }),
			]),
			result: Checkpoint,
		},
		forkEvidenceCheckpoint: {
			args: Type.Tuple([Hash, Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$" })]),
			result: Branch,
		},
		exportEvidenceCapsule: {
			args: Type.Tuple([Hash, Audience]),
			result: Type.Object({ path: Type.String(), sha256: Hash, audience: Audience }),
		},
		importEvidenceCapsule: {
			args: Type.Tuple([Type.String({ minLength: 1, maxLength: 4096 })]),
			result: Checkpoint,
		},
		replayEvidenceCheckpoint: { args: Type.Tuple([Hash]), result: Replay },
	},
	events: {},
});
export type EvidenceApi = import("./define").ClientOf<typeof EvidenceContract>;
export type EvidenceOverview = Static<typeof Overview>;
export type EvidenceCheckpointSummary = Static<typeof Checkpoint>;
export type EvidenceBranchSummary = Static<typeof Branch>;
