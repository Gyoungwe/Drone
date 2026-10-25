# Knowledge / research npm 发布记录 — 2026-10-25

**状态：BLOCKED_AUTH，尚未发布。** 用户已授权 `@gyoungwe/pi-knowledge@0.2.1`、`@gyoungwe/pi-research@0.2.0`、`@gyoungwe/research-suite@0.1.10` 的发布与证据推送。本机 `npm whoami` 返回 E401；未调用 `npm publish`。这不是缺发布授权，需本机完成 npm 浏览器/安全密钥登录。

本轮仅使用 main 快照：Drone `9d5bce4fb15ee532771d6152d793f2455a86d0e6`、drone-plugins `df4ba329821284b46d26e6f5bf86018cd806aa54`。在独立 `codex/knowledge-research-npm-release` 工作区检查；原工作区 `codex/scientific-agent-upgrade` 的未合并工作未纳入发布。

| 候选包 | tarball SHA-256 |
| --- | --- |
| pi-knowledge 0.2.1 | `c40c15923108067842d2295fe836959ad25870ef3a7ab89361f6e778528ab6b1` |
| pi-research 0.2.0 | `f9cd4727910351c8210ffaf4088c9a3585d89312307a09dfc7fb3b1f452adaab` |
| research-suite 0.1.10 | `06eef5a4e92896a067e808af1241d2d91d7426672c4f23c201e035d7e0c666c9` |

包体无符号链接、私有状态路径或本地工作区依赖；聚合包实含 core 0.1.8、knowledge 0.2.1、research 0.2.0。前两个 tarball 与宿主 `plugins.lock.json` 完全一致，无须改锁或重新构建分类修复安装包。本轮没有重做 GUI，既有正式 DMG 证据保留原范围。

发布前验证通过：插件 `npm ci`、`npm run check`、知识包 41 文件 / 341 测试和 smoke；宿主 lint、typecheck、完整 test、build、check:arch、plugin-api migration/lifecycle、严格扩展检查、test:upgrade、Pi 1.1.0/latest 1.4.0 兼容矩阵，以及既有公开插件宿主检查。

候选 tarball 在四个干净安装目录完成独立包/聚合包 × Pi 1.1.0/1.4.0 验收，隔离 HOME、npm 配置与缓存，采用环境变量白名单，无用户凭据。知识公开 host 入口启动真实 worker，验证方法 2 / 软件 1 与关闭重开一致。知识/研究 entrypoint 通过真实 AgentSession 每组 15 次工具调度、两个同 cwd 会话，覆盖知识状态、两源引用、候选笔记回读、空引用阻断及跨会话隔离。模型为离线 faux provider，不代表在线模型或科学验证。聚合包另加载全部三个扩展，验证未批准任务时拒绝工具调用、task_status 可执行；未声称完成聚合包内获批研究任务的发布后验收。

首次宿主测试因隔离 HOME 位于 /tmp 触发临时目录权限豁免而失败；仅移走测试 HOME 后完整重跑通过。首次聚合包探针错误地期待无任务授权执行知识工具；修正探针为验证预期拒绝回执。失败日志哈希与最终结果一并保留，没有修改产品授权逻辑。

公开 tarball 下载与完整性、发布后干净安装/真实会话、Pi CLI 和宿主验证均 **NOT_RUN**。已运行的 `check:public-plugin-host` 只覆盖既有 evidence/connectors/UI 版本，不替代这三个目标的发布后验收。

恢复顺序：本机安全登录 → 检查版本仍未发布 → 按 knowledge、research、suite 顺序发布固定 tarball → 逐包下载并核对 integrity/shasum/SHA-256 → 公开包干净安装、真实加载/会话、Pi CLI 与宿主验收 → 更新发布状态并推送证据。候选包与准备脚本已保存在主工作区 `.local/acceptance/knowledge-research-npm-2026-10-25/`，不提交原始日志或会话内容。

研究迁移总体保持 **PARTIAL**。Zotero 云端、用户自有认证 MCP、Protocols.io 写入、其他平台、在线模型质量与科学复核仍未完成；MinerU/GROBID、B8 继续暂缓。

机器回执：[knowledge-research-npm-2026-10-25.json](knowledge-research-npm-2026-10-25.json)。
