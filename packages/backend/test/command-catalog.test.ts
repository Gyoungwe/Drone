import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { normalizeAlwaysWith } from "../src/capabilities/skill-frontmatter";
import {
	presentExtensionCommands,
	slashCommandsForLoader,
	slashCommandsForSession,
} from "../src/slash-commands";

const origin = { scope: "temporary", source: "fixture" };
const entry = (name: string, role?: string, sourceInfo = origin, invocationName = name) => ({
	name,
	invocationName,
	description: name,
	sourceInfo,
	...(role ? { droneMenu: { version: 1, canonical: "obsidian-setup", skill: "research-vault", role } } : {}),
});
const commands = () => [
	entry("obsidian-setup", "primary"),
	entry("setup", "alias"),
	entry("research-setup", "alias"),
	entry("other"),
];
describe("owned aliases are folded, not deleted or guessed", () => {
	it("presents one canonical setup and preserves both compatibility names as search metadata", () => {
		const list = presentExtensionCommands(commands() as never);
		expect(list.map((c) => c.name)).toEqual(["obsidian-setup", "other"]);
		expect(list[0]).toMatchObject({ ownerSkill: "research-vault", aliases: ["setup", "research-setup"] });
	});
	it("does not suppress a third-party setup or rewrite SDK collision suffixes", () => {
		const list = presentExtensionCommands([
			entry("obsidian-setup", "primary"),
			entry("setup", "alias", origin, "setup:1"),
			entry("setup", undefined, { scope: "user", source: "other" }, "setup:2"),
		] as never);
		expect(list.map((c) => c.name)).toEqual(["obsidian-setup", "setup:2"]);
		expect(list[0]?.aliases).toEqual(["setup:1"]);
	});
	it("keeps an orphan alias visible and does not mutate registered commands", () => {
		const raw = commands();
		const before = JSON.stringify(raw);
		presentExtensionCommands(raw as never);
		expect(JSON.stringify(raw)).toBe(before);
		expect(presentExtensionCommands([entry("setup", "alias")] as never)).toHaveLength(1);
	});
	it("does not infer ownership from a setup-like name or copied description", () => {
		const list = presentExtensionCommands([
			entry("obsidian-setup", "primary"),
			entry("setup", "alias", { scope: "user", source: "unrelated" }),
		] as never);
		expect(list.map((c) => c.name)).toEqual(["obsidian-setup", "setup"]);
	});
	it("draft and session catalogs use the same grouping and invocation names", () => {
		const rows = commands(),
			extension = { commands: new Map(rows.map((c) => [c.name, c])) };
		const loader = {
			getPrompts: () => ({ prompts: [] }),
			getSkills: () => ({ skills: [] }),
			getExtensions: () => ({ extensions: [extension] }),
		};
		const active = { resourceLoader: loader, extensionRunner: { getRegisteredCommands: () => rows } };
		expect(slashCommandsForSession(active as never)).toEqual(slashCommandsForLoader(loader as never));
	});
});

it("both first-party skills have parseable frontmatter and distinct responsibilities", async () => {
	for (const name of ["research-vault", "research-workflow"]) {
		const text = await readFile(new URL(`../../../.pi/skills/${name}/SKILL.md`, import.meta.url), "utf8");
		const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		expect(frontmatter).not.toBeNull();
		if (!frontmatter?.[1]) throw new Error(`Missing frontmatter: ${name}`);
		const metadata = parse(frontmatter[1]);
		expect(metadata.name).toBe(name);
		expect(typeof metadata.description).toBe("string");
		// 挂钩 5：第一方技能通过 frontmatter 声明随 research 常驻
		expect(normalizeAlwaysWith(metadata.alwaysWith).has("research")).toBe(true);
		expect(text).toContain("/obsidian-setup");
	}
});
it("zotero-literature is a literature skill, not a second Vault initializer", async () => {
	const text = await readFile(
		new URL("../../../.pi/skills/zotero-literature/SKILL.md", import.meta.url),
		"utf8",
	);
	const metadata = parse(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
	expect(metadata.name).toBe("zotero-literature");
	expect(normalizeAlwaysWith(metadata.alwaysWith).has("research")).toBe(true);
	expect(text).toContain("/zotero-setup");
	expect(text).toContain("research-vault");
	expect(text).toContain("still own the Vault");
});
