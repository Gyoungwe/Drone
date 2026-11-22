import { createHash } from "node:crypto";
import {
	type FrozenP5Batch,
	freezeP5Batch,
	freezeP5Bundle,
	type P5RerunRun,
	type P5ReviewSnapshot,
} from "@drone/backend";
import { contractContentHash } from "@drone/shared";
import { BatchInput } from "@gyoungwe/plugin-api/p5-discovery";
import { FileReadback } from "@gyoungwe/plugin-api/p5-receipts";
import { Check } from "typebox/value";
import { expect, it } from "vitest";
import {
	buildP5ApprovalReviewContent,
	buildP5BatchCancelReviewContent,
	buildP5BatchReviewContent,
	buildP5BundleReviewContent,
	buildP5ByteStageOpenReviewContent,
	buildP5ByteWriteReviewContent,
	buildP5RerunCancelReviewContent,
	buildP5RerunReviewContent,
	P5_REVIEW_COPY,
} from "./p5-review-content";

const plugin = "example.plugin";
const en = (_zh: string, english: string) => english;
const zh = (chinese: string) => chinese;
const scope = {
	workspaceId: "example-workspace",
	sessionId: "example-session",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const bundleTarget = { destination: "reports/demo", audience: "public" } as const;

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function bundleFile(path: string, text: string) {
	return {
		path,
		mediaType: "application/json",
		source: { kind: "text", text },
		bytes: Buffer.byteLength(text),
		sha256: sha256(text),
	} as const;
}

function longPath(index: number) {
	return [...Array.from({ length: 4 }, () => "x".repeat(254)), String(index).padStart(4, "0")].join("/");
}

function freezeBatch(items: BatchInput["items"], plans: Parameters<typeof freezeP5Batch>[1]): FrozenP5Batch {
	const request: BatchInput = {
		requestId: "batch-example",
		plan: {
			kind: "evaluation",
			runId: "evaluation-example",
			cases: items.map(({ id }) => ({
				id,
				metric: "rediscovery-rate",
				datasetId: "demo-dataset",
				datasetRevision: "v1",
				datasetStatus: "fixture",
				description: "Demo case",
			})),
		},
		items,
	};
	expect(Check(BatchInput, request)).toBe(true);
	return freezeP5Batch(request, plans, scope);
}

function rerunSnapshot(expected: P5ReviewSnapshot["plan"]["expected"]): P5ReviewSnapshot {
	const source = {
		runId: "source-run",
		sourceRunReceiptRef: "source-receipt",
		workspaceId: scope.workspaceId,
		artifactId: "source-artifact",
		verifiedSha256: sha256("input"),
		profile: "local",
	};
	const planBody = {
		scope,
		profile: source.profile,
		image: `example.invalid/compute@sha256:${sha256("image")}`,
		spec: { jobId: "rerun-job", hostAlias: "local", workflow: { name: "demo", version: "1" } },
		collectionRoot: "/outputs/rerun",
		expected,
		budget: { maxTokens: 0, maxCost: 0, timeoutMs: 1500, maxOutputBytes: 8192 },
	};
	const plan = { ...planBody, preflightRef: "rerun-plan", sha256: contractContentHash(planBody) };
	return {
		scope,
		plan,
		source,
		request: {
			requestId: "rerun-request",
			sourceRunReceiptRef: source.sourceRunReceiptRef,
			artifactId: source.artifactId,
			expectedSha256: source.verifiedSha256,
			profile: plan.profile,
			preflightRef: plan.preflightRef,
			budget: plan.budget,
		},
	};
}

it("uses exactly the approved bilingual copy", () => {
	expect(P5_REVIEW_COPY).toStrictEqual({
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
	});
});

it("renders the whole bundle, including the exact selected folder, destination and audience", () => {
	const root = `/exports/${longPath(0)}`;
	const files = [bundleFile(longPath(1), '{"value":1}'), bundleFile(longPath(2), '{"value":"样例"}')];
	const bundle = freezeP5Bundle({ requestId: "bundle-limit", files }, bundleTarget, scope);
	expect(root.length).toBeGreaterThan(1000);
	expect(files.map((file) => file.path.length)).toEqual([1024, 1024]);
	const english = buildP5BundleReviewContent(plugin, bundle, root, en);
	expect(english).toStrictEqual({
		title: "Plugin wants to write files",
		summary: [
			`Plugin: example.plugin\nFolder: ${root}\nDestination: reports/demo (public)\nFiles:`,
			...files.map((file) => `  ${file.path}\n    Size: ${file.bytes}\n    SHA-256: ${file.sha256}`),
		].join("\n"),
		approve: "Approve",
		deny: "Deny",
	});
	expect(english.summary).not.toMatch(/…|\.\.\./);
	expect(buildP5BundleReviewContent(plugin, bundle, root, en)).toStrictEqual(english);
});

it("uses only the chosen language for a small bundle review", () => {
	const file = bundleFile("report.json", "{}");
	const bundle = freezeP5Bundle({ requestId: "bundle-example", files: [file] }, bundleTarget, scope);
	expect(buildP5BundleReviewContent(plugin, bundle, "/exports/demo", zh)).toStrictEqual({
		title: "插件请求写入文件",
		summary: `插件: example.plugin\n目标文件夹: /exports/demo\n写入位置: reports/demo (public)\n文件:\n  report.json\n    大小: 2\n    SHA-256: ${file.sha256}`,
		approve: "允许",
		deny: "拒绝",
	});
	expect(buildP5BundleReviewContent(plugin, bundle, "/exports/demo", en)).toStrictEqual({
		title: "Plugin wants to write files",
		summary: `Plugin: example.plugin\nFolder: /exports/demo\nDestination: reports/demo (public)\nFiles:\n  report.json\n    Size: 2\n    SHA-256: ${file.sha256}`,
		approve: "Approve",
		deny: "Deny",
	});
});

it("renders all 64 batch items and their resolved details in schema budget order", () => {
	const plans = Array.from({ length: 64 }, (_, index) => ({
		itemId: `case-${index}`,
		profile: `profile-${index}`,
		image: `example.invalid/compute@sha256:${sha256(`image-${index}`)}`,
		preflightRef: `plan-${index}`,
		preflightSha256: sha256(`plan-${index}`),
	}));
	const items = plans.map((plan, index) => ({
		id: plan.itemId,
		execution: { kind: "compute" as const, preflightRef: plan.preflightRef },
		budget: {
			maxOutputBytes: 4096 + index,
			timeoutMs: 1000 + index,
			maxCost: index + 0.25,
			maxTokens: index,
		},
	}));
	const batch = freezeBatch(items, plans.toReversed());
	const content = buildP5BatchReviewContent(plugin, batch, en);
	expect(content).toStrictEqual({
		title: "Plugin wants to run a compute batch",
		summary: [
			"Plugin: example.plugin\nItems:",
			...plans.map(
				(plan, index) =>
					`  ${plan.itemId}\n    Profile: ${plan.profile}\n    Image: ${plan.image}\n    Plan: ${plan.preflightRef} (${plan.preflightSha256})\n    Budget:\n      maxTokens: ${index}\n      maxCost: ${index + 0.25}\n      timeoutMs: ${1000 + index}\n      maxOutputBytes: ${4096 + index}`,
			),
		].join("\n"),
		approve: "Approve",
		deny: "Deny",
	});
	expect(content.summary).not.toMatch(/…|\.\.\./);
	expect(buildP5BatchCancelReviewContent(plugin, batch, zh)).toStrictEqual({
		title: "插件请求取消计算",
		summary: [
			"插件: example.plugin\n计算项:",
			...plans.map(({ itemId, profile }) => `  ${itemId}\n    计算环境: ${profile}`),
		].join("\n"),
		approve: "允许",
		deny: "拒绝",
	});
});

it("omits a model item's null image, plan and cost from the batch review", () => {
	const batch = freezeBatch(
		[
			{
				id: "model-case",
				budget: { maxOutputBytes: 128, timeoutMs: 500, maxCost: null, maxTokens: 64 },
				execution: {
					kind: "model",
					profile: "demo-model",
					prompt: "Example prompt",
					resultKind: "evaluation-observation",
				},
			},
		],
		[{ itemId: "model-case", profile: "demo-model", image: null, preflightRef: null, preflightSha256: null }],
	);
	expect(buildP5BatchReviewContent(plugin, batch, zh)).toStrictEqual({
		title: "插件请求运行一批计算",
		summary:
			"插件: example.plugin\n计算项:\n  model-case\n    计算环境: demo-model\n    预算:\n      maxTokens: 64\n      timeoutMs: 500\n      maxOutputBytes: 128",
		approve: "允许",
		deny: "拒绝",
	});
});

it("renders the full source, plan, budget and all 200 long-path rerun files", () => {
	const expected = Array.from({ length: 200 }, (_, index) => ({
		path: longPath(index),
		bytes: 1024 + index,
		sha256: sha256(`output-${index}`),
	}));
	expect(expected.every((file) => file.path.length === 1024 && Check(FileReadback, file))).toBe(true);
	const snapshot = rerunSnapshot(expected);
	const content = buildP5RerunReviewContent(plugin, snapshot, en);
	expect(content).toStrictEqual({
		title: "Plugin wants to rerun a computation",
		summary: [
			"Plugin: example.plugin",
			`Source run:\n  source-run\n  source-receipt\n  source-artifact\n  SHA-256: ${snapshot.source.verifiedSha256}`,
			`Profile: local\nImage: ${snapshot.plan.image}\nPlan: rerun-plan (${snapshot.plan.sha256})`,
			"Folder: /outputs/rerun\nFiles:",
			...expected.map((file) => `  ${file.path}\n    Size: ${file.bytes}\n    SHA-256: ${file.sha256}`),
			"Budget:\n  maxTokens: 0\n  maxCost: 0\n  timeoutMs: 1500\n  maxOutputBytes: 8192",
		].join("\n"),
		approve: "Approve",
		deny: "Deny",
	});
	expect(content.summary).not.toMatch(/…|\.\.\./);
});

it("uses only the chosen language for a small rerun and reflects a verified hash change", () => {
	const file = { path: "result.txt", bytes: 6, sha256: sha256("output") };
	const snapshot = rerunSnapshot([file]);
	const { source, plan } = snapshot;
	const chinese = buildP5RerunReviewContent(plugin, snapshot, zh);
	expect(chinese).toStrictEqual({
		title: "插件请求重新运行计算",
		summary: [
			"插件: example.plugin",
			`源运行:\n  source-run\n  source-receipt\n  source-artifact\n  SHA-256: ${source.verifiedSha256}`,
			`计算环境: local\n镜像: ${plan.image}\n计算计划: rerun-plan (${plan.sha256})`,
			`目标文件夹: /outputs/rerun\n文件:\n  result.txt\n    大小: 6\n    SHA-256: ${file.sha256}`,
			"预算:\n  maxTokens: 0\n  maxCost: 0\n  timeoutMs: 1500\n  maxOutputBytes: 8192",
		].join("\n"),
		approve: "允许",
		deny: "拒绝",
	});
	expect(buildP5RerunReviewContent(plugin, snapshot, zh)).toStrictEqual(chinese);
	const updatedHash = sha256("updated input");
	const updated: P5ReviewSnapshot = {
		...snapshot,
		source: { ...source, verifiedSha256: updatedHash },
		request: { ...snapshot.request, expectedSha256: updatedHash },
	};
	expect(buildP5RerunReviewContent(plugin, updated, zh).summary).toBe(
		chinese.summary.replace(sha256("input"), updatedHash),
	);
});

it("renders only the source run and profile requested for rerun cancellation", () => {
	const snapshot = rerunSnapshot([{ path: "result.txt", bytes: 6, sha256: sha256("output") }]);
	const run: P5RerunRun = {
		jobId: "rerun-job",
		inputSha256: sha256("request"),
		status: "running",
		artifacts: [],
		source: snapshot.source,
	};
	expect(buildP5RerunCancelReviewContent(plugin, run, en)).toStrictEqual({
		title: "Plugin wants to cancel a computation",
		summary: "Plugin: example.plugin\nSource run:\n  source-run\n  source-receipt\nProfile: local",
		approve: "Approve",
		deny: "Deny",
	});
});

it("renders the exact English byte stage-open review without a hash", () => {
	const input = { requestId: "stage-example", path: "reports/result.bin", bytes: 128 };
	expect(buildP5ByteStageOpenReviewContent(plugin, input, "/exports/demo", en)).toStrictEqual({
		title: "Plugin wants to write files",
		summary: "Plugin: example.plugin\nFolder: /exports/demo\nFiles:\n  reports/result.bin\n    Size: 128",
		approve: "Approve",
		deny: "Deny",
	});
});

it("renders the exact Chinese byte stage-open review without a hash", () => {
	const input = { requestId: "stage-example", path: "reports/result.bin", bytes: 128 };
	expect(buildP5ByteStageOpenReviewContent(plugin, input, "/exports/demo", zh)).toStrictEqual({
		title: "插件请求写入文件",
		summary: "插件: example.plugin\n目标文件夹: /exports/demo\n文件:\n  reports/result.bin\n    大小: 128",
		approve: "允许",
		deny: "拒绝",
	});
});

it("renders the exact bilingual byte write review with the staged source hash and size", () => {
	const hash = sha256("example bytes");
	const input = {
		path: "reports/result.bin",
		source: { fileRef: "stage-example", bytes: 13, sha256: hash },
		expected: null,
	};
	expect(buildP5ByteWriteReviewContent(plugin, input, "/exports/demo", en)).toStrictEqual({
		title: "Plugin wants to write files",
		summary: `Plugin: example.plugin\nFolder: /exports/demo\nFiles:\n  reports/result.bin\n    Size: 13\n    SHA-256: ${hash}`,
		approve: "Approve",
		deny: "Deny",
	});
	expect(buildP5ByteWriteReviewContent(plugin, input, "/exports/demo", zh)).toStrictEqual({
		title: "插件请求写入文件",
		summary: `插件: example.plugin\n目标文件夹: /exports/demo\n文件:\n  reports/result.bin\n    大小: 13\n    SHA-256: ${hash}`,
		approve: "允许",
		deny: "拒绝",
	});
});

it("renders the host-authored approval review with the granted folder and the file facts", () => {
	const hash = sha256("example bytes");
	const review = {
		kind: "byte-write" as const,
		pluginId: plugin,
		root: "/exports/demo",
		file: { path: "reports/result.bin", bytes: 13, sha256: hash },
	};
	expect(buildP5ApprovalReviewContent(review, en)).toStrictEqual({
		title: "Plugin wants to write files",
		summary: `Plugin: example.plugin\nFolder: /exports/demo\nFiles:\n  reports/result.bin\n    Size: 13\n    SHA-256: ${hash}`,
		approve: "Approve",
		deny: "Deny",
	});
	expect(buildP5ApprovalReviewContent(review, zh)).toStrictEqual({
		title: "插件请求写入文件",
		summary: `插件: example.plugin\n目标文件夹: /exports/demo\n文件:\n  reports/result.bin\n    大小: 13\n    SHA-256: ${hash}`,
		approve: "允许",
		deny: "拒绝",
	});
});
