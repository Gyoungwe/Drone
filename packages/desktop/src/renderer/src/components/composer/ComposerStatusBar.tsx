import { useT } from "../../i18n";
import { shortenPath } from "../../lib/short-path";
import { useSessionsStore } from "../../stores/sessions";

/** 输入框上方「主机 · 项目 · 目录」状态条（P18）。 */
export function ComposerStatusView({ host, project, dir }: { host: string; project: string; dir: string }) {
	return (
		<div className="composer-status" data-testid="composer-status">
			<span className="composer-status-host">{host}</span>
			<span aria-hidden="true">·</span>
			<span className="composer-status-project">{project}</span>
			<span aria-hidden="true">·</span>
			<span className="composer-status-dir" title={dir}>
				{dir}
			</span>
		</div>
	);
}

export function ComposerStatusBar() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	if (!cwd) return null;
	const project = cwd.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? cwd;
	return <ComposerStatusView host={t("composer.status.local")} project={project} dir={shortenPath(cwd)} />;
}
