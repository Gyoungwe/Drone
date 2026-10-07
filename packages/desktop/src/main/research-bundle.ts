import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface BundledPackage {
	package: string;
	version: string;
	role?: string;
}

export interface ResearchBundlePaths {
	additionalExtensionPaths: string[];
	additionalSkillPaths: string[];
	/** Entry of the bundled MCP runtime extension (pi-mcp-adapter), when staged next to the app. */
	mcpRuntimePath?: string;
	/** Bundled packages that are declared but missing/stale; the host logs them and keeps starting. */
	warnings: string[];
}

/**
 * Same explicit bundle in a clean install, any project, and the packaging smoke test.
 * `packagesRoot` is the node_modules directory holding the bundled pi packages
 * (`<resources>/pi-packages/node_modules` when packaged, `packages/desktop/pi-packages/node_modules` in dev).
 */
export function researchBundlePaths(root: string, packagesRoot?: string): ResearchBundlePaths {
	const manifest = JSON.parse(readFileSync(join(root, "lib/workbench-manifest.json"), "utf8")) as {
		version: number;
		extensions: string[];
		skills: string[];
		bundledPackages?: BundledPackage[];
	};
	const bundled = manifest.bundledPackages ?? [];
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.extensions) ||
		!Array.isArray(manifest.skills) ||
		!Array.isArray(bundled) ||
		manifest.extensions.some((p) => !/^[a-z0-9-]+\.mjs$/.test(p)) ||
		manifest.skills.some((p) => !/^[a-z0-9-]+$/.test(p)) ||
		bundled.some(
			(item) =>
				!item ||
				typeof item.package !== "string" ||
				!/^[a-z0-9][a-z0-9-]*$/.test(item.package) ||
				typeof item.version !== "string" ||
				!/^\d+\.\d+\.\d+$/.test(item.version),
		)
	)
		throw new Error("Invalid bundled research manifest");
	const warnings: string[] = [];
	let mcpRuntimePath: string | undefined;
	for (const item of bundled) {
		if (item.role !== "mcp-runtime") continue;
		const entry = packagesRoot ? bundledExtensionEntry(packagesRoot, item, warnings) : undefined;
		if (entry) mcpRuntimePath = entry;
		else if (!packagesRoot)
			warnings.push(`MCP runtime ${item.package}@${item.version} has no packages directory`);
	}
	return {
		additionalExtensionPaths: manifest.extensions.map((name) => join(root, "extensions", name)),
		additionalSkillPaths: manifest.skills.map((name) => join(root, "skills", name, "SKILL.md")),
		...(mcpRuntimePath ? { mcpRuntimePath } : {}),
		warnings,
	};
}

function bundledExtensionEntry(
	packagesRoot: string,
	item: BundledPackage,
	warnings: string[],
): string | undefined {
	const dir = join(packagesRoot, item.package);
	const pkgPath = join(dir, "package.json");
	if (!existsSync(pkgPath)) {
		warnings.push(
			`MCP runtime ${item.package}@${item.version} is not installed at ${dir} (run npm run stage:pi-packages); mcp.json servers will not load`,
		);
		return undefined;
	}
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			version?: string;
			pi?: { extensions?: unknown };
		};
		if (pkg.version !== item.version) {
			warnings.push(`MCP runtime ${item.package} is ${pkg.version}, expected ${item.version}`);
			return undefined;
		}
		const entries = Array.isArray(pkg.pi?.extensions) ? pkg.pi.extensions : [];
		const first = entries.find(
			(value): value is string => typeof value === "string" && !value.includes(".."),
		);
		const entry = first ? join(dir, first) : undefined;
		if (!entry || !existsSync(entry)) {
			warnings.push(`MCP runtime ${item.package} has no pi extension entry`);
			return undefined;
		}
		return entry;
	} catch (error) {
		warnings.push(
			`MCP runtime ${item.package} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}
