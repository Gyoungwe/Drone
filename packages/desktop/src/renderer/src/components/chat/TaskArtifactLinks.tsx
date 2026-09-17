import { localResourceHref, type WorkbenchTask } from "@drone/shared";
import { useSessionsStore } from "../../stores/sessions";
import { useUiStore } from "../../stores/ui";

/** Use observed artifacts, not proposed acceptance paths or model-authored prose. */
export function taskArtifactLinks(task: WorkbenchTask) {
	const byPath = new Map<string, { path: string; href: string; state: string }>();
	const add = (path: string | undefined, state: string) => {
		if (!path) return;
		const href = localResourceHref(path);
		if (!href) return;
		const normalized = path.replaceAll("\\", "/");
		byPath.set(/^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized, { path, href, state });
	};
	for (const m of task.milestones)
		if (m.state === "completed" && m.evidence?.kind === "file-observed") add(m.evidence.path, "observed");
	for (const op of task.operations)
		if (
			op.artifact &&
			!(op.artifact as { intentOnly?: boolean }).intentOnly &&
			!["started", "failed"].includes(op.state)
		)
			add(op.artifact.path, op.state);
	return [...byPath.values()];
}
export function TaskArtifactLinks({ task, sessionId }: { task: WorkbenchTask; sessionId: string | null }) {
	const cwd = useSessionsStore(
		(s) =>
			s.sessions.find((session) => session.sessionId === sessionId)?.cwd ??
			(s.activeSessionId === sessionId ? s.cwd : undefined),
	);
	const open = useUiStore((s) => s.openResourcePreview);
	const files = taskArtifactLinks(task);
	if (!files.length) return null;
	return (
		<div className="mt-2 flex flex-wrap gap-2 text-xs" data-testid="task-artifacts">
			{files.slice(0, 6).map((file) => (
				<a
					key={file.href}
					href={file.href}
					className="max-w-full break-all rounded border border-border px-2 py-1 underline underline-offset-2 hover:bg-hover"
					title={!cwd && file.href.startsWith("./") ? "请先打开产物所属会话" : file.path}
					aria-disabled={!cwd && file.href.startsWith("./")}
					onClick={(e) => {
						e.preventDefault();
						if (!cwd && file.href.startsWith("./")) return;
						open({ href: file.href, label: file.path.split(/[\\/]/).pop(), cwd: cwd ?? undefined });
					}}
				>
					{file.path.split(/[\\/]/).pop()} ·{" "}
					{file.state === "changed"
						? "文件已变化，预览当前版本"
						: file.state === "not-found"
							? "文件待重新定位"
							: "侧栏预览"}
				</a>
			))}
			{files.length > 6 && <span>另有 {files.length - 6} 个产物，见详细记录</span>}
		</div>
	);
}
