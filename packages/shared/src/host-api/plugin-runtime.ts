import { type Static, Type } from "typebox";
import { defineDomain } from "./define";

export const PluginRuntimeEventSchema = Type.Object({
	binding: Type.String({ minLength: 1 }),
	selectionToken: Type.String({ minLength: 1 }),
	type: Type.Literal("changed"),
	revision: Type.Integer({ minimum: 1 }),
});
export type PluginRuntimeEvent = Static<typeof PluginRuntimeEventSchema>;

/** Identity and scope belong to the main-issued binding, never the input payload. */
export const PluginRuntimeContract = defineDomain("pluginRuntime", {
	methods: {
		selectSession: {
			args: Type.Tuple([Type.Union([Type.String({ minLength: 1 }), Type.Null()])]),
			result: Type.String({ minLength: 1 }),
		},
		invoke: {
			args: Type.Tuple([
				Type.String({ minLength: 1 }),
				Type.String({ minLength: 1 }),
				Type.Unknown(),
				Type.String({ minLength: 1 }),
			]),
			result: Type.Unknown(),
		},
	},
	events: { changed: PluginRuntimeEventSchema },
});
