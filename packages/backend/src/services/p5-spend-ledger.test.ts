import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Usage } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it } from "vitest";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import { createDefaultStorageRegistry } from "../storage/registry";
import { createP5SpendLedger, P5_SPEND_STORAGE } from "./p5-spend-ledger";

const metered = { workspaceId: "workspace-1", metered: true };
const known: Usage = {
	state: "known",
	metered: true,
	inputTokens: 6,
	outputTokens: 3,
	cost: null,
};
const unknown: Usage = {
	state: "unknown",
	metered: true,
	inputTokens: null,
	outputTokens: null,
	cost: null,
};

function fixture(limit: number | undefined) {
	const path = join(tmpdir(), `drone-p5-spend-${randomUUID()}.json`);
	const clock = { now: new Date("2026-11-18T23:59:59+08:00") };
	const limits = new Map([
		["workspace-1", limit],
		["workspace-2", limit],
	]);
	const open = () =>
		createP5SpendLedger({
			path,
			clock: () => clock.now,
			localDayKey: (date) => new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
			limitFor: (workspaceId) => limits.get(workspaceId),
		});
	return { path, clock, limits, open };
}

it("matches the registered private spend ledger storage descriptor", () => {
	const agentDir = "/tmp/drone-agent";
	const registry = createDefaultStorageRegistry({ agentDir });
	expect(registry.assertRegistered("agent-p5-spend-ledger")).toEqual({
		...P5_SPEND_STORAGE,
		path: join(agentDir, "p5-spend-ledger.json"),
	});
});

it("counts both token fields without cost, records overshoot, and denies new items across reopen", async () => {
	const { open, limits } = fixture(10);
	const ledger = open();
	expect(await ledger.check(metered)).toBe("allowed");
	await ledger.record({ workspaceId: metered.workspaceId, ...known });
	expect(await ledger.check(metered)).toBe("allowed");
	await ledger.record({ workspaceId: metered.workspaceId, ...known });
	expect(await open().check(metered)).toBe("denied");
	limits.set(metered.workspaceId, 18);
	expect(await open().check(metered)).toBe("denied");
	limits.set(metered.workspaceId, 19);
	expect(await open().check(metered)).toBe("allowed");
});

it("always allows unmetered items and ignores both known and unknown unmetered usage", async () => {
	const { open, limits } = fixture(undefined);
	const ledger = open();
	const unmetered = { ...metered, metered: false };
	expect(await ledger.check(unmetered)).toBe("allowed");
	await ledger.record({ workspaceId: metered.workspaceId, ...known, metered: false });
	await ledger.record({ workspaceId: metered.workspaceId, ...unknown, metered: false });
	limits.set(metered.workspaceId, 1);
	expect(await open().check(metered)).toBe("allowed");
	await ledger.record({ workspaceId: metered.workspaceId, ...known });
	expect(await ledger.check(unmetered)).toBe("allowed");
});

it("persists unknown usage as a workspace-day denial without inventing tokens", async () => {
	const { open, clock } = fixture(10);
	const ledger = open();
	await ledger.record({ workspaceId: metered.workspaceId, ...unknown });
	await ledger.record({ workspaceId: metered.workspaceId, ...known });
	expect(await open().check(metered)).toBe("denied");
	expect(await ledger.check({ ...metered, metered: false })).toBe("allowed");
	expect(await ledger.check({ ...metered, workspaceId: "workspace-2" })).toBe("allowed");
	clock.now = new Date("2026-11-19T00:00:00+08:00");
	expect(await open().check(metered)).toBe("allowed");
});

