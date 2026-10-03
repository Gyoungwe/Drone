import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	containedVaultFile,
	createVaultFileOnly,
	initializeProjectContext,
	initializeSharedNavigation,
	updateVaultNavigation,
} from "../src/layout";

let vault: string;

beforeEach(async () => {
	vault = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-layout-")));
});

afterEach(async () => {
	await rm(vault, { recursive: true, force: true });
});

describe("knowledge Vault layout", () => {
	it("initializes shared navigation without overwriting existing files", async () => {
		await initializeSharedNavigation(vault);
		const home = await readFile(join(vault, "Home.md"), "utf8");
		expect(home).toContain("[[Wiki/Index]]");
		expect(await readFile(join(vault, "Wiki/Index.md"), "utf8")).toContain("Research Wiki");

		await writeFile(join(vault, "Inbox/Index.md"), "# Human inbox\n", "utf8");
		await initializeSharedNavigation(vault);
		expect(await readFile(join(vault, "Inbox/Index.md"), "utf8")).toBe("# Human inbox\n");
	});

	it("creates a project context only for a canonical project slug", async () => {
		await initializeProjectContext(vault, "alpha-2");
		const context = await readFile(join(vault, "Projects/alpha-2/Context.md"), "utf8");
		expect(context).toContain('project: "alpha-2"');
		await expect(initializeProjectContext(vault, "../outside")).rejects.toThrow("Invalid project identifier");
	});

	it("updates only managed navigation content and keeps human text", async () => {
		await mkdir(vault, { recursive: true });
		await writeFile(
			join(vault, "Home.md"),
			"# My Vault\n\nHuman notes stay here.\n\n<!-- pi-agent:managed:start -->\nold\n<!-- pi-agent:managed:end -->\n",
			"utf8",
		);
		const result = await updateVaultNavigation(vault, "Home.md", "# Ignored", "- [[Wiki/Index]]");
		expect(result).toEqual({ path: "Home.md", changed: true });
		const home = await readFile(join(vault, "Home.md"), "utf8");
		expect(home).toContain("Human notes stay here.");
		expect(home).toContain("- [[Wiki/Index]]");
		expect(home).not.toContain("old");
	});

	it("rejects malformed navigation markers", async () => {
		await writeFile(join(vault, "Home.md"), "# Vault\n\n<!-- pi-agent:managed:start -->\n", "utf8");
		await expect(updateVaultNavigation(vault, "Home.md", "# Vault", "links")).rejects.toThrow(
			"Invalid navigation managed markers",
		);
	});

	it("keeps all initialization destinations inside the Vault", async () => {
		await expect(containedVaultFile(vault, "../outside.md")).rejects.toThrow("Path must stay inside Vault");
		const outside = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-outside-")));
		await symlink(outside, join(vault, "escape"));
		await expect(containedVaultFile(vault, "escape/Index.md")).rejects.toThrow("Path must stay inside Vault");
		await rm(outside, { recursive: true, force: true });
	});

	it("supports host-provided filesystem seams", async () => {
		const calls: string[] = [];
		await initializeProjectContext(vault, "alpha", {
			containedFile: async (root, path) => {
				calls.push(`contained:${path}`);
				return join(root, path);
			},
			createOnly: async (path) => {
				calls.push(`create:${path}`);
				return true;
			},
		});
		expect(calls).toEqual([
			"contained:Projects/alpha/Context.md",
			`create:${join(vault, "Projects/alpha/Context.md")}`,
		]);
	});

	it("returns false when create-only encounters an existing regular file", async () => {
		const path = join(vault, "Wiki/Index.md");
		await mkdir(join(vault, "Wiki"), { recursive: true });
		await writeFile(path, "human", "utf8");
		expect(await createVaultFileOnly(path, "replacement")).toBe(false);
		expect(await readFile(path, "utf8")).toBe("human");
	});
});
