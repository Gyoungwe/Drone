import type { ComputeHost, ComputeJob } from "@drone/shared";
import { type FormEvent, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import { selectHosts, selectJobs, selectOnboarding, useComputeStore } from "../../stores/compute";

function statusTone(status: string): string {
	if (status === "healthy" || status === "succeeded" || status === "ready") return "text-emerald-600";
	if (status === "checking" || status === "running" || status === "queued") return "text-amber-600";
	if (status === "offline" || status === "failed" || status === "blocked") return "text-red-600";
	return "text-ink-dim";
}

function statusLabel(t: (key: MessageKey) => string, status: string): string {
	return t(`panel.compute.status.${status}` as MessageKey);
}

function HostRow({
	host,
	onProbe,
	onOpenTerminal,
	onRemove,
}: {
	host: ComputeHost;
	onProbe: () => void;
	onOpenTerminal: () => void;
	onRemove: () => void;
}) {
	const t = useT();
	return (
		<li className="panel-card flex flex-col gap-2" data-testid={`compute-host-${host.id}`}>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<strong className="block truncate text-[12px] text-ink">{host.displayName}</strong>
					<span className="block truncate text-[11px] text-ink-dim">{host.alias}</span>
				</div>
				<span className={`text-[11px] ${statusTone(host.health.status)}`}>
					{statusLabel(t, host.health.status)}
				</span>
			</div>
			<div className="flex items-center gap-2 text-[11px] text-ink-dim">
				<span>{host.kind}</span>
				{host.platform && <span>· {host.platform}</span>}
				{host.health.latencyMs != null && <span>· {Math.round(host.health.latencyMs)} ms</span>}
			</div>
			<div className="flex gap-2">
				<button type="button" className="panel-action" onClick={onProbe}>
					{t("panel.compute.probe")}
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
				<span className={`text-[11px] ${statusTone(job.state)}`}>{statusLabel(t, job.state)}</span>
			</div>
			<div className="text-[11px] text-ink-dim">{job.hostId}</div>
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
	const [hostForm, setHostForm] = useState({ alias: "", displayName: "", endpoint: "", user: "" });
	const terminal = useComputeStore((state) => (terminalId ? state.terminals[terminalId] : undefined));

	const startTerminal = async (host: ComputeHost) => {
		const opened = await openTerminal({ hostId: host.id, mode: "shell" });
		setTerminalId(opened.id);
	};
	const sendTerminal = async () => {
		if (!terminalId || !terminalInput) return;
		await useComputeStore.getState().writeTerminal(terminalId, `${terminalInput}\n`);
		setTerminalInput("");
	};
	const addHost = async (event: FormEvent) => {
		event.preventDefault();
		if (!hostForm.alias || !hostForm.displayName) return;
		await saveHost({
			alias: hostForm.alias,
			displayName: hostForm.displayName,
			kind: "ssh",
			...(hostForm.endpoint ? { endpoint: hostForm.endpoint } : {}),
			...(hostForm.user ? { user: hostForm.user } : {}),
		});
		setHostForm({ alias: "", displayName: "", endpoint: "", user: "" });
	};

	return (
		<div className="context-pane" data-testid="compute-pane">
			<div className="mb-2 flex items-center justify-between gap-2">
				<h3 className="text-[12px] font-medium text-ink">{t("panel.compute.title")}</h3>
				<button
					type="button"
					className="panel-action"
					onClick={() => void Promise.all([refresh(), refreshJobs(), refreshOnboarding()])}
				>
					{t("panel.compute.refresh")}
				</button>
			</div>
			{error && <p className="panel-empty text-red-600">{error}</p>}
			<section className="mb-3">
				<div className="mb-1 flex items-center justify-between text-[11px] text-ink-dim">
					<span>{t("panel.compute.hosts")}</span>
					<span>{health ? new Date(health.checkedAt).toLocaleTimeString() : "—"}</span>
				</div>
				{hosts.length ? (
					<ul className="space-y-2">
						{hosts.map((host) => (
							<HostRow
								key={host.id}
								host={host}
								onProbe={() => void probeHost(host.id)}
								onOpenTerminal={() => void startTerminal(host)}
								onRemove={() => void removeHost(host.id)}
							/>
						))}
					</ul>
				) : (
					<p className="panel-empty">{t("panel.compute.noHosts")}</p>
				)}
				<form className="mt-2 grid gap-1" onSubmit={(event) => void addHost(event)}>
					<input
						className="rounded border border-ink/20 px-2 py-1 text-[11px]"
						value={hostForm.alias}
						onChange={(event) => setHostForm((form) => ({ ...form, alias: event.target.value }))}
						placeholder={t("panel.compute.alias")}
					/>
					<input
						className="rounded border border-ink/20 px-2 py-1 text-[11px]"
						value={hostForm.displayName}
						onChange={(event) => setHostForm((form) => ({ ...form, displayName: event.target.value }))}
						placeholder={t("panel.compute.displayName")}
					/>
					<input
						className="rounded border border-ink/20 px-2 py-1 text-[11px]"
						value={hostForm.endpoint}
						onChange={(event) => setHostForm((form) => ({ ...form, endpoint: event.target.value }))}
						placeholder={t("panel.compute.endpoint")}
					/>
					<input
						className="rounded border border-ink/20 px-2 py-1 text-[11px]"
						value={hostForm.user}
						onChange={(event) => setHostForm((form) => ({ ...form, user: event.target.value }))}
						placeholder={t("panel.compute.user")}
					/>
					<button type="submit" className="panel-action">
						{t("panel.compute.addHost")}
					</button>
				</form>
			</section>
			<section className="mb-3">
				<div className="mb-1 text-[11px] text-ink-dim">{t("panel.compute.jobs")}</div>
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
					<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-ink/5 p-2 text-[11px] text-ink">
						{logsByJob[selectedJobId]?.text || t("panel.compute.noLogs")}
					</pre>
				)}
			</section>
			{terminal && (
				<section className="panel-card mb-3" data-testid="compute-terminal">
					<div className="mb-1 flex items-center justify-between text-[11px] text-ink-dim">
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
					<pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-ink/5 p-2 text-[11px] text-ink">
						{terminal.output || t("panel.compute.terminalEmpty")}
					</pre>
					<div className="mt-2 flex gap-1">
						<input
							className="min-w-0 flex-1 rounded border border-ink/20 px-2 py-1 text-[11px]"
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
				<div className="mb-1 text-[11px] text-ink-dim">{t("panel.compute.onboarding")}</div>
				<ul className="space-y-1">
					{onboarding.map((item) => (
						<li
							key={item.step}
							className={`flex items-center justify-between gap-2 text-[11px] ${statusTone(item.state)}`}
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
