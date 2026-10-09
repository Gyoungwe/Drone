import type { KnowledgeCloudStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";

function modeLabel(mode: KnowledgeCloudStatus["mode"], t: (key: any) => string): string {
	const key =
		mode === "read-write" || mode === "ready"
			? "Ready"
			: mode === "read-only"
				? "ReadOnly"
				: mode[0].toUpperCase() + mode.slice(1);
	return t(`cloudMode${key}` as any);
}

export function KnowledgeCloudSection() {
	const t = useKnowledgeText();
	const [status, setStatus] = useState<KnowledgeCloudStatus | null>(null);
	const [busy, setBusy] = useState<"probe" | "initialize" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(async () => {
		try {
			setStatus(await getPi().getKnowledgeCloudStatus());
		} catch (value) {
			setError(value instanceof Error ? value.message : String(value));
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	async function run(kind: "probe" | "initialize") {
		setBusy(kind);
		setError(null);
		try {
			setStatus(
				await (kind === "probe" ? getPi().probeKnowledgeCloud() : getPi().initializeKnowledgeCloud()),
			);
		} catch (value) {
			setError(value instanceof Error ? value.message : String(value));
		} finally {
			setBusy(null);
		}
	}
	if (!status) return null;
	return (
		<section className="space-y-2 rounded-xl border border-border p-3" data-testid="knowledge-cloud">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-xs font-semibold">{t("cloudTitle")}</h3>
				<span className={`text-[11px] ${status.mode === "ready" ? "text-ok" : "text-warn"}`} role="status">
					{modeLabel(status.mode, t)}
				</span>
			</div>
			<p className="text-[11px] leading-relaxed text-ink-dim">{t("cloudHint")}</p>
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
				<dt className="text-ink-dim">{t("cloudEndpoint")}</dt>
				<dd className="break-all font-mono">{status.endpoint}</dd>
				<dt className="text-ink-dim">{t("cloudFolder")}</dt>
				<dd className="font-mono">{status.folder}</dd>
			</dl>
			{status.message && <p className="break-words text-[11px] text-ink-dim">{status.message}</p>}
			{status.warnings.map((warning) => (
				<p key={warning} className="break-words text-[11px] text-warn">
					{warning}
				</p>
			))}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" disabled={busy !== null} onClick={() => void run("probe")}>
					{busy === "probe" ? t("loading") : t("cloudProbe")}
				</Button>
				<Button
					size="sm"
					disabled={busy !== null || status.initialized}
					onClick={() => void run("initialize")}
				>
					{busy === "initialize" ? t("loading") : t("cloudInitialize")}
				</Button>
			</div>
			{error && (
				<p role="alert" className="break-words text-[11px] text-err">
					{error}
				</p>
			)}
		</section>
	);
}
