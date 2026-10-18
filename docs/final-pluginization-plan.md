# Drone 最终插件化计划

> **2026-10-17 评审决议（优先于下文任何冲突表述）**
>
> 1. **第一个插件是 `pi-knowledge`**：先让它在原生 Pi 里跑通知识闭环（本地优先检索 → 不足再联网 → 沉淀 → 带来源回答），同时推进主线（见 `drone-refocus-plan.md`）。analysis 和 evidence 在 v1 不单独成包。
> 2. **插件放独立仓库 `drone-plugins`**（一个 workspace，多包分开发布）。为了降低风险，插件先在当前仓库的 `packages/pi-*` 里通过外部安装 smoke，再迁移过去（见 §3.9）。
> 3. **前端重新设计**：视觉和信息架构以 Claude 出的设计稿为准（§3.10），不再遵守"不改视觉"这一条。
> 4. **一级导航**：新任务 · 知识库 · 技能与连接 · 主机，再加上「项目」「最近」两个分组。"运行"和"证据"不做一级入口，放进右栏。
> 5. **收敛闸门**：发版硬性要求只有 `MCP-01`、`MEM-01`、`REDLINE-01` 三条；兼容矩阵只测 Pi `1.1.0`（锁定版本，同时也是最低版本）和 `latest`（每周 CI）；能力协商 v1 只区分 `compatible` 和 `incompatible` 两种结果。
> 6. **数据位置不变**：原生 Pi 的运行数据沿用现有 `.pi/` 下的位置和 Vault，不新增 `.drone/` 目录，也不改变已落盘文件的格式。
> 7. **npm scope 已确定**：公开包统一使用 `@gyoungwe/`。首批发布顺序为 `plugin-api` → `pi-core` / `pi-knowledge` / `pi-research` → `research-suite`；发布动作只受 npm 登录状态阻塞。
>
> 历史 PR 执行清单见 §9.1；当前剩余 v1.1 的目标、顺序和完成判定见 §9.2。

## 1. 目标

Drone 的最终交付形态是：**原生 Pi 作为运行时，Drone 能力通过可下载的 Pi Packages 提供，Drone Desktop 作为可选增强宿主**。

用户安装一个聚合包即可体验核心能力：

```sh
pi install npm:@gyoungwe/research-suite@0.1.3
pi
```

原生 Pi 应能使用任务编排、知识和记忆、研究工作流、生信分析、证据、连接器、结果红线和长会话恢复。Desktop 额外提供 Run Inspector、Knowledge Graph、Evidence、Compute 和连接器面板，但核心能力不能依赖 Electron。

LAN 已从最终方案中删除，不再保留 LAN adapter、LAN 页面、LAN 验收项或 LAN 发布承诺。

## 2. 当前基础和需要改变的地方

当前仓库已经具备插件化基础：

- `packages/extensions` 已有研究、知识、Zotero、source archive 和 policy 扩展。
- `.pi/extensions` 和 `.pi/lib` 已有生成产物。
- `.pi/lib/workbench-manifest.json` 已经承担资源清单职责。
- `packages/desktop/resources/skills` 已有随包分发的 skills。
- `packages/desktop/resources/ui-plugins` 已有 Desktop UI slot/region 合同。
- `docs/distribution-parity.md` 已记录打包资源与用户私有状态的边界。

当前缺口是：这些能力仍以 Drone 仓库和 Desktop 运行时为中心，还没有一个稳定的、可独立安装、可独立升级、可独立卸载的公开 Pi Package 结构。

## 3. 插件分层

### 3.1 `@gyoungwe/pi-core`

原生 Pi 必装插件，负责：

- 任务生命周期、todo、progress 和错误回执。
- Proposal、一次授权、取消、重试和恢复。
- `runAttemptId`、`causationId` 和公开运行事件。
- 自动、手动、关闭三种编排策略。
- `observed`、`verified`、`exploratory`、`unreviewed`、`pending-review`、`stale`、`unknown`、`blocked` 等结果状态。
- v3 结果红线。
- 原生 Pi 的文本和 JSON 回执。

该插件只能依赖 Pi Extension API、Node 标准库和 Drone 公共合同，不能 import Electron、renderer 或 Desktop backend。

### 3.2 `@gyoungwe/pi-knowledge`

负责本地知识库、FTS/语义检索、topic memory、跨会话连续性、知识沉淀、review、stale 检查和 publication gate。

没有绑定 Vault 时返回 `unconfigured`，不能伪装成知识库已启用。

### 3.3 `@gyoungwe/pi-research`

负责研究规划、文献搜索和读取、来源回执、引用绑定、research run、source archive 和 Show Me 的文本降级结果。

### 3.4 `@gyoungwe/pi-analysis`

负责无宿主副作用的 `AnalysisAdapter`、`Registry`、未知流程识别、候选 adapter/workflow、fixture/静态/科学验证和 review→delivery 合同；计算提交、执行、授权、持久化和 discovery 评测仍由宿主组合根负责。

编译成功、命令生成成功和计划生成成功都不能被报告为执行成功。

### 3.5 `@gyoungwe/pi-evidence`

负责 artifact manifest、provenance、checkpoint、branch、evidence capsule、replay/import、SHA-256、workflow digest 和 container digest。

原生 Pi 使用文本和 JSON 回执；Desktop 只负责图形化查看，不重新实现证据逻辑。

### 3.6 `@gyoungwe/pi-connectors`

连接器作为可选插件独立分发：

- Zotero
- WebDAV
- Obsidian/MCP
- Institutional access
- generic MCP
- 外部搜索和浏览器适配器

每个连接器必须声明权限、网络范围、凭据来源、是否读写、外部副作用、宿主要求和回读/删除验收流程。

### 3.7 `@gyoungwe/desktop-ui-pack`

仅面向 Drone Desktop，负责 Run Inspector、过程视图、Knowledge Graph、Evidence/Artifacts、Compute、连接器和设置面板。

它只能依赖 `@gyoungwe/plugin-api`。卸载该插件后，原生 Pi 的核心能力仍然可用。

### 3.8 `@gyoungwe/research-suite`（外部插件仓库）

聚合包不承载领域实现，源码权威位置是绑定的 `../drone-plugins/packages/research-suite/`；Drone 宿主不再保留该包或 suite 专属检查脚本。**Pi 不会自动加载依赖包里的资源**：依赖只会被安装，供代码 import。作为依赖的 Pi 包必须打进 tarball（`bundleDependencies`），并在 `pi` 清单里用 `node_modules/...` 路径逐个引用。Pi 宿主包（`@earendil-works/pi-*`）只能写在 `peerDependencies` 里，否则会出现重复实例。

```json
{
  "name": "@gyoungwe/research-suite",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": [
      "./node_modules/@gyoungwe/pi-core/dist/index.mjs",
      "./node_modules/@gyoungwe/pi-knowledge/dist/index.mjs",
      "./node_modules/@gyoungwe/pi-research/dist/index.mjs"
    ],
    "skills": [
      "./node_modules/@gyoungwe/pi-core/skills/*",
      "./node_modules/@gyoungwe/pi-knowledge/skills/*",
      "./node_modules/@gyoungwe/pi-research/skills/*"
    ],
    "prompts": ["./prompts/*.md"]
  },
  "dependencies": {
    "@gyoungwe/pi-core": "0.1.0",
    "@gyoungwe/pi-knowledge": "0.1.0",
    "@gyoungwe/pi-research": "0.1.0"
  },
  "bundleDependencies": ["@gyoungwe/pi-core", "@gyoungwe/pi-knowledge", "@gyoungwe/pi-research"],
  "peerDependencies": { "@earendil-works/pi-coding-agent": ">=1.1.0 <2.0.0" }
}
```

