import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

/**
 * Approval is deliberately separate from the permission extension.  SSH uses a local
 * identity and therefore always asks through the session PermissionGate immediately
 * before spawning OpenSSH.  A missing callback fails closed.
 */
export type SshApproval = (title: string, message: string) => Promise<boolean>;

export interface SshToolOptions {
	confirm?: SshApproval;
	run?: SshRunner;
}

export interface SshRunnerOptions {
	signal?: AbortSignal;
	timeoutMs: number;
}

export interface SshRunnerResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
	truncated: boolean;
}

export type SshRunner = (args: string[], options: SshRunnerOptions) => Promise<SshRunnerResult>;

const MAX_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

const sshParams = Type.Object({
	host: Type.String({
		minLength: 1,
		maxLength: 255,
		description: "SSH host or configured host alias (do not include a command or options)",
	}),
	username: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 128,
			description: "Remote username; omit to use the local SSH configuration",
		}),
	),
	port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535, description: "SSH port (default 22)" })),
	command: Type.String({
		minLength: 1,
		maxLength: 32_000,
		description: "Command to execute remotely; it is passed as one argument to ssh",
	}),
	keyPath: Type.Optional(
		Type.String({
			maxLength: 4096,
			description: "Optional local private key path; only files under ~/.ssh are accepted",
		}),
	),
	timeout: Type.Optional(
		Type.Integer({ minimum: 1_000, maximum: MAX_TIMEOUT_MS, description: "Timeout in milliseconds" }),
	),
});

export type SshToolParams = Static<typeof sshParams>;

export interface SshToolDetails {
	destination: string;
	command: string;
	keyPath?: string;
	exitCode: number | null;
	timedOut: boolean;
	truncated: boolean;
}

function expandHome(rawPath: string): string {
	if (rawPath === "~") return homedir();
	if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) return join(homedir(), rawPath.slice(2));
	return rawPath;
}

/** Resolve and constrain an identity path to the user's .ssh directory. */
export function resolveSshKeyPath(rawPath: string, home = homedir()): string {
	const absolute = resolve(expandHome(rawPath));
	const sshRoot = resolve(home, ".ssh");
	const rel = relative(sshRoot, absolute);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error("ssh: keyPath must point to a file under ~/.ssh");
	}
	return absolute;
}

function validateHost(host: string): void {
	// Prevent option injection and shell-looking destinations.  Host aliases, DNS names,
	// IPv4 and bracketed IPv6 literals remain valid.
	if (!/^[A-Za-z0-9._:%\-[\]]+$/.test(host) || host.startsWith("-")) {
		throw new Error("ssh: invalid host (use a host name, alias, IPv4, or IPv6 literal)");
	}
}

function validateUsername(username: string | undefined): void {
	if (username !== undefined && !/^[A-Za-z0-9._-]+$/.test(username)) {
		throw new Error("ssh: invalid username");
	}
}

function validatePort(port: number | undefined): void {
	if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
		throw new Error("ssh: invalid port");
	}
}

/** Build argv without a shell; command is intentionally one trailing argument. */
export function buildSshArgs(
	params: SshToolParams,
	cwd = process.cwd(),
): { args: string[]; keyPath?: string } {
	void cwd;
	validateHost(params.host);
	validateUsername(params.username);
	validatePort(params.port);
	if (!params.command.trim()) throw new Error("ssh: command must not be empty");
	if (params.command.includes("\0")) throw new Error("ssh: command contains an invalid null byte");
	const keyPath = params.keyPath ? resolveSshKeyPath(params.keyPath) : undefined;
	const destination = params.username ? `${params.username}@${params.host}` : params.host;
	const args = [
		"-n",
		"-o",
		"BatchMode=yes",
		"-o",
		"RequestTTY=no",
		"-o",
		"ConnectTimeout=15",
		"-p",
		String(params.port ?? 22),
	];
	if (keyPath) args.push("-i", keyPath, "-o", "IdentitiesOnly=yes");
	// OpenSSH treats the destination as the first positional argument.  Host validation
	// above rejects option-like destinations, so the model cannot inject client options.
	args.push(destination, params.command);
	return { args, ...(keyPath ? { keyPath } : {}) };
}

