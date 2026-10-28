import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type PluginFileCall, PluginFileCapabilities } from "../plugins/file-capabilities";
import { StorageRegistry } from "../storage/registry";
import { InquiryService } from "./inquiry";

let directory: string, state: string, cache: string, leases: string;
beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "inquiry-writer-handoff-")));
	state = join(directory, "ledger");
	cache = join(directory, "cache");
	leases = join(directory, "leases");
	await mkdir(state);
	await mkdir(cache);
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
async function binary() {
	const registry = new StorageRegistry().register({
		id: "ledger",
		path: state,
		owner: "synthetic",
		schema: 2,
		sensitivity: "private",
	});
	return PluginFileCapabilities.create(
		[
			{
				handle: "selected",
				kind: "binary-state",
				path: state,
				scope: { kind: "application" },
				binaryStateWrite: { registry, storageId: "ledger" },
			},
		],
		cache,
		leases,
	);
}
const call: PluginFileCall = {
	scope: {
		kind: "session",
		workspaceId: "synthetic-workspace",
		workspaceDirectory: "/synthetic",
		sessionId: "creator",
	},
	signal: new AbortController().signal,
	bootstrap: false,
};
it("excludes the actual legacy SQLite writer and binary owner in both directions without changing original bytes", async () => {
	const legacy = new InquiryService(
		{ inquiryDir: state, projectId: "original-project" },
		new PluginResourceReservations(leases),
	);
	const ports = await binary();
	try {
		await legacy.recordDecision({
			id: "original",
			projectId: "original-project",
			kind: "workflow-repair",
			summary: "Original synthetic decision",
		});
		await expect(ports.reserveState({ root: "selected", path: "" }, call)).rejects.toThrow(
			"already reserved",
		);
		await legacy.dispose();
		const original = await readFile(join(state, "ledger.sqlite"));
		expect(await ports.reserveState({ root: "selected", path: "" }, call)).toEqual({ reserved: true });
		expect(
			() =>
				new InquiryService(
					{ inquiryDir: state, projectId: "original-project" },
					new PluginResourceReservations(leases),
				),
		).toThrow("already reserved");
		const raw = await ports.readBinary({ root: "selected", path: "ledger.sqlite" }, call);
		expect(raw).toMatchObject({
			kind: "value",
			version: createHash("sha256").update(original).digest("hex"),
		});
		expect(await readFile(join(state, "ledger.sqlite"))).toEqual(original);
		await ports.drain();
		ports.releaseReservations();
		const reopened = new InquiryService(
			{ inquiryDir: state, projectId: "original-project" },
			new PluginResourceReservations(leases),
		);
		try {
			expect((await reopened.listDecisions()).map((record) => record.id)).toEqual(["original"]);
		} finally {
			await reopened.dispose();
		}
	} finally {
		await legacy.dispose();
		await ports.drain();
		ports.releaseReservations();
	}
});
it("retains the real legacy writer lease when its connection fails to close", async () => {
	const legacy = new InquiryService(
		{ inquiryDir: state, projectId: "original-project" },
		new PluginResourceReservations(leases),
	);
	const storage = legacy.storage!;
	const close = storage.close.bind(storage);
	vi.spyOn(storage, "close").mockRejectedValue(new Error("synthetic close failure"));
	const ports = await binary();
	try {
		await expect(legacy.dispose()).rejects.toThrow("writer leases retained");
		await expect(ports.reserveState({ root: "selected", path: "" }, call)).rejects.toThrow(
			"already reserved",
		);
	} finally {
		// The test owns this temporary DB. Manual connection close does not forge a successful service release.
		await close();
		await ports.drain();
		ports.releaseReservations();
	}
});
