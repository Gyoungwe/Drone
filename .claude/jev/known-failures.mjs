/**
 * Jev known-failure library: failures the dispatch sessions already diagnosed (their ★ Insight notes), keyed
 * by a signature in the check output. The output ladder appends the matching cause and next step under its
 * view, so the main model reads the known diagnosis before it starts guessing. Matching is plain code: a
 * regex on the stored output, optionally on the command, and on whether the run failed. Nothing here
 * changes the exit code or hides output; a hint is advice, the check result stays the evidence.
 *
 * Entry fields: id, output (regex on the whole output), command (optional regex), exit ("fail" default,
 * "pass" or "any"), cause, fix, source (where the lesson was learned).
 */
const MAX_HINTS = 3;

export const KNOWN_FAILURES = [
	{
		id: "baseline-drop",
		output: /\bdropped \d+ -> \d+; run with --update/,
		cause: "棘轮基线下降不是违规：结构/lint 基线只许收紧，计数变少也会让检查失败。",
		fix: "对同一脚本加 --update 记录下降，和改动同一提交；确认基线 diff 只有删减；文件降到 500 行以下时该行会被直接删掉。",
		source: "T481 wiki-review 验收、T46 门禁",
	},
	{
		id: "baseline-refused",
		output: /(?:structure|lint baseline): not updated|; fix the new ones/,
		cause: "--update 只记下降；计数上升或新条目说明代码真的变差了。",
		fix: "修掉新增的违规；只有原样搬动的旧代码才用 --update --allow-moves，并在 PR 里说明。",
		source: "#258 基线规则拆分",
	},
	{
		id: "vite-temp-eperm",
		output: /EPERM[^\n]*\.vite-temp/,
		cause: "node_modules 软链到主检出时，vitest 无法写 config bundle；这是环境问题，不是代码问题。",
		fix: "加 --configLoader runner --no-cache 重跑，并在 base 上同样跑一次对照测试数。",
		source: "T481 验收、Codex 沙箱回执",
	},
	{
		id: "plugin-api-tarball",
		output: /DRONE_PLUGIN_API_TARBALL/,
		cause: "打包 SDK 契约测试需要显式的插件 API tarball。",
		fix: "设 DRONE_PLUGIN_API_TARBALL 指向当前插件 API（1.3）的 tarball 再跑；合并前确认 CI 也设了它。",
		source: "T108 冒烟、pi-core 契约测试",
	},
	{
		id: "missing-test-fixtures",
		output: /ENOENT[^\n]*\.pi\/extensions/,
		cause: "worktree 没准备测试夹具，不是代码问题。",
		fix: "先 npm run prepare:test，再跑全量测试。",
		source: "全量测试 7 个 ENOENT .pi/extensions",
	},
	{
		id: "missing-build-output",
		output:
			/(?:ENOENT|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND)[^\n]*(?:\/dist\/|plugin-api\/node|host\.mjs)/,
		cause: "缺的是构建产物不是依赖：软链的主检出或工单禁止构建时 dist/ 不存在。",
		fix: "先 npm run prepare:test（会构建 plugin-api）或对应 build，再重跑；回执里这类失败不算工单失败。",
		source: "T29、T74、T105 回执",
	},
	{
		id: "pi-knowledge-stale",
		output:
			/(?:error TS\d+|Cannot find|has no exported member)[^\n]*@gyoungwe\/pi-knowledge|@gyoungwe\/pi-knowledge[^\n]*error TS\d+/,
		cause: "pi-knowledge 的类型对不上，多半是 npm ci 把锁定版本换成了 npm 上的旧 0.2.1。",
		fix: "npm ci 之后再跑 npm run fetch:plugins，顺序不能反。",
		source: "T93、T94 typecheck 失败",
	},
	{
		id: "tarball-hash-mismatch",
		output: /tarball hash mismatch: expected \S+, got [0-9a-f]{64}/,
		cause: "锁文件的 tarballSha256 与从锁定提交构建出的包不一致；重锁时这是取真实哈希的正常步骤。",
		fix: "只把报错里 got 后面的值写回 plugins.lock.json，再 fetch 一次要看到 verified cached tarball；不要手算哈希。",
		source: "插件重锁流程",
	},
	{
		id: "artifact-ratchet",
		output: /\[产物拦截\]/,
		cause: "产物棘轮比的是相对 HEAD 的增长，不是绝对大小。",
		fix: "让产物回到不超过 HEAD 的字节数（等于 HEAD 就算通过），或把新逻辑移出产物；不要新追踪产物。",
		source: "dist/host.mjs 被 check-bloat 拦",
	},
	{
		id: "collect-before-reconcile",
		output: /Artifacts can only be collected from a succeeded job/,
		cause: "作业状态要等 compute.status 触发 reconcile 才更新；刚完成的作业直接 collect 会报这个误导性错误。",
		fix: "collect 前先调用 status 完成 reconcile。",
		source: "P5 compute 端口",
	},
	{
		id: "worker-gone-on-cancel",
		output: /worker process is not present/,
		cause: "已知的取消竞态：worker 先退出，cancel 找不到它。",
		fix: "与改动无关时重跑一次；同一测试再失败就开工单修根因，不要加长超时。",
		source: "H6、#383 CI",
	},
	{
		id: "test-timeout",
		output: /Test timed out in \d+\s?ms|timed out after \d+|ERR_TEST_FAILURE[^\n]*timed out/i,
		cause: "超时多半是负载或并行门禁争 CPU，断言失败才指向代码。",
		fix: "确认没有别的门禁在跑，单独重跑这个测试；仍失败再查根因。不许拉长超时（check-staged 会拦），改为等事件本身。",
		source: "#371、T180i、门禁并行超时",
	},
	{
		id: "silent-check",
		command: /^node scripts\/check-[\w-]+\.mjs\b/,
		exit: "pass",
		output: /^\s*$/,
		cause:
			"检查脚本没有任何输出就退出 0，可能是入口判断失效（macOS 上 /tmp 软链让路径比较不等），并没有真的检查。",
		fix: "从真实路径重跑并确认有输出；必要时故意加一条违规，看它是否失败。",
		source: "#260 静默跳过",
	},
];

const exitMatches = (rule, exitCode) => {
	const expected = rule.exit ?? "fail";
	return expected === "any" || (expected === "fail") === (exitCode !== 0);
};

/** Known failures whose signature matches this run, at most MAX_HINTS, in library order. */
export function knownFailures({ output, command, exitCode }) {
	return KNOWN_FAILURES.filter(
		(rule) =>
			exitMatches(rule, exitCode) &&
			(rule.command === undefined || rule.command.test(command)) &&
			rule.output.test(output),
	).slice(0, MAX_HINTS);
}

/** The lines appended under the ladder view; empty when nothing matched. */
export function knownHint(matches) {
	return matches
		.map((rule) => `⚑ 已知 ${rule.id}：${rule.cause} → ${rule.fix}（来源：${rule.source}）`)
		.join("\n");
}
