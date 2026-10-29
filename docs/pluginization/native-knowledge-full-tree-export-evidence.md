# P2：真实已打开会话的全树历史导出

状态：本切片实际同包 SDK 通过；未打开历史、child、task 组合和正式安装包仍未完成。

固定 Pi 1.1.0 的 `_createHostExportView` 仅从该实际 SDK SessionManager 的 stored entry/message 对象构造 export-only 历史来源。它不接受外部 entries JSON、entry ID、时间或 hash 来建立关联；`getHostPersistedMessage` 仍只认当前 branch 的实际 SDK WeakMap。现有私有 courier 只授同 owner 历史展示，不登记 live proof。

SDK 导出 view 保持 actual entry 的 ID、parent、顺序及其他字段。JSONL 仍为官方当前 branch 语义；HTML 为官方全树语义。source owner 处理所有实际历史分支，已保存的检查正文不再被永久替换为 neutral。其他分支的实际来源不成为当前 branch 的 origin，也不把复制的 proof JSON 变成新发布授权。

新增显式 SDK epoch 在 refresh、reload、tree navigation 和 dispose 更新；即使导航切走再回到原 leaf，旧等待导出也拒绝。输出前继续复验实际 owner/source、idle/disposed、epoch 与 leaf，没有使用延时、重试或重新创建 SDK 规避生命周期。

真实 RED→GREEN：四项新增回归分别证实原有 other-branch origin 缺失、refresh/reload/same-leaf 回选未失效；补丁后 SDK export 十项通过。原 copy-entry replacement、revoke、changed branch、ordinary sync/无 callback 语义保持。

最终 SDK 七文件 51/51，日志 `/tmp/knowledge-export-tree-cohort-final.log`；backend TSC 通过。固定补丁 fresh apply 十个文件与被测 SDK 逐字节一致（`/tmp/knowledge-export-tree-fresh-patch.log`）。

真实同 tar PiBackend 完整工作流先 prepare/read/search/delegate/check→发布，再 reload、navigate 到新 branch、普通 Hello、实际 HTML 导出：两 branch 正文均保留、原 branch 不成为当前 origin、signed thinking/tool preface/private child thinking 不进 HTML；source errors=[]，关闭成功。日志 `/tmp/knowledge-export-fulltree-packed2.log`；knowledge tar SHA256 `8b06ea6973338ec9ea39c1f637d589e64f272ca25fb2f26aea398f60d3134772`（插件 source `02973ed`、official build `af91f79`，保留同一个 canonical 算法），API tar `79b5d34ad78355129beb52a09dc63fa445d9ddb82bb1f3d05ccd6ce056eed9aa`。

同 tar 的迁移与共享 owner 清理两项也通过，source 76 文件 446 测试及类型检查通过。此证据不代表 npm 发布或 GUI 完成人工走查；offline reader 尚未实现，不通过偷开写会话取得来源。
