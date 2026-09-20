import type { ZoteroStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { launchZoteroSetup, reportKnowledgeError } from "./hooks";
import { InstitutionalAccessSection } from "./InstitutionalAccessSection";
import { useZoteroText } from "./zotero-copy";

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
	return (
		<div className="flex items-center gap-2 text-xs">
			<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-ok" : "bg-warn"}`} aria-hidden />
			<span className={ok ? "" : "text-ink-dim"}>{label}</span>
		</div>
	);
}

export function ZoteroPanel() {
	const t = useZoteroText();
	const cwd = useSessionsStore((s) => s.cwd),
		sessionId = useSessionsStore((s) => s.activeSessionId);
	const [status, setStatus] = useState<ZoteroStatus | null>(null),
		[error, setError] = useState<string | null>(null),
		[loading, setLoading] = useState(false),
		[busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setStatus(await getPi().getZoteroStatus());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);

	async function toggle(next: boolean) {
		setBusy(true);
		setError(null);
		try {
			await getPi().setMcpServerEnabled("zotero", next);
			await refresh();
		} catch {
			setError(t("toggleFailed"));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="text-ink" data-testid="zotero-panel">
			<header className="flex items-start justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold">{t("title")}</h2>
					<p className="mt-1 text-[11px] text-ink-dim">{t("subtitle")}</p>
				</div>
				<Button size="sm" disabled={loading || busy} onClick={() => void refresh()}>
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
					{/* 接入状态 + 启用开关 */}
					<section className="rounded-xl border border-border p-4">
						<h3 className="text-xs font-semibold">{t("statusTitle")}</h3>
						<div className="mt-3 grid gap-2 sm:grid-cols-2">
							<StatusRow
								ok={status.registered}
								label={status.registered ? t("registered") : t("notRegistered")}
							/>
							<StatusRow
								ok={status.enabled}
								label={status.enabled ? t("enabledState") : t("disabledState")}
							/>
							<StatusRow
								ok={status.localApiReachable}
								label={status.localApiReachable ? t("localApiOk") : t("localApiNo")}
							/>
							<StatusRow
								ok={status.desktopDetected}
								label={status.desktopDetected ? t("desktopOk") : t("desktopNo")}
							/>
						</div>
						<label className="mt-4 flex items-center gap-2 text-xs">
							<input
								type="checkbox"
								checked={status.enabled}
								disabled={!status.registered || busy}
								onChange={(e) => void toggle(e.target.checked)}
							/>
							<span>{t("enableLabel")}</span>
						</label>
						{!status.registered && <p className="mt-2 text-[11px] text-warn">{t("enableHintNeedSetup")}</p>}
						<p className="mt-2 text-[11px] text-ink-faint">{t("reloadHint")}</p>
					</section>

					{/* 一键接入 / 安装 + 打开 Zotero / 文档 */}
					<section className="rounded-xl border border-border p-4">
						<h3 className="text-xs font-semibold">{t("setupTitle")}</h3>
						<p className="mt-2 text-xs leading-relaxed text-ink-dim">{t("setupHint")}</p>
						<p className="mt-2 rounded-lg bg-hover p-2 text-[11px] text-ink-dim">{t("setupSteps")}</p>
						{!cwd && <p className="mt-2 text-[11px] text-warn">{t("setupNoCwd")}</p>}
						<div className="mt-3 flex flex-wrap gap-1">
							<Button
								size="sm"
								variant="primary"
								disabled={!cwd}
								onClick={() => void launchZoteroSetup(cwd, sessionId).catch(reportKnowledgeError)}
							>
								{t("setupButton")}
							</Button>
							{status.desktopPath && (
								<Button
									size="sm"
									onClick={() =>
										void getPi()
											.openResourceExternal(status.desktopPath ?? "")
											.catch(reportKnowledgeError)
									}
								>
									{t("openApp")}
								</Button>
							)}
							<Button
								size="sm"
								onClick={() => void getPi().openExternal(status.downloadUrl).catch(reportKnowledgeError)}
							>
								{t("download")}
							</Button>
							<Button
								size="sm"
								onClick={() => void getPi().openExternal(status.docsUrl).catch(reportKnowledgeError)}
							>
								{t("openDocs")}
							</Button>
						</div>
					</section>

					{/* 机构访问（合法通道） */}
					<InstitutionalAccessSection />

					{/* 与 Obsidian 知识库的交叉引导 */}
					<section className="rounded-xl border border-dashed border-border-strong p-4">
						<h3 className="text-xs font-semibold">{t("crossTitle")}</h3>
						<p className="mt-2 text-xs leading-relaxed text-ink-dim">{t("crossHint")}</p>
						<Button
							size="sm"
							className="mt-3"
							onClick={() => useSettingsStore.getState().openWith("knowledge")}
						>
							{t("gotoObsidian")}
						</Button>
					</section>
				</div>
			)}
		</div>
	);
}
