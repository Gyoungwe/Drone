import type { RunInspectorTurn, TurnTiming, UsageDisplayTotal } from "@drone/shared";
import { t } from "../i18n";

const compact = (n: number) =>
	n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
const seconds = (timing?: TurnTiming) =>
	timing?.endedAt ? `${((timing.endedAt - timing.startedAt) / 1000).toFixed(1)}s` : "—";

export function RunInspector({
	run,
	timing,
	usage,
}: {
	run?: RunInspectorTurn;
	timing?: TurnTiming;
	usage?: UsageDisplayTotal;
}) {
	if (!run) return null;
	const gate = run.publication.status;
	return (
		<details className="lan-run-inspector" data-testid="lan-run-inspector">
			<summary>
				<strong>{t("run.title")}</strong>
				<span>{seconds(timing)}</span>
				<span>{t("run.tools", { count: run.tools.length })}</span>
				<span>{t("run.responses", { count: run.models.reduce((n, m) => n + m.responses, 0) })}</span>
				<span className="run-expand">{t("run.expand")} ▾</span>
				<span className="run-collapse">{t("run.collapse")} ▴</span>
			</summary>
			<div className="lan-run-body">
				<section>
					<b>{t("run.models")}</b>
					<div className="run-chips">
						{run.models.length ? (
							run.models.map((m) => (
								<code key={`${m.provider}/${m.model}`}>
									{m.provider || "?"}/{m.model || "?"} · {m.responses}
								</code>
							))
						) : (
							<span>—</span>
						)}
						{usage && (
							<code>
								{compact(usage.total)} tokens ·{" "}
								{usage.cacheRate == null ? "—" : `${(usage.cacheRate * 100).toFixed(1)}% cache`}
							</code>
						)}
					</div>
				</section>
				{run.publicStages.length > 0 && (
					<section>
						<b>{t("run.stages")}</b>
						<ol>
							{run.publicStages.map((stage) => (
								<li key={stage.id || `${stage.text}:${stage.next || ""}`}>
									{stage.text}
									{stage.next ? ` → ${stage.next}` : ""}
								</li>
							))}
						</ol>
					</section>
				)}
				<section>
					<b>{t("run.toolsTitle")}</b>
					<div className="run-chips">
						{run.tools.length ? (
							run.tools.map((tool) => (
								<code key={tool.key} data-state={tool.state}>
									{tool.name} · {tool.state}
								</code>
							))
						) : (
							<span>—</span>
						)}
					</div>
				</section>
				{run.subagents.length > 0 && (
					<section>
						<b>{t("run.subagents")}</b>
						{run.subagents.map((agent) => (
							<div key={agent.key}>
								{agent.agent}
								{agent.model ? ` · ${agent.model}` : ""}
								{agent.tokens != null ? ` · ${agent.tokens.toLocaleString()} tokens` : ""} · {agent.status}
							</div>
						))}
					</section>
				)}
				{run.sourcePaths.length > 0 && (
					<section>
						<b>{t("run.sources")}</b>
						{run.sourcePaths.map((path) => (
							<code className="run-path" key={path}>
								{path}
							</code>
						))}
					</section>
				)}
				{run.artifacts.length > 0 && (
					<section>
						<b>{t("run.artifacts")}</b>
						{run.artifacts.map((path) => (
							<code className="run-path" key={path}>
								{path}
							</code>
						))}
					</section>
				)}
				{run.retrievals?.length > 0 && (
					<section data-testid="lan-run-retrievals">
						<b>{t("run.retrieval")}</b>
						{run.retrievals.map((item) => (
							<div className="run-observation" key={item.toolId}>
								<div>{item.query}</div>
								<small>
									{item.mode} · {t("run.lexical")} {item.lexicalCandidates ?? "—"} · {t("run.semantic")}{" "}
									{item.semanticCandidates ?? "—"} · {t("run.merged")} {item.mergedCandidates ?? "—"}
									{item.elapsedMs !== undefined ? ` · ${Math.round(item.elapsedMs)} ms` : ""}
								</small>
								{item.fallbackReason && (
									<div className="run-warn">
										{t("run.fallback")}: {item.fallbackReason}
									</div>
								)}
								{item.indexCoverage && (
									<small>
										{t("run.coverage")}: {item.indexCoverage}
									</small>
								)}
							</div>
						))}
					</section>
				)}
				{run.diagnostics?.length > 0 && (
					<section data-testid="lan-run-diagnostics">
						<b>{t("run.diagnostics")}</b>
						{run.diagnostics.map((item) => (
							<div
								className="run-observation run-warn"
								key={item.id || `${item.tool}:${item.status}:${item.reason}`}
							>
								<code>{item.tool}</code> · {item.status} · {item.reason}
								{item.nextAction && (
									<div>
										{t("run.next")}: {item.nextAction}
									</div>
								)}
							</div>
						))}
					</section>
				)}
				<section>
					<b>Publication gate</b>
					<div className={gate === "blocked" ? "run-warn" : undefined}>
						{gate}
						{run.publication.reason ? ` · ${run.publication.reason}` : ""}
					</div>
				</section>
				{run.skill && (
					<section>
						<b>Skill</b>
						<code>/skill:{run.skill}</code>
					</section>
				)}
				{run.errors > 0 && <div className="run-warn">{t("run.errors", { count: run.errors })}</div>}
				<small>{t("run.privateNote")}</small>
			</div>
		</details>
	);
}
