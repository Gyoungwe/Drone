# P2：显式历史读窗迁移与共享 owner 清理

状态：实际同 tar SDK 切片通过；完整 P2/正式安装包 GUI 尚未完成。

插件 source `512043e`，前置 read effects `331a19f`、topic probe timer 修复 `bb26228`，official build `05cf187`。knowledge `0.3.0` tar SHA256 `850513debaed231e52263497407fc85618d33e6efb4eca214af9e71d9d06bec4`，匹配 Plugin API `1.3.0` tar SHA256 `79b5d34ad78355129beb52a09dc63fa445d9ddb82bb1f3d05ccd6ce056eed9aa`。这是未发布本地候选，不是 npm 发布证据。

命令只通过实际已安装 source 的 `recordAdoptions` 声明消费 `session.records.adoption.inspect/commit`，无用户自报 session/target/root 参数。两次独立 write 授权只 import 0.2.0/0.2.1 `drone-knowledge-recovery-v1` 历史读窗字段；0.4 前删除命令与声明。creator/version 保持 unknown，used 保留、evicted=false，未知 grants/proofs 不复制，无当前 read ticket 或 live publication proof。

真实 PiBackend、clean-installed 同一包、独立 Node26 worker、SQLite resource、实际 SDK branch/custom entries 与 broker 闭环证明：non-durable、malformed legacy/own、foreign scope/binding、伪造字段、consumed restore 拒绝、重复导入不写、原 legacy 保留、审批中实际 abort 后零 append/零 adopted 通知。三条真实会话按创建顺序完整关闭；未捕获清理错误。

多会话清理先有稳定 RED：首会话实际打开 index，另一会话仅 Hello，关闭最后 owner 在 500ms 边界失败。精简测试排除了 adoption/cancel/malformed；临时诊断证实 domain dispose 已结束但已有 600ms topic probe timeout 仍存活。仅在该既有 probe 的 finally 清 timer 后 GREEN，没有增加关闭 timeout、retry 或通用 skip。临时诊断已删除，最小真实同 tar 回归保留。

最终实际相同 tar 三文件 3/3（完整 prepare/read/search/delegate/check/publication、迁移/取消、多会话关闭），日志 `/tmp/knowledge-adoption-frozen-packed.log`。插件 76 文件 446 测试、source typecheck、official build/check 通过；backend typecheck、三文件 Biome 通过。

未完成：managed actual context eviction/reread、child、其他分支/未打开历史、task privileged provider 组合、explainer archive、宿主旧领域算法删除与正式安装包 GUI。不得把导入的历史 JSON 当作这些边界已验收。
