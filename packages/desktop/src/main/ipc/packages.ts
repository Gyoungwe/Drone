import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels, PackagesContract } from "@drone/shared";
import { latestPackageVersions } from "../package-versions";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 社区包域：pi.dev 目录搜索 + 安装/卸载 + 已配置清单。 */
export function registerPackagesIpc(
	backendOrServices: BackendServices | SessionServicePort,
	services?: Pick<BackendServices, "packages">,
	onPackagesChanged?: () => Promise<void> | void,
): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const hostServices = services ?? ("sessions" in backendOrServices ? backendOrServices : undefined);
	const legacy = backend as SessionServicePort & {
		searchPackages?: BackendServices["packages"]["searchPackages"];
		installPackage?: BackendServices["packages"]["installPackage"];
		updatePackage?: BackendServices["packages"]["updatePackage"];
		removePackage?: BackendServices["packages"]["removePackage"];
		listConfiguredPackages?: BackendServices["packages"]["listConfiguredPackages"];
	};
	const packages =
		hostServices?.packages ??
		("packages" in backend
			? (backend as SessionServicePort & Pick<BackendServices, "packages">).packages
			: legacy.searchPackages &&
					legacy.installPackage &&
					legacy.updatePackage &&
					legacy.removePackage &&
					legacy.listConfiguredPackages
				? {
						searchPackages: legacy.searchPackages.bind(backend),
						installPackage: legacy.installPackage.bind(backend),
						updatePackage: legacy.updatePackage.bind(backend),
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
		installPackage: async (name) => {
			const receipt = await packages.installPackage(name);
			if (receipt.status === "succeeded") await onPackagesChanged?.();
			return receipt;
		},
		updatePackage: async (name) => {
			const receipt = await packages.updatePackage(name);
			if (receipt.status === "succeeded") await onPackagesChanged?.();
			return receipt;
		},
		removePackage: async (source, scope) => {
			const receipt = await packages.removePackage(source, scope);
			if (receipt.status === "succeeded") await onPackagesChanged?.();
			return receipt;
		},
		listConfiguredPackages: () => packages.listConfiguredPackages(),
		latestPackageVersions: (names) => latestPackageVersions(names),
	};
	bindContract(PackagesContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				searchCatalog: IpcChannels.PackagesSearchCatalog,
				installPackage: IpcChannels.PackagesInstall,
				updatePackage: IpcChannels.PackagesUpdate,
				removePackage: IpcChannels.PackagesRemove,
				listConfiguredPackages: IpcChannels.PackagesListConfigured,
				latestPackageVersions: IpcChannels.PackagesLatestVersions,
			})[method as keyof typeof PackagesContract.methods],
	});
}
