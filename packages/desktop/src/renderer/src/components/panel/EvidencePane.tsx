import type { CapabilityEvidenceCard, EvidenceOverview } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";

export function EvidencePane({
	defaultRoot,
	hideWhenEmpty = false,
}: {
	defaultRoot: string | null;
	/** Overview only shows evidence once the host has returned a real record. */
	hideWhenEmpty?: boolean;
}) {
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
	const hasEvidence =
		overview !== null &&
		(overview.analyses.length > 0 ||
			overview.checkpoints.length > 0 ||
			overview.branches.length > 0 ||
			overview.replays.length > 0);
	if (hideWhenEmpty && !hasEvidence) return null;
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
				{overview && overview.capabilities.length > 0 && (
					<section className="space-y-2" data-testid="capability-evidence-panel">
						<h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
							{t("panel.evidence.capabilitiesTitle")}
						</h3>
						{overview.capabilities.map((capability) => (
							<CapabilityEvidenceCardView key={capability.id} card={capability} />
						))}
					</section>
				)}
				{overview?.checkpoints.map((c) => (
					<article key={c.id} id={`evidence-checkpoint-${c.id}`} className="rounded-lg bg-hover p-2 text-xs">
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

export function CapabilityEvidenceCardView({ card }: { card: CapabilityEvidenceCard }) {
	const t = useT();
	return (
		<article
			className="rounded-lg border border-border bg-hover p-2 text-xs"
			data-testid="capability-evidence-card"
			data-capability-id={card.capabilityId}
			data-evidence-state={card.evidenceState}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="break-words font-medium text-ink">{card.capabilityId}</p>
					<p className="break-words font-mono text-[11px] text-ink-faint">
						{card.analysisId}
						{card.versionRef ? ` · ${t("panel.evidence.capabilityVersion")}: ${card.versionRef}` : ""}
						{card.requestRef
							? ` · ${t("panel.evidence.capabilityRequest")}: ${card.requestRef}`
							: ` · ${t("panel.evidence.capabilityNoRequest")}`}
					</p>
				</div>
				<span className="rounded bg-surface px-2 py-1 font-mono text-[11px] text-ink-2">
					{card.evidenceState}
				</span>
			</div>
			<div className="mt-2 flex flex-wrap gap-1 text-[11px] text-ink-dim">
				<span className="rounded bg-surface px-2 py-0.5">
					{t("panel.evidence.capabilityStatus")}: {card.capabilityState}
				</span>
				<span className="rounded bg-surface px-2 py-0.5">claim: {card.claimState}</span>
				<span className="rounded bg-surface px-2 py-0.5">reuse: {card.reuseLevel}</span>
				<span className="rounded bg-surface px-2 py-0.5">freshness: {card.freshness}</span>
				{card.validationScope ? (
					<span className="rounded bg-surface px-2 py-0.5">scope: {card.validationScope}</span>
				) : (
					<span className="rounded bg-surface px-2 py-0.5">{t("panel.evidence.capabilityScope")}</span>
				)}
			</div>
			<div className="mt-2 space-y-1 text-ink-dim">
				<p>
					{t("panel.evidence.capabilityEvidence")}:{" "}
					{card.evidenceCapsuleRef ? (
						<a
							href={`#evidence-checkpoint-${card.evidenceCapsuleRef}`}
							className="font-mono text-accent underline underline-offset-2"
						>
							{card.evidenceCapsuleRef.slice(0, 16)}… · {t("panel.evidence.capabilityOpenEvidence")}
						</a>
					) : (
						t("panel.evidence.capabilityNoEvidence")
					)}
					{card.checkpointRef && (
						<span className="ml-2 text-ink-faint">
							{t("panel.evidence.capabilityCheckpoint")}: {card.checkpointRef.slice(0, 16)}…
						</span>
					)}
				</p>
				<p className="font-medium text-ink-2">{t("panel.evidence.capabilityGates")}</p>
				{card.gates.length > 0 ? (
					<ul className="space-y-1">
						{card.gates.map((gate) => (
							<li key={`${card.id}:${gate.id}`} className="break-words">
								<span className="font-mono text-ink-faint">{gate.status}</span> · {gate.detail}
							</li>
						))}
					</ul>
				) : (
					<p className="text-ink-faint">{t("panel.evidence.capabilityNoGates")}</p>
				)}
				{card.artifactRefs.length > 0 && (
					<div className="text-ink-faint">
						<p>
							{t("panel.evidence.capabilityArtifacts")}: {card.artifactRefs.length}
						</p>
						<ul className="mt-1 space-y-1">
							{card.artifactRefs.slice(0, 4).map((artifact) => (
								<li key={artifact.path} className="break-all font-mono text-[11px]">
									{artifact.path}
								</li>
							))}
						</ul>
					</div>
				)}
				<p className="text-ink-faint">
					{t("panel.evidence.capabilityReceipts")}:{" "}
					{card.receiptRefs.length > 0
						? card.receiptRefs.join(", ")
						: t("panel.evidence.capabilityNoReceipts")}
				</p>
			</div>
		</article>
	);
}
