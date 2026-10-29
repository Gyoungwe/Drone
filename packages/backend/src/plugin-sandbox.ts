import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { pathToFileURL } from "node:url";
import { Check } from "typebox/value";
import { pluginRuntimeExecutable } from "./plugin-runtime-executable";
import {
	awaitSandboxDialog,
	type PluginSandboxUiContext,
	type SandboxUiMessage,
	sandboxUiMessageSchema,
} from "./plugin-sandbox-ui";
import type { InlineExtension, ToolDefinition } from "./session-engine/sdk";
import { toolProgressSchema } from "./tool-progress";

type ToolProgress = NonNullable<Parameters<ToolDefinition["execute"]>[3]>;

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
	/** Host-owned, archive-verified runtime shipped outside app.asar. */
	readonly runtimeDirectory?: string;
	readonly bundleEntrypoint?: boolean;
}

export interface PluginSandboxToolDeclaration {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: unknown;
	readonly outputSchema?: ToolDefinition["outputSchema"];
	readonly constrainedSampling?: ToolDefinition["constrainedSampling"];
	readonly renderShell?: ToolDefinition["renderShell"];
	readonly promptSnippet?: string;
	readonly promptGuidelines?: readonly string[];
	readonly exposure?: string;
	readonly namespace?: ToolDefinition["namespace"];
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
const uiPending = new Map();
let uiSequence = 0;
const protocol = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const unsupported = (name) => () => { throw new Error("Process-sandbox extension API is not supported: " + name); };
const pi = {
  registerTool(tool) {
    for (const field of ["prepareArguments", "prepareLoadout", "renderCall", "renderResult"]) {
      if (tool[field] !== undefined) throw new Error("Process-sandbox tool feature is not supported: " + tool.name + "." + field);
    }
    tools.set(tool.name, tool);
  },
  on: unsupported("on"),
  events: { on: unsupported("events.on"), emit: unsupported("events.emit") },
  registerCommand: unsupported("registerCommand"),
  registerShortcut: unsupported("registerShortcut"),
  registerFlag: unsupported("registerFlag"),
  getFlag: unsupported("getFlag"),
  registerMessageRenderer: unsupported("registerMessageRenderer"),
  registerMarkdownTransformer: unsupported("registerMarkdownTransformer"),
  registerEntryRenderer: unsupported("registerEntryRenderer"),
  registerToolRenderer: unsupported("registerToolRenderer"),
  sendMessage: unsupported("sendMessage"),
  sendUserMessage: unsupported("sendUserMessage"),
  appendEntry: unsupported("appendEntry"),
  setSessionName: unsupported("setSessionName"),
  getSessionName: unsupported("getSessionName"),
  setLabel: unsupported("setLabel"),
  exec: unsupported("exec"),
  getActiveTools: unsupported("getActiveTools"),
  getAllTools: unsupported("getAllTools"),
  getSettings: unsupported("getSettings"),
  setActiveTools: unsupported("setActiveTools"),
  getCommands: unsupported("getCommands"),
  setModel: unsupported("setModel"),
  getThinkingLevel: unsupported("getThinkingLevel"),
  setThinkingLevel: unsupported("setThinkingLevel"),
  registerProvider: unsupported("registerProvider"),
  unregisterProvider: unsupported("unregisterProvider"),
  registerMcpServer: unsupported("registerMcpServer"),
  unregisterMcpServer: unsupported("unregisterMcpServer"),
  getMcpServers: unsupported("getMcpServers"),
  registerVirtualModel: unsupported("registerVirtualModel"),
  unregisterVirtualModel: unsupported("unregisterVirtualModel")
};

const toolContext = (callId, controller, hasUI) => {
  const request = (method, fields, opts = {}) => {
    const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
    signal.throwIfAborted();
    const requestId = String(++uiSequence);
    return new Promise((resolve, reject) => {
      const abort = () => {
        uiPending.delete(requestId);
        protocol({ type:"ui_cancel", id:callId, requestId });
        reject(signal.reason);
      };
      uiPending.set(requestId, { callId, method, resolve, reject, cleanup:()=>signal.removeEventListener("abort",abort) });
      signal.addEventListener("abort", abort, { once:true });
      protocol({ type:"ui_request", id:callId, requestId, method, ...fields, ...(opts.timeout === undefined ? {} : {timeout:opts.timeout}) });
    });
  };
  const ui = new Proxy({
    confirm: (title,message,opts) => request("confirm",{title,message},opts),
    select: (title,options,opts) => request("select",{title,options},opts),
    input: (title,placeholder,opts) => request("input",{title,placeholder},opts),
    notify: (message,severity) => { controller.signal.throwIfAborted(); protocol({type:"ui_notify",id:callId,message,severity}); },
  }, { get(target, name) { if (Object.hasOwn(target,name)) return target[name]; return unsupported("ctx.ui."+String(name)); } });
  return new Proxy({ hasUI, ui }, { get(target,name) { if(Object.hasOwn(target,name))return target[name]; throw new Error("Process-sandbox extension context is not supported: " + String(name)); } });
};

const sanitizeTool = (tool) => {
  const value = {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    ...(tool.constrainedSampling === undefined ? {} : { constrainedSampling: tool.constrainedSampling }),
    ...(tool.renderShell === undefined ? {} : { renderShell: tool.renderShell }),
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
  if (message.type === "ui_response") {
    const pending = uiPending.get(message.requestId);
    if (!pending) return;
    uiPending.delete(message.requestId);
    pending.cleanup();
    if (message.ok === false && typeof message.error === "string") pending.reject(new Error(message.error));
    else if (message.ok === true && (pending.method === "confirm" ? typeof message.value === "boolean" : message.value === null || typeof message.value === "string")) pending.resolve(message.value === null ? undefined : message.value);
    else pending.reject(new Error("Invalid sandbox UI response"));
    return;
  }
  if (message.type === "close") { input.close(); process.exit(0); return; }
  if (message.type === "cancel") { controllers.get(message.id)?.abort(); return; }
  if (message.type !== "invoke") return;
  const tool = tools.get(message.tool);
  if (!tool) { protocol({ type: "result", id: message.id, ok: false, error: "Unknown sandbox tool: " + message.tool }); return; }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  try {
    const update = message.updates ? value => {
      controller.signal.throwIfAborted();
      protocol({type:"update",id:message.id,value});
    } : undefined;
    const value = await tool.execute(message.toolCallId, message.params, controller.signal, update, toolContext(message.id, controller, message.hasUI));
    protocol({ type: "result", id: message.id, ok: true, value });
  } catch (error) {
    protocol({ type: "result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    controller.abort();
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
	const roots = uniquePaths([packageRoot, dirname(entry), ...(policy.filesystem?.read ?? [])]);
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
			uiContext?: PluginSandboxUiContext;
			uiAbort: AbortController;
			onUpdate?: ToolProgress;
		}
	>();
	private readonly uiDialogs = new Map<string, AbortController>();
	private sequence = 0;
	private stderr = "";
	private readyPromise: Promise<PluginSandboxReady> | undefined;
	private closed = false;
	private protocolFailure: Error | undefined;

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
		const executable = pluginRuntimeExecutable(this.policy.runtimeDirectory);
		let entrypoint = canonicalPath(this.policy.entrypoint);
		const sandboxDir = canonicalPath(
			await mkdtemp(join(tmpdir(), `drone-plugin-${safeId(this.policy.pluginId)}-`)),
		);
		this.sandboxDir = sandboxDir;
		const args = ["--permission"];
		if (this.policy.bundleEntrypoint) {
			// esbuild spawns a native executable; resolve from the physical unpacked tree in Electron.
			const esbuildUrl = pathToFileURL(createRequire(import.meta.url).resolve("esbuild")).href.replace(
				"/app.asar/",
				"/app.asar.unpacked/",
			);
			const { build } = (await import(esbuildUrl)) as typeof import("esbuild");
			const output = join(sandboxDir, "extension.mjs");
			const thisRuntime = this.policy.runtimeDirectory;
			await build({
				entryPoints: [entrypoint],
				outfile: output,
				bundle: true,
				platform: "node",
				format: "esm",
				logLevel: "silent",
				plugins: [
					{
						name: "installed-dependencies",
						setup(build) {
							build.onResolve({ filter: /^[^./]/ }, async (args) => {
								if (args.pluginData === "resolved" || args.path.startsWith("node:")) return;
								// Match the Pi 1.1.0 schema peer aliases for tool-only extensions.
								if (thisRuntime && (args.path === "typebox" || args.path === "@sinclair/typebox"))
									return { path: join(thisRuntime, "schema/build/index.mjs") };
								const dependency = await build.resolve(args.path, {
									resolveDir: args.resolveDir,
									kind: args.kind,
									pluginData: "resolved",
								});
								if (dependency.errors.length) return { errors: dependency.errors };
								return { path: dependency.path, external: true };
							});
						},
					},
				],
			});
			entrypoint = output;
		}
		const read = [...packageReadRoots(this.policy), sandboxDir];
		args.push(...permissionFlags("allow-fs-read", read));
		const write = uniquePaths([sandboxDir, ...(this.policy.filesystem?.write ?? [])]);
		args.push(...permissionFlags("allow-fs-write", write));
		if (network.length === 1) args.push("--allow-net");
		if (this.policy.allowChildProcess) args.push("--allow-child-process");
		args.push("--input-type=module", "--eval", WORKER_SOURCE, entrypoint);
		const child = spawn(executable, args, {
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
				if (this.protocolFailure) return;
				let message: SandboxMessage | SandboxUiMessage;
				try {
					message = JSON.parse(line) as SandboxMessage | SandboxUiMessage;
					if (!message || typeof message !== "object" || typeof message.type !== "string")
						throw new Error("Invalid sandbox protocol envelope");
				} catch (error) {
					const failure = new Error("Invalid plugin sandbox protocol message", { cause: error });
					this.protocolFailure = failure;
					this.stderr = failure.message;
					child.kill("SIGKILL");
					finish(() => rejectReady(failure));
					return;
				}
				if (message.type === "ui_request" || message.type === "ui_cancel" || message.type === "ui_notify") {
					if (!Check(sandboxUiMessageSchema, message)) {
						// A compromised child cannot send unchecked dialog arguments into the host UI.
						this.protocolFailure = new Error("Invalid plugin sandbox UI request");
						this.stderr = this.protocolFailure.message;
						child.kill("SIGKILL");
						return;
					}
					void this.handleUiMessage(message);
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
					pending.uiAbort.abort();
					if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
					pending.reject(childError(child, this.stderr));
				}
				this.pending.clear();
			});
		});
	}

	private async handleUiMessage(message: SandboxUiMessage): Promise<void> {
		const pending = this.pending.get(message.id);
		if (!pending || this.closed) return;
		const key = `${message.id}/${"requestId" in message ? message.requestId : "notify"}`;
		if (message.type === "ui_cancel") {
			this.uiDialogs.get(key)?.abort();
			return;
		}
		const dialog = new AbortController();
		this.uiDialogs.set(key, dialog);
		try {
			if (!pending.uiContext?.hasUI) throw new Error("Plugin UI is unavailable in this session");
			const ui = pending.uiContext.ui;
			if (message.type === "ui_notify") {
				ui.notify(message.message, message.severity);
				return;
			}
			const options = {
				signal: AbortSignal.any([pending.uiAbort.signal, dialog.signal]),
				timeout: message.timeout,
			};
			let value: string | boolean | undefined;
			switch (message.method) {
				case "confirm":
					value = await awaitSandboxDialog(
						() => ui.confirm(message.title, message.message, options),
						options.signal,
					);
					break;
				case "select":
					value = await awaitSandboxDialog(
						() => ui.select(message.title, message.options, options),
						options.signal,
					);
					break;
				case "input":
					value = await awaitSandboxDialog(
						() => ui.input(message.title, message.placeholder, options),
						options.signal,
					);
					break;
			}
			if (!this.pending.has(message.id) || this.closed || options.signal.aborted) return;
			this.child?.stdin.write(
				`${JSON.stringify({ type: "ui_response", requestId: message.requestId, ok: true, value: value ?? null })}\n`,
			);
		} catch (error) {
			// The originating tool receives UI failures; canceled calls have already lost their authority.
			if (!this.pending.has(message.id) || this.closed || pending.uiAbort.signal.aborted) return;
			const detail = error instanceof Error ? error.message : String(error);
			if (message.type === "ui_notify") {
				pending.reject(new Error(detail));
				pending.onAbort?.();
			} else {
				this.child?.stdin.write(
					`${JSON.stringify({ type: "ui_response", requestId: message.requestId, ok: false, error: detail })}\n`,
				);
			}
		} finally {
			this.uiDialogs.delete(key);
		}
	}

	private handleMessage(message: ResultMessage | UpdateMessage): void {
		const pending = this.pending.get(message.id);
		if (!pending) return;
		if (message.type === "update") {
			if (!pending.onUpdate || !Check(toolProgressSchema, message.value)) {
				this.protocolFailure = new Error("Invalid plugin sandbox tool progress");
				this.stderr = this.protocolFailure.message;
				this.child?.kill("SIGKILL");
				return;
			}
			try {
				pending.onUpdate(message.value as Parameters<ToolProgress>[0]);
			} catch (error) {
				// Observer failures belong to this tool call, including its cancellation cleanup.
				pending.reject(error as Error);
				pending.onAbort?.();
			}
			return;
		}
		this.pending.delete(message.id);
		clearTimeout(pending.timer);
		pending.uiAbort.abort();
		if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
		if (message.ok) pending.resolve(message.value);
		else pending.reject(new Error(message.error ?? "Plugin sandbox invocation failed"));
	}

	async invoke(
		tool: string,
		toolCallId: string,
		params: unknown,
		signal?: AbortSignal,
		uiContext?: PluginSandboxUiContext,
		onUpdate?: ToolProgress,
	): Promise<unknown> {
		await this.start();
		if (!this.child || this.closed) throw new Error("Plugin sandbox is closed");
		const id = `${this.policy.pluginId}:${++this.sequence}`;
		const uiAbort = new AbortController();
		return await new Promise<unknown>((resolveResult, rejectResult) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				uiAbort.abort();
				this.child?.kill("SIGKILL");
				rejectResult(
					new Error(`Plugin sandbox invocation timed out after ${this.policy.timeoutMs ?? 15_000}ms`),
				);
			}, this.policy.timeoutMs ?? 15_000);
			const abort = () => {
				clearTimeout(timer);
				this.pending.delete(id);
				uiAbort.abort();
				this.child?.stdin.write(`${JSON.stringify({ type: "cancel", id })}\n`);
				rejectResult(new Error("Plugin sandbox invocation aborted"));
			};
			if (signal?.aborted) return abort();
			this.pending.set(id, {
				resolve: resolveResult,
				reject: rejectResult,
				timer,
				signal,
				onAbort: abort,
				uiContext,
				uiAbort,
				onUpdate,
			});
			signal?.addEventListener("abort", abort, { once: true });
			this.child?.stdin.write(
				`${JSON.stringify({ type: "invoke", id, tool, toolCallId, params, updates: onUpdate !== undefined, hasUI: uiContext?.hasUI === true })}\n`,
			);
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		for (const pending of this.pending.values()) pending.uiAbort.abort();
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
		for (const pending of this.pending.values()) {
			pending.uiAbort.abort();
			pending.reject(new Error("Plugin sandbox closed"));
		}
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
					execute: (toolCallId, params, signal, update, ctx) =>
						session.invoke(declaration.name, toolCallId, params, signal, ctx, update) as ReturnType<
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
