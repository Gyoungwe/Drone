import { Type } from "typebox";
import { type ClientOf, defineDomain } from "./define";

/**
 * One credential slot an installed managed plugin declares in `drone.credentials`, as the settings
 * page shows it (docs/superpowers/specs/2026-11-06-plugin-credentials-design.md). Never the secret.
 */
export interface PluginCredentialEntry {
	pluginId: string;
	slot: string;
	label: { zh: string; en: string };
	hosts: string[];
	/** Non-secret values saved with the secret, such as a library id. */
	fields: string[];
	configured: boolean;
	values: Record<string, string>;
}

const Id = Type.String({ minLength: 1, maxLength: 256 });
const Slot = Type.String({ minLength: 1, maxLength: 64 });
const Entry = Type.Object(
	{
		pluginId: Id,
		slot: Slot,
		label: Type.Object({ zh: Type.String(), en: Type.String() }, { additionalProperties: false }),
		hosts: Type.Array(Type.String()),
		fields: Type.Array(Type.String()),
		configured: Type.Boolean(),
		values: Type.Record(Type.String(), Type.String()),
	},
	{ additionalProperties: false },
);

/** Settings page access to the secrets the host keeps for managed plugins. */
export const PluginCredentialsContract = defineDomain("pluginCredentials", {
	methods: {
		listPluginCredentials: {
			args: Type.Tuple([]),
			result: Type.Array(Type.Unsafe<PluginCredentialEntry>(Entry)),
		},
		savePluginCredential: {
			args: Type.Tuple([
				Type.Object(
					{
						pluginId: Id,
						slot: Slot,
						secret: Type.String({ minLength: 1, maxLength: 4096 }),
						fields: Type.Record(Type.String(), Type.String({ maxLength: 512 })),
					},
					{ additionalProperties: false },
				),
			]),
			result: Type.Void(),
		},
		clearPluginCredential: {
			args: Type.Tuple([Type.Object({ pluginId: Id, slot: Slot }, { additionalProperties: false })]),
			result: Type.Void(),
		},
	},
});

export type PluginCredentialsApi = ClientOf<typeof PluginCredentialsContract>;
