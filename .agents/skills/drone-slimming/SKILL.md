---
name: drone-slimming
description: 双仓删旧轨、合包、去重契约或拆大文件；验证真实切流、业务净减与行为不变。
---

# Drone 瘦身规程

1. **量基线。** 记录两仓 HEAD、目标文件/目录现有行数和本次业务净减目标。按[维护红线](../drone-maintenance/references/red-lines.md)口径计数；审计、测试、构建产物、搬文件或改扩展名不算业务净减。用现有搜索和构建清单找消费者；已安装 Knip 时可辅助发现，不能凭扫描结果删除动态入口。
2. **查 Owner。** 按[双仓规程](../drone-maintenance/references/dual-repo.md)确认唯一责任方。核对 IPC、包导出、动态注册、测试和打包。领域契约归插件；宿主用通用传输，不直接依赖插件内部。对照 [P0–P7 执行计划](../../../docs/pluginization/native-plugin-implementation-plan.md)的前置和验收条件。
3. **切流后删旧。** 先验证替代入口及授权/回读，切流 PR 同步删除被替代的实现和无效测试，不留双 writer 或未批准 fallback。保留仍覆盖行为的门禁；按真实职责拆文件，不增加空壳转发、不因 LOC 目标移除活能力。生成物退役须验证干净检出和真实包。
4. **检查。** 两仓各自跑 `node scripts/check-bloat.mjs --require-net-decrease`（只对纯瘦身的相应改动）；验暂存内容加 `--staged`。跑对应范围的 lint、类型、测试和构建，整 PR 按 AGENTS 门禁；调整旧基线只允许缩减。插件先验，宿主需时单开重锁。
5. **回执。** 在对话或 PR 写删除/修改文件数、业务 `+X/-Y/净 -Z`、单列测试/文档/生成物、是否仍在棘轮名单、检查和未覆盖项。不另建过程文档；不能标 PASS 的就报告证据范围。
