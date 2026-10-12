/** 文件右键菜单（P7）：12 项的 id、顺序与分组；主进程只实现需要宿主能力的那几项。 */
export type FileMenuAction =
	| "view"
	| "download"
	| "addToChat"
	| "openDefault"
	| "reveal"
	| "openInEditor"
	| "copyPath"
	| "copyRelativePath"
	| "cut"
	| "copy"
	| "rename"
	| "delete";

/** 分组之间画分隔线；顺序与报告实测一致。 */
export const FILE_MENU: readonly (readonly FileMenuAction[])[] = [
	["view", "download", "addToChat"],
	["openDefault", "reveal", "openInEditor"],
	["copyPath", "copyRelativePath"],
	["cut", "copy"],
	["rename", "delete"],
];

/** 主进程执行的动作（其余在渲染层完成）。 */
export type HostFileAction =
	| "download"
	| "openDefault"
	| "reveal"
	| "openInEditor"
	| "cut"
	| "copy"
	| "rename"
	| "trash";

export type TabMenuAction =
	| "close"
	| "closeOthers"
	| "closeRight"
	| "closeAll"
	| "pin"
	| "rename"
	| "hide"
	| "delete";
export const TAB_MENU: readonly (readonly TabMenuAction[])[] = [
	["close", "closeOthers", "closeRight", "closeAll"],
	["pin", "rename", "hide"],
	["delete"],
];

/** 相对路径：以 cwd 为根；不在 cwd 下返回原路径。统一用 / 分隔，Windows 盘符大小写不敏感。 */
export function relativeToCwd(path: string, cwd: string | undefined): string {
	if (!cwd) return path;
	const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
	const p = norm(path),
		c = norm(cwd);
	const win = /^[a-z]:\//i.test(p);
	const starts = win ? p.toLowerCase().startsWith(`${c.toLowerCase()}/`) : p.startsWith(`${c}/`);
	return starts ? p.slice(c.length + 1) : p;
}

/** 重命名的新文件名校验：不能为空、不能含路径分隔符或保留名。返回错误 key 或 null。 */
export function validateNewFileName(name: string): "empty" | "separator" | "reserved" | null {
	const trimmed = name.trim();
	if (!trimmed || trimmed === "." || trimmed === "..") return "empty";
	if (/[\\/]/.test(trimmed) || trimmed.includes("\0")) return "separator";
	if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(trimmed) || /[<>:"|?*]/.test(trimmed)) return "reserved";
	return null;
}

/** 关闭其他 / 右侧 / 全部 要关闭的标签 id。 */
export function tabsToClose(
	ids: readonly string[],
	target: string,
	action: "close" | "closeOthers" | "closeRight" | "closeAll",
): string[] {
	const index = ids.indexOf(target);
	if (action === "close") return index >= 0 ? [target] : [];
	if (action === "closeAll") return [...ids];
	if (action === "closeOthers") return ids.filter((id) => id !== target);
	return index >= 0 ? ids.slice(index + 1) : [];
}
