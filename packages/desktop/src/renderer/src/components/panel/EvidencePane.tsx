import type { EvidenceOverview } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";

export function EvidencePane({ defaultRoot }: { defaultRoot: string | null }) {
	const t = useT();
	const [overview, setOverview] = useState<EvidenceOverview | null>(null);
	const [analysisId, setAnalysisId] = useState("");
	const [sourceRoot, setSourceRoot] = useState(defaultRoot ?? "");
	const [branchId, setBranchId] = useState("");
	const [importPath, setImportPath] = useState("");
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const refresh = useCallback(() => {
		void getPi()
			.getEvidenceOverview()
			.then(setOverview)
			.catch((e) => setNotice(String(e)));
	}, []);
	useEffect(() => {
		setSourceRoot(defaultRoot ?? "");
		refresh();
	}, [defaultRoot, refresh]);
	async function freeze() {
		setBusy(true);
		setNotice(null);
		try {
			await getPi().freezeAnalysisEvidence(analysisId.trim(), sourceRoot.trim());
			setNotice(t("panel.evidence.frozen"));
			refresh();
		} catch (e) {
			setNotice(String(e));
		} finally {
			setBusy(false);
		}
	}
	async function fork(checkpointId: string) {
		setBusy(true);
		setNotice(null);
		try {
			await getPi().forkEvidenceCheckpoint(checkpointId, branchId.trim());
			setNotice(t("panel.evidence.forked"));
			setBranchId("");
			refresh();
		} catch (e) {
			setNotice(String(e));
		} finally {
			setBusy(false);
		}
	}
	async function exportCapsule(id: string, audience: "public" | "restricted" | "private") {
		setBusy(true);
		try {
			const result = await getPi().exportEvidenceCapsule(id, audience);
			setNotice(`${t("panel.evidence.exported")}: ${result.path}`);
		} catch (e) {
			setNotice(String(e));
		} finally {
			setBusy(false);
		}
	}
	async function importCapsule() {
		setBusy(true);
		setNotice(null);
		try {
			await getPi().importEvidenceCapsule(importPath.trim());
			setNotice(t("panel.evidence.imported"));
			setImportPath("");
			refresh();
		} catch (e) {
			setNotice(String(e));
		} finally {
			setBusy(false);
		}
	}
	async function replay(id: string) {
		setBusy(true);
		setNotice(null);
		try {
			await getPi().replayEvidenceCheckpoint(id);
			setNotice(t("panel.evidence.replayed"));
			refresh();
		} catch (e) {
			setNotice(String(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="panel-card" data-testid="evidence-panel">
			<header className="flex items-center justify-between gap-2">
				<span className="text-[12px] font-medium text-ink">{t("panel.evidence.title")}</span>
				<button type="button" className="panel-action" onClick={refresh}>
					{t("panel.evidence.refresh")}
				</button>
			</header>
			<div className="mt-2 space-y-2">
				<div className="grid grid-cols-1 gap-1">
					<input
						className="panel-input"
						value={analysisId}
						onChange={(e) => setAnalysisId(e.target.value)}
						placeholder={t("panel.evidence.analysisId")}
					/>
					<input
						className="panel-input"
						value={sourceRoot}
						onChange={(e) => setSourceRoot(e.target.value)}
						placeholder={t("panel.evidence.sourceRoot")}
					/>
					<button
						type="button"
						className="panel-action"
						disabled={busy || !analysisId.trim() || !sourceRoot.trim()}
						onClick={() => void freeze()}
					>
						{t("panel.evidence.freeze")}
					</button>
					<div className="flex gap-1">
						<input
							className="panel-input min-w-0 flex-1"
							value={importPath}
							onChange={(e) => setImportPath(e.target.value)}
							placeholder={t("panel.evidence.importPath")}
						/>
						<button
							type="button"
							className="panel-action"
							disabled={busy || !importPath.trim()}
							onClick={() => void importCapsule()}
						>
							{t("panel.evidence.import")}
						</button>
					</div>
				</div>
				{notice && (
					<p className="break-words text-xs text-ink-dim" role="status">
						{notice}
					</p>
				)}
				{overview?.checkpoints.map((c) => (
					<article key={c.id} className="rounded-lg bg-hover p-2 text-xs">
						<p className="font-medium text-ink">
							{c.assay} · {c.analysisId}
						</p>
						<p className="font-mono text-ink-faint">
							{c.id.slice(0, 16)}… · {c.files.length} {t("panel.evidence.files")}
						</p>
						<p className="text-ink-dim">
							{c.replayReady ? t("panel.evidence.replayReady") : t("panel.evidence.replayNotReady")}
						</p>
						<div className="mt-1 flex flex-wrap gap-1">
							{(["private", "restricted", "public"] as const).map((audience) => (
								<button
									key={audience}
									type="button"
									className="panel-action"
									disabled={busy}
									onClick={() => void exportCapsule(c.id, audience)}
								>
									{t(`panel.evidence.exportAudience.${audience}`)}
								</button>
							))}
							{c.replayReady && (
								<button
									type="button"
									className="panel-action"
									disabled={busy}
									onClick={() => void replay(c.id)}
								>
									{t("panel.evidence.replayNow")}
								</button>
							)}
							<input
								className="panel-input min-w-0 flex-1"
								value={branchId}
								onChange={(e) => setBranchId(e.target.value)}
								placeholder={t("panel.evidence.branchId")}
							/>
							<button
								type="button"
								className="panel-action"
								disabled={busy || !branchId.trim()}
								onClick={() => void fork(c.id)}
							>
								{t("panel.evidence.fork")}
							</button>
						</div>
					</article>
				))}
				{overview?.branches.map((b) => (
					<p key={b.id} className="text-xs text-ink-dim">
						{t("panel.evidence.branch")}: <span className="font-mono">{b.id}</span> · {b.status}
					</p>
				))}
				{overview?.replays.map((r) => (
					<article
						key={r.id}
						className="rounded-lg border border-border p-2 text-xs"
						data-replay-status={r.status}
					>
						<p className="font-medium text-ink">
							{t("panel.evidence.replay")}: {r.status}
						</p>
						<p className="break-words text-ink-dim">{r.detail}</p>
						<p className="text-ink-faint">
							{r.environmentMatched
								? t("panel.evidence.environmentMatched")
								: t("panel.evidence.environmentMismatch")}{" "}
							· {r.outputChecks.filter((x) => x.matched).length}/{r.outputChecks.length}{" "}
							{t("panel.evidence.outputs")}
						</p>
					</article>
				))}
				{overview && overview.checkpoints.length === 0 && (
					<p className="panel-empty">{t("panel.evidence.empty")}</p>
				)}
			</div>
		</section>
	);
}
