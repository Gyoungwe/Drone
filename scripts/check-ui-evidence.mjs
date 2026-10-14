import { readFile } from "node:fs/promises";

const files = new Map(
	await Promise.all(
		[
			["settings", "packages/desktop/src/renderer/src/components/settings/SettingsDialog.tsx"],
			["subagents", "packages/desktop/src/renderer/src/components/panel/SubagentsPane.tsx"],
			["subagents-test", "packages/desktop/src/renderer/src/components/panel/subagents-pane.test.tsx"],
			["graph-test", "packages/desktop/src/renderer/src/components/knowledge/knowledge-graph.test.ts"],
			["lan-chat-test", "packages/desktop/src/lan-web/src/components/ChatView.readonly.test.tsx"],
			["lan-composer", "packages/desktop/src/lan-web/src/components/Composer.tsx"],
			["lan-inspector", "packages/desktop/src/lan-web/src/components/RunInspector.tsx"],
			["desktop-css", "packages/desktop/src/renderer/src/styles/globals.css"],
			["lan-css", "packages/desktop/src/lan-web/src/styles.css"],
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
requireMarkers("graph-test", ["1000, 2000, 5000, 10000", "keeps a large fallback graph bounded"]);
requireMarkers("lan-chat-test", [
	"remote control off is read-only",
	"remote control on restores composer and permission approval controls",
	'not.toContain("<textarea")',
]);
requireMarkers("lan-composer", ["if (readOnly || !hasView)", 'className="composer-readonly"']);
requireMarkers("lan-inspector", ['className="lan-run-inspector"', "<details"]);
requireMarkers("desktop-css", [
	"@media (max-width: 720px)",
	"@media (max-width: 480px)",
	"prefers-reduced-motion",
]);
requireMarkers("lan-css", ["Run Inspector: compact read-only LAN mirror", "prefers-reduced-motion"]);

console.log(
	"UI P5 evidence contracts passed: settings, bounded lists/graph, LAN read-only, responsive and reduced-motion markers",
);
