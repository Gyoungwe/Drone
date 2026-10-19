import { researchBundlePaths } from "./research-bundle";
import { researchSkillPackPaths } from "./research-skill-packs";
import {
	configureResearchSkillUpdater,
	readResearchSkillPackInstall,
	scheduleResearchSkillUpdateCheck,
} from "./research-skill-updater";
import { desktopSystemPrompt } from "./system-prompt";
import "./pi-package-dir";
import "./dev-agent-dir";
import "./fix-path";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type BackendServices,
	createBackend,
	createLogger,
	initLogging,
	setReplyLanguage,
} from "@drone/backend";
import { app, BrowserWindow, dialog, Menu, nativeTheme, net, protocol } from "electron";
import { backgroundsDir } from "./background";
import { consoleDedupLogLine, consoleSignature, createConsoleDeduper } from "./console-dedup";
import { electronDesktopHost, launchedHidden } from "./desktop-host";
import { applyDesktopPrefs } from "./desktop-prefs";
import { HTML_PREVIEW_PROTOCOL, handleHtmlPreviewRequest } from "./html-preview-protocol";
import { registerIpc, sendToRenderer } from "./ipc";
import { migrateLegacyUserDir } from "./legacy-migration";
import { buildMenuTemplate, DESKTOP_COMMAND_CHANNEL } from "./menu";
import { UiPluginManager, uiPluginsResourcesDir } from "./ui-plugins/manager";
import { loadUiState } from "./ui-state";
import { initUpdater, scheduleAutoUpdateCheck } from "./updater";
import { applyChromeTheme, createWindow, resolveTheme } from "./window";

const log = createLogger("main");
// Electron derives the native macOS About label from the package name unless
// the product name is set explicitly.  Keep the user-facing app name stable.
app.setName("Drone");
let backendServices: BackendServices | undefined;
let uiPluginsManager: UiPluginManager;
let latestIncidentSnapshot: ReturnType<typeof buildIncidentSnapshot> | undefined;

/** renderer 加载自定义背景图的协议（pi-bg://background/<文件名>，只读 userData/backgrounds/） */
const BG_PROTOCOL = "pi-bg";

/** 心跳周期（60s：事故形态是小时级爬坡，太快会把心跳自己变成噪音） */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * The compute adapter deliberately fails closed when no host approval bridge is
 * supplied.  Desktop is the host that can actually show that approval, so keep
 * the bridge here instead of silently granting remote effects in the backend.
 * Local fixture jobs are side-effect free with respect to another machine and
 * can proceed without interrupting the demo path.
 */
function authorizeComputeOperation(operation: {
	kind: string;
	hostId?: string;
	jobId?: string;
	terminalId?: string;
}): Promise<void> {
	if (operation.hostId === "local") return Promise.resolve();
	const target = operation.hostId ?? operation.jobId ?? operation.terminalId ?? "selected host";
	const labels: Record<string, string> = {
		probe_host: "检查远程主机环境",
		submit_job: "提交科研计算任务",
		get_logs: "读取任务日志",
		cancel_job: "取消科研计算任务",
		open_terminal: "打开远程终端",
		write_terminal: "向远程终端发送内容",
		close_terminal: "关闭远程终端",
	};
	return dialog
		.showMessageBox({
			type: "question",
			title: "确认远程操作",
			message: labels[operation.kind] ?? "执行远程操作",
			detail: `目标：${target}\n这次确认只覆盖当前一次操作。任务的工作目录、版本和资源限制仍由计算任务契约检查。`,
			buttons: ["允许", "取消"],
			defaultId: 1,
			cancelId: 1,
			noLink: true,
		})
		.then(({ response }) => {
			if (response !== 0) throw new Error("用户取消了远程操作");
		});
}

/** 每会话事件速率摘要（心跳与临终快照共用）：短 id 可 grep 反查，只记数字不记内容 */
function summarizeRates(
	rates: Map<string, { window60s: number[]; lastEventAt: number }>,
	now = Date.now(),
): { id: string; rate1m: number; lastEventAgeMs: number }[] {
	return [...rates.entries()].map(([id, r]) => ({
		id: id.slice(0, 8),
		rate1m: r.window60s.reduce((a, b) => a + b, 0),
		lastEventAgeMs: Math.max(0, now - r.lastEventAt),
	}));
}

