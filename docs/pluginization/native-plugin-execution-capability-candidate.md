# P5 C 执行端口候选：尚未完成真实插件执行闭环

2026-10-28。本切片只交付可审查的通用宿主端口与共享 Node 基础设施；不关闭 P5 或整体目标。

## 权限与真实调用者

安装清单既有 `permissions.subprocess` 中只有精确 `container` 声明派生 `requestsExecution`，纳入 source 变化撤销判断。声明不授予任意 shell，不创建 dummy resource，不授予新的文件根。Desktop 仅为带当前安装内容 hash 的 activation 注入 `execution.describe`、`execution.run`、`execution.receipt`、`execution.cancel`。

`execution.run` 是 write 操作。宿主逐次展示代码原文、工作区相对 runs 目录、精确缓存镜像 ID、语言、数据分类、超时和输出上限。实际批准后重新检查真实 live/trusted/writable SDK session、规范工作区、无 symlink 的 runs 路径和镜像身份；不接受 plugin 输入的 session/workspace 身份，不拉取镜像，不回退到宿主解释器。

`execution.describe` 只探测已配置 Python/R 对应镜像是否已缓存及 exact ID，不列举镜像。run 必须匹配对应语言实际配置解析出的 ID；不能把 request.image 反填为配置来证明自身有权执行。`execution.receipt` 只读取当前合法 caller 所属的 plugin/source/application/session/workspace/request，不能枚举其他回执。

## 受理与关闭

同一公开 `@gyoungwe/plugin-api/node/execution` runner 被宿主消费；标准 Pi adapter 的接入是本轮下一步，不能仅凭这个 helper 标记原生执行通过。runner 对 canonical runDir 持有固定 `execution-directories` namespace 的同用户 lease。每次实际执行都禁止网络、只读根、禁用权限提升、限制资源、`--pull=never`，只挂载本次 runs 子目录。正常、错误或取消均须向 daemon 回读 owned container 已不存在后释放 execution-directory lease；清理或实际 lease unlink 失败保留 lease 并报告 cleanup failure。stdout/stderr 共用 UTF-8 字节上限，另保留实际 producedBytes。

真正批准、校验后先生成宿主 UUID 并通过真实 backend JsonStore 原子写入 accepted receipt，才调用 runner。受理后只保留本次 runner 清理和这份终态回执的写入权限，完全不持有 Vault/model/plugin-state capability。取消后终态写入不借用新 caller。清理或回执 finalize 失败会让 provider drain 失败，从而阻止 activation 的最终 lease 释放；同一失败 execution owner 拒绝新 run，仍允许读取 own receipt。

receipt 只保存代码 hash、目录、镜像、身份与终态元数据，不保存代码或原始 stdout。文件由 application closure 的内存随机 key 签名；key 不传 worker、不写 plugin state，没有 process 全局账本。Node 存储使用 no-follow 文件读取、大小上限、原始字节 CAS、写后回读；宿主 atomic writer 是真正 JsonStore，标准 Node writer 使用同目录原子 link/rename。

查找键在 source/application 更新后保持稳定，但回读仍严格匹配全部 ownership。旧文件验签失败或身份变化会明确要求 needs-recovery，阻止以同一 requestId 自动重复执行；此候选不宣称已支持跨 application 恢复。

`execution.cancel(write,{requestId})` 仅取消 actual 同 source/application/creator SDK session/workspace 的已 accepted 事务，等待本次 terminal/owned cleanup 后返回 own receipt。missing 保持 missing；重复取消只读既有 terminal，不重新执行；无 live runner 的 accepted 记录保持 needs-recovery，不冒报 closed。

## 当前证据与缺口

- 41 项 targeted tests 通过：执行/回执/运行时单元与可执行 synthetic engine fixture，涵盖 accepted-before-run、两种真实原子写入适配、取消终态、MAC 篡改/换 key、source/session/workspace 隔离、旧 request 防重放、UTF-8 输出总上限、目录 writer 竞争、实际 unlink EACCES 后保留 lease。
- Desktop source/host/bridge 91 项通过，覆盖精确声明派生、清单撤销与现有通道；API 17 项、backend/Desktop typecheck、架构门禁另有本地日志。它们不是正式安装包验收。
- 当前 Docker `desktop-linux` 和 root 复核的 `default` 中，旧缓存 `a0f57064…` 与 `python:3.12-slim` 均不存在。真实缺镜像端口返回 unavailable/not-cached，未生成 accepted receipt 或 runs 目录。未 pull/retag，未沿用旧执行成功证据。
- **未完成**：标准 Pi adapter 接入、受限 worker 的真实 native/UI 同 owner 执行与取消、后续合法 caller 的领域 journal CAS reconcile、creator SDK session kernel 生命周期、Inquiry 独立 provider 迁移、完整 UI、旧 seam 删除、合并后完整双仓库门禁和正式安装包 GUI。真实容器成功还需取得正式授权的可用镜像。

主要日志：`/tmp/discovery-c-receipt-nofollow-tests.log`、`/tmp/discovery-c-cap-final-desktop-tests.log`、`/tmp/discovery-c-host-endpoint-*-final.log`。新增边界 catch/guard 分别用于：OS 路径与 NUL 参数；缺失可执行文件和并发目录 EEXIST；私有 JSON 的 ENOENT/解析/大小/no-follow；签名与 ownership；CAS 与 readback；临时文件/lease 清理；受理/终态持久化失败导致 owner 保持 failed。没有静默默认值或空 catch。
