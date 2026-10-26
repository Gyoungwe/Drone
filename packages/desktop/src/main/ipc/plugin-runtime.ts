import { IpcChannels, PluginRuntimeContract } from "@drone/shared";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
import { bindContract } from "./bind-contract";

export function registerPluginRuntimeIpc(runtime: DesktopRuntimeBridge): void {
	bindContract(
		PluginRuntimeContract,
		(event) => ({
			invoke: (binding, operation, input) => runtime.invoke(event.sender, binding, operation, input),
		}),
		{ channelForMethod: () => IpcChannels.PluginRuntimeInvoke },
	);
}
