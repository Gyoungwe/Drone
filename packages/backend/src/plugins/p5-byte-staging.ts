import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as wire from "@gyoungwe/plugin-api/p5-evidence";
import type { Code, Result, Scope } from "@gyoungwe/plugin-api/p5-receipts";

const TEMP_FLAGS = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW;
export type P5StagingOwner = Scope & {
	readonly callerId: string;
	readonly action: string;
	readonly signal: AbortSignal;
};
class StagingError extends Error {
	constructor(readonly code: Code) {
		super(`P5 byte staging: ${code}`);
	}
}
function checked<T>(result: Result<T>): T {
	if (result.status === "failed") throw new StagingError(result.code);
	return result.value;
}
function same(left: fs.Stats, right: fs.Stats): boolean {
	const fields = ["dev", "ino", "size", "mtimeMs", "ctimeMs"] as const;
	return fields.every((key) => left[key] === right[key]);
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
interface Session {
	owner: P5StagingOwner;
	context: wire.StagedValidationContext;
	fd: number;
	path: string | null;
	decoded: number;
	serialized: number;
	revoke: () => void;
}
/** open.path describes the eventual target, never a staging OS path.
 * Synchronous boundaries serialize chunks/seal/cancel without yielding during a write. */
export class P5ByteStaging {
	private readonly sessions = new Map<string, Session>();
	private readonly rootIdentity: fs.Stats;
	readonly limits: Readonly<{ decoded: number; serialized: number }>;
	constructor(
		private readonly root: string,
		private readonly scopeOf: () => P5StagingOwner | undefined,
		/** Test-only override; production uses the B0 totals. */
		limits = { decoded: wire.STAGED_DECODED_LIMIT, serialized: wire.STAGED_SERIALIZED_LIMIT },
	) {
		this.limits = Object.freeze({ ...limits });
		this.rootIdentity = fs.lstatSync(root);
		this.checkRoot();
	}
	private checkRoot(): void {
		const stat = fs.lstatSync(this.root);
		const { dev, ino } = this.rootIdentity;
		if (!stat.isDirectory() || stat.dev !== dev || stat.ino !== ino) throw new StagingError("PATH_ESCAPE");
		if (fs.realpathSync(this.root) !== this.root) throw new StagingError("PATH_ESCAPE");
	}
	open(input: unknown): wire.StagedRefInput {
		const request = checked(wire.validateStagedOpen(input));
		const owner = this.scopeOf();
		if (!owner || owner.signal.aborted) throw new StagingError("SCOPE_CHANGED");
		const fileRef = randomUUID();
		const session: Session = {
			owner: { ...owner },
			fd: -1,
			path: null,
			decoded: 0,
			serialized: 0,
			context: { fileRef, bytes: request.bytes, state: "open", sha256: null, sealedRanges: [] },
			revoke: () => this.remove(session, true),
		};
		return this.boundary(session, () => {
			this.checkRoot();
			const temporary = join(this.root, `${fileRef}.tmp`);
			session.fd = fs.openSync(temporary, TEMP_FLAGS, 0o600);
			session.path = temporary;
			// Unnamed open temporaries remain disposable even if the parent is replaced.
			fs.unlinkSync(session.path);
			session.path = null;
			this.sessions.set(fileRef, session);
			owner.signal.addEventListener("abort", session.revoke, { once: true });
			return Object.freeze({ fileRef });
		});
	}
	/** serializedBytes is trusted host-measured wire/envelope metadata, never request JSON. */
	chunk(input: wire.StagedChunkInput, serializedBytes: number): void {
		this.use(input, (session) => {
			const chunk = checked(wire.validateStagedChunk(input, session.context, serializedBytes));
			const bytes = Buffer.from(chunk.base64, "base64");
			const decoded = session.decoded + bytes.length;
			const serialized = session.serialized + serializedBytes;
			if (decoded > this.limits.decoded || serialized > this.limits.serialized)
				throw new StagingError("LIMIT_EXCEEDED");
			let offset = 0;
			while (offset < bytes.length)
				offset += fs.writeSync(session.fd, bytes, offset, bytes.length - offset, chunk.offset + offset);
			session.decoded = decoded;
			session.serialized = serialized;
			const range = { offset: chunk.offset, bytes: bytes.length };
			session.context = { ...session.context, sealedRanges: [...session.context.sealedRanges, range] };
		});
	}
	seal(input: wire.StagedSealInput): wire.StagedRef {
		return this.use(input, (session) => {
			if (session.context.state === "sealed") checked(wire.validateStagedSeal(input, session.context));
			const bytes = this.snapshot(session);
			const context = { ...session.context, sha256: sha256(bytes) };
			checked(wire.validateStagedSeal(input, context));
			if (bytes.length !== context.bytes) throw new StagingError("READBACK_FAILED");
			if (context.state === "open") {
				const temporary = join(this.root, `${context.fileRef}.tmp`);
				const fd = fs.openSync(temporary, TEMP_FLAGS, 0o600);
				session.path = temporary;
				fs.closeSync(session.fd);
				session.fd = fd;
				fs.writeFileSync(fd, bytes);
				fs.fsyncSync(fd);
				this.checkRoot();
				const final = join(this.root, `${context.fileRef}.staged`);
				fs.renameSync(session.path, final);
				session.path = final;
			}
			const sealed = this.snapshot(session);
			if (sealed.length !== input.bytes || sha256(sealed) !== input.sha256)
				throw new StagingError("READBACK_FAILED");
			session.context = { ...context, state: "sealed", sha256: sha256(sealed) };
			return Object.freeze(checked(wire.validateStagedRef({ fileRef: context.fileRef }, session.context)));
		});
	}
	read(input: wire.StagedRefInput): Buffer {
		return this.use(input, (session) => {
			const ref = checked(wire.validateStagedRef(input, session.context));
			const bytes = this.snapshot(session);
			if (bytes.length !== ref.bytes || sha256(bytes) !== ref.sha256)
				throw new StagingError("READBACK_FAILED");
			return bytes;
		});
	}
	cancel(input: wire.StagedRefInput): void {
		this.use(input, (session) => this.remove(session));
	}
	private snapshot(session: Session): Buffer {
		const before = fs.fstatSync(session.fd);
		if (!before.isFile() || before.size > this.limits.decoded) throw new StagingError("LIMIT_EXCEEDED");
		const bytes = Buffer.alloc(before.size + 1);
		let offset = 0;
		while (offset < bytes.length) {
			const count = fs.readSync(session.fd, bytes, offset, bytes.length - offset, offset);
			if (!count) break;
			offset += count;
		}
		const after = fs.fstatSync(session.fd);
		this.checkRoot();
		const current = session.path === null ? after : fs.lstatSync(session.path);
		if (!same(before, after) || offset !== before.size || !same(after, current))
			throw new StagingError("READBACK_FAILED");
		return bytes.subarray(0, offset);
	}
	private use<T>(input: wire.StagedRefInput, operation: (session: Session) => T): T {
		const session = this.sessions.get(input.fileRef);
		if (!session) throw new StagingError("SCOPE_CHANGED");
		return this.boundary(session, () => {
			const owner = this.scopeOf();
			const scopeChanged = !owner || owner.signal.aborted || owner.signal !== session.owner.signal;
			if (scopeChanged || !isDeepStrictEqual(owner, session.owner)) throw new StagingError("SCOPE_CHANGED");
			this.checkRoot();
			return operation(session);
		});
	}
	private boundary<T>(session: Session, operation: () => T): T {
		try {
			return operation();
		} catch (error) {
			this.remove(session);
			// Native filesystem errors contain OS paths; expose only the public failure code.
			throw error instanceof StagingError ? error : new StagingError("READBACK_FAILED");
		}
	}
	private remove(session: Session, revoked = false): void {
		session.owner.signal.removeEventListener("abort", session.revoke);
		this.sessions.delete(session.context.fileRef);
		try {
			if (session.fd !== -1) fs.closeSync(session.fd);
			session.fd = -1;
			if (session.path !== null) {
				// A moved sealed directory is outside staging authority; never follow it for cleanup.
				this.checkRoot();
				fs.unlinkSync(session.path);
				session.path = null;
			}
		} catch {
			// Revocation already invalidated the ref; cleanup must not escape the abort listener.
			if (!revoked) throw new StagingError("CLEANUP_FAILED");
		}
	}
}
