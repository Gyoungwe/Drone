#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import process from "node:process";

// Keep this policy identical in Drone and drone-plugins; each checkout must work on its own.
const FROZEN_PREFIXES = [
	"packages/inquiry/",
	"packages/discovery/",
	"packages/research/",
	"packages/extensions/",
	"upgrade-audit/",
];
const RATCHET_FILES = new Set([
	"packages/plugin-api/src/ui-wire.ts",
	"packages/plugin-api/src/knowledge.ts",
	"packages/shared/src/knowledge.ts",
	"packages/shared/src/research-contracts.ts",
	"packages/backend/src/knowledge/ui.ts",
	"packages/backend/src/services/compute-adapter.ts",
	"packages/pi-knowledge/src/extension/internal-knowledge-extension.ts",
	"packages/pi-knowledge/src/core/service.ts",
	"packages/pi-knowledge/src/core/index-runtime.ts",
	"packages/pi-knowledge/src/core/experience-store.ts",
]);

const MAX_NEW_CODE_LINES = 350;
const MAX_MODIFIED_CODE_LINES = 500;
const MAX_NEW_DOC_BYTES = 12 * 1024;
const MAX_ARTIFACT_BYTES = 50 * 1024;
const MAX_SKILL_BYTES = 3 * 1024;
const RUNTIME_SKILL = /^(?:\.pi\/skills|packages\/[^/]+\/(?:skills|resources\/skills))\/.+\/SKILL\.md$/;
const SOURCE = /^packages\/[^/]+\/(?:src|ui)\/.+\.(?:ts|tsx|mts|mjs)$/;
const NON_BUSINESS = /\/(?:test|tests|fixtures|node_modules)\/|\.(?:test|spec)\.|\.d\.[cm]?ts$/;
const GENERATED = /(?:^|\/)dist\/|^\.pi\/extensions\/.+\.mjs$|\/ui\/bundle\.js$|\/ui\/styles\/generated\.ts$/;
const PROCESS_DOC = /(?:^|\/)inventory-[^/]*\.md$|-evidence\.md$|-\d{4}-\d{2}-\d{2}\.json$|\/screenshots?\//;

const git = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
const fields = (buffer) => buffer.toString("utf8").split("\0").slice(0, -1);

function changeList(staged) {
	// Without rename detection, moving into a frozen path is still a new file there.
	const diff = ["diff", "--no-renames", "--no-ext-diff", "--no-textconv", staged ? "--cached" : "HEAD"];
	const names = fields(git(...diff, "--name-status", "-z", "--"));
	const counts = new Map(
		fields(git(...diff, "--numstat", "-z", "--")).map((entry) => {
			const [, plus, minus, path] = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry);
			return [path, { added: Number(plus), deleted: Number(minus), binary: plus === "-" }];
		}),
	);
	const changes = new Map();
	for (let index = 0; index < names.length; index += 2) {
		const status = names[index];
		const path = names[index + 1];
		changes.set(path, { path, status, ...counts.get(path), untracked: false });
	}
	if (!staged) {
		for (const path of fields(git("ls-files", "--others", "--exclude-standard", "-z"))) {
			// A staged untrack can leave the file on disk; inspect it as untracked.
			changes.set(path, { path, status: "A", added: 0, deleted: 0, binary: false, untracked: true });
		}
	}
	return changes.values();
}

function lineCount(buffer) {
	if (buffer.length === 0) return 0;
	const text = buffer.toString("utf8");
	return text.split("\n").length - Number(text.endsWith("\n"));
}

function readSnapshot(path, staged) {
	if (staged) return git("cat-file", "blob", `:${path}`);
	return lstatSync(path).isFile() ? readFileSync(path) : Buffer.alloc(0);
}

function blobBytes(spec) {
	return Number(git("cat-file", "-s", spec).toString("utf8"));
}

function snapshotBytes(path, staged) {
	return staged ? blobBytes(`:${path}`) : lstatSync(path).size;
}

