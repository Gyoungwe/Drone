import { describe, expect, it } from "vitest";
import { parseNotebook } from "./notebook-preview";

const nb = {
	metadata: { kernelspec: { language: "python" } },
	cells: [
		{ cell_type: "markdown", source: ["# Title\n", "text"] },
		{
			cell_type: "code",
			execution_count: 3,
			source: "print(1)",
			outputs: [
				{ output_type: "stream", text: ["1\n"] },
				{ output_type: "display_data", data: { "image/png": "iVBORw0K\n" } },
				{ output_type: "error", ename: "ValueError", evalue: "bad" },
				{ output_type: "unknown" },
			],
		},
	],
};

describe("notebook preview", () => {
	it("parses cells and outputs without executing anything", () => {
		const p = parseNotebook(JSON.stringify(nb));
		expect(p.language).toBe("python");
		expect(p.cells[0]).toMatchObject({ type: "markdown", source: "# Title\ntext" });
		expect(p.cells[1]?.executionCount).toBe(3);
		expect(p.cells[1]?.outputs.map((o) => o.kind)).toEqual(["text", "image", "error"]);
		expect(p.cells[1]?.outputs[1]?.png).toBe("iVBORw0K");
		expect(p.cells[1]?.outputs[2]?.text).toBe("ValueError: bad");
	});
	it("throws on truncated json so the UI can fall back to source", () => {
		expect(() => parseNotebook(JSON.stringify(nb).slice(0, 40))).toThrow();
		expect(() => parseNotebook("{}")).toThrow(/cells/);
	});
	it("clips very large notebooks", () => {
		const big = { cells: Array.from({ length: 250 }, () => ({ cell_type: "code", source: "x" })) };
		const p = parseNotebook(JSON.stringify(big));
		expect(p.cells).toHaveLength(200);
		expect(p.clipped).toBe(true);
	});
});
