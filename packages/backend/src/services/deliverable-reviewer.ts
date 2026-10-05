import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import {
	BackgroundReviewer,
	type BackgroundReviewerOptions,
	type BackgroundReviewRequest,
	type DeliverableReviewSnapshot,
	type ReviewerModelProvider,
	type ReviewerProviderSelection,
	type ReviewReadReceipt,
} from "@drone/knowledge";
import type { SessionEvent } from "@drone/shared";
import { globalToolManifest } from "../tools/manifest";
import type { InquiryReadOnlySnapshot } from "./inquiry";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const TEXT_FILE = /\.(?:md|txt|csv|json|html?|tex|ya?ml)$/i;

interface ReviewerHostOptions {
	getCwd(sessionId: string): string | undefined;
	getLedger?(): Promise<InquiryReadOnlySnapshot | undefined>;
	getProviders?: () => readonly ReviewerModelProvider[] | Promise<readonly ReviewerModelProvider[]>;
	getMainProvider?: (sessionId: string) => string | undefined;
	useModel?: () => boolean | Promise<boolean>;
	modelReview?: (
		snapshot: DeliverableReviewSnapshot,
		selection: ReviewerProviderSelection,
	) => ReturnType<NonNullable<BackgroundReviewerOptions["modelReview"]>>;
	onSchedule?: (request: {
		sessionId: string;
		snapshot: unknown;
		trigger: BackgroundReviewRequest["trigger"];
	}) => void;
	onResult: NonNullable<BackgroundReviewerOptions["onResult"]>;
}

const DELIVERABLE_WRITERS = new Set(["write", "edit"]);

/** Only core file mutation tools are implicit deliverable writers. Extensions must add a future
 * explicit manifest declaration before they can trigger review; domain/tool name substrings are
 * deliberately ignored so archive/download tools cannot start a review. */
export function isDeliverableWriter(toolName: string): boolean {
	if (DELIVERABLE_WRITERS.has(toolName)) return true;
	return globalToolManifest.meta(toolName)?.deliverable === true;
}

/** Read-only host adapter. Observed reads never grant evidence-gate authority. */
export class DeliverableReviewerService {
	private readonly reviewer: BackgroundReviewer;
	private readonly calls = new Map<string, Map<string, Record<string, unknown>>>();
	private readonly receipts = new Map<string, Map<string, ReviewReadReceipt>>();
	private disposed = false;

	constructor(private readonly options: ReviewerHostOptions) {
		this.reviewer = new BackgroundReviewer({
			onResult: options.onResult,
			getProviders: options.getProviders,
			useModel: options.useModel,
			modelReview: options.modelReview,
		});
	}

	observe(sessionId: string, event: unknown): void {
		const input = event as SessionEvent;
		if (input.type === "tool_execution_start") {
			const calls = this.calls.get(sessionId) ?? new Map<string, Record<string, unknown>>();
			calls.set(input.toolCallId, this.record(input.args));
			while (calls.size > 128) calls.delete(calls.keys().next().value ?? "");
			this.calls.set(sessionId, calls);
			return;
		}
		if (input.type !== "tool_execution_end") return;
		const args = this.calls.get(sessionId)?.get(input.toolCallId) ?? {};
		this.calls.get(sessionId)?.delete(input.toolCallId);
		if (input.isError) return;
		const result = this.record(input.result);
		const details = this.record(result.details);
		const path = [details.path, details.note, details.obsidian_note, result.path, args.path].find(
			(value): value is string => typeof value === "string" && value.trim().length > 0,
		);
		if (!path) return;
		if (/^(?:read|research_read_knowledge)$/.test(input.toolName)) {
			const receipts = this.receipts.get(sessionId) ?? new Map<string, ReviewReadReceipt>();
			const text = Array.isArray(result.content)
				? result.content
						.map((item) => this.record(item).text)
						.filter((item): item is string => typeof item === "string")
						.join("\n")
						.slice(0, MAX_TEXT_BYTES)
				: undefined;
			receipts.set(path, { path, receiptRef: input.toolCallId, text });
			while (receipts.size > 128) receipts.delete(receipts.keys().next().value ?? "");
			this.receipts.set(sessionId, receipts);
		} else if (isDeliverableWriter(input.toolName)) {
			this.schedule({
				sessionId,
				snapshot: { deliverables: [{ id: path, path }] },
				trigger: "deliverable-write",
			});
		}
	}

