import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { canonicalProjectId } from "../project-id";
import { createBackgroundJobsService, localDayKey } from "./p5-background-jobs-service";
import { createP5SpendLedger } from "./p5-spend-ledger";

function fixture() {
	const agentDir = mkdtempSync(join(tmpdir(), "drone-p5-background-jobs-"));
	onTestFinished(() => rmSync(agentDir, { recursive: true, force: true }));
	const clock = () => new Date("2026-11-20T12:00:00Z");
	return {
		agentDir,
		clock,
		cwd: join(agentDir, "workspace"),
		service: createBackgroundJobsService({ agentDir, clock }),
	};
}

it("reports default status for a new workspace", async () => {
	const { cwd, service } = fixture();
	expect(await service.getStatus(cwd)).toStrictEqual({
		enabled: false,
		dailyTokenLimit: 10_000_000,
		usedTokens: 0,
		exhausted: false,
		unknownUsage: false,
	});
});

it("returns the updated status after enabling and changing the daily limit", async () => {
	const { cwd, service } = fixture();
	expect(await service.setEnabled(cwd, true)).toMatchObject({ enabled: true, dailyTokenLimit: 10_000_000 });
	expect(await service.setDailyTokenLimit(cwd, 2_000_000)).toMatchObject({
		enabled: true,
		dailyTokenLimit: 2_000_000,
	});
});

it("shares settings across cwd spellings of the same workspace", async () => {
	const { agentDir, cwd, service } = fixture();
	const enabled = await service.setEnabled(`${cwd}/`, true);
	expect(await service.getStatus(cwd)).toStrictEqual(enabled);
	expect((await service.getStatus(join(agentDir, "other-workspace"))).enabled).toBe(false);
});

it("reports usage recorded by another ledger on the registered path", async () => {
	const { agentDir, clock, cwd, service } = fixture();
	const ledger = createP5SpendLedger({
		path: join(agentDir, "p5-spend-ledger.json"),
		clock,
		localDayKey,
		limitFor: () => "default",
	});
	await ledger.record({
		workspaceId: canonicalProjectId(cwd),
		metered: true,
		state: "known",
		inputTokens: 21,
		outputTokens: 9,
		cost: null,
	});
	expect((await service.getStatus(cwd)).usedTokens).toBe(30);
});

it("rejects an invalid limit without changing status", async () => {
	const { cwd, service } = fixture();
	const before = await service.setEnabled(cwd, true);
	await expect(service.setDailyTokenLimit(cwd, 0)).rejects.toThrow("Invalid P5 background daily token limit");
	expect(await service.getStatus(cwd)).toStrictEqual(before);
});

it("formats padded local calendar dates on both sides of midnight", () => {
	vi.stubEnv("TZ", "Asia/Shanghai");
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
	expect(localDayKey(new Date("2026-01-02T15:59:59Z"))).toBe("2026-01-02");
	expect(localDayKey(new Date("2026-01-02T16:00:00Z"))).toBe("2026-01-03");
});
