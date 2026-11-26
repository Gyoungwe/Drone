import type { LoadedSkill, SlashCommandInfo } from "@drone/shared";
import { getPi } from "../api";

export function skillsFromSlashCommands(commands: readonly SlashCommandInfo[]): LoadedSkill[] {
	const seen = new Set<string>();
	return commands.flatMap((command) => {
		if (command.source !== "skill" || !command.name.startsWith("skill:")) return [];
		const name = command.name.slice("skill:".length);
		if (!name || seen.has(name)) return [];
		seen.add(name);
		return [
			{
				name,
				description: command.description,
				scope: "user",
				source: "builtin",
				path: `<loader:${name}>`,
				disableModelInvocation: false,
			},
		];
	});
}

export async function loadDraftSkills(cwd: string | undefined): Promise<LoadedSkill[]> {
	try {
		const commands = await new Promise<SlashCommandInfo[]>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Timed out while loading skills")), 5_000);
			getPi()
				.listSlashCommandsForCwd(cwd)
				.then(resolve, reject)
				.finally(() => clearTimeout(timer));
		});
		return skillsFromSlashCommands(commands);
	} catch (error) {
		console.warn("Draft skill discovery failed", error);
		return [];
	}
}
