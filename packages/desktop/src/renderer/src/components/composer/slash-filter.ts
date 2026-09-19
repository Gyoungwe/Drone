import {
	getSkillCategory,
	resolveWorkflowStage,
	type SlashCommandInfo,
	skillCatalogSearchText,
	WORKFLOW_DIRECTIONS,
	WORKFLOW_STAGES,
	type WorkflowDirection,
	workflowProfile,
} from "@drone/shared";

export const SOURCE_ORDER: SlashCommandInfo["source"][] = ["builtin", "template", "skill", "extension"];

const SKILL_PREFIX = "skill:";

/** 光标前的 / token：/ 必须在行首或空白后（空格+/ 触发；防 URL/路径误伤），query 不含空白 */
export interface SlashToken {
	/** / 在全文中的下标 */
	start: number;
	/** token 结束下标（= 检测时的光标位） */
	end: number;
	/** / 之后的查询词 */
	query: string;
}

/** 光标前 / token 探测（与 extractAtToken 同构）：任意位置可触发，不限于文本开头 */
export function extractSlashToken(text: string, cursor: number): SlashToken | null {
	const before = text.slice(0, cursor);
	const at = before.lastIndexOf("/");
	if (at === -1) return null;
	if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
	const query = before.slice(at + 1);
	if (/\s/.test(query)) return null;
	return { start: at, end: cursor, query };
}

/** 选中命令转胶囊后移除触发 token：两侧都空白时收掉一个；行首 token 不留前导空格（后续作为胶囊参数） */
export function removeSlashToken(text: string, token: SlashToken): string {
	const before = text.slice(0, token.start);
	let after = text.slice(token.end);
	if (after.startsWith(" ") && (before.endsWith(" ") || token.start === 0)) {
		after = after.slice(1);
	}
	return before + after;
}

/** 过滤后的命令列表（按来源分组顺序拍平；skill 名称优先、描述命中兜底）
 *  非 skill 命令维持前缀匹配；skill 命令支持去 skill: 前缀后的前缀/子串匹配，以及描述关键词匹配 */
export function isSpecializedCommand(command: SlashCommandInfo): boolean {
	return (
		(command.source === "skill" &&
			(!!workflowProfile(command.name) || ["setup", "support"].includes(getSkillCategory(command.name)))) ||
		(command.source === "template" && /^ars-(?!pi-)/.test(command.name))
	);
}
export function filterCommands(
	commands: SlashCommandInfo[],
	query: string,
	showSpecialized = false,
): SlashCommandInfo[] {
	if (!query)
		return showSpecialized ? commands : commands.filter((command) => !isSpecializedCommand(command));
	const needle = query.toLocaleLowerCase();
	const rest = commands.filter(
		(c) =>
			c.source !== "skill" &&
			(c.name.toLocaleLowerCase().startsWith(needle) ||
				c.aliases?.some((alias) => alias.toLocaleLowerCase().startsWith(needle))),
	);
	// A setup query should not list its owning skill again as a second setup workflow.
	const actionOwners = new Set(
		rest
			.filter(
				(command) =>
					command.ownerSkill &&
					(command.name.toLocaleLowerCase() === needle ||
						command.aliases?.some((alias) => alias.toLocaleLowerCase().startsWith(needle))),
			)
			.map((command) => `skill:${command.ownerSkill}`),
	);
	const prefixSkills: SlashCommandInfo[] = [];
	const substringSkills: SlashCommandInfo[] = [];
	const descriptionSkills: SlashCommandInfo[] = [];
	const descriptionQuery = query.toLocaleLowerCase();
	for (const skill of commands) {
		if (skill.source !== "skill" || actionOwners.has(skill.name)) continue;
		const bare = skill.name.startsWith(SKILL_PREFIX) ? skill.name.slice(SKILL_PREFIX.length) : skill.name;
		if (skill.name.toLocaleLowerCase().startsWith(needle) || bare.toLocaleLowerCase().startsWith(needle)) {
			prefixSkills.push(skill);
		} else if (bare.toLocaleLowerCase().includes(needle)) {
			substringSkills.push(skill);
		} else if (
			`${skill.description} ${skillCatalogSearchText(skill.name)}`
				.toLocaleLowerCase()
				.includes(descriptionQuery)
		) {
			descriptionSkills.push(skill);
		}
	}
	return [...rest, ...prefixSkills, ...substringSkills, ...descriptionSkills];
}

/** UI-only navigation: never serialized as a prompt or sent as an SDK command. */
export interface WorkflowMenuCommand extends SlashCommandInfo {
	workflowNavigation?: WorkflowDirection;
	workflowStage?: string;
}
export function workflowMenuItems(
	commands: SlashCommandInfo[],
	direction?: WorkflowDirection | null,
): WorkflowMenuCommand[] {
	if (direction)
		return WORKFLOW_STAGES.filter((s) => s.direction === direction).map((stage) => {
			const actual = resolveWorkflowStage(stage, commands);
			return actual
				? { ...actual, workflowStage: stage.id }
				: {
						name: `unavailable:${stage.id}`,
						source: "extension",
						supported: false,
						description: "",
						workflowStage: stage.id,
					};
		});
	// An empty/unrelated SDK catalog must not pretend that the integration is installed.
	if (
		!commands.some(
			(c) =>
				c.source === "skill" &&
				workflowProfile(c.name)?.direction &&
				workflowProfile(c.name)?.direction !== "internal",
		)
	)
		return [];
	return WORKFLOW_DIRECTIONS.map((direction) => ({
		name: `workflow:${direction.id}`,
		source: "extension",
		supported: true,
		description: "",
		workflowNavigation: direction.id,
	}));
}
export type SlashMenuGroup = SlashCommandInfo["source"] | "setup" | "support" | "workflow";
const MENU_GROUP_ORDER: SlashMenuGroup[] = ["workflow", ...SOURCE_ORDER, "setup", "support"];
/** A single ordering function for DOM, keyboard Enter and Tab; no visual/runtime index mismatch. */
export function groupCommands(
	commands: SlashCommandInfo[],
	query: string,
	showSpecialized = false,
	direction?: WorkflowDirection | null,
): Array<{ source: SlashMenuGroup; items: WorkflowMenuCommand[] }> {
	const buckets = new Map<SlashMenuGroup, WorkflowMenuCommand[]>();
	if (!query && !showSpecialized) {
		const navigation = workflowMenuItems(commands, direction);
		if (navigation.length) buckets.set("workflow", navigation);
		if (direction) return [{ source: "workflow", items: navigation }];
	}
	for (const command of filterCommands(commands, query, showSpecialized)) {
		const source: SlashMenuGroup =
			command.source === "skill" && ["setup", "support"].includes(getSkillCategory(command.name))
				? (getSkillCategory(command.name) as "setup" | "support")
				: command.source;
		const items = buckets.get(source) ?? [];
		items.push(command);
		buckets.set(source, items);
	}
	return MENU_GROUP_ORDER.filter((source) => buckets.has(source)).map((source) => ({
		source,
		items: buckets.get(source) ?? [],
	}));
}
export function menuCommands(
	commands: SlashCommandInfo[],
	query: string,
	showSpecialized = false,
	direction?: WorkflowDirection | null,
): WorkflowMenuCommand[] {
	return groupCommands(commands, query, showSpecialized, direction).flatMap((group) => group.items);
}
