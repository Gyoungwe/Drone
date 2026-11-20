import type { FrozenP5Batch, FrozenP5Bundle, P5RerunRun, P5ReviewSnapshot } from "@drone/backend";

export const P5_REVIEW_COPY = {
	"title.bundle": { zh: "插件请求写入文件", en: "Plugin wants to write files" },
	"title.batch": { zh: "插件请求运行一批计算", en: "Plugin wants to run a compute batch" },
	"title.rerun": { zh: "插件请求重新运行计算", en: "Plugin wants to rerun a computation" },
	"title.cancel": { zh: "插件请求取消计算", en: "Plugin wants to cancel a computation" },
	"field.plugin": { zh: "插件", en: "Plugin" },
	"field.root": { zh: "目标文件夹", en: "Folder" },
	"field.destination": { zh: "写入位置", en: "Destination" },
	"field.files": { zh: "文件", en: "Files" },
	"field.size": { zh: "大小", en: "Size" },
	"field.sha256": { zh: "SHA-256", en: "SHA-256" },
	"field.items": { zh: "计算项", en: "Items" },
	"field.profile": { zh: "计算环境", en: "Profile" },
	"field.image": { zh: "镜像", en: "Image" },
	"field.plan": { zh: "计算计划", en: "Plan" },
	"field.sourceRun": { zh: "源运行", en: "Source run" },
	"field.budget": { zh: "预算", en: "Budget" },
	"action.approve": { zh: "允许", en: "Approve" },
	"action.deny": { zh: "拒绝", en: "Deny" },
} as const;

export interface P5ReviewContent {
	title: string;
	summary: string;
	approve: string;
	deny: string;
}

type Text = (zh: string, en: string) => string;
type CopyKey = keyof typeof P5_REVIEW_COPY;
type TitleKey = Extract<CopyKey, `title.${string}`>;
type Field = (key: Extract<CopyKey, `field.${string}`>) => string;
type BatchPlan = FrozenP5Batch["plans"][number];

function renderReview(
	text: Text,
	title: TitleKey,
	pluginId: string,
	lines: (field: Field) => string[],
): P5ReviewContent {
	const copy = (key: CopyKey) => {
		const { zh, en } = P5_REVIEW_COPY[key];
		return text(zh, en);
	};
	return {
		title: copy(title),
		summary: [`${copy("field.plugin")}: ${pluginId}`, ...lines(copy)].join("\n"),
		approve: copy("action.approve"),
		deny: copy("action.deny"),
	};
}

function fileLines(field: Field, files: readonly { path: string; bytes: number; sha256: string }[]) {
	return [
		`${field("field.files")}:`,
		...files.flatMap(({ path, bytes, sha256 }) => [
			`  ${path}`,
			`    ${field("field.size")}: ${bytes}`,
			`    ${field("field.sha256")}: ${sha256}`,
		]),
	];
}

function budgetLines(field: Field, budget: BatchPlan["budget"], indent = "") {
	const { maxTokens, maxCost, timeoutMs, maxOutputBytes } = budget;
	return [
		`${indent}${field("field.budget")}:`,
		`${indent}  maxTokens: ${maxTokens}`,
		...(maxCost === null ? [] : [`${indent}  maxCost: ${maxCost}`]),
		`${indent}  timeoutMs: ${timeoutMs}`,
		`${indent}  maxOutputBytes: ${maxOutputBytes}`,
	];
}

function batchItemLines(field: Field, plan: BatchPlan) {
	const { itemId, profile, image, preflightRef, preflightSha256, budget } = plan;
	const preflight = [preflightRef, preflightSha256].filter((value) => value !== null);
	const lines = [`  ${itemId}`, `    ${field("field.profile")}: ${profile}`];
	if (image !== null) lines.push(`    ${field("field.image")}: ${image}`);
	if (preflight.length === 2) lines.push(`    ${field("field.plan")}: ${preflight[0]} (${preflight[1]})`);
	else if (preflight.length === 1) lines.push(`    ${field("field.plan")}: ${preflight[0]}`);
	return [...lines, ...budgetLines(field, budget, "    ")];
}

export function buildP5BundleReviewContent(
	pluginId: string,
	bundle: FrozenP5Bundle,
	root: string,
	text: Text,
): P5ReviewContent {
	return renderReview(text, "title.bundle", pluginId, (field) => [
		`${field("field.root")}: ${root}`,
		`${field("field.destination")}: ${bundle.target.destination} (${bundle.target.audience})`,
		...fileLines(field, bundle.request.files),
	]);
}

export function buildP5BatchReviewContent(
	pluginId: string,
	batch: FrozenP5Batch,
	text: Text,
): P5ReviewContent {
	return renderReview(text, "title.batch", pluginId, (field) => [
		`${field("field.items")}:`,
		...batch.plans.flatMap((plan) => batchItemLines(field, plan)),
	]);
}

export function buildP5RerunReviewContent(
	pluginId: string,
	{ plan, source }: P5ReviewSnapshot,
	text: Text,
): P5ReviewContent {
	return renderReview(text, "title.rerun", pluginId, (field) => [
		`${field("field.sourceRun")}:`,
		`  ${source.runId}`,
		`  ${source.sourceRunReceiptRef}`,
		`  ${source.artifactId}`,
		...(source.verifiedSha256 === null ? [] : [`  ${field("field.sha256")}: ${source.verifiedSha256}`]),
		`${field("field.profile")}: ${plan.profile}`,
		`${field("field.image")}: ${plan.image}`,
		`${field("field.plan")}: ${plan.preflightRef} (${plan.sha256})`,
		`${field("field.root")}: ${plan.collectionRoot}`,
		...fileLines(field, plan.expected),
		...budgetLines(field, plan.budget),
	]);
}

export function buildP5RerunCancelReviewContent(
	pluginId: string,
	{ source }: P5RerunRun,
	text: Text,
): P5ReviewContent {
	return renderReview(text, "title.cancel", pluginId, (field) => [
		`${field("field.sourceRun")}:`,
		`  ${source.runId}`,
		`  ${source.sourceRunReceiptRef}`,
		`${field("field.profile")}: ${source.profile}`,
	]);
}

export function buildP5BatchCancelReviewContent(
	pluginId: string,
	batch: FrozenP5Batch,
	text: Text,
): P5ReviewContent {
	return renderReview(text, "title.cancel", pluginId, (field) => [
		`${field("field.items")}:`,
		...batch.plans.flatMap(({ itemId, profile }) => [
			`  ${itemId}`,
			`    ${field("field.profile")}: ${profile}`,
		]),
	]);
}
