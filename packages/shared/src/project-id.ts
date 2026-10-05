/**
 * Normalize a workspace identity without touching the filesystem.
 *
 * Hosts should resolve symlinks before calling this function when the path
 * exists. Keeping the lexical step pure makes project identity deterministic
 * in browser code and easy to test.
 */
export function normalizeProjectId(input: string, platform: "darwin" | "win32" | "posix" = "posix"): string {
	const value = input.trim().replaceAll("\\", "/");
	if (!value) return "";

	const drive = value.match(/^([A-Za-z]):(?:\/(.*))?$/);
	const absolute = value.startsWith("/") || Boolean(drive);
	const prefix = drive ? `${(drive[1] ?? "").toLowerCase()}:` : "";
	const source = drive ? (drive[2] ?? "") : value;
	const segments: string[] = [];
	for (const segment of source.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length && segments.at(-1) !== "..") segments.pop();
			else if (!absolute) segments.push(segment);
			continue;
		}
		segments.push(segment);
	}
	let normalized = `${prefix}${absolute && !drive ? "/" : ""}${segments.join("/")}`;
	if (drive) normalized = `${prefix}/${segments.join("/")}`;
	if (!normalized) normalized = absolute ? "/" : ".";
	if (platform === "darwin" || platform === "win32") normalized = normalized.toLowerCase();
	return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}
