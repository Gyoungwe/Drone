import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";

afterEach(() => vi.unstubAllEnvs());

it("global Obsidian setup has one visible owner in an unrelated project", async () => {
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	const cwd = await mkdtemp(join(tmpdir(), "drone-global-setup-"));
	const agentDir = await mkdtemp(join(tmpdir(), "drone-global-agent-"));
	const workbench = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.pi");
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	const backend = new PiBackend({
		projectTrust: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [join(workbench, "skills/research-vault/SKILL.md")],
			additionalExtensionPaths: [join(workbench, "extensions/obsidian-workbench.mjs")],
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
		await rm(agentDir, { recursive: true, force: true });
	}
});
