import { join } from "node:path";
import { type BackendServices, createLogger } from "@drone/backend";
import type {
	AskRequest,
	AskResolved,
	PermissionRequest,
	PermissionResolved,
	TrustRequest,
	UiPluginsEventPayload,
} from "@drone/shared";
import {
	AppContract,
	channelOf,
	McpContract,
	PermissionsContract,
	PluginRuntimeContract,
	packageLifecycleForReview,
	SessionsContract,
	SettingsContract,
	UiPluginsContract,
} from "@drone/shared";
import { app, BrowserWindow, webContents } from "electron";
import type { PluginHostLoaderDiscovery } from "../optional-plugin-hosts";
import { onResearchSkillUpdateState } from "../research-skill-updater";
import type { UiPluginManager } from "../ui-plugins/manager";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
import { onUpdateState } from "../updater";
import { registerAppIpc } from "./app";
import { registerBackgroundJobsIpc } from "./background-jobs";
import { registerComputeIpc } from "./compute";
import { registerDecisionsIpc } from "./decisions";
import { registerDiscoveryIpc } from "./discovery";
import { registerEvidenceIpc } from "./evidence";
import { registerInquiryIpc } from "./inquiry";
import { registerInstitutionalIpc } from "./institutional";
import { registerKnowledgeIpc } from "./knowledge";
import { registerMcpIpc } from "./mcp";
import { registerMemoryIpc } from "./memory";
import { packageMutationHost, registerPackagesIpc } from "./packages";
import { registerPermissionSettingsIpc } from "./permissions";
import { registerPluginCredentialsIpc } from "./plugin-credentials";
import { registerPluginRuntimeIpc } from "./plugin-runtime";
import { registerResearchIpc } from "./research";
import { registerSessionsIpc } from "./sessions";
import { registerSettingsIpc } from "./settings";
import { registerSubagentsIpc } from "./subagents";
import { registerUiPluginsIpc } from "./ui-plugins";

/** 向 renderer 推事件（backend 事件转发 + 更新状态共用） */
export function sendToRenderer(channel: string, payload: unknown): void {
	const window = BrowserWindow.getAllWindows()[0];
	if (window && !window.isDestroyed()) {
		window.webContents.send(channel, payload);
	}
}

/** Question events use the original approving window, including completion after cancellation. */
export function createSessionQuestionTransport(ownerId: number) {
	return {
		ownerId,
		send: (request: AskRequest): boolean => {
			const contents = webContents.fromId(ownerId);
			if (!contents || contents.isDestroyed()) return false;
			contents.send(channelOf(PermissionsContract, "askRequest"), request);
			return true;
		},
		resolved: (result: AskResolved): void => {
			const contents = webContents.fromId(ownerId);
			if (contents && !contents.isDestroyed()) {
				contents.send(channelOf(PermissionsContract, "askResolved"), result);
			}
		},
	};
}

function registerPackageMutationIpc(
	services: BackendServices,
	manager: UiPluginManager,
	runtime: DesktopRuntimeBridge,
	bootLoaders: readonly PluginHostLoaderDiscovery[],
	askPolicies: () => void,
): void {
	const runtimeDirectory = app.isPackaged
		? join(process.resourcesPath, "plugin-runtime")
		: join(__dirname, `../../plugin-runtime/${process.platform}-${process.arch}`);
	const publish = (event: UiPluginsEventPayload) =>
		sendToRenderer(channelOf(UiPluginsContract, "event"), event);
	registerPackagesIpc(
		services,
		undefined,
		async (receipt) => {
			if (receipt.status === "succeeded" && !receipt.source.startsWith("npm:")) await manager.scanAll();
			publish({ kind: "config", receipt: packageLifecycleForReview(receipt) });
			askPolicies();
		},
		({ sender }) => ({
			...packageMutationHost(manager, runtime, sender, runtimeDirectory, bootLoaders),
			onCandidatePending: () => publish({ kind: "config", reloadUi: false }),
		}),
	);
}

/**
 * Ask the user about package policies (install-time approval) once the first window is shown,
 * so the dialog has a parent — built-in and already enabled packages never pass the enable
 * switch — and again whenever an installed or updated package may need one.
 */