验收由 `drone-plugins` 的 workspace `npm run check`、真实 tarball staging 和 `smoke:install` 负责；宿主通过 `npm run check:pi-compat -- --targets locked,latest` 与 `npm run check:public-plugin-host` 验证已发布包的消费路径。三个扩展、skills、依赖去重和卸载必须都有可回读证据；`/drone-doctor` 与 `/drone-example` 由 `pi-core` 注册，并在已发布 suite 的真实 Pi CLI 矩阵中回归。[Pi Packages 文档](https://pi.dev/docs/latest/packages)

### 3.8.1 v1 包与现有代码的映射

| 发布包 | 来源（当前仓库） | v1 范围 |
|---|---|---|
| `pi-core` | `@drone/tasks` + 从 `packages/backend/src/tools` 迁出的通用工具（`ask_user`、`set_status`、`todo`、`deliver_files`、`memory_save`） | 任务、授权、结果状态、红线、回执 |
| `pi-knowledge`（**第一个**） | `@drone/knowledge` + `packages/extensions/src/knowledge-extension.ts`、`obsidian-workbench.ts`、`workspace-config.ts` | 知识闭环 |
| `pi-research` | `@drone/research` + `packages/extensions/src/research-*.ts`、`source-archive.ts`、`zotero-literature.ts`、`institutional-access.ts` | 研究流程、来源回执；证据和 provenance 先放在这里 |
| `pi-connectors` | 从 `pi-research` 中拆出 Zotero / WebDAV / 机构访问 | **v1 不拆**，放到 v1.1 |
| `pi-analysis`、`pi-evidence` | 分散在 backend 的 analysis-adapters、`@drone/compute`、`@drone/discovery`、shared 的 redline 相关代码 | **v1 不做**，避免额外搬家 |
| `desktop-ui-pack` | 现有的 UI 插件宿主和面板 | P5 |

以下工具仍然只在 Desktop 中可用，v1 不迁移：`subagent`、`ssh`/`ssh_hosts`、`compute_route`、`bio_*`、`channel_*`、`capability_load`、`webfetch`、`show_image`。原生 Pi 用户可以用 `pi-subagents`、`pi-web-access`、`pi-mcp-adapter` 这些现成包替代。

### 3.9 仓库边界与迁移策略

插件化不等于把当前 Drone 仓库改成纯前端仓库。Drone 仍然需要持有 Desktop renderer 核心、Electron main/preload、backend、IPC、安全边界、宿主适配器和公开合同；这些共同组成**宿主产品仓库**。插件源代码再迁移到独立的 `drone-plugins` 仓库，形成一个可独立发布多个包的 workspace：

```text
drone/                 # 宿主产品仓库
  desktop/             # renderer 核心、main、preload、内置 UI shell
  backend/             # session engine、host services、storage、adapters
  shared/              # 公共合同；逐步收窄出 plugin-api/result-contract
  plugin-api/          # 对插件公开的最小 API（目标包）
  host-adapters/       # native-pi / Drone Desktop 宿主实现

drone-plugins/         # 已绑定的 ../drone-plugins（Gyoungwe/drone-plugins；一个 workspace，多包独立发布）
  pi-core/
  pi-knowledge/
  pi-research/
  pi-analysis/
  pi-evidence/
  pi-connectors/
  desktop-ui-pack/
  research-suite/
```

仓库归属规则：

- `drone` 只发布宿主、公开合同和宿主适配器；不能把 backend 私有实现当作插件 API。
- `drone-plugins` 只能依赖已发布的 `@gyoungwe/plugin-api`、结果/证据合同和 Pi 的 `peerDependencies`；禁止依赖 Drone 源码相对路径、Electron 或 backend 私有模块。
- UI 插件只能使用 `@gyoungwe/plugin-api` 和公开 UI 类型；核心聊天、权限、安全、会话状态和设置壳仍属于宿主。
- 插件仓库先保持一个 workspace，不为每个插件单独建 Git 仓库；只有在团队边界和发布节奏确实分离后再拆分。
- 插件 manifest 必须声明 `pluginApi`、`minHostVersion`、支持的宿主、能力、权限和结果合同版本。

迁移只设两道闸门（2026-10-17 收敛）：

1. **外部安装闸门**：插件在当前仓库的 `packages/pi-<name>/` 里，用 `npm pack` 后在临时 HOME 执行 `pi install` 的方式完成安装、调用、卸载 smoke（放进 CI）。要证明它不依赖任何源码相对路径，也不 import `@drone/backend`、`@drone/desktop` 或 electron。
2. **迁移闸门**：`pi-knowledge` 通过外部安装闸门和 `MEM-01` 之后，就新建 `drone-plugins` 仓库，把它迁过去（用 `git subtree split` 保留历史）。后续的包逐个通过闸门 1 后再迁移。

插件仓库依赖宿主仓库发布的两个包：`@gyoungwe/plugin-api`（类型和 HostPort 接口）和 `@gyoungwe/result-contract`（结果状态、红线、回执 schema）。在这两个包正式发布到 npm 之前，`drone-plugins` 用 `npm pack` 出的 tarball 或 git 依赖锁定具体 commit，**不允许用相对路径引用 drone 仓库**。

发布顺序：宿主先发布 `plugin-api`，插件仓库再跑 CI（Pi `1.1.0` + `latest`），之后发 canary，在原生 Pi 里跑一次真实知识闭环任务，最后才更新 `research-suite`。

### 3.10 前端：重新设计与信息架构（2026-10-17 改写）

前端以 Claude 出的设计稿为准（设计稿：https://claude.ai/artifact/RLTGyvjkAHsf8HN8bwDwek ，包含 运行中、首页、技能与连接、知识库 四个画面和一个共享侧栏组件）。视觉 token 沿用 `drone-clawsgo-ui-parity-plan.md` 的 U1：中性灰阶，强调色只用于 @ 引用、运行指示点和焦点环。本节只规定结构，像素级细节看设计稿。

**一级导航（左侧栏，从上到下）**

```text
[空间切换]
新任务          ⌘N
知识库          搜索 + 最近沉淀 + 待处理修改 + 网络图
技能与连接      Skills · MCP · 连接器（Zotero/WebDAV/机构访问）· 已安装插件
主机            本机 · SSH 主机 · 计算作业
──── 项目 ────
──── 最近 ────  （运行中的任务带绿点）
[头像菜单：设置 · 扩展（UI 插件）· 帮助 · 关于]
```

- "研究"不单独做入口。研究就是在「新任务」里发起的任务，首页三张卡（研究 / 知识库 / 接力）是它的快捷入口。
- 不设"运行"和"证据"一级入口。它们放进右栏：页签为 **总览 / 文件 / 变更 / 主机**。总览从上到下依次是：用量 → 步骤 → 交付物 → 子智能体 → 证据（有内容时才出现）→ 审稿 / 决策（有待处理项时才出现）。
- 插件不能新增一级导航。插件只能贡献 `panel.tab`、`rail.view`、`context.action`、`command` 和现有的 slot。只有提供完整、持久工作区的插件，才能申请 `nav.item`，并且需要宿主白名单批准。

**能力状态的统一表达**（在「技能与连接」里显示，任务里引用这些能力时也用同一套）

| 状态 | 样式 | 主操作 |
|---|---|---|
| 可用 | 灰色圆点 + 版本号 | — |
| 需要配置 | 琥珀色描边徽标 | 配置 |
| 运行中 | 绿色脉冲圆点 | 查看 |
| 已禁用 | 文字变灰 | 启用 |
| 权限不足 | 琥珀色徽标 | 授权 |
| 来源过期 | 琥珀色徽标 + 时间 | 重新读取 |
| 宿主不兼容 | 红色徽标 | 查看所需版本 |

不能把处于不可用状态的能力渲染成普通的成功入口。

**迁移规则**

1. 旧入口在一个版本内保留兼容跳转，之后删除。
2. 页签 id 保持不变（`tasks` 映射为「总览」），只改显示名称和分组，避免影响测试和持久化。
3. `UI-01` 验收时同时检查插件真实生效和宿主回退两种情况，菜单卡片能显示不算完成。

## 4. 宿主适配器

插件通过稳定的 `DroneHostPort` 访问宿主能力：

```ts
interface DroneHostPort {
  host: "native-pi" | "drone-desktop";
  capabilities(): HostCapabilities;
  readSource(input: ReadSourceInput): Promise<ReadReceipt>;
  searchKnowledge(input: SearchInput): Promise<SearchResult>;
  persistRun(snapshot: RunSnapshot): Promise<RunReceipt>;
  runCompute(input: ComputeRequest): Promise<ComputeReceipt>;
  requestAuthorization(input: AuthorizationRequest): Promise<AuthorizationReceipt>;
}
```

### Native Pi adapter

- 使用本地文件系统、Pi session entries、Node 子进程和 `ctx.ui`。
- 运行数据沿用现有 `.pi/` 下的位置和格式（2026-10-17 决议：不新增 `.drone/`）；不写入正式 Vault 正文或 Pi 私有 session 正文。
- 所有结果都提供文本和 JSON 表达。

### Drone Desktop adapter

- 使用 backend services、JsonStore、shared contracts、preload/IPC 和 Desktop 面板。
- 保持现有 renderer → preload → IPC → backend 分层。
- Desktop 不得把内部实现暴露给插件。

不再实现 LAN adapter。远程观察如果未来重新需要，作为独立产品项目重新设计，不进入本计划。

## 5. 插件清单和权限声明

每个插件必须有 manifest：

```json
{
  "schemaVersion": 1,
  "id": "drone-analysis",
  "version": "0.1.0",
  "pi": {
    "apiVersion": 1,
    "minHostVersion": "<baseline>",
    "testedHosts": ["<baseline>", "<latest>"]
  },
  "drone": {
    "pluginApi": 1,
    "resultContract": "drone-result/v3"
  },
  "entrypoints": {
    "extension": "./dist/index.mjs",
    "skills": "./skills",
    "prompts": "./prompts"
  },
  "capabilities": ["analysis", "compute", "evidence"],
  "hosts": ["native-pi", "drone-desktop"],
  "permissions": {
    "filesystem": ["workspace", "configured-vault"],
    "network": [],
    "subprocess": ["declared-runner"],
    "externalWrites": false
  }
}
```

manifest 是声明，不是安全边界。Pi extension 在 Pi 进程内运行，拥有该进程的操作系统权限，因此安装来源、版本、项目可信和每次副作用授权都必须保留。[Pi Extensions 文档](https://pi.dev/docs/latest/extensions)

## 6. Pi 版本兼容和更新策略

### 6.1 三个独立版本

1. **Pi 宿主版本**：用户安装的 Pi。
2. **Drone Plugin API**：插件访问宿主的稳定接口，例如 `pluginApi: 1`。
3. **Drone Result Contract**：结果红线、证据、状态和审计格式，例如 `drone-result/v3`。

Pi 升级不能直接改变 Drone 结果语义。

### 6.2 插件不打包 Pi runtime

原生插件对 Pi host packages 使用 `peerDependencies`，不把 Pi runtime 复制到插件中。Desktop 应用内部可以锁定一个明确的 Pi SDK 版本，但插件包不能依赖 Desktop 的私有版本。

### 6.3 启动时能力协商

插件加载时检查：

- Pi host version
- Pi API version
- `registerTool`
- `registerCommand`
- `appendEntry`
- dynamic tool exposure
- MCP registration
- session lifecycle events
- UI availability

结果分为：

- `compatible`：完整加载。
- `degraded`：**v1 不实现**（2026-10-17 决议），等有真实需求时再加。
- `incompatible`：不加载半套能力，显示升级提示。

不能通过简单的“按钮还在”判断兼容成功。

### 6.4 支持矩阵

每次 Pi 更新至少测试：

| 环境 | 用途 |
|---|---|
| 最低支持版本 | 防止插件失去旧用户 |
| Desktop 锁定版本 | 正式应用基线 |
| 最新稳定版本 | 发现当前兼容问题 |
| next/canary | 提前准备下一版本 |

> 2026-10-17 决议：最低版本和锁定版本目前都是 `1.1.0`，v1 的 CI 只跑两列：`1.1.0`（每个 PR）和 `latest`（每周定时）。next/canary 等 Pi 2.0 预发布时再加。

测试内容包括安装、卸载、skill、tool、MCP、session 恢复、evidence、结果红线、真实示例任务和降级路径。

### 6.5 Pi 更新流程

1. 阅读 Pi release notes，检查事件、工具、MCP、session 和 UI API 变化。
2. 建立 `pi/<version>` 兼容分支。
3. 更新 peer range 和类型声明。
4. 更新 `pi-compat` adapter。
5. 跑最低、锁定、最新和 next 四组矩阵。
6. 用原生 Pi 完成真实研究任务。
7. 用 Desktop 完成同一任务，比较 run ID、结果状态和证据。
8. 发布 canary 插件。
9. canary 稳定后更新 `@gyoungwe/research-suite`。

### 6.6 版本升级规则

- Pi patch/minor 且 API 不变：插件发布 patch 或 minor。
- Pi API 变化但可通过 adapter 兼容：更新兼容层，插件保持 major 不变。
- Pi major 或结果生命周期变化：发布新的插件 major，保留上一代 adapter 一个周期。
- 不使用未锁定的 `latest` 作为正式发布依赖。
- npm 版本、Git ref、插件 hash 和测试矩阵写入 release manifest。

### 6.7 已确认的 Pi 版本基线

截至 2026-10-17，仓库的唯一有效运行基线是 **Pi 1.1.0**：

- `packages/backend/package.json`、`packages/desktop/package.json` 和 `packages/shared/package.json` 均固定 `@earendil-works/pi-*` `1.1.0`；
- `package-lock.json` 将 `pi-ai`、`pi-coding-agent`、`pi-agent-core`、`pi-mcp` 等运行包解析为 `1.1.0`；
- `node_modules` 实际安装的 Pi 包也是 `1.1.0`，`npm ls --depth=0` 无重复版本；
- 发布记录 `v0.25.3` 至 `v0.25.7`、release workflow 和运行时 external 配置均以 Pi 1.1.0 为依据；
- 没有旧治理基线对应的当前依赖、lockfile 条目或安装包；旧治理版本是历史残留，不能作为插件发布基线。

统一版本策略如下：

1. **运行基线**：第一版插件生态统一使用 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` `1.1.0`，发布包和 Desktop 继续 exact pin；不把 `latest`、浮动 Git ref 或用户本机 Pi 版本当作正式依赖。
2. **插件兼容范围**：插件 manifest 声明 `pi >=1.1.0 <2.0.0`，但只有经过真实桌面端和原生 Pi 双矩阵验证的 minor/patch 才标记为 supported。低于 `1.1.0` 的环境直接返回 `incompatible` 和升级指引，不做隐式降级或半加载。
3. **Drone 合同版本**：插件 API 保持 `1`，结果/证据合同保持 `v3`；Pi 小版本变化由 `pi-compat` adapter 吸收，不能改变结果红线。Pi major 或 session/result 生命周期变化时发布新的插件 major，并保留上一代 adapter 一个更新周期。
4. **升级闸门**：升级前更新 `pi/<version>` 兼容矩阵、锁文件和 release manifest；跑 lint、typecheck、单测、build、architecture check，以及原生 Pi/Desktop 同一真实任务验收。通过后先发 canary，再提升为 current。
5. **版本漂移监控**：`/drone-doctor` 输出 schema v1 的 host kind/version/source、插件版本/兼容范围、核心工具和 onboarding 命令检查；缺失工具或命令时为 `blocked`，无法读取 host 版本时为 `unknown`，并给出下一步修复提示。它只读，不修改安装或用户数据。
6. **旧版处理**：不为首版插件生态保留旧版兼容分支；若未来必须支持旧版，单独创建兼容 adapter 和插件 major/实验通道，完成独立回归后再决定是否纳入支持矩阵。

## 7. 安装和首次使用

安装聚合包后，以下命令有稳定注册、输出合同和真实 CLI smoke 证据：

```text
/drone-init
/drone-doctor
/drone-example
```

`/drone-init` 只完成配置和无副作用检查，不自动写入 Zotero、WebDAV 或远程主机。

`/drone-doctor` 由 `@gyoungwe/pi-core@0.1.1` 注册，返回 schema v1 JSON；检查核心工具、两个 onboarding 命令和 Pi host 版本。状态为 `pass`、`blocked` 或 `unknown`，不会写入外部服务。

`/drone-example` 默认只预览证据门控研究示例，返回 `needs-data`、`blocked` 或 `ready`；`/drone-example --run <研究问题>` 才排队只读示例回合，状态为 `started`，要求本地知识、至少两篇来源和 source receipts，不隐式写入 Zotero、WebDAV、远程主机或用户 Vault。

## 8. 与 Claude Code 的内核选择

### 结论

**现阶段不把 Pi 换成 Claude Code 作为 Drone 内核。**

保留 Pi 作为第一内核，同时把 Drone 的宿主合同设计成可接入第二种 host。未来可以增加 `claude-code-host-adapter`，但不让整个插件生态绑定 Claude Code。

### 保留 Pi 的理由

- 当前仓库已经围绕 Pi extension、skills、`.pi` 资源、tool exposure、MCP 和 session lifecycle 建立了大量实现。
- Pi 的 package 模型直接支持我们需要的 extensions、skills、prompts 和 themes 分发。[Pi Packages](https://pi.dev/docs/latest/packages)
- Pi extension API 暴露工具、命令、生命周期事件、session entry、MCP、动态工具集和自定义渲染点，适合实现结果红线、证据回执和长会话恢复。[Pi Extensions](https://pi.dev/docs/latest/extensions)
- 我们需要控制运行生命周期、持久化、证据门禁和能力暴露，而不是只接入 MCP 工具。
- 原生 Pi 让“下载插件后直接体验”成为独立产品，不依赖 Drone Desktop。

### Claude Code 的适合位置

Claude Code 确实适合作为可选宿主：它支持 MCP 连接外部工具和数据源，也提供 SDK/CLI 集成方式。[Claude Code MCP](https://docs.anthropic.com/en/docs/mcp) [Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code/sdk)

它可以作为：

- 外部模型/执行宿主。
- 通过 MCP 使用 Drone 的研究工具。
- 通过 subprocess 或 JSON 输出运行一个 Drone task。
- 第二套用户入口，用来验证 Drone contracts 是否真正跨宿主稳定。

但 Claude Code 官方客户端会自动更新，并且其插件、生命周期和持久化边界由 Claude Code 产品决定；这更适合做宿主适配器，而不适合作为 Drone 结果合同和证据系统的唯一内核。[Claude Code 设置与更新](https://docs.anthropic.com/en/docs/claude-code/getting-started)

### 未来的 Claude Code adapter

如果以后接入，边界应是：

```text
Claude Code CLI/SDK
        ↓
claude-code-host-adapter
        ↓
DroneHostPort + drone-result/v3
        ↓
Drone capability plugins
```

Claude Code adapter 必须通过同一套：

- task authorization
- result redlines
- evidence receipts
- provenance
- unknown/blocked 状态
- connector write/read/delete 验收

如果 Claude Code 只能执行 MCP 工具而不能保留这些合同，就只能作为工具宿主，不能替代 Drone 内核。

### 重新评估 Claude Code 的条件

只有在以下条件同时出现时，才重新评估是否迁移内核：

1. Pi 维护成本持续高于 Claude Code adapter 维护成本。
2. Claude Code 提供稳定且足够完整的生命周期、持久化和插件 API。
3. Claude Code 能原生承载 Drone 的结果红线和 evidence gate。
4. 同一套插件在 Pi 和 Claude Code 上的真实验收结果一致。
5. 迁移不会损失原生 Pi 用户和现有 `.pi` 数据。

## 9. 实施阶段

### 9.0 当前状态快照（2026-10-18）

状态只表示仓库当前证据，不表示最终插件化已经交付：

| 能力 | 当前状态 | 已有证据 | 缺口 / 下一步 |
|---|---|---|---|
| UI 插件宿主（slot/region、manifest、热重载、错误边界） | **UI-01 真实宿主验收通过** | `packages/desktop/src/main/ui-plugins/ui-acceptance.test.ts`：真实内置 bundle 经 manager 构建/读取，renderer registry contribution 出现、移除、重载 nonce 递增，配置跨 manager 重启保持；`check:ui-skill-acceptance` 报告 `/private/tmp/drone-ui-skill-acceptance.json` | 交互式 Electron 在当前 shell 仍受 macOS `NSApplication` 启动阻塞；GUI 截图单独记为环境观察，不改变宿主 lifecycle 结论 |
| 知识、topic 和记忆 | **MEM-01 隔离验收通过** | `packages/backend/test/mem-gate.test.mjs`：隔离 Vault 的 `memory-note.md` 写入 `DRONE-MEM-001`，新 memory 实例恢复 topic/来源/未解决问题，源修改后 `refreshSourceCheck` 返回 `stale/changed`；证据写入 Node `os.tmpdir()` | 继续保持原生 Pi/桌面共享同一 topic-memory 合同；真实用户 Vault 不参与验收 |
| Skills | **SKILL-01 真实 SDK 验收通过** | `packages/backend/test/skill-acceptance-sdk.test.mjs`：真实 Pi SDK + offline faux provider 完成 `/skill:research-workflow` 展开、模型回合、visible skill 与 invocation 记录；自动禁用反证与 manual-only 证据写入 Node `os.tmpdir()` | `disable-model-invocation` 只禁自动选择；显式 `/skill:` 按 Pi 契约保留，UI 必须显示 manual-only |
| MCP / 研究连接器 | **隔离真实调用已通过；WebDAV/Zotero 写入闭环已验收** | `packages/backend/test/mcp-connector-gates.test.ts` 以 staged `pi-mcp-adapter` 启动本地 stdio fixture，启用后真实 tool call 返回 `DRONE-MCP-001`，关闭并重载后无工具/无 marker；同一测试通过 read-only `CapabilityResearchPorts` 对唯一词 `DRONE-CONN-01-UNIQUE` 回读稳定 source ID/URL/调用记录，关闭后跳过传输、重新启用可重试；WebDAV 与 Zotero 均有真实临时对象回执；Protocols.io 保持只读 | 复跑 `check:remaining-gates` 并在根门禁中保留该证据；Protocols.io 不进行写入 |
| 外部写入回读删除 | **WebDAV/Zotero 已通过；Protocols.io 只读** | WebDAV 与 Zotero 均完成授权→创建→回读→删除→再回读；凭据仅在进程环境使用 | 保持 Protocols.io 只读；后续若启用写入，必须另行授权并保留同等回读证据 |
| 结果红线、evidence、provenance | **REDLINE-01 隔离验收通过** | `npm run check:redline`：4/4 fixture suites；publication / metacognitive / orchestration 门禁均返回 blocked 或 pause，sealed proof 含原因、差异路径和审计 ID | 构建产物已包含结果红线资源；交互式桌面截图仍是可选观察，不改变领域门禁结论 |
| Pi 运行基线 | **suite 与 onboarding commands 真实 CLI 回归通过；旧版冲突负例保留** | `drone-plugins` `8389116` 的 `scripts/pi-cli-regression.mjs` 在独立 HOME 中对 Pi `1.1.0`/latest（实际解析 `1.3.0`）执行真实 `pi install` 与 `/task-status`、`/drone-doctor`、`/drone-example`；`research-suite@0.1.3` 两个版本 PASS；已弃用 `0.1.1` 两个版本均以 stderr `conflicts` 和退出码 1 失败，状态为 EXPECTED_FAILURE；证据见 [`v1.1-onboarding-commands.json`](releases/v1.1-onboarding-commands.json) | CI 每次 push/PR 重跑锁定/latest；旧冲突负例继续保留 |
| `DroneHostPort` 与通用插件能力协商 | **v1.1 插件迁移与宿主加载已通过** | `@gyoungwe/plugin-api`、HostPort、manifest capability check、`compatible/degraded/incompatible` 测试、迁移闸门和所有 v1.1 包的 clean prefix/loader/宿主检查均已通过 | A5-1～A5-4 已完成兼容层收敛，继续保持已发布包边界 |
| `@gyoungwe/pi-analysis` | **V1.1-A 门槛已关闭** | `drone-plugins` 当前 `main=8389116`（实现提交 `baf9b3b`，包提交 `2168576`）提供自包含 `dist/index.mjs`/声明/manifest；`@gyoungwe/pi-analysis@0.1.0` 已公开发布，registry metadata、shasum/integrity、全新 prefix 安装和 Pi loader 发现均 PASS；backend 以精确版本加载公共包，兼容 facade 保留；计划→执行→审查→交付 focused proof 与 Pi 1.1.0/latest 矩阵通过 | 持续维护由 `drone-plugins` 负责；本仓库不再保留 pi-analysis 源码或构建脚本 |
| `@gyoungwe/pi-evidence` | **V1.1-E 公开 registry 与宿主门槛已关闭** | `drone-plugins` main `8389116`（实现提交 `93576c4`）提供自包含 artifact/provenance/replay 包；`@gyoungwe/pi-evidence@0.1.0` registry tarball 的 shasum `4826a8f5663be2af382cecc227254a547d5f44af`、integrity 与公开元数据一致；全新 prefix 安装、3 个只读工具调用、Pi 1.1.0 loader 和宿主 clean prefix 均 PASS；宿主临时源码已删除 | 持续在 `drone-plugins` 维护；真实文件写入、replay runner 和科研结论门禁仍由宿主组合根负责 |
| `@gyoungwe/pi-connectors` | **V1.1-C 公开 registry 与宿主门槛已关闭** | `drone-plugins` main `8389116`（实现提交 `93576c4`）提供六类只读 connector descriptor、权限声明、回执链和 2 个元数据工具；`@gyoungwe/pi-connectors@0.1.0` registry tarball 的 shasum `1629eb468f607f7be969d347cd03aff2dc0d03e3`、integrity 与公开元数据一致；全新 prefix 安装、Pi loader、6 个 descriptor 和宿主 clean prefix 均 PASS；宿主临时源码已删除 | 真实网络/凭据/写入/回读/删除仍按连接器逐项授权；Protocols.io 保持只读 |
| `@gyoungwe/pi-*` 公共包与 `@gyoungwe/research-suite` | **task ownership、onboarding commands 及 suite 兼容门槛已关闭** | `@gyoungwe/pi-knowledge@0.1.1` 已移除 task runtime 注册并删除重复 `research-workflow` skill；`@gyoungwe/pi-core@0.1.1` 注册 `/drone-doctor`、`/drone-example`；`@gyoungwe/research-suite@0.1.3` 捆绑 plugin-api/pi-core/pi-knowledge/pi-research，公开 tarball、shasum/integrity、干净克隆 check 和真实 Pi CLI 矩阵均通过；旧 `research-suite@0.1.1` 已执行弃用标记“与 pi-core 冲突，无法启动”，完整证据见 [`v1.1-onboarding-commands.json`](releases/v1.1-onboarding-commands.json) | 由 `drone-plugins` CI 在 Pi `1.1.0`/latest 上持续回归 |
| 宿主仓库 / 插件仓库边界 | **pi-knowledge、pi-analysis、pi-evidence、pi-connectors 外部迁移和公开发布闸门已关闭** | [本地 ../drone-plugins](../drone-plugins) `main=8389116`；外部包自包含、无宿主 fallback，干净克隆 `npm ci → npm run build → npm run check`、`publish.yml` 顺序 dry-run、公开 tarball、Pi CLI 和宿主 clean prefix 通过；宿主临时 evidence/connectors/research-suite 源码已删除，根锁文件固定 registry 包 | Desktop/Pi 仅从已安装 npm 包加载；后续只在 `drone-plugins` 维护这些插件 |
| Desktop UI Pack 独立分发 | **V1.1-UI 公开 registry 与宿主安装生命周期已关闭** | `drone-plugins` main `8389116`（实现提交 `93576c4`）的 `@gyoungwe/desktop-ui-pack@0.1.0` registry tarball shasum `73e79d49b0678a0379fbdb7f1ec4d7ebb2b455e5`、integrity 与公开元数据一致；宿主从公开 tarball 安装后由 `UiPluginManager` 发现、启用、读取并完成测试；构建产物验收仍为 16/16 | 公开包继续独立发布；交互式 Electron 截图仍不作为本门槛 |
| 菜单信息架构收敛 | **UI-1～UI-7 已实现；四视口构建与视觉对照通过** | `scripts/check-visual-design-comparison.mjs` 用 Chrome headless 渲染 built renderer，四个视图均无错误、导航态正确、viewport 合同通过；截图和 SHA-256 见 [`releases/visual/drone-visual-comparison.json`](releases/visual/drone-visual-comparison.json)。hosts 没有独立设计板，按共享 shell 板对照并在证据中明确 | 交互式 Electron 仍受当前 shell 的 macOS NSApplication 启动限制；本次视觉门槛使用构建产物，不把环境限制写成失败 |
| LAN 最终方案移除 | **已完成** | 提交 `8d4ad219` 删除 LAN adapter/UI/IPC/manifest/test；`9af99382` 刷新生成运行时；`c99432d0` 清除旧 demo 注释；源码/生成运行时/索引扫描均无 LAN 残留 | 仅历史变更记录保留背景，不再进入产品能力或验收矩阵 |
| 仅 Desktop 可用的工具 | **领域包与宿主边界已收敛** | `pi-core` 已迁移 ask_user/set_status/todo/deliver_files/memory_save 与 tasks runtime；analysis/evidence/connectors 已以公开 Pi 包交付；A5-1～A5-4 已删除 `.pi/lib` 兼容树并统一扩展 manifest/资源路径 | 后续新增能力继续进入领域包和 `drone-plugins`，不回退到 `.pi/lib` |
| 真实桌面发布验收 | **本机构建产物验收已通过** | `260995a0` 的 `check:desktop-artifact --strict`：16/16 检查、4/4 视口、0 `NOT_RUN`、0 `FAIL`；构建产物快照 SHA-256 `9db8e47ec4c039415ca6dc66a1ccd78dd7ca2f7e3f9a1bb78fafa5cac30244e7` | 交互式 Electron 启动受当前 shell 的 macOS NSApplication SIGABRT 阻塞；按当前决议不把它称为降级，也不阻断本地构建产物通过 |

### 9.1 实施阶段（执行版，2026-10-17）

面向执行者（GPT / Codex / Claude Code）。规则如下：
- 每一步一个 PR，按顺序做，前一步合并后再开下一步。
- 每个 PR 的完成标准：`npm run lint && npm run typecheck && npm run test:unit && npm run check:arch && npm run build` 全部通过；涉及扩展的再跑 `npm run check:extensions`。
- `.pi/**` 是生成产物，不手改。
- 不新增安全门、确认流程或抽象层；不改用户数据格式。
- 有偏离计划的地方，写进本文末尾的执行日志。

**PR-1 · 文档校准**（小）
- 清理 LAN 残留：`docs/INDEX.md:270` 表格中的 `lan`、`packages/backend/src/permissions/audit.ts:7` 的注释、`packages/shared/src/host-api/compute.ts:97` 的注释。
- 把本计划复制进仓库 `docs/final-pluginization-plan.md`，并在 `docs/INDEX.md` 里加入口。
- 验收：`git grep -n -i -E '\blan\b' -- packages/*/src docs/INDEX.md` 没有结果。

**PR-2 · 原生 Pi 可用性清单脚本**
- 新建 `scripts/check-native-pi.mjs`：扫描 `packages/extensions/src/**`、`packages/backend/src/tools/**`、`packages/backend/src/capabilities/**`、`packages/tasks/src/runtime/register.ts` 中的工具注册（`registerTool` / `name: "..."`），输出表格：工具名 | 注册位置 | 原生 Pi 可用（是/否）| 目标包（pi-core / pi-knowledge / pi-research / 仅 Desktop）。
- 目标包的映射写死在 `scripts/fixtures/native-pi-tools.json` 里，按 §3.8.1。脚本检查到有工具没有映射就失败。
- 加入根 `package.json`：`"check:native-pi"`。
- 验收：输出结果和 §3.8.1 一致；为它写一个单测。

**PR-3 · `pi-knowledge` 包（第一个插件）**
- 新建 `packages/pi-knowledge/`：
  - `package.json`：`name` 使用已确定的 `@gyoungwe/` scope；`keywords: ["pi-package"]`；`pi.extensions: ["./dist/index.mjs"]`；`pi.skills: ["./skills/*"]`；`peerDependencies` 写 `@earendil-works/pi-coding-agent >=1.1.0 <2.0.0`；`@drone/knowledge` 打包进 dist（esbuild bundle），**不作为运行时依赖**。
  - `src/index.ts`：从 `packages/extensions/src/knowledge-extension.ts`、`obsidian-workbench.ts`、`workspace-config.ts` 组装入口。复用现有源码，不复制。
  - `skills/`：从 `packages/desktop/resources/skills` 里挑出知识相关的 skill，复制过来（构建脚本复制，不用软链接）。
  - 没有绑定 Vault 时，所有知识工具返回 `unconfigured`，并给出 `/drone-init` 的提示。
- 新建 `scripts/smoke-pi-package.mjs <dir>`：先 `npm pack`，然后在 `mkdtemp` 出的临时 HOME 里执行 `pi install <tgz>`，再用 `pi --print`（或者 Pi 1.1.0 实际支持的 headless 参数，需先核实）调用一次 `knowledge_status`。断言返回 `unconfigured`；绑定 fixture Vault 后，断言能检索到一条测试笔记；最后卸载，断言工具已经不存在。
- CI 增加 `pi-package-smoke` job。
- 检查：`packages/pi-knowledge/dist` 里不能出现 `electron`、`@drone/backend`、`@drone/desktop`，也不能有任何 `../../` 开头的 import（加进 `check:arch`，作为 R8）。
- 验收：smoke 在 Linux 和 macOS 上都通过；Desktop 行为不变（原有的 knowledge 测试不改就能通过）。

**PR-4 · 原生 Pi 知识闭环**（主线）
- 在 `pi-knowledge` 中实现：本地优先检索 → 命中不足时提示或调用联网（`pi-web-access`，存在才用）→ 自动沉淀（文献 / 软件 / 方法 / 想法四类；新笔记直接入库，修改已整理过的页面才进入审核）→ 带来源回答。
- 同时改进检索（来自 `drone-kb-retrieval-and-graph.md`）：`read` 返回 `links` 和 `backlinks`；`search` 默认 limit 6，片段 ≤ 300 字；`knowledge_status` 在 revision 没变时只返回一行；同路径、同 hash 的重复 `read` 直接返回"已读过"。
- 验收：固定问题集里，同类问题第二次由本地知识回答（trace 中没有联网调用）。这一条就是 `MEM-01` 的原生 Pi 版本。

**PR-5 · 使用已绑定的 `../drone-plugins` 并迁移 `pi-knowledge`**
- 宿主仓库新增并发布 `packages/plugin-api`（只放类型：HostPort、结果状态、回执 schema）。在发布到 npm 之前，先用 tarball 或 git 依赖锁定 commit。
- 用 `git subtree split -P packages/pi-knowledge` 迁到已绑定的 `../drone-plugins/pi-knowledge`，迁移时保留包名和 manifest；不要再创建第二个插件仓库。
- `../drone-plugins` 的 CI：lint、typecheck、单测、`smoke-pi-package`，Pi 版本矩阵为 `1.1.0` 和 `latest`。
- 宿主仓库在外部安装闸门通过后删除 `packages/pi-knowledge`；Desktop 采用已确认的“通过 Pi 设置加载已安装插件包”路径，不再保留内联知识插件工厂。`@drone/knowledge` 继续作为宿主领域实现，只通过已安装包的公开运行时边界使用。

**PR-6 · `pi-core`**
- 把 `ask_user`、`set_status`、`todo`、`deliver_files`、`memory_save` 从 `packages/backend/src/tools` 迁成 Pi 扩展，和任务运行时（`@drone/tasks` 的 register）一起组成 `pi-core`。
- 宿主差异只通过一个很薄的 `HostPort`（`host`、`capabilities()`、`requestAuthorization()`）处理。原生 Pi 上用 `ctx.ui` 实现；Desktop 上用现有的审批分发实现。
- 发布前先过外部安装闸门，再迁到 `drone-plugins`。

**PR-7 · `pi-research` + `research-suite`**
- 按 §3.8.1 组装 `pi-research`；`research-suite` 按 §3.8 用 `bundleDependencies` 聚合。
- 验收：在全新环境里只装 Pi 和 suite，完成一个最小研究任务（检索 → 读两篇 → 沉淀 → 带来源回答）。

**PR-8 起 · 前端重做**（按 §3.10 和设计稿）
- 顺序：token 与外壳 → 侧栏和一级导航 → 右栏（总览 / 文件 / 变更 / 主机）→「技能与连接」页（含能力状态表达）→ 首页 → 知识库页。
- 每个 PR 附上与设计稿对应画面的前后对比截图（用 `scripts/cdp-shot.mjs`）。

**后续（v1.1 起）**：`pi-connectors` 拆分、`desktop-ui-pack` 独立分发、`pi-analysis` / `pi-evidence`、Claude Code 适配器。

### 9.2 v1.1 收口目标（执行版，2026-10-18）

**目标**：按顺序完成剩余插件化边界并发布可验证的 v1.1 包，使原生 Pi 和 Desktop 都能通过稳定合同加载已安装能力；每个包都留下源归属、权限/资源清单、安装 smoke、Pi 兼容矩阵、公开 tarball 和宿主回归证据。双仓库维护、红线和 npm 发布操作以仓库内 [`drone-maintenance` skill](../.agents/skills/drone-maintenance/SKILL.md) 为唯一执行规约。

| 顺序 | 目标 | 交付与门槛 | 完成判定 |
| --- | --- | --- | --- |
| V1.1-A | `@gyoungwe/pi-analysis` | 把 AnalysisAdapter/Registry、未知流程识别、workflow/科学验证与 review→delivery 合同放到插件边界；计算执行仍由宿主组合根适配 | 包级 build/check、锁定/latest Pi 矩阵、安装/卸载 smoke、分析计划→执行→审查→交付 proof、`check:arch` |
| V1.1-E | `@gyoungwe/pi-evidence` | 搬迁 artifact manifest、provenance、checkpoint/branch、evidence capsule、replay/import 和 digest 校验；不复制宿主持久化 | 自包含包、capsule 导入/导出与 replay proof、REDLINE proof、锁定/latest 矩阵、宿主加载检查 |
| V1.1-C | `@gyoungwe/pi-connectors` | 组合 Zotero、WebDAV、generic MCP、institutional、搜索/浏览器连接器；manifest 明确权限、网络范围、读写和外部副作用，UI 开关与真实调用一致 | 权限审计、只读连接器门禁；只有另行授权的写入才做写入→回读→删除→回读；凭据隔离 smoke |
| V1.1-UI | `@gyoungwe/desktop-ui-pack` | 将 Desktop UI contribution 作为独立可安装包发布，依赖 `@gyoungwe/plugin-api`，保留宿主组合根和四视口合同 | 干净安装、renderer 出现/禁用/重载持久化、`check:desktop-artifact -- --strict` 16/16 |
| V1.1-S | `research-suite` 刷新 | 仅在单包全部通过后加入 v1.1 依赖；以真实 tarball staging 验证 bundled dependencies | 公开 tarball 内容、干净安装、Pi 1.1.0/latest 发现和最小模型任务 |

**执行规则**：每个边界一个 `codex/*` 分支/PR，前一个包合入并记录公开/安装证据后再启动下一个；宿主修复与插件源代码尽量分开提交。每个集成节点运行完整根门禁：

```sh
npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch
```

按变更追加 `npm run check:remaining-gates`、`npm run check:plugin-api`、`npm run check:pi-compat -- --targets locked,latest` 和 `npm run check:desktop-artifact -- --strict`；`research-suite` 改由绑定的 `../drone-plugins` workspace `npm run check` 负责。Protocols.io 保持只读；无证书桌面构建仍以本机构建产物门禁为准。

**目标完成条件**：五个 v1.1 节点都有公开 tarball 验证；Desktop 只通过 host API 加载已安装包且无隐藏宿主 fallback；suite 能干净安装并发现全部资源；计划与索引记录两个仓库 head、版本、证据路径以及剩余 `BLOCKED`/`NOT_RUN`；没有新的架构红线或未审查的外部写入。

> A5-1～A5-4 的用户收益、当前完成度和迁移顺序见 [A5 领域包收敛摘要](a5-impact-summary.md)。这些是发布后的架构收敛项，不改变已通过的 v1.1 门槛。

## 10. 插件化与桌面验收红线

### 10.1 总判定规则

插件或界面能力只有在以下链路完整时才算通过：

```text
配置改变 → 新建或继续真实会话 → 看到实际调用 → 得到唯一可核对结果 → 关闭配置后行为确实改变
```

“页面存在”“开关可点击”“状态显示已启用”“单元测试通过”都不能单独作为通过证据。只有 UI 状态、没有 backend 调用、外部副作用或持久化回执时，判定为 `FAIL`；缺少凭据或外部服务时判定为 `BLOCKED`，不能用模拟成功替代。

> 2026-10-17 决议：发版硬性要求只有 `MCP-01`、`MEM-01`、`REDLINE-01` 三条；其余几条进 backlog，未完成时标记为 `NOT_RUN`，不阻断发版。

### 10.2 红线快速清单

| 编号 | 验收动作 | 必须留下的证据 | 当前状态 | 下一步 |
|---|---|---|---|---|
| `UI-01` | 启用 UI 插件，观察真实 slot/panel/headless 效果；关闭、重载和重启 | 槽位/面板变化、关闭后消失、持久化配置、插件错误状态 | **PASS（真实宿主 + renderer registry lifecycle）**；内置 `ds-whale-maid` 1/1 用例通过，贡献出现→移除→重载 nonce 1→2，重启 manager 回读配置 | 当前 shell 的 Electron GUI 启动仍为 `BLOCKED`（NSApplication SIGABRT）；不把 GUI 截图缺失写成宿主行为失败 |
| `MEM-01` | 用 `memory-note.md` 写入 `DRONE-MEM-001`，新会话恢复 topic，修改源文件后再次恢复 | `packages/backend/test/mem-gate.test.mjs`；topic context、来源路径、重新读取回执、`stale/changed` 状态和 Node `os.tmpdir()` 下的 evidence JSON | **PASS（隔离跨实例验收）** | 继续复跑根门禁；不触碰正式 Vault |
| `SKILL-01` | 启用 `research-workflow` 或实际安装 skill，用 slash command/研究问题触发，再禁用自动调用后重试 | skill invocation、名称/参数、调用次数/最近使用、结果结构、自动禁用后的反证 | **PASS（真实 Pi SDK + faux provider）**；2/2 用例通过，证据写入 Node `os.tmpdir()` | `disable-model-invocation` 保留显式手动 `/skill:`；UI/Run Inspector 不得把 manual-only 误报为完全不可用 |
| `MCP-01` | 启用本地测试 MCP 的 `echo_marker`，要求返回唯一值 `DRONE-MCP-001`，关闭后重试 | 连接状态、真实 tool call、唯一返回值、关闭后的 unavailable/blocked | **PASS（隔离真实 SDK fixture）**；`mcp-connector-gates.test.ts` 覆盖启用→真实调用→关闭→重载，关闭后 adapter 无 server/tool 或明确 disabled | 作为根门禁 `check:remaining-gates` 持续复跑 |
| `CONN-01` | 启用研究连接器搜索唯一测试词，再关闭后重复搜索 | 稳定 source ID、URL、访问时间、调用记录、关闭后的行为 | **PASS（只读 CapabilityResearchPorts fixture）**；唯一词 `DRONE-CONN-01-UNIQUE` 的 source receipt 和调用记录可回读，关闭后不发起传输，重新启用可重试 | 保持只读；外部服务写入不在本门槛范围 |
| `WRITE-01` | 对 Zotero/WebDAV 执行授权→写入→回读→删除→再回读 | 外部对象 ID、回读内容、删除确认、审计记录 | **PASS（WebDAV + Zotero）**；Protocols.io 保持只读 | 保留无凭据回执；Protocols.io 只有在另行授权 token 后才增加写入验收 |
| `REDLINE-01` | 注入缺来源、篡改、方法漂移、重复数不足、断线、权限拒绝和 stale source | `npm run check:redline`；每类 fixture 均有阻断状态、原因、证据差异和 sealed 审计 ID | **PASS（隔离领域验收）** | 如需 GUI 走查，沿用同一 proof 投影；不作为本机构建产物降级判定 |

详细的 C01–C15 操作步骤、状态记录模板和执行顺序见 [`v3-desktop-capability-acceptance-plan.md`](v3-desktop-capability-acceptance-plan.md)。最终发布必须同时满足：核心自动化门禁通过、红线清单有真实证据、所有未完成项明确标为 `BLOCKED` 或 `NOT_RUN`，不能把它们写成完成。

## 11. 最终完成标准

- LAN 完全不在最终插件包、宿主合同、验收矩阵和发布说明中。
- 原生 Pi 能独立安装和使用 Drone 核心能力。
- Desktop 只是增强宿主。
- `drone` 作为宿主产品仓库维护，不被削成纯前端仓库；插件源代码在合同稳定并通过外部安装闸门后迁移到 `drone-plugins` workspace。
- 前端按 §3.10 和设计稿重做：一级导航为 新任务 · 知识库 · 技能与连接 · 主机；插件默认扩展既有页面和右栏，不制造菜单泛滥。
- Pi runtime 不被插件重复打包。
- 插件通过稳定 API 和结果合同与宿主通信。
- Pi 更新有兼容矩阵、canary、回滚和明确的版本策略。
- skill、MCP、connector 的界面状态与实际行为一致。
- `UI-01`、`SKILL-01`、`MCP-01`、`MEM-01`、`REDLINE-01` 有真实证据；`CONN-01` 以只读隔离连接器证据验收；`SKILL-01` 的 `disable-model-invocation` 只关闭自动选择，显式 `/skill:` 保留为 manual-only；其余红线项如实标注状态，未完成项不得标记为通过。
- 结果红线在 Pi 和 Desktop 中一致。
- 记忆、topic、证据和 provenance 能跨重启恢复。
- 外部写入、远程执行、删除和发布均有授权与回读。
- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch` 和插件包 smoke 全部通过。
- 新用户只安装 Pi 和聚合包，就能完成一个真实、可追踪、受结果红线约束的研究任务。

## 执行日志

| 日期 | PR | 结果 / 数字 | 偏离与遗留 |
|---|---|---|---|
| 2026-10-17 | 评审 | 决议写入文首；§3.8 / §3.9 / §3.10 / §9 改写 | 设计稿已完成（4 个画面 + 侧栏） |
| 2026-10-18 | main 合并与 v0.33.0 发布候选 | 当前分支已合并 `origin/main`；修复 workspace 绝对链接、刷新 Pi/knowledge/research manifest；`npm test`、`npm run build`、`lint`、`typecheck`、`check:arch`、UI/SKILL、MCP/CONN/MEM/REDLINE、升级、研究资源、扩展、任务 runtime、Pi 包及桌面 16/16 全部通过；发布说明写入 `docs/releases/v0.33.0.md` | 发布流水线已改为只打包 Nature/Scientific skill pack，并显式使用无证书构建；academic pack 保留在开发侧，不再作为发布门槛；无证书策略已生效 |
| 2026-10-17 | 仓库绑定 / 并行启动 | 已绑定本地 `../drone-plugins` 与 GitHub `Gyoungwe/drone-plugins`，`main` 同步于 `f21a4a3`；已创建 `native-pi-map`、`pi-knowledge-pr3`、`plugin-ui-shell` 三个隔离 worktree 并行推进 PR-2、PR-3、UI-1 | npm scope 已确定为 `@gyoungwe`；设计稿已放入 `docs/design/plugin-ui/Drone 插件化界面.html` |
| 2026-10-17 | PR-2 | 已完成 `check-native-pi`：扫描 51 个工具注册并校验目标包映射；4 项脚本单测通过；独立提交 `7be11363`（`codex/native-pi-map`） | 完整根级 lint/typecheck/test/build 尚待集成 worktree 复跑 |
| 2026-10-17 | PR-3 | 已完成 `@gyoungwe/pi-knowledge` 包、bundle/check/smoke、R8 产物检查和 3 个知识 skill；领域与 fixture 检查通过；严格包级 typecheck 收敛在独立提交 `ec0ca0b8`（`codex/pi-knowledge-pr3`） | Pi 1.1.0 对 `.tgz` 直接安装仍为 `PARTIAL`；目录安装路径完成真实 fixture/卸载验收 |
| 2026-10-17 | UI-1 | 已完成中性 token、状态 token、主区浮卡外壳和十六进制对比度测试；独立提交 `f54f5eb4`（`codex/plugin-ui-shell`） | 与设计稿的视觉对照：**NOT_RUN**；尚未做真实桌面启动或截图 |
| 2026-10-17 | 集成检查 | 在 `codex/native-pi-map` 集成分支完成 PR-2、UI-1、PR-3、UI-2、PR-4、UI-3 和 CI；最终 UI-3 集成提交 `5519ed64`，overview 1/1、context-panel 5/5、WorkbenchNav 2/2、desktop typecheck、`check:arch`、`check:native-pi`（51 registrations）、`check:pi-knowledge` 全部通过 | 根仓库完整 lint/typecheck/test/build、真实桌面截图和真实 Pi CLI 矩阵尚未做 |
| 2026-10-17 | PR-3 CI | 新增 `.github/workflows/ci.yml` 的 `pi-package-smoke` job，执行 build/check、严格包级 typecheck 与 fixture smoke；提交 `7ba23257` | CI 明确把真实 Pi CLI external smoke 标为 `NOT_RUN`，不能替代真实 Pi 1.1.0 / latest 矩阵 |
| 2026-10-17 | PR-4 | 已完成原生 Pi 知识闭环首版，提交 `4f8ccef5`：本地优先 search、read links/backlinks、重复 read 回执、四类 deposit、稳定 knowledge status、二次固定问题两轮均为 `source=local` 的 evidence trace；fixture smoke 与 `check:arch` 通过 | 真实 Pi CLI external smoke 尚未执行；联网回退只在 `pi-web-access` 存在时提示真实工具，不伪造结果 |
| 2026-10-17 | 下一阶段并行启动 | 基于 `2b5467db` 新建 `pi-knowledge-loop` 与 `ui-sidebar-nav` 两个隔离 worktree；PR-4 已提交，UI-2 提交 `df8fbda8` 待集成 | PR-4 仍需真实原生 Pi CLI 证据；UI-2 仍需 targeted typecheck/测试和桌面视觉走查 |
| 2026-10-17 | UI-2 | 已完成一级导航、项目/最近分组、账户菜单兼容入口、技能/主机状态徽标及中英文文案；最终提交 `df8fbda8`，WorkbenchNav+projects/sessions 共 33 项、desktop typecheck 通过 | 尚未做真实桌面启动与设计稿截图对照 |
| 2026-10-17 | UI-3 | 已完成最小真实数据驱动右栏：新增 OverviewPane，组合 ContextUsage/Tasks/Process/产物/子智能体/证据/审阅/决策，页签顺序为总览/文件/变更/主机；新增 overview pane 测试与中英文文案；集成提交 `5519ed64` | 原 worktree 因权限未能直接跑 Vitest，但集成分支已通过 overview 1/1、context-panel 5/5、WorkbenchNav 2/2、desktop typecheck、`check:arch`、`check:native-pi`、`check:pi-knowledge`；真实桌面截图尚未做 |
| 2026-10-17 | 下一阶段并行启动 | 基于 `5519ed64` 新建 `ui-chat-composer` 与 `ui-skills-connections` 两个隔离 worktree，分别推进 UI-4 和 UI-5；UI-5 已集成为 `36f3b5cb` | 仍需真实桌面截图与跨页面回归；UI-4 正在收尾 |
| 2026-10-17 | UI-5 | 已完成最小技能与连接页，最终修订序列 `a3f87cd0`、`bbe61ab8`、`5c5f5088`、`5f29c3b0`：真实读取 skills/extensions、UI plugins、MCP、WebDAV、Zotero 和 institutional 状态；支持筛选、需处理计数、检查全部及真实 MCP/插件开关；仅在插件 enabled 且有 built 产物时显示可用；技能操作正确路由到 Skills 设置，手动触发标记不再误报禁用；Protocols 保持只读语义 | 3 个状态映射测试、5 个 Vitest 用例和 typecheck 通过；真实桌面截图尚未做，待集成分支复跑 |
| 2026-10-17 | UI-5 集成 | `36f3b5cb` 已合入 UI-3 基线；SkillsConnections、Overview、ContextPanel、WorkbenchNav 共 11 项定向测试，desktop typecheck、`check:arch`、`check:native-pi`、`check:pi-knowledge` 通过 | 真实桌面截图尚未做 |
| 2026-10-17 | UI-4 | 已完成对话流与输入状态最小交付，补丁 `/private/tmp/ui-chat-composer.patch`：合并 ComposerStatusBar/RunStatusStrip、真实模型/模式与 turn timing、步骤时间线、工具调用状态、引用 chip 和中英文文案；UI-4 测试 4/4、Biome、diff check 通过 | desktop typecheck 因受管 worktree 缺依赖 `NOT_RUN`；真实截图尚未做，待集成分支复跑 |
| 2026-10-17 | UI-5 修订 | 已 squash 为 `2a2fe6e7`，替代 `36f3b5cb`，包含真实状态路由、插件 built 证据和技能手动触发语义修正 | 真实桌面截图尚未做 |
| 2026-10-17 | UI-4/5 集成 | 基于 `5519ed64` 集成 UI-5 与 UI-4，最终提交 `fb0ca3f7`；相关 5 个测试文件共 28/28、desktop typecheck、`check:arch`、`check:native-pi`、`check:pi-knowledge`、Biome 与 diff check 通过 | 根仓库完整 lint/typecheck/test/build、真实桌面截图和 Pi CLI 矩阵仍待执行 |
| 2026-10-17 | 下一阶段并行启动 | 基于 `fb0ca3f7` 新建 `ui-knowledge-page` 与 `ui-home-page` 两个隔离 worktree，分别推进 UI-6 和 UI-7 | 需继续保持真实知识/项目数据语义，并补齐桌面视觉走查 |
| 2026-10-17 | UI-6 | 已完成知识库页最小实现，补丁 `/private/tmp/ui6-knowledge-page.patch`：真实 Vault/项目上下文、快捷搜索、分类过滤、最近沉淀、review pending、健康指标未知态、按需图谱和 Vault 入口；新增纯投影 model 与 2 个测试 | diff check 与 KnowledgeHome 2 tests 通过；worktree typecheck 因缺依赖 `NOT_RUN`，真实截图尚未做，待集成分支复跑 |
| 2026-10-17 | UI-7 | 已完成最小首页交付，补丁 `/private/tmp/ui-home-page.patch`：真实 projects/allSessions/transcript/knowledge overview/compute hosts/model 状态，项目与最近会话列表、连接/主机状态和中英文文案；新增 3 个测试 | Biome、diff check、定向 3/3 tests 通过；desktop typecheck 与真实截图待集成分支复跑 |
| 2026-10-17 | UI-6/7 集成 | 最终提交 `37fbc175`，集成知识库页、首页及此前 UI-4/5；KnowledgeHome 2、knowledge-graph 6、HomeCards 3、Assistant UI-4 2、SkillsConnections 3，共 16/16，desktop typecheck、`check:arch`、`check:native-pi`、`check:pi-knowledge`、Biome、diff check 通过 | 根仓库完整门禁、真实桌面截图、Pi CLI 矩阵和外部连接器真实验收仍待执行 |
| 2026-10-17 | PR-5 准备启动 | 基于 `37fbc175` 新建 `plugin-api-migration` worktree，开始实现公开 `packages/plugin-api` 合同和迁移闸门；暂不发布 npm、不删除宿主 `pi-knowledge` | npm scope 已由用户确认使用 `@gyoungwe`，待 npm 登录后发布 |
| 2026-10-18 | PR-5 准备完成 | 最终提交 `ea70a7ff9e89e51764f38888974755d5ec930ce7`：新增 `@gyoungwe/plugin-api` 类型合同、4 个能力协商测试、`check:plugin-api`、package tarball/路径依赖/HEAD 迁移闸门、root lock workspace symlink，并同步索引与架构文档；package test 4/4、build/typecheck、migration gate、`check:arch`、Biome、diff check 通过 | 需在集成分支复跑；npm scope 已确定为 `@gyoungwe`；未登录 npm，尚未发布，也未删除 `packages/pi-knowledge` |
| 2026-10-18 | PR-5 宿主合同集成 | 集成提交 `3f8af50c`，`npm run check:plugin-api` 完整通过（API projection、typecheck/build/package gate、tarball install、drone-plugins HEAD `f21a4a3` / 3 manifests）；plugin-api test 4/4，UI 回归 16/16，desktop typecheck、`check:arch`、`check:native-pi`、`check:pi-knowledge` 通过 | 根级 typecheck 仍被仓库既有 pi-knowledge/extensions/tasks 类型错误阻断；npm scope 已确定为 `@gyoungwe`；未登录 npm，未发布/未删除宿主包 |
| 2026-10-18 | PR-6 启动 | 基于 `3f8af50c` 新建 `pi-core-extraction` worktree，开始抽取原生 Pi 核心工具与 HostPort 适配；保留现有 Desktop 工具路径和用户数据 | 仍需验证授权/回执、外部安装 smoke 与 Pi 真实 CLI 矩阵 |
| 2026-10-18 | PR-6 | 已完成 `pi-core`，最终提交 `b6f91891`：原生 `ctx.ui` HostPort、ask_user/set_status/todo/deliver_files/memory_save、tasks runtime、backend 兼容 facade、build/check/smoke；并将 `build:pi-core` 前置到根 build/test，独立 npm test 先构建 dist；pi-core 2 tests、既有工具 27/27、backend typecheck、Biome、`check:arch`、`check:native-pi`、diff check 通过 | 根级 tasks source typecheck 仍有既有错误；未发布 npm，真实 Pi CLI smoke 尚未执行 |
| 2026-10-18 | PR-6 集成 | 集成提交 `82500ced`，基于 `3f8af50c`；pi-core 构建、注册测试 2/2、backend typecheck、原生映射/架构检查、Biome 与 diff check 通过。构建后 `build-manifest.json` 的 4 行漂移确认来自复用主工作区 `node_modules` 造成的 esbuild 绝对路径 hash，已丢弃，集成 worktree 保持 clean | 根级完整门禁、真实 Pi CLI 1.1.0/latest 矩阵、桌面截图与外部安装仍未完成；下一步进入 PR-7 `pi-research` + `research-suite` |
| 2026-10-18 | PR-6 集成全量复跑 | 在临时依赖目录复跑：`npm run build` 通过；backend 221 files/1855 tests、desktop 146 files/772 tests 通过，另有 2 个既有 spacing-grid 测试失败；`npm run typecheck` 的约 78 个错误集中在既有 pi-knowledge/extensions/tasks 聚合；lint 为既有 CSS 降序与历史脚本/UI-5 格式问题；`check:arch`、`check:native-pi` 51、`check:plugin-api`、`check:pi-core`、`smoke:pi-core`、`check:pi-knowledge` 通过，清理后 worktree clean | 这些失败均未由 PR-6 引入，需后续独立清理；真实 Pi CLI 1.1.0/latest 与桌面视觉证据仍未完成 |
| 2026-10-18 | UI spacing 收口 | 在 `82500ced` 后依次集成 `3ce789e3`、`dd633de5`、`42cbf757`：修复 UI-5 格式问题、UI-4/6/7 新增组件的 half-step spacing，以及 `.meta-step-row` 的 6px CSS；spacing-grid 2/2、相关 UI 17/17、desktop typecheck、Biome、diff check 通过；集成 worktree clean | lint 仍有 3 个 globals.css descending-specificity 基线 warning；pi-knowledge/extensions/tasks 聚合 typecheck 仍待单独迁移收口 |
| 2026-10-18 | PR-7 | 独立 checkout 最终提交 `03086d69`：新增 `@gyoungwe/pi-research`（检索→两篇来源回读→沉淀→来源回答、research_status、skill、自包含 dist）与 `@gyoungwe/research-suite`（pi-core/knowledge/research bundleDependencies）；`check-native-pi` 纳入 `packages/pi-research/src`，注册映射扩展到 56 项；build/check、pi-research typecheck、direct/tarball smoke、suite 临时 npm pack 闸门、check:arch、native Pi tests 4/4 全通过 | 尚待在集成 worktree 合入并复跑；真实 Pi CLI 1.1.0/latest 矩阵和 npm 发布仍未执行，scope 已改为 `@gyoungwe` |
| 2026-10-18 | PR-7 集成 | 等价整理提交 `cbaf9e4b` 已合入 UI spacing 收口后的集成分支；pi-research typecheck/build/check、direct+tarball smoke、research-suite 3 包 bundle 闸门、56 registrations、native Pi tests 4/4、`check:arch`、diff check 全通过，生成物清理后 worktree clean | 真实 Pi CLI 1.1.0/latest 矩阵、桌面视觉验收、npm 发布与外部 connector 写入验收仍未完成 |
| 2026-10-18 | 根门禁收口 | 独立 checkout 的修复提交 `06ff916f`：pi-knowledge path shim、research-suite 必要 no-op typecheck、3 个 CSS specificity 忽略说明、Biome 格式化；`npm run lint`、根 `npm run typecheck`、`check:arch`、`check:native-pi` 56、native Pi tests 4/4、plugin-api/pi-knowledge 定向检查通过 | 全量 `npm test` 仍受隔离 shell 的既有 backend 9 个测试文件/60 项影响（knowledge publication/usage-feedback、localhost/7331 EPERM 等），不由本修复引入；需在允许本地监听的环境复跑 |
| 2026-10-18 | 根门禁收口集成 | 等价集成提交 `f21bd2cc` 已合入 `cbaf9e4b`；`npm run lint`、`npm run typecheck`、`check:arch`、`check:native-pi` 56、native checker 4/4、desktop targeted 10/10、spacing-grid 2/2、desktop typecheck、Biome、diff check 全通过，worktree clean | 全量 `npm test` 仍受隔离 shell 的既有 backend 9 个测试文件/60 项影响（localhost/7331 EPERM、channel-watch、knowledge publication/usage-feedback）；须在允许本地监听的环境复跑 |
| 2026-10-18 | 真实桌面走查 | 候选 `cbaf9e4b` 隔离构建通过，Electron payload 已恢复；真实 Electron 子进程在 `NSApplication init/RegisterApplication` 阶段 SIGABRT，9224/CDP 无页面，Home、知识库、技能与连接、主机/右栏四视口均记录 `BLOCKED`，无截图；详细日志 `/private/tmp/drone-desktop-acceptance/desktop-acceptance-status.md` | 需在可启动的交互式 macOS GUI 会话或可运行候选应用上重跑 CDP/四视口；`npm run dist` 同时受隔离代理 `127.0.0.1:7897` EPERM 阻塞 |
| 2026-10-18 | Pi CLI 1.1.0 安装回读 | 在隔离 `HOME`/`PI_CODING_AGENT_DIR` 中用本地 `@earendil-works/pi-coding-agent` 1.1.0 CLI 对 `packages/pi-research` 执行真实 `pi install <directory>`、`pi list`、`pi remove <directory>`：安装记录、资源路径和卸载后空列表均通过；未调用模型，不计为完整研究任务或 latest/next 矩阵 | `.tgz` 安装与真实模型调用仍未完成；全局旧 CLI 为 0.85.1，不能替代 1.1.0/最新兼容矩阵 |
| 2026-10-18 | 根级全量测试复跑 | 使用真实 HOME、独立 `PI_CODING_AGENT_DIR` 并允许本地监听的环境完成 `npm test`：所有 workspace 合计通过（backend 220 files / 1854 tests，desktop 147 files / 774 tests，extensions/inquiry/knowledge/tasks/research/shared 等均通过；native Pi、plugin-api、pi-core、pi-research smoke 也通过），退出码 0 | 使用临时 HOME 时权限测试会把“家目录下相对 rm”误判为临时区，产生环境假失败；该隔离方式不再作为项目失败记录。真实桌面、Pi latest/next 矩阵、外部连接器副作用验收仍待完成 |
| 2026-10-18 | 升级 fixture 与集成 build | 在可写的等价集成 checkout `06ff916f` 完成 `npm run build`；在允许 loopback 的环境完成 `npm run test:upgrade`，`orchestration-stress`、`hybrid-fixture`、`packaged-resources` 3/3 通过，退出码 0 | 受限 shell 下 `test:upgrade` 的 hybrid fixture 会因禁止绑定 `127.0.0.1` 假失败；已用允许本地监听的验收环境复跑通过。管理 worktree 直接生成 dist 仍受当前文件沙箱保护，未改动代码 |
| 2026-10-18 | WebDAV 临时对象闭环 | 使用 `KnowledgeWebDavService` 对 `http://10.126.126.1:8080/Drone-Knowledge` 完成真实 probe（ready/authenticated）、唯一对象 `Inbox/DRONE-WEBDAV-1792257377294.md` 写入、服务层回读哈希核对、HTTP 204 删除，以及删除后服务层回读 `not_found`；receipt hash `2b2695bfa41fe29f9477796e2413f5446b6eabfd3dafa8351c0268c72f151d27` | 真实凭据只在本次进程环境中使用，未写入仓库、日志或计划；Protocols.io 仍按只读策略，不进行 bookmark/写入 |
| 2026-10-18 | MCP / CONN 隔离验收 | `packages/backend/test/mcp-connector-gates.test.ts` 通过：staged `pi-mcp-adapter` 的本地 stdio marker fixture 启用后真实返回 `DRONE-MCP-001`，关闭并重载后无可用工具；read-only `CapabilityResearchPorts` 对 `DRONE-CONN-01-UNIQUE` 回读 source ID/URL/调用记录，关闭后跳过传输，重启用可重试 | 证据为隔离本地 fixture，无外部写入；Protocols.io 继续只读；根门禁应通过 `npm run check:remaining-gates` 复跑 |
| 2026-10-18 | MEM / REDLINE 隔离验收 | `mem-gate.test.mjs` 通过 `DRONE-MEM-001` 跨实例恢复、来源回读和 `stale/changed`；`redline-acceptance.test.mjs` 通过缺来源、stale、数字/方法漂移、重复数不足、断线和权限拒绝的 blocked/pause 与 sealed proof；提交 `e988d185`、`d7121a58` | 证据只写入 `/private/tmp`，不触碰正式 Vault、凭据或 session 正文；GUI 投影仍不作为构建产物降级判定 |
| 2026-10-18 | 剩余门槛与全量门禁复跑 | `npm run check:remaining-gates`（MEM 1/1、REDLINE 4/4、MCP/CONN 2/2）、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch`、`npm run test:upgrade`、`check:plugin-api`、`check:pi-compat` 与 `check:desktop-artifact -- --strict` 全部通过；桌面产物 16/16、四视口 4/4、0 FAIL/NOT_RUN | 未执行 npm publish 或外部 Protocols.io 写入；公开发布仍需本机 npm 登录；Protocols.io 保持只读。按计划不要求证书/正式签名 |
| 2026-10-18 | UI-01 / SKILL-01 真实宿主验收 | `npm run check:ui-skill-acceptance -- --out /private/tmp/drone-ui-skill-acceptance.json` 通过：UI-01 真实内置插件 bundle 构建→registry 出现→禁用移除→重载 nonce 1→2→manager 重启回读配置；SKILL-01 真实 Pi SDK + faux provider 2/2，通过 canonical slash invocation、visible skill、provider call 和自动禁用反证；SKILL-01 evidence 写入 Node `os.tmpdir()` | 交互式 Electron 仍受当前 shell 的 macOS `NSApplication` SIGABRT 阻塞，无新增 GUI 截图；GUI 观察与宿主/SDK gate 分开记录。`disable-model-invocation` 的显式 slash manual-only 语义已同步到 UI/计划 |
| 2026-10-18 | main 合并与 v0.33.0 发布候选收口 | 合并提交 `c8195156` 已推送 `main`；修复 CI 中缺少绑定插件仓库的提交 `a378b3c1`、刷新 knowledge/research runtime manifest 的提交 `b4052d42` 已推送；`v0.33.0` 标签已指向 `b4052d42`，Release run `39059425930` 曾因 Windows URL pathname bug 失败（macOS 已通过） | 已修复 `fileURLToPath` 跨平台根目录问题，需在修复提交上重新 dispatch；Release 无证书策略保留 |
| 2026-10-18 | scope / 真实 Pi 矩阵 / 组合加载收口 | 公开包 scope 已由用户确认统一为 `@gyoungwe`；plugin-api、pi-core、pi-knowledge、pi-research、research-suite 已加入 public publishConfig/repository 元数据；当时旧 suite 组合加载因重复 `task_*` 工具注册为 **FAIL**，执行日志保留该历史失败；随后 `pi-knowledge@0.1.1` 已移除 task runtime，由 pi-core 独占 | 历史 FAIL 不删除；由新的真实 CLI 回归记录最终状态 |
| 2026-10-18 | Pi 真实模型兼容矩阵 | `/private/tmp/drone-pi-real-matrix-ksVolq/pi-real-matrix-evidence.json`：Pi `1.1.0` 与 latest 的 6 个单包 cell PASS；两个组合 cell 与临时 research-suite 安装→发现→模型调用→卸载 **FAIL**，原因是重复 `task_*` 工具注册冲突 | 组合加载不能标记为通过；需在插件仓库统一 `task_*` 工具 ownership 后重跑，next 仍为 `NOT_PUBLISHED` |
| 2026-10-18 | 外部插件仓库迁移收口 | 外部 `drone-plugins` `main=d5a3ea1`；`@gyoungwe/pi-knowledge` 已自包含并补齐公开发布元数据；`npm run check`、`smoke:install` 通过（34 tools、`knowledge_status=unconfigured`）；宿主 `packages/pi-knowledge` 兼容副本已从 Drone 删除 | Desktop/Pi 仅从已安装 npm 包加载；后续按 v1.1 推进其余插件拆分 |
| 2026-10-18 | 首批 npm 插件包公开发布 | `@gyoungwe/plugin-api@1.0.0`、`pi-core@0.1.0`、`pi-knowledge@0.1.0`、`pi-research@0.1.0`、`research-suite@0.1.0` 已提交 npm；安全密钥 2FA 已完成发布认证 | 首次聚合包发布后，继续做公开 tarball 验证 |
| 2026-10-18 | `research-suite` 公开 tarball 修复 | registry 验证发现 `research-suite@0.1.0` 未携带三个 bundled dependency；外部仓库元数据修复提交 `a4eb3a6`、manifest 对齐提交 `5002590`，已发布 `@gyoungwe/research-suite@0.1.1`，公开 tarball 和全新临时目录安装均 PASS，证据见 [`v0.33.0-npm-packages.json`](releases/v0.33.0-npm-packages.json) | `desktop-ui-pack` 仍是 v1.1 的独立 UI 包；analysis/evidence/connectors 继续按计划推进，Protocols.io 保持只读 |
| 2026-10-18 | v0.33.0 正式无证书发布 | main `961cd43a`；Release run [39066841689](https://github.com/Gyoungwe/Drone/actions/runs/39066841689) 的 macOS arm64/x64 与 Windows x64 validate、unsigned build、MCP 资源校验、资产上传全部成功；[v0.33.0 Release](https://github.com/Gyoungwe/Drone/releases/tag/v0.33.0) 已发布，包含 3 个安装包、3 个 zip、4 个 blockmap 和 2 个更新清单；SHA-256 见 [`v0.33.0-assets.sha256`](releases/v0.33.0-assets.sha256) | npm 首批包已发布；按 v1.1 推进 analysis/evidence/connectors 和完整 desktop-ui-pack |
| 2026-10-18 | Windows 跨平台验收修复 | `scripts/check-plugin-api.mjs` 生命周期闸门改用跨平台 tarball basename、npm 执行器和 Biome 格式；MEM-01/SKILL-01 证据与临时 fixture 改用 Node `os.tmpdir()`，避免 Windows 将 POSIX `/tmp` 解析为 `\\tmp` | macOS validate 已通过；等待修复后的 Release 同时完成 Windows validate 与无证书构建资产 |
| 2026-10-18 | V1.1-A `pi-analysis` 启动实现 | 新增 `packages/pi-analysis` 宿主临时包：公开 analysis contract、确定性 adapter snapshot、bulk RNA-seq/assembly readiness/review、`analysis_list_adapters` 与 `analysis_assess_readiness`；backend 原分析适配器改为兼容 facade；根 build/test 脚本、native Pi fixture、Pi 兼容矩阵与索引已登记。包级 typecheck/build/registration smoke、`npm run check -w @gyoungwe/pi-analysis`（含 pack→干净 prefix→真实 Pi loader 安装 smoke）、plugin-api contract test、backend typecheck、`check:native-pi` 58 registrations、Pi 1.1.0/latest 4 包发现矩阵已通过 | 仍需按 V1.1-A 顺序迁移至 `../drone-plugins`、公开 registry tarball、宿主计划→执行→审查→交付 proof；因此 V1.1-A 保持进行中 |
| 2026-10-18 | V1.1-E `pi-evidence` 启动实现 | 新增 `packages/pi-evidence` 宿主临时包：artifact manifest、provenance/digest、checkpoint/branch、capsule、replay/import 纯合同；3 个工具均标记只读，dist 检查拒绝 Electron/backend/Pi SDK/`node:fs`/越界导入；包级 typecheck、build、注册/合同测试与 clean tarball install smoke 已执行；`check:native-pi` 映射和根 build/test/check 脚本已登记 | 尚未迁移到 `../drone-plugins`、未发布公开 tarball，Pi 1.1.0/latest 真实发现矩阵、REDLINE proof 和宿主加载检查为 `NOT_RUN`；V1.1-E 不标记完成 |
| 2026-10-18 | V1.1-A 外部迁移与公开发布验收 | `drone-plugins` 分支 `codex/pi-analysis-migration` 提交 `baf9b3b`（包提交 `2168576`）完成自包含 dist/声明/manifest；`npm view` 和 registry tarball 回读得到版本 `0.1.0`、shasum `144df91bdd85c5a781ffcab5f94eaa5dd1ac1437`、integrity `sha512-9uy6I/9MmQQWG4SNgFhM1Q2/VoCB5IC5Nf0XAvn9IhzepQyUzEUzeYf6HwgzaBcCzHMW+owez2EYEjfxqPzuhA==`；全新 prefix 安装和真实 Pi loader 发现 2 个工具通过。Drone backend 已切换到精确公共依赖并删除临时源码/脚本；`check:pi-compat -- --targets locked,latest`、analysis controller 6 tests、`check:native-pi` 61 registrations 均通过 | V1.1-A 公开包与宿主闭环门槛关闭；后续只在 `drone-plugins` 维护 pi-analysis |
| 2026-10-18 | V1.1-C `pi-connectors` 首版 | 新增 `@gyoungwe/pi-connectors@0.1.0` 宿主边界：六个只读 connector descriptor、权限/网络/凭据/read-write/side-effect 声明、`drone-connector-receipt/v1` 回执链，以及 `connector_list`/`connector_get` 元数据工具；`npm run check:pi-connectors`、clean tarball→Pi loader→卸载 smoke、`check:native-pi` 63 registrations、`check:arch` 均通过 | 尚未迁移到 `drone-plugins`、公开发布、宿主权限审计和真实连接器验收；真实网络/凭据/写入/回读/删除保持 NOT_RUN，Protocols.io 仍只读 |
| 2026-10-18 | V1.1 宿主回归门禁 | 合并 evidence/connectors/UI host changes 后，根 `npm run lint`（1 个已知设计稿大小 warning）、`npm run typecheck`、`npm test`（backend 226/1872、desktop 149/765）、`npm run build`、`check:arch`、`check:plugin-api`、`check:pi-compat -- --targets locked,latest`、`check:desktop-artifact -- --strict` 和 `check:native-pi`（63 registrations）均通过；证据/连接器 clean tarball smoke 与安装后工具调用也通过 | pi-evidence/pi-connectors 外部迁移、公开 tarball、真实连接器 I/O 和宿主 plan→execute→review→delivery 仍未关闭；pi-analysis 的公开包与宿主闭环已在后续验收日志关闭 |
| 2026-10-18 | V1.1-UI 外部包首版 | `drone-plugins` 提交 `baf9b3b` 增加 `@gyoungwe/desktop-ui-pack@0.1.0`：独立 `ui/plugin.json`、无宿主私有 import 的 renderer contribution、manifest/build/smoke；外部 `npm run check`、clean install 和 UI tarball 内容检查通过；Drone `UiPluginManager` 已从 Pi managed npm 目录发现已安装 UI 包并通过启用/禁用/重载/持久化测试 | 尚未发布公开包或做安装后真实 Desktop 加载的 release evidence；不提前把 UI 包加入 research-suite |
| 2026-10-18 | V1.1 外部包迁移与宿主 UI 验收 | `drone-plugins` `codex/pi-analysis-migration` 提交 `222936c` 已完成 `pi-evidence`、`pi-connectors`、`desktop-ui-pack` 外部自包含迁移；`npm run check`、六包 clean install、Pi loader 发现/卸载、只读合同和 UI tarball smoke 全部 PASS。宿主 `a3b9b789` 新增从实际 UI 包内容到 Pi managed install 根的 `UiPluginManager` 生命周期测试并通过。完整记录见 [`v1.1-external-plugin-packages.json`](releases/v1.1-external-plugin-packages.json) | 三个包的公开 npm publish 被 `EOTP` 阻塞；在 registry gate 关闭前宿主仍保留本地 evidence/connectors 临时包，不称为完成 |
| 2026-10-18 | npm 发布认证状态 | `npm profile get` 显示账号 `auth-and-writes` 已启用；`@gyoungwe/pi-evidence@0.1.0` 的发布命令已完成打包但被 registry 返回 `EOTP`，要求一次性 authenticator code；未复制或记录任何凭据 | 需在具备 CLI 一次性验证码/可完成 npm authenticator challenge 的终端发布 evidence、connectors、desktop-ui-pack，再回读 registry tarball、integrity/shasum 和全新 prefix 安装 |
| 2026-10-18 | v1.1 三个插件公开 registry 与宿主闭环 | 用户已在本机配置 Bypass 2FA token；`@gyoungwe/pi-evidence@0.1.0`、`@gyoungwe/pi-connectors@0.1.0`、`@gyoungwe/desktop-ui-pack@0.1.0` 均完成 npm publish。公开 tarball 的 shasum/integrity 分别为 `4826a8f5663be2af382cecc227254a547d5f44af` / `sha512-/yZEXNPnXvx2AH6jmJFaomj4mpOvTSF+I8GaDZXXk+T2farPjRD+PPUgMV2rQy0DiZ8wDsQy08l8O800a8I5Cw==`、`1629eb468f607f7be969d347cd03aff2dc0d03e3` / `sha512-mly3eufpCDzpUtQ4eew93pgvqI4bgRVFuGspnHQ2BppoSJiV6q3PqrDVhK3atVa/WNHYgfJsP+jvfSjBuvmM+A==`、`73e79d49b0678a0379fbdb7f1ec4d7ebb2b455e5` / `sha512-YIrwxhDCjU9yAe+f+ip1yOND43ma737EjvhB7qe9NqMVn2xTKYSX+CTtqFq0qSeOEkyYNZVI38nz29WI+Njdtw==`；registry tarball 干净安装、Pi 1.1.0 loader、工具调用、UI manifest 和 `UiPluginManager` 生命周期全部 PASS。宿主已删除 evidence/connectors 临时源码，根锁文件固定公开包 | 真实连接器网络/凭据/写入仍按逐项授权执行；Protocols.io 继续只读；交互式 Electron 截图不作为本门槛 |
| 2026-10-18 | v1.1 三个插件公开 registry 与宿主闭环 | 用户已在本机配置 Bypass 2FA token；`@gyoungwe/pi-evidence@0.1.0`、`@gyoungwe/pi-connectors@0.1.0`、`@gyoungwe/desktop-ui-pack@0.1.0` 均完成 npm publish。公开 tarball 的 shasum/integrity 分别为 `4826a8f5663be2af382cecc227254a547d5f44af` / `sha512-/yZEXNPnXvx2AH6jmJFaomj4mpOvTSF+I8GaDZXXk+T2farPjRD+PPUgMV2rQy0DiZ8wDsQy08l8O800a8I5Cw==`、`1629eb468f607f7be969d347cd03aff2dc0d03e3` / `sha512-mly3eufpCDzpUtQ4eew93pgvqI4bgRVFuGspnHQ2BppoSJiV6q3PqrDVhK3atVa/WNHYgfJsP+jvfSjBuvmM+A==`、`73e79d49b0678a0379fbdb7f1ec4d7ebb2b455e5` / `sha512-YIrwxhDCjU9yAe+f+ip1yOND43ma737EjvhB7qe9NqMVn2xTKYSX+CTtqFq0qSeOEkyYNZVI38nz29WI+Njdtw==`；registry tarball 干净安装、Pi 1.1.0 loader、工具调用、UI manifest 和 `UiPluginManager` 生命周期全部 PASS。宿主已删除 evidence/connectors 临时源码，根锁文件固定公开包 | 真实连接器网络/凭据/写入仍按逐项授权执行；Protocols.io 继续只读；交互式 Electron 截图不作为本门槛 |
| 2026-10-18 | pi-knowledge/research-suite 任务所有权修复与真实 CLI 回归（历史） | `drone-plugins` main `e5b9e41`：`pi-knowledge@0.1.1` 删除 task runtime 注册和重复 `research-workflow` skill；`research-suite@0.1.2` 公开发布并捆绑四个依赖；干净克隆 `npm ci → npm run build → npm run check` 通过；`research-suite@0.1.1` 已弃用，理由为“与 pi-core 冲突，无法启动”。Pi `1.1.0`/latest 对新包真实 `pi install` + `pi -p --no-session /task-status` 为 PASS；旧包两版均输出 `conflicts`、退出 1，标记 EXPECTED_FAILURE。回归脚本已接入 push/PR CI，证据见 [`v1.1-pi-knowledge-research-suite.json`](releases/v1.1-pi-knowledge-research-suite.json) | 该记录由 `v1.1-onboarding-commands.json` 的 `0.1.3` 证据 supersede；Protocols.io 仍只读 |


### 2026-10-18 收口补充

- **LAN**：源码、生成运行时、桌面入口、IPC、manifest、测试和索引已清理；历史日志只保留变更背景。
- **桌面验收口径**：正式门槛是本机构建产物验收。main `260995a0` 的 `npm run build && npm run check:desktop-artifact -- --strict` 通过 16/16，四视口 4/4，0 `FAIL`、0 `NOT_RUN`，产物快照 SHA-256 为 `9db8e47ec4c039415ca6dc66a1ccd78dd7ca2f7e3f9a1bb78fafa5cac30244e7`。交互式 Electron 启动因当前 shell 的 macOS `NSApplication init/RegisterApplication` SIGABRT 未建立 CDP，不改变上述构建产物结论。
- **插件生命周期**：`check:plugin-api --migration --lifecycle` 已完成本地 pack 的 `0.9.0 → 1.0.0 → 0.9.0 → uninstall`，并验证 `DroneHostPort` 声明。
- **UI-01 / SKILL-01**：`npm run check:ui-skill-acceptance` 通过；UI-01 由真实内置 `ds-whale-maid` bundle + `UiPluginManager` + renderer registry 完成出现/移除/重载/持久化闭环，SKILL-01 由真实 Pi SDK + offline faux provider 完成 `/skill:research-workflow` invocation 与 `disable-model-invocation` 自动选择反证。显式 `/skill:` 仍为 manual-only，不能标记为完全禁用。
- **Pi 兼容**：锁定 `1.1.0` 与 latest `1.3.0` 的 `research-suite@0.1.3` 真实 CLI 回归 PASS，并额外执行 `/drone-doctor`、`/drone-example`；已弃用的 `research-suite@0.1.1` 在两版 Pi 中均输出 `conflicts` 并退出 1，作为 EXPECTED_FAILURE 负例。旧组合加载 FAIL 记录保留为历史执行日志，不再代表当前包状态。
- **外部写入**：WebDAV 和 Zotero 临时 note 均完成授权→创建→回读→删除→再回读；Protocols.io 只读，不进行 bookmark/write。
- **已关闭门槛**：`MEM-01`、`MCP-01`、`CONN-01`、`REDLINE-01` 均有隔离真实行为证据，Protocols.io 保持只读；`research-suite@0.1.3` 已通过 Pi `1.1.0`/latest 真实 CLI 回归并覆盖 onboarding commands，旧 `0.1.1` 的冲突负例已明确弃用；`pi-analysis`、`pi-evidence`、`pi-connectors`、`desktop-ui-pack` 和 `research-suite` 均完成公开 registry 与宿主安装门禁。npm scope 已确定为 `@gyoungwe`；证书/正式签名不属于本计划门槛。
- **发布后顺序**：v0.33.0 无证书跨平台资产、首批 npm 包和 v1.1 三个插件包均已正式发布；宿主 `packages/pi-knowledge`、evidence、connectors 兼容副本已删除，Desktop/Pi 仅从已安装插件包加载；后续只在 `drone-plugins` 维护插件，按连接器逐项推进真实外部服务验收。
- **维护规约**：双仓库归属、同步顺序、R1–R7 与发布红线、npm 安全密钥 2FA、公开 tarball/干净安装验收和缺陷版本回滚已整理为 [`.agents/skills/drone-maintenance`](../.agents/skills/drone-maintenance/SKILL.md)；无人值守发布优先使用 `drone-plugins/.github/workflows/publish.yml` 的 npm Trusted Publishing（OIDC），不把长期 token 放进仓库或对话；当前 v1.1 五节点目标见 §9.2。
- **明确不阻塞发布**：Protocols.io 继续只读；交互式 Electron 截图受当前 shell 的 macOS `NSApplication` 启动限制，但构建产物 16/16 已通过，截图不改变本版本验收结论。

| 2026-10-18 | v0.33.1 正式无证书发布 | 基于 `Drone` main `138024b4`；宿主完整门禁、`drone-plugins` `npm run check`、公开 registry 插件宿主、UI/SKILL、Pi 1.1.0/latest、升级 fixture 与桌面 16/16 均通过；Release run [`39114397278`](https://github.com/Gyoungwe/Drone/actions/runs/39114397278) 的 macOS arm64/x64 与 Windows x64 validate、无证书构建、资产上传和网站发布全部成功；[`v0.33.1 Release`](https://github.com/Gyoungwe/Drone/releases/tag/v0.33.1) 已发布，包含 3 个安装包、3 个 zip、4 个 blockmap 和 2 个更新清单 | Protocols.io 继续只读；长期架构计划仍保留 A5-1～A5-4 兼容层清理 |
| 2026-10-18 | §7 命令范围复核（历史） | `/drone-doctor` 与 `/drone-example` 当时没有成熟注册、输出合同或隔离 smoke，因此当时标记为 NOT_RUN；该记录保留为历史，不代表当前状态 | 本次收口已补齐实现与真实 CLI 证据 |
| 2026-10-18 | §7 onboarding commands + 视觉对照收口 | `@gyoungwe/pi-core@0.1.1` 新增稳定 schema v1 的 `/drone-doctor`、`/drone-example`；`@gyoungwe/research-suite@0.1.3` 在 Pi `1.1.0`/latest 的独立 HOME 中真实安装并执行三条命令，正例 PASS，旧 `0.1.1` 冲突负例 EXPECTED_FAILURE。Chrome headless built renderer 对新任务、知识库、技能与连接、主机四视图完成 1440×900/1280×800 截图对照，4/4 PASS | 交互式 Electron 截图仍受 NSApplication 环境限制；视觉证据不替代真实运行时功能验收 |
| 2026-10-18 | 上一轮计划核对 | 上一轮记录的 Drone `main` 已与 `origin/main` 同步（代码验收基线 `a620a40e`）、`drone-plugins` `main=8389116` 与远端一致；`check:remaining-gates`、Pi 1.1.0/latest 兼容矩阵、插件仓库全量 check、桌面产物 16/16 和四视口视觉对照 4/4 均通过；计划中的旧 `e5b9e41`、suite `0.1.2`、视觉 `NOT_RUN` 状态已校正 | 当时 A5-1～A5-4 尚待收口；本记录保留历史状态，当前状态见下一行 |
| 2026-10-18 | A5 并行生产切片 | 宿主 `main=876f0a07` 合入 knowledge worker fallback 清理（`aaff82a2`、`fd5fa895`）、tasks acceptance registry/runtime 打包归属与类型收口（`8f17c7b2`、`2db6074c`、`3336199f`）和 research host ports 类型化（`4ad8281d`）；knowledge 307、tasks 58、research 93、extensions 18、backend acceptance 1/1、全量 workspace 测试、root lint/typecheck/build、runtime/architecture/native-Pi/strict-extension/Desktop build 全部通过；插件公开 API 未变；完整证据见 [`a5-migration-2026-10-18.json`](releases/a5-migration-2026-10-18.json) | 兼容入口收口尚待 A5-4 |
| 2026-10-18 | A5-1～A5-4 最终收口 | knowledge/tasks/research 的旧 `.pi/lib` runtime tree 全部删除；扩展 manifest 移到 `.pi/extensions/workbench-manifest.json`，Desktop extraResources 不再复制 `.pi/lib`；`@gyoungwe/plugin-api` 未变。knowledge 307、tasks 58、research 93、extensions 19、task/research runtime checks、strict extensions、Pi package/knowledge package、Desktop artifact 16/16、全量 lint/typecheck/test/build/architecture 均通过 | A5-1～A5-4 已关闭；后续只在领域包和 `drone-plugins` 维护 |
| 2026-10-18 | 本轮计划复核 | Drone `main=260995a0`、`drone-plugins main=8389116` 均与远端一致；`check:remaining-gates`、`check:plugin-api --migration --lifecycle`、Pi 1.1.0/latest 兼容矩阵、`test:upgrade -- --fixtures-only`、`drone-plugins npm run check` 和桌面产物 16/16 均通过；最新桌面产物 SHA-256 为 `9db8e47ec4c039415ca6dc66a1ccd78dd7ca2f7e3f9a1bb78fafa5cac30244e7` | 未发现未关闭的 v1.1 或 A5 门槛；Protocols.io 继续只读，交互式 Electron SIGABRT 继续作为环境观察，不阻断本机构建产物 |
