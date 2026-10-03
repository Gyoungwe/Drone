import { IpcChannels, LanContract } from "@drone/shared";
import type { LanObserverHandle } from "../lan";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** LAN Observer IPC：仅控制本机服务开关与远程控制开关。 */
export function registerLanIpc(lan: LanObserverHandle): void {
	const implementation: ContractImplementation<typeof LanContract> = {
		getStatus: () => lan.getStatus(),
		setEnabled: (enabled) => lan.setEnabled(enabled),
		setRemoteControl: (enabled) => lan.setRemoteControl(enabled),
	};
	bindContract(LanContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				getStatus: IpcChannels.LanGetStatus,
				setEnabled: IpcChannels.LanSetEnabled,
				setRemoteControl: IpcChannels.LanSetRemoteControl,
			})[method as keyof typeof LanContract.methods],
	});
}
