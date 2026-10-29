# P2：旧 specialist 算法迁出宿主

状态：canonical 源包算法复用与旧接口切片通过；临时 bridge/wrapper 仍须在本目标的默认 native 切换后删除，不能据此宣称 P2 完成。

宿主 `knowledge/specialist-runner.ts` 删除角色 prompts、submit schema、角色预算、工具循环和 usage 累计算法；仅保留旧接口签名、实际 SDK 模型/认证/thinking 选择及现有通用 `completeModelToolStep` 传输。唯一领域循环是插件现有 `core/specialist-model-loop.ts`，managed native 与旧 1.x 显式 host loader 都调用同一个源码函数。

未发布 API 1.3 只对既有 legacy KnowledgeHostPort 加 optional `runSpecialistModelLoop`；函数值仅在已注入 source 的原 owner 中使用，不通过 JSON/provider/worker 搬运。`createBackend` 从显式 `knowledgeHostLoader` 注入，宿主没有新增可选包名静态或 lazy import，也没有缺包算法 fallback。缺 port 时报告需要 0.3 specialist loop 能力，其他既有 1.2 字段不改变。0.3 `/host` 的具名导出只是同函数的纯适配入口。

宿主不向 source 传 SDK Model/ModelRuntime 值、父聊天、ambient skills 或环境；JSON selection 是描述，真实 SDK 模型和 thinking 由宿主已选闭包固定。callbacks/check/onUsage/工具函数保持原 owner 的执行语义。source 负责已存在的角色 budgets、source schemas、private context 与结果验证。主 native broker 仍有独立实际 source/caller/profile/epoch 权限校验。

三文件旧行为回归 79/79（48 specialists、25 review、6 stress）。fixtures 显式提供真实 source port、实际必需 auth/model cost 形状；hung-provider fixture 响应真实 abort 并完成清理，不再以永不 settle 的假 provider 推断已经清理。保留 forbidden tools、single submission、schema、quota、consent/token/single-use 和 abort 断言。真实旧 Wiki UI→SessionService→source canonical loop→实际 SDK 的三项也通过，父私有上下文、应用/只建议及审计语义保持。

最终 clean-installed knowledge tar SHA256 `fb67c30abfd0526239641958931a436e845a8feddca3f2b7f38547ec585eceba`（source `62e6480`、official build `cd34353`），API tar SHA256 `e7c1a6780c2a789f0186bc6a44269ba2515e0c4c64d0d6f7d024e5b688005e38`（API source `dbdfd368`）。真实已启动 PiBackend/SDK session 中，旧 wrapper 获取实际 installed host port，完成实际模型→assigned file read→structured submit、usage 两轮回读与取消后零下一模型调用；结果/父聊天不含私有 thinking。日志 `/tmp/knowledge-legacy-packed-sdk.log`；不是 GUI 或 npm 发布证据。

backend TSC、Biome、arch 通过。临时进程兼容注册 bridge 尚未删除；child policy、未打开历史、task native provider、explainer archive 和正式安装包仍未完成。
