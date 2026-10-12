import { formatBytes, type HostEnvironment, usagePercent } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n";

function Meter({ label, percent, detail }: { label: string; percent: number | null; detail: string }) {
	return (
		<div className="host-env-meter">
			<div className="host-env-meter-head">
				<span>{label}</span>
				<span className="font-mono">{percent == null ? "—" : `${percent}%`}</span>
			</div>
			<div className="host-env-bar">
				<span style={{ width: `${percent ?? 0}%` }} />
			</div>
			<div className="host-env-meter-detail">{detail}</div>
		</div>
	);
}

/** 本机环境（P10）：概览 + 环境探测。只读，数据来自 main 侧固定命令。 */
export function HostEnvironmentView({
	env,
	loading,
	onRefresh,
}: {
	env: HostEnvironment | null;
	loading: boolean;
	onRefresh: () => void;
}) {
	const t = useT();
	const rows: Array<[string, string]> = env
		? [
				[t("panel.hostEnv.os"), env.os],
				[t("panel.hostEnv.kernel"), env.kernel],
				[t("panel.hostEnv.arch"), env.arch],
				...env.tools.map((tool): [string, string] => [
					tool.label,
					tool.version ?? t("panel.hostEnv.missing"),
				]),
				[t("panel.hostEnv.pythonPackages"), env.pythonPackages == null ? "—" : String(env.pythonPackages)],
				[t("panel.hostEnv.npmPackages"), env.npmPackages == null ? "—" : String(env.npmPackages)],
			]
		: [];
	return (
		<section className="mb-4 host-env" data-testid="host-env">
			<div className="mb-2 flex items-end justify-between gap-2">
				<div>
					<h4 className="text-[12px] font-medium text-ink">{t("panel.hostEnv.title")}</h4>
					<p className="mt-0.5 text-[11px] text-ink-faint">{env ? env.hostname : t("panel.hostEnv.hint")}</p>
				</div>
				<button type="button" className="panel-action" onClick={onRefresh} disabled={loading}>
					{loading ? t("panel.hostEnv.probing") : t("panel.hostEnv.probe")}
				</button>
			</div>
			{env && (
				<>
					<div className="host-env-meters">
						<Meter
							label="CPU"
							percent={env.cpu.loadPercent}
							detail={`${env.cpu.cores} ${t("panel.hostEnv.cores")} · ${env.cpu.model}`}
						/>
						<Meter
							label={t("panel.hostEnv.memory")}
							percent={usagePercent(env.memory.totalBytes, env.memory.freeBytes)}
							detail={`${formatBytes(env.memory.totalBytes - env.memory.freeBytes)} / ${formatBytes(env.memory.totalBytes)}`}
						/>
						<Meter
							label={t("panel.hostEnv.disk")}
							percent={env.disk ? usagePercent(env.disk.totalBytes, env.disk.freeBytes) : null}
							detail={
								env.disk
									? `${formatBytes(env.disk.freeBytes)} ${t("panel.hostEnv.free")} / ${formatBytes(env.disk.totalBytes)}`
									: "—"
							}
						/>
					</div>
					<dl className="host-env-table">
						{rows.map(([k, v]) => (
							<div key={k}>
								<dt>{k}</dt>
								<dd className="font-mono">{v}</dd>
							</div>
						))}
					</dl>
				</>
			)}
		</section>
	);
}

export function HostEnvironmentCard() {
	const [env, setEnv] = useState<HostEnvironment | null>(null);
	const [loading, setLoading] = useState(false);
	const refresh = useCallback(() => {
		setLoading(true);
		window.pi
			.hostEnvironment()
			.then(setEnv, () => setEnv(null))
			.finally(() => setLoading(false));
	}, []);
	useEffect(() => refresh(), [refresh]);
	return <HostEnvironmentView env={env} loading={loading} onRefresh={refresh} />;
}

/** 主机 · 设置：只读权限展示（不提供编辑，编辑仍走登记表单）。 */
export function HostPermissions({
	authState,
	managed,
	capabilities,
	workspaceRoot,
	defaultOpen = false,
}: {
	authState: string;
	managed: boolean;
	capabilities: string[];
	workspaceRoot?: string;
	defaultOpen?: boolean;
}) {
	const t = useT();
	return (
		<details className="host-perms" open={defaultOpen}>
			<summary>{t("panel.hostEnv.permissions")}</summary>
			<dl className="host-env-table">
				<div>
					<dt>{t("panel.hostEnv.auth")}</dt>
					<dd>{authState}</dd>
				</div>
				<div>
					<dt>{t("panel.hostEnv.managed")}</dt>
					<dd>{managed ? t("panel.hostEnv.yes") : t("panel.hostEnv.no")}</dd>
				</div>
				<div>
					<dt>{t("panel.hostEnv.scope")}</dt>
					<dd className="font-mono">{workspaceRoot || "—"}</dd>
				</div>
				<div>
					<dt>{t("panel.hostEnv.capabilities")}</dt>
					<dd>{capabilities.length ? capabilities.join(", ") : "—"}</dd>
				</div>
			</dl>
		</details>
	);
}
