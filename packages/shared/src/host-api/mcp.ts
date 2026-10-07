import { Type } from "typebox";
import type { McpConfigSnapshot, McpPreset, McpStatus } from "../mcp";
import { defineDomain } from "./define";

const OptionalCwdArgs = Type.Union([
	Type.Tuple([]),
	Type.Tuple([Type.Union([Type.String(), Type.Undefined()])]),
]);

const ServerStatusSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		status: Type.Union([
			Type.Literal("connected"),
			Type.Literal("cached"),
			Type.Literal("failed"),
			Type.Literal("needs-auth"),
			Type.Literal("not-connected"),
			Type.Literal("disabled"),
			Type.Literal("blocked"),
		]),
		toolCount: Type.Integer({ minimum: 0 }),
		directToolCount: Type.Optional(Type.Integer({ minimum: 0 })),
		resourceCount: Type.Optional(Type.Integer({ minimum: 0 })),
		failedAgoSeconds: Type.Optional(Type.Number({ minimum: 0 })),
		disabled: Type.Boolean(),
		listenState: Type.Optional(Type.String()),
		catalogStale: Type.Optional(Type.Boolean()),
		blockedReason: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const StatusSchema = Type.Object(
	{
		version: Type.Literal(1),
		servers: Type.Array(ServerStatusSchema),
		totalTools: Type.Integer({ minimum: 0 }),
		totalResources: Type.Integer({ minimum: 0 }),
		connectedCount: Type.Integer({ minimum: 0 }),
		disabledCount: Type.Integer({ minimum: 0 }),
		runtime: Type.Optional(
			Type.Union([Type.Literal("missing"), Type.Literal("starting"), Type.Literal("running")]),
		),
	},
	{ additionalProperties: false },
);

const ConfigServerSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		transport: Type.Union([
			Type.Literal("stdio"),
			Type.Literal("http"),
			Type.Literal("socket"),
			Type.Literal("unknown"),
		]),
		command: Type.Optional(Type.String()),
		url: Type.Optional(Type.String()),
		disabled: Type.Boolean(),
		scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
		sourcePath: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

const ConfigSchema = Type.Object(
	{
		path: Type.String({ minLength: 1 }),
		cwd: Type.Union([Type.String(), Type.Null()]),
		servers: Type.Array(ConfigServerSchema),
	},
	{ additionalProperties: false },
);

/** MCP status/configuration host API. Mutations remain desktop-only. */
export const McpContract = defineDomain("mcp", {
	methods: {
		getStatus: {
			args: OptionalCwdArgs,
			result: Type.Unsafe<McpStatus>(StatusSchema),
		},
		getConfig: {
			args: OptionalCwdArgs,
			result: Type.Unsafe<McpConfigSnapshot>(ConfigSchema),
		},
		setServerEnabled: {
			args: Type.Union([
				Type.Tuple([Type.String({ minLength: 1 }), Type.Boolean()]),
				Type.Tuple([
					Type.String({ minLength: 1 }),
					Type.Boolean(),
					Type.Union([Type.String(), Type.Undefined()]),
				]),
			]),
			result: Type.Unsafe<McpConfigSnapshot>(ConfigSchema),
		},
		openConfig: {
			args: OptionalCwdArgs,
			result: Type.Void(),
		},
		addPreset: {
			args: Type.Tuple([Type.Union([Type.Literal("playwright"), Type.Literal("playwright-chrome")])]),
			result: Type.Unsafe<McpConfigSnapshot>(ConfigSchema),
		},
	},
});

export type McpSchemaTypes = {
	getStatus: [cwd?: string];
	getConfig: [cwd?: string];
	setServerEnabled: [name: string, enabled: boolean, cwd?: string];
	openConfig: [cwd?: string];
	addPreset: [id: McpPreset["id"]];
};

export type { McpConfigSnapshot, McpStatus };
