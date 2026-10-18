# 下一轮迭代 · 交接给 GPT（2026-10-19）

> 来源：Claude 对 v0.33.1 的验收和迭代评审。按顺序做，每一项开一个 PR；完成标准沿用 `pluginization-ui-handoff.md` §2。**不要做本文以外的事。**

## 0. 规则（先写进 `AGENTS.md`）
- 计划里标为「暂缓」或「按用户要求暂不实施」的条目（目前是 B8）**不允许动**，也不允许写任何"基础"代码。原因：上次 B8-1 写了 867 行，最后被 revert。
- 执行日志超过 30 行，就把旧记录移到 `docs/archive/<计划名>-log-<日期>.md`，正文只保留最近 30 行和一个归档链接。`final-pluginization-plan.md` 和 `architecture-v2-tasks.md` 现在就要归档一次。
- 声明 PASS 的证据必须来自**真实启动的会话或安装包**；只用 loader 单独加载的结果、fixture 或开发版截图，都不能作为最终 PASS。

## 1. 修复知识库 worker 接线（优先级最高）
- 现象：10-19 在 Electron 开发版上做交互验收，知识库页的审阅和网络图报错，原因是 `configureKnowledgeWorker` 没有注入，当时记为 BLOCKED。
- 要做：
  1. 在开发版和打包版的宿主上都注入同一个 `knowledge-worker.mjs` 接口；
  2. **确认 v0.33.1 正式安装包是否也有这个问题**：解开安装包，用 CDP 打开知识库页，看是否报错。
- 验收：开发版和打包版的知识库页，审阅和网络图都能加载；加一条回归测试，在 worker 未注入时会失败。
- 如果正式包也受影响，修复后发 v0.33.2。

## 2. 三个小问题
1. `/drone-example <knowledge|research|analysis|evidence>`：根据参数返回不同的示例。没有绑定 Vault、缺数据或缺容器时，返回 `unconfigured`、`needs-data`、`needs-container`，**不能返回 `ready`**。
2. `/drone-doctor`：读取已安装的 `@earendil-works/pi-coding-agent/package.json`，填入 `host.version`；版本不在 `piRange` 内时，`status` 设为 `incompatible`。
3. `SkillsConnectionsView.tsx:37`：MCP 的 `failed` 状态不要映射成 `stale`（来源过期）。新增一个状态 `error`，显示为"不可用"，用红色徽标，按钮为「查看原因」，同时更新计划 §3.10 的状态表。
- 改完后，`research-suite` 要随依赖包一起发补丁版本，并用 CI 里的真实 Pi 回归测试验证。

## 3. 主线指标「本地回答率」
- 从 trace 中统计：一个问题如果只用了本地知识就完成了回答（没有联网工具调用），就计为本地回答。
- 在知识库页「健康检查」显示「同类问题由本地回答 X / Y（本周）」；没有数据时继续显示"—"。
- 新增 `fixtures/mainline-questions.json`，放 20 个固定问题，每个问题都要问两轮。新增 `npm run eval:mainline`，输出本地命中率、联网次数、引用可解析率和耗时，结果写进 `docs/evals/mainline-<日期>.json`。
- CI 只跑离线的 faux provider 版本；真实模型版本留到下一轮的实机验证再跑。

## 4. 不做
- B8 / B8-2 云端协作，以及 `knowledge-cloud-research-upgrade.md` 里的迁移阶段。
- 新增任何安全门、确认流程或抽象层。

## 5. 完成后交给用户
- 每个 PR 的链接；第 1 项要说明正式包是否受影响；第 3 项要附上第一次 `eval:mainline` 的结果。
- 然后由 Claude 在用户的 Mac 上做实机验证，方案是：安装正式包 → 同一问题问两次 → 打开知识库页的审阅和网络图 → 关闭 MCP 后重试 → 用原生 Pi 跑完整闭环 → 截图并与设计稿对照。需要用户准备一个测试 Vault 和模型 API。
