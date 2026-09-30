import { Type } from "typebox";
import type { PromptReceipt } from "../ipc";
import type { CreateSessionOptions, ImageInput, SessionEvent, SessionMeta } from "../session";
import { defineDomain } from "./define";

const CreateSessionOptionsSchema = Type.Object(
	{
		cwd: Type.String({ minLength: 1 }),
		provider: Type.Optional(Type.String({ minLength: 1 })),
		modelId: Type.Optional(Type.String({ minLength: 1 })),
		thinkingLevel: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);

const ImageInputSchema = Type.Object(
	{
		data: Type.String(),
		mimeType: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

const SessionMetaSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		cwd: Type.String({ minLength: 1 }),
		active: Type.Boolean(),
		messageCount: Type.Integer({ minimum: 0 }),
		createdAt: Type.Number(),
		sessionFile: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
		modelLabel: Type.Optional(Type.String()),
		model: Type.Optional(
			Type.Union([
				Type.Null(),
				Type.Object(
					{ provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }) },
					{ additionalProperties: false },
				),
			]),
		),
		thinkingLevel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		readOnly: Type.Optional(Type.Boolean()),
		modifiedAt: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

const PromptReceiptSchema = Type.Unsafe<PromptReceipt>({ type: "object" });
const SessionEventSchema = Type.Unsafe<SessionEvent>({ type: "object" });

/**
 * Initial sessions domain contract. Additional session methods can be migrated
 * incrementally without changing the generated client shape for these methods.
 */
export const SessionsContract = defineDomain("sessions", {
	methods: {
		create: {
			args: Type.Tuple([CreateSessionOptionsSchema]),
			result: Type.Unsafe<SessionMeta>(SessionMetaSchema),
			access: "desktop",
		},
		prompt: {
			args: Type.Tuple([
				Type.String({ minLength: 1 }),
				Type.String(),
				Type.Optional(Type.Array(ImageInputSchema)),
			]),
			result: PromptReceiptSchema,
			access: "desktop",
		},
		list: {
			// TypeBox 1.3 keeps tuple minItems=1 even when the only item is
			// optional; model the zero/one argument forms explicitly so the
			// contract accepts the existing listSessions() call site.
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.String({ minLength: 1 })])]),
			result: Type.Array(Type.Unsafe<SessionMeta>(SessionMetaSchema)),
			access: "lan-read",
		},
	},
	events: {
		event: SessionEventSchema,
	},
});

/** Keep schemas available to migration code without making them part of the public client. */
export type SessionsSchemaTypes = {
	create: CreateSessionOptions;
	prompt: [sessionId: string, text: string, images?: ImageInput[]];
	list: [cwd?: string];
};
