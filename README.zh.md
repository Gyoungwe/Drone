<p align="center">
  <img src="docs/icon.svg" alt="Drone logo" width="128">
</p>
<h1 align="center">Drone</h1>
<p align="center">
  桌面端的自主研究工作台。一次确认任务的范围、写入目录与验收标准，Drone 就执行到交付，而不是每一步都来打断你。基于 <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent">Pi coding agent</a> 构建，与 Pi CLI 同源同引擎。
</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Gyoungwe/Drone?style=flat-square" alt="License"></a>
  <a href="https://github.com/Gyoungwe/Drone/releases"><img src="https://img.shields.io/github/v/release/Gyoungwe/Drone?style=flat-square" alt="Release"></a>
  <a href="https://github.com/Gyoungwe/Drone/releases"><img src="https://img.shields.io/github/downloads/Gyoungwe/Drone/total?style=flat-square" alt="Downloads"></a>
  <a href="https://github.com/Gyoungwe/Drone/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Gyoungwe/Drone/ci.yml?style=flat-square" alt="CI"></a>
  <a href="https://github.com/Gyoungwe/Drone"><img src="https://img.shields.io/github/stars/Gyoungwe/Drone?style=flat-square" alt="Stars"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=nodedotjs&style=flat-square" alt="Node >=22.19">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="macOS | Windows | Linux">
</p>
<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

---

## 演示

![drone 欢迎页与鲸鱼娘桌宠](docs/assets/img/drone_pet.png)

![设置 —— UI 插件管理，内置鲸鱼娘桌宠](docs/assets/img/drone_ui_plugins.png)

**聊天页**

![聊天页演示](docs/assets/img/demo-chat.gif)

**自定义背景 + 深色主题**

![深色主题下带自定义背景的聊天页](docs/assets/img/chat_img_bg_show_img.png)

**设置页 —— 模型与 Provider**

![设置页演示](docs/assets/img/demo-settings.gif)

## 为什么选择 Drone？

大多数 agent 图形界面会为每一次写入、每一条命令、每一个阶段向你确认。Drone 只问**一次**。

任务从有限的只读调研开始，然后给出一张授权卡：目标、大白话的范围说明、确切的写入目录、不可变的验收标准。点一次 **确认一次，执行到交付**，即批准验收合同与执行预算，任务一路跑到交付。

- **一个任务一次授权** —— 同意被绑定到任务 id、目标、范围、目录清单与验收里程碑的不可变合同哈希上。合同一改，授权即失效；它不会迁移到另一个任务、会话或分支。
- **是范围授权，不是无限授权** —— 自动放行仅限你在卡片上看到的规范化目录。显式 deny 规则、凭据、权限/信任/模型配置、私钥、版本库内部文件、符号链接逃逸与硬链接目标，一律保留原有门控。这不是 fullAccess 开关。
- **进度可审计** —— 阶段只凭可观测进度推进：宿主放行的、互不相同的调用的成功结果。状态刷屏与失败检查不算数。恢复轮次上限 3 次，且在固定的 192 次调用上限之内。
- **结构化任务工作台** —— 模型提出带依赖的里程碑，验收只认宿主文件回读、范围内人工复核或只读 Zotero 身份。持久化账本重启后恢复，且不会重放未知副作用。

完整边界见 [docs/task-authorization.md](docs/task-authorization.md)。

## 基于 Pi 构建

Drone 把官方 Pi SDK（`@earendil-works/pi-coding-agent`）跑在 Electron 主进程里。**不是 fork，也不是重新实现** —— 它和 Pi CLI 用的是同一套引擎，完整继承 Pi 的原生优势：

- **可扩展性** —— 为 Pi CLI 安装的 TypeScript 扩展、Skills、Prompt 模板在这里同样生效，包括项目级资源（加载前会有信任确认）。让 Pi 适应你的工作流，无需 fork。
- **配置共享** —— 与 CLI 共用 `~/.pi/agent/` 目录：会话、认证、模型配置全部互通。终端里开的会话，可以在 GUI 里继续。
- **模型来源** —— 支持订阅（Claude Pro/Max、ChatGPT Plus/Pro Codex、GitHub Copilot，应用内 OAuth 登录）以及 Anthropic、OpenAI、Gemini、DeepSeek、Bedrock 等 API key；还支持自定义 provider 与 base URL 覆写（中转站场景）。

同时，为更喜欢图形界面的用户提供：

