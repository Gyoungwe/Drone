import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** PATH lookup and bounded version-flag execution shared by bio environment probes. */
export async function onPath(name: string): Promise<string | null> {
	const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		for (const ext of extensions) {
			const full = join(dir, name + ext);
			try {
				await access(full, process.platform === "win32" ? constants.F_OK : constants.X_OK);
				return full;
			} catch {
				/* keep looking */
			}
		}
	}
	return null;
}

export function run(command: string, args: string[], timeoutMs = 6000): Promise<string> {
	return new Promise((resolve) => {
		let output = "";
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch {
			resolve("");
			return;
		}
		const timer = setTimeout(() => child.kill(), timeoutMs);
		const take = (chunk: Buffer) => {
			if (output.length < 8000) output += chunk.toString("utf8");
		};
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
		child.once("error", () => {
			clearTimeout(timer);
			resolve(output);
		});
		child.once("close", () => {
			clearTimeout(timer);
			resolve(output);
		});
	});
}

/** Like run(), but also reports the exit code (null when the process could not start or timed out). */
export function runWithCode(
	command: string,
	args: string[],
	timeoutMs = 20_000,
): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve) => {
		let output = "";
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch {
			resolve({ code: null, output: "" });
			return;
		}
		const timer = setTimeout(() => child.kill(), timeoutMs);
		const take = (chunk: Buffer) => {
			if (output.length < 8000) output += chunk.toString("utf8");
		};
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
		child.once("error", () => {
			clearTimeout(timer);
			resolve({ code: null, output });
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			resolve({ code, output });
		});
	});
}
