import type { PiBackend } from "@drone/backend";
import { IpcChannels, PackagesContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 社区包域：pi.dev 目录搜索 + 安装/卸载 + 已配置清单。 */
export function registerPackagesIpc(backend: PiBackend): void {
	const implementation: ContractImplementation<typeof PackagesContract> = {
		searchCatalog: (...args) => {
			const [query, type, page] = args;
			return backend.searchPackages(query, type, page);
		},
		installPackage: (name) => backend.installPackage(name),
		removePackage: (source, scope) => backend.removePackage(source, scope),
		listConfiguredPackages: () => backend.listConfiguredPackages(),
	};
	bindContract(PackagesContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				searchCatalog: IpcChannels.PackagesSearchCatalog,
				installPackage: IpcChannels.PackagesInstall,
				removePackage: IpcChannels.PackagesRemove,
				listConfiguredPackages: IpcChannels.PackagesListConfigured,
			})[method as keyof typeof PackagesContract.methods],
	});
}
