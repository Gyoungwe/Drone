# 扩展挂钩（去硬编码契约）

本文是 Drone 核心与扩展之间五个通用挂钩的契约说明。目标：像 Zotero / Obsidian 归档、来源核对这样的领域功能，
只需要「扩展（`.pi/extensions/*.mjs`）+ 技能（SKILL.md）+ 环境变量 + 可选 UI 插件」就能接入，核心不再出现任何
工具名、技能名或验收种类的硬编码列表。

不下放到扩展的（信任边界）：证据门 / 发布边界、同意总线与权限系统、子代理隔离机制本身、
transcript reducer 的事件模型、三栏壳层。挂钩只登记「是什么 / 怎么核对 / 怎么展示」，从不登记「是否允许」。

## 挂钩 1 · 工具清单元数据

`.pi/lib/tool-manifest.mjs`：`defineTool(def)` / `registerTools(pi, [defs])` / `registerTool(pi, def)`。
在 `pi.registerTool` 的同一份定义上加 `drone` 元数据，一次声明、全链路共用：

```js
import { registerTool } from "../lib/tool-manifest.mjs";

registerTool(pi, {
	name: "research_zotero_save",
	label: "…", description: "…", parameters: {…}, execute: …,
	drone: {
		readOnly: false,                 // 只读工具（只读恢复 / 只读文献模式 / 回执日志判定）
		libraryMode: false,              // 非只读但在「只读复用已有文献」模式下仍允许
		recoverySafe: false,             // 会话恢复时可以自动重放
		journal: true,                   // 写入研究回执日志
		capabilities: ["research", "external"],   // 激活哪些能力时把该工具放进模型可见集
		activity: { text: "正在写入 Zotero 文献库…", phase: "literature-write" }, // 状态条文案
		families: [{ match: "research-zotero", label: "Zotero MCP", readOnly: true,
		             capabilities: ["research"], activity: {…} }],            // MCP 前缀家族
		subagent: "exclude",             // 子代理子会话里不注册
		flow: "literature",              // 失败时在 KnowledgeFlow 生成失败卡的流水线名
		flowCards: (event) => [...],     // 成功时的回执卡（挂钩 3）
	},
});
```

消费方（都不再枚举工具名）：

| 消费方 | 读取 |
| --- | --- |
| `packages/backend/src/tools/manifest.ts` `ToolManifest(session)` | `session.getToolDefinition(name).drone` → 运行时桥（Symbol `drone.tool-manifest.v1`）→ 核心默认 |
| `capabilities/runtime.ts` | `capabilities` / `allowedInLibraryMode` |
| `session/recovery.ts` | `recoverySafe` / 只读 |
| `tools/subagent/runner.ts` | `describeSubagentActivity(name, args, manifest)`：家族 + activity 文案 |
| `pi-backend.ts` → `tool_execution_start.hostActivity` | `activity`；`shared/transcript/reducer.ts` 只消费事件字段 |
| `.pi/lib/tasks/runtime.mjs`、`tasks/workbench.mjs`、`research-receipt-journal.mjs`、`knowledge/ui-state.mjs` | `isReadOnlyTool` / `toolsWhere` / `toolActivity` / `flowCardBuilder` |

测试夹具：`packages/backend/test/tool-manifest-fixture.mjs` 的 `registerResearchToolMeta()` 让真实扩展把声明登记到桥上。

## 挂钩 2 · 里程碑验收器

`.pi/lib/tasks/acceptance.mjs`：核心只认 `file` 与 `human_review`；其它种类由扩展登记：

