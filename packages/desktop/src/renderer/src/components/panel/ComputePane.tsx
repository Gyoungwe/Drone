import type { ComputeHost, ComputeJob } from "@drone/shared";
import { type FormEvent, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import { selectHosts, selectJobs, selectOnboarding, useComputeStore } from "../../stores/compute";
import { HostEnvironmentCard, HostPermissions } from "./HostEnvironmentCard";

function statusTone(status: string): string {
	if (status === "healthy" || status === "succeeded" || status === "ready") return "text-emerald-600";
	if (status === "checking" || status === "running" || status === "queued") return "text-amber-600";
	if (status === "offline" || status === "failed" || status === "blocked") return "text-red-600";
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
					className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-3"
					data-testid={`compute-plan-${host.id}`}
				>
					<div className="flex items-start justify-between gap-2">
						<div>
							<p className="text-[11px] font-medium uppercase tracking-[0.08em] text-accent">
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
}: {
	job: ComputeJob;
	onCancel: () => void;
	onSelect: () => void;
}) {
	const t = useT();
	return (
		<li className="panel-card flex flex-col gap-1" data-testid={`compute-job-${job.id}`}>
			<div className="flex items-center justify-between gap-2">
				<button type="button" className="truncate text-left text-[12px] text-ink" onClick={onSelect}>
					{job.label || job.id}
				</button>
				<span className={`text-xs ${statusTone(job.state)}`}>{statusLabel(t, job.state)}</span>
			</div>
			<div className="text-xs text-ink-dim">{job.hostId}</div>
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
	const [checkedHostIds, setCheckedHostIds] = useState<Set<string>>(() => new Set());
	const [previewHostId, setPreviewHostId] = useState<string | null>(null);
	const terminal = useComputeStore((state) => (terminalId ? state.terminals[terminalId] : undefined));

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
			{error && <p className="panel-empty text-red-600">{error}</p>}
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
				<form
					className="panel-card mt-3 grid gap-3 border-dashed bg-canvas/60"
					onSubmit={(event) => void addHost(event)}
				>
					<div>
						<h4 className="text-[12px] font-medium text-ink">{t("panel.compute.addHostTitle")}</h4>
						<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
							{t("panel.compute.addHostHint")}
						</p>
					</div>
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
