# 技能与连接页 v2：Pi 市场、Drone 插件与能力生命周期

状态：设计已确认；P0～P3 和 P4 的已实现部分已在 macOS 正式包回读。市场栏、连接器描述、Drone registry 元数据、sticky 导航、SSH 选择器和 UI 插件重载均有证据；本轮返修已补齐空配置 Skill 投影、内置插件状态、Zotero/WebDAV 去重、知识库单层页签/网络图空状态和项目/最近空态。官方/Drone 包完整安装更新卸载、任意 Skill 仓库添加/应用、MCP 真实配置和深色前后视觉对照仍未完成。

本计划承接 [`final-pluginization-plan.md`](final-pluginization-plan.md) 的插件化边界和 [`plugin-hot-reload-plan.md`](plugin-hot-reload-plan.md) 的分层重载规则。它只重做 Desktop 的“技能与连接”页信息架构，不改变 `@gyoungwe/plugin-api`、Pi package manifest 或已有结果/证据合同。

当前实现已落在 `codex/plugin-hot-reload-plan`：Pi 官方目录只进入 extension 结果；Drone 包按标准 `package.json.pi` 与可选 `ui/plugin.json` 映射；页面固定为“市场 / 连接器 / MCP / 技能”四栏，不再有“全部”栏目；连接器目录和启停使用现有 Research contract；Skill 仓库改为 URL/分支和显式手动检查。市场栏另外提供 MCP 官方参考仓库、社区 MCP 目录和科研 Skill 开源仓库的发现入口，安装、权限与更新仍在各自栏目执行。

## 1. 目标与明确决议

“技能与连接”页只管理能力的来源、状态和生命周期。页面不再提供“全部”混合列表，也不在每个栏目重复展示技能仓库。

页面固定为四个本页栏目：

1. **市场**：Pi 官方插件市场、Drone 插件仓库、已安装插件，以及 MCP/Skill 开源资源发现入口。
2. **连接器**：`pi-connectors` 及其可选连接器 descriptor、权限和回执。
3. **MCP**：用户配置的 MCP server、`pi-mcp-adapter` 运行状态和预设。
4. **Skill**：已加载 skill、来源分组、启用状态，以及独立的 Skill 仓库纵向列表。

Pi 官方市场和 Drone 插件仓库使用同一套 Pi 官方 package/extension 接入格式。Drone 插件不得发明只能由 Drone 识别的安装格式：原生能力必须通过 `package.json` 的 `pi.extensions`、`pi.skills`、`pi.prompts` 等官方字段接入，依赖通过标准 npm package 安装。Desktop UI contribution 可以作为同一 npm 包的可选增强，继续使用现有 `ui/plugin.json` + `@gyoungwe/plugin-api` 合同；这只描述 Desktop UI 扩展，不替代 Pi extension manifest。

两类重载必须在界面中如实区分：Desktop UI 插件支持运行中启用/禁用/重载；Pi extension、skill 和连接器包在当前会话排空后或下一次 Pi 会话生效；Electron main/preload 改动要求重启应用。

## 2. 页面外壳

### 2.1 结构

保留一级导航“技能与连接”。页面内容区采用左侧本页导航 + 右侧单一列表：

```text
技能与连接                                      [刷新] [添加]
能力来源和运行状态
┌──────────────┬─────────────────────────────────────────────┐
│ 市场         │ 当前栏目标题 + 状态摘要                     │
│ 连接器       │ 单一类型列表                                 │
│ MCP          │                                               │
│ Skill        │                                               │
└──────────────┴─────────────────────────────────────────────┘
```

不保留“全部”入口。每次只呈现一个对象类型，避免插件、技能仓库、MCP 和连接器互相污染。点击列表条目打开统一的右侧详情抽屉，抽屉不改变左侧栏目选择。

### 2.2 共享状态和交互

所有能力使用同一组语义：可用、运行中、需要配置、已禁用、权限不足、连接错误/不可用、宿主不兼容、有更新。失败状态显示真实原因；“来源过期”不再用于 MCP 连接失败。

每个可操作条目必须有键盘焦点、明确的 aria-label、禁用态和加载态。开关只表达启用状态，安装、更新、卸载、重载和授权使用明确的按钮。危险操作采用二次确认，并在完成后刷新状态和生命周期回执。

## 3. 市场栏目

### 3.1 市场的纵向区块

市场栏目只负责发现和管理插件包，不显示单个 skill、MCP server 或连接器 descriptor；MCP/Skill 开源资源卡片只提供公开仓库发现链接，不替代各自栏目的安装和状态合同。

1. **Pi 官方插件市场**
   - 复用现有 `PackagesContract`、`PackageService`、`CatalogStore` 和 `pi.dev/packages` 目录。
   - 查询只使用 `CatalogPackageType = extension`，不再把 skill、prompt、theme 混进插件结果。
   - 每行显示包名、简介、作者、来源“Pi 官方市场”、版本/更新时间、安装状态和安装/卸载操作。
   - 继续使用 `npm:<name>` 作为标准安装源；目录不可用时显示网络错误和重试，不伪造空成功。

