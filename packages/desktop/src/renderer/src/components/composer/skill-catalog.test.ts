import { getSkillCategory, groupSkillCatalog } from "@percho/shared";
import { describe, expect, it } from "vitest";
import { filterCommands, groupCommands, menuCommands } from "./slash-filter";

const command = (name: string, source: "skill" | "extension" = "skill", extra = {}) => ({
	name,
	source,
	description: "",
	supported: true,
	...extra,
});
describe("one browse catalog for all loaded skills", () => {
	it("separates knowledge setup from engineering setup and internal references", () => {
		expect(getSkillCategory("research-vault")).toBe("knowledge");
		expect(getSkillCategory("setup-pre-commit")).toBe("setup");
		expect(getSkillCategory("setup-ts-deep-modules")).toBe("setup");
		expect(getSkillCategory("nature-shared")).toBe("support");
		expect(getSkillCategory("new-user-skill")).toBe("other");
	});
	it("retains every distinct workflow rather than merging similar names", () => {
		const skills = [
			{ name: "grill-me" },
			{ name: "grilling" },
			{ name: "setup-pre-commit" },
			{ name: "nature-reader" },
			{ name: "new-user-skill" },
		];
		const groups = groupSkillCatalog(skills);
		expect(groups.flatMap((g) => g.items)).toHaveLength(skills.length);
		expect(new Set(groups.flatMap((g) => g.items.map((s) => s.name))).size).toBe(skills.length);
	});
	it("hides specialist setup/support from blank browse but exposes them through search or expand", () => {
		const all = [
			command("obsidian-setup", "extension", { aliases: ["setup", "research-setup"] }),
			command("skill:setup-pre-commit"),
			command("skill:nature-shared"),
		];
		expect(filterCommands(all, "")).toEqual([all[0]]);
		expect(filterCommands(all, "", true)).toEqual(all);
		expect(filterCommands(all, "setup")).toEqual([all[0], all[1]]);
		expect(filterCommands(all, "research-setup")).toEqual([all[0]]);
		expect(filterCommands(all, "提交前")).toEqual([all[1]]);
	});
	it("keyboard selection and rendered grouped order cannot diverge", () => {
		const all = [
			command("obsidian-setup", "extension", { aliases: ["setup"] }),
			command("skill:research-vault"),
			command("skill:setup-pre-commit"),
		];
		expect(menuCommands(all, "setup")).toEqual(groupCommands(all, "setup").flatMap((g) => g.items));
		expect(menuCommands(all, "setup").map((c) => c.name)).toEqual([
			"obsidian-setup",
			"skill:setup-pre-commit",
		]);
	});
});

it("setup search maps aliases to the action without listing its owner twice", () => {
	const primary = command("obsidian-setup", "extension", {
		ownerSkill: "research-vault",
		aliases: ["setup", "research-setup"],
	});
	const owner = command("skill:research-vault", "skill", { description: "Obsidian setup and retrieval" });
	expect(filterCommands([owner, primary], "setup")).toEqual([primary]);
	expect(filterCommands([owner, primary], "obsidian")).toEqual([primary, owner]);
});