/** renderer/gpu 进程资源摘要（appMetrics 里 renderer 进程的 type 为 "Tab"；
 *  本版 Electron CPUUsage 无 percent 字段，只取内存 workingSetSize(KB)） */
function summarizeProcesses(metrics: ReturnType<typeof app.getAppMetrics>) {
	return metrics
		.filter((m) => m.type === "Tab" || m.type === "GPU")
		.map((m) => ({ type: m.type, memoryMb: Math.round(m.memory.workingSetSize / 1024) }));
}

/** 临终快照（决策 3）：崩溃原因/进程资源/每会话事件速率与最近事件距 crash 的毫秒数——
 *  区分「正在流式输出中死亡」vs「空闲死亡」，事故归因关键 */
function buildIncidentSnapshot(details: { reason: string; exitCode: number }): {
	reason: string;
	exitCode: number;
	processes: ReturnType<typeof summarizeProcesses>;
	sessions: { id: string; rate1m: number; lastEventAgeMs: number }[];
	uptimeMs: number;
} {
	return {
		reason: details.reason,
		exitCode: details.exitCode,
		processes: summarizeProcesses(app.getAppMetrics()),
		sessions: summarizeRates(backendServices?.sessions.getEventRates() ?? new Map()),
		uptimeMs: Math.round(process.uptime() * 1000),
	};
}

protocol.registerSchemesAsPrivileged([
	{ scheme: BG_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } },
	{ scheme: HTML_PREVIEW_PROTOCOL, privileges: { standard: true, secure: true } },
]);

// Windows/Linux 不显示默认应用菜单（File/Edit/...）；macOS 菜单在系统菜单栏且承担复制粘贴等快捷键，保留
// macOS：安装带 ⌘K/⌘N/⌘W/⌘,/⌘⇧[ ] 的原生菜单，点击经 IPC 推给 renderer 的 desktop-command 总线（P5）
if (process.platform !== "darwin") Menu.setApplicationMenu(null);
else
	app
		.whenReady()
		.then(() =>
			Menu.setApplicationMenu(
				Menu.buildFromTemplate(
					buildMenuTemplate(
						(command) => sendToRenderer(DESKTOP_COMMAND_CHANNEL, command),
						app.getLocale().startsWith("zh") ? "zh" : "en",
						app.getName(),
					),
				),
			),
		);
// 系统深浅色变化（或用户切换主题导致 themeSource 变更）→ 同步窗口底色与 Windows 窗口按钮覆盖层
nativeTheme.on("updated", () => applyChromeTheme(nativeTheme.themeSource));