```js
registerAcceptanceVerifier("zotero_item", {
	fields: ["doi", "libraryId", "collection"],   // task_plan 允许的额外验收字段（schema 活着追加）
	evidenceKind: "zotero-item-verified",
	label: (a) => `文献进入 Zotero（${a.doi}）`,   // 授权卡 / 说明文案
	verify: async (a, { cwd, task }) => ({ state: "found", summary, note, links, …}), // reconcile 时核对
	observe: (event, details) => ({ id, path }) ,  // 某次工具结果产生了待审对象
	resolve: async (review, { cwd }) => ({ status: "applied" | "pending" | "rejected", path, stale }),
	identify: (event, details) => ({ doi }),        // 某次成功回执带回了可绑定到本种类里程碑的身份（只认 fields 里的字段）
	consent: (a) => (a.doi ? { doi: a.doi } : { slot: true }), // 授权后暴露给扩展的契约条目；slot 表示"计划时未点名身份"的一次性写入槽位
	pending: (m) => ({ reason, next }),
	acknowledgeError: { code, message },           // 任务卡「确认」不能完成时的错误
});
```

- `workbench.authorization()` 返回通用的 `acceptances: [{ milestoneId, kind, …consent }]`，不再有 `zoteroItems` 特例；
  Zotero 写入在扩展内自行匹配 `grant.acceptances`。`consent` 返回 `{ slot: true }` 的条目只在该里程碑尚未绑定身份、
  尚未验收时列出（授权卡上须写明这是"精读后写入的一篇"）；扩展自行保证每个槽位只放行一次写入（zotero-literature 用任务内的
  槽位占用表处理并行批量写入），槽位之外的写入仍走确认卡。
- 操作级审阅（Wiki 候选）经 `observe` / `resolve` 写入 `operation.review {kind,id,path}`。
- 运行期身份绑定：计划时未知的身份（如精读后才确定的 DOI）可以留空；成功回执经 `identify` 返回身份后，
  宿主把它绑到第一个尚无身份的同种类里程碑（`milestone.bound = { fields, via, operationId, at }`），
  契约 `acceptance` 与授权哈希不变，`verify` / `label` / `pending` 收到的是 `effectiveAcceptance(milestone)`
  （acceptance + bound.fields）。`verify` 返回 `{ state: "pending" }` 表示身份未绑定，里程碑保持 `pending` 而非 `blocked`。
  已点名的身份不重复绑；每个同类里程碑都已点名别的身份时只记入 `task.unboundIdentities`（不改契约）。
- 改绑：计划里或先前绑定的身份被证明是错误文献时，模型用 `task_wait kind=rebind`（`milestoneId` + `doi` + `reason`）
  提出请求；宿主用同一张 AskDialog 让用户确认（显示原 DOI → 新 DOI），同意后 `milestone.bound.via = "rebind"`、
  旧核对结果作废并重新读回。只有 `via = "rebind"` 的身份进入 `authorization().acceptances`（等同计划点名的 DOI，
  写入不再二次弹窗）；回执自动绑定的身份不扩大任何同意。
- 登记时机：`task_plan` 的 acceptance schema 按引用持有登记表里的 `kinds` 与 `properties`（活对象），
  所以在 `task_plan` 之后加载的扩展（真实顺序里 `zotero-literature` 晚于 `obsidian-workbench`）登记的
  种类与字段，模型看到的 schema 与 pi 的参数校验都能看到。但 pi 在第一次调用工具时才编译并缓存校验器，
  因此验收器必须在扩展加载阶段（第一轮模型调用之前）登记，不能在某次工具调用之后才登记。
  回归测试：`packages/backend/test/task-acceptance-registry.test.mjs`。
- 第一方实现：`zotero-literature.mjs`（`zotero_item`，evidence 带 `summary/note/links`）、
  `knowledge/extension.mjs`（`wiki_review`）。`createTaskWorkbench({ verifiers })` 可在测试里覆盖。

## 挂钩 3 · KnowledgeFlow 通用回执卡

`shared/src/knowledge.ts` 定义 `KnowledgeFlowCard`：

