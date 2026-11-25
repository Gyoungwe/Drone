import type { BackendServices } from "@drone/backend";
import { MemoryContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 观察记忆 IPC：按项目目录读状态、开关、清空、列表、删除、提升。 */
export function registerMemoryIpc(services: Pick<BackendServices, "memory">): void {
	const implementation: ContractImplementation<typeof MemoryContract> = {
		getStatus: (cwd) => services.memory.getStatus(cwd),
		setEnabled: (cwd, enabled) => services.memory.setEnabled(cwd, enabled),
		clear: (cwd) => services.memory.clear(cwd),
		list: (cwd) => services.memory.list(cwd),
		remove: (cwd, id) => services.memory.remove(cwd, id),
		promote: (cwd, id) => services.memory.promote(cwd, id),
		promoteToKnowledge: (cwd, id) => services.memory.promoteToKnowledge(cwd, id),
	};
	bindContract(MemoryContract, implementation);
}
