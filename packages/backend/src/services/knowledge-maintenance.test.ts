import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setImmediate as waitImmediate } from "node:timers/promises";
import { knowledgeHostLoader } from "@gyoungwe/pi-knowledge/host";
import { describe, expect, it, vi } from "vitest";
import { createKnowledgeMaintenanceOperations } from "../knowledge/ui";
import { KnowledgeMaintenanceService } from "./knowledge-maintenance";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

async function waitForRuns(service: KnowledgeMaintenanceService, count: number): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if ((await service.getRuns()).length === count) return;
		await waitImmediate();
	}
	expect(await service.getRuns()).toHaveLength(count);
}

async function fixture(problems: Array<{ path: string; kind?: string; message?: string }>) {
	const root = await mkdtemp(join(tmpdir(), "knowledge-maintenance-service-"));
	const cwd = join(root, "workspace");
	await mkdir(cwd);
	const calls: string[] = [];
	const maintenance = createKnowledgeMaintenanceOperations(knowledgeHostLoader.load());
	const service = new KnowledgeMaintenanceService({
		path: join(root, "state.json"),
		maintenance,
		readOverview: async () => ({ binding: { revision: 1 }, index: { revision: 1, problems: [] } }),
		readGraph: async () => ({
			nodes: problems.map((problem, index) => ({
				path: problem.path,
				title: problem.kind === "missing-topic" ? `PMC${index + 1}.pdf` : basename(problem.path, ".md"),
				kind: "note",
				degree: 0,
			})),
			edges: [],
		}),
		readNote: async (_cwd, path) => ({ title: basename(path, ".md"), text: "# Note", missing: false }),
		complete: async () => JSON.stringify({ topic: "Stable topic" }),
		setTopic: async (_cwd, path, topic) => {
			calls.push(`${path}:${topic}`);
		},
		proposeWiki: async () => undefined,
	});
	return { root, cwd, service, calls };
}

describe("KnowledgeMaintenanceService scheduling", () => {
	it("defaults off and runs at most once per day on the hourly schedule", async () => {
		vi.useFakeTimers({ now: new Date("2026-10-21T00:00:00.000Z") });
		const { root, cwd, service } = await fixture([{ path: "Library/Papers/a.md", kind: "missing-topic" }]);
		try {
			service.start(cwd);
			await vi.advanceTimersByTimeAsync(HOUR);
			await waitImmediate();
			expect(await service.getRuns()).toHaveLength(0);
			await service.saveSettings({ enabled: true, maxItems: 5, dailyLimit: 20 });
			await vi.advanceTimersByTimeAsync(HOUR);
			await waitForRuns(service, 1);
			await vi.advanceTimersByTimeAsync(21 * HOUR);
			await waitImmediate();
			expect(await service.getRuns()).toHaveLength(1);
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
			vi.useRealTimers();
		}
	});

	it("debounces content-triggered runs for ten minutes", async () => {
		vi.useFakeTimers({ now: new Date("2026-10-21T00:00:00.000Z") });
		const { root, cwd, service } = await fixture([{ path: "Library/Papers/a.md", kind: "missing-topic" }]);
		try {
			await service.saveSettings({ enabled: true, maxItems: 5, dailyLimit: 20 });
			service.notifyContentChanged(cwd);
			await vi.advanceTimersByTimeAsync(9 * MINUTE);
			await waitImmediate();
			expect(await service.getRuns()).toHaveLength(0);
			await vi.advanceTimersByTimeAsync(MINUTE);
			await waitForRuns(service, 1);
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
			vi.useRealTimers();
		}
	});

	it("runs a twenty-note temporary Vault fixture with a fake model", async () => {
		const root = await mkdtemp(join(tmpdir(), "knowledge-maintenance-vault-"));
		const vault = join(root, "Vault");
		const problems = Array.from({ length: 20 }, (_, index) => ({
			path: `Library/Papers/note-${index}.md`,
			kind: "missing-topic",
		}));
		const changed: string[] = [];
		try {
			for (const problem of problems) {
				const path = join(vault, problem.path);
				await mkdir(join(path, ".."), { recursive: true });
				await writeFile(path, `# Human title ${problem.path}\n`);
			}
			const service = new KnowledgeMaintenanceService({
				path: join(root, "state.json"),
				maintenance: createKnowledgeMaintenanceOperations(knowledgeHostLoader.load()),
				readOverview: async () => ({ binding: { revision: 1 }, index: { revision: 1, problems: [] } }),
				readGraph: async () => ({
					nodes: problems.map((problem, index) => ({
						path: problem.path,
						title: `PMC${index + 1}.pdf`,
						kind: "note",
						degree: 0,
					})),
					edges: [],
				}),
				readNote: async (_cwd, path) => ({
					title: basename(path, ".md"),
					text: await readFile(join(vault, path), "utf8"),
					missing: false,
				}),
				complete: async () => JSON.stringify({ topic: "Fixture topic" }),
				setTopic: async (_cwd, path, topic) => {
					const absolute = join(vault, path);
					await writeFile(absolute, `topic: ${topic}\n${await readFile(absolute, "utf8")}`);
					changed.push(path);
				},
				proposeWiki: async () => undefined,
			});
			await service.saveSettings({ enabled: true, maxItems: 20, dailyLimit: 20 });
			const result = await service.runNow(root);
			expect(result.processed).toBe(20);
			expect(result.modelCalls).toBe(20);
			expect(changed).toHaveLength(20);
			for (const problem of problems)
				expect(await readFile(join(vault, problem.path), "utf8")).toContain("topic: Fixture topic");
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("caps model calls across runs at the daily limit", async () => {
		const { root, cwd, service } = await fixture([
			{ path: "Library/Papers/a.md", kind: "missing-topic" },
			{ path: "Library/Papers/b.md", kind: "missing-topic" },
		]);
		try {
			await service.saveSettings({ enabled: true, maxItems: 5, dailyLimit: 1 });
			const first = await service.runNow(cwd);
			const second = await service.runNow(cwd);
			expect(first.modelCalls).toBe(1);
			expect(second.modelCalls).toBe(0);
			expect(second.items.every((item) => item.reason === "daily-budget-exhausted")).toBe(true);
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
});
