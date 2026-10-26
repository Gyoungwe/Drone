import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import type {
	PluginRuntimeContext,
	PluginRuntimeFactory,
	PluginRuntimeInstance,
} from "@gyoungwe/plugin-api/runtime";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { pluginRuntimeExecutable } from "../plugin-runtime-executable";
import { PROCESS_RUNTIME_WORKER } from "./process-runtime-worker";

export interface ProcessPluginRuntimeOptions {
	readonly pluginId: string;
	readonly entrypoint: string;
	readonly packageRoot: string;
	/** Archive-verified Node runtime already shipped by the host. */
	readonly runtimeDirectory?: string;
}

const declarationSchema = Type.Record(
	Type.String(),
	Type.Object({
		inputSchema: Type.Record(Type.String(), Type.Unknown()),
		resultSchema: Type.Record(Type.String(), Type.Unknown()),
		effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
	}),
);
const messageSchema = Type.Union([
	Type.Object({ type: Type.Literal("ready"), operations: declarationSchema }),
	Type.Object({
		type: Type.Literal("result"),
		id: Type.String(),
		ok: Type.Literal(true),
		value: Type.Unknown(),
	}),
	Type.Object({
		type: Type.Literal("result"),
		id: Type.String(),
		ok: Type.Literal(false),
		error: Type.String(),
	}),
	Type.Object({ type: Type.Literal("error"), error: Type.String() }),
	Type.Object({ type: Type.Literal("canceled") }),
]);
type Message = Static<typeof messageSchema>;
type Declarations = Static<typeof declarationSchema>;

