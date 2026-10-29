import { localResourceHref, type WorkbenchTask } from "@drone/shared";

/** Published UI API 1.x compatibility only; remove with API 2 after old consumers retire. */
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
