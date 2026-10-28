# 知识插件完整原生消费者：第一条实际包工作流（2026-10-28）

状态：standalone 合成资料的完整实际 SDK 工作流通过；P2 总目标仍 INCOMPLETE。本文不代替正式安装包 GUI、真实账户或任务插件组合验收。

`pi-knowledge@0.3.0` 候选的 Desktop native 入口改用同包 `createManagedNativeSession`，共用原知识 interface、publication、specialist 与 recovery 算法。原 API 1.x 阅读方法保留原返回格式；完整业务工具从同一 interface 注册。状态、主题记忆、专家设置与回答计数经实际 broker state CAS，恢复记录经来源隔离的真实 SDK records；managed context 只派生真实 session.inspect 的信任/只读事实，不伪装完整 Pi SDK context。

专家角色 prompt、submit schema、权限白名单、轮次/调用/输入预算与工具函数留在同一插件 owner。`model.toolStep` 每轮只作一次实际模型请求，工具由 source 本地闭包调用；取消经真实第三 signal 等待宿主清理。当前角色预算保留 1800/2400/6500/12000/2800。此切片尚未删除旧宿主 specialist 算法，也没有证明所有角色的功能等价。

验证脚本：`packages/backend/test/packed-knowledge-publication-sdk.test.mjs`（需要显式传入两个 tarball，默认跳过）。它从临时 npm prefix 干净安装，再由统一来源 scanner 验证 hash、required projection、configured-services、state-write 与任务服务声明，使用真实 coordinator、受限进程 worker、SQLite resource 和 Pi 1.1.0 SDK。资料、模型和凭据均为临时合成值。

实际闭环：prepare → read Wiki → search → read 原始方法笔记 → evidence delegate → 私有 knowledge_read / knowledge_submit 两轮模型工具调用 → 精确 draft 回答预检 → 同 owner finalizer / WeakSet 判断 → SDK durable append。结果为 released、scientificallyVerified:false，回读同 source namespace 的 recovery record 与回答计数 1/1。任务服务通过真实 catalog 被确认 absent，未以 fixture null 绕过组合依赖。

冻结源码 f178f10 / 官方构建 8b255c1 的实际包 SHA256 `c303f2c664f67c9ad53b63d6e4d71b2654fd97b69954631d97a24c7a3a8ea2bf`，API SHA256 `4c9aa679ab6d96e940b141a1c80e6be72b9d785fa3297c8a216f057666619a8f`。此 hash 标识该实际运行的候选，后继构建必须重新验收，不能沿用这个包证据。

同批源码回归：知识 native 75 文件 / 445 测试通过，知识 TypeScript（含 UI）通过；同 tar SDK 1/1 通过。

仍未完成：生产 event / polling / history / export 切换与旧默认领域 guard 删除；任务服务和 function-rich acceptance / auto-continuation 的真实 owner 组合；真实 legacy adoption、context eviction 恢复；explainer skill 与归档 broker；旧宿主 specialist 算法删除；完整多 owner / 撤销 / 回滚及正式安装包 GUI。已安装任务服务当前明确拒绝未接通的组合，不能当 standalone absent 使用。

新增校验仅在文件 / JSON / model / state CAS / SDK 边界：设置持久格式、计数格式、主题 CAS 与来源读取、纯 JSON tool schema 和真实 reported usage。未增加重试、第二套领域状态机或跨会话账本。

思考级别升级差异（明确采用）：旧 0.2.1 specialist 调用未传 parentThinkingLevel 时，reasoning model 隐式默认 medium。0.3 使用已批准的 model.selection 语义：无显式 role thinking 偏好时继承实际 parent thinking（包含 high / off）；已配置 role thinking 优先，即使 role model 未单独设置，失效仍关闭。没有新增 requestedThinking 配置。角色 token / 轮次预算不变；不得声称 thinking 与旧默认完全等价。真实 reasoning SDK 测试逐个验证 high / off、批准详情和实际 completeSimple 选项，再验证独立 role medium 配置覆盖实际 parent off。
