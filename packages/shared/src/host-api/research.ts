import { Type } from "typebox";
import type { ResearchCaptureRecord, ResearchCaptureResult } from "../research-capture";
import type { ResearchConnectorFailure, ResearchConnectorHit } from "../research-connectors";
import { defineDomain } from "./define";

const Input = Type.Object(
	{
		cwd: Type.String({ minLength: 1, maxLength: 4096 }),
		relativePath: Type.String({ minLength: 1, maxLength: 4096 }),
		scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("workspace")])),
		expiresAt: Type.Optional(Type.String({ minLength: 20, maxLength: 64 })),
	},
	{ additionalProperties: false },
);
const IdInput = Type.Object(
	{ id: Type.String({ minLength: 1, maxLength: 256 }) },
	{ additionalProperties: false },
);
const ListInput = Type.Object(
	{ cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })) },
	{ additionalProperties: false },
);
const SearchInput = Type.Object(
	{
		query: Type.String({ minLength: 1, maxLength: 512 }),
		connectorIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 })),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
	},
	{ additionalProperties: false },
);

const Result = <T>() => Type.Unsafe<T>({ type: "object" });
const ListResult = Type.Object({ items: Type.Array(Type.Unsafe<ResearchCaptureRecord>({ type: "object" })) });
const SearchResult = Type.Object({
	query: Type.String(),
	hits: Type.Array(Type.Unsafe<ResearchConnectorHit>({ type: "object" })),
	failures: Type.Array(Type.Unsafe<ResearchConnectorFailure>({ type: "object" })),
	connectors: Type.Array(Type.String()),
	complete: Type.Boolean(),
});

/** Host boundary for provenance-aware, read-only research capture and search. */
export const ResearchContract = defineDomain("research", {
	methods: {
		captureResource: { args: Type.Tuple([Input]), result: Result<ResearchCaptureResult>() },
		approveCapture: { args: Type.Tuple([IdInput]), result: Result<ResearchCaptureRecord>() },
		revokeCapture: { args: Type.Tuple([IdInput]), result: Result<ResearchCaptureRecord>() },
		listCaptures: { args: Type.Union([Type.Tuple([]), Type.Tuple([ListInput])]), result: ListResult },
		searchResources: { args: Type.Tuple([SearchInput]), result: SearchResult },
	},
	events: {},
});

export type ResearchApi = import("./define").ClientOf<typeof ResearchContract>;
