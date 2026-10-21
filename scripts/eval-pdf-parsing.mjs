#!/usr/bin/env node
/**
 * Compare the shipped pdf.js extractor with optional local MinerU and GROBID adapters.
 * This is an evaluation harness only: it never installs or enables an alternate parser.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
	const value = process.argv[i];
	if (value.startsWith("--"))
		args.set(value.slice(2), process.argv[i + 1]?.startsWith("--") ? true : process.argv[++i]);
}
const fixtureArg = args.get("fixtures");
const manifestArg =
	args.get("manifest") ||
	(fixtureArg ? join(String(fixtureArg), "manifest.json") : "fixtures/pdf-hard/manifest.json");
const manifestPath = resolve(root, String(manifestArg));
const outPath = resolve(root, String(args.get("out") || `docs/evals/pdf-parsing-${defaultDate}.json`));
const conclusionPath = resolve(
	root,
	String(args.get("conclusion") || `docs/evals/pdf-parsing-${defaultDate}.md`),
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const fixturesDir = dirname(manifestPath);
const referenceDir = join(fixturesDir, "reference");

function normalize(value) {
	return value.replace(/\s+/g, " ").trim();
}
function bodyOnly(value) {
	const normalized = normalize(value);
	return normalized.split(/\b(?:references|bibliography|参考文献)\b/i, 1)[0];
}
function characterRecall(reference, actual) {
	const expected = bodyOnly(reference).replace(/[^\p{L}\p{N}]/gu, "");
	const observed = bodyOnly(actual).replace(/[^\p{L}\p{N}]/gu, "");
	if (!expected) return null;
	const counts = new Map();
	for (const char of observed) counts.set(char, (counts.get(char) || 0) + 1);
	let matched = 0;
	for (const char of expected) {
		const count = counts.get(char) || 0;
		if (count > 0) {
			counts.set(char, count - 1);
			matched += 1;
		}
	}
	return Number((matched / expected.length).toFixed(4));
}
function hasTable(value) {
	const lines = value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.some((line) => /\|/.test(line) || /\S+\s{3,}\S+\s{3,}\S+/.test(line));
}
function hasFormula(value) {
	return /[∑∫√≈≤≥α-ω]|\\(?:frac|sum|int|mathbf|mathrm)|\b(?:Eq\.?|equation)\s*\(?\d+\)?/i.test(value);
}
function referenceCount(value) {
	const tail = value.match(/\b(?:references|bibliography|参考文献)\b[\s\S]*/i)?.[0] || "";
	const numbered = tail.match(/(?:^|\n)\s*(?:\[?\d{1,3}\]?|\d{1,3}[.)])\s+/g) || [];
	const doi = tail.match(/10\.\d{4,9}\/[\w.()/:;-]+/gi) || [];
	return Math.max(numbered.length, doi.length);
}
async function parsePdfJs(filePath) {
	const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const data = new Uint8Array(await readFile(filePath));
	const doc = await getDocument({
		data,
		useWorkerFetch: false,
		isEvalSupported: false,
		disableFontFace: true,
		standardFontDataUrl: join(root, "node_modules/pdfjs-dist/standard_fonts/"),
	}).promise;
	const pages = [];
	for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
		const page = await doc.getPage(pageNumber);
		const content = await page.getTextContent();
		pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
	}
	return { text: pages.join("\n"), pages: doc.numPages };
}
async function commandAvailable(command) {
	try {
		await execFileAsync("sh", ["-lc", `command -v ${command}`], { timeout: 1000 });
		return true;
	} catch {
		return false;
	}
}
async function parseMinerU(_filePath) {
	const binary = process.env.MINERU_BIN || "mineru";
	if (!(await commandAvailable(binary)))
		return { status: "unavailable", reason: `command ${binary} not found` };
	return {
		status: "unavailable",
		reason:
			"MinerU is installed but no stable output adapter is configured; evaluation did not guess a CLI layout",
	};
}
async function parseGrobid(filePath) {
	const endpoint = process.env.GROBID_URL;
	if (!endpoint) return { status: "unavailable", reason: "GROBID_URL is not set" };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 3000);
	try {
		const body = await readFile(filePath);
		const response = await fetch(`${endpoint.replace(/\/$/, "")}/api/processFulltextDocument`, {
			method: "POST",
			body,
			headers: { "Content-Type": "application/pdf" },
			signal: controller.signal,
		});
		if (!response.ok) return { status: "unavailable", reason: `GROBID HTTP ${response.status}` };
		const xml = await response.text();
		return { status: "ok", text: xml.replace(/<[^>]+>/g, " "), pages: null };
	} catch (error) {
		return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timer);
	}
}
async function referenceText(entry) {
	const path = join(referenceDir, `${entry.id}.txt`);
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}
function metricFor(_entry, reference, parsed, elapsedMs) {
	if (parsed.status && parsed.status !== "ok")
		return { status: parsed.status, reason: parsed.reason, elapsedMs };
	const text = parsed.text || "";
	return {
		status: "ok",
		elapsedMs,
		pages: parsed.pages ?? null,
		bodyCharRecall: characterRecall(reference, text),
		tableStructure: hasTable(reference)
			? hasTable(text)
				? "preserved"
				: "lost"
			: "not-present-in-reference",
		formulaReadability: hasFormula(reference)
			? hasFormula(text)
				? "readable"
				: "lost"
			: "not-present-in-reference",
		referenceCount: referenceCount(text),
		extractedCharacters: text.length,
	};
}

