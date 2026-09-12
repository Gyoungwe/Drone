import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { PiBackend } from "../src/pi-backend";

it("global Obsidian setup has one visible owner in an unrelated project", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "percho-global-setup-"));
	const backend = new PiBackend({
		projectTrust: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [resolve(process.cwd(), "../../.pi/skills/research-vault/SKILL.md")],
			additionalExtensionPaths: [resolve(process.cwd(), "../../.pi/extensions/obsidian-workbench.mjs")],
		},
	});
	try {
		await backend.init();
		const commands = await backend.listSlashCommandsForCwd(cwd);
		const setup = commands.filter(
			(command) =>
				command.name === "obsidian-setup" || command.name === "setup" || command.name === "research-setup",
		);
		expect(setup.map((command) => command.name).sort()).toEqual(["obsidian-setup"]);
		expect(setup[0]?.aliases).toEqual(["setup", "research-setup"]);
		expect(setup[0]?.ownerSkill).toBe("research-vault");
		expect(setup.every((command) => command.source === "extension" && command.supported)).toBe(true);
		expect(setup.every((command) => command.description.includes("research-vault"))).toBe(true);
		expect(commands.filter((command) => command.name === "skill:research-vault")).toHaveLength(1);
	} finally {
		backend.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});
