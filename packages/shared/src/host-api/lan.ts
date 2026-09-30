import { type Static, Type } from "typebox";
import { defineDomain } from "./define";

/** Shared LAN observer status returned by desktop IPC and the read-only HTTP projection. */
export const LanStatusSchema = Type.Object(
	{
		enabled: Type.Boolean(),
		port: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
		urls: Type.Array(Type.String()),
		qrDataUrl: Type.Union([Type.String(), Type.Null()]),
		clients: Type.Integer({ minimum: 0 }),
		remoteControl: Type.Boolean(),
	},
	{ additionalProperties: false },
);

/** TypeScript view derived from the runtime Host API schema. */
export type LanStatus = Static<typeof LanStatusSchema>;

/**
 * LAN observer host API. The status projection is safe for a read-only LAN
 * adapter; local observer and remote-control toggles remain desktop-only.
 *
 * The HTTP observer intentionally remains GET-only. This contract is shared
 * by the desktop IPC adapter now and can be projected to GET/SSE transports
 * later without adding a write endpoint to the LAN server.
 */
export const LanContract = defineDomain("lan", {
	methods: {
		getStatus: {
			args: Type.Tuple([]),
			result: Type.Unsafe<LanStatus>(LanStatusSchema),
			access: "lan-read",
		},
		setEnabled: {
			args: Type.Tuple([Type.Boolean()]),
			result: Type.Unsafe<LanStatus>(LanStatusSchema),
			access: "desktop",
		},
		setRemoteControl: {
			args: Type.Tuple([Type.Boolean()]),
			result: Type.Unsafe<LanStatus>(LanStatusSchema),
			access: "desktop",
		},
	},
});

export type LanSchemaTypes = {
	getStatus: [];
	setEnabled: [enabled: boolean];
	setRemoteControl: [enabled: boolean];
};
