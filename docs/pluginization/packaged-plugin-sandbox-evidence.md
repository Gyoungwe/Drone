# 正式安装包第三方工具扩展沙箱验收

日期：2026-10-24。结果：**PASS（macOS arm64、工具扩展切片）**。
源码提交 `d807be8a071b4ac1d870793d372f5e3c660d34bd`；插件仓库
`ff1d65998716df4831540957857a945bed3626a7` 未改动。
机器可读产物摘要、真实回执摘要、日志和截图路径见
[验收 JSON](../releases/packaged-plugin-sandbox-acceptance-2026-10-24.json)。

## 修复

Electron 43.3.0 内置 Node 24.18.1 不具备网络权限控制。安装包现在携带官方
Node 26.12.1，构建时按提交的归档 SHA256 校验，运行前检查二进制摘要和网络权限能力。
worker、LICENSE 和 TypeBox 1.3.7 schema peer 位于 `Resources/plugin-runtime`。
Pi 1.1.0 补丁在两个 trust pass 导入前拦截扩展；宿主自带入口仍受明确白名单管理，
第三方源码不会先在 Electron 主进程执行。npm/bun/pnpm 安装与卸载禁用 lifecycle scripts。

第三方 TS 入口通过 esbuild 编译到隔离临时目录，包依赖仍从原始安装位置读取。
esbuild 从物理 `app.asar.unpacked` 启动；macOS 临时目录统一 realpath。
发现工具时禁网，首次调用在 GUI 中明确申请本会话全网访问；拒绝返回错误，允许才启动调用进程。
并发首次调用共用一次许可与一次启动，关闭会话回收 worker。工作台现在显示真实已加载工具及错误，
并修复市场首次进入时漏刷已安装包的问题。

## 最终产物与操作记录

从最终 DMG 挂载并复制安装至 `/tmp/drone-sandbox-accepted/Drone.app`，随后卸载挂载卷。
DMG：`/tmp/drone-sandbox-delivery/drone-mac-arm64.dmg`，SHA256：
`7e2d3cd8e9cdfb20361926e11fafed452b78e53e0ab90b7af828ae8395c6ace0`。
这是本地未签名、未公证构建；产物验收阶段未上传 release、发 npm 或合入 main；后续合并见下方。

