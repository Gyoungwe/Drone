# Drone UI 插件开发规范（SPEC）

> 本文件随 Drone 分发（`userData/ui-plugins/SPEC.md`），是 agent 编写 UI 插件的唯一权威依据。
> 配套类型声明：同目录 `drone-ui.d.ts`（与宿主 `window.DroneUI` 暴露清单**逐名一致**）。
> 完整示例：`examples/terminal-tool-card/`。槽位契约设计见宿主仓库 `.local/docs/design/spec/ui-plugin-system.md`。

## 1. 什么是 UI 插件

Drone 的某些前端组件是**可替换的命名槽位（Slot）**。插件 = `userData/ui-plugins/<name>/` 目录下的一个 TSX 包，构建在宿主 main 进程完成，产物在应用内运行，替换默认组件渲染。插件与宿主**共享同一个 React 实例**。

```
my-plugin/
├── plugin.json        # 清单（必需）
├── src/index.tsx      # 入口源码（agent 写的就是这个）
└── dist/index.js      # 构建产物（宿主生成，不要手改）
```

## 2. 槽位目录 v1 与 props 契约

| 槽位名 | props | 默认组件 |
|---|---|---|
| `chat.message` | `ChatMessageProps`（见下） | 一条安全 UI 消息的宿主默认呈现；插件可选择接管或调用 `renderDefault()` |
| `chat.tool-call-card` | `{ tool: UIToolCall }` | 工具调用卡（折叠行：工具名 + 参数摘要 + 输出） |
| `chat.subagent-card` | `{ runs: SubagentRunUi[] }` | 子代理独立行（状态点 + 名称 + 点击打开子会话） |
| `chat.todo-panel` | `{}` | 任务列表面板（右上角胶囊，内部自行取数） |
| `panel.artifacts.card` | `{ card: KnowledgeFlowCard; sessionId; renderDefault(): ReactNode }` | 「产物」页签的一张通用回执卡（归档 / 文献 / Wiki 候选…按 `card.kind` 区分；只想接管某些 kind 时其余 `return renderDefault()`） |
| `panel.task.milestone-evidence` | `{ milestone: TaskMilestone; task: WorkbenchTask; sessionId; renderDefault(): ReactNode }` | 任务卡里一个验收项下方的证据行（`milestone.acceptance.kind` 为扩展验收种类时才有内容，如 `zotero_item`） |

```ts
interface UIToolCall {
	key: string;      // 本地稳定 id（React key 用）
	id: string;       // 真实 toolCall id
	name: string;     // 工具名，如 "bash"
	args: string;     // 参数摘要（JSON 或纯文本）
	output: string;   // 执行输出累积
	state: "running" | "done" | "error";
	blockIndex?: number;
}

interface SubagentRunUi {
	key: string;
	agent: string;
	task?: string;
	status: "running" | "done" | "error";
	model?: string;
	tokens?: number;
	exitCode?: number;
	artifactsDir?: string;
	sessionFile?: string;
}

/** 通用回执卡（扩展在 .pi 侧用 drone.flowCards / details.cards 贡献；见 packages/shared/src/knowledge.ts） */
interface KnowledgeFlowCard {
	key: string; kind: string; title: string; subtitle?: string | null;
	status: string; tone?: "ok" | "warn" | "error" | "muted"; detail?: string | null; path?: string | null;
	fields?: { label: string; i18n?: string; value: string; status?: boolean; code?: string | null; note?: string | null; tone?: string }[];
	links?: { label: string; i18n?: string; kind: "external" | "resource" | "note" | "path"; target: string }[];
	source?: string | null; at: number;
}
```

`chat.message` 使用 `@gyoungwe/plugin-api/ui` 的 `ChatMessageProps`：`message: UIMessage`、`sessionId: string | null`、`agentActive`、`readOnly`、可选 `streaming/metaInGroup/showActions/turnTiming/turnStepCount` 和 `renderDefault(): ReactNode`。这里只传 renderer 已有的安全消息投影，不能取得原生 SDK `RawMessage` 或私有协议 thinking。`readOnly` 来自这一行所属会话，而非当前活动会话。`renderDefault()` 直接渲染宿主默认组件，不重新进入槽位；插件不处理的消息应调用它。停用、卸载或渲染异常都会恢复默认呈现。消息内 `sourceText` 仅供既有匹配逻辑，绝不能渲染、复制或放入可访问文本。