2. **Drone 插件仓库**
   - 来源固定为绑定的 `drone-plugins` workspace 和其公开 npm scope `@gyoungwe/*`；首期展示 `pi-core`、`pi-knowledge`、`pi-research`、`pi-analysis`、`pi-evidence`、`pi-connectors`、`desktop-ui-pack`、`research-suite`。
   - 仓库条目来自 package manifest/registry metadata，不复制 skill 清单。
   - 每行显示包名、Pi extension/skill/UI contribution 能力摘要、版本、兼容的 Pi/Host API、安装状态和更新状态。
   - 同一个 npm 包在官方市场和 Drone 仓库同时出现时合并为一行，保留两个来源徽标和一个安装状态，避免重复安装。

3. **MCP/Skill 开源资源目录**
   - 官方 MCP 参考服务器使用 `modelcontextprotocol/servers`；社区 MCP 目录使用经过审核的公开列表；Skill 入口复用 Nature、Scientific Agent 和 Open Science 等公开仓库。
   - 这些卡片只打开公开仓库，不把第三方 MCP 或 Skill 自动装入用户配置；实际安装仍由 MCP/技能栏的权限与手动更新流程控制。

4. **已安装插件**
   - 汇总真实 `settings.json` package 记录、Pi loaded extensions 和 `UiPluginManager` 的 UI packages。
   - 显示“Pi 能力插件”与“Desktop UI 插件”类型标签；插件内部携带的 skill 只在 Skill 栏显示。
   - 内置插件可禁用但不可卸载；用户安装插件支持更新和卸载。

### 3.2 市场插件热插拔操作

- 安装：先写入隔离 staging 目录，校验标准 package manifest、依赖、integrity 和 Host/Pi 兼容性，再原子切换。
- 启用/禁用：UI 插件可立即重载 contribution registry；Pi extension/skill 包在会话边界或下一次会话生效，并显示当前版本与下一会话版本。
- 更新：保留上一份已验证版本；更新失败、工具冲突或健康检查失败时自动回滚。
- 卸载：先停止可停止的 worker、关闭连接句柄、刷新 session resources；执行中的任务不允许中途替换执行器。
- 详情抽屉：显示 package name、来源、版本、manifest 能力、权限、副作用、当前/下一会话版本、最近生命周期事件和失败原因。

## 4. 连接器栏目

连接器栏目只显示连接器 descriptor，不显示 MCP server 或 skill repository。

- 每行显示名称、类型（文献、引用、数据集、Protocol、机构、项目存储）、来源包、网络范围、只读/读写、外部副作用、作用域和当前状态。
- 提供启用/禁用、配置、测试连接、查看最近回执、重试和卸载动作。
- “添加连接器”打开 `pi-connectors` 目录；目录条目必须带权限声明、凭据来源、读写边界和宿主要求。
- 凭据只显示来源和环境变量名，不回显密钥正文；写入型连接器继续使用授权→创建→回读→删除验收。
- 详情抽屉显示最近搜索、`ResearchConnectorSourceReceipt`、失败原因、retryable 状态和最后一次调用时间。

## 5. MCP 栏目

- 顶部显示 `pi-mcp-adapter` 版本、配置文件路径、运行时状态和工具/资源总数。
- 逐个显示 configured MCP server：名称、stdio/http/socket 传输、user/project 作用域、工具数、资源数、启用开关和连接状态。
- `failed`、`needs-auth`、`blocked` 使用红色/琥珀色状态并展示具体原因；不再映射成“来源过期”。
- 操作包括启用/禁用、重连、打开配置、移除和查看最近错误。配置变更显示“正在重新连接”或“下个会话生效”。
- 预设 MCP 放在列表末尾的独立“添加 MCP”区块，复用现有 `MCP_PRESETS`，不把预设误认成连接器。

## 6. Skill 栏目

### 6.1 已加载 Skill

- 顶部提供搜索、已加载数量和已启用数量；不提供跨类型“全部”过滤。
- 按真实来源分组：npm 插件、个人、项目、内置。相同名称只显示一行，可展开查看其他来源和当前生效来源。
- 每行显示名称、调用模式（自动/手动）、作用域、来源和启用开关；保留整组启用/禁用及显式调用的 manual-only 语义。

### 6.2 Skill 仓库

Skill 仓库是 Skill 栏底部唯一的仓库区块，使用全宽、单列、纵向列表：

```text
Skill 仓库                                      [添加仓库]
┌──────────────────────────────────────────────┐
│ Nature Skills · GitHub URL · main             │
│ 已加载 20 · 内置 20 · 上次检查 ...             │ [检查更新] [手动更新]
├──────────────────────────────────────────────┤
│ Scientific Agent Skills · GitHub URL · main   │
│ 已加载 ...                                    │ [检查更新] [手动更新]
└──────────────────────────────────────────────┘
```

- 产品层面不锁定 commit，也不把锁定 commit 当作来源展示；来源记录 URL、分支/引用、路径、许可依据、最后一次手动检查和当前应用状态。
- 不再启动时或定时自动更新。用户点击“检查更新”后才读取远端；“手动更新”必须先展示变更数量/文件，再暂存、确认应用和安全重启。
- 应用失败时保留当前版本并恢复 staging；显示失败原因和回滚按钮。更新不会静默替换当前清单。
- “添加仓库”支持授权的 Git URL 或本地目录、分支和许可依据；卸载仓库只移除来源配置，不删除已经沉淀的知识内容。

