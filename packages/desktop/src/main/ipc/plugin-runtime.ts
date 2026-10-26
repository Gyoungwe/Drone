import { IpcChannels, PluginRuntimeContract } from "@drone/shared";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
import { bindContract } from "./bind-contract";

export function registerPluginRuntimeIpc(runtime: DesktopRuntimeBridge): void {
	bindContract(
		PluginRuntimeContract,
		(event) => ({
			invoke: (binding, operation, input, selectionToken) =>
				runtime.invoke(event.sender, binding, operation, input, selectionToken),
			selectSession: (sessionId) => runtime.selectSession(event.sender, sessionId),
		}),
		{
			channelForMethod: (_contract, method) =>
				method === "selectSession" ? IpcChannels.PluginRuntimeSelectSession : IpcChannels.PluginRuntimeInvoke,
		},
	);
}