it.each(["{", "{}", '[{"tokens":-1}]'])(
	"denies corrupted storage without overwriting it: %s",
	async (contents) => {
		const { open, path } = fixture(10);
		const disk = new JsonStore<string>({
			path,
			storageId: P5_SPEND_STORAGE.id,
			defaultValue: () => "missing",
			serialize: () => contents,
			parse: (text) => text,
		});
		await disk.write(contents);
		expect(await open().check(metered)).toBe("denied");
		expect(await open().check({ ...metered, metered: false })).toBe("allowed");
		await expect(open().record({ workspaceId: metered.workspaceId, ...known })).rejects.toBeInstanceOf(
			JsonStoreCorruptedError,
		);
		expect(await disk.read()).toBe(`${contents}\n`);
	},
);

it("denies missing and zero limits and reads each workspace's current setting", async () => {
	const { open, limits } = fixture(undefined);
	const ledger = open();
	expect(await ledger.check(metered)).toBe("denied");
	limits.set(metered.workspaceId, 0);
	expect(await ledger.check(metered)).toBe("denied");
	limits.set("workspace-2", 9);
	expect(await ledger.check({ ...metered, workspaceId: "workspace-2" })).toBe("allowed");
	await ledger.record({ workspaceId: "workspace-2", ...known });
	expect(await ledger.check({ ...metered, workspaceId: "workspace-2" })).toBe("denied");
	limits.set(metered.workspaceId, 1);
	expect(await ledger.check(metered)).toBe("allowed");
});

it("resets exhausted tokens at local midnight while the UTC date stays unchanged", async () => {
	const { open, clock } = fixture(9);
	const ledger = open();
	await ledger.record({ workspaceId: metered.workspaceId, ...known });
	expect(await ledger.check(metered)).toBe("denied");
	const utcDay = clock.now.toISOString().slice(0, 10);
	clock.now = new Date("2026-11-19T00:00:00+08:00");
	expect(clock.now.toISOString().slice(0, 10)).toBe(utcDay);
	expect(await open().check(metered)).toBe("allowed");
	await ledger.record({ workspaceId: metered.workspaceId, ...known });
	expect(await open().check(metered)).toBe("denied");
});

it("retains every concurrent record across ledger instances sharing one path", async () => {
	const { open, limits } = fixture(180);
	const first = open();
	const second = open();
	await Promise.all(
		Array.from({ length: 20 }, (_, index) =>
			(index % 2 === 0 ? first : second).record({ workspaceId: metered.workspaceId, ...known }),
		),
	);
	expect(await open().check(metered)).toBe("denied");
	limits.set(metered.workspaceId, 181);
	expect(await open().check(metered)).toBe("allowed");
});

it("persists only workspace-day totals, item counts and the unknown flag", async () => {
	const { open, path } = fixture(10);
	await open().record({ workspaceId: metered.workspaceId, ...unknown });
	await open().record({ workspaceId: metered.workspaceId, ...known });
	const disk = new JsonStore<unknown>({ path, storageId: P5_SPEND_STORAGE.id, defaultValue: () => null });
	expect(await disk.read()).toEqual([
		{ workspaceId: "workspace-1", dayKey: "2026-11-18", tokens: 9, items: 2, unknownUsage: true },
	]);
});

it("counts non-negative integer totals without imposing an extra numeric cap", async () => {
	const { open } = fixture(2 ** 53 + 2);
	await open().record({ workspaceId: metered.workspaceId, ...known, inputTokens: 2 ** 53, outputTokens: 0 });
	expect(await open().check(metered)).toBe("allowed");
});

it.each([{ tokens: 10 }, { unknownUsage: true }])(
	"denies duplicate workspace-day rows that could hide exhaustion or unknown usage: %j",
	async (override) => {
		const { open, path } = fixture(10);
		const empty = {
			workspaceId: "workspace-1",
			dayKey: "2026-11-18",
			tokens: 0,
			items: 0,
			unknownUsage: false,
		};
		const disk = new JsonStore<unknown>({ path, storageId: P5_SPEND_STORAGE.id, defaultValue: () => null });
		await disk.write([empty, { ...empty, ...override }]);
		expect(await open().check(metered)).toBe("denied");
		expect(await disk.read()).toEqual([empty, { ...empty, ...override }]);
	},
);
