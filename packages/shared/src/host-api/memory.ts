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

/** 一条观察记忆（设置里的列表项）。 */
export const MemoryListItemSchema = Type.Object(
	{
		id: Type.Integer({ minimum: 1 }),
		kind: Type.String(),
		title: Type.String(),
		body: Type.String(),
		createdAt: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);
export type MemoryListItem = Static<typeof MemoryListItemSchema>;
const items = Type.Unsafe<MemoryListItem[]>(Type.Array(MemoryListItemSchema));

/** 观察记忆 Host API（按项目目录）：读状态、开关捕获与注入、清空、列表、删除、提升。 */
export const MemoryContract = defineDomain("memory", {
	methods: {
		getStatus: { args: Type.Tuple([Type.String()]), result: status, access: "desktop" },
		setEnabled: { args: Type.Tuple([Type.String(), Type.Boolean()]), result: status, access: "desktop" },
		clear: { args: Type.Tuple([Type.String()]), result: status, access: "desktop" },
		/** 最近的观察（最多 50 条）。 */
		list: { args: Type.Tuple([Type.String()]), result: items, access: "desktop" },
		/** 删除一条观察。 */
		remove: { args: Type.Tuple([Type.String(), Type.Integer()]), result: status, access: "desktop" },
		/** 提升为项目记忆：写入 <cwd>/.pi/memory/（可进 git 审阅），并从观察记忆移除以免重复注入。 */
		promote: { args: Type.Tuple([Type.String(), Type.Integer()]), result: status, access: "desktop" },
	},
});
