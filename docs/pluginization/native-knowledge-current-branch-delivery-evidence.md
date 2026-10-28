# 知识插件当前分支公开交付与导出（2026-10-28）

状态：已打开会话的生产 PiBackend → 实际包当前分支交付切片通过。完整 P2 仍 INCOMPLETE；未打开历史、其他分支恢复、child 原生来源、任务组合及正式安装包未验收。

来源与 finalizer 使用 S2 完整 SDK ResourceLoader 回执。SessionConstruction 注入同一 NativeSessionDelivery 的 run-start/finalize/export；SessionRegistry 保留该实际会话的 host-only delivery。SessionEventService 在任何公开观察、精简、trace 或 fanout 前投影：required / unknown 运行不发送 assistant 增量；最终只允许本次 owner 裁决过的 SDK 同一对象，fingerprint 只用于发现后续修改，不产生权限。复制 JSON 或重载前的对象没有这个交付关联。

已打开历史经 SessionEngine 的 SDK 私有 WeakMap 查询当前 branch。只有该对象关联存在、且真实 persisted payload 未变时才传入私有 historicalAliases。source owner 自己恢复历史身份并决定展示；这不加入 live WeakSet，也不能用于新发布。copy 真实正文、ID、timestamp、hash 仍被拒绝。实际 SDK reload 后的新 attachment 通过实际 origin 恢复展示。

钉版 SDK 增加 host-only export callback，输入由实际 SessionManager 获取；回调只能返回按本次 entry 对象关联的 message 替换，不能替换 entry IDs、顺序、parent 或非 message 字段。Map 复制键不匹配且必须关闭，不能原样漏出正文。write 前再次检查 source / scope 的真实闭包、实际 leaf、idle、dispose。撤销或 branch 改动后不创建输出。原同步 JSONL 在普通会话保持原签名；required / pending 明确要求新的异步宿主入口。HTML 原异步入口同样等待裁决。SessionEngine / SessionMessageService 已使用异步 JSONL 入口。

当前 SDK 真实 origin 只证明 current branch。required HTML 的其他分支目前明确 unknown 并作中性展示；这只是临时安全切片，不是完整全树导出完成。未打开 peek 无实际新来源时也保持 unknown，不以 raw=raw、时间戳或 hash 推导 0.3 权限。后续需要实际只读 SDK 历史来源与 effective selection 的完整恢复。

发布的 pi-knowledge 0.2.1 / API 1.x 对照仍保留实际显式注入的旧 projector。默认生产路径仅在该 callback 存在时调用兼容入口，并使用 registered-owner-only 模式，不由环境变量启动默认领域 policy。旧 raw=raw 仅位于明确标记的历史对照分支；0.3 managed owner 从不接收这些别名。本目标 P6 前必须移除这些旧 stage，不能以兼容分支宣称迁移完成。

实际包：source f178f10、官方 build 8b255c1；包 SHA256 `c303f2c664f67c9ad53b63d6e4d71b2654fd97b69954631d97a24c7a3a8ea2bf`；API SHA256 `4c9aa679ab6d96e940b141a1c80e6be72b9d785fa3297c8a216f057666619a8f`。

生产测试 `packed-knowledge-publication-sdk.test.mjs` 使用临时 npm clean install、真实 scanner / SQLite / process worker / broker / model。实际 prepare → read → search → read → source specialist tool loop → exact draft check → finalizer → durable SDK append 后，验证 SessionEventService、SessionMessageService polling、reload、copy 拒绝与 backend.exportSession。primary signed thinking 与 tool preface 在下一真实 provider 请求完整恢复，但公开 events / history / JSONL 均不存在；private specialist thinking 也不进入 parent transcript。无用户 Vault、网络凭据或真实账户写入。

验证：当前 6 文件 / 49 SDK 测试通过（包含上述真实同 tar 包、final fence 14、source selection 6+9、模型 13、export 6）；旧版本交付 / 历史与通用 event / engine 对照 29/29；backend TypeScript 与 architecture 通过。SDK 新 export 初始 2 项 RED → 3 GREEN；增加复制 entry Map 的真实失败后，再 RED → 6 GREEN。完整 patch 已对精确钉版基线验证可应用；最终 fresh npm postinstall 与两仓完整门禁由整合批次执行，本文不冒充该结果。
