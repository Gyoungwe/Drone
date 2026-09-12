import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { KnowledgeApi, KnowledgeUiEvent } from "@percho/shared";

type Handler = (event: KnowledgeUiEvent) => void;
/** Dynamic resource boundary works in source and electron-builder layouts. */
export class KnowledgeUiService {
	private listeners = new Set<Handler>();
	private unsubscribe: (() => void) | null = null;
	private disposed = false;
	private loading: Promise<void> | null = null;
	private root() {
		return (
			process.env.PERCHO_RESEARCH_WORKBENCH_ROOT ?? fileURLToPath(new URL("../../../../.pi", import.meta.url))
		);
	}
	private async module(name: string) {
		return import(
			/* @vite-ignore */ pathToFileURL(join(this.root(), "lib", "knowledge", `${name}.mjs`)).href
		);
	}
	async connect(): Promise<void> {
		if (!process.env.PERCHO_KNOWLEDGE_DIR || this.unsubscribe || this.disposed) return;
		if (!this.loading)
			this.loading = this.module("ui-state")
				.then((mod) => {
					if (!this.disposed)
						this.unsubscribe = mod.subscribeKnowledgeUi((event: KnowledgeUiEvent) => {
							for (const listener of this.listeners) {
								try {
									listener(event);
								} catch {
									/* closed renderer */
								}
							}
						});
				})
				.finally(() => {
					this.loading = null;
				});
		return this.loading;
	}
	subscribe(listener: Handler): () => void {
		this.listeners.add(listener);
		void this.connect().catch(() => {});
		return () => this.listeners.delete(listener);
	}
	async notify(text: string, severity = "info", sessionId: string | null = null): Promise<void> {
		await this.connect();
		const mod = await this.module("ui-state");
		mod.notifyKnowledgeUi(text, severity, sessionId);
	}
	private async call(name: string, input: unknown) {
		await this.connect();
		const mod = await this.module("ui-service");
		return mod[name](input);
	}
	specialistSettings(
		input: Parameters<KnowledgeApi["setKnowledgeSpecialistSettings"]>[0],
	): ReturnType<KnowledgeApi["setKnowledgeSpecialistSettings"]> {
		return this.call("knowledgeSpecialistSettings", input);
	}
	async reviewWithModel(
		input: Parameters<KnowledgeApi["reviewKnowledgeWithModel"]>[0],
		options: unknown,
	): ReturnType<KnowledgeApi["reviewKnowledgeWithModel"]> {
		const mod = await this.module("wiki-model-review");
		return mod.reviewWikiWithModel(input, options);
	}
	overview(
		input: Parameters<KnowledgeApi["getKnowledgeOverview"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeOverview"]> {
		return this.call("knowledgeOverview", input);
	}
	setupPreview(
		input: Parameters<KnowledgeApi["previewKnowledgeSetup"]>[0],
	): ReturnType<KnowledgeApi["previewKnowledgeSetup"]> {
		return this.call("knowledgeSetupPreview", input);
	}
	jobs(input: Parameters<KnowledgeApi["getKnowledgeJobs"]>[0]): ReturnType<KnowledgeApi["getKnowledgeJobs"]> {
		return this.call("knowledgeJobs", input);
	}
	reviews(
		input: Parameters<KnowledgeApi["getKnowledgeReviews"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeReviews"]> {
		return this.call("knowledgeReviews", input);
	}
	preview(
		input: Parameters<KnowledgeApi["previewKnowledgeReview"]>[0],
	): ReturnType<KnowledgeApi["previewKnowledgeReview"]> {
		return this.call("knowledgePreviewReview", input);
	}
	decide(
		input: Parameters<KnowledgeApi["decideKnowledgeReview"]>[0],
	): ReturnType<KnowledgeApi["decideKnowledgeReview"]> {
		return this.call("knowledgeDecideReview", input);
	}
	read(
		input: Parameters<KnowledgeApi["readKnowledgeNote"]>[0],
	): ReturnType<KnowledgeApi["readKnowledgeNote"]> {
		return this.call("knowledgeReadNote", input);
	}
	maintain(
		input: Parameters<KnowledgeApi["maintainKnowledge"]>[0],
	): ReturnType<KnowledgeApi["maintainKnowledge"]> {
		return this.call("knowledgeMaintenance", input);
	}
	openTarget(
		input: Parameters<KnowledgeApi["openKnowledgeTarget"]>[0],
	): Promise<{ path: string; kind: "note" | "vault" }> {
		return this.call("knowledgeOpenTarget", input);
	}
	dispose(): void {
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.listeners.clear();
	}
}