消息槽位不提供领域去重或任务状态机。插件可用 `useSessionMessages(sessionId)`（亦可用 `hooks.useSessionMessages`）读取完整的安全 `readonly UIMessage[]`，自行选择需要呈现的领域快照；空会话和未加载会话返回稳定空数组。右栏页面继续使用已有 `panel.tab`，无需新增领域槽位。

`manifest.slots` 的 value 是入口 bundle 的**具名导出名**（一个插件可覆盖多个槽位）：

```json
{
	"name": "my-terminal-card",
	"version": "0.1.0",
	"displayName": "终端风工具卡",
	"description": "把工具调用卡改成终端样式",
	"droneUi": 1,
	"main": "src/index.tsx",
	"slots": { "chat.tool-call-card": "ToolCallCard" }
}
```

字段规则（任一不满足 → 插件标记「清单无效」，不加载）：
- `name`：必填，`/^[a-z0-9][a-z0-9-]*$/`，**必须与目录名一致**；
- `droneUi`：必填，宿主契约版本。`1` 保留已发布 UI 合同；`2` 用于依赖绑定 runtime、订阅和资源能力的新 UI。宿主支持 `1` 和 `2`，未知版本拒绝加载。`2` 必须来自具有有效 `entrypoints.desktopRuntime` 的已验证安装包；本地 UI 目录不能冒用包身份。旧宿主只接受 `1`，会在清单校验时拒绝 `2`，不会执行不兼容代码；
- `main`：必填，插件目录内相对路径，**禁止 `..` 穿越**；后缀 `.ts/.tsx/.js/.jsx`；
- `slots`：必填非空对象，key 必须是上表槽位名，value 是具名导出名；
- `version` / `displayName` / `description`：可选展示字段。

## 3. 可用导入（两个虚拟模块 + 静态图片资产）

插件里**只允许**两类导入：

```ts
import { useState, memo } from "react";                 // react（含 react/jsx-runtime，JSX 自动使用）
import { Button, useT } from "@gyoungwe/plugin-api";      // 宿主 API（见 §4）
import idleUrl from "./assets/idle.png";                // 插件目录内图片资产（见下）
```

**图片与音频资产**：相对路径导入图片（`.png` / `.webp` / `.gif` / `.jpg` / `.jpeg`）与音频（`.mp3` / `.m4a` / `.aac` / `.ogg` / `.wav`），构建器（esbuild dataurl loader）
把文件打成 `data:` URL 字符串内联进产物（默认导出 = URL），CSP `img-src` 与 `media-src` 均放行 `data:`（音频用 `new Audio(url)` 播放）。
适合桌宠立绘、雪碧图、语音提醒/音效等场景。纪律：
- 只接受插件目录内的**相对路径**（`./` 或 `../` 开头但不得穿出插件目录）；裸导入图片/音频包名仍失败；
- 体积即产物体积（base64 再 +33%）：图片先缩到实际显示尺寸的 2x（Retina）再导入，5 张 760px PNG ≈ 2MB 产物是可接受上限量级；音频建议有损格式（几秒语音的 mp3/m4a 约几十 KB，wav 动辄几 MB）；
- 资产改动同样触发热重载（watch 覆盖整个插件目录，除 dist/）。

**硬约束**：

- ❌ 禁止 import 任何其他 npm 包（构建器只重写上述四个 specifier，其余裸导入构建直接失败）；
- ❌ 禁止 Node API（`process`/`fs`/`path`/`require` 等都不存在——代码跑在浏览器沙箱渲染进程）；
- ❌ 禁止 `fetch`/网络请求、`localStorage`（宿主未授权，且 CSP 会拦）；
- ❌ 禁止直接访问 `window.pi` 做任何 IPC 调用（信任模型边界，插件只准用 `window.DroneUI` 暴露的能力）；
- ✅ 允许 `window.DroneUI` 的 hooks 取宿主 store 数据（如 todo 面板替换）。

## 4. `@gyoungwe/plugin-api` 导出清单

