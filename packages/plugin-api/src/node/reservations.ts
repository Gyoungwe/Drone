import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Shared local-user format; native adapters use the same namespace and canonical resource keys. */
export class PluginResourceReservations {
	private readonly releases = new Map<string, () => void>();
	private readonly checks = new Map<string, () => void>();
	constructor(private readonly directory = join(homedir(), ".drone", "runtime-leases")) {}

	reserve(namespace: string, canonicalKeys: readonly string[]): void {
		const directory = join(this.directory, namespace);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const acquired: [string, () => void][] = [];
		try {
			for (const key of canonicalKeys) {
				const id = `${namespace}/${createHash("sha256").update(key).digest("hex")}.lock`;
				if (this.releases.has(id)) {
					this.assertReserved(namespace, key);
					continue;
				}
				const path = join(this.directory, id);
				let fd: number;
				try {
					fd = openSync(path, "wx", 0o600);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					throw new Error(
						"Plugin resource writer is already reserved; stale reservations require explicit recovery",
						{ cause: error },
					);
				}
				const identity = fstatSync(fd),
					token = `${randomUUID()}\n${process.pid}\n`;
				try {
					writeFileSync(fd, token, "utf8");
				} catch (error) {
					unlinkSync(path);
					throw error;
				} finally {
					closeSync(fd);
				}
				const check = () => {
					const current = lstatSync(path);
					if (
						!current.isFile() ||
						current.dev !== identity.dev ||
						current.ino !== identity.ino ||
						readFileSync(path, "utf8") !== token
					)
						throw new Error("Plugin resource reservation ownership changed");
				};
				const release = () => {
					check();
					unlinkSync(path);
				};
				this.checks.set(id, check);
				this.releases.set(id, release);
				acquired.push([id, release]);
			}
		} catch (error) {
			const cleanup = this.release(acquired);
			if (cleanup.length)
				throw new AggregateError([error, ...cleanup], "Plugin resource reservation failed to unwind");
			throw error;
		}
	}

	/** Recheck this instance's real lock identity and token before committing a durable mutation. */
	assertReserved(namespace: string, canonicalKey: string): void {
		const id = `${namespace}/${createHash("sha256").update(canonicalKey).digest("hex")}.lock`;
		const check = this.checks.get(id);
		if (!check) throw new Error("Plugin writer directory was not reserved by this owner");
		check();
	}

	private release(entries: readonly [string, () => void][]): unknown[] {
		const failures: unknown[] = [];
		for (const [id, release] of entries) {
			try {
				release();
				this.releases.delete(id);
				this.checks.delete(id);
			} catch (error) {
				failures.push(error);
			}
		}
		return failures;
	}

	/** The caller first drains accepted domain operations and confirms all resource processes exited. */
	dispose(): void {
		const failures = this.release([...this.releases]);
		if (failures.length)
			throw new AggregateError(failures, "Plugin resource reservations could not be released");
	}
}
