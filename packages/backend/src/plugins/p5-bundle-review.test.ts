import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BundleInput, ExportFile } from "@gyoungwe/plugin-api/p5-evidence";
import type { Receipt } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it } from "vitest";
import { JsonStore } from "../json-store";
import { StorageRegistry } from "../storage/registry";
import {
	createP5BundleReviewer,
	type FrozenP5Bundle,
	freezeP5Bundle,
	P5_REVIEW_MAX_TEXT_BYTES,
	P5BundleReviewError,
} from "./p5-bundle-review";
import { createP5ReceiptStore, type P5ReceiptStore } from "./p5-receipt-store";

const scope = {
	workspaceId: "workspace",
	sessionId: "session",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const target = { destination: "runs/kernel/exports", audience: "private" } as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function file(text = "print('synthetic')\n", path = "kernel.py"): ExportFile {
	return {
		path,
		mediaType: "text/x-python",
		source: { kind: "text", text },
		bytes: Buffer.byteLength(text),
		sha256: hash(text),
	};
}
function input(
	files = [file(), { ...file("{}", "kernel.ipynb"), mediaType: "application/x-ipynb+json" as const }],
): BundleInput {
	return { requestId: "export", files };
}
async function withStore(run: (store: P5ReceiptStore, path: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-bundle-"));
	try {
		const path = join(directory, "receipts.json");
		await new JsonStore({ path, storageId: "agent-p5-receipts", defaultValue: () => [] }).write([]);
		await run(createP5ReceiptStore({ path, registry: new StorageRegistry() }), path);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
const decide = async () => ({ requestId: "decision" });
async function record(store: P5ReceiptStore, bundle: FrozenP5Bundle, overrides: Partial<Receipt> = {}) {
	await store.accept(await decide(), {
		receiptRef: "decision-receipt",
		operation: "files.writeBundle",
		inputSha256: bundle.sha256,
		scope: bundle.scope,
		category: "compute-preflight",
		decision: "approved",
		status: "accepted",
		at: "2026-11-18T00:00:00Z",
		resultSha256: null,
		readback: [],
		parentReceiptRef: null,
		...overrides,
	});
}

it("keeps the complete 1 MiB text and rejects one extra UTF-8 byte without writing state", () =>
	withStore(async (store, path) => {
		expect(P5_REVIEW_MAX_TEXT_BYTES).toBe(1024 * 1024);
		const text = "é".repeat(512 * 1024);
		const bundle = freezeP5Bundle(input([file(text)]), target, scope);
		await record(store, bundle);
		const before = await readFile(path);
		const reviewer = createP5BundleReviewer(store, async (review) => {
			expect(review.request.files[0]?.source).toEqual({ kind: "text", text });
			return decide();
		});
		await reviewer.review(bundle);
		expect(bundle.request.files[0]?.source).toEqual({ kind: "text", text });
		expect(bundle.request.files[0]?.bytes).toBe(1024 * 1024);
		const oversized = () => freezeP5Bundle(input([file(`${text}x`)]), target, scope);
		expect(oversized).toThrow(P5BundleReviewError);
		expect(oversized).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
		expect(await readFile(path)).toEqual(before);
	}));

it.each<Partial<Receipt> | null>([
	null,
	{ category: "application-state-write" },
	{ decision: "denied", status: "failed" },
	{ decision: "not-required" },
	{ inputSha256: "c".repeat(64) },
	{ operation: "state.writeJson" },
	{ scope: { ...scope, sessionId: "other" } },
])("rejects a missing or nonmatching C decision %j without state writes", (overrides) =>
	withStore(async (store, path) => {
		const bundle = freezeP5Bundle(input(), target, scope);
		if (overrides !== null) await record(store, bundle, overrides);
		const before = await readFile(path);
		const result = createP5BundleReviewer(store, decide).review(bundle);
		await expect(result).rejects.toMatchObject({ code: "DENIED" });
		expect(await readFile(path)).toEqual(before);
	}),
);

it.each([
	"text",
	"path",
	"media",
	"destination",
	"audience",
	"scope",
	"remove",
	"add",
	"reorder",
	"fileRef",
	"bytes",
	"sha256",
])("invalidates C when %s changes, without writes", (kind) =>
	withStore(async (store, path) => {
		const capsule: ExportFile = {
			...file("{}", "capsule.json"),
			mediaType: "application/json",
			source: { kind: "staged-file", fileRef: "host-stage" },
		};
		const staged = ["fileRef", "bytes", "sha256"].includes(kind);
		const original = input(staged ? [capsule] : kind === "add" ? [file()] : undefined);
		const bundle = freezeP5Bundle(original, target, scope);
		await record(store, bundle);
		const reviewer = createP5BundleReviewer(store, decide);
		const reviewed = await reviewer.review(bundle);
		expect(reviewer.validates(reviewed, bundle)).toBe(true);
		expect(reviewer.validates(structuredClone(reviewed), bundle)).toBe(false);
		expect(createP5BundleReviewer(store, decide).validates(reviewed, bundle)).toBe(false);
		const changed = {
			...original,
			files: original.files.map((entry) => ({ ...entry, source: { ...entry.source } })),
		};
		if (kind === "text") changed.files = [file("print('synthetic')!"), ...changed.files.slice(1)];
		if (kind === "path") for (const entry of changed.files) entry.path = `renamed/${entry.path}`;
		if (kind === "media") for (const entry of changed.files) entry.mediaType = "text/x-r";
		if (kind === "remove") changed.files.pop();
		if (kind === "add") changed.files = [...input().files];
		if (kind === "reorder") changed.files.reverse();
		if (kind === "fileRef")
			for (const entry of changed.files) Reflect.set(entry.source, "fileRef", "other-stage");
		if (kind === "bytes") for (const entry of changed.files) entry.bytes++;
		if (kind === "sha256") for (const entry of changed.files) entry.sha256 = "c".repeat(64);
		const nextTarget =
			kind === "audience"
				? { ...target, audience: "public" as const }
				: { ...target, destination: kind === "destination" ? "runs/other/exports" : target.destination };
		const next = freezeP5Bundle(changed, nextTarget, {
			...scope,
			workspaceId: kind === "scope" ? "other" : scope.workspaceId,
		});
		const before = await readFile(path);
		expect(next.sha256).not.toBe(bundle.sha256);
		expect(reviewer.validates(reviewed, next)).toBe(false);
		await expect(reviewer.review(next)).rejects.toMatchObject({ code: "DENIED" });
		expect(await readFile(path)).toEqual(before);
	}),
);

it("isolates and freezes caller inputs and review payloads during asynchronous consent", () =>
	withStore(async (store, path) => {
		const request = { ...input(), files: input().files.map((entry) => ({ ...entry })) };
		const destination = { ...target, destination: String(target.destination) };
		const caller = { ...scope };
		const bundle = freezeP5Bundle(request, destination, caller);
		await record(store, bundle);
		const before = await readFile(path);
		const reviewer = createP5BundleReviewer(store, async (review) => {
			for (const entry of request.files) entry.source = { kind: "text", text: "changed" };
			caller.sessionId = "changed";
			destination.destination = "changed";
			for (const entry of review.request.files) {
				expect(Reflect.set(entry.source, "text", "changed")).toBe(false);
				expect(Reflect.set(entry, "path", "changed")).toBe(false);
			}
			expect(Reflect.set(review.request.files, "0", null)).toBe(false);
			return decide();
		});
		const reviewed = await reviewer.review(bundle);
		expect(reviewed.bundle.request).toEqual(input());
		expect(reviewed.bundle.target).toEqual(target);
		expect(reviewed.bundle.scope).toEqual(scope);
		expect(Reflect.set(reviewed, "computeReceiptRef", "changed")).toBe(false);
		expect(await readFile(path)).toEqual(before);
	}));

it.each(["bytes", "sha256", "duplicate", "escape", "absolute", "media", "empty"])(
	"rejects invalid %s before any state write",
	(kind) =>
		withStore(async (_store, path) => {
			const entry = { ...file() };
			if (kind === "bytes") entry.bytes++;
			if (kind === "sha256") entry.sha256 = "c".repeat(64);
			if (kind === "escape") entry.path = "../escaped.py";
			if (kind === "absolute") entry.path = "/escaped.py";
			if (kind === "media") Reflect.set(entry, "mediaType", "text/plain");
			const before = await readFile(path);
			const request = input(kind === "empty" ? [] : kind === "duplicate" ? [entry, entry] : [entry]);
			expect(() => freezeP5Bundle(request, target, scope)).toThrow(
				expect.objectContaining({ code: "INVALID_INPUT" }),
			);
			expect(await readFile(path)).toEqual(before);
		}),
);
