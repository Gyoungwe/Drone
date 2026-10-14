# v0.32.0 P5 UI / LAN 只读证据矩阵

**对应计划**：Drone Scientific Workbench Upgrade Plan v2：Evidence-Gated Evolution Architecture  
**批次**：P5 · UI/远程只读收口  
**基线**：`61daeb62c63b560efa6a428cd7f801b43675c49c`（P4 合并后的 `main`）  
**范围**：只验证已经合入的 UI 行为、长列表边界、窄屏布局和 LAN 只读边界。不新增 IPC，不改变执行、权限、任务路由或科研结果语义。

## 证据等级

| 等级 | 含义 | 本批次如何使用 |
| --- | --- | --- |
| A | 当前源代码中的可定位契约或单元测试 | 作为合并前门禁，可在任意干净 checkout 重跑 |
| B | 受控 UI parity harness 的截图或 DOM 结果 | 需要本机浏览器/发布环境，不能由本地静态检查代替 |
| C | 真实目标主机、真实局域网或真实科研数据上的观察 | 本批次不声称已完成 |

## 面向 UI 表面的矩阵

| 表面 / 风险 | 375 px 窄屏 | 768 px | 1024 px | 1440 px | 当前证据 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置弹窗：超出视口、导航不可达、Esc/焦点丢失 | A：`max-h-[calc(100dvh-24px)]`、`@media max-width:720/480`；A：Tab/Shift+Tab/Escape/恢复焦点 | A | A | A | `SettingsDialog.tsx` 源码契约；桌面 workspace 测试；`check:ui-evidence` | 行为门禁通过；B 档截图待发布环境采集 |
| ContextPanel / 知识面板：窄列挤压、焦点和长标题 | A：`min-width:0`、滚动面板和 focus-visible 规则 | A | A | A | `shell.css`、`globals.css`；图谱无障碍/布局测试 | 结构边界通过；B 档截图待采集 |
| 知识图谱：1000–10000 节点布局退化 | A：确定性 bounded layout、画布内坐标、标签截断 | A | A | A | `knowledge-graph.test.ts`（1000/2000/5000/10000） | 长列表/大图算法门禁通过；不代表真实知识库性能已测完 |
| 子智能体运行列表：首屏过长、翻页后聚焦丢失 | A：每页 100 条、筛选回第一页、聚焦运行自动跳页 | A | A | A | `subagents-pane.test.tsx`（空/单条/1000）；`data-testid=subagents-pagination` | 列表边界通过；B 档滚动体验待采集 |
| LAN ChatView：观察模式出现输入或审批副作用 | A：`remoteControl=false` 不渲染 textarea/发送/审批；开启后才恢复 | A | A | A | `ChatView.readonly.test.tsx` 2/2；`PermissionCard`、`Composer` 源码 | 只读边界通过；真实设备访问属于 C 档，未声称完成 |
| LAN Run Inspector：远程观察需要写权限 | A：`details.lan-run-inspector` 只展示 run/timing/usage/artifact 投影 | A | A | A | `RunInspector.tsx`、`lan/styles.css` | 只读观察器通过；未新增远程 IPC |
| 动画 / 状态播报：系统减动效设置失效 | A：desktop/LAN 均有 `prefers-reduced-motion: reduce` 规则；状态条单一 live region | A | A | A | `globals.css`、`lan/styles.css`、现有桌面测试 | 结构门禁通过；B 档需在浏览器开启减动效复核 |

这里的“375/768/1024/1440”是验收视口集合，不是声称已经生成四档截图。当前 checkout 能证明 A 档契约；要关闭 B 档，需在具备 Electron/Chromium 的发布环境运行 parity harness，并保存截图哈希、浏览器版本、主题和场景清单。

## 长列表和窄屏走查顺序

1. 在 375 px 打开设置弹窗，依次用 Tab、Shift+Tab、Escape，确认焦点不离开 dialog，关闭后回到打开按钮。
2. 在 768 px 切换 ContextPanel 页签，并打开知识图谱节点抽屉；确认内容区可以独立滚动，右侧抽屉不超出视口。
3. 在 1024 px 注入 1000 条子智能体运行记录，切换下一页、筛选 active、聚焦指定 run；确认列表每页最多 100 条且焦点记录可见。
4. 在 1440 px 打开 LAN 观察页，保持 `remoteControl=false`；确认只显示 transcript、状态和 Run Inspector，不出现输入框、发送按钮或审批动作。
5. 对浅色、深色和 `prefers-reduced-motion` 各重复一次。若截图与 A 档契约不一致，先修实现再更新本矩阵。

## 可重跑检查

```bash
npm run check:ui-evidence
npm test -w @drone/desktop -- --run \
  src/lan-web/src/components/ChatView.readonly.test.tsx \
  src/renderer/src/components/knowledge/knowledge-graph.test.ts \
  src/renderer/src/components/panel/subagents-pane.test.tsx
```

发布环境的 B 档截图可使用现有 `scripts/ui-parity/shoot.mjs` 和 `scripts/ui-parity/gallery.mjs`。它们默认 1440×900；375/768/1024 需要在浏览器驱动层覆盖 viewport 后再运行，生成物放在被忽略的输出目录，不提交截图或本机私有状态。

## 与科研执行边界的关系

- 本批次没有新增或修改 IPC、preload、backend、compute、权限判定和工作流执行代码。
- LAN 的 `remoteControl` 是显式设置；关闭时 UI 和服务端均保持只读。开启远程控制不等于本批次已完成真实主机或真实数据执行。
- UI 的完成度、截图或状态卡不能升级 `scientificallyVerified`、QC、review 或 publication 状态；这些仍由证据门禁和授权主机结果决定。
- P4 的 RNA-seq smoke 受控夹具证据与本批次 UI 证据分开记录，不能互相替代。

