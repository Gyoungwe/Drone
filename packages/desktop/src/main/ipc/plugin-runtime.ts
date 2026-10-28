import { IpcChannels, PluginRuntimeContract } from "@drone/shared";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
import { bindContract } from "./bind-contract";

export function registerPluginRuntimeIpc(runtime: DesktopRuntimeBridge): void {
	bindContract(
		PluginRuntimeContract,
		(event) => ({
			invoke: (...args) => runtime.invoke(event.sender, args[0], args[1], args[2], args[3], args[4]),
			cancel: (binding, selectionToken, requestId) =>
				runtime.cancel(event.sender, binding, selectionToken, requestId),
			selectSession: (sessionId) => runtime.selectSession(event.sender, sessionId),
		}),
		{
			channelForMethod: (_contract, method) =>
				({
					selectSession: IpcChannels.PluginRuntimeSelectSession,
					invoke: IpcChannels.PluginRuntimeInvoke,
					cancel: IpcChannels.PluginRuntimeCancel,
				})[method as keyof typeof PluginRuntimeContract.methods],
		},
	);
}
