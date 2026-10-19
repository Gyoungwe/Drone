import type { ComputeHost, ComputeJob, ComputeSshConfigHost } from "@drone/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { type MessageKey, useT } from "../../i18n";
import { selectHosts, selectJobs, selectOnboarding, useComputeStore } from "../../stores/compute";
import { HostEnvironmentCard, HostPermissions } from "./HostEnvironmentCard";

function statusTone(status: string): string {
	if (status === "healthy" || status === "succeeded" || status === "ready") return "text-ok";
	if (status === "checking" || status === "running" || status === "queued") return "text-warn";
	if (status === "offline" || status === "failed" || status === "blocked") return "text-err";
	return "text-ink-dim";
}

function statusLabel(t: (key: MessageKey) => string, status: string): string {
	return t(`panel.compute.status.${status}` as MessageKey);
}

interface HostFormState {
	alias: string;
	displayName: string;
	endpoint: string;
	port: string;
	user: string;
	identityFile: string;
	jumpHosts: string;
	hostKeyFingerprint: string;
	workspaceRoot: string;
}

const EMPTY_HOST_FORM: HostFormState = {
	alias: "",
	displayName: "",
	endpoint: "",
	port: "",
	user: "",
	identityFile: "",
	jumpHosts: "",
	hostKeyFingerprint: "",
	workspaceRoot: "",
};

function HostRow({
	host,
	onCheckEnvironment,
	onPreviewPlan,
	onConfirmRun,
	onOpenTerminal,
	onRemove,
	checked,
	previewing,
}: {
	host: ComputeHost;
	onCheckEnvironment: () => void;
	onPreviewPlan: () => void;
	onConfirmRun: () => void;
	onOpenTerminal: () => void;
	onRemove: () => void;
	checked: boolean;
	previewing: boolean;
}) {
	const t = useT();
	return (
		<li className="panel-card flex flex-col gap-3" data-testid={`compute-host-${host.id}`}>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<strong className="block truncate text-[13px] font-medium text-ink">{host.displayName}</strong>
					<span className="mt-0.5 block truncate font-mono text-[11px] text-ink-faint">{host.alias}</span>
				</div>
				<span
					className={`rounded-full border border-border px-2 py-0.5 text-xs ${statusTone(host.health.status)}`}
				>
					{statusLabel(t, host.health.status)}
				</span>
			</div>
			<div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-dim">
				<div>
					<span className="mr-1 text-ink-faint">{t("panel.compute.kind")}:</span>
					{host.kind}
				</div>
				{host.endpoint && (
					<div className="truncate" title={host.endpoint}>
						<span className="mr-1 text-ink-faint">{t("panel.compute.endpointLabel")}:</span>
						{host.endpoint}
					</div>
				)}
				{host.port != null && (
					<div>
						<span className="mr-1 text-ink-faint">{t("panel.compute.portLabel")}:</span>
						{host.port}
					</div>
				)}
				{host.user && (
					<div className="truncate" title={host.user}>
						<span className="mr-1 text-ink-faint">{t("panel.compute.userLabel")}:</span>
						{host.user}
					</div>
				)}
				{host.platform && (
					<div>
						<span className="mr-1 text-ink-faint">{t("panel.compute.platformLabel")}:</span>
						{host.platform}
					</div>
				)}
				{host.workspaceRoot && (
					<div className="col-span-2 truncate font-mono" title={host.workspaceRoot}>
						<span className="mr-1 font-sans text-ink-faint">{t("panel.compute.workspaceRootLabel")}:</span>
						{host.workspaceRoot}
					</div>
				)}
				{host.health.latencyMs != null && (
					<div>
						<span className="mr-1 text-ink-faint">{t("panel.compute.latencyLabel")}:</span>
						{Math.round(host.health.latencyMs)} ms
					</div>
				)}
			</div>
			<HostPermissions
				authState={host.authState}
				managed={host.managed}
				capabilities={host.capabilities.map((c) => (c.version ? `${c.name} ${c.version}` : c.name))}
				workspaceRoot={host.workspaceRoot}
			/>
			<div className="flex flex-wrap gap-2 border-t border-border/70 pt-2">
				<button type="button" className="panel-action" onClick={onCheckEnvironment}>
					{t("panel.compute.checkEnvironment")}
				</button>
				<button
					type="button"
					className="panel-action"
					onClick={onPreviewPlan}
					disabled={!checked || host.authState !== "ready"}
				>
					{t("panel.compute.previewPlan")}
				</button>
				<button
					type="button"
					className="panel-action"
					onClick={onOpenTerminal}
					disabled={host.authState !== "ready"}
				>
					{t("panel.compute.openTerminal")}
				</button>
				<button type="button" className="panel-action" onClick={onRemove}>
					{t("panel.compute.remove")}
				</button>
			</div>
			{previewing && (
				<div
					className="rounded-lg border border-border bg-hover px-3 py-3"
					data-testid={`compute-plan-${host.id}`}
				>
					<div className="flex items-start justify-between gap-2">
						<div>
							<p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
								{t("panel.compute.planPreview")}
							</p>
							<p className="mt-1 text-[12px] text-ink">
								nf-core/rnaseq <span className="text-ink-faint">· {t("panel.compute.planVersion")}</span>
							</p>
							<p className="mt-0.5 text-xs text-ink-dim">{t("panel.compute.planSummary")}</p>
						</div>
						<button
							type="button"
							className="panel-action"
							onClick={onConfirmRun}
							disabled={host.authState !== "ready"}
						>
							{t("panel.compute.confirmAndRun")}
						</button>
					</div>
				</div>
			)}
		</li>
	);
}

