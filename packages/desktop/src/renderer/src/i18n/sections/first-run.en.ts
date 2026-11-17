import type { zhFirstRun } from "./first-run.zh";

export const enFirstRun: typeof zhFirstRun = {
	configured: "Configured",
	startTitle: "Choose how to begin",
	startSubtitle: "Try a complete example first, or configure only the connection you need for your own work.",
	dismiss: "Got it",
	back: "Back",
	open: "Set up",
	setup: {
		title: "Connect the workspace you need",
		description:
			"Choose a knowledge base, literature library or remote compute host. You can add the others later.",
		subtitle: "Choose a connection for your current task. Other connections can be added later in Settings.",
	},
	knowledge: {
		title: "Knowledge base",
		description: "Bind an Obsidian vault so verified research records can be searched and reused.",
	},
	zotero: {
		title: "Zotero",
		description: "Connect your literature library for items, attachments and close-reading records.",
	},
	compute: {
		title: "Remote host",
		description: "Register an SSH or compute node, check its environment, then submit analyses.",
	},
	example: {
		title: "Want to see the full flow first?",
		button: "Open literature example",
	},
};
