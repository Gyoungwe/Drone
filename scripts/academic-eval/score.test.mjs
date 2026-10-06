import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreAnswer } from "./score.mjs";

test("academic answers are scored on structure, citations, references, DOI and evidence grading", () => {
	const good = [
		"## 背景与问题",
		"…",
		"## 方法与证据",
		"JH 升高促进有翅型（已证实；Smith, 2010）。",
		"有证据支持保幼激素通路（Braendle et al., 2006）。推测与表观调控有关（Li and Wang, 2019）。",
		"## 结论",
		"…",
		"## 参考文献",
		"1. Braendle C et al. 2006. PLoS Biol. doi:10.1371/journal.pbio.0040070",
	].join("\n");
	assert.equal(scoreAnswer({ mode: "academic" }, good).score, 1);
	assert.ok(scoreAnswer({ mode: "academic" }, "蚜虫翅型由激素决定。").score < 0.3);
});

test("quick answers stay short and without headings", () => {
	assert.equal(scoreAnswer({ mode: "quick" }, "`samtools sort -o out.bam in.bam`").score, 1);
	assert.ok(scoreAnswer({ mode: "quick" }, "## 标题\n内容").score < 1);
});
