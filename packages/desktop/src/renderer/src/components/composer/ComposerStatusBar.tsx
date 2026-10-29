import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { shortenPath } from "../../lib/short-path";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { RunStatusStrip } from "./RunStatusStrip";

/** 输入框上方「主机 · 项目 · 目录」状态条（P18），新会话载入了观察记忆时附「已载入 N 条记忆」。 */
export function ComposerStatusView({
	host,
	project,
	dir,
	memory,
}: {
	host: string;
	project: string;
	dir: string;
	memory?: string | null;
}) {
	return (
		<div className="composer-status" data-testid="composer-status">
			<span className="composer-status-host">{host}</span>
			<span aria-hidden="true">·</span>
			<span className="composer-status-project">{project}</span>
			<span aria-hidden="true">·</span>
			<span className="composer-status-dir" title={dir}>
				{dir}
			</span>
			{memory && (
				<>
					<span aria-hidden="true">·</span>
					<span className="composer-status-memory" data-testid="composer-status-memory">
						{memory}
					</span>
				</>
			)}
		</div>
	);
}

export function ComposerStatusBar({ pendingAsks = 0 }: { pendingAsks?: number }) {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const sessionId = useSessionsStore((s) => s.activeSessionId);
	const active = useTranscriptStore((s) => selectTranscript(s, sessionId)?.agentActive ?? false);
	const extensionStatuses = useTranscriptStore((s) => selectTranscript(s, sessionId).extensionStatuses);
	const [loaded, setLoaded] = useState(0);
	// 记忆在每个会话首轮开始时载入：工作目录切换或一轮开始/结束时刷新。
	// biome-ignore lint/correctness/useExhaustiveDependencies: active 只用作刷新触发
	useEffect(() => {
		if (!cwd) return;
		let live = true;
		window.pi
			.memoryGetStatus(cwd)
			.then((status) => live && setLoaded(status.enabled ? status.lastLoaded : 0))
			.catch(() => live && setLoaded(0));
		return () => {
			live = false;
		};
	}, [cwd, active]);
	if (!cwd) return null;
	const project = cwd.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? cwd;
	return (
		<div className="composer-status-line" data-testid="composer-status-line">
			<ComposerStatusView
				host={t("composer.status.local")}
				project={project}
				dir={shortenPath(cwd)}
				memory={loaded > 0 ? t("composer.status.memoryLoaded", { count: loaded }) : null}
			/>
			{Object.entries(extensionStatuses).map(([key, text]) => (
				<span key={key} role="status" aria-label={t("composer.status.extension")} title={key}>
					{text}
				</span>
			))}
			<RunStatusStrip sessionId={sessionId} pendingAsks={pendingAsks} embedded />
		</div>
	);
}