```ts
export const version;                       // 宿主 API 版本（1）
export const components: {                  // 宿主精选组件（复用，不重造轮子）
	Button; Dropdown; Tooltip; Markdown; ImagePreview;
};
export const helpers: {
	summarizeArgs(args: string): string;    // 参数摘要（取 command/path/url，流式容错）
	displayToolName(name: string): string;  // 工具名首字母大写
	openResourceExternal(target: string, cwd?: string): Promise<void>; // 经主进程白名单打开 zotero:// obsidian:// 等资源
	openExternal(url: string): Promise<void>;                          // 系统浏览器打开 http(s) 链接
};
export const hooks: {
	useT(): (key: string, params?) => string; // i18n（key 用宿主既有字典，如 "message.working"）
	useSessionMessages(sessionId: string | null): readonly UIMessage[];
};
export const stores: {                      // 宿主 zustand store（与宿主同一实例）
	useTranscriptStore; useSessionsStore; useUiStore; useProjectsStore; useSettingsStore;
	useUiPreferencesStore;                   // 应用级 UI 偏好（ui-state.json 持久化：轨道/中央动画等开关）
	useKnowledgeStore;                       // 知识流（flows[sessionId].cards 等）
};
export const sessions: {
	prompt(sessionId: string, text: string, images?: ImageInput[], ids?: PromptIds): Promise<PromptReceipt>;
};
export const i18n: {
	// 插件自带文案：注册后 useT()(key) 在核心字典找不到时回落到这里（如 flow.status.<自定义记号>）；返回注销函数
	registerMessages(namespace: string, messages: { zh?: object; en?: object }): () => void;
};
```

`sessions.prompt` 复用现有会话 prompt IPC、权限与生命周期检查；只读或已关闭会话仍由宿主拒绝，错误和 `PromptReceipt` 原样返回。它不依赖知识插件。旧 `knowledge.prompt` 与既有具名 `prompt` 保留原绑定；新代码使用 `sessions.prompt`。会话身份与 cwd 可从既有 `stores.useSessionsStore` 取得，资源打开沿既有 `useUiStore.openResourcePreview`。

`react` 的完整导出（`Children`/`Component`/`memo`/`useEffect` 等全部 hooks）也可用，见 `drone-ui.d.ts`。

### 插件自己的后台操作

声明 `droneUi: 2`、带有已批准 Desktop runtime 的安装包可在槽位或贡献组件内调用 `usePluginRuntime()`（也可用 `hooks.usePluginRuntime`）：

`runtime.subscribe(listener)` 接收无正文的 `{ type: "changed", revision }` 失效通知，并返回取消订阅函数。组件卸载时必须取消订阅。主进程校验包、窗口和运行代次；renderer 再过滤绑定和当前会话的选择回执。切换会话后的旧通知不会转发给插件。插件据此重新调用自身只读 operation，不连接宿主领域事件。

```tsx
import { usePluginRuntime } from "@gyoungwe/plugin-api";

export function ResultsPanel() {
	const runtime = usePluginRuntime();
	return <button onClick={() => runtime.invoke("results.refresh", {})}>Refresh</button>;
}
```

客户端只接受操作名和输入。包身份由主进程根据安装来源绑定，UI 不能传入包名来选择别的插件。主进程在每次调用时检查绑定所属窗口、激活状态与操作声明；停用或替换后旧绑定失效。结果为 `unknown`，由插件按自己的操作协议解析。

`droneUi: 1` 且无 Desktop runtime 的 UI 包仍可使用既有 UI API，但调用此 hook 会明确抛出不可用错误。每个贡献都拥有独立上下文，嵌套渲染不会继承另一插件的客户端。无头模块接收 `activate({ runtime })`，其中 `runtime` 在没有绑定时为 `undefined`；既有不接参数的 `activate()` 无需修改。

这些 UI 模块仍与宿主共享 React 和 renderer，是经过信任确认的代码。绑定提供来源识别和生命周期撤销，**不构成恶意 UI 代码之间的安全隔离**。

### 聚合 Pi 包中的 UI 发现

宿主保留已安装顶层 UI 包的发现。对于聚合包，managed npm prefix 的 `package.json.dependencies` 与 `optionalDependencies`（含 `npm --save-optional`）确定被选中的安装根；宿主只沿该包 `dependencies` / `optionalDependencies` 中声明、且在 `pi.extensions` / `skills` / `prompts` / `themes` 中通过 `node_modules/<包名>/...` 明确引用的资源边发现子包 UI。路径按 npm 就近依赖解析（包括提升到父级的依赖），真实路径必须仍位于该 managed 安装目录。普通库依赖、peer/dev 依赖和未引用子树不会被递归扫描。

