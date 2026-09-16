import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

/**
 * Session export APIs in the bundled SDK return the path of a generated file.
 * The save dialog receives either that path or inline text; materialize paths
 * here so the selected destination contains the export body rather than the
 * path string itself.
 */
export async function materializeSaveContent(value: string): Promise<string> {
	if (!isAbsolute(value)) return value;
	try {
		const info = await stat(value);
		if (info.isFile()) return await readFile(value, "utf8");
	} catch {
		// Inline text or a path that disappeared: preserve the original value.
	}
	return value;
}
