/** Built-in capability profiles. Project/user files may not override these identities. */
export const KNOWLEDGE_SPECIALISTS = [
	{
		role: "navigator",
		name: "knowledge-navigator",
		label: "知识导航员",
		description: "按导航检索共享知识与当前项目，只返回少量相关来源。",
		permissions: ["knowledge_read", "knowledge_search", "knowledge_submit"],
		maxTurns: 6,
		maxTokens: 1800,
	},
	{
		role: "evidence",
		name: "knowledge-evidence-curator",
		label: "证据整理员",
		description: "核对指定来源的适用范围、冲突与缺口，不自动认证结论。",
		permissions: ["knowledge_read", "knowledge_submit"],
		maxTurns: 4,
		maxTokens: 2400,
	},
	{
		role: "wiki",
		name: "knowledge-wiki-editor",
		label: "Wiki 修订员",
		description: "根据已读证据生成待审核修订正文，无正式 Wiki 写入与批准权限。",
		permissions: ["knowledge_read", "knowledge_submit"],
		maxTurns: 3,
		maxTokens: 6500,
	},
	{
		role: "explainer",
		name: "knowledge-explainer",
		label: "Show Me 讲解员",
		description: "按实际 Show Me skill 生成独立讲解产物，由宿主保存；不执行软件或测试。",
		permissions: ["knowledge_read", "knowledge_submit"],
		maxTurns: 3,
		maxTokens: 12000,
	},
] as const;
/** Review is user-triggered, never a fifth automatic chat stage. */
export const KNOWLEDGE_REVIEWER = {
	role: "reviewer",
	name: "knowledge-wiki-reviewer",
	label: "Wiki 模型审核员",
	description: "独立核对选中的候选和来源，仅返回审核意见；自动应用须由用户单独授权。",
	permissions: ["knowledge_submit"],
	maxTurns: 1,
	maxTokens: 2800,
} as const;
export const PROTECTED_KNOWLEDGE_AGENTS = [...KNOWLEDGE_SPECIALISTS, KNOWLEDGE_REVIEWER] as const;
export type KnowledgeSpecialistRole = (typeof PROTECTED_KNOWLEDGE_AGENTS)[number]["role"];
export type KnowledgeSpecialistMode = "automatic" | "manual" | "off";
export interface KnowledgeSpecialistSettings {
	mode: KnowledgeSpecialistMode;
	revision: number;
	maxRunsPerTurn: number;
	concurrency: number;
	timeoutMs: number;
}
export interface KnowledgeSpecialistRun {
	id: string;
	role: KnowledgeSpecialistRole;
	name: string;
	label: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";
	action?: string;
	model?: string;
	thinkingLevel?: string;
	startedAt?: number;
	endedAt?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
	totalTokens?: number;
	cost?: number;
	sourceCount?: number;
	summary?: string;
	error?: string;
	sources?: { path: string; hash: string; startLine: number; endLine: number; excerpt?: string }[];
}