- 高度自定义界面 —— UI 插件可替换工具调用卡、添加桌宠浮层（内置鲸鱼娘 + Q 版两只）、扩展设置面板
- 可视化权限审批 —— 在底部审批坞里逐个批准/拒绝工具调用，背后是逐工具的规则引擎
- 多会话顶栏标签（可拖拽排序，可选左侧会话轨道）、逐会话输入草稿、可撤销的跟进消息队列
- 内置子代理 —— 自带 scout 与自定义 agent 定义、并行任务拆分，点开运行卡片即可只读检视子会话。自然语言如「侦察一下代码库」/ “scout the repo” 会启动 Scout；输入框状态显示「子代理 x1」，完成后显示「Scout 已完成」
- 上下文蒸发（默认开启）—— 到龄的工具输出自动蒸发为紧凑 stub，长会话不超预算
- 视觉代理 —— 纯文本模型遇到图片时，由视觉模型先识别成描述再交给 LLM
- 统一报错系统 —— 对话内错误卡一键重试、自动重试状态行、全屏崩坏兜底
- 扎实的会话工作台 —— 任意消息分叉、撤回自己的消息回输入框、todo 面板、逐轮 diff 侧栏、斜杠命令面板、@ 文件补全
- 流式 Markdown 渲染、图片预览、消息复制
- Agent 主动发图 —— 内置 `show_image` 工具让 agent 在需要时把图片（单张或成组）直接显示到对话区，而不是把所有工具结果都变成噪音
- 自定义背景图与遮罩透明度，浅色/深色/跟随系统主题
- 局域网观察 —— 手机/平板浏览器扫二维码即可只读查看会话进度

## 下载

预编译安装包发布在 [Releases](https://github.com/Gyoungwe/Drone/releases) 页面。

| 平台 | 下载 |
| --- | --- |
| macOS (Apple Silicon) | `drone-mac-arm64.dmg` |
| macOS (Intel) | `drone-mac-x64.dmg` |
| Windows | `drone-windows-x64.exe`（安装器）或 `drone-windows-x64.zip` |
| Linux (x64) | `drone-linux-x64.AppImage` 或 `drone-linux-x64.deb` |

> Linux 包未签名。AppImage 需先 `chmod +x drone-linux-x64.AppImage` 再运行。
>
> AppImage 需要 FUSE 2（`libfuse2`）。若运行报 FUSE 错误，可安装 fuse2（Debian/Ubuntu：`sudo apt install libfuse2`），或不用 FUSE：`APPIMAGE_EXTRACT_AND_RUN=1 ./drone-linux-x64.AppImage`。
>
> `.deb` 安装包需要 `libsecret-1-0` 来存凭证（`sudo apt install libsecret-1-0`）。
>
> 构建为 adhoc 临时签名（无 Developer ID 证书）。macOS 下载后首次打开可能提示**「Apple 无法验证 Drone 是否包含危害 Mac 安全或泄漏隐私的恶意软件」**—— 这是 Gatekeeper 拦截未公证的 App。按以下方式放行：
>
> 1. **系统设置 → 隐私与安全性** → 滚动到底部 → 在 Drone 条目旁点**「仍要打开」**，然后输入密码或 Touch ID 确认（推荐）。
>
>    ![macOS「仍要打开」](docs/assets/img/drone_mac_permission.png)
>
> 2. 或在终端执行：`xattr -cr "/Applications/Drone.app"`。
>
> 更新在应用内检查。Windows 上也在应用内下载安装（点下载，再点重启）；macOS 上 adhoc 签名的构建无法自动安装，点击会跳到 Releases 页 —— 新下载的版本首次打开还会再被 Gatekeeper 拦一次。Windows 上 SmartScreen 提示时点「更多信息」→「仍要运行」。

## 配置

API key 不会存入本仓库，也不会打进安装包。`~/.pi/agent/models.json` 通过环境变量引用（如 `$AI_OPS_API_KEY`），key 只存在于你的 shell 环境中。如果你已经在用 Pi CLI，现有配置开箱即用。

内置 DeepSeek 模型在目录里显示为 **V4 Flash** 这类名称，而不是 API id `deepseek-chat`。模型选择器为空时，打开「设置 → 模型」配置 Provider。

## 开发

前置要求：**Node.js >= 22.19**。

```bash
npm install
npm run dev
```

npm workspaces monorepo，三个包：`packages/shared`（IPC 契约）、`packages/backend`（唯一 import Pi SDK 的地方）、`packages/desktop`（Electron + React 19 + Tailwind 4 + Zustand）。常用命令：`npm run typecheck` / `test` / `lint` / `build` / `dist`。

完整指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。国内下载 Electron 二进制太慢的话，先设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 声明

drone 是社区项目，**并非** Pi 团队（earendil-works）官方出品，也与其无任何隶属关系。

## License

[MIT](LICENSE)
