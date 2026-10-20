import { useState } from "react";
import { getPi } from "../../api";
import { useI18nStore } from "../../i18n";
import { relativeTime } from "../../lib/relative-time";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { launchKnowledgeSetup, reportKnowledgeError, useKnowledgeOverview } from "./hooks";
import { KnowledgeGraph } from "./KnowledgeGraph";

/** Full-screen knowledge network tab, including an actionable unbound state. */
export function KnowledgeNetwork({ cwd, sessionId }: { cwd: string | null; sessionId: string | null }) {
	const t = useKnowledgeText();
	const language = useI18nStore((state) => state.language);
	const { data, error, loading } = useKnowledgeOverview(cwd, sessionId);
	const [busy, setBusy] = useState(false);
	const binding = data?.binding;
	const revision = binding?.revision ?? 0;
	const indexKey = `${data?.index?.noteCount ?? 0}:${data?.index?.lastReconciledAt ?? ""}`;
	const isDevelopment = import.meta.env.DEV;

	async function startSetup(path?: string) {
		if (!cwd) return;
		setBusy(true);
		try {
			await launchKnowledgeSetup(cwd, sessionId, path);
		} catch (cause) {
			reportKnowledgeError(cause);
		} finally {
			setBusy(false);
		}
	}

	async function connectExisting() {
		if (!cwd) return;
		setBusy(true);
		try {
			const path = await getPi().pickDirectory();
			if (path) await launchKnowledgeSetup(cwd, sessionId, path);
		} catch (cause) {
			reportKnowledgeError(cause);
		} finally {
			setBusy(false);
		}
	}

	if (loading && !data) {
		return (
			<section className="space-y-3" data-testid="knowledge-network" aria-label={t("network")}>
				<p role="status" className="text-xs text-ink-dim">
					{t("loading")}
				</p>
			</section>
		);
	}

	if (error) {
		return (
			<section className="space-y-3" data-testid="knowledge-network" aria-label={t("network")}>
				<p role="alert" className="rounded-lg border border-border p-3 text-xs text-err">
					{error}
				</p>
			</section>
		);
	}

	if (!binding) {
		return (
			<section className="space-y-4" data-testid="knowledge-network" aria-label={t("network")}>
				<div className="rounded-2xl border border-dashed border-border bg-surface p-6">
					<p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">{t("network")}</p>
					<h2 className="mt-2 text-base font-semibold">{t("networkUnboundTitle")}</h2>
					<p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-dim">
						{data?.enabled ? t("networkUnboundHint") : t("disabled")}
					</p>
					{isDevelopment && (
						<p className="mt-3 rounded-lg bg-hover p-3 text-xs leading-relaxed text-ink-dim">
							{t("networkDevHint")}
						</p>
					)}
					{!cwd && <p className="mt-3 text-xs text-warn">{t("selectProject")}</p>}
					<div className="mt-4 flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="primary"
							disabled={!cwd || !data?.enabled || busy}
							onClick={() => void connectExisting()}
						>
							{t("networkConnectExisting")}
						</Button>
						<Button size="sm" disabled={!cwd || !data?.enabled || busy} onClick={() => void startSetup()}>
							{t("networkCreate")}
						</Button>
						{isDevelopment && (
							<Button
								size="sm"
								variant="secondary"
								disabled={!cwd || !data?.enabled || busy}
								onClick={() => void connectExisting()}
							>
								{t("networkUseFormal")}
							</Button>
						)}
					</div>
				</div>
			</section>
		);
	}

	return (
		<section data-testid="knowledge-network" aria-label={t("network")}>
			<div className="knowledge-network-layout">
				<KnowledgeGraph cwd={cwd} revision={revision} indexKey={indexKey} />
				<aside className="knowledge-network-changes" aria-label={t("networkChanges")}>
					<div className="knowledge-network-changes-head">
						<h2>{t("networkChanges")}</h2>
						<span className="knowledge-live-indicator">
							<i aria-hidden="true" />
							{t("networkLive")}
						</span>
					</div>
					{data?.recentNotes?.length ? (
						<ul className="knowledge-network-changes-list">
							{data.recentNotes.slice(0, 8).map((note) => (
								<li key={note.path} className="knowledge-network-change">
									<span className="knowledge-network-change-title" title={note.title}>
										{note.title}
									</span>
									<span className="knowledge-network-change-source" title={note.path}>
										{t("networkChangeSource")
											.replace("{time}", relativeTime(note.updatedAt, language))
											.replace("{source}", note.path)}
									</span>
								</li>
							))}
						</ul>
					) : (
						<p className="knowledge-network-changes-empty">{t("networkChangesEmpty")}</p>
					)}
				</aside>
			</div>
		</section>
	);
}
