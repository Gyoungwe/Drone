# P5 C 执行端口候选：实际 SDK 协议已验证，完整迁移未完成

2026-10-28。本切片交付通用宿主端口、共享 Node 基础设施和实际 SDK/受限 worker 协议回归；不关闭 P5 或整体目标。

## 权限与真实调用者

安装清单既有 `permissions.subprocess` 中只有精确 `container` 声明派生 `requestsExecution`，纳入 source 变化撤销判断。声明不授予任意 shell，不创建 dummy resource，不授予新的文件根。Desktop 仅为带当前安装内容 hash 的 activation 注入 `execution.describe`、`execution.run`、`execution.receipt`、`execution.cancel`。

`execution.run` 是 write 操作。宿主逐次展示代码原文、工作区相对 runs 目录、精确缓存镜像 ID、语言、数据分类、超时和输出上限。实际批准后重新检查真实 live/trusted/writable SDK session、规范工作区、无 symlink 的 runs 路径和镜像身份；不接受 plugin 输入的 session/workspace 身份，不拉取镜像，不回退到宿主解释器。

`execution.describe` 只探测已配置 Python/R 对应镜像是否已缓存及 exact ID，不列举镜像。kind 表示 daemon 是否可用；kind=container 且 images={} 明确表示配置镜像缺失，不代表已经启动容器或能完成执行。run 必须匹配对应语言实际配置解析出的 ID；不能把 request.image 反填为配置来证明自身有权执行。`execution.receipt` 只读取当前合法 caller 所属的 plugin/source/application/session/workspace/request，不能枚举其他回执。

## 受理与关闭

同一公开 `@gyoungwe/plugin-api/node/execution` runner 被宿主消费；标准 Pi adapter 源码已消费同一公开实现；仅 helper 或合成引擎不能标记真实容器执行通过。runner 对 canonical runDir 持有固定 `execution-directories` namespace 的同用户 lease。每次实际执行都禁止网络、只读根、禁用权限提升、限制资源、`--pull=never`，只挂载本次 runs 子目录。正常、错误或取消均须向 daemon 回读 owned container 已不存在后释放 execution-directory lease；清理或实际 lease unlink 失败保留 lease 并报告 cleanup failure。stdout/stderr 共用 UTF-8 字节上限，另保留实际 producedBytes。

真正批准、校验后先生成宿主 UUID 并通过真实 backend JsonStore 原子写入 accepted receipt，才调用 runner。受理后只保留本次 runner 清理和这份终态回执的写入权限，完全不持有 Vault/model/plugin-state capability。取消后终态写入不借用新 caller。清理或回执 finalize 失败会让 provider drain 失败，从而阻止 activation 的最终 lease 释放；同一失败 execution owner 拒绝新 run，仍允许读取 own receipt。

receipt 只保存代码 hash、目录、镜像、身份与终态元数据，不保存代码或原始 stdout。文件由 application closure 的内存随机 key 签名；key 不传 worker、不写 plugin state，没有 process 全局账本。Node 存储使用 no-follow 文件读取、大小上限、原始字节 CAS、写后回读；宿主 atomic writer 是真正 JsonStore，标准 Node writer 使用同目录原子 link/rename。

查找键在 source/application 更新后保持稳定，但回读仍严格匹配全部 ownership。旧文件验签失败或身份变化会明确要求 needs-recovery，阻止以同一 requestId 自动重复执行；此候选不宣称已支持跨 application 恢复。

`execution.cancel(write,{requestId})` 仅取消 actual 同 source/application/creator SDK session/workspace 的已 accepted 事务，等待本次 terminal/owned cleanup 后返回 own receipt。missing 保持 missing；重复取消只读既有 terminal，不重新执行；无 live runner 的 accepted 记录保持 needs-recovery，不冒报 closed。

`capabilities.call(name,input,signal?)` 的第三参数只收窄当前真实调用的取消范围。worker 的取消消息绑定原始 parent invocation、单次 ID 和私有随机标识；未知、迟到或错误归属取消不会建立调用。promise 等待宿主真实 settlement/owned cleanup，不做本地 race 提前关闭；失败回执保留宿主错误，尤其不能被本地 AbortError 覆盖清理失败。guest 原有 500ms 关闭计时在实际 host capability/resource cleanup 完成后开始；意外 child exit 也先 abort 并等待实际宿主清理，再拒绝 parent 和结束进程关闭屏障。

同一个 Desktop application bridge 的 accepted facts 与签名 key 跨 activation 保留；按实际 plugin/source/application/creator SDK session/workspace 隔离，没有 process 全局表。已 accepted 文件删除后，停用重启仍返回 needs-recovery，阻止同 requestId 重放。新的合法 caller 才能用 state.write + CAS 保存领域观察，不允许旧取消调用续借写权限。

## 当前证据与缺口

