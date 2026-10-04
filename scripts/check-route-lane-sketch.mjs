import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const sketchPath =
	process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "/Users/gaoyangwei/test.html";
let html = fs.readFileSync(sketchPath, "utf8");
const bundled = await build({
	stdin: {
		contents: `import { processDemoState, PROCESS_DEMO_STEPS } from "./packages/shared/src/process-lanes/demo.ts";
import { estimateProcessLayout, processWirePath } from "./packages/shared/src/process-lanes/layout.ts";
import { PROCESS_LANE_EMPTY, PROCESS_LANE_LABELS, processNodeLine } from "./packages/shared/src/process-lanes/presentation.ts";
globalThis.__routeLaneShared = { processDemoState, PROCESS_DEMO_STEPS, estimateProcessLayout, processWirePath, PROCESS_LANE_EMPTY, PROCESS_LANE_LABELS, processNodeLine };`,
		sourcefile: "route-lane-shared-entry.ts",
		resolveDir: fileURLToPath(new URL("../", import.meta.url)),
	},
	bundle: true,
	format: "iife",
	platform: "neutral",
	write: false,
	logLevel: "silent",
});
const expectedBundle = bundled.outputFiles[0].text;
if (process.argv.includes("--sync")) {
	html = html.replace(
		/(<script[^>]*id="shared-projection"[^>]*>)[\s\S]*?(<\/script>)/,
		(_, open, close) => `${open}${expectedBundle.replaceAll("</script", "<\\/script")}${close}`,
	);
	fs.writeFileSync(sketchPath, html);
}
if (!html.includes('id="shared-projection"') || !html.includes('data-shared-projection="true"'))
	throw new Error("sketch does not embed the shared projection bundle");
if (!html.includes('id="route-lane-model"') || !html.includes('id="measure"'))
	throw new Error("sketch is missing the deterministic model or measurement output");

const script = (id) => {
	const match = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`));
	if (!match) throw new Error(`missing script: ${id}`);
	return match[1].replaceAll("<\\/script", "</script");
};
const context = vm.createContext({ console });
if (script("shared-projection") !== expectedBundle)
	throw new Error("shared sketch bundle is stale; rerun with --sync");
vm.runInContext(script("shared-projection"), context, { filename: `${sketchPath}#shared-projection` });
vm.runInContext(script("route-lane-model"), context, { filename: `${sketchPath}#route-lane-model` });
const model = context.__routeLaneModel;
if (!model?.report) throw new Error("sketch model did not expose report()");

for (let reveal = 0; reveal < 8; reveal++) {
	for (const width of [744, 372]) {
		const report = model.report(reveal, width);
		if (report.overlaps.length)
			throw new Error(`overlap at ${width}/${reveal}: ${report.overlaps.join(",")}`);
		if (report.overflow) throw new Error(`overflow at ${width}/${reveal}`);
		if (reveal === 5 && report.hostGateState) throw new Error("step 6 opened a host gate");
		if (reveal === 6 && report.hostGateState !== "blocked") throw new Error("step 7 lacks host gate");
		if (reveal === 7 && report.edges.includes("hostGate-doing")) throw new Error("status loops to doing");
		if (!report.nodes.includes("doing")) throw new Error(`missing doing node at ${width}/${reveal}`);
	}
}
const step6 = model.report(5, 744);
const step7 = model.report(6, 744);
if (!step6.ruleDemo || step6.taskGateState !== "open")
	throw new Error("step 6 is not the rule demo/open task gate");
if (!step7.edges.includes("doing-hostGate")) throw new Error("step 7 lacks the doing → host gate branch");
console.log("route-lane sketch checks passed: 8 steps × 2 widths");
