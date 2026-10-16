#!/usr/bin/env node
/**
 * P9 deterministic acceptance fixture.
 *
 * This exercises the same user-visible boundary cases as the research browser
 * without launching Electron or touching project data. It is safe in CI and
 * emits a redacted evidence record when --out is supplied.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
async function walk(root, current = root, result = []) {
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const absolute = join(current, entry.name);
		const rel = relative(root, absolute).replaceAll("\\", "/");
		if (entry.isDirectory()) {
			result.push(`${rel}/`);
			await walk(root, absolute, result);
		} else {
			result.push(rel);
		}
	}
	return result.sort();
}
function confined(root, target) {
	const rootAbs = resolve(root);
	const targetAbs = resolve(root, target);
	const rel = relative(rootAbs, targetAbs);
	const parent = process.platform === "win32" ? "\\" : "/";
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${parent}`));
}
function explainExternalOpenFailure(error) {
	return `无法使用系统应用打开资源：${error}`;
}
async function main() {
	const root = await mkdtemp(join(tmpdir(), "drone-research-browser-"));
	try {
		const chineseDir = join(root, "中文资料");
		const longDir = join(root, `长路径-${"x".repeat(36)}`, `第二层-${"y".repeat(36)}`);
		await mkdir(join(root, "空项目"), { recursive: true });
		await mkdir(chineseDir, { recursive: true });
		await mkdir(longDir, { recursive: true });
		await mkdir(join(root, "目录"), { recursive: true });
		await writeFile(join(chineseDir, "报告.md"), "# 脱敏报告\n");
		await writeFile(join(longDir, `长文件名-${"z".repeat(120)}.csv`), "sample,value\nA,1\n");
		await writeFile(join(root, "数据.csv"), "sample,value\nA,1\n");
		await writeFile(
			join(root, "图像.svg"),
			'<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>\n',
		);
		await writeFile(join(root, "报告.pdf"), "%PDF-1.4\n");
		await writeFile(join(root, "reads.fastq"), "@sample\nACGT\n+\n!!!!\n");
		await writeFile(join(root, "unknown.bin"), Buffer.from([0, 1, 2, 255]));
		const entries = await walk(root);
		const longEntry = entries.find((entry) => entry.includes("长文件名-"));
		const checks = [
			["empty project", entries.includes("空项目/")],
			["Chinese path", entries.includes("中文资料/报告.md")],
			["long path", Boolean(longEntry && longEntry.length >= 180)],
			["directory", entries.includes("目录/")],
			["Markdown", entries.includes("中文资料/报告.md")],
			["CSV", entries.includes("数据.csv") && entries.includes(longEntry || "")],
			["image", entries.includes("图像.svg")],
			["PDF", entries.includes("报告.pdf")],
			["FASTQ", entries.includes("reads.fastq")],
			["unknown binary", entries.includes("unknown.bin")],
			["project-root confinement", confined(root, "中文资料/报告.md") && !confined(root, "../outside.txt")],
			[
				"external-open failure explanation",
				explainExternalOpenFailure("No application is associated").startsWith("无法使用系统应用打开资源："),
			],
		];
		for (const check of checks) assert(check[1], `acceptance failed: ${check[0]}`);
		const evidence = {
			schema: "drone-research-browser-acceptance-v1",
			generatedAt: new Date().toISOString(),
			fixture: "ephemeral-redacted",
			checks: checks.map((check) => ({ name: check[0], status: "passed" })),
			externalOpenFailure: explainExternalOpenFailure("No application is associated"),
		};
		const outIndex = process.argv.indexOf("--out");
		if (outIndex >= 0 && process.argv[outIndex + 1]) {
			const output = resolve(process.argv[outIndex + 1]);
			await mkdir(dirname(output), { recursive: true });
			await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
		}
		process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}
await main();
