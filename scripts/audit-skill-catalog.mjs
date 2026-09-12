// Reads installed resource metadata; never invokes setup commands or a model.

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { build } from "esbuild";

const repo = fileURLToPath(new URL("../", import.meta.url));
const cwd = resolve(process.argv[2] || repo),
	agentDir = resolve(process.argv[3] || getAgentDir());
const projectTrusted = process.argv.includes("--trusted-project");
const loadPure = async (file) => {
	const out = await build({
		entryPoints: [join(repo, file)],
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const catalog = await loadPure("packages/shared/src/skill-catalog.ts");
const menus = await loadPure("packages/backend/src/slash-commands.ts");
const loader = new DefaultResourceLoader({
	cwd,
	agentDir,
	settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted }),
	additionalSkillPaths: [
		join(repo, "packages/desktop/resources/ui-plugins/skills"),
		join(repo, "packages/desktop/resources/skills"),
		join(repo, ".pi/skills/research-vault/SKILL.md"),
	],
	additionalExtensionPaths: [join(repo, ".pi/extensions/obsidian-workbench.mjs")],
});
await loader.reload();
const skills = loader.getSkills(),
	extensions = loader.getExtensions();
const menu = menus.slashCommandsForLoader(loader);
console.log(
	JSON.stringify(
		{
			cwd,
			agentDir,
			totalSkills: skills.skills.length,
			groups: catalog.groupSkillCatalog(skills.skills).map((group) => ({
				category: group.category,
				count: group.items.length,
				names: group.items.map((skill) => skill.name),
			})),
			setupMenu: menu.filter((command) => command.name.includes("setup")),
			skillDiagnostics: skills.diagnostics,
			extensionErrors: extensions.errors,
			scope: "metadata only; initialized no Vault; all user/shared skill source files unchanged",
		},
		null,
		2,
	),
);
