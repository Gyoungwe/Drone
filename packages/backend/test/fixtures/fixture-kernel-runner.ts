import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import type {
	DiscoveryLanguage,
	DiscoveryRunner,
	DiscoveryRunnerCapabilities,
	DiscoveryRunRequest,
	DiscoveryRunResult,
} from "@gyoungwe/plugin-api";

function stdoutKind(stdout: string): "summary" | "plot" | "raw" {
	const lines = stdout.split(/\r?\n/);
	if (lines.every((line) => line.length === 0 || line.startsWith("[summary]"))) return "summary";
	if (lines.every((line) => line.length === 0 || line.startsWith("[plot]"))) return "plot";
	return "raw";
}

export class FixtureKernelRunner implements DiscoveryRunner {
	readonly capabilities: DiscoveryRunnerCapabilities = {
		kind: "fixture",
		languages: ["python", "r"],
		networkDisabled: true,
		writesOnlyToRunDirectory: true,
	};

	constructor(
		private readonly commands: Partial<Record<DiscoveryLanguage, string>> = { python: "python3" },
	) {}

	run(request: DiscoveryRunRequest): Promise<DiscoveryRunResult> {
		const command = this.commands[request.language];
		if (
			!command ||
			(request.language === "python" && command !== "python3") ||
			(request.language === "r" && command !== "Rscript")
		)
			return Promise.reject(new Error("fixture-command-not-allowlisted"));
		const args =
			request.language === "python" ? ["-I", "-c", request.code] : ["--vanilla", "-e", request.code];
		const started = Date.now();
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: request.runDirectory,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (value: Buffer) => {
				stdout = `${stdout}${value.toString("utf8")}`.slice(0, request.maxOutputBytes);
			});
			child.stderr.on("data", (value: Buffer) => {
				stderr = `${stderr}${value.toString("utf8")}`.slice(0, request.maxOutputBytes);
			});
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				reject(new Error("fixture-timeout"));
			}, request.timeoutMs);
			child.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.once("close", (exitCode) => {
				clearTimeout(timer);
				const classification = request.dataClassification;
				const outputs: DiscoveryRunResult["outputs"][number][] = [];
				if (stdout) outputs.push({ text: stdout, contentKind: stdoutKind(stdout), classification });
				if (stderr) outputs.push({ text: stderr, contentKind: "raw", classification });
				resolve({
					exitCode: exitCode ?? 1,
					outputs,
					durationMs: Date.now() - started,
					producedBytes: Buffer.byteLength(`${stdout}${stderr}`),
				});
			});
		});
	}
}
