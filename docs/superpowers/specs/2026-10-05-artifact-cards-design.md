# 产物卡来源与一键重跑设计

## 目标

让产物面板中的交付物展示可追溯来源，并对具备代码指纹与运行环境回执的产物提供受现有授权保护的一键重跑。来源查询只返回账本引用和有界摘要，不读取或传输文件正文。

## 数据与领域边界

`@drone/inquiry` 继续拥有 Artifact/Attempt 四本账和 lineage 校验。`ArtifactRecord`、`AttemptRecord` 只增加可选元数据：来源会话与轮次、运行 provenance 摘要、可重跑的声明式 workflow 引用和重跑关联。`artifactProvenance` 从目标 artifact 开始展开父链，最多 20 个节点，返回 `truncated` 标记；关联 attempt 只按 artifact id 引用，运行摘要包含容器 digest、workflow/module、命令摘要（不包含命令正文或文件内容）。

可复现性是纯函数：同时存在非空 `codeFingerprint` 和 `runProvenance` 为 `reproducible`，只有其一为 `partial`，两者都缺失为 `not-reproducible`。该函数不执行文件或工作流。

## Host API 与 IPC

新增 `InquiryContract.artifactProvenance(artifactId)`，artifact id 使用受限字符串 schema；契约 binder 在参数和结果处做运行时校验，非法输入返回现有结构化 `UiError`。查询未找到目标或 Inquiry 未启用也返回结构化错误。四处 IPC 同步 shared 通道、desktop main、preload 和 renderer 类型。

重跑沿用已有 compute 提交入口。Inquiry 后端持有一个由组合根注入的回调，回调先交给 compute adapter 的授权门控，再提交相同声明式 WorkflowSpec；回调返回新产物摘要。新旧 sha256 相同则记录 `reproduced`，不同则将旧产物置为 `superseded`，新产物正常入账，并在投影中携带差异摘要。

## UI

ArtifactsPane 对可识别的 Inquiry 交付物显示可展开“来源”区：状态徽标、代码指纹/参数、环境和 workflow 摘要、父产物链、来源会话跳转；只有 `reproducible` 显示重跑按钮。`partial` 和 `not-reproducible` 仍可查看来源但不触发重跑。所有新增文案同时加入中英文词典。

## 发布门禁

B5b 的 metacognitive artifact 投影接受可复现性状态。引用状态为 `not-reproducible` 时新增 warning 诊断并继续原流程；已有 checksum、方法、finding 标签和诊断漂移失败仍保持 fail-closed。

## 验证

新增 Inquiry 领域单测（查询、父链截断、三种判定），后端重跑单测（哈希一致和不一致），契约运行时参数测试，ArtifactsPane 组件测试（三徽标与展开）和 metacognitive warning 测试。完成后运行 lint、typecheck、unit tests、架构检查和 build。
