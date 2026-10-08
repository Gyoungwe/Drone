import { readFile } from "node:fs/promises";

const sketchPath = process.argv[2] ?? "ui-preview/task-route-process-board.html";
const html = await readFile(sketchPath, "utf8");
const expectedStages = [
	"todo",
	"queued",
	"planning",
	"confirm",
	"plan_reviewing",
	"building",
	"review",
	"implement_reviewing",
	"done",
	"failed",
	"closed",
];

const stageMatches = [...html.matchAll(/data-stage="([^"]+)"/g)].map((match) => match[1]);
if (JSON.stringify(stageMatches) !== JSON.stringify(expectedStages))
	throw new Error(`stage order mismatch: ${stageMatches.join(",")}`);

const cards = [...html.matchAll(/<article class="route-card"[\s\S]*?<\/article>/g)].map((match) => match[0]);
if (cards.length < 6) throw new Error(`expected representative process cards, got ${cards.length}`);
for (const required of [
	"queued",
	"planning",
	"confirm",
	"building",
	"implement_reviewing",
	"done",
	"closed",
]) {
	if (!html.includes(`data-stage="${required}"`)) throw new Error(`missing stage ${required}`);
}
for (const required of [
	"route-queue",
	"route-plan",
	"route-confirm",
	"route-build",
	"route-accept",
	"route-done",
	"route-closed",
]) {
	if (!html.includes(`data-card-id="${required}"`)) throw new Error(`missing card ${required}`);
}
for (const card of cards) {
	for (const marker of ["data-card-id=", "data-state=", 'data-action="process"', 'data-action="task"']) {
		if (!card.includes(marker)) throw new Error(`card missing ${marker}`);
	}
}
for (const forbidden of ["TodoCard", "DecisionsSection", "TaskArtifactLinks", "审稿正文", "知识沉淀详情"]) {
	if (html.includes(forbidden)) throw new Error(`out-of-scope content leaked into sketch: ${forbidden}`);
}
if (!html.includes("task-authorization-required")) throw new Error("missing authorization exception");
if (!html.includes("binding-changed")) throw new Error("missing closed/error exception");
if (!html.includes("横向滚动") && !html.includes("overflow-x: auto"))
	throw new Error("missing horizontal board behavior");
console.log(
	`task route process board sketch checks passed: ${expectedStages.length} stages, ${cards.length} cards`,
);