- 41 项 targeted tests 通过：执行/回执/运行时单元与可执行 synthetic engine fixture，涵盖 accepted-before-run、两种真实原子写入适配、取消终态、MAC 篡改/换 key、source/session/workspace 隔离、旧 request 防重放、UTF-8 输出总上限、目录 writer 竞争、实际 unlink EACCES 后保留 lease。
- Desktop source/host/bridge 91 项通过，覆盖精确声明派生、清单撤销与现有通道；API 17 项、backend/Desktop typecheck、架构门禁另有本地日志。它们不是正式安装包验收。
- 当前 Docker `desktop-linux` 和 root 复核的 `default` 中，旧缓存 `a0f57064…` 与 `python:3.12-slim` 均不存在。真实缺镜像端口返回 unavailable/not-cached，未生成 accepted receipt 或 runs 目录。未 pull/retag，未沿用旧执行成功证据。
- 当前实际安装 tar → 生产 Desktop factory/scanner → restricted worker → 两个真实 SDK 1.1.0 session 的回归通过：canonical caller/creator 隔离、缺配置镜像零 accepted/runs、native 只关闭自己的 logical kernel、新合法 caller 保存关闭记录、单次 timeout/close 在审批中取消后迟到允许仍零 accepted/run。明确的 synthetic engine 另证明 accepted→SDK cancel→等待 owned cleanup→新合法 caller reconcile，以及同一 bridge 停用重启后缺回执拒绝重放。**合成引擎执行不是 Docker 成功，直接 UI runtime 调用不是整页 GUI 验收。**
- 取消/运行时/事务/runner targeted 50 项以及新增 child-exit 用例通过；真实 SDK 协议日志 `/tmp/discovery-c-actual-cancel-real-sdk-3.log`；受限 worker 清理日志 `/tmp/discovery-c-child-exit-tests.log`。插件自身 19 项与 clean-install smoke 通过；smoke 仍为 fixture，不是最终 PASS。
- **未完成**：真实已缓存镜像下的 native/UI 同 owner 执行成功、完整科研插件页面（critic/multipath/evaluation/export）、Inquiry 独立 provider 迁移、旧 seam 删除、合并后完整双仓库门禁和正式安装包 GUI。真实容器成功还需取得正式授权的可用镜像。

主要日志：`/tmp/discovery-c-receipt-nofollow-tests.log`、`/tmp/discovery-c-cap-final-desktop-tests.log`、`/tmp/discovery-c-host-endpoint-*-final.log`。新增边界 catch/guard 分别用于：OS 路径与 NUL 参数；缺失可执行文件和并发目录 EEXIST；私有 JSON 的 ENOENT/解析/大小/no-follow；签名与 ownership；CAS 与 readback；临时文件/lease 清理；受理/终态持久化失败导致 owner 保持 failed。没有静默默认值或空 catch。


## 15 秒 guest watchdog 后继

普通请求与 factory 的原 15 秒上限现在只扣除 guest 自身执行时间。只有同一真实 parent invocation 已登记的 capability（包括等待批准）才暂停自己的预算；多个在途能力全部 settle 后沿剩余预算恢复，不重置 15 秒。实际 owner resource cleanup 也携带内部 parent callId，只暂停对应 disposal 的预算。取消、child exit 与停用仍等待真实 host cleanup，停止后不会重新启动已结束预算。

实际受限 worker 回归使用父进程 fake clock：先用掉 5 秒 guest，再等待 20 秒批准、20 秒真实 host capability；返回后剩余 10 秒用完仍会终止失控 guest。另验证 A 的 20 秒 host wait 不暂停 B 的 15 秒 guest deadline，以及 disposal 的真实 resource cleanup 超过 15 秒不会提前释放 lease。没有新用户配置，也没有放宽执行、文件或来源权限。

定向 42 项及实际 installed UI/native SDK 2 项通过，日志 `/tmp/inquiry-guest-budget-targeted.log`、`/tmp/inquiry-guest-budget-approval-tests.log`、`/tmp/inquiry-guest-budget-sdk.log`；SDK 执行仍为 synthetic engine，真实 Docker/正式安装包状态没有扩大。process wire 当前无全局字节预算，本后继不改变历史 projection 上限；binary payload 自身限制另行审查。

## 真实 cached Docker 端到端（2026-10-28）

统一候选 discovery tarball SHA-256 `378f831d75688dcc84f255a1bf06ca51ddd4be9b0467b502a5d2bc1877c7eb9e` 与 API 2c 候选，在生产 installed scanner → Desktop bridge → 普通受限 worker → execution broker → 本机 Docker 的真实 SDK 与已安装 UI 渲染链通过。实际 Python 默认镜像为已缓存的 `sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159`；没有测试内拉取或产品自动拉取，所有真实 run 仍 `--pull=never`、只读根、network none、仅合成 runs 可写。

实际 SDK 和同 owner 的安装 UI 分别写合成 proof 文件、读成功 terminal receipt；另一 creator 只见 missing。观测包装器只原样执行真实 Docker 二进制并记录本测试 argv，不合成任何输出。两个本次创建的随机 containerName 在关闭/停用后逐项精确查询为空；未列举或清理用户容器。`/tmp/discovery-real-container-sdk-ui-final.log` 两项通过，其中另一项 protocol-only 使用自己的 synthetic missing-image 探针，不再依赖用户镜像缓存为空，专门超时仍 1 秒，启动观测等待改为 10 秒。正式 Electron/DMG GUI **NOT_RUN**。

标准 Pi 默认入口也使用同公共 Node runner，实际 SDK 1.1.0 caller、UI confirm fixture、真实 Docker、原子本地 receipt、runs proof 与 closed journal 回读通过；日志 `/tmp/discovery-real-native-sdk.log`。`DRONE_REAL_DISCOVERY_CONTAINER=1` 才执行真实容器切片；没有该 opt-in 时标准 Pi fixture 仍明确 synthetic，Desktop real-container fixture 明确跳过。完整 Inquiry、其余领域 seam 删除与正式 GUI 不由这两项关闭。
