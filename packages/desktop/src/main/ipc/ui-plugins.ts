import { channelOf, KNOWN_UI_SLOTS, UiPluginsContract } from "@drone/shared";
import { BrowserWindow, type IpcMainInvokeEvent, shell, type WebContents } from "electron";
import { loadUiPluginsConfig } from "../ui-plugins/config";
import type { UiPluginManager } from "../ui-plugins/manager";
import { requestPolicyApproval } from "../ui-plugins/policy-approval";
import { consentToRecord } from "../ui-plugins/policy-consent-store";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
import { bindContract, type ContractImplementation } from "./bind-contract";
import { sendToRenderer } from "./index";

/** 配置类变更（总开关/启用/指派）→ 通知 renderer 全量对齐 */
function pushConfigEvent(): void {
	sendToRenderer(channelOf(UiPluginsContract, "event"), { kind: "config" });
}

type ChangeConfiguration = <T>(action: () => Promise<T>) => Promise<T>;

function createPolicyApprovalFlow(
	manager: UiPluginManager,
	changeConfiguration: ChangeConfiguration,
	ask: typeof requestPolicyApproval,
) {
	// The startup check, a package change and a switch can each want a dialog; one is shown at a time.
	let dialogs: Promise<unknown> = Promise.resolve();
	const oneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
		const result = dialogs.then(task);
		dialogs = result.catch(() => undefined);
		return result;
	};
	const reconcilePolicies = () =>
		oneAtATime(async () => {
			const asked = new Set<string>();
			for (;;) {
				const source = manager.pendingPolicyApprovals().find((candidate) => !asked.has(candidate.pluginId));
				if (!source) return;
				asked.add(source.pluginId);
				const window = BrowserWindow.getAllWindows()[0];
				const parent = window && !window.isDestroyed() && window.isVisible() ? window : undefined;
				const approved = await ask(source, parent);
				await changeConfiguration(() => manager.recordPolicyDecision(source, approved));
			}
		});
	const setPluginEnabled = async (owner: WebContents, name: string, enabled: boolean): Promise<void> => {
		if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid plugin name: ${name}`);
		const info = manager.info(name);
		if (enabled && info?.invalidReason) throw new Error(info.invalidReason);
		// Approving the package's policy is a precondition of enabling (D-CRED-2). The user
		// answered in the host's own dialog, so a refusal leaves the plugin off without an error.
		const source = enabled ? manager.packageSourceOf(name) : undefined;
		const approval = source && manager.awaitsPolicyApproval(source) ? source : undefined;
		if (approval) {
			const parent = BrowserWindow.fromWebContents(owner) ?? undefined;
			const approved = await oneAtATime(
				async () => !manager.awaitsPolicyApproval(approval) || ask(approval, parent),
			);
			if (!approved) return;
		}
		await changeConfiguration(async () => {
			const { plugins, policyConsents } = await loadUiPluginsConfig();
			const trusted = enabled || (plugins[name]?.trusted ?? false);
			await manager.updateConfig({
				plugins: { [name]: { enabled, trusted } },
				...(approval
					? { policyConsents: { ...policyConsents, [approval.pluginId]: consentToRecord(approval) } }
					: {}),
			});
		});
	};
	return { reconcilePolicies, setPluginEnabled };
}

async function readPluginCode(
	manager: UiPluginManager,
	runtime: DesktopRuntimeBridge,
	name: string,
	owner: WebContents,
) {
	if (!manager.isEnabled(name)) return { error: "UI plugin is not enabled and trusted" };
	const directory = manager.pluginDirOf(name);
	const source = manager.runtimeSource(name);
	const code = await manager.readCode(name);
	if ("error" in code) return code;
	if (directory !== manager.pluginDirOf(name) || source !== manager.runtimeSource(name)) {
		return { error: "UI plugin installation changed while loading; reload required" };
	}
	const runtimeBinding = await runtime.bind(name, owner);
	return { ...code, ...(runtimeBinding === undefined ? {} : { runtimeBinding }) };
}

/** Binds UI plugin IPC and returns the serialized install-time policy check. */
export function registerUiPluginsIpc(
	manager: UiPluginManager,
	runtime: DesktopRuntimeBridge,
	ask = requestPolicyApproval,
): { reconcilePolicies(): Promise<void> } {
	const changeConfiguration: ChangeConfiguration = async (action) => {
		try {
			return await runtime.withUiTransition(action);
		} finally {
			// Failed persistence still drained old clients. Reload the configuration that actually survived.
			pushConfigEvent();
		}
	};
	const { reconcilePolicies, setPluginEnabled } = createPolicyApprovalFlow(manager, changeConfiguration, ask);
	const implementation = (event: IpcMainInvokeEvent): ContractImplementation<typeof UiPluginsContract> => ({
		getConfig: () => loadUiPluginsConfig(),
		setEnabled: async (enabled) => {
			await changeConfiguration(() => manager.updateConfig({ enabled }));
		},
		list: () => manager.list(),
		readCode: (name) => readPluginCode(manager, runtime, name, event.sender),
		// 启用=信任：enabled=true 时 trusted 一并落盘
		setPluginEnabled: (name, enabled) => setPluginEnabled(event.sender, name, enabled),
		assignSlot: async (slot, pluginName) => {
			if (!KNOWN_UI_SLOTS.includes(slot)) return;
			await changeConfiguration(async () => {
				const config = await loadUiPluginsConfig();
				const assignments = { ...config.assignments };
				if (pluginName === null) delete assignments[slot];
				else assignments[slot] = pluginName;
				await manager.updateConfig({ assignments });
			});
		},
		rebuild: async (name) => {
			const ok = await changeConfiguration(() => manager.ensureBuilt(name, true));
			if (!ok) {
				const info = manager.info(name);
				return { ok: false as const, error: info?.buildError ?? "构建失败" };
			}
			return { ok: true as const };
		},
		openDir: (...args) => {
			const name = args[0];
			const dir = typeof name === "string" ? manager.pluginDirOf(name) : manager.rootDir();
			if (!dir) return;
			void shell.openPath(dir);
		},
	});
	bindContract(UiPluginsContract, implementation);
	return { reconcilePolicies };
}