function growsPast(path, staged, isNew, limit) {
	const bytes = snapshotBytes(path, staged);
	return bytes > limit && (isNew || bytes > blobBytes(`HEAD:${path}`));
}

function checkChange(change, staged) {
	const { path, status, binary } = change;
	const isNew = status === "A";
	const removed = status === "D";
	const business = SOURCE.test(path) && !NON_BUSINESS.test(path) && !GENERATED.test(path);
	const lines = business && !removed && !binary ? lineCount(readSnapshot(path, staged)) : 0;
	const added = change.untracked ? lines : binary ? 0 : change.added;
	const deleted = binary ? 0 : change.deleted;
	const net = added - deleted;
	const errors = [];
	if (removed) return { added: 0, deleted: business ? deleted : 0, errors };

	if (FROZEN_PREFIXES.some((prefix) => path.startsWith(prefix)) && (isNew || net > 0 || binary)) {
		errors.push(`[冻结目录] ${path} 禁止新增文件或增长；把新逻辑放到对应插件，旧路径只做删减或等量切流。`);
	}
	if (RATCHET_FILES.has(path) && (net > 0 || binary)) {
		errors.push(`[棘轮拦截] ${path} 净增 ${net} 行或不可按行核算；抽离实际职责或删掉镜像契约，保持不增。`);
	}
	if (business && isNew && lines > MAX_NEW_CODE_LINES) {
		errors.push(`[超长新文件] ${path} 有 ${lines} 行，超过 ${MAX_NEW_CODE_LINES} 行；按独立职责拆分。`);
	}
	if (business && !isNew && lines > MAX_MODIFIED_CODE_LINES && net > 0) {
		errors.push(`[超长文件棘轮] ${path} 有 ${lines} 行且净增 ${net} 行；先提取子模块，让该文件净增 ≤ 0。`);
	}
	if (GENERATED.test(path) && (isNew || growsPast(path, staged, false, MAX_ARTIFACT_BYTES))) {
		errors.push(
			`[产物拦截] ${path} 是新增产物或超过 50 KiB 后仍在增长；勿追踪新产物，压缩旧产物或先切换交付路径。`,
		);
	}
	if (RUNTIME_SKILL.test(path) && growsPast(path, staged, isNew, MAX_SKILL_BYTES)) {
		errors.push(`[Skill 索引] ${path} 新增或增长后超过 3 KiB；保留简短索引，把细节移到按需读取的子文档。`);
	}
	if (
		isNew &&
		path.startsWith("docs/") &&
		(PROCESS_DOC.test(path) || snapshotBytes(path, staged) > MAX_NEW_DOC_BYTES)
	) {
		errors.push(`[文档膨胀] ${path} 是过程记录或超过 12 KiB；把过程写入 PR，长期文档只留维护者需要的内容。`);
	}
	if (isNew && /^packages\/[^/]+\/src\/.+\.(?:mjs|d\.mts)$/.test(path)) {
		errors.push(`[语言统一] ${path} 会增加 JS 或手写 ESM 声明；在 src/ 中写 TypeScript，由编译器生成声明。`);
	}
	return { added: business ? added : 0, deleted: business ? deleted : 0, errors };
}

function main() {
	process.chdir(
		git("rev-parse", "--show-toplevel")
			.toString("utf8")
			.replace(/\r?\n$/, ""),
	);
	const staged = process.argv.includes("--staged");
	const errors = [];
	const totals = { added: 0, deleted: 0 };
	for (const change of changeList(staged)) {
		const result = checkChange(change, staged);
		totals.added += result.added;
		totals.deleted += result.deleted;
		errors.push(...result.errors);
	}
	const net = totals.added - totals.deleted;
	console.log(
		`[bloat-check] 业务代码净变化: +${totals.added} / -${totals.deleted} (净 ${net >= 0 ? "+" : ""}${net} 行)`,
	);
	if (process.argv.includes("--require-net-decrease") && net >= 0) {
		errors.push("[业务净减未达标] 请删除已替换的业务代码；测试、文档与生成物的删除不计入业务净减。");
	}
	if (errors.length > 0) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	}
}

main();
