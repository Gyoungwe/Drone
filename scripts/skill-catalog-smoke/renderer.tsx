// Isolated fixture. Production components and keyboard handler; no provider or approval action.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SlashMenu } from "../../packages/desktop/src/renderer/src/components/composer/SlashMenu";
import { useSlashMenu } from "../../packages/desktop/src/renderer/src/components/composer/use-slash-menu";
import { SkillsPanel } from "../../packages/desktop/src/renderer/src/components/settings/SkillsPanel";
import { useI18nStore } from "../../packages/desktop/src/renderer/src/i18n";
import { useSettingsStore } from "../../packages/desktop/src/renderer/src/stores/settings";

const names = [
	"research-vault",
	"research-workflow",
	"nature-reader",
	"nature-writing",
	"show-me",
	"tdd",
	"channel-pickup",
	"setup-matt-pocock-skills",
	"setup-pre-commit",
	"setup-ts-deep-modules",
	"nature-shared",
];
const skills = names.map((name) => ({
	name,
	description:
		name === "research-vault"
			? "Obsidian setup, reading, maintenance and Wiki review."
			: "Isolated catalog fixture; no workflow will execute.",
	scope: "user" as const,
	source: "fixture",
	path: `/fixture/skills/${name}/SKILL.md`,
	disableModelInvocation: name.startsWith("setup-"),
}));
const commands = [
	{ name: "compact", description: "Compress context", source: "builtin" as const, supported: true },
	...skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		supported: true,
	})),
	{
		name: "obsidian-setup",
		description: "Obsidian · 初始化知识库（research-vault）",
		source: "extension" as const,
		supported: true,
		ownerSkill: "research-vault",
		aliases: ["setup", "research-setup"],
	},
	{
		name: "obsidian-review",
		description: "Obsidian · 审核 Wiki",
		source: "extension" as const,
		supported: true,
	},
];
(window as any).pi = { listSlashCommands: async () => commands };
useSettingsStore.setState({ skills, skillDiagnostics: [] });
function Fixture() {
	const [text, setText] = useState(""),
		[selected, setSelected] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const slash = useSlashMenu({
		activeSessionId: "fixture",
		cwd: "/fixture",
		trustVersion: 0,
		text,
		slashCommand: selected,
		setText,
		setSlashCommand: setSelected,
		textareaRef,
		ensureSession: async () => "fixture",
		runSlashCommand: async () => false,
		handleSend: async () => {},
		showFeedback: () => {},
		setError: () => {},
	});
	return (
		<div className="mx-auto max-w-[900px] space-y-4 p-5">
			<p className="text-[11px] text-ink-faint">DRONE / SKILL CATALOG · 隔离界面测试，不执行初始化</p>
			<button type="button" id="lang" onClick={() => useI18nStore.getState().setLanguage("en")}>
				English
			</button>
			<section className="rounded-xl border border-border bg-surface p-4">
				<textarea
					id="command-input"
					aria-label="Command test"
					className="w-full rounded-lg border border-border bg-surface p-2 text-ink"
					ref={textareaRef}
					value={text}
					onChange={(event) => {
						setSelected(null);
						setText(event.target.value);
						slash.setSlashDismissed(false);
						slash.updateToken(event.target.value, event.target.selectionStart);
					}}
					onSelect={(event) =>
						slash.updateToken(event.currentTarget.value, event.currentTarget.selectionStart)
					}
					onKeyDown={(event) => {
						slash.handleKeyDown(event);
					}}
				/>
				<output id="selected-command">{selected ?? ""}</output>
				<div id="command-menu">
					{slash.slashOpen && (
						<SlashMenu
							commands={slash.slashCommands}
							query={slash.slashQuery}
							selectedIndex={slash.slashSelected}
							onSelectedIndexChange={slash.setSlashSelected}
							onPick={slash.handleSlashPick}
							showSpecialized={slash.showSpecialized}
							onToggleSpecialized={slash.toggleSpecialized}
						/>
					)}
				</div>
			</section>
			<section id="skill-panel" className="rounded-xl border border-border bg-surface p-4">
				<SkillsPanel />
			</section>
		</div>
	);
}
createRoot(document.getElementById("root")!).render(<Fixture />);
