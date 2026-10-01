import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels, PackagesContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 社区包域：pi.dev 目录搜索 + 安装/卸载 + 已配置清单。 */
export function registerPackagesIpc(
	backend: SessionServicePort,
	services?: Pick<BackendServices, "packages">,
): void {
	const legacy = backend as SessionServicePort & {
		searchPackages?: BackendServices["packages"]["searchPackages"];
		installPackage?: BackendServices["packages"]["installPackage"];
		removePackage?: BackendServices["packages"]["removePackage"];
		listConfiguredPackages?: BackendServices["packages"]["listConfiguredPackages"];
	};
	const packages =
		services?.packages ??
		("packages" in backend
			? (backend as SessionServicePort & Pick<BackendServices, "packages">).packages
			: legacy.searchPackages &&
					legacy.installPackage &&
					legacy.removePackage &&
					legacy.listConfiguredPackages
				? {
						searchPackages: legacy.searchPackages.bind(backend),
						installPackage: legacy.installPackage.bind(backend),
						removePackage: legacy.removePackage.bind(backend),
						listConfiguredPackages: legacy.listConfiguredPackages.bind(backend),
					}
				: undefined);
	if (!packages) throw new Error("Package service is required by the desktop host");
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
