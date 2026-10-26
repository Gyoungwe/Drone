# 非聊天页面的资源预览修复

正式安装包在知识笔记中点击 PDF 链接后，没有出现预览。Markdown 已调用通用 openResourcePreview，但 App 仅在聊天分支挂载 ContextPanel，知识页没有资源读者。

保持知识 UI 的插件所有权；宿主在非聊天主页面旁挂载通用 PageResourcePreview，仅在已有资源目标且面板展开时显示现有 ResourceSidebar。关闭隐藏面板，返回清除目标；聊天页继续由 ContextPanel 展示，避免双预览。不新增 IPC、权限、插件合同或产品文案。

验收覆盖知识页带页码目标、关闭/重新打开/返回、聊天不重复展示，以及重新构建的真实 macOS 安装包 PDF 第 3 页、翻页和越界页码提示。源码/组件检查不能替代最终安装包 GUI 验收。

正式包截图又发现窄栏 PDF 失真：CSS max-width 压缩宽度，PdfViewer 的固定 inline height 未随之缩放。高度改为 auto，保留 Canvas 像素尺寸和 viewport 宽度，以固有比例缩放；最终真实包截图验证。

发布后空项目验收补充：Markdown 在没有当前项目时传入 `cwd: undefined`，ResourceSidebar 将它作为第二个实参传给预览和外部打开接口。PiApi 已将 cwd/confineToCwd 声明为可选，但 AppContract 的元组只允许省略参数，不接受显式 undefined。修正这两个现有方法的可选参数 schema，使既有绝对路径预览在空项目下可用；不全局裁剪 IPC 参数，不改变路径解析、文件大小限制或项目 confinement。回归穿过真实 preload 客户端、主进程合同校验和文件读取，覆盖绝对路径、file URL、项目相对路径、越界拒绝及缺少 confinement 根目录的拒绝。最终仍以重新打包后的空项目 GUI 第 3 页回执为准。
