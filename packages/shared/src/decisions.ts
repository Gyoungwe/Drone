import { Type } from "typebox";
import { defineDomain } from "./host-api/define";

export const DecisionKindSchema = Type.Union([
	Type.Literal("task-authorization"),
	Type.Literal("workflow-repair"),
	Type.Literal("subagent-dispatch"),
	Type.Literal("compute-submit"),
	Type.Literal("zotero-write"),
	Type.Literal("rebind"),
]);

export const DecisionRecordSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 256 }),
		schemaVersion: Type.Literal(2),
		projectId: Type.String({ minLength: 1, maxLength: 512 }),
		kind: DecisionKindSchema,
		summary: Type.String({ minLength: 1, maxLength: 2000 }),
		basis: Type.Array(Type.String({ maxLength: 512 }), { maxItems: 32 }),
		affectedArtifactIds: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 512 }),
		status: Type.Union([Type.Literal("active"), Type.Literal("revoked")]),
		revokedAt: Type.Optional(Type.String()),
		revokeReason: Type.Optional(Type.String({ maxLength: 2000 })),
		createdAt: Type.String(),
	},
	{ additionalProperties: false },
);

export type DecisionKind =
	| "task-authorization"
	| "workflow-repair"
	| "subagent-dispatch"
	| "compute-submit"
	| "zotero-write"
	| "rebind";
export type DecisionRecord = {
	readonly id: string;
	readonly schemaVersion: number;
	readonly projectId: string;
	readonly kind: DecisionKind;
	readonly summary: string;
	readonly basis: readonly string[];
	readonly affectedArtifactIds: readonly string[];
	readonly status: "active" | "revoked";
	readonly revokedAt?: string;
	readonly revokeReason?: string;
	readonly createdAt: string;
};

const ProjectIdArgs = Type.Tuple([Type.String({ minLength: 1, maxLength: 512 })]);
const RevokeArgs = Type.Tuple([
	Type.String({ minLength: 1, maxLength: 256 }),
	Type.String({ minLength: 1, maxLength: 2000 }),
]);
const ConfirmArgs = Type.Tuple([
	Type.String({ minLength: 1, maxLength: 256 }),
	Type.String({ minLength: 1, maxLength: 2000 }),
]);

export const DecisionsContract = defineDomain("decisions", {
	methods: {
		list: {
			args: ProjectIdArgs,
			result: Type.Array(DecisionRecordSchema, { maxItems: 4096 }),
		},
		revoke: {
			args: RevokeArgs,
			result: DecisionRecordSchema,
		},
		confirm: {
			args: ConfirmArgs,
			result: DecisionRecordSchema,
		},
	},
	events: {},
});

export type DecisionsApi = import("./host-api/define").ClientOf<typeof DecisionsContract>;
