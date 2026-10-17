import { stat } from "node:fs/promises";
import { MAX_DELIVERED_FILES } from "@drone/shared";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveToolPath } from "../path";

export const deliverFilesParams = Type.Object({
	files: Type.Array(
		Type.Object({
			path: Type.String({
				minLength: 1,
				description: "File path: absolute, relative to the working directory, or ~",
			}),
			title: Type.Optional(
				Type.String({ maxLength: 120, description: "Short title shown on the delivery card" }),
			),
			description: Type.Optional(
				Type.String({ maxLength: 400, description: "One-sentence summary of the file" }),
			),
		}),
		{ minItems: 1, maxItems: MAX_DELIVERED_FILES },
	),
});

export interface DeliverFilesDetails {
	files: Array<{ path: string; title: string; description?: string; bytes: number }>;
}

/**
 * P17：交付工具。只校验文件存在并回传元数据（不读内容），UI 据此渲染横向交付卡，点击在右栏 PreviewHost 打开。
 */
export function makeDeliverFilesTool(): ToolDefinition<typeof deliverFilesParams> {
	return {
		name: "deliver_files",
		label: "Deliver Files",
		description:
			"Hand finished deliverables (reports, figures, tables, notebooks) to the user as cards they can open. Call once at the end of a task with the final files only — not intermediate or scratch files.",
		promptSnippet: "deliver_files({files:[{path,title,description}]})",
		parameters: deliverFilesParams,
		execute: async (_id, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<DeliverFilesDetails>> => {
			const files: DeliverFilesDetails["files"] = [];
			const missing: string[] = [];
			for (const f of params.files) {
				const path = resolveToolPath(f.path, ctx.cwd);
				const info = await stat(path).catch(() => null);
				if (!info?.isFile()) {
					missing.push(f.path);
					continue;
				}
				files.push({
					path,
					title: f.title?.trim() || (path.split(/[\\/]/).pop() ?? path),
					...(f.description ? { description: f.description } : {}),
					bytes: info.size,
				});
			}
			if (missing.length) throw new Error(`deliver_files: not found or not a file: ${missing.join(", ")}`);
			return {
				content: [
					{
						type: "text",
						text: `Delivered ${files.length} file(s) to the user: ${files.map((f) => f.title).join(", ")}`,
					},
				],
				details: { files },
			};
		},
	};
}
