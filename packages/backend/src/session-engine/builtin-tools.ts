/** Pi registers powershell on every platform, then throws unless the host is native Windows. */
export function excludedBuiltinTools(platform: NodeJS.Platform = process.platform): string[] {
	return platform === "win32" ? [] : ["powershell"];
}
