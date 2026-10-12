import type { BackendServices } from "@drone/backend";
import { IpcChannels, MemoryContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 观察记忆 IPC：按项目目录读状态、开关、清空。 */
export function registerMemoryIpc(services: Pick<BackendServices, "memory">): void {
	const implementation: ContractImplementation<typeof MemoryContract> = {
		getStatus: (cwd) => services.memory.getStatus(cwd),
		setEnabled: (cwd, enabled) => services.memory.setEnabled(cwd, enabled),
		clear: (cwd) => services.memory.clear(cwd),
	};
	bindContract(MemoryContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				getStatus: IpcChannels.MemoryGetStatus,
				setEnabled: IpcChannels.MemorySetEnabled,
				clear: IpcChannels.MemoryClear,
			})[method as keyof typeof MemoryContract.methods],
	});
}
