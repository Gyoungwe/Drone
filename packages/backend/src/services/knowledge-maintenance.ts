import type { KnowledgeMaintenanceRun, KnowledgeMaintenanceSettings } from "@drone/shared";
import { type MaintenanceItem, planMaintenance, runMaintenance } from "@gyoungwe/pi-knowledge/host";
import { JsonStore } from "../json-store";
import { createLogger } from "../log";

const log = createLogger("knowledge-maintenance");
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const CONTENT_DEBOUNCE_MS = 10 * 60 * 1000;

interface StoredState {
	version: 1;
	settings: KnowledgeMaintenanceSettings;
	runs: KnowledgeMaintenanceRun[];
}

const defaults = (): StoredState => ({
	version: 1,
	settings: { enabled: false, maxItems: 5, dailyLimit: 20 },
	runs: [],
});

export interface KnowledgeMaintenanceOptions {
	path: string;
	readOverview: (cwd: string) => Promise<any>;
	readNote: (cwd: string, path: string, revision: number) => Promise<any>;
	complete: (prompt: string) => Promise<string>;
	setTopic?: (cwd: string, path: string, topic: string, revision: number) => Promise<void>;
	proposeWiki?: (
		cwd: string,
		item: MaintenanceItem,
		proposal: Record<string, unknown>,
		revision: number,
	) => Promise<void>;
}

export class KnowledgeMaintenanceService {
	private readonly store: JsonStore<StoredState>;
	private timer: ReturnType<typeof setInterval> | null = null;
	private contentTimer: ReturnType<typeof setTimeout> | null = null;
	private running: Promise<KnowledgeMaintenanceRun> | null = null;

	constructor(private readonly options: KnowledgeMaintenanceOptions) {
		this.store = new JsonStore<StoredState>({
			path: options.path,
			storageId: "agent-knowledge-maintenance",
			defaultValue: defaults,
		});
	}

	async getSettings(): Promise<KnowledgeMaintenanceSettings> {
		return (await this.store.read()).settings;
	}
	async saveSettings(settings: KnowledgeMaintenanceSettings): Promise<KnowledgeMaintenanceSettings> {
		if (settings.maxItems < 1 || settings.dailyLimit < 1)
			throw new Error("maintenance limits must be positive");
		await this.store.update((state) => {
			state.settings = {
				enabled: settings.enabled === true,
				maxItems: Math.min(50, settings.maxItems),
				dailyLimit: Math.min(100, settings.dailyLimit),
			};
		});
		return this.getSettings();
	}
	async getRuns(): Promise<KnowledgeMaintenanceRun[]> {
		return (await this.store.read()).runs;
	}
	start(cwd: string): void {
		if (this.timer) return;
		const tick = () =>
			void this.runIfDue(cwd).catch((error) => log.warn("scheduled maintenance failed", error));
		this.timer = setInterval(tick, CHECK_INTERVAL_MS);
		this.timer.unref?.();
	}
	notifyContentChanged(cwd: string): void {
		if (this.contentTimer) clearTimeout(this.contentTimer);
		this.contentTimer = setTimeout(() => {
			this.contentTimer = null;
			void this.runIfEnabled(cwd).catch((error) => log.warn("content-triggered maintenance failed", error));
		}, CONTENT_DEBOUNCE_MS);
		this.contentTimer.unref?.();
	}
	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		if (this.contentTimer) clearTimeout(this.contentTimer);
		this.timer = null;
		this.contentTimer = null;
	}
	private async runIfDue(cwd: string): Promise<void> {
		const state = await this.store.read();
		if (!state.settings.enabled) return;
		const latest = state.runs[0]?.startedAt ? Date.parse(state.runs[0].startedAt) : 0;
		if (Date.now() - latest < DAY_MS) return;
		await this.runIfEnabled(cwd);
	}
	private async runIfEnabled(cwd: string): Promise<void> {
		if (!(await this.getSettings()).enabled) return;
		await this.runNow(cwd);
	}
	async runNow(cwd: string): Promise<KnowledgeMaintenanceRun> {
		this.running ??= this.runOnce(cwd).finally(() => {
			this.running = null;
		});
		return this.running;
	}
	private async runOnce(cwd: string): Promise<KnowledgeMaintenanceRun> {
		const state = await this.store.read();
		const settings = state.settings;
		const overview = await this.options.readOverview(cwd);
		const revision = Number(overview?.binding?.revision || overview?.index?.revision || 1);
		const items = planMaintenance(
			{
				items: (overview?.index?.problems || []).map((item: any) => ({
					id: item.path,
					kind: item.kind,
					path: item.path,
					title: item.title,
					detail: item.message,
				})),
			},
			overview?.graph,
			settings,
		);
		const today = new Date().toISOString().slice(0, 10);
		const usedToday = state.runs
			.filter((run) => run.startedAt.slice(0, 10) === today)
			.reduce((total, run) => total + run.modelCalls, 0);
		const remainingBudget = Math.max(0, settings.dailyLimit - usedToday);
		const result = await runMaintenance(items, {
			readNote: async (path) => {
				const note = await this.options.readNote(cwd, path, revision);
				return { title: note.title, markdown: note.text || note.excerpt || "", exists: !note.missing };
			},
			complete: this.options.complete,
			setTopic: async (path, topic) => {
				if (!this.options.setTopic) throw new Error("topic host port unavailable");
				await this.options.setTopic(cwd, path, topic, revision);
			},
			proposeWiki: async (item, proposal) => {
				if (!this.options.proposeWiki) throw new Error("Wiki review host port unavailable");
				await this.options.proposeWiki(cwd, item, proposal, revision);
			},
			validateWikiLinks: async (proposal) => {
				const links =
					typeof proposal.markdown === "string"
						? [...proposal.markdown.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
						: [];
				for (const link of links) {
					const target = String(link[1]).trim();
					if (!target) continue;
					const candidates = target.endsWith(".md") ? [target] : [`${target}.md`, `Wiki/${target}.md`];
					let found = false;
					for (const candidate of candidates) {
						const note = await this.options.readNote(cwd, candidate, revision);
						if (!note.missing) {
							found = true;
							break;
						}
					}
					if (!found) throw new Error("unknown-wiki-target");
				}
			},
			budget: { modelCalls: remainingBudget },
		});
		const run: KnowledgeMaintenanceRun = {
			startedAt: result.startedAt,
			processed: result.processed,
			modelCalls: result.modelCalls,
			items: [...result.items],
		};
		await this.store.update((state) => {
			state.runs.unshift(run);
			state.runs = state.runs.slice(0, 30);
		});
		return run;
	}
}