## 7. 宿主合同与实现边界

1. 先扩展共享的 capability catalog、package source、connector permission、skill repository 和 lifecycle result 类型；公共 `@gyoungwe/plugin-api` 不变。
2. 新增 IPC 必须同步 `shared/src/ipc.ts`、preload、`main/ipc/` 和 backend；renderer 只能通过 `window.pi` 访问。
3. 官方 Pi 市场复用现有 Packages IPC；Drone 仓库目录增加独立的 source adapter，但安装最终仍调用标准 `installPackage(npm:<name>)`，不复制一套 npm 管理器。
4. Pi extension 包和 Desktop UI package 可以同一个 npm tarball 携带两种 manifest：官方 `package.json.pi` 负责原生 Pi，`ui/plugin.json` 负责可选 Desktop contribution；两者的启用和重载时机必须分别显示。
5. JSON 状态继续走 backend `JsonStore`；不把 npm token、凭据、Vault 正文、会话正文或结果目录写入 UI 状态。

## 8. 分阶段执行与门禁

### P0：合同与目录

- 定义四类 source/lifecycle view model，复用现有 Packages、MCP、UiPlugin 和 research connector 合同。
- 让 Pi 官方市场只返回 extension 类型；增加 Drone package source adapter 和去重规则。
- 测试来源合并、安装状态匹配、失败状态和权限字段。

### P1：页面壳与市场栏目

- 删除 `all` filter 和混合 `CapabilityRow` 渲染；建立四栏本页导航和统一详情抽屉。
- 将现有 `BrowseSection`/`LoadedSection` 合并到市场栏目，保留 pi.dev 搜索和卸载语义。
- 接入 Drone 仓库列表、官方市场来源徽标和插件生命周期动作。

### P2：连接器与 MCP

- 连接器目录、权限标签、回执抽屉和启用/禁用/测试状态。
- MCP runtime banner、server list、错误原因、重连和预设区块。
- 真实失败状态必须显示 error/permission，不能显示 stale。

### P3：Skill 与手动仓库更新

- 已加载 skill 列表与来源去重。
- Skill repository 单列纵向列表、URL/branch 元数据和手动更新流程。
- 移除自动检查/锁定 commit 的产品行为；保留完整性校验和失败回滚。

### P4：热插拔与发布验收

- UI plugin 运行中重载；Pi package/skill/connector 以会话边界或下一会话生效。
- 真实安装包验证：官方市场安装一个 extension、Drone 包安装/禁用/更新、UI plugin 重载、MCP 错误显示、连接器开关、Skill 仓库手动更新。
- 浅色/深色正式安装包截图对照；更新 README、计划和发布说明。
- 市场栏与 MCP/连接器/技能同级；市场导航在长列表滚动时保持 sticky；连接器条目显示用途描述；Drone 包在未安装时也显示 registry 版本和描述。

### 8.1 2026-10-20 实施审计

| 阶段 | 状态 | 已有证据 | 未关闭项 |
| --- | --- | --- | --- |
| P0–P2 | **PASS（实现/正式包回读）** | 四栏合同、市场来源合并、连接器描述/开关和 MCP 错误状态代码均已落地；v0.33.4 安装包回读市场、sticky 导航和连接器开关。 | MCP 仍因无配置为 `NOT_RUN`，没有真实外部 server 的错误/恢复回读。 |
| P3 | **PARTIAL** | 内置研究技能来源映射、GitHub/Atom 检查、staging、完整性校验、失败恢复和手动检查入口已通过。 | 尚无“添加任意 Git URL/本地目录 + 分支/路径/许可依据 + 卸载来源”的持久化 IPC/UI；手动更新的真实应用/回滚尚未在正式包完成。 |
| P4 | **PARTIAL** | UI plugin 运行中启停/重载、市场元数据、四栏和 SSH 选择器已有正式包证据；浅色四视图通过。 | 官方 extension 安装、Drone 包更新/卸载、worker 排空/失败回滚、Pi 下一会话提示、MCP 真实运行和深色前后截图仍未闭合。 |

实现边界因此保持不变：不把内置来源卡片误报为通用 Skill 仓库管理，不把静态预览或 loader-only 结果标为最终 PASS，也不把 B8 或 Protocols.io 写入拉回当前范围。

## 9. 验收红线

- 只有真实安装包或真实启动会话才能标记 PASS；loader-only、fixture-only、静态 renderer 预览不能替代最终证据。
- 插件市场不可用时显示可解释错误；不能把目录空列表当作“无插件”。
- Pi 包不能重复打包 Pi runtime；UI 插件不能直接 import Pi SDK、Electron 或 backend 私有实现。
- 热插拔失败必须回滚或明确显示下一会话/重启要求，不能报告虚假的当前会话成功。
- B8 云端协作保持暂缓，Protocols.io 保持只读，签名和 Windows 是否验收继续服从当前发布范围。

