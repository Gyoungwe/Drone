# 应用级插件后台：正式 macOS 安装包验收

2026-10-26，宿主源码 `561a370cf35ff18e229416829f3be59b0d09b604`。本次替代 [P1 窗口作用域切片](native-plugin-p1-packaged-evidence.md)中的作用域基线；旧证据不修改。结论仅覆盖通用后台/UI 与真实会话身份，**不表示知识原生工具已与 UI 共用领域 owner，也不表示零领域插件宿主完成**。

## 安装与隔离

| 实际产物 | SHA-256 |
| --- | --- |
| `packages/desktop/dist/native-plugin-app-owner/drone-mac-arm64.dmg` | `f1379a4f314a0455504be7371f21c4499214a1f13363d3cc753fac63a701c809` |
| 从 DMG 复制安装的 `Drone.app/Contents/Resources/app.asar` | `e1c4e0502ee1640ee78ee2d6881d4b6820952df1d406f7ea0ff960632bfe9c0f` |
| npm 安装的本地 `example-drone-runtime-receipt-0.0.0-acceptance.2.tgz` | `556b1e1c932b52fa9c48558a4630d6fad39412d1f78e2e2d8ead9c80f2b58adb` |

实际应用版本 0.33.4 / macOS arm64，独立 Node 26.12.1。DMG 由 electron-builder 构建，`CSC_IDENTITY_AUTO_DISCOVERY=false`、`--publish never`，未签名、未公证、未发布。只读挂载后复制应用并卸载挂载点，运行复制出的应用二进制。

使用独立 profile、agent、知识目录和本轮空测试项目。模型在该独立 agent 的 `models.json` 中配置，只有 loopback HTTP 服务及明确的假测试 key，没有复制用户模型凭据。两个真实 Pi 会话通过 GUI 发送合成文本，本地模型分别返回 `Offline scope acceptance complete.`。服务只记录路径、模型 ID、时间、消息数，不保存请求正文；共四次请求，包含两个会话请求与标题生成。未绑定正式 Vault或调用外部账户。结束后本地模型服务已停止。

探针是自建普通 Pi 包，加可选桌面工厂与 UI，不是来自真实第三方的科研扩展。UI 通过公开 hook 调用 `receipt`，主进程签发 selection lease，后台返回 PID、applicationId、generation 和执行上下文；不是在开发页面内伪造显示。包声明无用户文件、网络或写入权限，工厂只得到 applicationId，session/workspace 来自每次操作的宿主上下文。

## 实际 GUI 回执

| 操作 | 结果 | 回读 |
| --- | --- | --- |
| 启用插件 | PASS | 系统原生权限提示先于后台导入；允许后出现 Runtime receipt 面板 |
| 未开会话读取 | PASS | `scope.kind=application`，没有伪造 workspace/session |
| 创建会话 A 并读取 | PASS | GUI 收到本地模型回复；scope 为真实 session A 与规范项目 ID |
| 新任务首页读取 | PASS | 回到 application scope，不继承会话 A 的身份 |
| 创建会话 B 并读取 | PASS | GUI 收到本地模型回复；scope 切为不同的真实 session B |
| B→A 切回并读取 | PASS | scope 恢复 A 的真实 ID；不是 B 的上下文 |
| 以上全过程 | PASS | 后台 PID `66367`、applicationId 和 generation 始终相同，未因选择会话启动第二个 owner |
| 停用 | PASS | UI 开关关闭；2026-10-26T07:27:01Z 系统回读确认 PID `66367` 已不存在 |
| 拒绝恢复授权 | PASS | 管理界面显示 `加载失败` 与 `Plugin runtime activation denied`，无成功回执 |
| 再启用并允许 | PASS | 错误清除；回到 A 后返回新 PID `68912`、新 generation，applicationId 不变且 scope 仍正确为 A |
| 正常退出应用 | PASS | 2026-10-26T07:31:28Z 回读确认应用 PID `65918` 与两个后台 PID 均不存在；两个真实会话也经过宿主关闭流程 |