function JobRow({
	job,
	onCancel,
	onSelect,
	onOpenMultiqc,
}: {
	job: ComputeJob;
	onCancel: () => void;
	onSelect: () => void;
	onOpenMultiqc: (path: string) => void;
}) {
	const t = useT();
	const stageKey =
		job.state === "queued"
			? "queued"
			: job.state === "running"
				? "running"
				: job.state === "succeeded"
					? "succeeded"
					: job.state === "failed"
						? "failed"
						: job.state === "cancelled"
							? "cancelled"
							: "unknown";
	const elapsedMinutes = job.startedAt
		? Math.max(
				0,
				Math.round(
					((job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.startedAt)) / 60_000,
				),
			)
		: null;
	const progress = job.progress;
	const completedTasks = progress?.completedTasks;
	const totalTasks = progress?.totalTasks;
	const taskCount =
		completedTasks !== undefined && totalTasks !== undefined ? `${completedTasks}/${totalTasks}` : null;
	const multiqcPath = progress?.multiqcPath;
	return (
		<li className="panel-card flex flex-col gap-2" data-testid={`compute-job-${job.id}`}>
			<div className="flex items-center justify-between gap-2">
				<button type="button" className="truncate text-left text-[12px] text-ink" onClick={onSelect}>
					{job.label || job.id}
				</button>
				<span className={`text-xs ${statusTone(job.state)}`}>{statusLabel(t, job.state)}</span>
			</div>
			<div className="flex items-center gap-2 text-[11px] text-ink-dim">
				<span
					className={`inline-block h-2 w-2 rounded-full ${job.state === "running" ? "animate-pulse bg-warn" : job.state === "succeeded" ? "bg-ok" : job.state === "failed" ? "bg-err" : "bg-ink-faint"}`}
				/>
				<span>{progress?.stage || t(`panel.compute.runCard.stage.${stageKey}` as MessageKey)}</span>
				<span className="text-ink-faint">·</span>
				<span>{job.hostId}</span>
			</div>
			<div className="grid grid-cols-3 gap-2 rounded-md bg-ink/5 px-2 py-2 text-[10px] text-ink-dim">
				<span>
					{taskCount
						? t("panel.compute.runCard.tasks", { count: taskCount })
						: t("panel.compute.runCard.tasksUnknown")}
				</span>
				<span>{t("panel.compute.runCard.artifacts", { count: job.artifacts.length })}</span>
				<span>{t("panel.compute.runCard.elapsed", { minutes: elapsedMinutes ?? "—" })}</span>
			</div>
			{progress?.failedTasks ? (
				<p className="rounded-md border border-err/30 bg-err/5 px-2 py-1 text-[10px] text-err">
					{t("panel.compute.runCard.failedTasks", { count: progress.failedTasks })}:{" "}
					{progress.failureReason || job.publicSummary || t("panel.compute.runCard.unknownFailure")}
				</p>
			) : job.publicSummary ? (
				<p className="truncate text-[10px] text-ink-dim" title={job.publicSummary}>
					{job.publicSummary}
				</p>
			) : null}
			{progress?.processes.length ? (
				<details className="rounded-md border border-border/70 px-2 py-1 text-[10px] text-ink-dim">
					<summary className="cursor-pointer">
						{t("panel.compute.runCard.stages", { count: progress.processes.length })}
					</summary>
					<div className="mt-1 space-y-1">
						{progress.processes.slice(0, 8).map((process) => {
							const processCount =
								process.completed !== undefined && process.total !== undefined
									? `${process.completed}/${process.total}`
									: process.failed !== undefined
										? t("panel.compute.runCard.failedTasks", { count: process.failed })
										: t("panel.compute.runCard.tasksUnknown");
							return (
								<div key={process.name} className="flex items-center justify-between gap-2">
									<span className="truncate" title={process.name}>
										{process.label || process.name}
									</span>
									<span className="shrink-0 font-mono">{processCount}</span>
								</div>
							);
						})}
					</div>
				</details>
			) : null}
			{multiqcPath ? (
				<button
					type="button"
					className="truncate text-left text-[10px] text-accent underline"
					title={multiqcPath}
					onClick={() => onOpenMultiqc(multiqcPath)}
				>
					{t("panel.compute.runCard.openMultiqc")}: {multiqcPath}
				</button>
			) : null}
			{(job.state === "queued" || job.state === "running") && (
				<button type="button" className="panel-action self-start" onClick={onCancel}>
					{t("panel.compute.cancel")}
				</button>
			)}
		</li>
	);
}

