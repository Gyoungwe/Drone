import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";

export const run = promisify(execFile);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function declaredPath(packageRoot, entry) {
	expect(typeof entry).toBe("string");
	expect(isAbsolute(entry)).toBe(false);
	const path = await realpath(resolve(packageRoot, entry));
	const local = relative(packageRoot, path);
	expect(local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)).toBe(false);
	return path;
}

/** Only census this freshly installed package, never another running application or Vault. */
export async function packageChildren(packageRoot) {
	const { stdout } = await run("ps", ["-axo", "pid=,ppid=,command="]);
	return stdout
		.split("\n")
		.filter((line) => line.includes(`--allow-fs-read=${packageRoot}`))
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
			if (!match) throw new Error("Unexpected process census row");
			return {
				pid: Number(match[1]),
				ppid: Number(match[2]),
				resource: match[3].includes("--allow-fs-write="),
			};
		})
		.sort((a, b) => a.pid - b.pid);
}
