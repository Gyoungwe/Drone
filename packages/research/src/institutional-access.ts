import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inferEzproxyTemplateFromUrl } from "./institutional-proxy";

export { buildProxiedUrl, inferEzproxyTemplateFromUrl } from "./institutional-proxy";

export const INSTITUTIONAL_CONFIG_NAME = "institutional.json";
export const INSTITUTIONAL_AGENT_DIR = join(homedir(), ".pi", "agent");
export const INSTITUTIONAL_CONFIG_PATH = join(INSTITUTIONAL_AGENT_DIR, INSTITUTIONAL_CONFIG_NAME);

export interface InstitutionalConfig {
	version: 1;
	ezproxyTemplate?: string;
	openUrlResolver?: string;
	institutionName?: string;
	autoDownloadEnabled: boolean;
	perTaskLimit: number;
	lastLoginAt?: string;
	lastLoginUrl?: string;
	configured?: boolean;
}

export interface InstitutionalConfigIo {
	readFile(path: string): Promise<string>;
	writeFile(path: string, data: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

export function emptyInstitutionalConfig(): InstitutionalConfig {
	return { version: 1, autoDownloadEnabled: true, perTaskLimit: 20 };
}

function normalizeUrl(value: unknown): string | undefined {
	if (value == null) return undefined;
	const trimmed = String(value).trim();
	if (!trimmed || trimmed.length > 2048 || !/^https?:\/\//i.test(trimmed)) return undefined;
	return trimmed;
}

export function normalizeInstitutionalConfig(raw: unknown): InstitutionalConfig {
	const base = emptyInstitutionalConfig();
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
	const value = raw as Record<string, unknown>;
	const ezproxyTemplate = normalizeUrl(value.ezproxyTemplate);
	const openUrlResolver = normalizeUrl(value.openUrlResolver);
	const institutionName =
		typeof value.institutionName === "string"
			? value.institutionName.trim().slice(0, 120) || undefined
			: undefined;
	const autoDownloadEnabled =
		typeof value.autoDownloadEnabled === "boolean" ? value.autoDownloadEnabled : base.autoDownloadEnabled;
	const perTaskLimit =
		typeof value.perTaskLimit === "number" && Number.isInteger(value.perTaskLimit)
			? Math.min(100, Math.max(1, value.perTaskLimit))
			: base.perTaskLimit;
	const lastLoginAt = typeof value.lastLoginAt === "string" ? value.lastLoginAt : undefined;
	const lastLoginUrl = normalizeUrl(value.lastLoginUrl);
	return {
		version: 1,
		ezproxyTemplate,
		institutionName,
		openUrlResolver,
		autoDownloadEnabled,
		perTaskLimit,
		lastLoginAt,
		lastLoginUrl,
		configured: Boolean(ezproxyTemplate || openUrlResolver || institutionName || lastLoginAt),
	};
}

export async function loadInstitutionalConfig(
	path = INSTITUTIONAL_CONFIG_PATH,
	io: Pick<InstitutionalConfigIo, "readFile"> = { readFile: (file) => readFile(file, "utf8") },
): Promise<InstitutionalConfig> {
	try {
		return normalizeInstitutionalConfig(JSON.parse(await io.readFile(path)));
	} catch {
		return emptyInstitutionalConfig();
	}
}

export async function saveInstitutionalConfig(
	config: unknown,
	path = INSTITUTIONAL_CONFIG_PATH,
	io: InstitutionalConfigIo = {
		readFile: (file) => readFile(file, "utf8"),
		writeFile: async (file, data) => {
			await writeFile(file, data, "utf8");
		},
		mkdir: async (dir) => {
			await mkdir(dir, { recursive: true });
		},
	},
): Promise<InstitutionalConfig> {
	const normalized = normalizeInstitutionalConfig(config);
	await io.mkdir(dirname(path));
	await io.writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`);
	return normalized;
}

export async function detectAndSaveTemplateFromUrl(
	navigatedUrl: string,
	{ path = INSTITUTIONAL_CONFIG_PATH, io }: { path?: string; io?: InstitutionalConfigIo } = {},
): Promise<InstitutionalConfig | null> {
	const inferred = inferEzproxyTemplateFromUrl(navigatedUrl);
	if (!inferred) return null;
	const config = await loadInstitutionalConfig(path, io);
	if (config.ezproxyTemplate === inferred) return config;
	return saveInstitutionalConfig({ ...config, ezproxyTemplate: inferred }, path, io);
}