本轮 applicationId 为 `e9c9b9b8-316a-48ff-8af2-182dd5038b92`。初始 generation 为 `5b69fafe-4478-4600-b757-c3cb69fec710`，恢复后为 `3162bba2-70a4-44e1-95a1-c8dfe2db22b7`。会话 A 为 `01a17714-f393-748c-b2a4-ccc3c5b5f51e`，B 为 `01a17717-c4b9-748c-b2a4-ccc505f150a7`；均为本轮隔离的合成会话，不含用户会话数据。

## 检查与独立复核

宿主完整 `lint`、`typecheck`、`test`、`build`、`check:arch` 全部退出 0。backend 主测试 241 文件通过、3 文件跳过，1948 测试通过、17 跳过；desktop 161 文件、849 测试通过。既有 lint 大文件警告保留，跳过项不计作通过。

新实现另外通过真实 SDK caller identity、真实受限 worker 双调用者、IPC/preload 和 renderer selection 回归。独立复核促成三项修复：首次授权窗口关闭时取消未完成 activation；A→B→A 的旧 selection lease 不复活；等待旧 owner dispose 后重新核验请求代次与来源。这些竞态及多窗口共享由回归验证，**本轮 GUI 没有同时打开多个窗口，也没有人工重演迟到授权竞态**。

`DRONE_PLUGINS_DIR=/tmp/drone-plugin-npm-release npm run check:plugin-api -- --migration --lifecycle` 通过，记录插件 HEAD `32cd3a3`、API 1.3.0 本地候选；这是合成版本的 pack 生命周期，不是 npm 发布。插件该检查点全仓 `npm run check` 通过，knowledge 60 文件、411 测试；之后的原生 owner 注入仍在进行，不能继承本基线的最终完成状态。

| 日志 | SHA-256 |
| --- | --- |
| `/tmp/drone-app-owner-lint.log` | `e3ac354e1c33f25c2df6e1bd5767a840c22f6bc70d8c2aab6b0474cb125fd11f` |
| `/tmp/drone-app-owner-typecheck.log` | `b51b60bb3f01027c682a00f9e0c2ae78c2dfc06d575a073a7ed9d8cb08f0aa90` |
| `/tmp/drone-app-owner-test.log` | `7b47d5dfd3ee0f5e37e8c781bfd73de011117232bc70f194a4a025cec4a7034c` |
| `/tmp/drone-app-owner-build.log` | `2d22384227f0d08eb73c1a33346900bcba90b76999f856cf23246cc660f9d4cd` |
| `/tmp/drone-app-owner-arch.log` | `8f98cf2416aa10c9d14e6ec86b5b49f260c8550b4562c7b19832f42a7a006e54` |
| `/tmp/drone-app-owner-api.log` | `cdc89932a1fc7498095224a3dcfd0b2acefd21938d9ea552b7bc094f296870dc` |
| `/tmp/drone-app-owner-package.log` | `3513190bd793172beb530a1b2eb6336a5748f7bd8929456c3ed2bbccfcaa6afe` |

## 原始证据与剩余范围

本机 `.local/acceptance/native-plugin-app-owner-gui-2026-10-26/` 保存 artifact/launch、安装日志、AX 回执、截图和进程检查；不提交。`evidence-hashes.json` SHA-256 为 `2236bf7c3c8d032e24754698464e7305cf791d5a2c25413c7437c59be7eee877`。其中 `02`–`06` 记录 application/A/application/B/A，`07` 记录停用退出，`08` 记录拒绝错误，`09` 记录恢复，`10` 记录退出检查。

应用启动真实会话仍出现旧 `drone:runtime/v1` 的 MaxListeners 警告；本轮没有靠提高监听上限掩盖它。旧领域桥、宿主必需领域依赖与新增边界门禁 110 项耦合继续由 P2–P6 迁移处理。新后台尚无 Vault/状态文件/worker/模型 broker，也没有接入同一知识 native/UI owner。latest 自动发现导入前隔离、全官方 API、完整安装升级/数据回滚、零领域宿主仍未完成。既有四项外部验收及暂缓项目保持原状态；本次无 npm 发布或远程推送。
