import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { pathToFileURL } from "node:url";
import type { InlineExtension, ToolDefinition } from "./session-engine/sdk";

/**
 * A process boundary for optional Pi extensions.
 *
 * The child receives only the extension entrypoint and a narrow JSON protocol.
 * Node's permission model is the enforcement point for filesystem, network and
 * child-process access; the host never passes its ambient environment through.
 */
export interface PluginSandboxPolicy {
	readonly pluginId: string;
	readonly entrypoint: string;
	readonly packageRoot: string;
	readonly cwd: string;
	readonly filesystem?: {
		readonly read?: readonly string[];
		readonly write?: readonly string[];
	};
	/** Empty denies all network; exactly ["*"] explicitly grants all network.
	 * Node cannot enforce hostname-scoped permissions, so other lists are rejected.
	 */
	readonly network?: readonly string[];
	readonly allowChildProcess?: boolean;
	readonly environment?: readonly string[];
	readonly timeoutMs?: number;
}

export interface PluginSandboxToolDeclaration {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: unknown;
	readonly promptSnippet?: string;
	readonly promptGuidelines?: readonly string[];
	readonly exposure?: string;
	readonly namespace?: string;
	readonly annotations?: unknown;
	readonly defaultActive?: boolean;
	readonly executionMode?: string;
	readonly drone?: unknown;
}

export interface PluginSandboxReady {
	readonly pid: number;
	readonly tools: readonly PluginSandboxToolDeclaration[];
}

interface ReadyMessage {
	readonly type: "ready";
	readonly pid: number;
	readonly tools: readonly PluginSandboxToolDeclaration[];
}
interface ResultMessage {
	readonly type: "result";
	readonly id: string;
	readonly ok: boolean;
	readonly value?: unknown;
	readonly error?: string;
}
interface UpdateMessage {
	readonly type: "update";
	readonly id: string;
	readonly value: unknown;
}
interface ErrorMessage {
	readonly type: "error";
	readonly error: string;
}
type SandboxMessage = ReadyMessage | ResultMessage | UpdateMessage | ErrorMessage;

const WORKER_SOURCE = String.raw`
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const entrypoint = process.argv[1];
const tools = new Map();
const controllers = new Map();
const protocol = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const unsupported = (name) => () => { throw new Error("Process-sandbox extension API is not supported: " + name); };
const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  on() { return () => {}; },
  events: { on() { return () => {}; }, emit() {} },
  registerCommand: unsupported("registerCommand"),
  registerShortcut: unsupported("registerShortcut"),
  registerFlag: unsupported("registerFlag"),
  registerMessageRenderer: unsupported("registerMessageRenderer"),
  registerMarkdownTransformer: unsupported("registerMarkdownTransformer"),
  registerEntryRenderer: unsupported("registerEntryRenderer"),
  registerToolRenderer: unsupported("registerToolRenderer"),
  sendMessage: unsupported("sendMessage"),
  sendUserMessage: unsupported("sendUserMessage"),
  appendEntry: unsupported("appendEntry"),
  setSessionName: unsupported("setSessionName"),
  setLabel: unsupported("setLabel"),
  exec: unsupported("exec"),
  getActiveTools() { return []; },
  getAllTools() { return []; },
  getSettings: unsupported("getSettings"),
  setActiveTools: unsupported("setActiveTools"),
  getCommands() { return []; },
  setModel: unsupported("setModel"),
  getThinkingLevel: unsupported("getThinkingLevel"),
  setThinkingLevel: unsupported("setThinkingLevel"),
  registerProvider: unsupported("registerProvider"),
  unregisterProvider: unsupported("unregisterProvider"),
  registerMcpServer: unsupported("registerMcpServer"),
  unregisterMcpServer: unsupported("unregisterMcpServer"),
  getMcpServers() { return []; },
  registerVirtualModel: unsupported("registerVirtualModel"),
  unregisterVirtualModel: unsupported("unregisterVirtualModel")
};

const sanitizeTool = (tool) => {
  const value = {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.promptSnippet === undefined ? {} : { promptSnippet: tool.promptSnippet }),
    ...(tool.promptGuidelines === undefined ? {} : { promptGuidelines: tool.promptGuidelines }),
    ...(tool.exposure === undefined ? {} : { exposure: tool.exposure }),
    ...(tool.namespace === undefined ? {} : { namespace: tool.namespace }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    ...(tool.defaultActive === undefined ? {} : { defaultActive: tool.defaultActive }),
    ...(tool.executionMode === undefined ? {} : { executionMode: tool.executionMode }),
    ...(tool.drone === undefined ? {} : { drone: tool.drone })
  };
  JSON.stringify(value);
  return value;
};

try {
  console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
  console.info = console.log;
  console.warn = console.log;
  const module = await import(pathToFileURL(entrypoint).href);
  const factory = module.default ?? module.register;
  if (typeof factory !== "function") throw new Error("Extension must export a default or register function");
  await factory(pi);
  protocol({ type: "ready", pid: process.pid, tools: [...tools.values()].map(sanitizeTool) });
} catch (error) {
  protocol({ type: "error", error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  process.exitCode = 1;
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.type === "close") { input.close(); process.exit(0); return; }
  if (message.type === "cancel") { controllers.get(message.id)?.abort(); return; }
  if (message.type !== "invoke") return;
  const tool = tools.get(message.tool);
  if (!tool) { protocol({ type: "result", id: message.id, ok: false, error: "Unknown sandbox tool: " + message.tool }); return; }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  try {
    const value = await tool.execute(message.toolCallId, message.params, controller.signal, undefined, {});
    protocol({ type: "result", id: message.id, ok: true, value });
  } catch (error) {
    protocol({ type: "result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    controllers.delete(message.id);
  }
});
`;