相同真实目录只登记一次。不同目录的同名包，即使版本相同也不假定内容相同：只有明确选中的直接安装来源可以优先，其他来源在诊断中标记为 shadowed；不同版本或没有明确直接来源的冲突不会加载任意一方的 UI。两个不同 npm 包声明同一 UI 名称时也会诊断冲突并阻止加载。子包始终使用自身 npm 包身份、UI 清单和 runtime 入口，独立取得启用/信任；聚合根不传递运行授权。取消根选择或移除聚合包后，只由它提供的嵌套 UI 从扫描结果消失。这里的“发现”不等于原生 Pi 扩展执行或安全隔离已经验收。

## 5. 样式纪律（强制）

- **一律语义 token**：`bg-canvas` / `bg-surface` / `bg-hover` / `text-ink` / `text-ink-2` / `text-ink-dim` / `text-ink-faint` / `border-border` / `shadow-soft` / `shadow-pop` / `text-accent` 等（宿主 Tailwind 已全局注册）。**禁写死 zinc/white/black 等裸色值**——深浅主题都要检查一遍，插件必须两态可读；
- 动画：加 `motion-reduce:` 退化（如 `motion-reduce:transition-none`），尊重系统减少动态；
- 圆角/字号跟随宿主既有组件习惯（`rounded-lg`、`text-[13px]` 等），不要引入突兀的大块面；
- 状态色（成功/失败/进行中）用宿主既有语义（`text-green-500` / `text-red-500` / `text-accent`）。

## 6. 性能

- 导出的组件**必须 `React.memo` 包裹**（槽位在每条消息的热路径上渲染，memo 可跳过无关注入重渲）；
- 不要在渲染里做重计算（`useMemo` 缓存派生值）；流式输出更新频繁，保持组件轻量。

## 7. 热重载流程

宿主对 `userData/ui-plugins/` 开 fs.watch：`src/` 或 `plugin.json` 保存后 **300ms 防抖自动重建**并热替换（无需重启应用）。构建失败 → 旧版继续生效，设置面板显示错误。**保存即见效**是设计目标，改完直接看界面。

## 8. 完整示例

`_examples/terminal-tool-card/`（随包分发，seedDocs 拷进插件根目录时改名为 `_examples`——下划线开头不被当插件扫描），要点齐全：memo 包裹、语义 token、useT、折叠 details 结构。照抄改即可。

## 9. 交付闭环（agent 标准流程）

1. 读本 SPEC + `drone-ui.d.ts`；
2. 在 `~/.drone/ui-plugins/<name>/`（=`userData/ui-plugins/<name>/`，宿主已建 symlink）scaffold：`plugin.json` + `src/index.tsx`；
3. 保存 → 宿主自动构建（面板若显示「构建失败」则修语法/导入问题）；
4. **引导用户去 设置 → UI 插件 面板启用**（总开关 + 插件启用带二次确认，agent 无权代劳——这是信任门）；
5. 用户确认替换生效后，迭代样式时直接改 `src/index.tsx` 保存即可热替换。

## 10. Region/Contribution：往页面加挂新组件（Phase 3）

Slot 是「替换」，Region/Contribution 是「新增」：插件可以在宿主界面的固定「区域」加挂组件（桌宠 / token 仪表盘 / 氛围光效 / 插件自带设置页）。一个区域可挂 N 个贡献（堆叠），同一插件可同时声明 `slots` 与 `contributions`。贡献**无 props**，数据一律从 `window.DroneUI.stores` / `hooks` 自取（store 连接型）。

### 10.1 区域目录 v1 与 manifest

