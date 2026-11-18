import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fact } from "@gyoungwe/plugin-api/p5-inquiry";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JsonStore } from "../json-store";
import { StorageRegistry } from "../storage/registry";
import { createP5FactStore, p5FactSummary } from "./p5-facts";

const scope = { workspaceId: "workspace-1", sessionId: "session-1" };
const fixture = { directory: "", path: "" };
const open = () => createP5FactStore({ path: fixture.path, registry: new StorageRegistry() });
function fact(id: string): Omit<Fact, "sequence"> {
	const metadata = {
		id,
		kind: "compute",
		entityId: "host-run-1",
		at: "2026-11-18T00:00:00Z",
		status: "succeeded",
		artifactRefs: [],
		runReceiptRef: "host-receipt-1",
		decisionKind: null,
		basis: ["host-request-1"],
	} as const;
	return { ...metadata, summary: p5FactSummary(metadata) };
}
beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-fact-commits-"));
	fixture.path = join(fixture.directory, "facts.json");
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(fixture.directory, { recursive: true, force: true });
});

it("notifies without a payload for a committed fact, but not an idempotent duplicate", async () => {
	const store = open();
	const changed = vi.fn();
	store.subscribe(scope, changed);
	const input = fact("first");
	const saved = await store.append(scope, input);
	expect(saved).toEqual({ ...input, sequence: 1 });
	expect(changed.mock.calls).toEqual([[]]);
	expect(await store.read(scope, { after: null, limit: 64 })).toEqual({ cursor: "first", facts: [saved] });
	expect(await store.append(scope, input)).toEqual(saved);
	expect(changed.mock.calls).toEqual([[]]);
});

it("preserves the append result and other notifications when a subscriber throws", async () => {
	const store = open();
	const changed = vi.fn();
	store.subscribe(scope, () => {
		throw new Error("Synthetic subscriber failure");
	});
	store.subscribe(scope, changed);
	const input = fact("first");
	await expect(store.append(scope, input)).resolves.toEqual({ ...input, sequence: 1 });
	expect(changed.mock.calls).toEqual([[]]);
	expect((await store.read(scope, { after: null, limit: 64 })).facts).toEqual([{ ...input, sequence: 1 }]);
});

it.each(["success", "cas", "write", "readback"] as const)(
	"waits for strict readback and emits nothing on failure: %s",
	async (outcome) => {
		const store = open();
		const changed = vi.fn();
		const readBackCompleted = vi.fn();
		store.subscribe(scope, changed);
		const writeChecked = JsonStore.prototype.writeChecked;
		let checks = 0;
		vi.spyOn(JsonStore.prototype, "writeChecked").mockImplementation(function <R>(
			this: JsonStore<unknown>,
			value: unknown,
			boundary: { check(): Promise<void>; readBack(): Promise<R> },
		) {
			return (writeChecked<R>).call(this, value, {
				check: async () => {
					await boundary.check();
					checks += 1;
					if (outcome === "cas" && checks === 1) await writeFile(fixture.path, "[]\n");
					if (outcome === "write" && checks === 2) await mkdir(fixture.path);
				},
				readBack: async () => {
					expect(changed).not.toHaveBeenCalled();
					if (outcome === "readback") await writeFile(fixture.path, "[]\n");
					const result = await boundary.readBack();
					expect(changed).not.toHaveBeenCalled();
					readBackCompleted();
					return result;
				},
			});
		});
		const pending = store.append(scope, fact("first"));
		if (outcome === "success") {
			await expect(pending).resolves.toMatchObject({ id: "first", sequence: 1 });
			expect(readBackCompleted).toHaveBeenCalledOnce();
			expect(changed.mock.calls).toEqual([[]]);
		} else {
			const codes = { cas: "STATE_CONFLICT", write: "EISDIR", readback: "READBACK_FAILED" };
			await expect(pending).rejects.toMatchObject({ code: codes[outcome] });
			expect(readBackCompleted).not.toHaveBeenCalled();
			expect(changed).not.toHaveBeenCalled();
		}
	},
);

it("notifies only matching workspace/session subscriptions on the appending instance", async () => {
	const store = open();
	const subscribers = [
		scope,
		{ ...scope, sessionId: "session-2" },
		{ ...scope, workspaceId: "workspace-2" },
	].map((scope) => ({ scope, changed: vi.fn() }));
	for (const subscriber of subscribers) store.subscribe(subscriber.scope, subscriber.changed);
	const sibling = open();
	const siblingChanged = vi.fn();
	sibling.subscribe(scope, siblingChanged);
	for (const [index, subscriber] of subscribers.entries()) {
		await store.append(subscriber.scope, fact(`fact-${index}`));
		for (const [peer, { changed }] of subscribers.entries())
			expect(changed).toHaveBeenCalledTimes(peer <= index ? 1 : 0);
	}
	expect(siblingChanged).not.toHaveBeenCalled();
	await sibling.append(scope, fact("sibling"));
	expect(siblingChanged).toHaveBeenCalledOnce();
	for (const { changed } of subscribers) expect(changed).toHaveBeenCalledOnce();
});

it("unsubscribes idempotently, including itself and a later subscriber during notification", async () => {
	const store = open();
	const removed = vi.fn();
	const active = vi.fn();
	const first = vi.fn(() => {
		unsubscribeSelf();
		unsubscribeSelf();
		unsubscribeLater();
	});
	const unsubscribeSelf = store.subscribe(scope, first);
	const unsubscribeLater = store.subscribe(scope, removed);
	store.subscribe(scope, active);
	await store.append(scope, fact("first"));
	unsubscribeLater();
	await store.append(scope, fact("second"));
	expect(first).toHaveBeenCalledOnce();
	expect(removed).not.toHaveBeenCalled();
	expect(active.mock.calls).toEqual([[], []]);
});

it("has no gap between subscribing and an initial read racing an append", async () => {
	const store = open();
	await store.append(scope, fact("seed"));
	const changed = vi.fn();
	store.subscribe(scope, changed);
	const [initial, saved] = await Promise.all([
		store.read(scope, { after: null, limit: 64 }),
		store.append(scope, fact("concurrent")),
	]);
	expect(initial.facts.some((fact) => fact.id === saved.id) || changed.mock.calls.length > 0).toBe(true);
	expect((await store.read(scope, { after: "seed", limit: 64 })).facts).toEqual([saved]);
});