function uniquePaths(paths: readonly string[]): string[] {
	return [...new Set(paths.map((path) => resolve(path)))];
}

function canonicalPath(path: string): string {
	const resolved = resolve(path);
	try {
		return realpathSync.native(resolved);
	} catch {
		return resolved;
	}
}

function safeId(value: string): string {
	return value.replace(/[^a-z0-9._-]/giu, "-").slice(0, 64) || "plugin";
}

function permissionFlags(name: string, paths: readonly string[]): string[] {
	return paths.map((path) => `--${name}=${path}`);
}

function packageReadRoots(policy: PluginSandboxPolicy): string[] {
	const entry = canonicalPath(policy.entrypoint);
	const packageRoot = canonicalPath(policy.packageRoot);
	const cwd = canonicalPath(policy.cwd);
	const roots = uniquePaths([packageRoot, cwd, dirname(entry), ...(policy.filesystem?.read ?? [])]);
	// Dependencies are normally hoisted to the first node_modules ancestor. Keep
	// this explicit instead of inheriting NODE_PATH or the host's whole filesystem.
	let current = packageRoot;
	while (current !== dirname(current)) {
		roots.push(...uniquePaths([join(current, "node_modules")]));
		current = dirname(current);
	}
	return uniquePaths(roots);
}

function allowedEnvironment(policy: PluginSandboxPolicy, sandboxDir: string): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {
		PATH: process.env.PATH ?? "",
		HOME: sandboxDir,
		TMPDIR: sandboxDir,
		TMP: sandboxDir,
		TEMP: sandboxDir,
		LANG: process.env.LANG ?? "C.UTF-8",
		NODE_ENV: "production",
	};
	for (const key of policy.environment ?? []) {
		if (process.env[key] !== undefined) environment[key] = process.env[key];
	}
	// process.execPath is the application executable in Electron. Without this
	// host-controlled variable it starts another app, not a Node protocol worker.
	if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = "1";
	return environment;
}

function childError(child: ChildProcessWithoutNullStreams, stderr: string): Error {
	const detail = stderr.trim();
	return new Error(
		`Plugin sandbox process exited (${child.exitCode ?? "unknown"})${detail ? `: ${detail}` : ""}`,
	);
}

