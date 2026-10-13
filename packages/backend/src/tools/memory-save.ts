import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { forgetMemory, writeMemory } from "../project/memory";

export const MEMORY_SAVE_TOOL = "memory_save";

const memorySaveParams = Type.Object({
	action: Type.Optional(
		Type.Union([Type.Literal("save"), Type.Literal("forget")], {
			description:
				'Default "save". Use "forget" with `file` to undo a memory you just saved when the user asks.',
		}),
	),
	type: Type.Optional(
		Type.Union([Type.Literal("feedback"), Type.Literal("user")], {
			description:
				'"feedback" = how the user wants work done (e.g. citation style GB/T 7714); "user" = stable facts about the user. Other types are not writable.',
		}),
	),
	name: Type.Optional(Type.String({ maxLength: 80, description: "Short title of the memory." })),
	description: Type.Optional(
		Type.String({ maxLength: 200, description: "One-line summary used in MEMORY.md." }),
	),
	body: Type.Optional(
		Type.String({ maxLength: 2000, description: "The preference or fact, stated plainly." }),
	),
	file: Type.Optional(
		Type.String({ maxLength: 120, description: 'File returned by a previous save (for "forget").' }),
	),
});

export interface MemorySaveDetails {
	action: "save" | "forget";
	file: string;
	name?: string;
	removed?: boolean;
}

/** H2：模型自写项目记忆。只写 feedback/user，只在受信任项目开放；结果首行「已记住：…」，可用 forget 撤销。 */
export function makeMemorySaveTool(): ToolDefinition<typeof memorySaveParams> {
	return {
		name: MEMORY_SAVE_TOOL,
		label: "Memory",
		description:
			"Remember a durable user preference or fact in this project's .pi/memory (only types feedback/user). Call only when the user states a lasting preference or explicitly asks you to remember something; never for task state. Only available in trusted projects.",
		parameters: memorySaveParams,
		execute: async (_id, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<MemorySaveDetails>> => {
			if (!ctx.isProjectTrusted()) throw new Error("memory_save is only available in trusted projects");
			if (params.action === "forget") {
				if (!params.file) throw new Error('"forget" needs `file`');
				const removed = forgetMemory(ctx.cwd, params.file);
				return {
					content: [
						{ type: "text", text: removed ? `已撤销记忆：${params.file}` : `未找到记忆：${params.file}` },
					],
					details: { action: "forget", file: params.file, removed },
				};
			}
			const type = params.type;
			const name = params.name?.trim();
			const body = params.body?.trim();
			if (type !== "feedback" && type !== "user") throw new Error('type must be "feedback" or "user"');
			if (!name || !body) throw new Error("`name` and `body` are required");
			const file = writeMemory(ctx.cwd, {
				type,
				name,
				description: params.description?.trim() || name,
				body,
			});
			return {
				content: [{ type: "text", text: `已记住：${name}\n(file: ${file}; undo with action "forget")` }],
				details: { action: "save", file, name },
			};
		},
	};
}
