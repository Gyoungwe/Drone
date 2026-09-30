/**
 * @deprecated Import PackageService from `../services/packages` instead.
 *
 * Keep this compatibility entrypoint for extensions and tests that imported
 * the pre-v2 package-admin module directly.
 */
export {
	isNpmSpawnEnoent,
	NPM_NOT_FOUND_SENTINEL,
	PackageService as PackageAdmin,
} from "../services/packages";
