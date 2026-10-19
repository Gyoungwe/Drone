import type { CatalogPackage } from "./packages";

/** The two package origins shown by the Skills & Connections plugin page. */
export type PiPluginSource = "pi-market" | "drone";

export type PiPluginPackageKind = "pi" | "desktop-ui";

/** Public Drone package names. Manifest details are read from host metadata when installed. */
export const DRONE_PLUGIN_PACKAGE_NAMES = [
	"@gyoungwe/pi-core",
	"@gyoungwe/pi-knowledge",
	"@gyoungwe/pi-research",
	"@gyoungwe/pi-analysis",
	"@gyoungwe/pi-evidence",
	"@gyoungwe/pi-connectors",
	"@gyoungwe/desktop-ui-pack",
	"@gyoungwe/research-suite",
] as const;

/** Registry metadata shown before a package is installed. Keep this in the host contract so
 * the market never falls back to a blank version/description when the session has no resources. */
export const DRONE_PLUGIN_METADATA: Readonly<
	Record<
		(typeof DRONE_PLUGIN_PACKAGE_NAMES)[number],
		{
			readonly version: string;
			readonly description: string;
			readonly packageKind?: PiPluginPackageKind;
			readonly capabilities?: readonly string[];
		}
	>
> = {
	"@gyoungwe/pi-core": {
		version: "0.1.3",
		description: "Portable task, authorization, status, delivery and memory tools for native Pi",
		capabilities: ["tasks", "authorization", "memory"],
	},
	"@gyoungwe/pi-knowledge": {
		version: "0.1.1",
		description: "Knowledge and Vault tools for native Pi hosts",
		capabilities: ["knowledge", "vault"],
	},
	"@gyoungwe/pi-research": {
		version: "0.1.0",
		description:
			"Evidence-gated research retrieval, reading, deposition and source-grounded answer tools for native Pi",
		capabilities: ["research", "evidence"],
	},
	"@gyoungwe/pi-analysis": {
		version: "0.1.0",
		description: "Portable scientific analysis adapters and readiness gates for native Pi",
		capabilities: ["analysis", "readiness"],
	},
	"@gyoungwe/pi-evidence": {
		version: "0.1.0",
		description: "Portable evidence manifests, provenance, checkpoints and replay proofs for native Pi",
		capabilities: ["evidence", "provenance", "replay"],
	},
	"@gyoungwe/pi-connectors": {
		version: "0.1.0",
		description: "Host-neutral, read-only connector declarations and provenance receipts for native Pi",
		capabilities: ["connectors", "receipts"],
	},
	"@gyoungwe/desktop-ui-pack": {
		version: "0.1.0",
		description: "Optional Drone Desktop UI contributions loaded by the installed package boundary",
		packageKind: "desktop-ui",
		capabilities: ["ui"],
	},
	"@gyoungwe/research-suite": {
		version: "0.1.5",
		description: "Bundled Drone native Pi research suite",
		capabilities: ["research", "knowledge", "analysis"],
	},
};

export type MarketResourceKind = "mcp-official" | "mcp-community" | "skills" | "workflow";

/** Curated open-source entry points shown in the Market resource directory. These links are
 * discovery metadata only; installing a server or skill still goes through its own section. */
export interface MarketResourceLink {
	readonly id: string;
	readonly kind: MarketResourceKind;
	readonly name: string;
	readonly repository: string;
	readonly url: string;
	readonly description: string;
}

export const MARKET_RESOURCE_LINKS: readonly MarketResourceLink[] = [
	{
		id: "mcp-reference-servers",
		kind: "mcp-official",
		name: "MCP reference servers",
		repository: "modelcontextprotocol/servers",
		url: "https://github.com/modelcontextprotocol/servers",
		description: "Official Model Context Protocol reference servers and examples.",
	},
	{
		id: "mcp-community-directory",
		kind: "mcp-community",
		name: "Awesome MCP servers",
		repository: "punkpeye/awesome-mcp-servers",
		url: "https://github.com/punkpeye/awesome-mcp-servers",
		description: "Community-maintained directory of MCP servers; review permissions before use.",
	},
	{
		id: "scientific-agent-skills",
		kind: "skills",
		name: "Scientific Agent Skills",
		repository: "K-Dense-AI/scientific-agent-skills",
		url: "https://github.com/K-Dense-AI/scientific-agent-skills",
		description: "Open scientific research skills used by the bundled Skill catalog.",
	},
	{
		id: "nature-skills",
		kind: "skills",
		name: "Nature Skills",
		repository: "Yuan1z0825/nature-skills",
		url: "https://github.com/Yuan1z0825/nature-skills",
		description: "Open research-writing and literature skills for the Skill repository view.",
	},
	{
		id: "open-science",
		kind: "workflow",
		name: "Open Science",
		repository: "aipoch/open-science",
		url: "https://github.com/aipoch/open-science",
		description: "Open-source scientific workbench patterns and connector-oriented workflows.",
	},
];

/** The public fields of the official Pi package manifest used by the host. */
export interface PiPackageManifest {
	readonly name: string;
	readonly version?: string;
	readonly description?: string;
	readonly keywords?: readonly string[];
	readonly pi?: {
		readonly extensions?: readonly string[];
		readonly skills?: readonly string[];
		readonly prompts?: readonly string[];
	};
}

/** The optional Drone manifest shipped alongside a standard package.json. */
export interface DronePackageManifest {
	readonly schemaVersion?: number;
	readonly id?: string;
	readonly version?: string;
	readonly pi?: {
		readonly apiVersion?: number;
		readonly minHostVersion?: string;
		readonly testedHosts?: readonly string[];
	};
	readonly drone?: {
		readonly pluginApi?: number;
		readonly resultContract?: string;
	};
	readonly entrypoints?: {
		readonly extension?: string;
		readonly extensions?: readonly string[];
		readonly skills?: string | readonly string[];
		readonly ui?: string;
	};
	readonly capabilities?: readonly string[];
	readonly hosts?: readonly string[];
	readonly permissions?: unknown;
}

