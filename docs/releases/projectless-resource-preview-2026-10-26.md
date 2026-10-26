# 2026-10-26 无项目资源预览修复

`PDF_WITHOUT_SELECTED_PROJECT` 已修复，并通过真实安装包验收。修复源码为 `090fbe7f1ca1f33a8259015071067e5d628e6ff8`，机器回执见 [JSON](projectless-resource-preview-2026-10-26.json)。此前有项目 GUI 结果仍作为历史保留；本次单独覆盖无项目路径。

知识笔记调用 `previewFile(target, undefined)` 时，PiApi 的可选参数与 AppContract 元组不一致，主进程在读文件前拒绝调用。只调整 filePreview/resourceOpenExternal 的可选 cwd、confineToCwd schema，接受显式 undefined；不修改文件解析、大小限制、路径 confinement，也不全局裁剪参数。自动构建同步了 pi-core 构建指纹；没有重发或覆盖任何 npm 版本。

回归先复现原参数错误，再穿过真实 preload 客户端、主进程合同绑定与文件读取验证修复。4 个测试文件共 34 项通过，覆盖绝对路径、file URL、项目相对路径、越界拒绝和缺少 confinement 根目录的拒绝。宿主完整检查与插件仓库完整 `npm run check` 通过，日志哈希见 JSON。

从新 DMG 挂载安装后，使用全新 profile、无凭据 agent、合成 Vault 和已公开 UI 0.2.0（61 个安装文件逐一匹配公开 tarball）。界面明确显示“请先选择项目目录”和空项目列表，全程未选择项目。点击知识笔记引用直接显示第 3/15 页，等比渲染；下一页显示 4/15，关闭后笔记保留；越界引用显示明确提示并回到 1/15，返回原笔记正常。23 个测试 Vault 文件哈希前后相同，应用已退出。截图与 AX 仅保存本机，仓库只记录哈希。

DMG SHA256：`229ce073158ef3426f95e225c3637d8a24eed6ddee5ba8e375f66b9cbd34be2d`。app.asar SHA256：`5e49501ae4b7918d9b674ea7ff3b30f4a6e20c1050f4ce674c06b5d9cb9eaacf`。按现有流程生成未签名 macOS arm64 包。

总目标仍为 PARTIAL：Zotero 云端、用户自有认证 MCP、Protocols.io 写入和其他平台桌面仍缺适用配置/设备。本轮复查登记的两台远程桌面仍离线；常用客户端现有 MCP 配置未发现适用的认证科研服务，不使用无关交易或消息服务替代。没有执行账户写入。MinerU/GROBID 与 B8/B8-2 保持暂缓。
