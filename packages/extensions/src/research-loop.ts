import { registerTool } from "./internal/runtime/tool-manifest";
import { describeProject, resolveWorkspaceProject, sessionEntriesOf } from "@gyoungwe/pi-knowledge/host";
import {
	literatureReceipt,
	type ResearchExtensionPorts,
	registerResearchExtension,
	sourceArchive,
} from "@gyoungwe/pi-research/host";
import { reviewResearchSummary } from "./internal/research-summary-review";
import { bindExtensionRuntime, runExtensionExclusive } from "./internal/runtime";
import { loadWorkspaceConfig, registerResearchSummaryTool } from "./workspace-config";

/** Desktop composition: workspace binding and task scheduling remain host-owned. */
export default function researchLoop(pi: any): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	bindExtensionRuntime(pi);
	const workspace = async (cwd: string) => (await loadWorkspaceConfig(cwd)) as any;
	const exclusive = <T>(key: string, work: () => Promise<T>) => runExtensionExclusive(pi, key, work);
	const ports: ResearchExtensionPorts = {
		workspace,
		resolveProject: async (cwd) => (await resolveWorkspaceProject({ cwd })).project,
		resolveSessionProject: (ctx, requested) =>
			resolveWorkspaceProject({ cwd: ctx.cwd, sessionEntries: sessionEntriesOf(ctx), requested }),
		describeProject,
		registerTool,
		reviewSummary: reviewResearchSummary,
		run: (operation) => runExtensionExclusive(pi, "research-loop", operation),
		verifyLiteratureReceipt: (input) => literatureReceipt.verifyLiteratureReceipt(input as any),
		sourceStatus: (input) =>
			sourceArchive.sourceStatus(input, {
				workspace,
				publishSourceNote: async () => {
					throw new Error("Research status cannot publish source notes");
				},
				exclusive,
			}),
	};
	const delivery = registerResearchExtension(pi, ports);
	if (delivery) registerResearchSummaryTool(pi, delivery);
}