app.whenReady().then(async () => {
	if (process.argv.includes("--version")) {
		console.log(app.getVersion());
		app.exit(0);
		return;
	}
	initLogging(join(app.getPath("userData"), "logs"));
	log.info("app ready", { version: app.getVersion(), userData: app.getPath("userData") });

	// percho → Drone 更名：一次性把旧 ~/.percho 的 daily 工作区接过来（失败不阻断启动）
	await migrateLegacyUserDir();

	// 自定义背景图协议：pi-bg://background/<文件名> → userData/backgrounds/<文件名>（文件名白名单防路径穿越）
	protocol.handle(BG_PROTOCOL, (request) => {
		const name = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
		if (!/^[\w.-]+$/.test(name)) return new Response("invalid background name", { status: 400 });
		return net.fetch(pathToFileURL(join(backgroundsDir(), name)).toString());
	});

	// 交互式 HTML 预览：只服务用户显式打开的 HTML 所在目录（token 签发见 html-preview-protocol.ts）
	protocol.handle(HTML_PREVIEW_PROTOCOL, handleHtmlPreviewRequest);

	// renderer 异常/崩溃 → 日志（错误排查依赖 trace + 日志）+ 进程级死亡自动恢复
	const crashLog = createLogger("renderer");
	// console 错误签名去重（事故实录：monaco 一天 1005 条近似重复）：首次全量、重复计数、
	// 阈值/周期汇总；60s flush 定时器在 backend 初始化后统一启动（unref）
	const consoleDedup = createConsoleDeduper();
	// 0.5.2 白屏事故（2026-08-27 04:39）：流式 IPC 洪水下 renderer 被 SIGTERM 杀死，
	// 主进程/会话健在但窗口永久空白。AppErrorBoundary 只能接 React 层异常，
	// 进程级死亡必须在这里兜底 reload；短窗高频崩溃则停手转人工（防崩溃循环反复闪屏）
	const RELOAD_WINDOW_MS = 30_000;
	const MAX_AUTO_RELOADS = 3;
	const crashReloads: number[] = [];
	app.on("web-contents-created", (_e, contents) => {
		contents.on("render-process-gone", (_event, details) => {
			crashLog.error("render process gone", details);
			// clean-exit：reload/quit 等正常退出也触发本事件，不是崩溃
			if (details.reason === "clean-exit") return;
			// 临终快照（决策 3）：谁杀的/死前多忙/内存多高——reload 前同步取数，避免异步竞态。
			// 只记 id/速率/内存数字，绝不记消息正文
			latestIncidentSnapshot = buildIncidentSnapshot(details);
			crashLog.error("incident snapshot", latestIncidentSnapshot);
			const now = Date.now();
			while (crashReloads.length > 0 && now - (crashReloads[0] ?? 0) > RELOAD_WINDOW_MS) crashReloads.shift();
			if (crashReloads.length >= MAX_AUTO_RELOADS) {
				crashLog.error("renderer crash loop, auto reload suspended", {
					windowMs: RELOAD_WINDOW_MS,
					count: crashReloads.length,
				});
				const win = BrowserWindow.fromWebContents(contents);
				const options: Electron.MessageBoxOptions = {
					type: "error",
					title: "Drone",
					message: "界面进程反复崩溃",
					detail: "自动恢复已暂停，避免崩溃循环。可重试加载或退出（后台任务不受影响）。",
					buttons: ["重新加载", "退出"],
					defaultId: 0,
					noLink: true,
				};
				void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)).then(
					({ response }) => {
						if (response === 0) {
							crashReloads.length = 0;
							contents.reload();
						} else {
							app.quit();
						}
					},
				);
				return;
			}
			crashReloads.push(now);
			crashLog.info("renderer crashed, auto reloading", {
				reason: details.reason,
				exitCode: details.exitCode,
			});
			contents.reload();
		});
		contents.on("unresponsive", () => {
			crashLog.warn("renderer unresponsive");
		});
		contents.on("console-message", (details) => {
			// details.level: debug / info / warning / error（Electron 37+ 对象形式，旧数值签名已废弃）
			const { level, message, lineNumber, sourceId } = details;
			if (level === "error") {
				// 去重只对 error 分支（决策 4）；debug 本来就低价值，行为不变
				const signature = consoleSignature(message, sourceId);
				const decision = consoleDedup.observe(signature);
				if (decision.summary) {
					crashLog.error(...consoleDedupLogLine(decision.summary));
				} else if (decision.logFull) {
					crashLog.error("renderer console", { message, line: lineNumber, sourceId });
				}
			} else {
				crashLog.debug("renderer console", { message, line: lineNumber, sourceId });
			}
		});
	});

	process.on("uncaughtException", (err) => {
		log.error("uncaught exception", err);
	});
	process.on("unhandledRejection", (reason) => {
		log.error("unhandled rejection", reason);
	});

	process.env.DRONE_KNOWLEDGE_DIR ||= join(app.getPath("userData"), "knowledge");
	// Reply language before any session loads: last UI choice, else the OS locale (renderer re-syncs on start).
	setReplyLanguage(
		(await loadUiState())?.language ?? (app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en"),
	);
	if (process.platform === "win32") {
		// Python scripts run from the shell tools print UTF-8 instead of the ANSI code page (CP936 → mojibake).
		process.env.PYTHONUTF8 ||= "1";
		process.env.PYTHONIOENCODING ||= "utf-8";
	}
	process.env.DRONE_RESEARCH_WORKBENCH_ROOT = app.isPackaged
		? join(process.resourcesPath, "research-workbench")
		: join(__dirname, "../../../../.pi");
	configureResearchSkillUpdater(app.getPath("userData"));
	scheduleResearchSkillUpdateCheck();
	// Bundled pi packages (MCP runtime pi-mcp-adapter), staged by scripts/stage-pi-packages.mjs.
	const researchBundle = researchBundlePaths(
		process.env.DRONE_RESEARCH_WORKBENCH_ROOT,
		app.isPackaged
			? join(process.resourcesPath, "pi-packages", "node_modules")
			: join(__dirname, "../../pi-packages/node_modules"),
	);
	for (const warning of researchBundle.warnings) log.warn(warning);
	if (researchBundle.mcpRuntimePath) log.info("MCP runtime bundled", researchBundle.mcpRuntimePath);
	const installedResearchSkills = readResearchSkillPackInstall(app.getPath("userData"));
	const researchSkillPacks = researchSkillPackPaths(
		app.isPackaged
			? join(process.resourcesPath, "research-skills")
			: join(__dirname, "../../resources/research-skills"),
		{ includeAcademic: false, ...installedResearchSkills },
	);
	for (const warning of researchSkillPacks.warnings) log.warn(warning);
	backendServices = createBackend({
		userDataDir: app.getPath("userData"),
		computeAuthorizeRemoteOperation: authorizeComputeOperation,
		// Use one ledger per canonical workspace. The old single ledger remains
		// mounted read-only so an upgrade never rewrites unknown future schemas.
		projectsDir: join(app.getPath("userData"), "inquiry-projects"),
		legacyInquiryDir: join(app.getPath("userData"), "inquiry"),
		// 桌面端集成：UI 插件技能目录 + 内置协作 skill 目录（均随包分发）+ 系统提示词段落
		desktopIntegration: {
			appendSystemPrompt: desktopSystemPrompt(),
			additionalSkillPaths: [
				join(uiPluginsResourcesDir(), "skills"),
				// 内置协作 skill（channel-pickup/design-handoff）：语义上与 UI 插件无关，独立目录分发
				app.isPackaged ? join(process.resourcesPath, "skills") : join(__dirname, "../../resources/skills"),
				...researchBundle.additionalSkillPaths,
				...researchSkillPacks.paths,
			],
			additionalExtensionPaths: researchBundle.additionalExtensionPaths,
			additionalPromptTemplatePaths: researchSkillPacks.promptPaths,
			academicPiRoot: researchSkillPacks.academicPiRoot,
			...(researchBundle.mcpRuntimePath ? { mcpRuntimePath: researchBundle.mcpRuntimePath } : {}),
		},
	});
	await backendServices.sessions.init();

	// 心跳（决策 3，60s unref）：renderer 内存 + 每会话事件速率——白屏/冻结事故「死前多忙」的
	// 最后读数；快照/心跳只记 id/速率/内存数字，绝不记消息正文
	const heartbeat = setInterval(() => {
		try {
			const tabs = app.getAppMetrics().filter((m) => m.type === "Tab");
			const rendererMemoryMb = Math.round(tabs.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
			crashLog.info("renderer heartbeat", {
				rendererMemoryMb,
				sessions: summarizeRates(backendServices?.sessions.getEventRates() ?? new Map()),
			});
		} catch (err) {
			crashLog.warn("renderer heartbeat failed", err);
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref();
	// console 错误汇总周期 flush（决策 4）：慢烧场景补一条，有界不噪声
	const consoleFlush = setInterval(() => {
		for (const summary of consoleDedup.flush()) crashLog.error(...consoleDedupLogLine(summary));
	}, HEARTBEAT_INTERVAL_MS);
	consoleFlush.unref();
	uiPluginsManager = new UiPluginManager();
	await uiPluginsManager.init();
	registerIpc(backendServices, uiPluginsManager, () => latestIncidentSnapshot);
	await initUpdater();
	scheduleAutoUpdateCheck();
	const uiState = await loadUiState();
	// main 进程原生主题与 app 设置对齐（Windows 窗口按钮覆盖层/后续主题切换的 system 解析依赖它）
	nativeTheme.themeSource = uiState?.theme ?? "system";
	applyDesktopPrefs(uiState?.desktop, electronDesktopHost, app.isPackaged);
	createWindow(resolveTheme(uiState?.theme), launchedHidden);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow(resolveTheme(uiState?.theme));
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	backendServices?.dispose();
	uiPluginsManager?.disposeWatcher();
});
