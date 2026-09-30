import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { type PackageManager, PackageService, type PackageServiceDependencies } from "../services/packages";

function createDefaultPackageManager(cwd: string): PackageManager {
	return new DefaultPackageManager({
		cwd,
		agentDir: getAgentDir(),
		settingsManager: SettingsManager.create(cwd, getAgentDir()),
	});
}

/**
 * @deprecated Import PackageService from `../services/packages` and inject a
 * package-manager factory instead. This adapter keeps the Pi SDK construction
 * in the existing R1 compatibility location during the v2 migration.
 */
export class PackageAdmin extends PackageService {
	constructor(
		deps: Omit<PackageServiceDependencies, "packageManagerFactory"> & {
			packageManagerFactory?: PackageServiceDependencies["packageManagerFactory"];
		},
	) {
		super({ ...deps, packageManagerFactory: deps.packageManagerFactory ?? createDefaultPackageManager });
	}
}

export {
	isNpmSpawnEnoent,
	NPM_NOT_FOUND_SENTINEL,
} from "../services/packages";
