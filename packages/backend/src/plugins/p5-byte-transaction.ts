import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { STAGED_DECODED_LIMIT, type StagedRef } from "@gyoungwe/plugin-api/p5-evidence";
import { type Code, type FileReadback, Relative } from "@gyoungwe/plugin-api/p5-receipts";
import type { P5ByteStaging, P5StagingOwner } from "./p5-byte-staging";

export type P5ByteVersion = Pick<fs.Stats, "dev" | "ino" | "size" | "mtimeMs" | "ctimeMs"> & {
	readonly sha256: string;
};
export interface P5ByteWrite {
	readonly path: string;
	readonly source: StagedRef;
	readonly expected: P5ByteVersion | null;
}
class ByteTransactionError extends Error {
	constructor(
		readonly code: Code,
		readonly cleanup: "complete" | "failed",
	) {
		super(`P5 byte transaction: ${code}`);
	}
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const same = (a: fs.Stats, b: fs.Stats) => a.dev === b.dev && a.ino === b.ino;
function version(stat: fs.Stats, sha256: string): P5ByteVersion {
	const { dev, ino, size, mtimeMs, ctimeMs } = stat;
	return { dev, ino, size, mtimeMs, ctimeMs, sha256 };
}
/** Host-only single-file mechanism. The caller observes it through R3; approval is never request JSON.
 * Parents must already exist. Leases belong exclusively to this owner and survive failed cleanup. */
export class P5ByteTransaction {
	private readonly identity: fs.Stats;
	private readonly owner: P5StagingOwner;
	private cleanup: "complete" | "failed" = "complete";
	constructor(
		private readonly root: string,
		private readonly staging: P5ByteStaging,
		private readonly scopeOf: () => P5StagingOwner | undefined,
		private readonly leases: PluginResourceReservations,
	) {
		const owner = scopeOf();
		if (!owner || owner.signal.aborted) throw new ByteTransactionError("SCOPE_CHANGED", this.cleanup);
		this.owner = { ...owner };
		this.identity = this.boundary(() => fs.lstatSync(root));
	}
	private fail(code: Code): never {
		throw new ByteTransactionError(code, this.cleanup);
	}
	private boundary<T>(operation: () => T): T {
		try {
			return operation();
		} catch (error) {
			if (error instanceof ByteTransactionError) throw error;
			// Filesystem and staging errors may contain private OS paths; never attach their causes.
			return this.fail("READBACK_FAILED");
		}
	}
	private checkScope(): void {
		if (this.owner.signal.aborted) this.fail("CANCELLED");
		const current = this.scopeOf();
		if (current?.signal !== this.owner.signal || !isDeepStrictEqual(current, this.owner))
			this.fail("SCOPE_CHANGED");
		if (this.cleanup === "failed") this.fail("CLEANUP_FAILED");
	}
	private parent(path: string): string {
		if (!new RegExp(Relative.pattern).test(path) || /(^[A-Za-z]:|\0)/.test(path)) this.fail("PATH_ESCAPE");
		const root = fs.lstatSync(this.root);
		if (!root.isDirectory() || !same(root, this.identity) || fs.realpathSync(this.root) !== this.root)
			this.fail("PATH_ESCAPE");
		let parent = this.root;
		for (const part of dirname(path) === "." ? [] : dirname(path).split("/")) {
			parent = join(parent, part);
			if (!fs.lstatSync(parent).isDirectory()) this.fail("PATH_ESCAPE");
		}
		if (fs.realpathSync(parent) !== parent) this.fail("PATH_ESCAPE");
		return parent;
	}
	private snapshot(path: string): P5ByteVersion | null {
		const target = join(this.root, path);
		const stat = fs.lstatSync(target, { throwIfNoEntry: false });
		if (!stat) return null;
		if (!stat.isFile()) this.fail("PATH_ESCAPE");
		if (stat.size > STAGED_DECODED_LIMIT) this.fail("LIMIT_EXCEEDED");
		const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
		try {
			const bytes = Buffer.alloc(stat.size + 1);
			let offset = 0;
			while (offset < bytes.length) {
				const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
				if (!count) break;
				offset += count;
			}
			const digest = hash(bytes.subarray(0, offset));
			const after = version(fs.fstatSync(fd), digest);
			this.parent(path);
			if (
				offset !== stat.size ||
				!isDeepStrictEqual(version(stat, digest), after) ||
				!isDeepStrictEqual(after, version(fs.lstatSync(target), digest))
			)
				this.fail("READBACK_FAILED");
			return after;
		} finally {
			fs.closeSync(fd);
		}
	}
	inspect(path: string): P5ByteVersion | null {
		return this.boundary(() => {
			this.checkScope();
			this.parent(path);
			return this.snapshot(path);
		});
	}
	/** Synchronous after host approval: no callback/yield between final CAS and atomic commit.
	 * CAS is optimistic for external writers; the shared lease excludes cooperating host writers. */
	write(plan: P5ByteWrite, approved: boolean): { file: FileReadback; cleanup: "complete" } {
		return this.boundary(() => {
			this.checkScope();
			if (!approved) this.fail("DENIED");
			const parent = this.parent(plan.path);
			const identity = fs.lstatSync(parent);
			this.leases.reserve("state-writers", [parent]);
			const bytes = this.staging.read({ fileRef: plan.source.fileRef });
			if (bytes.length !== plan.source.bytes || hash(bytes) !== plan.source.sha256)
				this.fail("READBACK_FAILED");
			const check = () => {
				this.checkScope();
				if (!same(fs.lstatSync(this.parent(plan.path)), identity)) this.fail("PATH_ESCAPE");
				this.leases.assertReserved("state-writers", parent);
				if (!isDeepStrictEqual(this.snapshot(plan.path), plan.expected)) this.fail("STATE_CONFLICT");
			};
			check();
			this.commit(plan, bytes, parent, identity, check);
			const actual = this.inspect(plan.path);
			if (actual?.sha256 !== plan.source.sha256 || actual.size !== plan.source.bytes)
				this.fail("READBACK_FAILED");
			return { file: { path: plan.path, bytes: actual.size, sha256: actual.sha256 }, cleanup: "complete" };
		});
	}
	private commit(
		plan: P5ByteWrite,
		bytes: Buffer,
		parent: string,
		identity: fs.Stats,
		check: () => void,
	): void {
		const temporary = join(parent, `.${randomUUID()}.tmp`);
		const fd = fs.openSync(
			temporary,
			fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
			0o600,
		);
		const owned: { identity?: fs.Stats } = {};
		try {
			try {
				owned.identity = fs.fstatSync(fd);
				fs.writeFileSync(fd, bytes);
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			check();
			const target = join(parent, basename(plan.path));
			if (plan.expected === null) fs.linkSync(temporary, target);
			else fs.renameSync(temporary, target);
		} finally {
			try {
				if (!same(fs.lstatSync(this.parent(plan.path)), identity)) this.fail("CLEANUP_FAILED");
				const current = fs.lstatSync(temporary, { throwIfNoEntry: false });
				if (current) {
					if (!owned.identity || !same(current, owned.identity)) this.fail("CLEANUP_FAILED");
					fs.unlinkSync(temporary);
					if (fs.lstatSync(temporary, { throwIfNoEntry: false })) this.fail("CLEANUP_FAILED");
				}
			} catch {
				this.cleanup = "failed";
				this.fail("CLEANUP_FAILED");
			}
		}
	}
	releaseReservations(): void {
		if (this.cleanup === "failed") this.fail("CLEANUP_FAILED");
		this.boundary(() => this.leases.dispose());
	}
}
