# Drone 客户端白色科研风格覆盖矩阵

日期：2026-10-11

本轮把视觉改造放在 renderer 的共享控制组件和全局语义样式层，保持页面原有 store、IPC、事件与副作用边界。页面组件只增加样式作用域类，不改变数据流。

## 覆盖矩阵

| 客户端表面 | 入口组件 | 覆盖方式 | 已覆盖状态 | 未覆盖或保留项 |
|---|---|---|---|---|
| 应用底层 | `globals.css` | 全局 token、字体、滚动条、focus-visible | 浅色/深色、键盘焦点、禁用态基础语义 | 自定义背景图仍按用户设置保留 |
| 共享按钮 | `components/ui/Button.tsx` | `drone-button`、variant/tone/size 语义类 | quiet、primary、danger、hover、active、focus、disabled | 直接写原生 `<button>` 的页面继续使用各自布局类 |
| 共享开关 | `components/ui/Switch.tsx` | `drone-switch` 与 thumb | on/off/mixed、focus、disabled、浅深主题 | 浏览器原生 checkbox 仍保留原生语义 |
| 共享下拉 | `components/ui/Dropdown.tsx` | trigger/menu 语义类 | hover、focus、菜单 surface、滚动 | 页面自定义 picker 仍由所在组件控制定位 |
| 工作台导航 | `WorkbenchNav.tsx`、`shell.css` | rail 既有样式继承全局 token | active、hover、focus、插件回退 | 图标自身颜色由状态语义控制 |
| 会话轨道 | `SessionTabBar.tsx`、`globals.css` | tab pill、拖拽、状态点沿用 token | active、working、attention、done、dragging、reduced-motion | 运行状态动画保留，但 reduced-motion 会降级 |
| 聊天与 Composer | `Composer.tsx`、`ApprovalDock.tsx` | `drone-composer`、表单/按钮共享层 | 输入 hover/focus/disabled、拖放提示、审批卡、发送/停止按钮 | 消息 Markdown/工具卡有独立语义色，不强制改成普通按钮 |
| 项目/空间 | `ProjectPage.tsx`、`SearchBar.tsx`、`ProjectSidebar.tsx`、`SessionPanel.tsx` | `project-page/project-search/project-sidebar/project-sessions` | 页面背景、搜索框、左右栏、输入 focus、项目列表 surface | 删除二次确认的危险色保留为红色提示 |
| 右侧上下文面板 | `ContextPanel.tsx`、`shell.css` | `context-panel--research` | header、tabs、badge、body、footer、状态点、错误卡、focus | Process/Compute 子组件的专用图表颜色保留其含义 |
| Diff/资源阅读器 | `resource-reader.css`、全局 diff selectors | 资源工具条、分段按钮、文件卡、输入、focus | preview/source、分支、文件卡、表格工具、错误/空态 | 增删行红绿颜色用于表达差异，不能改为单一蓝色 |
| SettingsDialog | `SettingsDialog.tsx`、`globals.css` | `settings-dialog-shell/settings-nav-item` | 弹窗遮罩、导航 active/hover/focus、内容 surface、表单字段 | 插件贡献内容继承宿主容器，插件自定义布局仍由插件负责 |
| General/Appearance | SettingsDialog 共享层 | 表单、按钮、开关继承 | theme、language、背景、动画开关、disabled/focus | 背景图预览保留图片本身颜色 |
| Providers/Login | SettingsDialog + Button/表单层 | 共享控件与错误状态 | provider/model 表单、登录弹窗、error、loading、danger | OAuth/browser 外部页面不由 renderer 主题控制 |
| MCP/Extensions/UI Plugins/Skills/Workflow | SettingsDialog + Button/Switch/Dropdown | 共享控件和卡片 surface | enable/disable、install/remove、reload、empty/error/loading | 插件贡献的内部 CSS 只能由插件自身更新 |
| Permissions/Compute | SettingsDialog + `context-panel--research` | 共享按钮、表单、状态卡 | save/reset/probe、host/job status、danger、error、disabled | 远程终端/日志代码字体保留 mono |
| Knowledge Home/Panel/WebDAV | knowledge 专用样式层 | `knowledge-*` tokens 与 wrapper | 白色画布、图谱、同步卡、冲突状态 | Graph 布局性能和 SVG 无障碍由另一轮单独处理 |
| LAN Observer | `LanObserverPanel.tsx` + SettingsDialog 共享层 | Switch、字段、状态卡 | enable/remote control、copy URL、QR、disabled/focus | LAN Web 是独立 bundle，不自动继承 desktop renderer CSS |
| Zotero/Institutional | SettingsDialog 共享层 | Button、输入、状态卡继承 | 登录、清除、测试、安装、secret 字段 focus/error | 外部 Zotero/机构浏览器页面保留站点风格 |
| About/Diagnostics | `AboutPanel.tsx` + SettingsDialog | 内容 surface、按钮、更新状态 | update/download/install、source、导出、saving/saved/failed | 发布网页和外部 release 页面不由客户端主题控制 |

## 仍保留的硬编码颜色

这些颜色是语义色，不属于视觉漂移：

- Diff 新增/删除行的绿/红色，用于区分文本变化；
- 权限等待和冲突的 amber/red，用于提醒用户需要处理；
- 图谱各类别颜色，用于区分文献、方法、数据集、问题等对象；
- 图片/PDF/HTML 预览内容的原始颜色；
- `ImagePreview` 的黑色遮罩，用于保证图片阅读对比度。

以下内容仍是独立覆盖面，不在本轮 desktop renderer 共享层范围内：

- `packages/desktop/src/lan-web/src/styles.css`：LAN Web 独立构建，需要单独做 token 对齐；
- UI 插件自己的 CSS：宿主只提供 surface、slot 和基础控件契约；
- Knowledge Graph 的性能、布局和 SVG 语义：避免与正在进行的图谱工作互相覆盖。

## 验收方式

```bash
npx biome check packages/desktop/src/renderer/src/components/ui \
  packages/desktop/src/renderer/src/components/settings/SettingsDialog.tsx \
  packages/desktop/src/renderer/src/components/projects \
  packages/desktop/src/renderer/src/components/panel/ContextPanel.tsx \
  packages/desktop/src/renderer/src/components/composer/Composer.tsx \
  packages/desktop/src/renderer/src/styles/globals.css
npm run typecheck -w @drone/desktop
npm test -w @drone/desktop -- --run src/renderer/src/components/knowledge/knowledge-graph.test.ts
```

本轮不改变 IPC、store、网络同步、任务执行或权限判定行为。
