declare module "@drone/knowledge/config" {
	export function knowledgeDirectory(): string | null;
	export function readKnowledgeBinding(): Promise<{
		vault: string;
		vaultId?: string;
		profile?: string;
		revision?: number;
		depositMode?: string;
	} | null>;
}
declare module "@drone/knowledge/service" {
	export function getKnowledgeService(binding: unknown): Promise<{
		request(op: string, args?: unknown): Promise<any>;
		prepare(input: { cwd: string; project: string; query?: string }): Promise<any>;
		read(ticket: string, cwd: string, input: Record<string, unknown>): Promise<any>;
	}>;
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
declare module "@drone/extensions/internal/obsidian-workbench" {
	export function depositKnowledge(input: Record<string, unknown>): Promise<any>;
}
