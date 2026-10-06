import type { InstitutionalStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";
import { useZoteroText } from "./zotero-copy";

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
	return (
		<div className="flex items-center justify-between gap-2 text-[11px]">
			<span className="text-ink-dim">{label}</span>
			<span className={`truncate ${ok === true ? "text-ok" : ok === false ? "text-warn" : "text-ink"}`}>
				{value}
			</span>
		</div>
	);
}

export function InstitutionalAccessSection() {
	const t = useZoteroText();
	const [status, setStatus] = useState<InstitutionalStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [testUrl, setTestUrl] = useState("https://doi.org/10.1038/nature12373");
	const [testResult, setTestResult] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const s = await getPi().getInstitutionalStatus();
			setStatus(s);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const openLogin = async (url?: string) => {
		setError(null);
		try {
			await getPi().openInstitutionalLogin(url);
			setTimeout(() => void refresh(), 1500);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const clear = async () => {
		setError(null);
		try {
			const next = await getPi().clearInstitutionalSession();
			setStatus(next);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const doTest = async () => {
		setTesting(true);
		setTestResult(null);
		setError(null);
		try {
			const res = await getPi().testInstitutionalAccess(testUrl);
			setTestResult(JSON.stringify(res, null, 2));
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setTesting(false);
		}
	};

	return (
		<section className="rounded-xl border border-border p-4" data-testid="institutional-section">
			<h3 className="text-xs font-semibold">{t("instTitle")}</h3>
			<p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
				{t("instIntro").replace("{limit}", String(status?.config.perTaskLimit ?? 20))}
			</p>

			{error && (
				<p
					role="alert"
					className="mt-3 break-words rounded-lg border border-border bg-err/10 p-2 text-[11px] text-err"
				>
					{error}
				</p>
			)}

			{status && (
				<div className="mt-3 grid gap-1.5 rounded-lg bg-hover p-2">
					<Row
						label={t("instLoginState")}
						value={status.loggedIn ? t("instLoggedIn") : t("instLoggedOut")}
						ok={status.loggedIn}
					/>
					<Row
						label={t("instCookies")}
						value={`${status.session.cookiesCount}`}
						ok={status.session.cookiesCount > 0}
					/>
					<Row
						label={t("instLastLogin")}
						value={
							status.config.lastLoginAt
								? new Date(status.config.lastLoginAt).toLocaleString()
								: t("instNever")
						}
					/>
					<Row
						label={t("instTemplate")}
						value={status.config.ezproxyTemplate || t("instNoTemplate")}
						ok={Boolean(status.config.ezproxyTemplate)}
					/>
					<Row label={t("instName")} value={status.config.institutionName || t("instUnset")} />
					<Row
						label={t("instAutoDownload")}
						value={status.config.autoDownloadEnabled ? t("instOn") : t("instOff")}
						ok={status.config.autoDownloadEnabled}
					/>
					<Row
						label={t("instPerTask")}
						value={t("instPapers").replace("{n}", String(status.config.perTaskLimit))}
					/>
				</div>
			)}

			<div className="mt-4 space-y-3">
				<div className="flex flex-wrap gap-1.5">
					<Button size="sm" variant="primary" onClick={() => void openLogin()}>
						{t("instLogin")}
					</Button>
					<Button size="sm" disabled={loading} onClick={() => void refresh()}>
						{t("instRefresh")}
					</Button>
					<Button size="sm" onClick={() => void clear()}>
						{t("instClear")}
					</Button>
				</div>

				<div className="rounded-lg border border-dashed border-border p-2">
					<div className="text-[11px] font-medium text-ink">{t("instTestTitle")}</div>
					<div className="mt-1 flex gap-1">
						<input
							className="flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs"
							value={testUrl}
							onChange={(e) => setTestUrl(e.target.value)}
							placeholder="https://doi.org/..."
						/>
						<Button size="sm" disabled={testing} onClick={() => void doTest()}>
							{testing ? t("instTesting") : t("instTest")}
						</Button>
					</div>
					{testResult && (
						<pre className="mt-2 max-h-48 overflow-auto rounded bg-hover p-2 text-[10px] leading-relaxed">
							{testResult}
						</pre>
					)}
					<p className="mt-2 text-[10px] leading-relaxed text-ink-faint">{t("instWorkflow")}</p>
				</div>

				<p className="text-[10px] text-ink-faint">{t("instWebvpn")}</p>
			</div>
		</section>
	);
}