/**
 * A source-neutral package projection for the plugin page.
 *
 * `sources` can contain both origins when a Drone package is also listed by
 * pi.dev. Keeping the package name as the identity prevents two install
 * buttons from racing against the same npm package.
 */
export interface PiPluginSourceEntry {
	readonly packageName: string;
	readonly version?: string;
	readonly description?: string;
	readonly sources: readonly PiPluginSource[];
	readonly packageKind: PiPluginPackageKind;
	readonly capabilities: readonly string[];
	readonly piExtensions: readonly string[];
	readonly piSkills: readonly string[];
	readonly piPrompts: readonly string[];
	readonly uiContribution: boolean;
	readonly pluginApi?: number;
	readonly piApiVersion?: number;
	readonly minHostVersion?: string;
	readonly hosts: readonly string[];
	readonly permissions?: unknown;
}

function strings(values: readonly unknown[] | undefined): string[] {
	return values?.filter((value): value is string => typeof value === "string" && value.length > 0) ?? [];
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/**
 * Adapt a pi.dev directory card. The plugin page deliberately accepts only
 * cards whose official type is `extension`; skill/prompt/theme cards are kept
 * for their own settings surfaces and can never enter this list.
 */
export function piMarketPluginSource(pkg: CatalogPackage): PiPluginSourceEntry | null {
	if (!pkg.types.some((type) => type === "extension")) return null;
	return {
		packageName: pkg.name,
		version: undefined,
		description: pkg.description,
		sources: ["pi-market"],
		packageKind: "pi",
		capabilities: [],
		piExtensions: ["<pi.dev extension>"],
		piSkills: [],
		piPrompts: [],
		uiContribution: false,
		hosts: ["native-pi", "drone-desktop"],
	};
}

/**
 * Adapt a Drone package using the same package.json + pi fields as native Pi.
 * A package is accepted when it contributes a Pi extension/prompt or a
 * Desktop UI entrypoint. Skill-only packages are intentionally rejected by
 * the plugin source adapter and remain visible in the Skill column instead.
 */
export function dronePluginSource(
	packageJson: PiPackageManifest,
	manifest?: DronePackageManifest,
): PiPluginSourceEntry | null {
	if (!/^@gyoungwe\/[a-z0-9][a-z0-9._-]*$/iu.test(packageJson.name)) return null;
	const packageExtensions = strings(packageJson.pi?.extensions);
	const packageSkills = strings(packageJson.pi?.skills);
	const packagePrompts = strings(packageJson.pi?.prompts);
	const manifestExtensions = [
		...(manifest?.entrypoints?.extension ? [manifest.entrypoints.extension] : []),
		...strings(manifest?.entrypoints?.extensions),
	];
	const manifestSkills =
		typeof manifest?.entrypoints?.skills === "string"
			? [manifest.entrypoints.skills]
			: strings(manifest?.entrypoints?.skills);
	const piExtensions = unique([...packageExtensions, ...manifestExtensions]);
	const piSkills = unique([...packageSkills, ...manifestSkills]);
	const piPrompts = unique(packagePrompts);
	const uiContribution = typeof manifest?.entrypoints?.ui === "string";
	if (!piExtensions.length && !piPrompts.length && !uiContribution) return null;
	const capabilities = unique(strings(manifest?.capabilities));
	return {
		packageName: packageJson.name,
		version: manifest?.version ?? packageJson.version,
		description: packageJson.description,
		sources: ["drone"],
		packageKind:
			uiContribution && !piExtensions.length && !piSkills.length && !piPrompts.length ? "desktop-ui" : "pi",
		capabilities,
		piExtensions,
		piSkills,
		piPrompts,
		uiContribution,
		pluginApi: manifest?.drone?.pluginApi,
		piApiVersion: manifest?.pi?.apiVersion,
		minHostVersion: manifest?.pi?.minHostVersion,
		hosts: unique(strings(manifest?.hosts)),
		permissions: manifest?.permissions,
	};
}

/** Merge official and Drone projections by npm package name. */
export function mergePiPluginSources(entries: readonly PiPluginSourceEntry[]): PiPluginSourceEntry[] {
	const merged = new Map<string, PiPluginSourceEntry>();
	for (const entry of entries) {
		const current = merged.get(entry.packageName);
		if (!current) {
			merged.set(entry.packageName, entry);
			continue;
		}
		merged.set(entry.packageName, {
			...current,
			version: entry.version ?? current.version,
			description: entry.description ?? current.description,
			sources: unique([...current.sources, ...entry.sources]) as PiPluginSource[],
			packageKind: current.packageKind === "desktop-ui" ? entry.packageKind : current.packageKind,
			capabilities: unique([...current.capabilities, ...entry.capabilities]),
			piExtensions: unique([...current.piExtensions, ...entry.piExtensions]),
			piSkills: unique([...current.piSkills, ...entry.piSkills]),
			piPrompts: unique([...current.piPrompts, ...entry.piPrompts]),
			uiContribution: current.uiContribution || entry.uiContribution,
			pluginApi: entry.pluginApi ?? current.pluginApi,
			piApiVersion: entry.piApiVersion ?? current.piApiVersion,
			minHostVersion: entry.minHostVersion ?? current.minHostVersion,
			hosts: unique([...current.hosts, ...entry.hosts]),
			permissions: entry.permissions ?? current.permissions,
		});
	}
	return [...merged.values()].sort((a, b) => a.packageName.localeCompare(b.packageName));
}
