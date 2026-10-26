import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Host-owned runtime receipt; fail closed when Node cannot enforce network isolation. */
export function pluginRuntimeExecutable(runtimeDirectory?: string): string {
	// Node before v25 leaves network unrestricted under its permission model.
	// Refuse before loading plugin code instead of silently weakening isolation.
	let executable = process.execPath;
	if (runtimeDirectory) {
		const directory = runtimeDirectory;
		executable = join(directory, process.platform === "win32" ? "node.exe" : "node");
		const receipt = JSON.parse(readFileSync(join(directory, "runtime.json"), "utf8"));
		const digest = createHash("sha256").update(readFileSync(executable)).digest("hex");
		if (digest !== receipt.binarySha256) throw new Error("Plugin runtime checksum mismatch");
		const supported = execFileSync(
			executable,
			["--permission", "-p", "process.allowedNodeEnvironmentFlags.has('--allow-net')"],
			{ env: {}, encoding: "utf8" },
		).trim();
		if (supported !== "true") throw new Error("Plugin runtime has no network permission enforcement");
	} else if (!process.allowedNodeEnvironmentFlags.has("--allow-net")) {
		throw new Error(
			`Plugin sandbox is unavailable: Node ${process.versions.node} has no network permission enforcement (--allow-net)`,
		);
	}
	return executable;
}
