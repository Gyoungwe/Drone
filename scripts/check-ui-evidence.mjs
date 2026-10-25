import { readFile } from "node:fs/promises";

const files = new Map(
	await Promise.all(
		[
			["settings", "packages/desktop/src/renderer/src/components/settings/SettingsDialog.tsx"],
			["subagents", "packages/desktop/src/renderer/src/components/panel/SubagentsPane.tsx"],
			["subagents-test", "packages/desktop/src/renderer/src/components/panel/subagents-pane.test.tsx"],
			[
				"knowledge-mount-test",
				"packages/desktop/src/renderer/src/components/knowledge/KnowledgeView.test.tsx",
			],
			["desktop-css", "packages/desktop/src/renderer/src/styles/globals.css"],
		].map(async ([key, path]) => [key, await readFile(path, "utf8")]),
	),
);

const requireMarkers = (name, markers) => {
	const source = files.get(name);
	for (const marker of markers) {
		if (!source.includes(marker)) throw new Error(`${name}: missing marker ${marker}`);
	}
};

requireMarkers("settings", [
	'role="dialog"',
	"max-h-[calc(100dvh-24px)]",
	'event.key === "Tab"',
	'event.key === "Escape"',
	"previousFocusRef.current?.focus()",
]);
requireMarkers("subagents", [
	"const RUNS_PAGE_SIZE = 100",
	"const visibleRuns = shown.slice",
	'data-testid="subagents-pagination"',
]);
requireMarkers("subagents-test", [
	"Array.from({ length: 1000 }",
	"toHaveLength(100)",
	"panel.subagents.runsPage:1,100,1000",
]);
requireMarkers("knowledge-mount-test", [
	"keeps only binding and navigation",
	"falls back after render failure",
	"previous workspace binding",
]);
requireMarkers("desktop-css", [
	"@media (max-width: 720px)",
	"@media (max-width: 480px)",
	"prefers-reduced-motion",
]);

console.log(
	"UI evidence contracts passed: settings, bounded lists and plugin lifecycle, responsive and reduced-motion markers",
);
