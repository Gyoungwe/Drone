import { Type } from "typebox";
import type { ResearchCaptureRecord, ResearchCaptureResult } from "../research-capture";
import type {
	ResearchConnectorDescriptor,
	ResearchConnectorFailure,
	ResearchConnectorHit,
} from "../research-connectors";
import type { ResearchWriteAdapterDescriptor, ResearchWriteAuditRecord, ResearchWritePlan, ResearchWriteReceipt } from "../research-writes";
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
		cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
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
const ConnectorListResult = Type.Object({
	connectors: Type.Array(Type.Unsafe<ResearchConnectorDescriptor>({ type: "object" })),
});
const ConnectorToggleInput = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 64 }),
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const WriteInput = Type.Object(
	{
		adapterId: Type.String({ minLength: 1, maxLength: 64 }),
		targetRef: Type.String({ minLength: 1, maxLength: 512 }),
		payload: Type.Object(
			{
				title: Type.String({ minLength: 1, maxLength: 500 }),
				doi: Type.Optional(Type.String({ maxLength: 256 })),
				authors: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 64 })),
				abstract: Type.Optional(Type.String({ maxLength: 8000 })),
			},
			{ additionalProperties: false },
		),
		action: Type.Union([Type.Literal("dry-run"), Type.Literal("prepare")]),
	},
	{ additionalProperties: false },
);
const WriteExecuteInput = Type.Object(
	{ planId: Type.String({ minLength: 1, maxLength: 128 }), approved: Type.Boolean() },
	{ additionalProperties: false },
);
const WritePlanInput = Type.Object(
	{ planId: Type.String({ minLength: 1, maxLength: 128 }) },
	{ additionalProperties: false },
);

/** Host boundary for provenance-aware research capture/search and explicit write plans. */
export const ResearchContract = defineDomain("research", {
	methods: {
		captureResource: { args: Type.Tuple([Input]), result: Result<ResearchCaptureResult>() },
		approveCapture: { args: Type.Tuple([IdInput]), result: Result<ResearchCaptureRecord>() },
		revokeCapture: { args: Type.Tuple([IdInput]), result: Result<ResearchCaptureRecord>() },
		listCaptures: { args: Type.Union([Type.Tuple([]), Type.Tuple([ListInput])]), result: ListResult },
		searchResources: { args: Type.Tuple([SearchInput]), result: SearchResult },
		listConnectors: { args: Type.Tuple([]), result: ConnectorListResult },
		setConnectorEnabled: {
			args: Type.Tuple([ConnectorToggleInput]),
			result: Result<ResearchConnectorDescriptor>(),
		},
		listWriteAdapters: { args: Type.Tuple([]), result: Type.Object({ adapters: Type.Array(Type.Unsafe<ResearchWriteAdapterDescriptor>({ type: "object" })) }) },
		prepareWrite: { args: Type.Tuple([WriteInput]), result: Result<ResearchWritePlan>() },
		executeWrite: { args: Type.Tuple([WriteExecuteInput]), result: Result<ResearchWriteReceipt>() },
		revokeWrite: { args: Type.Tuple([WritePlanInput]), result: Type.Object({ revoked: Type.Boolean() }) },
		listWriteAudit: { args: Type.Tuple([]), result: Type.Object({ items: Type.Array(Type.Unsafe<ResearchWriteAuditRecord>({ type: "object" })) }) },
	},
	events: {},
});

export type ResearchApi = import("./define").ClientOf<typeof ResearchContract>;
