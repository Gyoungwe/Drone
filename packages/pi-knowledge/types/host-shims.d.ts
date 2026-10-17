declare module "@drone/knowledge/config" {
	export function knowledgeDirectory(): string | null;
	export function readKnowledgeBinding(): Promise<{
		vault: string;
		profile?: string;
		revision?: number;
	} | null>;
}
declare module "@drone/knowledge/service" {
	export function getKnowledgeService(
		binding: unknown,
	): Promise<{ request(op: string, args?: unknown): Promise<unknown> }>;
}
declare module "@drone/knowledge/extension-helpers" {
	export function currentProject(cwd: string, ctx?: unknown): Promise<string>;
}
declare module "@drone/extensions/workspace-config" {
	const register: (pi: unknown) => void;
	export default register;
}
declare module "@drone/extensions/obsidian-workbench" {
	const register: (pi: unknown) => void;
	export default register;
}
