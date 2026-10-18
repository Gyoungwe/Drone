# 插件构建与宿主热插拔计划

状态：设计阶段，基于 v0.33.2 的双仓库边界；不改变现有插件 API，不启动 B8 云端协作。

## 目标

`drone-plugins` 是插件源码、构建、打包、发布和兼容矩阵的唯一权威位置。Drone 宿主只通过公开 npm tarball 或用户明确选择的本地 tarball 安装插件，校验 manifest、完整性和 host API 版本后，运行时发现并管理插件。新增能力的常规路径变成：插件仓库实现 → CI 构建/真实 Pi 回归 → 发布版本 → Drone 安装/启用，而不是把领域实现重新复制到宿主仓库。

“热插拔”按宿主层级定义，不能把所有代码都在任意时刻替换：

| 层 | 支持的重载时机 | 说明 |
| --- | --- | --- |
| Desktop UI contribution | 运行中启用、禁用、重载 | 由 UI plugin manager 重建 contribution registry；失败时恢复上一份 manifest |
| Knowledge worker / connector worker | 会话边界或 worker 空闲时 | 先取消或排空旧 worker，关闭连接和凭据句柄，再切换版本 |
| Pi extension / skill | 下一次 Pi 会话 | 当前会话保留已加载扩展；新会话使用新版本 |
| Electron main / preload | 应用重启 | 不能在已有 preload 或 IPC 表面上替换字节 |
| 正在执行的科研任务 | 任务完成、取消或明确分叉后 | 不允许升级中途替换执行器、容器或 provenance 依赖 |

## 分阶段门槛

### H1：插件产物与宿主安装边界

- 在 `drone-plugins` 为每个包生成自包含 tarball、manifest、`build-manifest` 和 registry integrity。
- Drone 的安装器只接受 registry tarball 或用户选定的本地 tarball，写入 staging 目录后原子切换到版本目录。
- 安装记录保存包名、版本、来源、integrity、host API 范围和构建时间；不写入凭据、会话正文或结果目录。
- `check:plugin-api` 增加“外部仓库构建产物可被宿主发现”的真实 tarball 门禁。

### H2：能力注册与兼容性

- 从 manifest 生成 capability registry：能力 ID、贡献类型、工具/命令、所需权限、网络/写入副作用、最小 host/API/Pi 版本。
- 不兼容、缺资源、integrity 不匹配或被禁用的插件保持 `disabled`/`incompatible`，不会部分加载。
- 公开 API 仍只从 `@gyoungwe/plugin-api` 和 `window.pi` 暴露；renderer 不直接 import Pi 包。

### H3：分层热插拔管理器

- UI 层提供启用/禁用/重载按钮和状态回执，显示版本、来源、integrity、最后一次失败原因。
- worker 层实现 `prepareUnload → drain → dispose → load → healthCheck` 生命周期；超时则隔离旧实例并回滚。
- Pi 扩展安装后只对新会话生效；会话卡片明确显示“当前会话版本”和“下一会话版本”。
- main/preload 变更只显示“重启应用”，不伪装成已热加载。

### H4：失败恢复与回滚

- 每个插件至少保留当前版本和上一份已验证版本；切换采用临时目录、校验、原子 rename。
- 新版本健康检查失败、工具冲突、worker 初始化失败或 UI contribution 崩溃时自动回滚，并写入无正文错误回执。
- 回滚不改变任务授权、证据 capsule、provenance 或外部连接器的写入状态；进行中的任务进入 `needs-review` 或 `unknown`，不继续猜测。

### H5：可观测性和用户界面

- 在“技能与连接”页增加插件来源、版本、能力、生命周期状态、重载范围和失败原因。
- 事件流记录 `staged / verified / enabled / disabled / drained / reloaded / rolled_back`，与 trace/审阅页关联。
- 健康检查只在真实安装包、真实启动会话或真实 worker 生命周期产生证据时标记 PASS；loader-only、fixture-only 和开发版截图仍不是最终 PASS。

### H6：发布与持续验收

- `drone-plugins` push/PR 必须先 build 再 check；发布前执行 registry tarball、Pi 1.1.0/latest、安装/卸载/冲突负例和 manifest 完整性回归。
- Drone 宿主 CI 在绑定的插件仓库上运行显式 contract/package checks，外部 checkout 不参与宿主 lint。
- Desktop 产物验收覆盖 UI 启停、worker 重载、Pi 下一会话生效和失败回滚；跨平台 release 继续采用无证书构建策略。
- Protocols.io 保持只读，B8 云端协作保持暂缓；本计划不新增安全门或强制签名证书。

## 完成定义

只有 H1–H6 的证据都来自真实安装包、真实宿主会话或真实 worker 生命周期，才关闭“插件热插拔”门槛。实现顺序按 H1 → H2 → H3 → H4 → H5 → H6，每阶段单独记录回执和回滚路径；任何层无法安全重载时，界面必须显示实际生效时机（下一会话或重启应用）。
