import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeSourceLinks, onlineSourceLink } from "../src/source-links";

let root: string;
let cwd: string;
let vault: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-source-links-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	await mkdir(cwd);
	await mkdir(join(vault, "Library/Papers"), { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("source links", () => {
	it("normalizes local, DOI, Vault, Zotero and unresolved references", async () => {
		const resultsRoot = join(cwd, "results");
		const runDir = join(resultsRoot, "topic");
		await mkdir(runDir, { recursive: true });
		await writeFile(join(runDir, "source with spaces.txt"), "Fixture");
		await writeFile(join(vault, "Library/Papers/source.md"), "# Fixture");
		const result = await normalizeSourceLinks(
			[
				"results/topic/source with spaces.txt",
				"10.1093/example",
				"Library/Papers/source",
				"zotero:ABCD1234",
				"/etc/passwd",
				"fixture:unresolved",
			],
			{ cwd, vault, resultsRoot, project: "project-a" },
		);
		expect(result.links[0]).toContain("file:///");
		expect(result.links[0]).toContain("source%20with%20spaces.txt");
		expect(result.links[1]).toContain("https://doi.org/10.1093/example");
		expect(result.links[2]).toBe("[[Library/Papers/source]]");
		expect(result.links[3]).toBe("[Zotero ABCD1234](zotero://select/library/items/ABCD1234)");
		expect(result.unresolved).toEqual(["/etc/passwd", "fixture:unresolved"]);
		expect(result.links[4]).not.toContain("file:");
	});

	it("rejects credential URLs and cross-project notes", async () => {
		const options = { cwd, vault, resultsRoot: join(cwd, "results"), project: "project-a" };
		await expect(normalizeSourceLinks(["https://user:password@example.invalid"], options)).rejects.toThrow(
			"credential-free",
		);
		await expect(normalizeSourceLinks(["Projects/other/Evidence/note"], options)).rejects.toThrow("scope");
	});

	it("bounds online labels and rejects unsafe URL schemes", () => {
		expect(onlineSourceLink("https://example.invalid/a", "[safe] <title>")).toBe(
			"[ safe   title ](<https://example.invalid/a>)",
		);
		expect(() => onlineSourceLink("file:///etc/passwd")).toThrow("credential-free");
	});

	it("does not turn a symlink outside results into a file link", async () => {
		const resultsRoot = join(cwd, "results");
		const external = join(root, "external.txt");
		await mkdir(resultsRoot);
		await writeFile(external, "outside");
		await symlink(external, join(resultsRoot, "outside.txt"));
		const result = await normalizeSourceLinks(["results/outside.txt"], {
			cwd,
			vault,
			resultsRoot,
			project: "project-a",
		});
		expect(result.unresolved).toEqual(["results/outside.txt"]);
		expect(result.links[0]).toContain("unresolved reference");
	});
});