```ts
{ key, kind, title, provisionalTitle?, subtitle?, status, tone?, detail?, path?,
  fields?: [{ label, i18n?, value, status?, code?, note?, tone? }],
  links?:  [{ label, i18n?, kind: "external" | "resource" | "note" | "path", target }],
  source?, at }
```

- 归档 / 摄入 / 总结 / 文献回执全部走 `flow.cards[]`，按 `key` 合并（`.pi/lib/knowledge/ui-state.mjs noteKnowledgeOperation`）。
  来源：`details.cards[]`（扩展在工具结果里直接给）、`drone.flowCards(event)`、声明了 `drone.flow` 的工具失败时的失败卡。
- 桌面只有一个通用卡组件 `components/panel/FlowCards.tsx`（+ `card-links.ts` 的 `followCardLink` / `toneForStatus`）；
  `LiteratureReceipts.tsx` 等专用组件已删除。文案：`flow.status.<token>` / `flow.field.*` / `flow.link.*`，
  `translateOptional` 找不到时回落到原始 token。

## 挂钩 4 · UI 槽位与区域

新增槽位（`shared/src/ui-plugins.ts KNOWN_UI_SLOTS` / 渲染器 `plugins/slots.ts`）：

| 槽位 | props | 用途 |
| --- | --- | --- |
| `panel.artifacts.card` | `{ card, sessionId, renderDefault }` | 接管某类回执卡的渲染（其余 `return renderDefault()`） |
| `panel.task.milestone-evidence` | `{ milestone, task, sessionId, renderDefault }` | 任务卡里扩展验收种类的证据行 |

新增区域：`panel.tab`（右栏页签）、`rail.view`（左侧导航视图），id 形如 `plugin:<插件名>:<贡献 id>`
（`pluginTabId`），由 `plugins/PluginRegions.tsx` 的 `usePluginEntries(region)` / `PluginEntryHost` 承载；
`stores/ui.ts` 的 `AppView` / `PanelTab` 接受 `plugin:${string}`。

`window.DroneUI` / `@drone/plugin-api` 新增：`helpers.openResourceExternal` / `openExternal`、
`stores.useKnowledgeStore`、`i18n.registerMessages(namespace, { zh, en }) → unregister`（插件自带文案）。
完整说明见 `packages/desktop/resources/ui-plugins/SPEC.md` 与 `drone-ui.d.ts`。

## 挂钩 5 · 技能常驻标记

SKILL.md frontmatter 里声明 `alwaysWith`（见 `docs/skill-catalog.md`「Pinned skills」）：

```yaml
---
name: zotero-literature
description: …
alwaysWith: research            # 或 [knowledge, research]；也接受 always-with
---
```

- 声明了常驻能力的技能：任一声明能力激活即可见，不经研究技能路由；只读文献复用模式下仅保留
  `alwaysWith` 含 `research` 的技能与显式 `/skill:` 技能。
- 第一方：`research-vault` → `[knowledge, research]`，`research-workflow` / `zotero-literature` → `research`。
- 后端 `packages/backend/src/capabilities/skill-frontmatter.ts`：进程内声明（`skill.alwaysWith`）优先，
  否则按 mtime 缓存解析文件；未知能力 id 忽略；显式 `/skill:` 永远优先；常驻不授予任何工具或权限。

## 一个新领域扩展需要做什么

1. 在扩展里用 `registerTool(pi, { …, drone })` 声明工具（挂钩 1）；需要回执卡时给 `flowCards` 或在结果 `details.cards` 里返回（挂钩 3）。
2. 若引入新的里程碑验收种类，`registerAcceptanceVerifier(kind, …)`（挂钩 2）。
3. 在自己的 SKILL.md 里写 `alwaysWith`（挂钩 5）。
4. 需要定制界面时再写 UI 插件：占 `panel.artifacts.card` / `panel.task.milestone-evidence` 槽位，或贡献 `panel.tab` / `rail.view`（挂钩 4）。
5. 配置只通过环境变量 / 设置项；不要改核心。
