import type {
	KnowledgeCloudNote,
	KnowledgeCloudStatus,
	KnowledgeCloudSyncResult,
	KnowledgeNote,
	KnowledgeSearchResult,
} from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";

const MODE_COPY_KEYS = {
	disabled: "cloudModeDisabled",
	unchecked: "cloudModeUnchecked",
	offline: "cloudModeOffline",
	unauthorized: "cloudModeUnauthorized",
	"read-only": "cloudModeReadOnly",
	ready: "cloudModeReady",
	error: "cloudModeError",
} as const satisfies Record<KnowledgeCloudStatus["mode"], string>;

function modeLabel(mode: KnowledgeCloudStatus["mode"], t: (key: any) => string): string {
	return t(MODE_COPY_KEYS[mode]);
}

function isNotFound(error: unknown): boolean {
	return /not.?found|不存在|404/u.test(error instanceof Error ? error.message : String(error));
}

function compactText(text: string | undefined, max = 7000): string {
	if (!text) return "";
	return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

function comparison(local: KnowledgeNote | null, remote: KnowledgeCloudNote | null, remoteMissing: boolean) {
	if (local?.hash && remote?.hash && local.hash === remote.hash) return "same";
	if (local && remote) return "conflict";
	if (local && remoteMissing) return "local-only";
	if (!local && remote) return "remote-only";
	return "unavailable";
}

export function KnowledgeCloudSection({
	cwd,
	bindingRevision,
}: {
	cwd?: string | null;
	bindingRevision?: number | null;
}) {
	const t = useKnowledgeText();
	const [status, setStatus] = useState<KnowledgeCloudStatus | null>(null);
	const [busy, setBusy] = useState<
		"probe" | "initialize" | "password" | "search" | "preview" | "sync" | null
	>(null);
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [searchResult, setSearchResult] = useState<KnowledgeSearchResult | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [localNote, setLocalNote] = useState<KnowledgeNote | null>(null);
	const [remoteNote, setRemoteNote] = useState<KnowledgeCloudNote | null>(null);
	const [remoteMissing, setRemoteMissing] = useState(false);
	const [remoteError, setRemoteError] = useState<string | null>(null);
	const [syncResult, setSyncResult] = useState<KnowledgeCloudSyncResult | null>(null);

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
	async function savePassword(value: string | null) {
		setBusy("password");
		setError(null);
		try {
			setStatus(await getPi().setKnowledgeCloudPassword({ password: value }));
			setPassword("");
		} catch (error_) {
			setError(error_ instanceof Error ? error_.message : String(error_));
		} finally {
			setBusy(null);
		}
	}
	async function searchNotes() {
		if (!bindingRevision || !query.trim()) return;
		setBusy("search");
		setError(null);
		try {
			setSearchResult(await getPi().searchKnowledge({ cwd, bindingRevision, query: query.trim(), limit: 8 }));
		} catch (value) {
			setError(value instanceof Error ? value.message : String(value));
		} finally {
			setBusy(null);
		}
	}
	async function preview(path: string) {
		if (!bindingRevision) return;
		setSelectedPath(path);
		setLocalNote(null);
		setRemoteNote(null);
		setRemoteMissing(false);
		setRemoteError(null);
		setSyncResult(null);
		setBusy("preview");
		setError(null);
		const [local, remote] = await Promise.allSettled([
			getPi().readKnowledgeNote({ cwd, path, startLine: 1, revision: bindingRevision }),
			getPi().readKnowledgeCloudNote({ path }),
		]);
		if (local.status === "fulfilled" && !local.value.missing) setLocalNote(local.value);
		else if (local.status === "rejected")
			setError(local.reason instanceof Error ? local.reason.message : String(local.reason));
		if (remote.status === "fulfilled") setRemoteNote(remote.value);
		else if (isNotFound(remote.reason)) setRemoteMissing(true);
		else setRemoteError(remote.reason instanceof Error ? remote.reason.message : String(remote.reason));
		setBusy(null);
	}
	async function sync(mode: "pull" | "push", resolution?: "local" | "remote") {
		if (!bindingRevision || !selectedPath) return;
		setBusy("sync");
		setError(null);
		try {
			const result = await getPi().syncKnowledgeCloud({
				cwd,
				mode,
				bindingRevision,
				paths: [selectedPath],
				...(resolution ? { resolution } : {}),
			});
			await preview(selectedPath);
			setSyncResult(result);
		} catch (value) {
			setError(value instanceof Error ? value.message : String(value));
		} finally {
			setBusy(null);
		}
	}

	if (!status) return null;
	const state = comparison(localNote, remoteNote, remoteMissing);
	const canOperate = Boolean(bindingRevision && status.mode === "ready" && selectedPath && !busy);
	return (
		<section className="space-y-3 rounded-xl border border-border p-3" data-testid="knowledge-cloud">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-xs font-semibold">{t("cloudTitle")}</h3>
				<span className={`text-[11px] ${status.mode === "ready" ? "text-ok" : "text-warn"}`} role="status">
					{modeLabel(status.mode, t)}
				</span>
			</div>
			<p className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2 text-[11px] leading-relaxed text-ink-dim">
				{t("cloudManualSyncNotice")}
			</p>
			<p className="text-[11px] leading-relaxed text-ink-dim">{t("cloudHint")}</p>
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
				<dt className="text-ink-dim">{t("cloudEndpoint")}</dt>
				<dd className="break-all font-mono">{status.endpoint}</dd>
				<dt className="text-ink-dim">{t("cloudFolder")}</dt>
				<dd className="font-mono">{status.folder}</dd>
			</dl>
			<form
				className="flex flex-wrap items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					if (password) void savePassword(password);
				}}
			>
				<label className="text-[11px] text-ink-dim" htmlFor="knowledge-cloud-password">
					{t("cloudPassword")}
				</label>
				<input
					id="knowledge-cloud-password"
					type="password"
					autoComplete="off"
					maxLength={256}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					placeholder={t("cloudPasswordPlaceholder")}
					className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 font-mono text-[11px]"
				/>
				<Button size="sm" type="submit" disabled={busy !== null || !password}>
					{t("cloudPasswordSave")}
				</Button>
				<Button
					size="sm"
					type="button"
					disabled={busy !== null || status.passwordSource !== "saved"}
					onClick={() => void savePassword(null)}
				>
					{t("cloudPasswordClear")}
				</Button>
			</form>
			{status.passwordSource === "saved" && (
				<p className="text-[11px] text-ink-dim">{t("cloudPasswordSaved")}</p>
			)}
			{status.passwordSource === "env" && <p className="text-[11px] text-ink-dim">{t("cloudPasswordEnv")}</p>}
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

			{bindingRevision ? (
				<div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
					<div className="flex items-center justify-between gap-2">
						<h4 className="text-xs font-semibold">{t("cloudSyncTitle")}</h4>
						<span className="text-[11px] text-ink-faint">{t("cloudSyncStepHint")}</span>
					</div>
					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void searchNotes();
						}}
					>
						<input
							aria-label={t("cloudSearchLabel")}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("cloudSearchPlaceholder")}
							className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
						/>
						<Button size="sm" type="submit" disabled={busy !== null || !query.trim()}>
							{busy === "search" ? t("loading") : t("cloudSearch")}
						</Button>
					</form>
					{searchResult && (
						<ul className="max-h-40 divide-y divide-border overflow-auto rounded-md border border-border">
							{searchResult.hits.length ? (
								searchResult.hits.map((hit) => (
									<li key={hit.path}>
										<button
											type="button"
											className="w-full px-2.5 py-2 text-left hover:bg-hover"
											onClick={() => void preview(hit.path)}
										>
											<span className="block truncate text-xs font-medium">{hit.title || hit.path}</span>
											<span className="block truncate font-mono text-[10px] text-ink-faint">{hit.path}</span>
										</button>
									</li>
								))
							) : (
								<li className="px-2.5 py-2 text-[11px] text-ink-faint">{t("homeSearchEmpty")}</li>
							)}
						</ul>
					)}
					{selectedPath && (
						<div className="space-y-2 rounded-md border border-border p-2.5">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="min-w-0 truncate font-mono text-[11px]" title={selectedPath}>
									{selectedPath}
								</span>
								{busy === "preview" ? (
									<span className="text-[11px] text-ink-faint">{t("loading")}</span>
								) : (
									<span className="text-[11px] text-ink-dim">
										{t(
											`cloudCompare${
												state === "same"
													? "Same"
													: state === "conflict"
														? "Conflict"
														: state === "local-only"
															? "LocalOnly"
															: state === "remote-only"
																? "RemoteOnly"
																: "Unavailable"
											}` as any,
										)}
									</span>
								)}
							</div>
							{remoteError && <p className="text-[11px] text-err">{remoteError}</p>}
							{state === "conflict" && (
								<div className="grid gap-2 md:grid-cols-2">
									<div>
										<p className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">
											{t("cloudLocalVersion")}
										</p>
										<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-hover p-2 text-[10px]">
											{compactText(localNote?.text)}
										</pre>
									</div>
									<div>
										<p className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">
											{t("cloudRemoteVersion")}
										</p>
										<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-hover p-2 text-[10px]">
											{compactText(remoteNote?.text)}
										</pre>
									</div>
								</div>
							)}
							<div className="flex flex-wrap gap-2">
								{state !== "conflict" && (
									<Button size="sm" disabled={!canOperate || !localNote} onClick={() => void sync("push")}>
										{t("cloudPush")}
									</Button>
								)}
								{state !== "conflict" && (
									<Button size="sm" disabled={!canOperate || !remoteNote} onClick={() => void sync("pull")}>
										{t("cloudPull")}
									</Button>
								)}
								{state === "conflict" && (
									<Button
										size="sm"
										disabled={!canOperate || !remoteNote}
										onClick={() => void sync("push", "local")}
									>
										{t("cloudResolveLocal")}
									</Button>
								)}
								{state === "conflict" && (
									<Button
										size="sm"
										disabled={!canOperate || !remoteNote}
										onClick={() => void sync("pull", "remote")}
									>
										{t("cloudResolveRemote")}
									</Button>
								)}
							</div>
						</div>
					)}
					{syncResult && (
						<p className="text-[11px] text-ink-dim">
							{syncResult.items[0]?.message ||
								(syncResult.completed ? t("cloudSyncDone") : t("cloudSyncNeedsReview"))}
						</p>
					)}
				</div>
			) : (
				<p className="text-[11px] text-ink-faint">{t("cloudSyncNeedsBinding")}</p>
			)}
			{error && (
				<p role="alert" className="break-words text-[11px] text-err">
					{error}
				</p>
			)}
		</section>
	);
}
