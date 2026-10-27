import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionContext, ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";
import { type PluginSandboxPolicy, PluginSandboxSession } from "../plugin-sandbox";
import { awaitSandboxDialog } from "../plugin-sandbox-ui";
import { hostText } from "../reply-language";

const log = createLogger("plugin-sandbox");

/** Pi 1.1.0's pre-import hook is patched locally; remove the patch once upstream provides this hook. */
export function sandboxExtensionFactory(
	runtimeDirectory: string,
	trustedEntrypoints: readonly string[],
	cwd: string,
): (path: string) => Promise<ExtensionFactory | undefined> {
	const trusted = new Set(trustedEntrypoints.map((path) => realpathSync(path)));
	return async (path) => {
		const entrypoint = realpathSync(resolve(path));
		if (trusted.has(entrypoint)) return undefined;
		let packageRoot = dirname(entrypoint);
		while (!existsSync(join(packageRoot, "package.json")) && dirname(packageRoot) !== packageRoot)
			packageRoot = dirname(packageRoot);
		if (dirname(packageRoot) === packageRoot) packageRoot = dirname(entrypoint);
		const manifest = join(packageRoot, "package.json");
		const name = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).name : undefined;
		const pluginId = typeof name === "string" ? name : entrypoint;
		const policy: PluginSandboxPolicy = {
			pluginId,
			entrypoint,
			packageRoot,
			cwd,
			runtimeDirectory,
			bundleEntrypoint: true,
		};
		return async (pi) => {
			const discovery = new PluginSandboxSession(policy);
			let ready: Awaited<ReturnType<PluginSandboxSession["start"]>>;
			try {
				ready = await discovery.start();
			} finally {
				await discovery.close();
			}
			const lifecycle = new AbortController();
			let active: PluginSandboxSession | undefined;
			let opening: Promise<PluginSandboxSession> | undefined;
			const open = async (ctx: ExtensionContext, signal: AbortSignal): Promise<PluginSandboxSession> => {
				const granted =
					ctx.hasUI &&
					(await awaitSandboxDialog(
						() =>
							ctx.ui.confirm(
								hostText(
									`允许 ${pluginId} 在本次会话中联网？`,
									`Allow ${pluginId} network access for this session?`,
								),
								hostText(
									"此扩展将在独立进程中运行。允许后可访问所有网络地址；只读取扩展包与依赖，不继承宿主凭据，不能创建子进程。停用扩展或结束会话会关闭进程。",
									"This extension runs in a separate process. Allowing grants all network addresses; file reads are limited to its package and dependencies, without host credentials or child processes. Disabling it or ending the session closes the process.",
								),
								{ signal },
							),
						signal,
					));
				if (!granted) throw new Error("Plugin network permission denied");
				const session = new PluginSandboxSession({ ...policy, network: ["*"] });
				try {
					const started = await session.start();
					signal.throwIfAborted();
					log.info("plugin worker started", {
						pluginId,
						pid: started.pid,
						runtime: "bundled",
						network: "all-explicitly-approved",
					});
					active = session;
					return session;
				} catch (error) {
					await session.close();
					throw error;
				}
			};
			for (const declaration of ready.tools) {
				pi.registerTool({
					...declaration,
					parameters: declaration.parameters as ToolDefinition["parameters"],
					async execute(toolCallId, params, signal, update, ctx) {
						const invocationSignal = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal;
						invocationSignal.throwIfAborted();
						let session = active;
						if (!session) {
							opening ??= open(ctx, invocationSignal);
							try {
								session = await opening;
							} finally {
								opening = undefined;
							}
						}
						invocationSignal.throwIfAborted();
						return session.invoke(
							declaration.name,
							toolCallId,
							params,
							invocationSignal,
							ctx,
							update,
						) as ReturnType<ToolDefinition["execute"]>;
					},
				} as ToolDefinition);
			}
			pi.on("session_shutdown", async () => {
				lifecycle.abort();
				if (opening) await Promise.allSettled([opening]);
				if (active) await active.close();
			});
		};
	};
}