function askPoliciesOnShow(uiPlugins: { reconcilePolicies(): Promise<void> }): () => void {
	const ask = () => {
		uiPlugins
			.reconcilePolicies()
			.catch((error) => createLogger("ui-plugins").error("Plugin policy approval failed", error));
	};
	app.once("browser-window-created", (_event, window) => window.once("show", ask));
	return ask;
}

/**
 * IPC 注册组合入口：按域拆在 ./sessions ./settings ./permissions ./subagents ./packages ./app ./ui-plugins 等文件，
 * 这里只做拼装 + backend/updater 事件转发到 renderer。
 */
export function registerIpc(
	backendServices: BackendServices,
	uiPluginsManager: UiPluginManager,
	runtime: DesktopRuntimeBridge,
	getIncidentSnapshot?: () => unknown,
	bootLoaders: readonly PluginHostLoaderDiscovery[] = [],
): void {
	// The desktop host binds contracts from the composition root directly. The
	// individual IPC modules retain narrow legacy overloads for third-party
	// integrations, but production wiring never walks through PiBackend fields.
	const askPolicies = askPoliciesOnShow(registerUiPluginsIpc(uiPluginsManager, runtime));
	registerSessionsIpc(backendServices);
	registerSettingsIpc(backendServices);
	registerMcpIpc(backendServices);
	registerPermissionSettingsIpc(backendServices);
	registerSubagentsIpc(backendServices);
	registerKnowledgeIpc(backendServices);
	registerComputeIpc(backendServices, sendToRenderer);
	registerDiscoveryIpc(backendServices);
	registerEvidenceIpc(backendServices.analysisEvidence);
	registerDecisionsIpc(backendServices);
	registerPackageMutationIpc(backendServices, uiPluginsManager, runtime, bootLoaders, askPolicies);
	registerAppIpc(backendServices.diagnostics, getIncidentSnapshot);
	registerInstitutionalIpc(backendServices);
	registerInquiryIpc(backendServices, sendToRenderer);
	registerPluginRuntimeIpc(runtime);
	registerPluginCredentialsIpc(uiPluginsManager);
	runtime.onEvent((owner, event) => {
		const contents = webContents.fromId(owner.id);
		if (contents && !contents.isDestroyed()) contents.send(channelOf(PluginRuntimeContract, "event"), event);
	});
	registerMemoryIpc(backendServices);
	registerBackgroundJobsIpc(backendServices);
	registerResearchIpc(backendServices);
	// 热重载 watcher：插件源码变更 → 重建 → 推 changed 事件（renderer 经 loader reloadPlugin 热替换）
	uiPluginsManager.startWatcher((name) => {
		void runtime
			.revoke(name)
			.then(() => {
				sendToRenderer(channelOf(UiPluginsContract, "event"), { kind: "changed", name });
			})
			.catch((error) =>
				createLogger("plugin-runtime").error("Plugin reload stopped: runtime disposal failed", error),
			);
	});

	forwardSessionEvents(backendServices.sessions);
	onUpdateState((state) => {
		sendToRenderer(channelOf(AppContract, "updateEvent"), state);
	});
	onResearchSkillUpdateState((state) => {
		sendToRenderer(channelOf(AppContract, "researchSkillUpdateEvent"), state);
	});
}

function forwardSessionEvents(sessions: BackendServices["sessions"]): void {
	sessions.onEvent((sessionId, event) => {
		sendToRenderer(channelOf(SessionsContract, "event"), { sessionId, event });
	});
	sessions.onAskRequest((req: AskRequest) => {
		sendToRenderer(channelOf(PermissionsContract, "askRequest"), req);
	});
	sessions.onPermissionRequest((req: PermissionRequest) => {
		sendToRenderer(channelOf(PermissionsContract, "permissionRequest"), req);
	});
	// 权限裁决也回投渲染端，桌面卡片要同步撤掉
	sessions.onPermissionResolved((result: PermissionResolved) => {
		sendToRenderer(channelOf(PermissionsContract, "permissionResolved"), result);
	});
	sessions.onTrustRequest((req: TrustRequest) => {
		sendToRenderer(channelOf(PermissionsContract, "trustRequest"), req);
	});
	sessions.onLoginEvent((payload) => {
		sendToRenderer(channelOf(SettingsContract, "loginEvent"), payload);
	});
	sessions.onMcpStatus((cwd, status) => {
		sendToRenderer(channelOf(McpContract, "event"), { cwd, status });
	});
}