function appendOutput(chunks: Buffer[], state: { bytes: number; truncated: boolean }, chunk: Buffer): void {
	if (state.bytes >= MAX_OUTPUT_BYTES) {
		state.truncated = true;
		return;
	}
	const room = MAX_OUTPUT_BYTES - state.bytes;
	if (chunk.byteLength > room) {
		chunks.push(chunk.subarray(0, room));
		state.bytes = MAX_OUTPUT_BYTES;
		state.truncated = true;
		return;
	}
	chunks.push(chunk);
	state.bytes += chunk.byteLength;
}

/** Execute OpenSSH with no shell, no stdin, bounded output, timeout, and cancellation. */
export function runLocalSsh(args: string[], options: SshRunnerOptions): Promise<SshRunnerResult> {
	return new Promise((resolveResult, reject) => {
		const child = spawn("ssh", args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const stdoutState = { bytes: 0, truncated: false };
		const stderrState = { bytes: 0, truncated: false };
		let timedOut = false;
		let settled = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, options.timeoutMs);
		const abort = () => child.kill();
		if (options.signal?.aborted) abort();
		else options.signal?.addEventListener("abort", abort, { once: true });
		child.stdout?.on("data", (chunk: Buffer) => appendOutput(stdout, stdoutState, chunk));
		child.stderr?.on("data", (chunk: Buffer) => appendOutput(stderr, stderrState, chunk));
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			reject(error);
		});
		child.once("close", (exitCode) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			resolveResult({
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				exitCode,
				timedOut,
				truncated: stdoutState.truncated || stderrState.truncated,
			});
		});
	});
}

function formatOutput(result: SshRunnerResult): string {
	const chunks = [`ssh exit code: ${result.exitCode ?? "unknown"}`];
	if (result.timedOut) chunks.push("ssh timed out");
	if (result.stdout) chunks.push(`stdout:\n${result.stdout}`);
	if (result.stderr) chunks.push(`stderr:\n${result.stderr}`);
	if (result.truncated) chunks.push("[ssh output truncated at 128 KiB]");
	return chunks.join("\n");
}

/**
 * Agent-facing SSH tool. The approval callback is invoked after argument validation,
 * immediately before the process starts; a missing callback is a deny-by-default guard.
 */
export function makeSshTool(options: SshToolOptions = {}): ToolDefinition<typeof sshParams, SshToolDetails> {
	return {
		name: "ssh",
		label: "SSH",
		description:
			"Attempt one remote command over OpenSSH using the local SSH agent or an identity under ~/.ssh. Every call requires explicit user approval in the approval dock before any network connection starts. Commands run without a shell, stdin, or password prompt; output is capped at 128 KiB.",
		promptSnippet: "ssh({host, command})",
		promptGuidelines: [
			"SSH uses a local key or SSH agent and always asks the user immediately before connecting.",
			"Never include private key contents in a prompt or command; pass only a ~/.ssh key path when needed.",
		],
		parameters: sshParams,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal): Promise<AgentToolResult<SshToolDetails>> => {
			if (signal?.aborted) throw new Error("ssh: operation aborted");
			const { args, keyPath } = buildSshArgs(params);
			const destination = params.username ? `${params.username}@${params.host}` : params.host;
			// Include the exact command in the memory key so an explicit allowAlways
			// decision cannot silently authorize a different command on the same host.
			const approvalTitle = `SSH access: ${destination} :: ${params.command}`;
			const approvalMessage = [
				"The agent wants to run one command on a remote host using a local SSH identity or agent.",
				`Host: ${destination}:${params.port ?? 22}`,
				`Command: ${params.command}`,
				`Identity: ${keyPath ?? "OpenSSH default identity / agent"}`,
				"Approve only if this destination and command are expected.",
			].join("\n");
			const approved = options.confirm ? await options.confirm(approvalTitle, approvalMessage) : false;
			if (!approved) throw new Error("ssh: user approval required");
			const runner = options.run ?? runLocalSsh;
			const result = await runner(args, {
				signal,
				timeoutMs: params.timeout ?? DEFAULT_TIMEOUT_MS,
			});
			return {
				content: [{ type: "text", text: formatOutput(result) }],
				details: {
					destination,
					command: params.command,
					...(keyPath ? { keyPath } : {}),
					exitCode: result.exitCode,
					timedOut: result.timedOut,
					truncated: result.truncated,
				},
				...(result.exitCode !== 0 || result.timedOut ? { isError: true } : {}),
			};
		},
	};
}