独立扩展为 [vaayne/agent-kit](https://github.com/vaayne/agent-kit) 的
`@vaayne/pi-web-tools@0.1.1`（MIT）。锁定 registry tarball/integrity，使用未修改的原始 `index.ts`。
该包未进入当前市场索引，因此使用最终安装包内 Pi CLI 安装，启停使用 Pi 原生包过滤配置，
并在 GUI 检查结果；不将这些操作描述为市场点击安装或 GUI 一键启停。

| 步骤 | 实际回读 |
| --- | --- |
| 干净启动 | 最终安装包工作台、CJS preload、研究命令发现通过；空认证/模型存储，无继承 Vault |
| 干净安装 | 包内 `cli.js install npm:@vaayne/pi-web-tools@0.1.1` 成功；隔离 HOME/agent，独立最终复验新增 49 个包 |
| GUI 加载 | 已安装列表显示 user 包；已加载列表显示 `pi-web-tools`、原始 TS 路径与 2 工具 |
| 拒绝网络 | 13:15:01Z 实际 `web-fetch` toolResult 为 `isError:true` / `Plugin network permission denied` |
| 允许并调用 | 13:15:25Z 实际 toolResult 成功；worker PID 32329，父进程 32077 |
| 停用 | 将包配置改为 `{source, extensions:[]}` 后重启；包仍安装，加载列表和工具均移除，旧 PID 已退出 |
| 恢复 | 恢复包源字符串并重启；GUI 再现 2 工具；恢复任务后再次出现联网许可 |
| 恢复后调用 | 13:23:50Z 实际 toolResult 成功；新 worker PID 33185，父进程 32923，执行文件为安装包内 Node |
| 清理 | 退出验收 app，确认新 worker 已退出；隔离包留在停用状态；正式库和凭据未改动 |

两次成功均读取真实 Europe PMC 公共 HTTP API，返回 PMID `24906146` 与标题
“Development and applications of CRISPR-Cas9 for genome engineering.”。
GUI 使用本地脚本模型驱动，工具 dispatch、安装包会话、独立进程及外部 HTTP 响应是真实的；
不宣称真实付费模型推理或完整科研任务完成。仅复制公开标识、成功/失败字段与摘要到证据，
会话正文、Vault、截图原件与完整日志不入 Git。一次恢复提示未激活 external 能力，工具未暴露；
使用明确 external plugin 请求后正常激活并完成调用，未更改产品路由来绕过门禁。

## 检查

宿主 `lint`、`typecheck`、`test`、`build`、`check:arch` 全部通过；架构基线 0、空可选包宿主独立性通过。
最终检查使用已准备且固定的资源，typecheck/test/build 带 `--ignore-scripts` 避免重复准备；
完整检查、构建和打包依次运行。lint 保留已有超大 HTML 警告。
backend 234 文件通过/3 跳过、1915 测试通过/17 跳过；desktop 161 文件通过。
`check:plugin-api -- --migration --lifecycle`、12 个扩展映射、插件仓库 `npm run check` 通过。
Node 26 两个沙箱测试文件 11/11；Node 22 为 8 通过/3 正例跳过。
新测试覆盖两个 trust pass 导入前拒绝、TS 代理、并发一次授权、可达 HTTP 禁网、worker 关闭和篡改 runtime 拒绝。
Pi 补丁对全新 registry SDK tarball 的 dry-run 应用通过；最终 DMG 安装后的干净启动、CLI 安装和 GUI 验收通过。

## 保留边界

- Node permission model 是防止意外越权的 seatbelt，**不保证隔离恶意代码**，不是 OS 沙箱。
- 本轮代理仅支持工具。事件钩子、命令、provider、renderer、MCP 注册等不支持的 API 明确失败；依赖安装脚本的包不保证可用。文件访问包含扩展、依赖树和临时目录；网络授权为全网，不能伪称域名白名单。
- 原生包 GUI 一键启停、其他 OS/架构实机、同包跨版本升级/回滚未由本轮覆盖；此前独立 `pi-web-access` 的原生 Pi 升级/回滚证据保留其原范围。
- 此沙箱验收当时未覆盖完整迁移后研究工作流 GUI；后续本地两源闭环已由[研究 GUI 证据](research-workflow-gui-evidence.md)覆盖，并单列概览分类缺口。用户自有认证 MCP、Zotero 云端、Protocols.io 写入和新研究包 npm 发布待办不变。MinerU/GROBID 集成和 B8 仍暂缓。
- 旧 Node 22 bad-port 假阳性继续作废；旧 Electron Node 24 拒绝回执保留。并行资源准备导致的中间 ASAR 损坏产物已废弃，最终顺序构建安装验收才计 PASS。

## 2026-10-24 合入 main 后复验

`codex/packaged-plugin-sandbox` 从 `53b10195` 快进合入 Drone `main=84244eb6`，
包含源码 `d807be8a` 和原始验收文档 `84244eb6`；插件 `main=ff1d659` 保持不变。
合并后重新 fetch 两个远端，在干净工作区且不设 `DRONE_PLUGINS_DIR` 的情况下依次完成：

- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch`：PASS。
- `check:plugin-api -- --migration --lifecycle`、`check:extensions`、`test:upgrade`：PASS。
- 已暂存 worker 摘要检查、Node 26 两个沙箱测试文件、插件仓库 `npm run check`：PASS。

完整命令、时间和日志摘要位于验收 JSON 的 `mainIntegration`。
本次 fast-forward 未改变已验收源码；保留原 DMG/GUI 真实回执，本轮未重新打包或重做 GUI，
不能把本次源码门禁写成新增实机验收。上方全部未完成项与暂缓项原样保留。