	schedule(request: {
		sessionId: string;
		snapshot: unknown;
		trigger: BackgroundReviewRequest["trigger"];
	}): void {
		this.options.onSchedule?.(request);
		// File I/O and ledger projection are deferred along with the review.
		setTimeout(() => {
			if (this.disposed) return;
			const snapshot = this.record(request.snapshot) as DeliverableReviewSnapshot;
			void this.snapshot(request.sessionId, snapshot)
				.then((prepared) => {
					if (!this.disposed)
						this.reviewer.schedule({
							...request,
							mainProvider: this.options.getMainProvider?.(request.sessionId),
							snapshot: prepared,
						});
				})
				.catch(() => {});
		}, 0);
	}

	getFindings(sessionId: string) {
		return this.reviewer.getFindings(sessionId);
	}
	getCached(sessionId: string, snapshot: unknown) {
		return this.reviewer.getCached(sessionId, this.record(snapshot) as DeliverableReviewSnapshot);
	}
	clearSession(sessionId: string): void {
		this.calls.delete(sessionId);
		this.receipts.delete(sessionId);
		this.reviewer.clearSession(sessionId);
	}
	dispose(): void {
		this.disposed = true;
		this.calls.clear();
		this.receipts.clear();
		this.reviewer.dispose();
	}

	private record(value: unknown): Record<string, unknown> {
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	}

	private async snapshot(
		sessionId: string,
		input: DeliverableReviewSnapshot,
	): Promise<DeliverableReviewSnapshot> {
		const cwd = this.options.getCwd(sessionId);
		const ledger = await this.options.getLedger?.();
		const deliverables: Array<NonNullable<DeliverableReviewSnapshot["deliverables"]>[number]> = [];
		const bodies: string[] = [];
		for (const item of input.deliverables ?? []) {
			const artifact = ledger?.artifacts.find(
				(artifact) => artifact.path === item.path || artifact.id === item.id,
			);
			let sha256 = item.sha256;
			if (cwd && item.path) {
				let file: Awaited<ReturnType<typeof open>> | undefined;
				try {
					file = await open(resolve(cwd, item.path), "r");
					const stat = await file.stat();
					if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
						const bytes = await file.readFile();
						sha256 = createHash("sha256").update(bytes).digest("hex");
						if (TEXT_FILE.test(item.path)) bodies.push(bytes.subarray(0, MAX_TEXT_BYTES).toString("utf8"));
					}
				} catch {
					/* Missing/remote outputs retain their host-observed metadata. */
				} finally {
					await file?.close();
				}
			}
			deliverables.push({ ...item, id: artifact?.id ?? item.id, sha256 });
		}
		return {
			...input,
			body: input.body ?? (bodies.length ? bodies.join("\n\n") : undefined),
			deliverables,
			readReceipts: [...(input.readReceipts ?? []), ...(this.receipts.get(sessionId)?.values() ?? [])],
			artifacts: [
				...(input.artifacts ?? []),
				...(ledger?.artifacts
					.filter((artifact) => !deliverables.some((item) => item.id === artifact.id))
					.map((artifact) => ({
						path: artifact.path,
						sha256: artifact.sha256,
						numbers: ledger.findings
							.filter((finding) => finding.artifactIds.includes(artifact.id))
							.flatMap((finding) =>
								finding.values
									.filter((value) => typeof value.value !== "boolean")
									.map((value) => ({ value: value.value as number | string })),
							),
					})) ?? []),
			],
			attempts: [
				...(input.attempts ?? []),
				...(ledger?.attempts.map((attempt) => ({
					...attempt,
					outputs: attempt.artifactIds.flatMap((id) => {
						const artifact = ledger.artifacts.find((item) => item.id === id);
						return artifact ? [{ artifactId: id, sha256: artifact.sha256 }] : [];
					}),
				})) ?? []),
			],
		};
	}
}
