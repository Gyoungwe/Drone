import { GearIcon, RefreshIcon } from "../../components/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpConfigSnapshot, McpStatus, McpServerStatus } from "@percho/shared";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { Switch } from "../ui/Switch";

function statusLabel(t: ReturnType<typeof useT>, status: McpServerStatus["status"]): string {
	const key = status === "needs-auth" ? "needsAuth" : status === "not-connected" ? "notConnected" : status;
	return t(`settings.mcp.${key}`);
}

function statusTone(status: McpServerStatus["status"]): string {
	if (status === "connected") return "bg-success/10 text-success";
	if (status === "failed" || status === "needs-auth") return "bg-danger/10 text-danger";
	return "bg-hover text-ink-faint";
}

export function McpPanel() {
	const t = useT();
	const cwd = useSessionsStore((state) => state.cwd);
	const [status, setStatus] = useState<McpStatus | null>(null);
	const [config, setConfig] = useState<McpConfigSnapshot | null>(null);
	const [loading, setLoading] = useState(true);
	const [pendingServer, setPendingServer] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextStatus, nextConfig] = await Promise.all([
				window.pi.getMcpStatus(cwd ?? undefined),
				window.pi.getMcpConfig(cwd ?? undefined),
			]);
			setStatus(nextStatus);
			setConfig(nextConfig);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settings.mcp.error"));
		} finally {
			setLoading(false);
		}
	}, [cwd, t]);

	useEffect(() => {
		void refresh();
		return window.pi.onMcpEvent((event) => {
			if (event.cwd === cwd) setStatus(event.status);
		});
	}, [cwd, refresh]);

	const serverMap = useMemo(() => new Map((status?.servers ?? []).map((server) => [server.name, server])), [status]);
	const servers = config?.servers ?? [];

	return (
		<div>
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 className="text-[13px] font-medium text-ink">{t("settings.mcp.title")}</h3>
					<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{t("settings.mcp.hint")}</p>
				</div>
				<button type="button" className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-hover hover:text-ink" onClick={() => void refresh()} disabled={loading} title={t("settings.mcp.reload")}>
					<RefreshIcon size={15} className={loading ? "animate-spin" : ""} />
				</button>
			</div>

			<div className="mt-4 grid grid-cols-3 gap-2">
				<div className="rounded-lg bg-hover/70 px-3 py-2.5">
					<p className="text-[10px] text-ink-faint">{t("settings.mcp.servers")}</p>
					<p className="mt-0.5 text-[16px] font-medium tabular-nums text-ink">{servers.length}</p>
				</div>
				<div className="rounded-lg bg-hover/70 px-3 py-2.5">
					<p className="text-[10px] text-ink-faint">{t("settings.mcp.connected")}</p>
					<p className="mt-0.5 text-[16px] font-medium tabular-nums text-ink">{status?.connectedCount ?? 0}</p>
				</div>
				<div className="rounded-lg bg-hover/70 px-3 py-2.5">
					<p className="text-[10px] text-ink-faint">{t("settings.mcp.tools")}</p>
					<p className="mt-0.5 text-[16px] font-medium tabular-nums text-ink">{status?.totalTools ?? 0}</p>
				</div>
			</div>

			{error ? <p className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[11px] text-danger">{error}</p> : null}

			<div className="mt-5">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<p className="text-[12px] font-medium text-ink-2">{t("settings.mcp.configPath")}</p>
						<p className="mt-0.5 truncate font-mono text-[10px] text-ink-faint" title={config?.path ?? ""}>{config?.path ?? t("settings.mcp.noConfig")}</p>
					</div>
					<button type="button" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover" onClick={() => void window.pi.openMcpConfig(cwd ?? undefined)}>
						<GearIcon size={13} /> {t("settings.mcp.openConfig")}
					</button>
				</div>
			</div>

			<div className="mt-5">
				<div className="flex items-center justify-between">
					<h4 className="text-[12px] font-medium text-ink-2">{t("settings.mcp.serverList")}</h4>
					{loading ? <span className="text-[10px] text-ink-faint">{t("settings.loading")}</span> : null}
				</div>
				{!loading && servers.length === 0 ? (
					<div className="mt-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
						<p className="text-[13px] text-ink-dim">{t("settings.mcp.empty")}</p>
						<p className="mt-1 text-[11px] text-ink-faint">{t("settings.mcp.emptyHint")}</p>
					</div>
				) : (
					<div className="mt-2 overflow-hidden rounded-xl border border-border">
						{servers.map((server, index) => {
							const runtime = serverMap.get(server.name);
							const enabled = !server.disabled;
							const displayStatus = enabled ? (runtime?.status ?? "not-connected") : "disabled";
							return (
								<div key={server.name} className={`flex items-center gap-3 px-3 py-3 ${index > 0 ? "border-t border-border" : ""}`}>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span className="truncate text-[13px] font-medium text-ink">{server.name}</span>
											<span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${statusTone(displayStatus)}`}>{statusLabel(t, displayStatus)}</span>
										</div>
										<div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-ink-faint">
											<span className={server.scope === "project" ? "rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent" : "rounded bg-hover px-1.5 py-0.5 text-ink-2"}>{t(`settings.mcp.scope.${server.scope}`)}</span>
											<span>{server.transport}</span>
											{runtime ? <><span>·</span><span>{runtime.toolCount} {t("settings.mcp.tools")}</span></> : null}
										</div>
										<p className="mt-1 truncate font-mono text-[9px] text-ink-faint/80" title={server.sourcePath}>{server.sourcePath}</p>
									</div>
									<Switch
						checked={enabled}
						disabled={pendingServer === server.name}
						onCheckedChange={(next) => {
							setPendingServer(server.name);
							setError(null);
							void window.pi
								.setMcpServerEnabled(server.name, next, cwd ?? undefined)
								.then(async (nextConfig) => {
									setConfig(nextConfig);
									const nextStatus = await window.pi.getMcpStatus(cwd ?? undefined);
									setStatus(nextStatus);
								})
								.catch((err) => setError(err instanceof Error ? err.message : t("settings.mcp.error")))
								.finally(() => setPendingServer(null));
						}}
						aria-label={enabled ? t("settings.mcp.disable") : t("settings.mcp.enable")}
					/>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
