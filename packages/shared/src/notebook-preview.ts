/** Jupyter notebook 只读预览解析（P3）：只取渲染需要的字段，不执行任何代码。 */
export interface NotebookOutput {
	kind: "text" | "image" | "error";
	text?: string;
	/** image/png base64 */
	png?: string;
}
export interface NotebookCell {
	type: "markdown" | "code" | "raw";
	source: string;
	executionCount: number | null;
	outputs: NotebookOutput[];
}
export interface NotebookPreview {
	language: string;
	cells: NotebookCell[];
	clipped: boolean;
}
export const NOTEBOOK_MAX_CELLS = 200;
const OUTPUT_TEXT_LIMIT = 4000;

const joinSource = (value: unknown): string =>
	Array.isArray(value) ? value.join("") : typeof value === "string" ? value : "";

function parseOutput(raw: Record<string, unknown>): NotebookOutput | null {
	const type = raw.output_type;
	if (type === "stream") return { kind: "text", text: joinSource(raw.text).slice(0, OUTPUT_TEXT_LIMIT) };
	if (type === "error")
		return {
			kind: "error",
			text: `${raw.ename ?? "Error"}: ${raw.evalue ?? ""}`.slice(0, OUTPUT_TEXT_LIMIT),
		};
	if (type === "execute_result" || type === "display_data") {
		const data = (raw.data ?? {}) as Record<string, unknown>;
		if (typeof data["image/png"] === "string")
			return { kind: "image", png: String(data["image/png"]).trim() };
		if (data["text/plain"] !== undefined)
			return { kind: "text", text: joinSource(data["text/plain"]).slice(0, OUTPUT_TEXT_LIMIT) };
	}
	return null;
}

/** 解析失败（截断 / 非 JSON）抛错，调用方回退到源码视图。 */
export function parseNotebook(text: string): NotebookPreview {
	const doc = JSON.parse(text) as Record<string, unknown>;
	if (!doc || !Array.isArray(doc.cells)) throw new Error("not a Jupyter notebook (missing cells)");
	const meta = (doc.metadata ?? {}) as Record<string, Record<string, unknown> | undefined>;
	const language = String(meta.kernelspec?.language ?? meta.language_info?.name ?? "python");
	const cells: NotebookCell[] = [];
	for (const raw of (doc.cells as Record<string, unknown>[]).slice(0, NOTEBOOK_MAX_CELLS)) {
		const type = raw.cell_type === "markdown" || raw.cell_type === "raw" ? raw.cell_type : "code";
		const outputs = Array.isArray(raw.outputs)
			? (raw.outputs as Record<string, unknown>[]).map(parseOutput).filter((o): o is NotebookOutput => !!o)
			: [];
		cells.push({
			type,
			source: joinSource(raw.source),
			executionCount: typeof raw.execution_count === "number" ? raw.execution_count : null,
			outputs,
		});
	}
	return { language, cells, clipped: (doc.cells as unknown[]).length > NOTEBOOK_MAX_CELLS };
}
