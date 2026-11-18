import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGED_DECODED_LIMIT, STAGED_SERIALIZED_LIMIT } from "@gyoungwe/plugin-api/p5-evidence";
import { expect, it, onTestFinished, vi } from "vitest";
import { P5ByteStaging, type P5StagingOwner } from "./p5-byte-staging";

const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
function fixture(limits = { decoded: 6, serialized: 120 }) {
	const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "p5-staging-")));
	const root = join(base, "staging");
	fs.mkdirSync(root);
	const controller = new AbortController();
	onTestFinished(() => {
		controller.abort();
		fs.rmSync(base, { recursive: true, force: true });
	});
	const owner: P5StagingOwner = {
		workspaceId: "workspace",
		sessionId: "session",
		callerSourceHash: "a".repeat(64),
		providerSourceHash: "b".repeat(64),
		callerId: "caller",
		action: "import",
		signal: controller.signal,
	};
	const stage = new P5ByteStaging(root, () => owner, limits);
	const open = (bytes = 6) => stage.open({ requestId: "request", path: "capsules/example.json", bytes });
	const chunk = (fileRef: string, offset: number, bytes = "ab", serialized = 40) =>
		stage.chunk({ fileRef, offset, base64: Buffer.from(bytes).toString("base64") }, serialized);
	const change = (patch: Partial<P5StagingOwner>) => Object.assign(owner, patch);
	const seal = (fileRef: string, bytes = 6, sha256 = hash("abcdef")) =>
		stage.seal({ fileRef, bytes, sha256 });
	return { stage, root, base, controller, open, chunk, change, seal };
}
it("uses B0's default limits without a separate chunk cap", () => {
	const f = fixture();
	const stage = new P5ByteStaging(f.root, () => undefined);
	expect(stage.limits).toEqual({ decoded: STAGED_DECODED_LIMIT, serialized: STAGED_SERIALIZED_LIMIT });
	const { fileRef } = f.open();
	f.chunk(fileRef, 0, "abcdef", 120);
	const ref = f.seal(fileRef);
	expect(ref).toEqual({ fileRef, bytes: 6, sha256: hash("abcdef") });
	expect(Object.isFrozen(ref)).toBe(true);
	expect(f.stage.read({ fileRef }).toString()).toBe("abcdef");
	f.stage.cancel({ fileRef });
	expect(fs.readdirSync(f.root)).toEqual([]);
});
it.each(["decoded", "serialized"] as const)("rejects the crossing chunk for running %s totals", (kind) => {
	const f = fixture({ decoded: kind === "decoded" ? 5 : 6, serialized: kind === "serialized" ? 119 : 120 });
	const { fileRef } = f.open();
	f.chunk(fileRef, 0);
	f.chunk(fileRef, 2);
	expect(() => f.chunk(fileRef, 4)).toThrow("LIMIT_EXCEEDED");
	expect(fs.readdirSync(f.root)).toEqual([]);
	expect(() => f.seal(fileRef)).toThrow("SCOPE_CHANGED");
});
it("seals exactly at both running caps with out-of-order ranges", () => {
	const f = fixture();
	const { fileRef } = f.open();
	f.chunk(fileRef, 4, "ef");
	f.chunk(fileRef, 0, "ab");
	f.chunk(fileRef, 2, "cd");
	expect(f.seal(fileRef).sha256).toBe(hash("abcdef"));
	f.controller.abort();
	expect(fs.readdirSync(f.root)).toEqual([]);
});
it.each(["hash", "bytes", "gap"])("cleans up a %s mismatch at seal", (kind) => {
	const f = fixture();
	const { fileRef } = f.open();
	f.chunk(fileRef, 0, kind === "gap" ? "abc" : "abcdef");
	expect(() =>
		f.seal(fileRef, kind === "bytes" ? 5 : 6, kind === "hash" ? hash("changed") : hash("abcdef")),
	).toThrow();
	expect(fs.readdirSync(f.root)).toEqual([]);
});
it.each(["chunk", "seal", "read"] as const)("rejects caller mismatch on %s", (operation) => {
	const fields = ["callerId", "workspaceId", "sessionId", "callerSourceHash", "providerSourceHash", "action"];
	for (const field of fields) {
		const f = fixture();
		const ref = f.open();
		f.chunk(ref.fileRef, 0, "abcdef");
		if (operation === "read") f.seal(ref.fileRef);
		f.change({ [field]: "other" });
		const invoke = {
			chunk: () => f.chunk(ref.fileRef, 0),
			seal: () => f.seal(ref.fileRef),
			read: () => f.stage.read(ref),
		};
		expect(invoke[operation]).toThrow("SCOPE_CHANGED");
		expect(fs.readdirSync(f.root)).toEqual([]);
	}
});
it("revocation immediately aborts open sessions", () => {
	const f = fixture();
	const ref = f.open();
	f.chunk(ref.fileRef, 0);
	f.controller.abort();
	expect(fs.readdirSync(f.root)).toEqual([]);
	expect(() => f.chunk(ref.fileRef, 2)).toThrow("SCOPE_CHANGED");
});
it.each(["open", "sealed", "revoked"])("fails closed after root replacement (%s)", async (state) => {
	const uncaught = vi.fn();
	process.on("uncaughtException", uncaught);
	onTestFinished(() => {
		process.off("uncaughtException", uncaught);
	});
	for (const symlink of [false, true]) {
		const f = fixture();
		const ref = f.open();
		f.chunk(ref.fileRef, 0, state === "open" ? "ab" : "abcdef");
		if (state !== "open") f.seal(ref.fileRef);
		const moved = join(f.base, "moved");
		const replacement = symlink ? join(f.base, "replacement") : f.root;
		fs.renameSync(f.root, moved);
		fs.mkdirSync(replacement);
		if (symlink) fs.symlinkSync(replacement, f.root);
		if (state === "revoked") {
			expect(() => f.controller.abort()).not.toThrow();
			expect(() => f.stage.read(ref)).toThrow("SCOPE_CHANGED");
		}
		if (state === "sealed") expect(() => f.stage.read(ref)).toThrow();
		expect(() => f.chunk(ref.fileRef, 2)).toThrow();
		expect(() => f.seal(ref.fileRef)).toThrow();
		if (state === "open") expect(fs.readdirSync(moved)).toEqual([]);
		else {
			const name = `${ref.fileRef}.staged`;
			expect(fs.readdirSync(moved)).toEqual([name]);
			expect(fs.readFileSync(join(moved, name), "utf8")).toBe("abcdef");
			expect(fs.statSync(join(moved, name)).size).toBe(6);
		}
		expect(fs.readdirSync(f.root)).toEqual([]);
	}
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(uncaught).not.toHaveBeenCalled();
});
it("rejects an injected symlinked staging directory", () => {
	const f = fixture();
	const alias = join(f.base, "alias");
	fs.symlinkSync(f.root, alias);
	expect(() => new P5ByteStaging(alias, () => undefined)).toThrow("PATH_ESCAPE");
	expect(fs.readdirSync(f.root)).toEqual([]);
});
it.each(["read", "seal"] as const)("rejects tampered refs on %s", (operation) => {
	const f = fixture();
	const ref = f.open();
	f.chunk(ref.fileRef, 0, "abcdef");
	f.seal(ref.fileRef);
	fs.writeFileSync(join(f.root, `${ref.fileRef}.staged`), "edited");
	expect(() => (operation === "read" ? f.stage.read(ref) : f.seal(ref.fileRef, 6, hash("edited")))).toThrow();
	expect(fs.readdirSync(f.root)).toEqual([]);
});
