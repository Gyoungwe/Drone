# 原生插件私有模型工具步进切片（2026-10-28）

状态：机制候选已验证；完整知识 specialist 循环、同包工作流和正式安装包仍 INCOMPLETE。

`model.toolStep` 是 write 能力，仅向声明 configured-services 的实际安装来源开放。它复用 `model.selection` / `model.generate` 的真实 caller、会话、模型/偏好、思考级别、批准与取消检查；每次只执行一次真实 `ModelRuntime.completeSimple`，不执行传入 tools，也不借入父对话、工具、技能、文件或环境。

输入是 bounded systemPrompt、纯 JSON 私有 messages 与 tool schemas。systemPrompt 限 32000 bytes（保留旧 18000-byte skill 的空间），messages 最多 32 条/80000 bytes，总请求最多 160000 bytes，tools 最多 8 个且名称唯一。toolStep 输出 token 上限为现有最高角色预算 12000；model.generate 仍为 8192。完整角色白名单、提交 schema、轮次/调用预算、函数能力和 onUsage 留在插件 owner，尚未由此机制切片证明迁移完成。

结果保留真实 SDK JSON reply 的协议内容、thinking 签名、tool calls、stopReason、provider metadata 与 usage，只走私有 owner 链，不自动公开或记录正文。规范化 usage 字段为 number/null 并附 reportedFields；明确的 0 token 保留，缺失 reasoning 与无有效价格的默认 0 cost 为 null，不表示免费。

`model.selection({optionalProfile})` 与严格 profile 互斥。只有宿主确认该精确偏好未配置才使用 actual parent；结果保留 optionalProfile provenance 供后续步骤复查。有效配置返回真正 profile，失效配置关闭；不捕获错误字符串回退。

`session.inspect` 增加 actual projectTrusted/readOnly，均为当前事实而非新授权。模型仍由每次真实能力调用检查权限，不能把事实快照当 grant。

验证：实际模型/会话 SDK 13 项，问答 SDK 9 项联合 22/22；Desktop 明确来源门禁 22/22；API build、backend typecheck、architecture 均通过。覆盖实际一轮 SDK 请求/签名与元数据、父历史隔离、真实 12000-token 预算、取消 cleanup 后才拒绝、拒绝/伪造选择/重复声明/非 JSON callback 零模型请求，以及 optional profile 的未配置/有效/失效三态。完整 source-worker specialist 工具循环还未运行，不标为其 PASS。

新增边界检查仅针对外部 JSON/model/provider 数据：纯 JSON/有限数值、输入 bytes、唯一 tool 名与 schema 编译，以及实际 provider usage 的可报告数值；没有新增重试、超时、缓存或领域全局账本。