| 区域 | 挂载点 | 定位语义 | 典型用途 |
|---|---|---|---|
| `app.background` | App 根、内容列之前 | 绝对填充 z-0 | 动态背景 |
| `app.overlay` | App 根、内容列之后、弹窗之前 | 每贡献一个 `fixed inset-0 z-20` 容器 + anchor 九宫格对齐 | 桌宠、悬浮物 |
| `chat.corner.top-left` / `top-right` / `bottom-left` / `bottom-right` | 聊天区 main 内 | `absolute z-20` 同角纵向堆叠（顺序=启用先后） | 小部件 |
| `chat.diff-sidebar` | 宿主 Git Diff 右侧扩展栏 | 跟随 420px push 式侧栏，普通文档流堆叠 | 图片图库、仓库辅助面板 |
| `settings.panel` | 设置弹窗 | 独立分类页（分类标题 = `title`） | 插件配置页 |
| `panel.tab` | 右侧上下文面板页签栏 | 每贡献一个页签（标签 = `title`，id `plugin:<name>:<cid>`），选中时贡献组件占满面板体 | 领域面板（如文献库、实验记录） |
| `rail.view` | 左侧导航栏 | 每贡献一个入口（标签 = `title`，拼图图标），选中时贡献组件占满主区（与研究工作台 / 知识库同级全屏视图） | 插件自带的全屏工作台 |
| `knowledge.tab` | 知识库页签栏 | 追加在总览 / 网络图 / 审阅 / 设置之后；选中时贡献组件占满内容区 | 知识领域页签 |
| `knowledge.surface` | 设置、技能页及侧栏中的知识嵌入区 | 首个启用贡献接收 `KnowledgeSurfaceProps`（`kind=settings/note/flow/zotero/institution`）；停用或失败回退轻量入口，flow 隐藏 | 知识组件复用 |
| `knowledge.page` | 知识库主区 | 由第一个启用贡献完整接管知识库主区；没有可用贡献或渲染失败时回退宿主轻量页（绑定状态、打开文件夹、插件管理） | 整页知识工作台 |
| `home.section` | 新任务首页卡片区 | 在内置首页卡片之后追加分区 | 首页摘要或引导 |
| `skills.section` | 技能与连接页 | 在内置能力内容前追加分区 | 插件配置或状态 |

z 序：背景 0 < 内容 10 < overlay 20 < 设置弹窗 40 < 信任弹窗/全屏预览 50。**插件层永在弹窗之下**。

```json
{
	"name": "my-pet",
	"droneUi": 1,
	"main": "src/index.tsx",
	"contributions": [
		{ "id": "pet", "region": "app.overlay", "anchor": "bottom-right", "export": "Pet", "title": "桌宠" }
	]
}
```

字段规则（`slots` 与 `contributions` **至少其一非空**）：
- `id`：必填 slug（`/^[a-z0-9][a-z0-9-]*$/`），插件内唯一；
- `region`：必填，∈ 上表区域；未知区域由宿主告警并忽略该条（不判无效）；
- `export`：必填，入口 bundle 的具名导出名；
- `anchor`：仅 `app.overlay` 有意义，九宫格枚举 `top-left/top-center/top-right/center-left/center/center-right/bottom-left/bottom-center/bottom-right`，缺省 `bottom-right`；其他区域忽略该字段；
- `title`：可选展示名（`settings.panel` 用作设置分类标题；`panel.tab` / `rail.view` 用作页签 / 导航标签，缺省用 `id`）。

### 10.2 三条硬纪律

1. **pointer-events**：overlay / background / corner 容器一律 `pointer-events-none`（不挡宿主交互）；插件需要交互的子树自己开 `pointer-events-auto`（如宠物本体）；
2. **性能**：常驻动画只走 CSS transform/opacity（合成器线程）；`prefers-reduced-motion` 必须退化（如 `@media (prefers-reduced-motion: reduce) { … animation: none }`）；禁主线程重计算；
3. **可见性**：`app.background` 在默认不透明界面下**不可见**（与自定义背景图同规则）——氛围光效请走 `app.overlay` + 半透明渐变 / `mix-blend-mode`，不要写看不见的插件。

### 10.3 其他约定

