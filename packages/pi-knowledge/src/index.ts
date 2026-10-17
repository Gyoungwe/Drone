// The package entry deliberately composes the existing extension factories. The
// knowledge domain stays in @drone/knowledge and is bundled by the package build;
// this entry only provides the native-Pi registration boundary.
// @ts-nocheck

import { existsSync } from "node:fs";
import registerObsidianWorkbench from "@drone/extensions/obsidian-workbench";
import registerWorkspaceConfig from "@drone/extensions/workspace-config";
import { knowledgeDirectory, readKnowledgeBinding } from "@drone/knowledge/config";
import { currentProject } from "@drone/knowledge/extension-helpers";
import { getKnowledgeService } from "@drone/knowledge/service";

const STATUS_TOOL = "knowledge_status";

function result(details) {
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
		details,
	};
}

/**
 * Native Pi's first-run surface must be honest: no Vault binding means that
 * knowledge is unavailable, rather than an empty successful index. The full
 * existing extension remains responsible for the configured read/write tools.
 */
function registerPackageStatus(pi) {
	pi.registerTool({
		name: STATUS_TOOL,
		label: "Knowledge status",
		drone: { readOnly: true, capabilities: ["knowledge"] },
		description:
			"Report whether the application knowledge Vault is configured. When unconfigured, use /drone-init before claiming local knowledge was searched or saved.",
		parameters: { type: "object", properties: {} },
		async execute(_id, _params, _signal, _update, ctx) {
			const directory = knowledgeDirectory();
			if (!directory) return result({ status: "unconfigured", next: "/drone-init" });
			const binding = await readKnowledgeBinding();
			if (!binding || !existsSync(binding.vault))
				return result({ status: "unconfigured", next: "/drone-init" });
			const service = await getKnowledgeService(binding);
			return result({
				status: "configured",
				vault: binding.vault,
				project: await currentProject(ctx?.cwd || process.cwd(), ctx),
				index: await service.request("jobs"),
			});
		},
	});

	// Keep the package's first-run hint stable while preserving the existing
	// /obsidian-setup command and its consent/UI semantics.
	pi.registerCommand?.("drone-init", {
		description: "Initialize the Drone knowledge Vault",
		handler: async (_args, ctx) => {
			if (typeof pi.sendUserMessage === "function") {
				await pi.sendUserMessage("/obsidian-setup", { deliverAs: "followUp" });
			} else {
				ctx?.ui?.notify?.("Run /obsidian-setup to initialize the knowledge Vault", "info");
			}
		},
	});
}

export default function registerPiKnowledge(pi) {
	registerPackageStatus(pi);
	registerWorkspaceConfig(pi);
	registerObsidianWorkbench(pi);
}
