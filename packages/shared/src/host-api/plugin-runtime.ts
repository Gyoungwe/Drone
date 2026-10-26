import { Type } from "typebox";
import { defineDomain } from "./define";

/** Identity and scope belong to the main-issued binding, never the input payload. */
export const PluginRuntimeContract = defineDomain("pluginRuntime", {
	methods: {
		invoke: {
			args: Type.Tuple([Type.String({ minLength: 1 }), Type.String({ minLength: 1 }), Type.Unknown()]),
			result: Type.Unknown(),
		},
	},
	events: {},
});