/** Read-only host/job health plus the approved-host SSH terminal entry point. */
export function ComputePane() {
	const t = useT();
	const hosts = useComputeStore(selectHosts);
	const jobs = useComputeStore(selectJobs);
	const onboarding = useComputeStore(selectOnboarding);
	const logsByJob = useComputeStore((state) => state.logsByJob);
	const health = useComputeStore((state) => state.health);
	const error = useComputeStore((state) => state.error);
	const refresh = useComputeStore((state) => state.refresh);
	const refreshJobs = useComputeStore((state) => state.refreshJobs);
	const refreshOnboarding = useComputeStore((state) => state.refreshOnboarding);
	const probeHost = useComputeStore((state) => state.probeHost);
	const submitJob = useComputeStore((state) => state.submitJob);
	const openTerminal = useComputeStore((state) => state.openTerminal);
	const cancelJob = useComputeStore((state) => state.cancelJob);
	const saveHost = useComputeStore((state) => state.saveHost);
	const removeHost = useComputeStore((state) => state.removeHost);
	const closeTerminal = useComputeStore((state) => state.closeTerminal);
	const loadLogs = useComputeStore((state) => state.loadLogs);
	const checkOnboardingStep = useComputeStore((state) => state.checkOnboardingStep);
	const [terminalId, setTerminalId] = useState<string | null>(null);
	const [terminalInput, setTerminalInput] = useState("");
	const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
	const [hostForm, setHostForm] = useState<HostFormState>(EMPTY_HOST_FORM);
	const [sshConfigHosts, setSshConfigHosts] = useState<ComputeSshConfigHost[]>([]);
	const [sshConfigLoading, setSshConfigLoading] = useState(false);
	const [checkedHostIds, setCheckedHostIds] = useState<Set<string>>(() => new Set());
	const [previewHostId, setPreviewHostId] = useState<string | null>(null);
	const terminal = useComputeStore((state) => (terminalId ? state.terminals[terminalId] : undefined));
	const discoverSshHosts = useCallback(async () => {
		setSshConfigLoading(true);
		try {
			const discovered = await getPi().listSshConfig();
			// Older/read-only host stubs may not expose this optional discovery
			// projection yet. Keep the picker empty instead of breaking the Hosts
			// route while the rest of the compute contract remains usable.
			setSshConfigHosts(Array.isArray(discovered) ? discovered : []);
		} catch (reason) {
			useComputeStore.setState({ error: reason instanceof Error ? reason.message : String(reason) });
		} finally {
			setSshConfigLoading(false);
		}
	}, []);
	useEffect(() => {
		void discoverSshHosts();
	}, [discoverSshHosts]);
	const openMultiqc = (path: string) => {
		void getPi()
			.openResourceExternal(path)
			.catch((reason) =>
				useComputeStore.setState({ error: reason instanceof Error ? reason.message : String(reason) }),
			);
	};

	const startTerminal = async (host: ComputeHost) => {
		const opened = await openTerminal({ hostId: host.id, mode: "shell" });
		setTerminalId(opened.id);
	};
	const confirmAndRun = async (host: ComputeHost) => {
		await submitJob({
			hostId: host.id,
			idempotencyKey: `rnaseq-plan:${host.id}:${new Date().toISOString().slice(0, 10)}`,
			workflow: { name: "nf-core/rnaseq", version: "3.18.0", source: "nf-core" },
			resources: { cpus: 2, wallTimeSeconds: 3600 },
			outputs: ["multiqc_report.html", "counts.tsv"],
		});
		setPreviewHostId(null);
	};
	const checkEnvironment = async (host: ComputeHost) => {
		await probeHost(host.id);
		setCheckedHostIds((ids) => new Set(ids).add(host.id));
	};
	const sendTerminal = async () => {
		if (!terminalId || !terminalInput) return;
		await useComputeStore.getState().writeTerminal(terminalId, `${terminalInput}\n`);
		setTerminalInput("");
	};
	const addHost = async (event: FormEvent) => {
		event.preventDefault();
		if (!hostForm.alias || !hostForm.displayName) return;
		const port = Number(hostForm.port);
		const jumpHosts = hostForm.jumpHosts
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		await saveHost({
			alias: hostForm.alias,
			displayName: hostForm.displayName,
			kind: "ssh",
			...(hostForm.endpoint ? { endpoint: hostForm.endpoint } : {}),
			...(Number.isInteger(port) && port >= 1 && port <= 65_535 ? { port } : {}),
			...(hostForm.user ? { user: hostForm.user } : {}),
			...(hostForm.identityFile ? { identityFile: hostForm.identityFile } : {}),
			...(jumpHosts.length ? { jumpHosts } : {}),
			...(hostForm.hostKeyFingerprint ? { hostKeyFingerprint: hostForm.hostKeyFingerprint } : {}),
			...(hostForm.workspaceRoot ? { workspaceRoot: hostForm.workspaceRoot } : {}),
		});
		setHostForm(EMPTY_HOST_FORM);
	};
	const addSshConfigHost = async (entry: ComputeSshConfigHost) => {
		try {
			const jumpHosts = (entry.proxyJump ?? "")
				.split(",")
				.map((item) => item.trim())
				.filter((item) => /^[A-Za-z0-9._-]+$/.test(item));
			await saveHost({
				alias: entry.alias,
				displayName: entry.alias,
				kind: "ssh",
				...(entry.hostname ? { endpoint: entry.hostname } : {}),
				...(entry.port ? { port: entry.port } : {}),
				...(entry.user ? { user: entry.user } : {}),
				...(entry.identityFiles[0] ? { identityFile: entry.identityFiles[0] } : {}),
				...(jumpHosts.length ? { jumpHosts } : {}),
			});
		} catch (reason) {
			useComputeStore.setState({ error: reason instanceof Error ? reason.message : String(reason) });
		}
	};

	return (
		<div className="context-pane bg-surface" data-testid="compute-pane">
			<div className="mb-3 flex items-start justify-between gap-2 border-b border-border pb-3">
				<div>
					<h3 className="text-[14px] font-medium tracking-tight text-ink">{t("panel.compute.title")}</h3>
					<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{t("panel.compute.subtitle")}</p>
				</div>
				<button
					type="button"
					className="panel-action"
					onClick={() => void Promise.all([refresh(), refreshJobs(), refreshOnboarding()])}
				>
					{t("panel.compute.refresh")}
				</button>
			</div>
			{error && <p className="panel-empty text-err">{error}</p>}
			<HostEnvironmentCard />
			<section className="mb-4">
				<div className="mb-2 flex items-end justify-between gap-2">
					<div>
						<h4 className="text-[12px] font-medium text-ink">{t("panel.compute.hosts")}</h4>
						<p className="mt-0.5 text-[11px] text-ink-faint">{t("panel.compute.hostsHint")}</p>
					</div>
					<span className="font-mono text-[11px] text-ink-faint">
						{health
							? `${t("panel.compute.updated")} ${new Date(health.checkedAt).toLocaleTimeString()}`
							: "—"}
					</span>
				</div>
				{hosts.length ? (
					<ul className="space-y-3">
						{hosts.map((host) => (
							<HostRow
								key={host.id}
								host={host}
								onCheckEnvironment={() => void checkEnvironment(host)}
								onPreviewPlan={() => setPreviewHostId(host.id)}
								onConfirmRun={() => void confirmAndRun(host)}
								onOpenTerminal={() => void startTerminal(host)}
								onRemove={() => void removeHost(host.id)}
								checked={checkedHostIds.has(host.id)}
								previewing={previewHostId === host.id}
							/>
						))}
					</ul>
				) : (
					<p className="panel-empty">{t("panel.compute.noHosts")}</p>
				)}
				<div className="panel-card mt-3 grid gap-3 border-accent/30 bg-accent/5">
					<div className="flex items-start justify-between gap-3">
						<div>
							<h4 className="text-[12px] font-medium text-ink">{t("panel.compute.sshConfigTitle")}</h4>
							<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
								{t("panel.compute.sshConfigHint")}
							</p>
						</div>
						<button
							type="button"
							className="panel-action shrink-0"
							onClick={() => void discoverSshHosts()}
							disabled={sshConfigLoading}
						>
							{sshConfigLoading ? t("panel.compute.sshConfigReading") : t("panel.compute.sshConfigRead")}
						</button>
					</div>
					<div className="flex items-center justify-between gap-2 text-[10px] text-ink-faint">
						<span className="font-mono">~/.ssh/config</span>
						<span>{t("panel.compute.sshConfigPrivateKeyHint")}</span>
					</div>
					{sshConfigHosts.length ? (
						<ul className="grid gap-2">
							{sshConfigHosts.map((entry) => {
								const configured = hosts.some((host) => host.alias === entry.alias);
								return (
									<li
										key={entry.alias}
										className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-surface px-3 py-2"
									>
										<div className="min-w-0">
											<strong className="block truncate text-[12px] font-medium text-ink">
												{entry.alias}
											</strong>
											<span className="mt-0.5 block truncate font-mono text-[10px] text-ink-dim">
												{entry.user ? `${entry.user}@` : ""}
												{entry.hostname || entry.alias}
												{entry.port ? `:${entry.port}` : ""}
											</span>
											<span className="mt-0.5 block truncate text-[10px] text-ink-faint">
												{entry.identityFiles.length
													? t("panel.compute.sshConfigIdentityCount", { count: entry.identityFiles.length })
													: t("panel.compute.sshConfigDefaultIdentity")}
											</span>
										</div>
										<button
											type="button"
											className="panel-action shrink-0"
											disabled={configured}
											onClick={() => void addSshConfigHost(entry)}
										>
											{configured ? t("panel.compute.sshConfigAdded") : t("panel.compute.sshConfigAdd")}
										</button>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="text-[11px] text-ink-faint">
							{sshConfigLoading ? t("panel.compute.sshConfigReading") : t("panel.compute.sshConfigEmpty")}
						</p>
					)}
				</div>
				<details className="panel-card mt-3 border-dashed bg-canvas/60">
					<summary className="cursor-pointer text-[12px] font-medium text-ink">
						{t("panel.compute.manualHostTitle")}
					</summary>
					<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
						{t("panel.compute.manualHostHint")}
					</p>
					<form className="mt-3 grid gap-3" onSubmit={(event) => void addHost(event)}>
						<div className="grid grid-cols-2 gap-2">
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
								value={hostForm.alias}
								onChange={(event) => setHostForm((form) => ({ ...form, alias: event.target.value }))}
								placeholder={t("panel.compute.alias")}
								aria-label={t("panel.compute.alias")}
							/>
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
								value={hostForm.displayName}
								onChange={(event) => setHostForm((form) => ({ ...form, displayName: event.target.value }))}
								placeholder={t("panel.compute.displayName")}
								aria-label={t("panel.compute.displayName")}
							/>
						</div>
						<div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
								value={hostForm.endpoint}
								onChange={(event) => setHostForm((form) => ({ ...form, endpoint: event.target.value }))}
								placeholder={t("panel.compute.endpoint")}
								aria-label={t("panel.compute.endpoint")}
							/>
							<input
								type="number"
								min={1}
								max={65535}
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
								value={hostForm.port}
								onChange={(event) => setHostForm((form) => ({ ...form, port: event.target.value }))}
								placeholder={t("panel.compute.port")}
								aria-label={t("panel.compute.port")}
							/>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
								value={hostForm.user}
								onChange={(event) => setHostForm((form) => ({ ...form, user: event.target.value }))}
								placeholder={t("panel.compute.user")}
								aria-label={t("panel.compute.user")}
							/>
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
								value={hostForm.workspaceRoot}
								onChange={(event) => setHostForm((form) => ({ ...form, workspaceRoot: event.target.value }))}
								placeholder={t("panel.compute.workspaceRoot")}
								aria-label={t("panel.compute.workspaceRoot")}
							/>
						</div>
						<div className="grid gap-2">
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
								value={hostForm.identityFile}
								onChange={(event) => setHostForm((form) => ({ ...form, identityFile: event.target.value }))}
								placeholder={t("panel.compute.identityFile")}
								aria-label={t("panel.compute.identityFile")}
							/>
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint"
								value={hostForm.jumpHosts}
								onChange={(event) => setHostForm((form) => ({ ...form, jumpHosts: event.target.value }))}
								placeholder={t("panel.compute.jumpHosts")}
								aria-label={t("panel.compute.jumpHosts")}
							/>
							<input
								className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint"
								value={hostForm.hostKeyFingerprint}
								onChange={(event) =>
									setHostForm((form) => ({ ...form, hostKeyFingerprint: event.target.value }))
								}
								placeholder={t("panel.compute.hostKeyFingerprint")}
								aria-label={t("panel.compute.hostKeyFingerprint")}
							/>
						</div>
						<button type="submit" className="panel-action">
							{t("panel.compute.addHost")}
						</button>
					</form>
				</details>
			</section>
			<section className="mb-3">
				<div className="mb-1 text-xs text-ink-dim">{t("panel.compute.jobs")}</div>
				{jobs.length ? (
					<ul className="space-y-2">
						{jobs.map((job) => (
							<JobRow
								key={job.id}
								job={job}
								onCancel={() => void cancelJob(job.id)}
								onOpenMultiqc={openMultiqc}
								onSelect={() => {
									setSelectedJobId(job.id);
									void loadLogs(job.id);
								}}
							/>
						))}
					</ul>
				) : (
					<p className="panel-empty">{t("panel.compute.noJobs")}</p>
				)}
				{selectedJobId && (
					<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-ink/5 p-2 text-xs text-ink">
						{logsByJob[selectedJobId]?.text || t("panel.compute.noLogs")}
					</pre>
				)}
			</section>
			{terminal && (
				<section className="panel-card mb-3" data-testid="compute-terminal">
					<div className="mb-1 flex items-center justify-between text-xs text-ink-dim">
						<span>{t("panel.compute.terminal")}</span>
						<span>{terminal.state}</span>
						<button
							type="button"
							className="panel-action"
							onClick={() => {
								void closeTerminal(terminal.id);
								setTerminalId(null);
							}}
						>
							{t("panel.compute.close")}
						</button>
					</div>
					<pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-ink/5 p-2 text-xs text-ink">
						{terminal.output || t("panel.compute.terminalEmpty")}
					</pre>
					<div className="mt-2 flex gap-1">
						<input
							className="min-w-0 flex-1 rounded border border-ink/20 px-2 py-1 text-xs"
							value={terminalInput}
							onChange={(event) => setTerminalInput(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void sendTerminal();
							}}
							placeholder={t("panel.compute.terminalPlaceholder")}
						/>
						<button type="button" className="panel-action" onClick={() => void sendTerminal()}>
							{t("panel.compute.send")}
						</button>
					</div>
				</section>
			)}
			<section>
				<div className="mb-1 text-xs text-ink-dim">{t("panel.compute.onboarding")}</div>
				<ul className="space-y-1">
					{onboarding.map((item) => (
						<li
							key={item.step}
							className={`flex items-center justify-between gap-2 text-xs ${statusTone(item.state)}`}
						>
							<span>
								{item.step}: {item.summary}
							</span>
							<button
								type="button"
								className="panel-action"
								onClick={() => void checkOnboardingStep(item.step)}
							>
								{t("panel.compute.check")}
							</button>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
