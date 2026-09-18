import type { KnowledgeFlow, WorkbenchTask } from "@drone/shared";
import { taskArtifactLinks } from "../chat/TaskArtifactLinks";

type Artifact = NonNullable<KnowledgeFlow["artifacts"]>[number];
/** Only merge observed task files; planned acceptance paths are not outputs. */
export function mergeKnowledgeArtifacts(artifacts: Artifact[], tasks: WorkbenchTask[], cwd = ""): Artifact[] {
	const key = (path: string) => {
		let p = path.replaceAll("\\", "/");
		if (!/^(?:[a-z]:\/|\/)/i.test(p) && cwd)
			p = `${cwd.replaceAll("\\", "/").replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;
		return /^[a-z]:/i.test(p) ? p.toLowerCase() : p;
	};
	const merged = new Map<string, Artifact>();
	for (const artifact of artifacts) merged.set(artifact.path ? key(artifact.path) : artifact.key, artifact);
	for (const task of tasks)
		for (const file of taskArtifactLinks(task)) {
			const k = key(file.path);
			if (!merged.has(k))
				merged.set(k, {
					key: k,
					title: file.path.split(/[\\/]/).pop() || file.path,
					path: file.path,
					status: file.state,
					detail: "工作台记录的文件产物；不代表科学结论已核验。",
				});
		}
	return [...merged.values()];
}
