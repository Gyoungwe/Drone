import { Type } from "typebox";
import { PLUGIN_EVENTS } from "./native-events";

export const nativeDeclarationsSchema = Type.Object({
	tools: Type.Array(
		Type.Object({
			name: Type.String({ minLength: 1 }),
			label: Type.String(),
			description: Type.String(),
			parameters: Type.Record(Type.String(), Type.Unknown()),
			outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			constrainedSampling: Type.Optional(
				Type.Union([Type.Literal(false), Type.Record(Type.String(), Type.Unknown())]),
			),
			renderShell: Type.Optional(Type.Union([Type.Literal("default"), Type.Literal("self")])),
			promptSnippet: Type.Optional(Type.String()),
			promptGuidelines: Type.Optional(Type.Array(Type.String())),
			exposure: Type.Optional(
				Type.Union(
					["direct", "model-only", "codemode", "deferred", "hidden"].map((value) => Type.Literal(value)),
				),
			),
			namespace: Type.Optional(
				Type.Object({
					name: Type.String(),
					description: Type.Optional(Type.String()),
					instructions: Type.Optional(Type.String()),
				}),
			),
			annotations: Type.Optional(
				Type.Object({
					readOnlyHint: Type.Optional(Type.Boolean()),
					destructiveHint: Type.Optional(Type.Boolean()),
					idempotentHint: Type.Optional(Type.Boolean()),
					openWorldHint: Type.Optional(Type.Boolean()),
				}),
			),
			defaultActive: Type.Optional(Type.Boolean()),
			executionMode: Type.Optional(Type.Union([Type.Literal("sequential"), Type.Literal("parallel")])),
			drone: Type.Optional(Type.Unknown()),
		}),
	),
	commands: Type.Array(
		Type.Object(
			{ name: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) },
			{ additionalProperties: false },
		),
	),
	effects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	commandEffects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	eventEffects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	factOwner: Type.Optional(Type.Literal(true)),
	nativeOperations: Type.Record(
		Type.String(),
		Type.Object(
			{
				event: Type.Union([Type.Literal("message_start"), Type.Literal("tool_execution_end")]),
				inputSchema: Type.Record(Type.String(), Type.Unknown()),
				resultSchema: Type.Record(Type.String(), Type.Unknown()),
				effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
			},
			{ additionalProperties: false },
		),
	),
	projection: Type.Optional(
		Type.Object(
			{ finalize: Type.Boolean(), effect: Type.Union([Type.Literal("read"), Type.Literal("write")]) },
			{ additionalProperties: false },
		),
	),
	events: Type.Array(
		Type.Object({
			name: Type.Union(PLUGIN_EVENTS.map((name) => Type.Literal(name))),
			index: Type.Integer({ minimum: 0 }),
		}),
	),
});

export const nativeCallResponseSchema = Type.Object(
	{
		value: Type.Unknown(),
		references: Type.Object(
			{
				message: Type.Optional(Type.String()),
				messages: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Null()]))),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);

export const nativeSnapshotResponseSchema = Type.Object(
	{ messages: Type.Array(Type.Unknown()) },
	{ additionalProperties: false },
);

const jsonValueSchema = Type.Cyclic(
	{
		Json: Type.Union([
			Type.Null(),
			Type.Boolean(),
			Type.Number(),
			Type.String(),
			Type.Array(Type.Ref("Json")),
			Type.Record(Type.String(), Type.Ref("Json")),
		]),
	},
	"Json",
);
export const beforeAgentStartResponseSchema = Type.Object(
	{
		systemPromptOptions: Type.Record(Type.String(), jsonValueSchema),
		result: Type.Union([Type.Null(), Type.Record(Type.String(), jsonValueSchema)]),
	},
	{ additionalProperties: false },
);

export const nativeToolCallResponseSchema = Type.Object(
	{
		input: Type.Record(Type.String(), jsonValueSchema),
		result: Type.Union([
			Type.Null(),
			Type.Object(
				{
					block: Type.Optional(Type.Boolean()),
					reason: Type.Optional(Type.String()),
					terminate: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: false },
			),
		]),
	},
	{ additionalProperties: false },
);

export const nativeInputResponseSchema = Type.Union([
	Type.Null(),
	Type.Object({ action: Type.Literal("continue") }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("handled") }, { additionalProperties: false }),
	Type.Object(
		{
			action: Type.Literal("transform"),
			text: Type.String(),
			images: Type.Optional(
				Type.Array(
					Type.Object(
						{ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() },
						{ additionalProperties: false },
					),
				),
			),
		},
		{ additionalProperties: false },
	),
]);

export const nativeTurnEndResponseSchema = Type.Union([
	Type.Null(),
	Type.Object({ continue: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
]);
