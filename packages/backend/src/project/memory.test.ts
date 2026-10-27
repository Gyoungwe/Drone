import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listMemories,
	memoryDir,
	memoryIndexPrompt,
	parseMemory,
	serializeMemory,
	writeMemory,
} from "@gyoungwe/pi-core/host";
import { describe, expect, it } from "vitest";

describe("project memory (P12)", () => {
	it("round-trips typed memory files", () => {
		const e = {
			name: "偏好 DESeq2",
			description: "差异分析默认用 DESeq2",
			type: "feedback" as const,
			body: "原因：…",
		};
		expect(parseMemory(serializeMemory(e))).toEqual(e);
		expect(parseMemory("---\r\nname: x\r\ntype: user\r\n---\r\nhi")).toEqual({
			name: "x",
			description: "",
			type: "user",
			body: "hi",
		});
		expect(parseMemory("---\nname: x\ntype: secret\n---\n")).toBeNull();
		expect(parseMemory("no frontmatter")).toBeNull();
	});
	it("writes files, rebuilds the index and injects only the index", () => {
		const cwd = mkdtempSync(join(tmpdir(), "drone-mem-"));
		expect(memoryIndexPrompt(cwd)).toEqual([]);
		const f1 = writeMemory(cwd, {
			name: "Lab cluster",
			description: "SLURM on hpc01",
			type: "reference",
			body: "ssh hpc01",
		});
		writeMemory(cwd, { name: "Role", description: "生信博士后", type: "user", body: "…" });
		writeMemory(cwd, {
			name: "Lab cluster",
			description: "SLURM on hpc02",
			type: "reference",
			body: "ssh hpc02",
		});
		expect(f1).toBe("reference_lab-cluster.md");
		expect(listMemories(cwd)).toHaveLength(2);
		const index = readFileSync(join(memoryDir(cwd), "MEMORY.md"), "utf8");
		expect(index.indexOf("Role")).toBeLessThan(index.indexOf("Lab cluster"));
		const prompt = memoryIndexPrompt(cwd).join("\n");
		expect(prompt).toContain("SLURM on hpc02");
		expect(prompt).not.toContain("ssh hpc02");
	});
});
