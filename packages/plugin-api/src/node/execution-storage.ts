import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExecutionPrivateReceipt, ExecutionReceiptStorage } from "./execution-transactions.js";

export interface SignedExecutionReceipt {
	readonly record: ExecutionPrivateReceipt;
	readonly signature: string;
}
export interface ExecutionReceiptWriteBoundary {
	check(): Promise<void>;
	readBack(): Promise<unknown>;
}
export type ExecutionReceiptAtomicWrite = (
	path: string,
	value: SignedExecutionReceipt,
	boundary: ExecutionReceiptWriteBoundary,
) => Promise<void>;
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

/** Host supplies its actual JsonStore writer; standalone Node uses the same checked snapshot/readback with atomic fs writes. */
export class NodeExecutionReceiptStorage implements ExecutionReceiptStorage {
	private readonly versions = new Map<string, string | null>();
	private constructor(
		private readonly directory: string,
		private readonly key: Uint8Array,
		private readonly atomic?: ExecutionReceiptAtomicWrite,
	) {}

	static async create(
		directory: string,
		key: Uint8Array,
		atomic?: ExecutionReceiptAtomicWrite,
	): Promise<NodeExecutionReceiptStorage> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const canonical = await realpath(directory);
		if ((await lstat(directory)).isSymbolicLink() || canonical !== resolve(directory))
			throw new Error("Execution receipt directory must be canonical and contain no symlink");
		return new NodeExecutionReceiptStorage(canonical, key, atomic);
	}
	private signature(record: ExecutionPrivateReceipt): string {
		return createHmac("sha256", this.key).update(JSON.stringify(record)).digest("hex");
	}
	private async snapshot(
		key: string,
	): Promise<{ record: ExecutionPrivateReceipt | null; version: string | null }> {
		if ((await realpath(this.directory)) !== this.directory || (await lstat(this.directory)).isSymbolicLink())
			throw new Error("Execution receipt directory changed");
		const path = join(this.directory, `${key}.json`);
		let text: string;
		try {
			const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const info = await file.stat();
				if (!info.isFile() || info.size > 65536)
					throw new Error("Execution receipt must be a private bounded JSON file");
				text = await file.readFile("utf8");
				if (Buffer.byteLength(text) > 65536)
					throw new Error("Execution receipt exceeded its private JSON size bound");
			} finally {
				await file.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { record: null, version: null };
			throw error;
		}
		let value: SignedExecutionReceipt;
		try {
			value = JSON.parse(text) as SignedExecutionReceipt;
		} catch (cause) {
			throw new Error("Execution receipt needs recovery: JSON is corrupt", { cause });
		}
		if (
			!value ||
			!value.record ||
			typeof value.signature !== "string" ||
			!/^[a-f0-9]{64}$/.test(value.signature) ||
			!timingSafeEqual(Buffer.from(value.signature, "hex"), Buffer.from(this.signature(value.record), "hex"))
		)
			throw new Error("Execution receipt needs recovery: integrity or application key does not match");
		return { record: value.record, version: hash(text) };
	}
	async read(key: string): Promise<ExecutionPrivateReceipt | null> {
		const current = await this.snapshot(key);
		this.versions.set(key, current.version);
		return current.record;
	}
	async write(
		key: string,
		record: ExecutionPrivateReceipt,
		expected: ExecutionPrivateReceipt | null,
	): Promise<void> {
		const path = join(this.directory, `${key}.json`);
		const value: SignedExecutionReceipt = { record, signature: this.signature(record) };
		const bytes = `${JSON.stringify(value, null, 2)}\n`;
		const boundary = {
			check: async () => {
				const current = await this.snapshot(key);
				if (
					!this.versions.has(key) ||
					current.version !== this.versions.get(key) ||
					JSON.stringify(current.record) !== JSON.stringify(expected)
				)
					throw new Error("Execution receipt version conflict");
			},
			readBack: async () => {
				const current = await this.snapshot(key);
				if (current.version !== hash(bytes))
					throw new Error("Execution receipt did not read back after write");
				return current;
			},
		};
		if (this.atomic) await this.atomic(path, value, boundary);
		else {
			await boundary.check();
			const temporary = join(this.directory, `.execution-${randomUUID()}.tmp`);
			try {
				await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
				await boundary.check();
				if (expected === null) await link(temporary, path);
				else await rename(temporary, path);
			} catch (error) {
				const [cleanup] = await Promise.allSettled([rm(temporary, { force: true })]);
				if (cleanup.status === "rejected")
					throw new AggregateError(
						[error, cleanup.reason],
						"Execution receipt write and temporary cleanup failed",
					);
				throw error;
			}
			await rm(temporary, { force: true });
		}
		const current = await boundary.readBack();
		this.versions.set(key, current.version);
	}
}
