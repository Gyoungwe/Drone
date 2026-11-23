import type {
	PluginRecordAdoptionDeclaration,
	PluginRecordAdoptions,
	PluginServiceProvision,
	PluginServiceRequirement,
	PluginServiceRole,
} from "@gyoungwe/plugin-api/runtime";
import type { InstalledUiRuntimeSource } from "./installed-package-sources";

function serviceMap(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${field} must be an object`);
	return value as Record<string, unknown>;
}
function serviceName(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 128)
		throw new Error(`${field} must be a nonempty string of at most 128 characters`);
	return value;
}
function serviceVersion(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1)
		throw new Error(`${field} must be a positive safe integer`);
	return value as number;
}
export function installedServices(declarations: {
	provides?: unknown;
	requires?: unknown;
	consumes?: unknown;
}) {
	const services: Pick<InstalledUiRuntimeSource, "provides" | "requires" | "consumes"> = {};
	if (declarations.provides !== undefined) {
		const provided: [string, PluginServiceProvision][] = [];
		for (const [name, value] of Object.entries(serviceMap(declarations.provides, "drone.provides"))) {
			const field = `drone.provides.${serviceName(name, "service name")}`;
			const record = serviceMap(value, field);
			if (Object.keys(record).some((key) => !["version", "operations"].includes(key)))
				throw new Error(`${field} only accepts version and operations`);
			if (!Array.isArray(record.operations) || record.operations.length === 0)
				throw new Error(`${field}.operations must be a nonempty array`);
			const operations = record.operations.map((item) => serviceName(item, `${field}.operations`));
			if (new Set(operations).size !== operations.length)
				throw new Error(`${field}.operations must be unique`);
			provided.push([
				name,
				{
					version: serviceVersion(record.version, `${field}.version`),
					operations: Object.freeze(operations),
				},
			]);
		}
		services.provides = Object.freeze(Object.fromEntries(provided));
	}
	if (declarations.requires !== undefined) {
		const required: [string, PluginServiceRequirement][] = [];
		for (const [alias, value] of Object.entries(serviceMap(declarations.requires, "drone.requires"))) {
			const field = `drone.requires.${serviceName(alias, "service alias")}`;
			const record = serviceMap(value, field);
			if (Object.keys(record).some((key) => !["service", "version"].includes(key)))
				throw new Error(`${field} only accepts service and version`);
			required.push([
				alias,
				{
					service: serviceName(record.service, `${field}.service`),
					version: serviceVersion(record.version, `${field}.version`),
				},
			]);
		}
		services.requires = Object.freeze(Object.fromEntries(required));
	}
	if (declarations.consumes !== undefined) {
		const roles: [string, PluginServiceRole][] = [];
		for (const [role, value] of Object.entries(serviceMap(declarations.consumes, "drone.consumes"))) {
			const field = `drone.consumes.${serviceName(role, "role name")}`;
			const record = serviceMap(value, field);
			if (Object.keys(record).some((key) => !["servicePrefix", "version"].includes(key)))
				throw new Error(`${field} only accepts servicePrefix and version`);
			roles.push([
				role,
				{
					servicePrefix: serviceName(record.servicePrefix, `${field}.servicePrefix`),
					version: serviceVersion(record.version, `${field}.version`),
				},
			]);
		}
		services.consumes = Object.freeze(Object.fromEntries(roles));
	}
	return services;
}

function stableAdoptionVersion(value: unknown, field: string): string {
	const version = serviceName(value, field);
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
		throw new Error(`${field} must be an exact stable version`);
	return version;
}
export function installedRecordAdoptions(value: unknown, packageVersion: unknown): PluginRecordAdoptions {
	const current = stableAdoptionVersion(packageVersion, "package version for record adoption")
		.split(".")
		.map(BigInt);
	const adoptions: [string, PluginRecordAdoptionDeclaration][] = [];
	for (const [type, raw] of Object.entries(serviceMap(value, "drone.recordAdoptions"))) {
		const field = `drone.recordAdoptions.${serviceName(type, "adoption logical type")}`;
		const record = serviceMap(raw, field);
		if (
			Object.keys(record).some((key) => !["legacyType", "fromVersions", "removeBeforeVersion"].includes(key))
		)
			throw new Error(`${field} only accepts legacyType, fromVersions and removeBeforeVersion`);
		const legacyType = serviceName(record.legacyType, `${field}.legacyType`);
		if (legacyType.startsWith("plugin-record:") || legacyType.startsWith("plugin-notice:"))
			throw new Error(`${field}.legacyType cannot import a source-owned namespace`);
		if (!Array.isArray(record.fromVersions) || record.fromVersions.length === 0)
			throw new Error(`${field}.fromVersions must list supported exact migrator versions`);
		const fromVersions = record.fromVersions.map((item) =>
			stableAdoptionVersion(item, `${field}.fromVersions`),
		);
		if (new Set(fromVersions).size !== fromVersions.length)
			throw new Error(`${field}.fromVersions must be unique`);
		const removeBeforeVersion = stableAdoptionVersion(
			record.removeBeforeVersion,
			`${field}.removeBeforeVersion`,
		);
		const removal = removeBeforeVersion.split(".").map(BigInt);
		const differing = current.findIndex((part, index) => part !== removal[index]);
		if (differing === -1 || (current[differing] as bigint) > (removal[differing] as bigint))
			throw new Error(`${field} must be removed before package version ${removeBeforeVersion}`);
		adoptions.push([type, { legacyType, fromVersions: Object.freeze(fromVersions), removeBeforeVersion }]);
	}
	return Object.freeze(Object.fromEntries(adoptions));
}
