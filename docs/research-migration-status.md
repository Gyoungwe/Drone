# Research / pi-research / Zotero 迁移状态

> 2026-10-24：下一阶段 P1 研究边界迁移切片。本文只记录本地结构和删除条件，不代表已完成公开包迁移或第三方写入验收。

## 当前切片

- `packages/research/src/**` 是研究领域的纯合同与状态机实现，继续作为 Drone workspace 的 canonical source。
- `packages/pi-research/` 已提供公开 `@gyoungwe/pi-research@0.1.1` 的证据循环和 PDF 阅读入口；构建产物不含 Electron、backend 或相对路径穿越。
- `packages/extensions/src/research-loop.ts`、`source-archive.ts`、`zotero-literature.ts` 仍是 Desktop/Pi host adapter。它们通过 `@drone/extensions` 的 workspace config、runtime scheduler、Vault ports、institutional access 和 Zotero 本机 API 工作。
- `packages/pi-research/src/index.ts` 仍通过 `@drone/extensions/research-loop` 装配 run-level evidence lifecycle；`packages/extensions/src/internal/research-host-entry.ts` 是保留的兼容入口，不能在当前依赖状态下删除。
- Zotero 本机/云端写入继续只经 host authorization + write/read-back/delete/read-back 证据链；本切片不进行真实第三方写入。

## 删除与迁移条件

只有全部条件同时满足，才可以把研究扩展源码迁入 `drone-plugins/packages/pi-research` / `pi-connectors` 并删除宿主 facade：

1. 插件仓库拥有自包含的 `pi-research` 源码入口；源码和构建图中不出现 `@drone/extensions`、`@drone/backend`、`@drone/desktop` 或 Drone workspace 相对路径。
2. `@drone/research` 的公开合同已发布或以固定 tarball 锁定，且 Pi 1.1.0 与 latest 的 clean HOME CLI 回归均通过。
3. run-level `research_loop` 的 current-session receipt ledger、source archive、claim binding、finalize/recovery 回归均由插件仓库自有测试覆盖。
4. Zotero connector 的本机 API、云端 API、授权、写后回读、删除后回读和身份冲突均有真实隔离验收；没有凭据或 Vault 正文进入仓库。
5. Desktop 只消费公开 host port / connector contract；删除 `packages/extensions/src/internal/research-host-entry.ts` 后，`npm run check:arch`、`check:pi-compat`、正式安装包宿主回执仍全部通过。

## 当前结论

**迁移未完成，状态为 `BLOCKED_BY_BOUNDARY`，不是 PASS。** 当前可交付的是整页知识 UI 插件挂载（见 UI SPEC 的 `knowledge.page`）；研究和 Zotero 运行时仍保留宿主适配，等待上述五项依赖完成后再做源码搬迁。下一轮应先在 `drone-plugins` 建立自包含 `pi-research` 包并通过 clean install，再逐个迁移 Zotero/source archive，最后删除兼容入口。
