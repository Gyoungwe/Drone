import type { BackendServices, PiBackend } from "@drone/backend";
import { IpcChannels, PackagesContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 社区包域：pi.dev 目录搜索 + 安装/卸载 + 已配置清单。 */
export function registerPackagesIpc(backend: PiBackend, services?: Pick<BackendServices, "packages">): void {
	const packages =
		services?.packages ??
		backend.packages ??
		({
			searchPackages: (query: string, type?: Parameters<PiBackend["searchPackages"]>[1], page?: number) =>
				backend.searchPackages(query, type, page),
			installPackage: (name: string) => backend.installPackage(name),
			removePackage: (source: string, scope: "user" | "project") => backend.removePackage(source, scope),
			listConfiguredPackages: () => backend.listConfiguredPackages(),
		} satisfies Pick<
			BackendServices["packages"],
			"searchPackages" | "installPackage" | "removePackage" | "listConfiguredPackages"
		>);
	const implementation: ContractImplementation<typeof PackagesContract> = {
		searchCatalog: (...args) => {
			const [query, type, page] = args;
			return packages.searchPackages(query, type, page);
		},
		installPackage: (name) => packages.installPackage(name),
		removePackage: (source, scope) => packages.removePackage(source, scope),
		listConfiguredPackages: () => packages.listConfiguredPackages(),
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
