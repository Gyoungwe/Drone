import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { HostProfile } from "@drone/compute";
import { ComputeTransportError } from "./compute-operation-lifetime";
import { type DefaultComputeExecutorOptions, expandHome } from "./runner-helpers";

interface SshConfigValues {
	hostName?: string;
	user?: string;
	port?: number;
	identityFile?: string;
	proxyJump?: string[];
}

function globMatches(pattern: string, value: string): boolean {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
		.replaceAll("*", ".*")
		.replaceAll("?", ".");
	return new RegExp(`^${escaped}$`, "u").test(value);
}

async function readSshLines(path: string): Promise<string[]> {
	try {
		return sshLines(await readFile(expandHome(path), "utf8"));
	} catch {
		return [];
	}
}

export function sshLines(raw: string): string[] {
	return raw
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

export async function readSshConfig(path: string | undefined, alias: string): Promise<SshConfigValues> {
	const result: SshConfigValues = {};
	let active = false;
	for (const line of await readSshLines(path ?? join(homedir(), ".ssh", "config"))) {
		const match = /^([^\s]+)\s+(.*?)\s*$/u.exec(line);
		if (!match) continue;
		const key = match[1];
		const value = match[2];
		if (!key || value === undefined) continue;
		const normalizedKey = key.toLowerCase();
		if (normalizedKey === "host") {
			active = value.split(/\s+/u).some((pattern) => !pattern.startsWith("!") && globMatches(pattern, alias));
			continue;
		}
		if (!active) continue;
		switch (normalizedKey) {
			case "hostname":
				if (!result.hostName) result.hostName = value;
				break;
			case "user":
				if (!result.user) result.user = value;
				break;
			case "port":
				if (!result.port && /^\d+$/u.test(value)) result.port = Number(value);
				break;
			case "identityfile":
				if (!result.identityFile) result.identityFile = expandHome(value.replace(/^"|"$/gu, ""));
				break;
			case "proxyjump":
				if (!result.proxyJump && value !== "none")
					result.proxyJump = value
						.split(",")
						.map((entry) => entry.trim())
						.filter(Boolean);
				break;
		}
	}
	return result;
}

export function resolveIdentityFile(path: string): string {
	const expanded = resolve(expandHome(path));
	const rel = relative(resolve(join(homedir(), ".ssh")), expanded);
	if (rel.startsWith("../") || isAbsolute(rel))
		throw new ComputeTransportError("unsafe-key-path", "IdentityFile must be inside ~/.ssh");
	return expanded;
}

const SAFE_HOST_KEY_ALGORITHMS = new Set([
	"ssh-ed25519",
	"ecdsa-sha2-nistp256",
	"ecdsa-sha2-nistp384",
	"ecdsa-sha2-nistp521",
	"rsa-sha2-256",
	"rsa-sha2-512",
]);

function sshKeyAlgorithm(key: Buffer): string {
	if (key.byteLength < 4) return "unknown";
	const size = key.readUInt32BE(0);
	if (size <= 0 || size > key.byteLength - 4) return "unknown";
	return key.subarray(4, 4 + size).toString("ascii");
}

function hostFingerprint(key: Buffer): string {
	return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/u, "")}`;
}

interface KnownHostRecord {
	readonly hosts: readonly string[];
	readonly key: string;
	readonly marker?: string;
}

async function readKnownHosts(path: string): Promise<KnownHostRecord[]> {
	const records: KnownHostRecord[] = [];
	for (const line of await readSshLines(path)) {
		const fields = line.split(/\s+/u);
		const offset = fields[0]?.startsWith("@") ? 1 : 0;
		const [hosts, algorithm, key] = fields.slice(offset, offset + 3);
		if (hosts && algorithm && key)
			records.push({ hosts: hosts.split(","), key, marker: offset ? fields[0] : undefined });
	}
	return records;
}

function hashedHostMatches(token: string, host: string): boolean {
	const match = /^\|1\|([^|]+)\|([^|]+)$/u.exec(token);
	if (!match) return false;
	try {
		const saltText = match[1];
		const expectedText = match[2];
		if (!saltText || !expectedText) return false;
		const salt = Buffer.from(saltText, "base64");
		const expected = Buffer.from(expectedText, "base64");
		const actual = createHmac("sha1", salt).update(host).digest();
		return actual.byteLength === expected.byteLength && actual.equals(expected);
	} catch {
		return false;
	}
}

function knownHostMatches(token: string, host: string, port: number): boolean {
	if (token.startsWith("|1|")) return hashedHostMatches(token, host);
	return globMatches(token, host) || token === `[${host}]:${port}` || (port === 22 && token === host);
}

export class HostKeyPolicy {
	private writeLock: Promise<void> = Promise.resolve();
	constructor(
		private readonly options: DefaultComputeExecutorOptions,
		private readonly agentDir: string,
	) {}

	private get dronePath(): string {
		return expandHome(this.options.knownHostsPath ?? join(this.agentDir, "compute", "known_hosts"));
	}

	async verify(host: HostProfile, key: Buffer): Promise<boolean> {
		const algorithm = sshKeyAlgorithm(key);
		if (!SAFE_HOST_KEY_ALGORITHMS.has(algorithm))
			throw new ComputeTransportError(
				"host-key-algorithm",
				`Host key algorithm is not allowed: ${algorithm}`,
			);
		const encoded = key.toString("base64");
		const actual = hostFingerprint(key);
		if (host.hostKeyFingerprint && host.hostKeyFingerprint !== actual)
			throw new ComputeTransportError("host-key-changed", `Host key fingerprint changed for ${host.alias}`);
		const port = host.port ?? 22;
		const names = [host.host, host.alias];
		const records = [
			...(await readKnownHosts(join(homedir(), ".ssh", "known_hosts"))),
			...(await readKnownHosts(this.dronePath)),
		];
		const matches = records.filter((record) =>
			record.hosts.some((token) => names.some((name) => knownHostMatches(token, name, port))),
		);
		if (matches.some((record) => record.marker === "@revoked" && record.key === encoded))
			throw new ComputeTransportError("host-key-revoked", `Host key is revoked for ${host.alias}`);
		if (matches.length) {
			if (matches.some((record) => record.key === encoded)) return true;
			throw new ComputeTransportError("host-key-changed", `Host key changed for ${host.alias}`);
		}
		if (!this.options.onUnknownHostKey)
			throw new ComputeTransportError("unknown-host-key", `Unknown host key for ${host.alias}`);
		if (
			!(await this.options.onUnknownHostKey({
				alias: host.alias,
				host: host.host,
				port,
				algorithm,
				fingerprint: actual,
				knownHostsPath: this.dronePath,
			}))
		)
			throw new ComputeTransportError(
				"unknown-host-key-rejected",
				`Host key was not accepted for ${host.alias}`,
			);
		await this.persist(host, port, algorithm, encoded);
		return true;
	}

	private async persist(host: HostProfile, port: number, algorithm: string, encoded: string): Promise<void> {
		this.writeLock = this.writeLock.then(async () => {
			const path = this.dronePath;
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			let existing = "";
			try {
				existing = await readFile(path, "utf8");
			} catch {
				/* first pin */
			}
			const marker = port === 22 ? host.host : `[${host.host}]:${port}`;
			if (
				!existing.split(/\r?\n/u).some((line) => line.split(/\s+/u)[0] === marker && line.includes(encoded))
			)
				await writeFile(
					path,
					`${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${marker} ${algorithm} ${encoded}\n`,
					{ mode: 0o600 },
				);
		});
		await this.writeLock;
	}
}
