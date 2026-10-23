/**
 * Offline admission policy for third-party Pi/Drone packages.
 *
 * This module deliberately does not download, install, verify a signature, or
 * execute a package.  It is the small contract the host can use after reading
 * npm metadata and before presenting an install confirmation.  The installer
 * still owns the user confirmation and lifecycle receipt.
 */

export type PluginOrigin = "official" | "community" | "local";
export type PluginAdmissionStatus = "accepted" | "blocked";

export interface PluginAdmissionInput {
	readonly name: string;
	readonly version?: string;
	readonly registry?: string;
	readonly integrity?: string;
	readonly manifestDeclared: boolean;
	readonly hosts: readonly string[];
	readonly packageKind: "pi" | "desktop-ui";
	readonly source: "npm" | "path" | "git";
}

export interface PluginAdmissionPolicy {
	/** Registry hostnames allowed for network installs. */
	readonly registries?: readonly string[];
	/** Require npm integrity for packages coming from a network registry. */
	readonly requireIntegrity?: boolean;
	/** Host accepted by the current application. */
	readonly host?: string;
}

export interface PluginAdmissionResult {
	readonly status: PluginAdmissionStatus;
	readonly origin: PluginOrigin;
	readonly code:
		| "accepted"
		| "invalid-name"
		| "invalid-version"
		| "unsupported-source"
		| "registry-not-allowed"
		| "integrity-missing"
		| "integrity-invalid"
		| "manifest-missing"
		| "host-unsupported";
	readonly message: string;
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/u;
const DEFAULT_REGISTRIES = ["registry.npmjs.org"] as const;

function originOf(input: PluginAdmissionInput): PluginOrigin {
	if (input.source === "path") return "local";
	return input.name.startsWith("@gyoungwe/") ? "official" : "community";
}

function registryHost(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

/**
 * Apply the host's pre-install source policy to metadata only.
 *
 * A missing Drone manifest is accepted for L0 Pi packages and is reported to
 * the caller as `manifest-missing` only when the package claims to be a
 * desktop UI package.  This preserves generic Pi package compatibility while
 * preventing an untyped package from entering the UI plugin lifecycle.
 */
export function assessPluginAdmission(
	input: PluginAdmissionInput,
	policy: PluginAdmissionPolicy = {},
): PluginAdmissionResult {
	const origin = originOf(input);
	if (!PACKAGE_NAME.test(input.name)) {
		return { status: "blocked", origin, code: "invalid-name", message: "Package name is invalid" };
	}
	if (input.version !== undefined && !SEMVER.test(input.version)) {
		return { status: "blocked", origin, code: "invalid-version", message: "Package version is not semver" };
	}
	if (input.source === "git") {
		return {
			status: "blocked",
			origin,
			code: "unsupported-source",
			message: "Git package sources require a separately approved source policy",
		};
	}
	if (input.source === "npm") {
		const host = registryHost(input.registry);
		const registries = policy.registries ?? DEFAULT_REGISTRIES;
		if (!host || !registries.some((allowed) => registryHost(allowed) === host)) {
			return {
				status: "blocked",
				origin,
				code: "registry-not-allowed",
				message: "Package registry is not approved",
			};
		}
		if (policy.requireIntegrity !== false && !input.integrity) {
			return {
				status: "blocked",
				origin,
				code: "integrity-missing",
				message: "Registry package has no integrity value",
			};
		}
		if (input.integrity && !INTEGRITY.test(input.integrity)) {
			return {
				status: "blocked",
				origin,
				code: "integrity-invalid",
				message: "Registry package integrity is malformed",
			};
		}
	}
	if (input.packageKind === "desktop-ui" && !input.manifestDeclared) {
		return {
			status: "blocked",
			origin,
			code: "manifest-missing",
			message: "Desktop UI packages must declare a Drone manifest",
		};
	}
	if (policy.host && !input.hosts.includes(policy.host)) {
		return {
			status: "blocked",
			origin,
			code: "host-unsupported",
			message: `Package does not declare host ${policy.host}`,
		};
	}
	return { status: "accepted", origin, code: "accepted", message: "Package source is admissible" };
}
