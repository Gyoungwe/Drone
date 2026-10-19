import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ComputeSshConfigHost } from "@drone/shared";

const MAX_HOSTS = 256;
const MAX_IDENTITY_FILES = 8;

type ParsedHost = Omit<ComputeSshConfigHost, "source">;

function words(value: string): string[] {
	return (value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [])
		.map((item) => item.replace(/^"|"$/g, ""))
		.filter(Boolean);
}

function directive(line: string): [string, string] | null {
	const match = line.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)\s+(.+?)\s*$/);
	if (!match) return null;
	const key = match[1];
	const rawValue = match[2];
	if (!key || !rawValue) return null;
	const value = rawValue.replace(/\s+#.*$/, "").trim();
	return value ? [key.toLowerCase(), value] : null;
}

function concreteAlias(value: string): boolean {
	return value.length > 0 && !/[*!?]/.test(value) && !value.startsWith("!");
}

function emptyHost(alias: string): ParsedHost {
	return { alias, identityFiles: [] };
}

/**
 * Read only the public host metadata from ~/.ssh/config. Private key files
 * are never opened; identity paths are returned as opaque configuration
 * values so the user can choose which existing SSH entry to reuse.
 */
export async function readSshConfigHosts(home = homedir()): Promise<ComputeSshConfigHost[]> {
	let source: string;
	try {
		source = await readFile(join(home, ".ssh", "config"), "utf8");
	} catch {
		return [];
	}

	const entries = new Map<string, ParsedHost>();
	let aliases: string[] = [];
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const parsed = directive(line);
		if (!parsed) continue;
		const [key, value] = parsed;
		if (key === "host") {
			aliases = words(value).filter(concreteAlias).slice(0, MAX_HOSTS);
			for (const alias of aliases) {
				if (!entries.has(alias)) entries.set(alias, emptyHost(alias));
			}
			continue;
		}
		if (!aliases.length) continue;
		for (const alias of aliases) {
			const entry = entries.get(alias);
			if (!entry) continue;
			switch (key) {
				case "hostname":
					if (!entry.hostname) entry.hostname = words(value)[0];
					break;
				case "port": {
					const port = Number(words(value)[0]);
					if (!entry.port && Number.isInteger(port) && port >= 1 && port <= 65_535) entry.port = port;
					break;
				}
				case "user":
					if (!entry.user) entry.user = words(value)[0];
					break;
				case "identityfile": {
					const identity = words(value)[0];
					if (identity && !entry.identityFiles.includes(identity)) {
						entry.identityFiles = [...entry.identityFiles, identity].slice(0, MAX_IDENTITY_FILES);
					}
					break;
				}
				case "proxyjump":
					if (!entry.proxyJump) entry.proxyJump = value;
					break;
			}
		}
	}

	return [...entries.values()]
		.slice(0, MAX_HOSTS)
		.sort((left, right) => left.alias.localeCompare(right.alias, undefined, { sensitivity: "base" }))
		.map((entry) => ({ ...entry, source: "ssh-config" as const }));
}
