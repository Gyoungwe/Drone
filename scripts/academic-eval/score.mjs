#!/usr/bin/env node
// 学术回答离线评分：只读取已保存的回答（answers-<label>.json：[{ id, answer }]），不调用模型。
// 用法：node scripts/academic-eval/score.mjs answers-before.json answers-after.json
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const questions = JSON.parse(
	await readFile(resolve(import.meta.dirname, "questions.json"), "utf8"),
).questions;
const byId = new Map(questions.map((q) => [q.id, q]));

/** 学术题：结构、行内引用、参考文献、DOI、证据分级；快速题：短而直接、无标题 */
export function scoreAnswer(question, answer) {
	const text = String(answer || "");
	if (question.mode === "quick") {
		const checks = {
			short: text.length <= 1200,
			noHeadings: !/^#{1,6}\s/m.test(text),
			nonEmpty: text.trim().length > 0,
		};
		return { checks, score: Object.values(checks).filter(Boolean).length / 3 };
	}
	const checks = {
		structure:
			/背景|Background/i.test(text) &&
			/方法|证据|Methods|Evidence/i.test(text) &&
			/结论|Conclusion/i.test(text),
		// (Author, Year) / （Author et al., Year）/ （…；Author and Author, Year）
		inlineCitations:
			(
				text.match(
					/[(（；;]\s?[A-Z][A-Za-z'-]+(?: et al\.)?(?: and [A-Z][A-Za-z'-]+)?,\s?\d{4}[a-z]?[)）]/g,
				) || []
			).length >= 3,
		references: /^#{0,6}\s*(参考文献|References)\s*$/im.test(text),
		doi: /\b10\.\d{4,9}\/\S+/.test(text),
		evidenceGrading:
			/已证实|established/i.test(text) &&
			/(有证据支持|supported by evidence)/i.test(text) &&
			/(推测|speculative)/i.test(text),
	};
	return { checks, score: Object.values(checks).filter(Boolean).length / 5 };
}

async function load(file) {
	const rows = JSON.parse(await readFile(resolve(file), "utf8"));
	return new Map(rows.map((row) => [row.id, row.answer]));
}

if (process.argv[1] === import.meta.filename) {
	const files = process.argv.slice(2);
	if (!files.length) {
		console.error("usage: score.mjs answers-a.json [answers-b.json ...]");
		process.exit(1);
	}
	for (const file of files) {
		const answers = await load(file);
		let total = 0;
		const rows = [];
		for (const [id, q] of byId) {
			const { score, checks } = scoreAnswer(q, answers.get(id));
			total += score;
			rows.push(
				`${id} ${q.mode.padEnd(8)} ${score.toFixed(2)} ${Object.entries(checks)
					.filter(([, ok]) => !ok)
					.map(([k]) => `-${k}`)
					.join(" ")}`,
			);
		}
		console.log(`\n${file}: mean ${(total / byId.size).toFixed(2)}`);
		console.log(rows.join("\n"));
	}
}
