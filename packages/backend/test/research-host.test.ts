import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createResearchHostPort } from "../src/research-host";

describe("research host file port", () => {
	it("reads and lists only files inside the granted root", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-host-"));
		await mkdir(join(root, "slug", "run-1"), { recursive: true });
		await writeFile(join(root, "slug", "run-1", "metadata.json"), "{}", "utf8");
		const port = createResearchHostPort();
		const granted = await port.resolveRoot(root);
		expect(await port.readText(granted.handle, "slug/run-1/metadata.json")).toBe("{}");
		expect(await port.listFiles(granted.handle, "slug")).toEqual([{ name: "run-1", kind: "directory" }]);
	});

	it("rejects traversal and absolute paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-host-"));
		const port = createResearchHostPort();
		const granted = await port.resolveRoot(root);
		await expect(port.readText(granted.handle, "../outside.txt")).rejects.toThrow(/escapes/);
		await expect(port.listFiles(granted.handle, "/tmp")).rejects.toThrow(/relative/);
	});
});
