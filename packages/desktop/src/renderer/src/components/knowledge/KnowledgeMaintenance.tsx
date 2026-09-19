import type { KnowledgeIndexStatus, KnowledgeJob, KnowledgePage } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";
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
		_nonce = useKnowledgeStore((s) => s.revision);
	const [offset, setOffset] = useState(0),
		[page, setPage] = useState<KnowledgePage<KnowledgeJob> | null>(null),
		[busy, setBusy] = useState(false),
		[loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null),
		[message, setMessage] = useState<string | null>(null),
		[confirm, setConfirm] = useState(false),
		[path, setPath] = useState<string | null>(null);
	useEffect(() => {
		setOffset(0);
		setPage(null);
		setMessage(null);
		setError(null);
		setConfirm(false);
		setPath(null);
	}, []);
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
	}, [cwd, revision, offset]);
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
	return (
		<div className="space-y-4" data-testid="knowledge-maintenance">
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
					<p className="mt-1 text-[11px] text-ink-dim">{t("problemHint")}</p>
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
							className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5"
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
							<Button size="sm" onClick={() => setPath(item.path)}>
								{t("openSource")}
							</Button>
						</div>
					))}
				</div>
				{page && !page.items.length && !loading && (
					<p className="py-4 text-center text-xs text-ink-faint">{t("empty")}</p>
				)}
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
			{path && (
				<KnowledgeNoteViewer cwd={cwd} revision={revision} path={path} onClose={() => setPath(null)} />
			)}
		</div>
	);
}
