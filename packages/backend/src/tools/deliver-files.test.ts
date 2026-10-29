import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverFilesParams, makeDeliverFilesTool } from "@gyoungwe/pi-core/host";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

describe("deliver_files tool (P17)", () => {
	it("has a bounded schema", () => {
		expect(Value.Check(deliverFilesParams, { files: [{ path: "a.pdf", title: "t" }] })).toBe(true);
		expect(Value.Check(deliverFilesParams, { files: [] })).toBe(false);
		expect(
			Value.Check(deliverFilesParams, { files: Array.from({ length: 13 }, () => ({ path: "a" })) }),
		).toBe(false);
	});
	it("returns metadata for existing files and fails on missing ones", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "drone-deliver-"));
		writeFileSync(join(cwd, "report.pdf"), "pdf");
		const tool = makeDeliverFilesTool();
		const ok = await tool.execute(
			"1",
			{ files: [{ path: "report.pdf", description: "汇总" }] },
			undefined,
			undefined,
			{ cwd } as never,
		);
		expect((ok.details as { files: unknown }).files).toEqual([
			{ path: join(cwd, "report.pdf"), title: "report.pdf", description: "汇总", bytes: 3 },
		]);
		await expect(
			tool.execute("2", { files: [{ path: "nope.csv" }] }, undefined, undefined, { cwd } as never),
		).rejects.toThrow("nope.csv");
	});
});