function staysInPackage(root: string, path: string): boolean {
	const pathRelative = relative(root, path);
	return pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`) && !isAbsolute(pathRelative);
}

/** Node's read permission follows data symlinks; validate every grant target before launch. */
function checkPackageLinks(root: string, directory = root): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink() && !staysInPackage(root, realpathSync(path))) {
			throw new Error("Plugin runtime package symlink escapes its read grant");
		}
		if (entry.isDirectory()) checkPackageLinks(root, path);
	}
}

/** Only called after registry authorization. No plugin import occurs in this process. */
export function createProcessPluginRuntime(options: ProcessPluginRuntimeOptions): PluginRuntimeFactory {
	return async (context) => {
		context.signal.throwIfAborted();
		const executable = pluginRuntimeExecutable(options.runtimeDirectory);
		const packageRoot = realpathSync(options.packageRoot);
		const entrypoint = realpathSync(options.entrypoint);
		if (!staysInPackage(packageRoot, entrypoint)) {
			throw new Error("Plugin runtime entrypoint escapes its package");
		}
		checkPackageLinks(packageRoot);
		const child = spawn(
			executable,
			[
				"--permission",
				`--allow-fs-read=${packageRoot}`,
				"--input-type=module",
				"--eval",
				PROCESS_RUNTIME_WORKER,
				entrypoint,
			],
			{
				cwd: packageRoot,
				// No inherited secrets, PATH, NODE_OPTIONS, filesystem write, network or subprocess grants.
				env: {
					NODE_ENV: "production",
					...(process.versions.electron && !options.runtimeDirectory ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				},
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			},
		);
		return new RuntimeProcess(options.pluginId, child, context).start();
	};
}

class RuntimeProcess {
	private sequence = 0;
	private failure: Error | undefined;
	private stderr = "";
	private disposed = false;
	private shutdownTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly closed: Promise<void>;
	private readonly pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
	>();
	private readonly ready: Promise<Declarations>;
	private resolveReady!: (operations: Declarations) => void;
	private rejectReady!: (error: Error) => void;

	constructor(
		private readonly pluginId: string,
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly context: PluginRuntimeContext,
	) {
		this.ready = new Promise((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8000);
		});
		lines.on("line", (line) => {
			let message: unknown;
			try {
				message = JSON.parse(line);
			} catch (error) {
				this.fail(new Error("Plugin runtime emitted invalid JSON", { cause: error }));
				return;
			}
			if (!Check(messageSchema, message)) {
				this.fail(new Error("Plugin runtime emitted an invalid protocol message"));
				return;
			}
			this.receive(message as Message);
		});
		child.once("error", (error) => this.fail(error));
		child.stdin.on("error", (error) => this.fail(error));
		this.closed = new Promise((resolve) =>
			child.once("close", (code) => {
				clearTimeout(this.shutdownTimer);
				context.signal.removeEventListener("abort", this.stop);
				lines.close();
				if (!this.disposed || code !== 0) {
					this.failure ??= new Error(`Plugin runtime ${pluginId} exited (${code}): ${this.stderr.trim()}`);
				}
				const error = this.failure ?? new Error(`Plugin runtime ${pluginId} is closed`);
				this.rejectReady(error);
				for (const pending of this.pending.values()) {
					pending.cleanup();
					pending.reject(error);
				}
				this.pending.clear();
				resolve();
			}),
		);
		context.signal.addEventListener("abort", this.stop, { once: true });
		if (context.signal.aborted) this.stop();
	}

	private readonly stop = () => {
		this.send({ type: "stop" });
		this.boundShutdown();
	};

	private boundShutdown(): void {
		if (this.shutdownTimer) return;
		this.shutdownTimer = setTimeout(
			() => this.fail(new Error(`Plugin runtime ${this.pluginId} did not settle shutdown within 500ms`)),
			500,
		);
	}

	private fail(error: Error): void {
		this.failure ??= error;
		this.child.kill("SIGKILL");
	}

	private send(message: unknown): void {
		if (!this.failure) this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private receive(message: Message): void {
		if (this.failure) return;
		if (message.type === "canceled") {
			this.fail(
				this.context.signal.aborted
					? this.context.signal.reason
					: new Error("Plugin runtime canceled without host cancellation"),
			);
			return;
		}
		if (message.type === "ready") {
			this.resolveReady(message.operations);
			return;
		}
		if (message.type === "error") {
			this.fail(new Error(message.error));
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			this.fail(new Error("Plugin runtime replied to an unknown invocation"));
			return;
		}
		this.pending.delete(message.id);
		pending.cleanup();
		if (message.ok) pending.resolve(message.value);
		else pending.reject(new Error(message.error));
	}

	async start(): Promise<PluginRuntimeInstance> {
		const timer = setTimeout(
			() => this.fail(new Error(`Plugin runtime ${this.pluginId} startup timed out after 15000ms`)),
			15000,
		);
		this.send({ type: "start", scope: this.context.scope });
		try {
			const declarations = await this.ready;
			return {
				operations: Object.fromEntries(
					Object.entries(declarations).map(([name, declaration]) => [
						name,
						{
							...declaration,
							execute: (input: unknown, { signal }: PluginRuntimeContext) =>
								this.request("invoke", { operation: name, input }, signal),
						},
					]),
				),
				dispose: async () => {
					if (this.failure) {
						await this.closed;
						throw this.failure;
					}
					this.boundShutdown();
					try {
						await this.request("dispose", {});
					} catch (error) {
						// A disposal failure must still close the isolated process before teardown returns.
						this.fail(error as Error);
						await this.closed;
						throw error;
					}
					this.disposed = true;
					await this.closed;
					if (this.failure) throw this.failure;
				},
			};
		} finally {
			clearTimeout(timer);
		}
	}

	private request(
		type: "invoke" | "dispose",
		payload: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		const id = `${++this.sequence}`;
		// Serialization is a trust boundary; fail before registering a pending request.
		const encoded = `${JSON.stringify({ type, id, ...payload })}\n`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => this.fail(new Error(`Plugin runtime ${this.pluginId} invocation timed out after 15000ms`)),
				15000,
			);
			const cancel = () => this.send({ type: "cancel", id });
			this.pending.set(id, {
				resolve,
				reject,
				cleanup: () => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", cancel);
				},
			});
			this.child.stdin.write(encoded);
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
		});
	}
}
