/**
 * Jev context point (paper §V, §VIII): conditional instructions bound to the path being touched instead of
 * to the session. A read gets the one-line `short` view; an edit or write gets the `long` view with its
 * PITFALLS pointer. Each rule is shown once per level per session; SessionStart after compact/clear forgets
 * what was shown, so the rules come back after compaction instead of being summarized away.
 */
const LEVEL = { short: 1, long: 2 };
const LARGE_FILE_LINES = 400;
const SOURCE = /\.(?:ts|tsx|mts|js|jsx|mjs|cjs)$/;
const RED_LINES = ".agents/skills/drone-maintenance/references/red-lines.md";

export const RULES = [
	{
		id: "R1-sdk-runtime",
		match: /^drone:packages\/backend\/src\/(?!session-engine\/)/,
		short: "R1：Pi SDK 运行时值只能在 backend/src/session-engine/** 导入，这里只用 import type。",
		long: "R1：Pi SDK（钉 1.1.0）运行时值只在 session-engine/** 或已登记的迁移白名单导入，这里只用 import type。JSON 持久化一律走 JsonStore（原子写 + 损坏语义）；错误默认上抛，不加空 catch 或猜测性回退。",
		see: RED_LINES,
	},
	{
		id: "session-engine",
		match: /^drone:packages\/backend\/src\/session-engine\//,
		short: "session-engine 是 Pi SDK 运行时的唯一入口（钉 1.1.0）；改完跑 npm run check:arch。",
		long: "session-engine 是 Pi SDK 运行时的唯一入口（钉 1.1.0）；改完跑 npm run check:arch。createAgentSession 的 tools 是白名单，扩展注册的工具要显式放行；同名工具先注册者生效。",
		see: "docs/PITFALLS.md 二 · createAgentSession tools 白名单",
	},
	{
		id: "R2-R6-domain",
		match: /^drone:packages\/(?:knowledge|tasks|research|inquiry|discovery)\//,
		short:
			"R2/R6：领域包不依赖 Electron/Pi SDK/backend/desktop；只允许 tasks→knowledge、research→knowledge。",
		long: "R2/R6：领域包不依赖 Electron/Pi SDK/backend/desktop；只允许 tasks→knowledge、research→knowledge。inquiry/discovery/research/extensions 已冻结：不新增文件，只减不增。",
		see: RED_LINES,
	},
	{
		id: "R7-compute",
		match: /^drone:packages\/compute\//,
		short:
			"R7：@drone/compute 只依赖 @drone/shared 与 Node 标准库；SSH/Electron/Pi SDK 适配留在组合根，IO 注入。",
		see: RED_LINES,
	},
	{
		id: "ipc-sync",
		match: /^drone:packages\/(?:shared\/src\/(?:ipc\.ts|host-api\/)|desktop\/src\/(?:preload\/|main\/ipc\/))/,
		short: "新增 IPC 五处同步：shared/ipc.ts → preload → main/ipc → backend → main/ipc/index.ts 事件转发。",
		long: "新增 IPC 五处同步：shared/ipc.ts → preload → main/ipc → backend → main/ipc/index.ts 事件转发。preload 必须保持 CommonJS（sandbox 下没有 ESM）。参数校验失败由 preload 统一转 reject。",
		see: "docs/PITFALLS.md 三 · preload 必须 CJS",
	},
	{
		id: "renderer",
		match: /^drone:packages\/desktop\/src\/renderer\//,
		short: "renderer 只依赖 @drone/shared、经 window.pi 通信；Zustand selector 必须返回稳定引用（#185）。",
		long: "renderer 只依赖 @drone/shared、经 window.pi 通信，不 import 领域插件或 pi 包。Zustand selector 必须返回稳定引用（模块级空对象/数组），否则 #185 无限渲染。新增文案 zh.ts 与 en.ts 都要加。",
		see: "docs/PITFALLS.md 四 · Zustand selector",
	},
	{
		id: "i18n",
		match: /^drone:packages\/desktop\/src\/renderer\/src\/i18n\//,
		short: "中英文案同时改：zh 与 en 两份字典。",
	},
	{
		id: "plugin-ui-api",
		match:
			/^drone:packages\/desktop\/(?:src\/renderer\/src\/plugins\/(?:host-api\.ts|env\.d\.ts)|src\/main\/ui-plugins\/build\.ts|resources\/drone-ui\.d\.ts)$/,
		short:
			"插件 renderer API 五处同步：源模块、host-api.ts、env.d.ts、build.ts SHIM、resources/drone-ui.d.ts。",
	},
	{
		id: "managed-plugin",
		match: /^drone-plugins:packages\//,
		short:
			"受管插件：能力调用都在 hook/工具/命令内 await；SDK 运行期间不 session.notify，状态卡等 agent_settled。",
		long: "受管插件：broker 只在 hook/工具/命令执行期间借出能力，所有能力调用都要在调用内 await；SDK 运行期间不能 session.notify，状态卡等 agent_settled。单元测试的假宿主要模拟这两条。合入后宿主要单独开 PR 重锁 plugins.lock.json。用 drone-plugin-dev skill。",
		see: "docs/PITFALLS.md · 受管插件的状态卡要等运行结束、在调用内等待",
	},
	{
		id: "plugin-lock",
		match: /^drone:plugins\.lock\.json$/,
		short: "宿主只认锁定的远端 commit 与 tarball 哈希：插件改动先合入 drone-plugins，再单独开 PR 重锁。",
	},
	{
		id: "contract-owner",
		match: /^drone:packages\/(?:plugin-api|shared)\/src\//,
		short: "唯一契约所有者：plugin-api/shared 不新增业务镜像，领域 schema 与验证归对应插件。",
		see: "AGENTS.md 反膨胀红线 1",
	},
	{
		id: "R5-pi-dir",
		match: /^drone:\.pi\//,
		short: "R5：不跨包相对路径读 .pi/；.pi/extensions/*.mjs 是生成物，改源码后用 build:extensions 重建。",
	},
	{
		id: "docs-budget",
		match: /^drone:docs\/.+\.md$/,
		short: "新 docs 文件 ≤12 KiB，不新增盘点、截图或门禁日志；文件增删要同步 docs/INDEX.md。",
		see: "AGENTS.md 反膨胀红线 4",
	},
	{
		id: "ratchet-baseline",
		match: /^drone(?:-plugins)?:scripts\/fixtures\/[\w-]*baseline/,
		short: "棘轮基线只降不升；--allow-moves 只用于原样搬动，并在 PR 描述里说明。",
	},
];

function largeFile(key, lines) {
	return {
		id: `large:${key}`,
		short: `该文件 ${lines} 行（>${LARGE_FILE_LINES}）：只减不增，新逻辑放进新文件（新业务文件 ≤350 行）。`,
	};
}

function render(rule, level) {
	if (level === "short") return rule.short;
	const text = rule.long ?? rule.short;
	return rule.see === undefined ? text : `${text}（见 ${rule.see}）`;
}

/**
 * `mode` is "read" or "write"; `lines` is the file's current line count; `seen` maps a rule id to the
 * level already shown this session. Returns `{ id, level, text }` for each rule still worth showing.
 */
export function selectRules({ key, mode, lines }, seen) {
	const level = mode === "write" ? "long" : "short";
	const picked = RULES.filter((rule) => rule.match.test(key));
	if (lines > LARGE_FILE_LINES && SOURCE.test(key)) picked.push(largeFile(key, lines));
	return picked
		.filter((rule) => (LEVEL[seen[rule.id]] ?? 0) < LEVEL[level])
		.map((rule) => ({ id: rule.id, level, text: render(rule, level) }));
}
