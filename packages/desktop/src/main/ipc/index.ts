import { type BackendServices, createLogger } from "@drone/backend";
import type {
	AskRequest,
	AskResolved,
	PermissionRequest,
	PermissionResolved,
	TrustRequest,
} from "@drone/shared";
import { IpcChannels } from "@drone/shared";
import { BrowserWindow, webContents } from "electron";
import { onResearchSkillUpdateState } from "../research-skill-updater";
import type { UiPluginManager } from "../ui-plugins/manager";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
import { onUpdateState } from "../updater";
import { registerAppIpc } from "./app";
import { registerComputeIpc } from "./compute";
import { registerDecisionsIpc } from "./decisions";
import { registerDiscoveryIpc } from "./discovery";
import { registerEvidenceIpc } from "./evidence";
import { registerInquiryIpc } from "./inquiry";
import { registerInstitutionalIpc } from "./institutional";
import { registerKnowledgeIpc } from "./knowledge";
import { registerMcpIpc } from "./mcp";
import { registerMemoryIpc } from "./memory";
import { registerPackagesIpc } from "./packages";
import { registerPermissionSettingsIpc } from "./permissions";
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
			contents.send(IpcChannels.AskRequest, request);
			return true;
		},
		resolved: (result: AskResolved): void => {
			const contents = webContents.fromId(ownerId);
			if (contents && !contents.isDestroyed()) contents.send(IpcChannels.AskResolved, result);
		},
	};
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
): void {
	// The desktop host binds contracts from the composition root directly. The
	// individual IPC modules retain narrow legacy overloads for third-party
	// integrations, but production wiring never walks through PiBackend fields.
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
	registerPackagesIpc(backendServices, undefined, undefined, async (action) => {
		try {
			return await runtime.withTransition(async () => {
				try {
					return await action();
				} finally {
					await uiPluginsManager.scanAll();
				}
			});
		} finally {
			// Notify only after the mutation barrier is released, including a failed update.
			sendToRenderer(IpcChannels.UiPluginsEvent, { kind: "config" });
		}
	});
	registerAppIpc(backendServices.diagnostics, getIncidentSnapshot);
	registerInstitutionalIpc(backendServices);
	registerInquiryIpc(backendServices, sendToRenderer);
	registerUiPluginsIpc(uiPluginsManager, runtime);
	registerPluginRuntimeIpc(runtime);
	runtime.onEvent((owner, event) => {
		const contents = webContents.fromId(owner.id);
		if (contents && !contents.isDestroyed()) contents.send(IpcChannels.PluginRuntimeEvent, event);
	});
	registerMemoryIpc(backendServices);
	registerResearchIpc(backendServices);
	// 热重载 watcher：插件源码变更 → 重建 → 推 changed 事件（renderer 经 loader reloadPlugin 热替换）
	uiPluginsManager.startWatcher((name) => {
		void runtime
			.revoke(name)
			.then(() => {
				sendToRenderer(IpcChannels.UiPluginsEvent, { kind: "changed", name });
			})
			.catch((error) =>
				createLogger("plugin-runtime").error("Plugin reload stopped: runtime disposal failed", error),
			);
	});

	backendServices.sessions.onEvent((sessionId, event) => {
		sendToRenderer(IpcChannels.Event, { sessionId, event });
	});
	backendServices.sessions.onAskRequest((req: AskRequest) => {
		sendToRenderer(IpcChannels.AskRequest, req);
	});
	backendServices.sessions.onPermissionRequest((req: PermissionRequest) => {
		sendToRenderer(IpcChannels.PermissionRequest, req);
	});
	// 权限裁决也回投渲染端，桌面卡片要同步撤掉
	backendServices.sessions.onPermissionResolved((result: PermissionResolved) => {
		sendToRenderer(IpcChannels.PermissionResolved, result);
	});
	backendServices.sessions.onTrustRequest((req: TrustRequest) => {
		sendToRenderer(IpcChannels.TrustRequest, req);
	});
	backendServices.sessions.onLoginEvent((payload) => {
		sendToRenderer(IpcChannels.SettingsLoginEvent, payload);
	});
	backendServices.sessions.onMcpStatus((cwd, status) => {
		sendToRenderer(IpcChannels.McpEvent, { cwd, status });
	});
	onUpdateState((state) => {
		sendToRenderer(IpcChannels.UpdateEvent, state);
	});
	onResearchSkillUpdateState((state) => {
		sendToRenderer(IpcChannels.ResearchSkillUpdateEvent, state);
	});
}
