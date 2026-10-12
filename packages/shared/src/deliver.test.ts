import { describe, expect, it } from "vitest";
import { collectDeliveries, parseDeliveryArgs } from "./deliver";
import type { UIMessage } from "./transcript/types";

const tool = (args: unknown, state: "done" | "error" = "done") => ({
	key: "k",
	id: "i",
	name: "deliver_files",
	args: JSON.stringify(args),
	output: "",
	state,
});
const msg = (tools: ReturnType<typeof tool>[]) =>
	({ kind: "assistant", id: "a", text: "", thinking: "", tools, timestamp: 0 }) as UIMessage;

describe("deliver_files (P17)", () => {
	it("parses args with defaults", () => {
		expect(
			parseDeliveryArgs(
				'{"files":[{"path":"out/report.pdf"},{"path":"a.csv","title":" 计数 ","description":"DESeq2"},{"title":"x"}]}',
			),
		).toEqual([
			{ path: "out/report.pdf", title: "report.pdf" },
			{ path: "a.csv", title: "计数", description: "DESeq2" },
		]);
		expect(parseDeliveryArgs('{"files":[{"pa')).toEqual([]);
	});
	it("collects successful deliveries, newest first, deduped by path", () => {
		const list = collectDeliveries([
			msg([tool({ files: [{ path: "a.pdf" }, { path: "b.csv" }] })]),
			msg([tool({ files: [{ path: "c.png" }] }, "error")]),
			msg([tool({ files: [{ path: "a.pdf", title: "v2" }] })]),
		]);
		expect(list.map((f) => f.title)).toEqual(["v2", "b.csv"]);
	});
});
