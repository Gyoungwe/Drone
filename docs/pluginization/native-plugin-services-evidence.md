# 同来源目录的可选 JSON 服务

公共类型 `e74caf23`；插件规范与清单门禁 `030bda3`（父插件源码 `ed660fc`）。[机器回执](../releases/native-plugin-services-2026-10-28.json)。本片是 P4/P2 共用基础，普通数据服务不能产生任务/文件写入授权，完整 canonical task/knowledge 服务和正式安装包仍待迁移验收。

清单使用 `drone.provides:{service:{version,operations}}` / `drone.requires:{alias:{service,version}}`，不覆盖 `requires.hostCapabilities`，不引入 plugin-to-plugin import/依赖。installed-package-sources 同一个 scanner 解码 pure JSON 元数据并计入 source 比较；provider 路由只使用 root 提供的同一个 sources() catalog，不扫 UI 或再建目录。精确版本的唯一 enabled source 才可被授权激活；inspect 明确给出 absent/disabled/unavailable/incompatible/ambiguous。

provider.read/write 经实际 registry 的 operation 和 effect 执行；read ceiling 在调用前拒绝 write。双方来源/hash、原实际 caller/session/原窗口、trust/readonly 和 signal 前后复核。短租约复用真正 application owner；已有 native/UI 绑定时共享同一实例，无其他绑定时纯服务 owner 只活本次调用，持久状态必须通过明确端口保存。结束等待 pending 排空和 revoke，清理失败向上抛并保留现有 teardown 屏障，不给旧源再导入机会。

循环链是 host-only 实际 source/operation 引用，随当前 caller/broker context 跨 worker 的 capability callback 保留；从不接受 JSON 自报身份。实际循环拒绝，没有永久依赖图、全局 ledger 或函数事件总线。JSON data 结果不授予 FS/model/task consent；特权角色仍需 P2 courier/owner 真实 proof 与消费点独立验收。

## 真实验证

- `plugin-provider-sdk.test.mjs` **6/6**：每项真的 npm pack 两个协议 fixture，offline clean install 后使用 production scanner、受限 Node worker、Backend/SDK。真实 native 工具与 provider 调用回读相同 ownerId/状态，写后回读 SDK checkpoint；read→write 拒绝。其余覆盖实际嵌套双 worker 循环、原 caller 单请求取消/迟到批准无写、真实 provider source 停用 abort/drain、真实 installed bytes 变化后旧审批无写，以及真实 worker dispose 失败使回执 reject/源屏障保留。不存在以 in-process mock 作为持久化或跨进程证明。
- absence/version/ambiguity 状态检查使用同一 catalog；disabled/unavailable 是 host catalog 状态注入，ambiguity 的第二候选是目录 fixture，不冒充正式第二插件安装。实际版本变化从已安装 manifest 重新扫描，未修改 frozen metadata。
- 连同 records 7、questions 9、models 8、native owner 4，5 文件 **34/34**。Desktop scanner 11 + runtime host 22 共 **33/33**；后者证明七个 session 端口不受模型声明误门禁、只有两项 model 端口受声明控制。
- 插件 manifest checker **22/22**，正式 workspace build 完成后 **10 个清单通过**；较旧隔离插件基线的 research-suite 汇总指纹变化未夹入本规范提交，主集成须按最终源码重新生成。尚未运行此规范组合后的整个插件 check，不能写最终双仓库 PASS。
- backend/Desktop node TSC、API package check、arch、定向 lint 与 diff check 通过。无新增专用 IPC/renderer surface，现有 capability 管道复用。

本片的 fixture 包只证明 production transport/installed source/SDK 机制，不替代完整产品插件、正式安装包 GUI 或最终双仓库门禁。其根 native 文件故意拒绝，验证 Desktop 选择 managed 同包 adapter；没有声称这个 fixture 已通过原生 CLI 兼容验收。

新增 guards 都在 manifest/JSON/host caller 权限边界：对象、键与版本/operation 列表检查拒绝不合格安装包；caller/source/hash 复核属于作用域撤销约束。没有新增空 catch、重试、超时或授权默认值。下一块仍是旧 checkpoint 明确 adoption、raw CLI 磁盘 generation fence、真实 canonical provider 与 TaskApplication 受限迁移及 startup facade 删除。旧四项与 B8 不变。
