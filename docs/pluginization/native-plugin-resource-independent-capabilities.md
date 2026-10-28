# 无资源子进程插件的文件能力与调用者作用域

2026-10-28 候选切片。实现属于通用宿主机制；不是 discovery 全功能或正式安装包验收。

## 文件能力从权限声明派生

已安装包扫描器从真实 `plugin.manifest.json.permissions.filesystem` 派生 state/files 读取请求。`application-state-write` 包含 state read；`workspace-write`、`configured-vault-write` 包含 files read。只读 token 是 `application-state`、`workspace`、`workspace-read`、`configured-vault`、`vault-read`。未知 token 不授予目录。

每次启用只弹出实际声明的目录选择器，使用新的不透明 root handle。状态写入仍须独立声明、独立写选择器、JsonStore CAS 和每次写入批准；数据根不会隐含授予状态目录，反之亦然。`entrypoints.resources` 既不授予文件权限，也不是得到文件能力的前提。

没有 resource 声明时不创建 `PluginResourceManager`，不返回 resource lifecycle，不启动派生子进程。文件快照端口仍使用 host profile 内的私有缓存。零文件请求且零资源的插件不弹目录选择器，也不创建缓存。清单权限变化使旧绑定失效，必须重新启用获取新授权。

## caller.scope

所有 runtime owner 可在有效调用内执行 `capabilities.call("caller.scope", null)`，获得宿主解析的现有 `PluginRuntimeScope`。它包含 application/workspace/session 三种形态；workspaceId 是规范身份，workspaceDirectory 是真实会话目录，不能用 cwd 字符串代替身份键，也不能把该目录当作文件访问授权。

此只读能力是 broker 固有端口，不能被包的 handler 覆盖。普通调用仍经过调用者身份、会话代次、撤销信号和 read policy；owner 构造期间只返回 application scope。输入不能携带伪造 workspace/session，保留闭包不能获得后台调用权。返回 JSON 不包含凭据或会话内容。

## 验证范围

- Desktop 目录授权、已安装包来源扫描和清单变化撤销的 85 个测试通过，包括 resource 缺失的真实 JSON 写入→回读、写入拒绝后目录无变更及 state/files 独立选择。
- Broker 单元回归验证当前 scope、更换真实 caller、伪造输入拒绝和闭包调用拒绝。
- 真实 Pi SDK + managed process 回归使用固有 caller.scope，覆盖双会话 native/UI 同 owner、真实规范 workspace ID，以及三种关闭顺序。命令与原始日志由本轮机器回执记录。
- 双仓库最终根门禁、同包 discovery 完整执行/UI、共享写者租约、正式 macOS 安装包验收尚未完成；不由此文档关闭 P5。

真实 SDK 初次执行发现该隔离 checkout 尚未生成 worker runtime，补跑官方 stage 脚本；下一次发现 checkout 未运行 patch-package，执行原 postinstall；第三次是新增测试错误地把 macOS workspaceId 当作大小写敏感路径，改为核对已有 canonicalProjectId 身份合同。所有失败日志保留，未修改生产身份规则或放宽 SDK 加载断言。Desktop 首次 typecheck 使用旧 API dist，运行官方 API build 后通过。
