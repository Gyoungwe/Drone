import type { ZoteroStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";
import { ZoteroLocalWriteSection } from "./ZoteroLocalWriteSection";
import { ZoteroWebApiSection } from "./ZoteroWebApiSection";
import { useZoteroText } from "./zotero-copy";

/** Zotero is a built-in connector. The optional zotero MCP remains visible in
 * the generic MCP list, but this panel never installs, enables, or edits it. */
export function ZoteroPanel() {
	const t = useZoteroText();
	const [status, setStatus] = useState<ZoteroStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setStatus(await getPi().getZoteroStatus());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);

	const major = Number.parseInt(status?.version?.split(".")[0] ?? "", 10);
	const localPreferred = Number.isFinite(major) && major >= 10;

	return (
		<div className="text-ink" data-testid="zotero-panel">
			<header className="flex items-start justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold">{t("title")}</h2>
					<p className="mt-1 text-xs text-ink-dim">{t("subtitle")}</p>
				</div>
				<Button size="sm" disabled={loading} onClick={() => void refresh()}>
					{t("refresh")}
				</Button>
			</header>

			{error && (
				<p role="alert" className="mt-4 break-words rounded-lg border border-border p-3 text-xs text-err">
					{error}
				</p>
			)}
			{!status && loading && (
				<p role="status" className="mt-4 text-xs">
					{t("loading")}
				</p>
			)}

			{status && (
				<div className="mt-4 space-y-4">
					<section className="rounded-xl border border-border p-4">
						<h3 className="text-xs font-semibold">{t("statusTitle")}</h3>
						<div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
							<span
								className={`h-1.5 w-1.5 rounded-full ${status.localApiReachable ? "bg-ok" : "bg-warn"}`}
							/>
							<span>{status.desktopDetected ? "Zotero" : t("desktopMissing")}</span>
							<span className="text-ink-faint">·</span>
							<span>{status.localApiReachable ? t("localApiOk") : t("localApiNo")}</span>
							{status.version ? (
								<span className="text-ink-faint">
									· {t("version")} {status.version}
								</span>
							) : null}
							<span className="text-ink-faint">·</span>
							<span>{localPreferred ? t("writeModeLocal") : t("writeModeWeb")}</span>
						</div>
						{!status.localApiReachable && <p className="mt-2 text-xs text-warn">{t("statusUnavailable")}</p>}
					</section>

					{localPreferred ? <ZoteroLocalWriteSection /> : <ZoteroWebApiSection />}
					<details className="rounded-xl border border-border p-4">
						<summary className="cursor-pointer text-xs font-semibold">{t("advancedLegacy")}</summary>
						<div className="mt-3">
							{localPreferred ? <ZoteroWebApiSection /> : <ZoteroLocalWriteSection />}
						</div>
					</details>

					<section className="rounded-xl border border-dashed border-border-strong px-4 py-3">
						<p className="text-xs text-ink-dim">{t("crossHint")}</p>
					</section>
				</div>
			)}
		</div>
	);
}