export class PluginSandboxSession {
	private child: ChildProcessWithoutNullStreams | undefined;
	private lines: Interface | undefined;
	private sandboxDir: string | undefined;
	private readonly pending = new Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
			signal?: AbortSignal;
			onAbort?: () => void;
		}
	>();
	private sequence = 0;
	private stderr = "";
	private readyPromise: Promise<PluginSandboxReady> | undefined;
	private closed = false;

	constructor(private readonly policy: PluginSandboxPolicy) {}

	async start(): Promise<PluginSandboxReady> {
		if (this.closed) throw new Error("Plugin sandbox is closed");
		if (this.readyPromise) return this.readyPromise;
		this.readyPromise = this.launch();
		return this.readyPromise;
	}

	private async launch(): Promise<PluginSandboxReady> {
		const network = this.policy.network ?? [];
		if (network.length > 0 && (network.length !== 1 || network[0] !== "*")) {
			throw new Error(
				"Plugin sandbox cannot enforce hostname-scoped network permissions; only an explicit ['*'] grants all network access",
			);
		}
		// Node before v25 leaves network unrestricted under its permission model.
		// Refuse before loading plugin code instead of silently weakening isolation.
		if (!process.allowedNodeEnvironmentFlags.has("--allow-net")) {
			throw new Error(
				`Plugin sandbox is unavailable: Node ${process.versions.node} has no network permission enforcement (--allow-net)`,
			);
		}
		const entrypoint = canonicalPath(this.policy.entrypoint);
		const sandboxDir = await mkdtemp(join(tmpdir(), `drone-plugin-${safeId(this.policy.pluginId)}-`));
		this.sandboxDir = sandboxDir;
		const args = ["--permission"];
		const read = packageReadRoots(this.policy);
		args.push(...permissionFlags("allow-fs-read", read));
		const write = uniquePaths([sandboxDir, ...(this.policy.filesystem?.write ?? [])]);
		args.push(...permissionFlags("allow-fs-write", write));
		if (network.length === 1) args.push("--allow-net");
		if (this.policy.allowChildProcess) args.push("--allow-child-process");
		args.push("--input-type=module", "--eval", WORKER_SOURCE, entrypoint);
		const child = spawn(process.execPath, args, {
			cwd: canonicalPath(this.policy.cwd),
			env: allowedEnvironment(this.policy, sandboxDir),
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child = child;
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8_000);
		});
		const timeoutMs = this.policy.timeoutMs ?? 15_000;
		return await new Promise<PluginSandboxReady>((resolveReady, rejectReady) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				void this.close();
				rejectReady(new Error(`Plugin sandbox startup timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			const finish = (callback: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				callback();
			};
			this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
			this.lines.on("line", (line) => {
				let message: SandboxMessage;
				try {
					message = JSON.parse(line) as SandboxMessage;
				} catch {
					return;
				}
				if (message.type === "ready") {
					finish(() => resolveReady({ pid: message.pid, tools: message.tools }));
					return;
				}
				if (message.type === "error") {
					finish(() => rejectReady(new Error(message.error)));
					return;
				}
				this.handleMessage(message);
			});
			child.once("error", (error) => {
				finish(() => rejectReady(error));
			});
			child.once("exit", () => {
				if (!settled) finish(() => rejectReady(childError(child, this.stderr)));
				for (const pending of this.pending.values()) {
					clearTimeout(pending.timer);
					if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
					pending.reject(childError(child, this.stderr));
				}
				this.pending.clear();
			});
		});
	}

	private handleMessage(message: ResultMessage | UpdateMessage): void {
		if (message.type === "update") return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		clearTimeout(pending.timer);
		if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
		if (message.ok) pending.resolve(message.value);
		else pending.reject(new Error(message.error ?? "Plugin sandbox invocation failed"));
	}

	async invoke(tool: string, toolCallId: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		await this.start();
		if (!this.child || this.closed) throw new Error("Plugin sandbox is closed");
		const id = `${this.policy.pluginId}:${++this.sequence}`;
		return await new Promise<unknown>((resolveResult, rejectResult) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.child?.kill("SIGKILL");
				rejectResult(
					new Error(`Plugin sandbox invocation timed out after ${this.policy.timeoutMs ?? 15_000}ms`),
				);
			}, this.policy.timeoutMs ?? 15_000);
			const abort = () => {
				clearTimeout(timer);
				this.pending.delete(id);
				this.child?.stdin.write(`${JSON.stringify({ type: "cancel", id })}\n`);
				rejectResult(new Error("Plugin sandbox invocation aborted"));
			};
			if (signal?.aborted) return abort();
			this.pending.set(id, { resolve: resolveResult, reject: rejectResult, timer, signal, onAbort: abort });
			signal?.addEventListener("abort", abort, { once: true });
			this.child?.stdin.write(`${JSON.stringify({ type: "invoke", id, tool, toolCallId, params })}\n`);
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.lines?.close();
		if (this.child && !this.child.killed) {
			this.child.stdin.write('{"type":"close"}\n');
			this.child.stdin.end();
			await new Promise<void>((resolveClose) => {
				const timer = setTimeout(() => {
					this.child?.kill("SIGKILL");
					resolveClose();
				}, 500);
				this.child?.once("close", () => {
					clearTimeout(timer);
					resolveClose();
				});
			});
		}
		for (const pending of this.pending.values()) pending.reject(new Error("Plugin sandbox closed"));
		this.pending.clear();
		if (this.sandboxDir) await rm(this.sandboxDir, { recursive: true, force: true });
	}
}

/** Adapt a sandbox session to the Pi inline-extension contract. */
export function createProcessSandboxedExtension(policy: PluginSandboxPolicy): InlineExtension {
	const session = new PluginSandboxSession(policy);
	return {
		name: `sandbox:${policy.pluginId}`,
		hidden: true,
		factory: async (pi) => {
			const ready = await session.start();
			for (const declaration of ready.tools) {
				pi.registerTool({
					...declaration,
					parameters: declaration.parameters as ToolDefinition["parameters"],
					execute: (toolCallId, params, signal) =>
						session.invoke(declaration.name, toolCallId, params, signal) as ReturnType<
							ToolDefinition["execute"]
						>,
				} as ToolDefinition);
			}
			pi.on("session_shutdown", () => {
				void session.close();
			});
		},
	};
}

export function sandboxEntrypointUrl(path: string): string {
	return pathToFileURL(resolve(path)).href;
}
