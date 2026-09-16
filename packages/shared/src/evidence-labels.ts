/** Legacy metadata is displayed without migrating or rewriting source files. */
export function legacyEvidenceNotice(text: string): string | null {
	const header = text.match(/^---\r?\n([\s\S]{0,4000}?)\r?\n---/);
	if (!header || !/^status:\s*["']?(?:verified|human_verified)["']?\s*$/im.test(header[1] || "")) return null;
	return "旧版 verified 状态：含义待核对。文件身份、提取、引用可追溯和科学审阅是不同层次；本次没有修改原笔记或提升证据等级。";
}
