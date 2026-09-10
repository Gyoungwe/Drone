import { GearIcon, RefreshIcon } from "../../components/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpConfigSnapshot, McpStatus, McpServerStatus } from "@percho/shared";
import { useT } from "../../i18n";

function statusLabel(t: ReturnType<typeof useT>, status: McpServerStatus["status"]): string {
	const key = status === "needs-auth" ? "needsAuth" : status === "not-connected" ? "notConnected" : status;
	return t(`settings.mcp.${key}`);
}

function statusClass(status: McpServerStatus["status"]): string {
	if (status === "connected") return "text-success";
	if (status === "failed" || status === "needs-auth") return "text-danger";
	return "text-ink-faint";
}

export function McpPanel() {
	const t = useT();
	const [status, setStatus] = useState<McpStatus | null>(null);
	const [config, setConfig] = useState<McpConfigSnapshot | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextStatus, nextConfig] = await Promise.all([window.pi.getMcpStatus(), window.pi.getMcpConfig()]);
			setStatus(nextStatus);
			setConfig(nextConfig);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settings.mcp.error"));
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void refresh();
		return window.pi.onMcpEvent(setStatus);
	}, [refresh]);

	const serverMap = useMemo(() => new Map((status?.servers ?? []).map((server) => [server.name, server])), [status]);
	const servers = config?.servers ?? [];

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-sm font-semibold text-ink">{t("settings.mcp.title")}</h3>
					<p className="mt-1 text-xs text-ink-faint">{config?.path ?? ""}</p>
				</div>
				<div className="flex shrink-0 gap-1">
					<button type="button" className="icon-button" onClick={() => void refresh()} disabled={loading} title={t("settings.mcp.reload")}>
						<RefreshIcon size={15} className={loading ? "animate-spin" : ""} />
					</button>
					<button type="button" className="icon-button" onClick={() => void window.pi.openMcpConfig()} title={t("settings.mcp.openConfig")}>
						<GearIcon size={15} />
					</button>
				</div>
			</div>

			{error ? <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p> : null}
			{!loading && servers.length === 0 ? <p className="py-8 text-center text-sm text-ink-faint">{t("settings.mcp.empty")}</p> : null}

			<div className="space-y-2">
				{servers.map((server) => {
					const runtime = serverMap.get(server.name);
					const enabled = !server.disabled;
					return (
						<div key={server.name} className="flex items-center justify-between gap-3 border-b border-border py-3">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="truncate text-[13px] font-medium text-ink">{server.name}</span>
									<span className={`text-[11px] ${statusClass(runtime?.status ?? (enabled ? "not-connected" : "disabled"))}`}>
										{statusLabel(t, runtime?.status ?? (enabled ? "not-connected" : "disabled"))}
									</span>
								</div>
								<p className="mt-1 text-xs text-ink-faint">
									{server.transport}{runtime ? ` · ${runtime.toolCount} ${t("settings.mcp.tools")}` : ""}
								</p>
							</div>
							<button
								type="button"
								className={`icon-button ${enabled ? "text-success" : "text-ink-faint"}`}
								onClick={() => {
									void window.pi.setMcpServerEnabled(server.name, !enabled).then(setConfig).catch((err) =>
										setError(err instanceof Error ? err.message : t("settings.mcp.error")),
									);
								}}
								title={enabled ? t("settings.mcp.disable") : t("settings.mcp.enable")}
								aria-label={enabled ? t("settings.mcp.disable") : t("settings.mcp.enable")}
							>
								<GearIcon size={15} />
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
