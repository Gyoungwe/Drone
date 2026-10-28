# P2：不可用发布 owner 的私有 provider 协议

状态：真实固定版 SDK 机制切片通过；不代表完整 P2、正式安装包或 GUI 验收完成。

## 行为与边界

`@earendil-works/pi-coding-agent@1.1.0` 的 host-only 最终交付边界遇到不可用 required owner 时，中间工具帧保留实际 tool calls 和 usage/provider 协议白名单，正文、thinking 和 diagnostics 不公开。无工具调用的最终回复仍关闭；真实取消仍中止。这使基础 `read` 可以执行并进入下一次 provider 请求，而不会发布未经裁决的答案。失败诊断只报告固定机制错误，不包含 owner 异常内容。

SDK 的每个实际 `AgentSession` 私有 WeakMap 仅保存该实例实际 message 对象对应的原始 content；它不是 publication proof、授权或持久化恢复记录。下一次模型上下文由 SDK 创建 clone→原对象的调用内关联，在所有实际 context hooks 完成后恢复。删除、替换、JSON copy 或原地修改的消息均不恢复。事件、公开 `session.messages`、会话 JSONL 始终只保留净化结果。

SDK 的空 boundary drafts 也会重建公开上下文。仅该 SDK 的实际 projection producer 可以通过相同的实际 entry 对象与未变的公开 fingerprint 迁移关联；不按 entry ID、时间、hash 或 JSON 内容查找权威。真实 tree 导航、reload、显式 refresh、new session/manager 或 dispose 清除此代次。即使 branch 转换仍共享原 ancestor，也不复用私有协议。无 callback 与成功 owner 路径不保存私有 fallback 数据，保持官方行为。

## 真实回归

- 原始 RED：不可用 owner 在工具帧直接 abort，真实 `read` 与下一轮 provider 没有执行，日志 `/tmp/native-private-protocol-sdk-red.log`。
- 新机制十项实际 SDK 回归：真实 read→下一次带原始签名的 provider 调用（含 empty-drafts refresh）；context copy/remove/mutate；reload、共享 ancestor 的 tree 导航、new session；实际取消；无 callback 与成功 owner 对照。
- 原 fallback fixture 改为由实际 installed-package scanner 验证、实际 ResourceLoader 选择的 required/unavailable 来源；在 import 前明确拒绝该入口，启动计数为零。实际 PiBackend 中 read、私有 next-provider 协议、usage 正常，final、公开事件与落盘不含 raw/private/header/query 内容；不依赖默认环境 guard。
- 原工具协议 usage 回归现在按真实 response ID 记录对应帧，不再用后一帧的 usage 覆盖前一帧后比较；逐帧精确相等断言保留。
- 七个实际 SDK 文件 47/47：private protocol、fallback、delivery fence、selected source、courier、export projection、selection receipt。日志 `/tmp/native-private-protocol-cohort2.log`。
- backend TypeScript 通过；固定补丁从原始 1.1.0 的十个文件 fresh apply 后与实际测试文件逐字节一致。

本次只是固定版 Drone host-only 增强；官方 CLI/native Pi 插件格式与 latest 官方入口没有改写。完整子会话、未打开/其他分支历史、任务组合、旧领域宿主实现删除与正式 GUI 仍按原计划继续。
