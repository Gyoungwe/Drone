import { type Static, Type } from "typebox";
import { defineDomain } from "./define";

/** 本项目观察记忆状态：开关、条数、最近一次注入新会话的条数。 */
export const MemoryProjectStatusSchema = Type.Object(
	{
		enabled: Type.Boolean(),
		count: Type.Integer({ minimum: 0 }),
		lastLoaded: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);
export type MemoryProjectStatus = Static<typeof MemoryProjectStatusSchema>;

const status = Type.Unsafe<MemoryProjectStatus>(MemoryProjectStatusSchema);

/** 观察记忆 Host API（按项目目录）：读状态、开关捕获与注入、清空。 */
export const MemoryContract = defineDomain("memory", {
	methods: {
		getStatus: { args: Type.Tuple([Type.String()]), result: status, access: "desktop" },
		setEnabled: { args: Type.Tuple([Type.String(), Type.Boolean()]), result: status, access: "desktop" },
		clear: { args: Type.Tuple([Type.String()]), result: status, access: "desktop" },
	},
});
