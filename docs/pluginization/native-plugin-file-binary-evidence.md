# 已批准文件根二进制读取（2026-10-29）

本片提供通用 `files.readBinary`，读取已批准 files 根内的稳定完整字节，供插件自己的文件验收算法消费。它不扩大状态数据库权限，也不提供文件写入或任务执行授权。

## 源码与合同

父基线 `41e81018` 非 squash 合入 C 的 `afdbb9c9`，保留其 binary-state/CAS 实现；仅 SPEC 追加段冲突保留双方内容。公开 DTO 为 `637d8621`，宿主实现 `a29bdb7b`，实际测试 `32b04b8e`。插件 `03c1a2d` → `1b932a7` 仅给候选 managed entry 导出已有 canonical inspectTaskBytes 和类型，未登记生产 managed 清单。

`files.readBinary({root,path})` 为 read；root 只能是当前实际批准的 files handle，path 为既有受限相对路径。JSON state 和 binary-state roots 都拒绝，不新增权限布尔。返回 `{base64,sha256,bytes,version}`：字节最多 8 MiB、base64 最多 11184812，version 为实际 dev/ino/size/mtimeMs/ctimeMs；超限明确失败，不截断。独立 stable-file-bytes helper 使用实际 regular file、O_NOFOLLOW、完整分块读取、open 前后文件身份和根/路径复验，signal 与关闭错误继续向上传播。

## 实际验收

- files 单元测试 22/22，包含 2 MiB 非 UTF-8 完整字节/hash/version、超过 8 MiB 保留原字节、state/binary-state 根误用拒绝、open 后真实文件替换、读取中真实批准目录替换、实际 signal 取消；文件操作使用真实本机文件，mock 只控制竞态时机。
- C 现有 binary-state 14/14 保持，包含实际普通 worker 的 3 MiB 数据库字节往返；SQL 根未被本片重写。
- provider 实际 SDK 文件 28/28：原 25 项保持，新增三项从独立 npm pack/offline install/scanner/Bridge/受限 worker/真实 SDK 入口执行：完整跨两层 RPC 的 2 MiB 非 UTF-8 快照、未批准 handle/超过 8 MiB 拒绝、canonical PDF magic/hash 正负规则、真实 scoped cancellation 等待 host 清理后不返回迟到快照；后续 fresh read 正常。
- Backend/Desktop Node TypeScript、plugin-api check/build、架构及改动文件 Biome 通过。core check 的 Node 29 和 runtime/UI 215、typecheck/build:check/smoke 通过。

文件端口测试使用实际已批准 resource 根；PDF magic/hash 用明确标记的合成边界字节，不把它称为已解析的真实 PDF、DOI/title 身份或科学证明。详细命令、候选 tar 与日志见[结构化回执](../releases/native-plugin-file-binary-2026-10-29.json)。

## 保留未完成

真实 PDF DOI/title 解析仍需单独修复：现有 core `readPdfIdentity` 用相对 pdf-worker.mjs 的 Node Worker，但 npm tar 未包含该文件，且 core 未独立声明 pdfjs-dist；受限 guest 也不能新建 Node Worker。后继必须由本插件拥有的同一解析核心、真实依赖与实际 resource 进程提供，Native/managed 共用，不能给 guest 添加 --allow-worker 或从 host app.asar 猜依赖。本片没有证明该项通过。

managed TaskSession 的完整接受文件闭环、一次真实任务授权、actual queued continuation origin、Knowledge acceptance、旧版本显式迁移、旧 startup task/core 装配删除、正式安装包 GUI 和统一双仓库最终门禁仍未完成。未更新发行锁、未发布 npm、未推送。
