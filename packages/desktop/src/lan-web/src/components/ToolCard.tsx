import type { UIToolCall } from "@drone/shared";
import { literatureRecoverySummary, summarizeToolArgs } from "@drone/shared";
import { ChevronRightIcon } from "./icons";

/** 与桌面端同源（shared summarizeToolArgs）：命令/路径/URL/目标优先，未知工具退化为人话摘要而非 JSON */
export const summarizeArgs = summarizeToolArgs;

const displayName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** 工具调用卡（桌面 ToolCallCard 的纯 CSS 移植版）：默认折叠，折叠态 = 名 + 参数摘要单行截断 */
export function ToolCard({ tool }: { tool: UIToolCall }) {
	const recovery =
		tool.name === "research_reconcile_literature"
			? literatureRecoverySummary(tool.output || "", navigator.language)
			: [];
	const summary = recovery.length ? recovery.slice(0, 2).join(" · ") : summarizeArgs(tool.args);
	return (
		<div className="tool-row">
			<details className="drawer-details">
				<summary className="tool-summary">
					<span
						className={`tool-state-dot${tool.state === "running" ? " running" : tool.state === "error" ? " error" : ""}`}
					/>
					<span className={`tool-name${tool.state === "running" ? " running" : ""}`}>
						{displayName(tool.name)}
					</span>
					{summary && <span className="tool-args-summary">{summary}</span>}
					<ChevronRightIcon size={12} className="tool-arrow" />
				</summary>
				<div className="tool-detail">
					{recovery.length > 0 && (
						<div role="status">
							{recovery.map((line) => (
								<p key={line}>{line}</p>
							))}
						</div>
					)}
					{tool.args && <pre>{tool.args}</pre>}
					{tool.output && <pre>{tool.output}</pre>}
				</div>
			</details>
		</div>
	);
}
