import type { RunInspectorTurn, TurnTiming, UsageDisplayTotal } from "@drone/shared";
import { useI18nStore } from "../../i18n";

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
	const zh = useI18nStore((s) => s.language) === "zh";
	if (!run) return null;
	const gate =
		run.publication.status === "passed"
			? zh
				? "通过"
				: "passed"
			: run.publication.status === "blocked"
				? zh
					? "阻塞"
					: "blocked"
				: run.publication.status === "checked"
					? zh
						? "已检查"
						: "checked"
					: zh
						? "未运行"
						: "not run";
	return (
		<details
			className="mt-2 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-[11px] text-ink-dim"
			data-testid="run-inspector"
		>
			<summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
				<span className="font-medium text-ink-2">{zh ? "Run Inspector" : "Run Inspector"}</span>
				<span>{seconds(timing)}</span>
				<span>
					{run.tools.length} {zh ? "个工具" : "tools"}
				</span>
				<span>
					{run.models.reduce((n, m) => n + m.responses, 0)} {zh ? "次模型响应" : "model responses"}
				</span>
				<span className="ml-auto text-ink-faint">{zh ? "展开" : "Expand"} ▾</span>
			</summary>
			<div className="mt-2 grid gap-2 border-t border-border pt-2">
				<section>
					<p className="font-medium text-ink-2">{zh ? "主模型" : "Main model"}</p>
					<div className="mt-1 flex flex-wrap gap-1.5">
						{run.models.length ? (
							run.models.map((m) => (
								<span
									key={`${m.provider}/${m.model}`}
									className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10px]"
								>
									{m.provider || "?"}/{m.model || "?"} · {m.responses}
								</span>
							))
						) : (
							<span>—</span>
						)}
						{usage && (
							<span className="rounded bg-hover px-1.5 py-0.5">
								{compact(usage.total)} tokens ·{" "}
								{usage.cacheRate == null ? "—" : `${(usage.cacheRate * 100).toFixed(1)}% cache`}
							</span>
						)}
					</div>
				</section>
				{run.publicStages.length > 0 && (
					<section>
						<p className="font-medium text-ink-2">{zh ? "公开阶段摘要" : "Public stages"}</p>
						<ol className="mt-1 list-decimal space-y-1 pl-4">
							{run.publicStages.map((stage) => (
								<li key={stage.id || `${stage.text}:${stage.next || ""}`}>
									<span className="text-ink">{stage.text}</span>
									{stage.next ? <span className="text-ink-faint"> → {stage.next}</span> : null}
								</li>
							))}
						</ol>
					</section>
				)}
				<section>
					<p className="font-medium text-ink-2">{zh ? "工具" : "Tools"}</p>
					<div className="mt-1 flex flex-wrap gap-1.5">
						{run.tools.length ? (
							run.tools.map((tool) => (
								<span
									key={tool.key}
									className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${tool.state === "error" ? "bg-err/10 text-err" : "bg-hover"}`}
								>
									{tool.name} · {tool.state}
								</span>
							))
						) : (
							<span>—</span>
						)}
					</div>
				</section>
				{run.subagents.length > 0 && (
					<section>
						<p className="font-medium text-ink-2">{zh ? "子智能体" : "Subagents"}</p>
						<div className="mt-1 space-y-1">
							{run.subagents.map((agent) => (
								<div key={agent.key} className="rounded bg-hover px-2 py-1">
									<span className="font-medium text-ink">{agent.agent}</span>
									{agent.model ? ` · ${agent.model}` : ""}
									{agent.tokens != null ? ` · ${agent.tokens.toLocaleString()} tokens` : ""} · {agent.status}
								</div>
							))}
						</div>
					</section>
				)}
				{run.sourcePaths.length > 0 && (
					<section>
						<p className="font-medium text-ink-2">{zh ? "本轮实际读取路径" : "Observed read paths"}</p>
						<div className="mt-1 space-y-1">
							{run.sourcePaths.slice(0, 12).map((path) => (
								<div key={path} className="break-all font-mono text-[10px] text-ink-faint">
									{path}
								</div>
							))}
						</div>
					</section>
				)}
				{run.artifacts.length > 0 && (
					<section>
						<p className="font-medium text-ink-2">{zh ? "产物" : "Artifacts"}</p>
						{run.artifacts.map((path) => (
							<div key={path} className="break-all font-mono text-[10px] text-ink-faint">
								{path}
							</div>
						))}
					</section>
				)}
				{run.retrievals?.length > 0 && (
					<section data-testid="run-retrievals">
						<p className="font-medium text-ink-2">{zh ? "知识检索" : "Knowledge retrieval"}</p>
						<div className="mt-1 space-y-2">
							{run.retrievals.map((item) => (
								<div key={item.toolId} className="rounded bg-hover px-2 py-1.5">
									<p className="break-words text-ink">{item.query}</p>
									<p className="mt-1 tabular-nums">
										{item.mode} · {zh ? "词法候选" : "Lexical"} {item.lexicalCandidates ?? "—"} ·{" "}
										{zh ? "语义候选" : "Semantic"} {item.semanticCandidates ?? "—"} ·{" "}
										{zh ? "合并候选" : "Merged"} {item.mergedCandidates ?? "—"}
										{item.elapsedMs !== undefined ? ` · ${Math.round(item.elapsedMs)} ms` : ""}
									</p>
									{item.fallbackReason && (
										<p className="mt-1 break-words text-warn">
											{zh ? "词法降级原因" : "Lexical fallback"}: {item.fallbackReason}
										</p>
									)}
									{item.indexCoverage && (
										<p>
											{zh ? "语义索引覆盖" : "Semantic coverage"}: {item.indexCoverage}
										</p>
									)}
								</div>
							))}
						</div>
					</section>
				)}
				{run.diagnostics?.length > 0 && (
					<section data-testid="run-diagnostics">
						<p className="font-medium text-ink-2">
							{zh ? "停止、跳过与错误原因" : "Stops, skips and errors"}
						</p>
						<div className="mt-1 space-y-1">
							{run.diagnostics.map((item) => (
								<div
									key={item.id || `${item.tool}:${item.status}:${item.reason}`}
									className="break-words rounded bg-warn/5 px-2 py-1"
								>
									<p>
										<code>{item.tool}</code> · {item.status} · {item.reason}
									</p>
									{item.nextAction && (
										<p className="mt-1 text-ink-2">
											{zh ? "下一步" : "Next"}: {item.nextAction}
										</p>
									)}
								</div>
							))}
						</div>
					</section>
				)}
				<section>
					<p className="font-medium text-ink-2">Publication gate</p>
					<p className={run.publication.status === "blocked" ? "mt-1 text-warn" : "mt-1"}>
						{gate}
						{run.publication.reason ? ` · ${run.publication.reason}` : ""}
					</p>
				</section>
				{run.skill && (
					<section>
						<p className="font-medium text-ink-2">Skill</p>
						<code className="text-[10px]">/skill:{run.skill}</code>
					</section>
				)}
				{run.errors > 0 && (
					<p className="text-warn">
						{zh ? `本轮 ${run.errors} 个错误卡` : `${run.errors} error card(s) in this turn`}
					</p>
				)}
				<p className="text-[10px] text-ink-faint">
					{zh
						? "这里展示可观察的公开摘要、工具和回执，不展示模型私有思考链。"
						: "Shows observable public summaries, tools and receipts; private chain-of-thought is not displayed."}
				</p>
			</div>
		</details>
	);
}
