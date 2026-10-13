import type { RunOverview } from "./run-overview";

/** 运行中 / 有对话但还没有任务清单时：显示进度与产物，而不是「从示例开始」。 */
export function RunOverviewCard({
	overview,
	running,
	labels,
}: {
	overview: RunOverview;
	running: boolean;
	labels: { running: string; idle: string; tools: string; files: string; waiting: string };
}) {
	const recent = overview.stages.slice(-4);
	const current = running ? recent.length - 1 : -1;
	return (
		<section className="run-overview" data-testid="run-overview">
			<header className="run-overview-head">
				<span className={running ? "run-overview-dot live" : "run-overview-dot"} aria-hidden="true" />
				<span className="run-overview-title">{running ? labels.running : labels.idle}</span>
				<span className="run-overview-meta">{labels.tools}</span>
			</header>
			{recent.length > 0 ? (
				<ol className="run-overview-steps">
					{recent.map((stage, i) => (
						<li key={stage.id} className={i === current ? "current" : undefined}>
							{stage.text}
						</li>
					))}
				</ol>
			) : (
				<p className="run-overview-empty">{labels.waiting}</p>
			)}
			{overview.files.length > 0 && (
				<div className="run-overview-files">
					<div className="run-overview-label">{labels.files}</div>
					{overview.files.slice(0, 6).map((path) => (
						<div key={path} className="run-overview-file" title={path}>
							{path.split(/[\\/]/).pop()}
						</div>
					))}
				</div>
			)}
		</section>
	);
}