- `chat.corner.top-right` 现为空角（UI v3 起任务列表并入右侧上下文面板「任务」页签，聊天区四角不再有宿主悬浮层）；
- 同角多贡献纵向堆叠，顺序 = 启用先后（先启用的在上）；
- `chat.diff-sidebar` 贡献直接进入右侧上下文面板的「变更」页签；可通过 `useUiStore((s) => s.showDiffSidebar)()` 打开该页签，不要再创建第二套悬浮侧栏；
- `settings.panel` 贡献渲染为设置弹窗的独立分类（分类 id `plugin:<name>:<cid>`，标题 = `title`），随插件启停自动增删；
- `panel.tab` / `rail.view` 贡献同样随插件启停自动增删：正选中的页签 / 视图所属插件被禁用时，面板回到「任务」、主区回到聊天；
- 排查：贡献根元素外层的宿主容器挂 `data-plugin="<name>"` 属性（插件无需自己做）；
- **内置插件**：`resources/ui-plugins/builtin/` 随包分发，应用首次启动/升级时导出到用户插件目录（与用户插件同一条扫描/构建/热重载路径，面板带「内置」badge、启用免二次确认）。**直接改内置副本会在下次升级被覆盖——魔改请把目录改名另存**（`plugin.json` 的 `name` 同步改）；手动删除的目录本版本内不会回来，下次升级重新导出；
- 新 hooks（`drone-ui.d.ts` 已声明）：`useContextUsage(sessionId)` 返回 `{ tokens, contextWindow, percent }`（事件驱动刷新，token 仪表盘用）；`useLanguage()` 返回 `"zh" | "en"`（插件自有文案跟随中英）。

### 10.4 示例

`_examples/overlay-pet/`（桌宠：跟 `useTranscriptStore` 的 agentActive 呼吸，CSS transform 动画 + reduced-motion 退化）与 `_examples/token-meter/`（迷你仪表盘：`useContextUsage` + `chat.corner.top-right`）——照抄改即可。

## 11. 无头插件（Phase 4）：不渲染任何组件的常驻副作用

Slot 是「替换组件」，Contribution 是「加挂组件」，Headless 是「零组件」：插件只提供一段常驻逻辑（订阅宿主 store、定时器、播放音频……），适合语音提醒、状态监控、通知桥接类功能。manifest 声明 `"headless": true`（与 slots/contributions 至少其一，可并存——同一插件既替换组件又跑副作用）：

```json
{
	"name": "voice-alerts",
	"droneUi": 1,
	"main": "src/index.ts",
	"headless": true
}
```

入口导出 `activate(): (() => void) | void`：插件加载（含热重载重载）时调用；返回的清理函数在**禁用/卸载/热重载替换**时调用（无返回值则无清理）：

```ts
import { stores } from "@gyoungwe/plugin-api";

export function activate() {
	// 命令式访问宿主 store（无头插件没有组件，不用 hook）
	const unsub = stores.useTranscriptStore.subscribe(() => { /* ... getState() 取最新 ... */ });
	return () => unsub(); // 清理：解订阅/关定时器，别留泄漏
}
```

纪律：
- `activate` 抛错或缺导出 → 该插件记为加载失败（等同槽位导出缺失），不炸宿主；清理函数抛错只告警；
- 与组件插件同一条启用/信任/热重载路径，面板中「无槽位/无贡献」即无头插件；
- 实现要点：全局安静检测 + `new Audio(dataUrl)` 播放，开关即插件启用开关（禁用 = 卸载副作用）。Drone 已不再随包内置这类插件。

## 12. 知识界面公开端口（plugin-api 1.2）

`window.DroneUI.knowledge` 仅公开 `@gyoungwe/plugin-api/ui` 的 `KnowledgeUiPort` 方法，宿主通过既有 preload/IPC 执行，保留授权和路径边界。插件不得访问 `window.pi`。`KnowledgeUiBindings` 定义组件、hooks、stores 与辅助函数的类型投影；声明、shim 与挂载对象由 host-api.manifest.json 同步生成。

整页与嵌入区的产品界面由插件拥有；宿主只维护数据事件桥、上下文和轻量回退。全局审核/通知用既有 `app.overlay`，停用时卸载，重新启用读取当前 store。插件必须提供自己的 CSS 与知识文案，不能依赖宿主保留产品样式。

### Markdown navigation ownership

`Markdown` accepts optional `onLink(href: string): void`. When provided, the host renders the supplied Markdown without knowledge-link rewriting and forwards anchor clicks to the contribution after preventing default navigation. Host knowledge lookup/store and resource-preview routing do not run. The contribution must use its own runtime and approved opening capabilities; receiving a URL is not permission to open local files or launch an external application. Omitting `onLink` retains the published UI v1 behavior until its consumers migrate.