const startedAt = new Date().toISOString();
const engines = { "pdf.js": [], MinerU: [], GROBID: [] };
for (const entry of manifest.entries) {
	const filePath = join(fixturesDir, `${entry.id}.pdf`);
	const reference = await referenceText(entry);
	const runs = [
		["pdf.js", () => parsePdfJs(filePath)],
		["MinerU", () => parseMinerU(filePath)],
		["GROBID", () => parseGrobid(filePath)],
	];
	for (const [engine, run] of runs) {
		const started = performance.now();
		try {
			const parsed = await run();
			engines[engine].push({
				id: entry.id,
				categories: entry.categories,
				...metricFor(entry, reference, parsed, Math.round(performance.now() - started)),
			});
		} catch (error) {
			engines[engine].push({
				id: entry.id,
				categories: entry.categories,
				status: "error",
				reason: error instanceof Error ? error.message : String(error),
				elapsedMs: Math.round(performance.now() - started),
			});
		}
	}
}
const report = {
	schema: 1,
	kind: "pdf-parsing-evaluation",
	generatedAt: new Date().toISOString(),
	startedAt,
	manifest: manifestPath.replace(`${root}/`, ""),
	licenseUrl: manifest.licenseUrl,
	fixtureCount: manifest.entries.length,
	categories: [...new Set(manifest.entries.flatMap((entry) => entry.categories))].sort(),
	engines,
	limitations: [
		"The reference text is a checked-in pdftotext extraction of the openly downloadable source; it is a repeatable proxy for manual body text, not a claim of scientific ground truth.",
		"MinerU and GROBID are optional and were not installed or added to the Drone runtime. Unavailable engines are reported as such.",
		"Table and formula metrics are deterministic layout/text heuristics and require human review before an integration decision.",
	],
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const pdfOk = engines["pdf.js"].filter((entry) => entry.status === "ok");
const unavailable = ["MinerU", "GROBID"]
	.map(
		(engine) =>
			`${engine}: ${engines[engine].filter((entry) => entry.status === "unavailable").length}/${engines[engine].length} unavailable`,
	)
	.join("; ");
const meanRecall = pdfOk.length
	? pdfOk.reduce((sum, entry) => sum + (entry.bodyCharRecall || 0), 0) / pdfOk.length
	: 0;
await writeFile(
	conclusionPath,
	`# PDF 解析质量评估（${defaultDate}）\n\n本次评估使用 fixtures/pdf-hard/manifest.json 中的 ${manifest.entries.length} 篇开放获取论文，覆盖双栏、公式密集、跨页表格和扫描版派生样本。可重跑命令：node scripts/eval-pdf-parsing.mjs。\n\n- 当前默认的 pdf.js 成功解析 ${pdfOk.length}/${manifest.entries.length} 篇，正文字符召回均值 ${(meanRecall * 100).toFixed(1)}%。表格、公式和参考文献指标见同目录 JSON。\n- ${unavailable}。本轮未安装、未集成、未把 MinerU 或 GROBID 作为默认后端。\n- 扫描版样本的 pdf.js 文本召回用于暴露 OCR 缺口；OCR 质量和表格结构仍需人工抽样复核，不能把启发式分数当作论文事实。\n\n## 下一轮决策\n\n只有在补充人工逐页参考文本、固定 MinerU/GROBID 版本和受控资源预算后，才适合决定是否引入可选后端。若引入，优先保持本地可选服务或明确的 API 适配层，避免把大型模型/Java 服务塞进默认安装包；本轮不改变安装包和默认流程。\n`,
	"utf8",
);
console.log(
	JSON.stringify(
		{
			out: outPath,
			conclusion: conclusionPath,
			fixtureCount: manifest.entries.length,
			pdfJsParsed: pdfOk.length,
			optional: unavailable,
		},
		null,
		2,
	),
);
