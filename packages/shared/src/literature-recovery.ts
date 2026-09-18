const actions: Record<string, [string, string]> = {
	"reuse-existing-item": ["复用现有条目，不重复导入", "Reuse item; do not re-import"],
	"resolve-identity-conflict": ["身份冲突，先核对再操作", "Resolve identity conflict before writing"],
	"read-back-before-any-import": [
		"状态不明，先读回核对，不能当成未入库",
		"Unknown; read back before any import",
	],
	"preserve-existing-note": ["保留现有笔记与人工内容", "Preserve existing note and human content"],
	"deposit-missing-note-with-authorization": [
		"仅缺笔记；获授权后补这一侧",
		"Note missing; deposit only this side with authorization",
	],
	"review-note-conflict-preserve-human-content": [
		"笔记身份冲突；不要覆盖人工内容",
		"Review note conflict; do not overwrite human content",
	],
	"wait-and-recheck-vault": ["Vault 不可用；恢复连接后核对", "Vault unavailable; reconnect and recheck"],
};
export function literatureRecoverySummary(output: string, language = "zh"): string[] {
	try {
		const v = JSON.parse(output);
		if (!v.operation_id || !v.destinations) return [];
		const lang = language.startsWith("zh") ? 0 : 1;
		const z = actions[v.destinations.zotero?.action]?.[lang],
			o = actions[v.destinations.obsidian?.action]?.[lang];
		if (!z || !o) return [];
		return [
			`Zotero：${z}`,
			`Obsidian：${o}`,
			lang === 0
				? "身份核对不等于原文阅读或科学验证；此操作不写入双库。"
				: "Identity checks are not reading or scientific validation; this operation does not write to either library.",
		];
	} catch {
		return [];
	}
}
