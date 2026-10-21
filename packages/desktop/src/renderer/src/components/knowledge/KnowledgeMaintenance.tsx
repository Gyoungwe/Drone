import type { KnowledgeIndexStatus, KnowledgeJob, KnowledgePage } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { COMPOSER_FOCUS_EVENT, useDraftStore } from "../../stores/drafts";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useUiStore } from "../../stores/ui";
import { Button } from "../ui/Button";
import { StatePanel } from "../ui/StatePanel";
import { useKnowledgeText } from "./copy";
export function KnowledgeMaintenance({
	cwd,
	revision,
	index,
}: {
	cwd: string | null;
	revision: number;
	index: KnowledgeIndexStatus | null | undefined;
}) {
	const t = useKnowledgeText(),
		nonce = useKnowledgeStore((s) => s.revision);
	const [offset, setOffset] = useState(0),
		[page, setPage] = useState<KnowledgePage<KnowledgeJob> | null>(null),
		[busy, setBusy] = useState(false),
		[loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null),
		[message, setMessage] = useState<string | null>(null),
		[confirm, setConfirm] = useState(false);
	const [automatic, setAutomatic] = useState({ enabled: false, maxItems: 5, dailyLimit: 20 });
	const [runs, setRuns] = useState<Array<{ startedAt: string; processed: number; modelCalls: number }>>([]);
	useEffect(() => {
		setOffset(0);
		setPage(null);
		setMessage(null);
		setError(null);
		setConfirm(false);
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce reloads the job list after a maintenance action
	useEffect(() => {
		let live = true;
		setLoading(true);
		void getPi()
			.getKnowledgeJobs({ cwd, revision, offset, limit: 20 })
			.then(
				(value) => {
					if (live) setPage(value);
				},
				(e) => {
					if (live) setError(String(e.message || e));
				},
			)
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
	}, [cwd, revision, offset, nonce]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce reloads persisted maintenance settings after an action
	useEffect(() => {
		let live = true;
		void Promise.all([getPi().getKnowledgeMaintenanceSettings(), getPi().getKnowledgeMaintenanceRuns()])
			.then(([settings, history]) => {
				if (!live) return;
				setAutomatic(settings);
				setRuns(history);
			})
			.catch((e) => live && setError(String(e?.message || e)));
		return () => {
			live = false;
		};
	}, [nonce]);
	/**
	 * A review task has no in-place fix: hand it to a new task with a prefilled request (not sent) so the
	 * agent re-reads the sources and proposes changes into the Wiki review queue.
	 */
	function handOff(notePath: string) {
		useSessionsStore.getState().createDraftSession(cwd ?? undefined);
		const id = useSessionsStore.getState().activeSessionId;
		if (!id) return;
		useDraftStore.getState().updateDraft(id, (entry) => ({
			...entry,
			text: t("handOffPrompt").replace("{path}", notePath),
		}));
		useKnowledgeStore.getState().close();
		useUiStore.getState().setView("chat");
		window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
	}

	async function run(action: "reconcile" | "refresh-navigation") {
		if (busy) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		setConfirm(false);
		try {
			const result = (await getPi().maintainKnowledge({ cwd, revision, action })) as {
				navigation?: { error?: string }[];
			};
			const failed = result.navigation
				?.filter((row) => row.error)
				.map((row) => row.error)
				.join("\n");
			if (failed) setError(failed);
			else setMessage(t("maintenanceDone"));
			useKnowledgeStore.getState().invalidate();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}
	async function saveAutomatic(next: typeof automatic) {
		setAutomatic(next);
		try {
			await getPi().saveKnowledgeMaintenanceSettings(next);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}
	async function runAutomatic() {
		setBusy(true);
		setError(null);
		try {
			const run = await getPi().runKnowledgeMaintenance({ cwd: cwd || "" });
			setRuns((current) => [run, ...current]);
			setMessage(t("automaticMaintenanceDone"));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="space-y-4" data-testid="knowledge-maintenance">
			<section className="rounded-xl border border-border p-3" data-testid="automatic-knowledge-maintenance">
				<div className="flex items-center justify-between gap-2">
					<div>
						<h4 className="text-xs font-semibold">{t("automaticMaintenance")}</h4>
						<p className="mt-1 text-[11px] text-ink-dim">{t("automaticMaintenanceHint")}</p>
					</div>
					<Button size="sm" onClick={() => void saveAutomatic({ ...automatic, enabled: !automatic.enabled })}>
						{automatic.enabled ? t("disable") : t("enable")}
					</Button>
				</div>
				<div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
					<label>
						{t("maintenanceItems")}{" "}
						<input
							className="ml-1 w-16 rounded border border-border bg-transparent px-1"
							type="number"
							min={1}
							max={50}
							value={automatic.maxItems}
							onChange={(e) => setAutomatic({ ...automatic, maxItems: Number(e.target.value) || 1 })}
							onBlur={() => void saveAutomatic(automatic)}
						/>
					</label>
					<label>
						{t("maintenanceDailyLimit")}{" "}
						<input
							className="ml-1 w-16 rounded border border-border bg-transparent px-1"
							type="number"
							min={1}
							max={100}
							value={automatic.dailyLimit}
							onChange={(e) => setAutomatic({ ...automatic, dailyLimit: Number(e.target.value) || 1 })}
							onBlur={() => void saveAutomatic(automatic)}
						/>
					</label>
					<Button
						size="sm"
						variant="primary"
						disabled={busy || !automatic.enabled}
						onClick={() => void runAutomatic()}
					>
						{t("runAutomaticMaintenance")}
					</Button>
				</div>
				{runs[0] && (
					<p className="mt-2 text-[11px] text-ink-faint">
						{t("lastAutomaticMaintenance")}: {runs[0].processed} · {runs[0].modelCalls}
					</p>
				)}
			</section>
			<p className="text-xs leading-relaxed text-ink-dim">{t("maintenanceHint")}</p>
			<div className="flex flex-wrap gap-2">
				<Button className="border border-border" disabled={busy} onClick={() => void run("reconcile")}>
					{t("buildIndex")}
				</Button>
				<Button className="border border-border" disabled={busy} onClick={() => setConfirm(true)}>
					{t("refreshNavigation")}
				</Button>
			</div>
			{confirm && (
				<div className="rounded-xl border border-border p-3">
					<p className="text-xs">{t("confirmNavigation")}</p>
					<div className="mt-2 flex justify-end gap-2">
						<Button onClick={() => setConfirm(false)}>{t("close")}</Button>
						<Button variant="primary" onClick={() => void run("refresh-navigation")}>
							{t("refreshNavigation")}
						</Button>
					</div>
				</div>
			)}
			{busy && (
				<p role="status" className="text-xs">
					{t("maintenanceBusy")}
				</p>
			)}
			{message && (
				<p role="status" className="rounded-lg bg-hover p-2 text-xs">
					{message}
				</p>
			)}
			{error && (
				<p role="alert" className="whitespace-pre-wrap break-words text-xs text-err">
					{error}
				</p>
			)}
			{!!index?.problems.length && (
				<section className="rounded-xl border border-border p-3">
					<h4 className="text-xs font-semibold">{t("problems")}</h4>
					<p className="mt-1 text-xs text-ink-dim">{t("problemHint")}</p>
					<ul className="mt-2 max-h-48 overflow-auto space-y-2">
						{index.problems.map((item) => (
							<li key={item.path} className="break-words text-xs">
								<span className="block font-mono text-[11px]">{item.path}</span>
								<span className="text-warn">{item.message}</span>
							</li>
						))}
					</ul>
				</section>
			)}
			<section>
				<div className="mb-2 flex items-center justify-between">
					<h4 className="text-xs font-semibold">
						{t("jobs")} · {page?.total ?? "—"}
					</h4>
					{loading && (
						<span role="status" className="text-[11px] text-ink-faint">
							{t("loading")}
						</span>
					)}
				</div>
				<div className="max-h-72 space-y-1 overflow-auto">
					{page?.items.map((item) => (
						<div
							key={item.key}
							className="flex items-start justify-between gap-2 rounded-lg border border-border p-3"
						>
							<div className="min-w-0">
								<p className="text-xs font-medium">
									{item.kind === "navigation"
										? t("navigationJob")
										: item.kind === "wiki-review"
											? t("wikiReview")
											: t("evidenceReview")}
								</p>
								<p className="mt-1 break-all font-mono text-[11px] text-ink-dim">{item.path}</p>
								{item.kind !== "navigation" && (
									<p className="mt-1 text-[11px] text-ink-faint">{t("manualReview")}</p>
								)}
							</div>
							<div className="flex shrink-0 gap-1">
								{item.kind !== "navigation" ? (
									<Button size="sm" variant="primary" onClick={() => handOff(item.path)}>
										{t("handOff")}
									</Button>
								) : null}
								{/* Open the note in the full note view; an inline viewer under a 48-row list was off screen. */}
								<Button
									size="sm"
									onClick={() =>
										useKnowledgeStore
											.getState()
											.open({ cwd, sessionId: null, tab: "reviews", note: item.path, noteRevision: revision })
									}
								>
									{t("openSource")}
								</Button>
							</div>
						</div>
					))}
				</div>
				{page && !page.items.length && !loading && <StatePanel compact title={t("empty")} />}
				<div className="mt-2 flex justify-between">
					<Button size="sm" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - 20))}>
						{t("previous")}
					</Button>
					<Button
						size="sm"
						disabled={page?.nextOffset == null || loading}
						onClick={() => setOffset(page?.nextOffset ?? 0)}
					>
						{t("next")}
					</Button>
				</div>
			</section>
		</div>
	);
}
