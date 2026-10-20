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
pi install npm:@gyoungwe/research-suite@0.1.5
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

“技能与连接”页的后续收口以 [skills-connections-ui-v2-plan.md](skills-connections-ui-v2-plan.md) 为准：页面只保留插件、连接器、MCP、Skill 四个栏目，插件栏同时接入 Pi 官方市场与 Drone 插件仓库，Skill 仓库单列并改为手动更新。

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
[头像菜单：设置 · 帮助 · 关于]
```

- "研究"不单独做入口。研究就是在「新任务」里发起的任务，首页三张卡（研究 / 知识库 / 接力）是它的快捷入口。
- 不设"运行"和"证据"一级入口。它们放进右栏：页签为 **总览 / 文件 / 变更 / 主机**。总览从上到下依次是：用量 → 步骤 → 交付物 → 子智能体 → 证据（有内容时才出现）→ 审稿 / 决策（有待处理项时才出现）。
- 插件不能新增一级导航。插件只能贡献 `panel.tab`、`rail.view`、`context.action`、`command` 和现有的 slot。只有提供完整、持久工作区的插件，才能申请 `nav.item`，并且需要宿主白名单批准。

**页面与设置的边界（CO-3）**：页面管理能力和数据，设置弹窗只管理通用、外观、模型、权限、关于五类偏好。技能、MCP、扩展、UI 插件、Zotero、机构访问在「技能与连接」页的右侧抽屉中管理；主机登记在「主机」页；Vault、WebDAV、维护和工作流总览在「知识库 → 知识库设置」中管理。旧设置深链接保留一个版本，并转换为页面/抽屉跳转。

**来源分组（CO-2）**：技能列表使用宿主已有的 `sourceInfo.source`，按 npm Drone 插件、个人、项目和内置来源折叠展示；跨来源同名技能只显示一行，并展开列出其他来源和当前 Pi 加载顺序中的生效来源。对于内置科研技能，`packages/shared/src/research-skill-sources.json` 是唯一的仓库映射，界面显示 GitHub 仓库并可打开锁定 commit/path；`local`、`auto` 等 loader 标签只能作为未知技能的回退显示，不能冒充仓库来源。分组开关通过 `setSkillNamesEnabled` 会话契约逐项更新运行时可见性，当前窗口后续新会话继承该内存状态；显式调用被禁用技能也返回不可用。它不引入新的持久化配置格式。技能与连接页同时提供“更新内置研究技能”入口，复用 commit/hash 校验、版本化 overlay 和安全重启流程；更新不会静默替换当前清单。

**能力状态的统一表达**（在「技能与连接」里显示，任务里引用这些能力时也用同一套）

| 状态 | 样式 | 主操作 |
|---|---|---|
| 可用 | 灰色圆点 + 版本号 | — |
| 需要配置 | 琥珀色描边徽标 | 配置 |
| 运行中 | 绿色脉冲圆点 | 查看 |
| 已禁用 | 文字变灰 | 启用 |
| 权限不足 | 琥珀色徽标 | 授权 |
| 来源过期 | 琥珀色徽标 + 时间 | 重新读取 |
| 连接错误 / 不可用 | 红色徽标 | 查看原因 |
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
5. **版本漂移监控**：`/drone-doctor` 输出 schema v1 的 host kind/version/source、插件版本/兼容范围、核心工具和 onboarding 命令检查；缺失工具或命令时为 `blocked`，已读取但不在 `piRange` 内时为 `incompatible`，无法读取 host 版本时为 `unknown`，并给出下一步修复提示。它只读，不修改安装或用户数据。
6. **旧版处理**：不为首版插件生态保留旧版兼容分支；若未来必须支持旧版，单独创建兼容 adapter 和插件 major/实验通道，完成独立回归后再决定是否纳入支持矩阵。

## 7. 安装和首次使用

安装聚合包后，以下命令有稳定注册、输出合同和真实 CLI smoke 证据：

```text
/drone-init
/drone-doctor
/drone-example
```

`/drone-init` 只完成配置和无副作用检查，不自动写入 Zotero、WebDAV 或远程主机。

`/drone-doctor` 由 `@gyoungwe/pi-core@0.1.3` 注册，返回 schema v1 JSON；检查核心工具、两个 onboarding 命令和 Pi host 版本。状态为 `pass`、`blocked` 或 `unknown`，不会写入外部服务。

`/drone-example [knowledge|research|analysis|evidence]` 按参数选择知识库、研究、分析准备度或证据核验示例，省略参数时默认为 `research`；它返回 profile-specific 的 `unconfigured`、`needs-data`、`blocked` 或 `ready`。没有绑定 Vault、缺数据或缺容器时不得返回 `ready`。只有 `/drone-example <profile> --run <问题>` 才排队只读示例回合，状态为 `started`，不隐式写入 Zotero、WebDAV、远程主机或用户 Vault。

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
| Pi 运行基线 | **suite 与 onboarding commands 真实 CLI 回归通过；旧版冲突负例保留** | `drone-plugins` `5cd915e` 的 `scripts/pi-cli-regression.mjs` 在独立 HOME 中对 Pi `1.1.0`/latest（实际解析 `1.3.0`）执行真实 `pi install` 与 `/task-status`、`/drone-doctor`、`/drone-example`；`research-suite@0.1.5` 两个版本 PASS；已弃用 `0.1.1` 两个版本均以 stderr `conflicts` 和 exit 1 失败，状态为 EXPECTED_FAILURE；证据见 [`v0.33.2-pi-cli-regression.json`](releases/v0.33.2-pi-cli-regression.json) | CI 每次 push/PR 重跑锁定/latest；旧冲突负例继续保留 |
| `DroneHostPort` 与通用插件能力协商 | **v1.1 插件迁移与宿主加载已通过** | `@gyoungwe/plugin-api`、HostPort、manifest capability check、`compatible/degraded/incompatible` 测试、迁移闸门和所有 v1.1 包的 clean prefix/loader/宿主检查均已通过 | A5-1～A5-4 已完成兼容层收敛，继续保持已发布包边界 |
| `@gyoungwe/pi-analysis` | **V1.1-A 门槛已关闭** | `drone-plugins` 当前 `main=5cd915e`（包实现提交 `2168576`）提供自包含 `dist/index.mjs`/声明/manifest；`@gyoungwe/pi-analysis@0.1.0` 已公开发布，registry metadata、shasum/integrity、全新 prefix 安装和 Pi loader 发现均 PASS；backend 以精确版本加载公共包，兼容 facade 保留；计划→执行→审查→交付 focused proof 与 Pi 1.1.0/latest 矩阵通过 | 持续维护由 `drone-plugins` 负责；本仓库不再保留 pi-analysis 源码或构建脚本 |
| `@gyoungwe/pi-evidence` | **V1.1-E 公开 registry 与宿主门槛已关闭** | `drone-plugins` main `5cd915e`（实现提交 `222936c`）提供自包含 artifact/provenance/replay 包；`@gyoungwe/pi-evidence@0.1.0` registry tarball 的 shasum `4826a8f5663be2af382cecc227254a547d5f44af`、integrity 与公开元数据一致；全新 prefix 安装、3 个只读工具调用、Pi 1.1.0 loader 和宿主 clean prefix 均 PASS；宿主临时源码已删除 | 持续在 `drone-plugins` 维护；真实文件写入、replay runner 和科研结论门禁仍由宿主组合根负责 |
| `@gyoungwe/pi-connectors` | **V1.1-C 公开 registry 与宿主门槛已关闭** | `drone-plugins` main `5cd915e`（实现提交 `222936c`）提供六类只读 connector descriptor、权限声明、回执链和 2 个元数据工具；`@gyoungwe/pi-connectors@0.1.0` registry tarball 的 shasum `1629eb468f607f7be969d347cd03aff2dc0d03e3`、integrity 与公开元数据一致；全新 prefix 安装、Pi loader、6 个 descriptor 和宿主 clean prefix 均 PASS；宿主临时源码已删除 | 真实网络/凭据/写入/回读/删除仍按连接器逐项授权；Protocols.io 保持只读 |
| `@gyoungwe/pi-*` 公共包与 `@gyoungwe/research-suite` | **task ownership、onboarding commands 及 suite 兼容门槛已关闭** | `@gyoungwe/pi-knowledge@0.1.1` 已移除 task runtime 注册并删除重复 `research-workflow` skill；`@gyoungwe/pi-core@0.1.3` 注册 `/drone-doctor`、`/drone-example`；`@gyoungwe/research-suite@0.1.5` 捆绑 plugin-api/pi-core/pi-knowledge/pi-research，公开 tarball、shasum/integrity、干净克隆 check 和真实 Pi CLI 矩阵均通过；旧 `research-suite@0.1.1` 已执行弃用标记“与 pi-core 冲突，无法启动”，完整证据见 [`v0.33.2-pi-cli-regression.json`](releases/v0.33.2-pi-cli-regression.json) | 由 `drone-plugins` CI 在 Pi `1.1.0`/latest 上持续回归 |
| 宿主仓库 / 插件仓库边界 | **pi-knowledge、pi-analysis、pi-evidence、pi-connectors 外部迁移和公开发布闸门已关闭** | [本地 ../drone-plugins](../drone-plugins) `main=5cd915e`；外部包自包含、无宿主 fallback，干净克隆 `npm ci → npm run build → npm run check`、`publish.yml` 顺序 dry-run、公开 tarball、Pi CLI 和宿主 clean prefix 通过；宿主临时 evidence/connectors/research-suite 源码已删除，根锁文件固定 registry 包 | Desktop/Pi 仅从已安装 npm 包加载；后续只在 `drone-plugins` 维护这些插件 |
| Desktop UI Pack 独立分发 | **V1.1-UI 公开 registry 与宿主安装生命周期已关闭** | `drone-plugins` main `5cd915e`（实现提交 `baf9b3b`）的 `@gyoungwe/desktop-ui-pack@0.1.0` registry tarball shasum `73e79d49b0678a0379fbdb7f1ec4d7ebb2b455e5`、integrity 与公开元数据一致；宿主从公开 tarball 安装后由 `UiPluginManager` 发现、启用、读取并完成测试；构建产物验收仍为 16/16 | 公开包继续独立发布；交互式 Electron 截图仍不作为本门槛 |
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

**当前发布范围决议（2026-10-19）**：本版本正式安装包只要求 macOS arm64/x64 的构建、安装、启动和产物回读验收。Windows 构建、上传和回下载不属于当前发布门禁，记录为 `OUT_OF_SCOPE`，不得因未执行 Windows 验收阻断 macOS 发布。若未来恢复 Windows 支持，必须单独恢复对应 runner、资产清单和上传后回下载验收。

**目标完成条件**：五个 v1.1 节点都有公开 tarball 验证；Desktop 只通过 host API 加载已安装包且无隐藏宿主 fallback；suite 能干净安装并发现全部资源；计划与索引记录两个仓库 head、版本、证据路径以及剩余 `BLOCKED`/`NOT_RUN`；没有新的架构红线或未审查的外部写入。

### 9.3 2026-10-20 计划缺口复核

两份计划和本轮口头布置逐项复核后的状态如下：

| 项目 | 当前判定 | 证据或缺口 |
| --- | --- | --- |
| 架构 v2 A0–A7、P9、P10、A5-1～A5-4 | **完成** | `docs/architecture-v2-tasks.md` 只有 B8 保留为未勾选的暂缓项；其余任务均有实现和门禁记录。 |
| 市场独立栏目、官方/社区 MCP 与 Skill 入口、Drone 包版本/说明、左侧 sticky 导航 | **已实现；真实 registry 生命周期部分通过** | v0.33.4 UI 回读四栏、市场卡片、八个 Drone 包元数据和长列表 sticky 导航；本轮真实 registry `@gyoungwe/pi-core@0.1.5` 安装、原生会话和卸载通过。Pi CLI 更新返回成功但旧版本目录未替换，官方第三方 extension 仍 `NOT_RUN`。 |
| 技能来源映射与 Skill 仓库管理 | **完成代码与隔离 FS 回归** | `research-skill-sources.json`、任意 Git URL/本地目录、ref/subpath/许可依据、哈希 staging、原子应用、失败保留和来源卸载已落地；桌面定向测试 3/3 通过。正式 Electron GUI 交互截图仍受环境限制。 |
| 主机 SSH 配置选择器 | **完成（macOS 正式包）** | 正式包发现 8 个 Host 别名并加入 `drone-gaoxuze-c`；只读元数据，不读取私钥正文。远程连通性仍需单独授权，不把发现误报为健康检查。 |
| 分层热插拔 | **worker 回滚通过；Pi CLI 更新语义待上游确认** | worker `prepareUnload → drain → dispose → load → healthCheck`、失败自动回滚、生命周期事件和真实 SDK 专家回归通过；UI 插件运行中启停/重载通过。Pi CLI `update` 的旧目录版本未替换，暂不宣称完整更新 PASS。 |
| 真实知识闭环与主线实机门槛 | **MCP/原生 Pi 已通过，外部配置仍有边界** | 原生 Pi 1.1.0 真实 registry 包 `/drone-doctor`、模型会话和卸载 PASS；native stdio MCP `mcp__echo` 返回唯一值并卸载 PASS。外部用户 MCP、正式 Electron GUI 和 P1 知识写入闭环仍 `NOT_RUN/BLOCKED`。 |
| 视觉对照与版本发布 | **深色构建渲染通过** | `docs/releases/visual/drone-visual-comparison-dark.json` 四视图 PASS；这是 built renderer 的 headless 证据，交互式 Electron 截图仍受环境限制。完整门禁证据见 [`v0.33.5-plugin-gates.json`](releases/v0.33.5-plugin-gates.json)。 |

上述未闭合项属于 backlog 或环境门槛，不改变已通过的 `MCP-01`、`MEM-01`、`REDLINE-01`，也不触碰暂缓的 B8、只读的 Protocols.io 和无证书发布策略。

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

> Older execution entries are archived in [final-pluginization-plan-log-2026-10-19.md](archive/final-pluginization-plan-log-2026-10-19.md), [final-pluginization-plan-log-2026-10-20.md](archive/final-pluginization-plan-log-2026-10-20.md), and [final-pluginization-plan-log-2026-10-20-gates.md](archive/final-pluginization-plan-log-2026-10-20-gates.md).

| 2026-10-18 | 本轮计划复核 | Drone `main=260995a0`、`drone-plugins main=8389116` 均与远端一致；`check:remaining-gates`、`check:plugin-api --migration --lifecycle`、Pi 1.1.0/latest 兼容矩阵、`test:upgrade -- --fixtures-only`、`drone-plugins npm run check` 和桌面产物 16/16 均通过；最新桌面产物 SHA-256 为 `9db8e47ec4c039415ca6dc66a1ccd78dd7ca2f7e3f9a1bb78fafa5cac30244e7` | 未发现未关闭的 v1.1 或 A5 门槛；Protocols.io 继续只读，交互式 Electron SIGABRT 继续作为环境观察，不阻断本机构建产物 |
| 2026-10-19 | v0.33.2 worker / onboarding / mainline patch | v0.33.1 正式 macOS arm64 包审计复现 `research-workbench/extensions/knowledge-worker.mjs` 缺失，已将 backend worker factory 接到同一 packaged resource，并为缺失资源增加 fail-closed 检查与回归测试；`/drone-example` 已按四种 profile 返回明确状态，`/drone-doctor` 读取已安装 Pi package 版本并报告 `incompatible`，MCP failed 映射为红色 `error`；`npm run test:mainline` 4/4，离线 20 题×2 轮输出 40/40 本地回答、0 联网调用、40/40 引用可解析 | v0.33.2 本机 unsigned arm64/x64 应用资源均通过 packaged knowledge check，证据见 `docs/releases/v0.33.2-knowledge-package.json`；正式远端 release tag 仍待发布。上述 mainline 结果是离线 faux-provider 指标，不单独宣称真实会话 PASS；B8 与 Protocols.io 写入保持不动 |
| 2026-10-19 | v0.33.2 registry / Pi 矩阵收口 | `@gyoungwe/pi-core@0.1.3` 与 `@gyoungwe/research-suite@0.1.5` 已公开；drone-plugins `5cd915e` 的 clean `npm ci && npm run check` 通过；真实 Pi 1.1.0（resolved 1.1.0）与 latest（resolved 1.3.0）均完成独立 HOME 的 tarball 安装和 `/task-status`、`/drone-doctor`、`/drone-example`，正例 PASS，旧 `research-suite@0.1.1` 两版本均 EXPECTED_FAILURE（`conflicts` + exit 1），证据见 `docs/releases/v0.33.2-pi-cli-regression.json` | 本机 arm64/x64 unsigned packaged knowledge check 已通过；v0.33.2 远端 release tag 仍需在 PR 合并后由 release workflow 生成；B8 与 Protocols.io 写入保持暂缓/只读 |
| 2026-10-19 | v0.33.3 安装包发布门禁修复、提速与本机重建 | 新增 `scripts/check-release-artifacts.mjs`：构建后对 macOS 双架构 DMG/ZIP、Windows ZIP/NSIS 做真实 payload 检查；macOS 改为单次双架构构建，构建与验证并行，Electron/Builder 缓存和资产白名单降低重复耗时并阻止未知文件；Release 上传后由 macOS/Windows runner 回下载 installers、blockmaps 和 update metadata，按构建清单做双向 SHA-256 比对，再重复安装包检查；draft 只有在 `post-upload-verify` 全部通过后才公开。v0.33.3 unsigned 本机 arm64/x64 ZIP 均通过 `ditto`，DMG 均通过 `hdiutil`，版本和 `app.asar` 检查通过；证据见 `docs/releases/v0.33.3-asset-validation.json` | Windows runner 和 v0.33.3 GitHub draft 回下载验收尚未执行，保持 `NOT_RUN`；证书仍不属于门槛，B8 与 Protocols.io 写入保持暂缓/只读 |
| 2026-10-19 | 实机报告 P1-6 / P2-9 / P2-17 与正式安装包收口 | P1-6 改为单次写入确认卡，Vault 入口明确为“切换或创建知识库”，范围文案明确为应用级共享 + Projects 分区；P2-9 首页移除重复项目/最近/环境摘要，入口卡统一浅色中性风格并默认收起右栏；P2-17 Zotero 只有注册且本机 API 可达时才显示启用，否则显示“已注册但不可用”并锁定开关。v0.33.3 无证书 arm64/x64 DMG/ZIP 在本机真实挂载、干净目录安装、framework symlink、`Drone --version` 和进程存活检查均通过；正式包启动由 CUA 现场回读 | macOS 签名按计划为 `NOT_RUN`；Windows 上传后回下载仍由 release workflow 执行，B8 与 Protocols.io 写入保持暂缓/只读 |
| 2026-10-19 | 发布验收范围降级为 macOS-only | 用户确认本版本只要求 macOS 正式安装包验收；`.github/workflows/release.yml` 的 validate/build/post-upload-verify 矩阵已收敛为 macOS，publish 只检查 macOS 资产；v0.33.3 arm64/x64 DMG/ZIP 的本机挂载、干净目录安装、`Drone --version` 和真实进程启动证据保持 PASS；Windows 构建、上传和回下载在 `docs/releases/v0.33.3-asset-validation.json` 标记为 `OUT_OF_SCOPE` | 不恢复 Windows 门禁，除非另有版本决议；macOS 签名按无证书策略为 `NOT_RUN`，B8 与 Protocols.io 写入继续暂缓/只读 |
| 2026-10-19 | v0.33.3 macOS-only Release 上传后验收 | workflow [`39222533359`](https://github.com/Gyoungwe/Drone/actions/runs/39222533359) 的 macOS validate、双架构 build、publish、post-upload-verify、finalize 和 website 全部成功；从已发布 [`v0.33.3`](https://github.com/Gyoungwe/Drone/releases/tag/v0.33.3) 回下载 arm64/x64 DMG/ZIP、blockmap 与 `latest-mac.yml`，再次运行 `check-release-artifacts` 通过，Release 已公开 | Windows 不参与本版本门禁；证书按无证书策略为 `NOT_RUN`，B8 与 Protocols.io 写入继续暂缓/只读 |
| 2026-10-19 | 实机报告剩余项与 CO-1～CO-4 对照 | `docs/real-device-acceptance-20261019/README.md` 已补充 CO-1～CO-4 的改前/改后证据边界和未关闭门槛；CO-1/CO-3 代码完成待 v0.33.4 正式包，CO-2 的来源分组、去重、插件列表、MCP error 和会话级整组启用/禁用已完成，回归测试覆盖显式技能不可用；静态 renderer 视觉预览不计最终 PASS | P1-2/3/4/7/8、P1-5、V6 仍待 v0.33.4 正式包或真实会话；V4 MCP 为 BLOCKED，V5 原生 Pi 为 NOT_RUN；B8 和 Protocols.io 写入继续暂缓/只读 |
| 2026-10-19 | 技能仓库来源与更新入口收口 | 修正技能页不再把 `local`/`auto` 当作仓库来源：科研技能通过锁定目录映射到 `Yuan1z0825/nature-skills`、`K-Dense-AI/scientific-agent-skills` 等 GitHub 仓库，并可打开精确 commit/path；技能与连接页新增仓库级来源卡片，显示锁定 commit、加载/内置计数和自动检查/仅目录状态；更新检查在 GitHub API 403/429 时回退到公开 Atom feed；正式包宿主资源清单补列 pi-core、pi-knowledge、pi-research、desktop-ui-pack 的版本与状态 | v0.33.4 正式安装包真实回读来源卡片、GitHub 仓库链接、更新入口和宿主插件清单通过；B8 与 Protocols.io 写入继续暂缓/只读 |
| 2026-10-20 | 计划缺口复核、修改单返修与 v0.33.4 发布 | 修改单 7 项已实现；本地完整门禁、`check:remaining-gates`、`check:plugin-api`、浅色四视图 4/4、无证书 arm64/x64 产物检查通过。PR #236 合并到 `main`（merge `56d2a607`），远端 CI run [`39368745905`](https://github.com/Gyoungwe/Drone/actions/runs/39368745905) 的 macOS/Windows 静态、backend、Desktop/workspace 和 Native Pi 检查全部通过；Release run [`39369532749`](https://github.com/Gyoungwe/Drone/actions/runs/39369532749) 的 validate、双架构构建、上传、post-upload-verify、finalize、website 全部通过，v0.33.4 已公开；发布资产再次下载并通过 `check-release-artifacts`，证据见 [`v0.33.4-asset-validation.json`](releases/v0.33.4-asset-validation.json) | P3 任意 Skill 仓库、完整市场生命周期、worker 回滚、MCP/原生 Pi/深色对照仍未闭合；B8/Protocols.io/无证书策略不变 |
| 2026-10-20 | Skill 仓库、市场生命周期、worker 回滚、MCP/native Pi 与深色对照收口 | 任意 Git/本地 Skill 仓库管理已实现并通过 3/3 定向回归；worker candidate health-check、原子切换、排空和失败回滚通过；真实 registry `@gyoungwe/pi-core@0.1.5` 在 Pi 1.1.0 中完成安装、`/drone-doctor`（宿主 1.1.0）和模型会话 `NATIVE_PI_REGISTRY_OK`，卸载通过；`pi-mcp-adapter@5.1.0` 真实 stdio `mcp__echo` 返回 `echo:native-mcp-acceptance` 并卸载；深色 built-renderer 四视图 4/4 PASS；证据见 [`v0.33.5-plugin-gates.json`](releases/v0.33.5-plugin-gates.json) 和 [`drone-visual-comparison-dark.json`](releases/visual/drone-visual-comparison-dark.json) | Pi CLI `update` 命令返回成功但 managed 目录仍保留旧版本，暂不标记版本替换 PASS；官方第三方 extension、外部用户 MCP、交互式 Electron GUI 和 B8/Protocols.io 写入继续 `NOT_RUN/BLOCKED/暂缓` |
