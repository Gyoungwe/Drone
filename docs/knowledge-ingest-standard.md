# 知识入库标准（drone-note/1）

> 状态：**I1 已实现纯函数，尚未接入写入路径**。本文件是"什么内容进知识库、什么内容只作为运行结果归档、什么内容不保留"的规范，
> 供审阅与后续 PR（I2–I6）实现时对照。实现以 `packages/knowledge/src/ingest-*.ts` 为准；本文与代码不一致时以测试为准并更新本文。

| 模块 | 内容 | 测试 |
|---|---|---|
| `@drone/knowledge/ingest-policy` | `classifyIngest()`：九条有序分类规则 | `packages/knowledge/test/ingest-policy.test.ts` |
| `@drone/knowledge/ingest-frontmatter` | frontmatter 模式、受限 YAML 解析、校验、确定性序列化 | `packages/knowledge/test/ingest-frontmatter.test.ts` |
| `@drone/knowledge/ingest-identity` | DOI / PMID / PMCID / arXiv / ISBN / Zotero key / URL 规范化，去重键，内容哈希，结论哈希 | `packages/knowledge/test/ingest-identity.test.ts` |

三个模块都是纯函数：不读写文件、不联网、不依赖 Electron / Pi SDK / backend（遵守 R2）。I1 不改变任何现有行为。

## 1. 三类内容

- **知识（knowledge，K）**：脱离某次运行仍然成立、可跨会话复用的内容——概念、方法 / 协议、软件用法、数据集版本、文献笔记、
  带引用的结论（claim）、用户确认过的结论或决策、主题综述（Wiki）、可检验的想法。会被检索、可作为回答的证据。
- **运行结果（run-result，R）**：描述"某次运行做了什么、得到了什么"——检索日志、下载回执、manifest / metadata、运行摘要、
  图表、数据表、中间文件、讲解页（展示层）。要可追溯、可复现，但**不作为证据被检索引用**。
- **临时内容（ephemeral，E）**：不保留、不归档——缓存、临时文件、编辑器备份、未完成的下载、没有任何知识或运行信号的零散文件。

## 2. 分类规则（`classifyIngest`）

按顺序判定，**第一条命中即生效**；每条都只依赖可机器判定的信号。结果包含 `class`、`type`、`purpose`、`rule`、`ruleId`、
`candidate`（是否只是知识候选）、`extractAtoms`（容器里是否有可抽取的知识原子）和 `reasons`。

| # | ruleId | 信号 | 判定 |
|---|---|---|---|
| 1 | `ephemeral-path` | 路径中有 `tmp/`、`temp/`、`.cache/`、`cache/`、`scratch/`、`__pycache__/`、`node_modules/`、`.ipynb_checkpoints/`、`.git/`、`.trash/`、`browser-downloads/`；或文件名为 `*.tmp`、`*.swp`、`*.bak`、`*.pyc`、`*.part`、`*.crdownload`、`*.lock`、`*~`、`.DS_Store`、`Thumbs.db` | E |
| 2 | `explicit-declaration` | frontmatter 显式 `class`（knowledge / run-result / ephemeral）或已知 `type`；否则 Vault 规范目录：`Library/{Papers,Methods,Software,Datasets,Concepts,Entities,Ideas}` → K、`Library/Explainers` → R（展示层）、`Wiki/` → K wiki、`Inbox/` → K 候选、`Projects/<p>/{Questions,Concepts,Entities,Papers,Sources,Evidence,Claims,Decisions,Wiki}` → K、`Projects/<p>/Runs` → R run、`Projects/<p>/Artifacts` → R artifact、Vault 根下 / 各区 `Index.md`、`Context.md`、`Home.md` → 导航页 | 按声明 |
| 3 | `tool-origin` | `research_deposit_knowledge`（type 为知识类型）、`research_propose_wiki_update`、`daily_discovery`（用户在「新想法」中保存，宿主动作）→ K；`research_summarize_run`（summary）、`research_archive_source`（source）、`research_loop`（log）、`research_archive_explainer`（presentation）、`research_zotero_save/update`（log）→ R | 按来源 |
| 4 | `run-record-filename` | `search-log*`、`*receipts*`、`literature-operations.json`、`metadata.json`、`manifest*.json`、`failures*`、`provenance*`、`SUMMARY.md`、`summary-history/*`、`report*.html` | R（log / summary / presentation） |
| 5 | `card-container` | `evidence-cards.md`、`*-cards.md`、`claims*.md` | R（cards），`extractAtoms: true`：每张卡若含标识符、主张与出处定位，可抽出 K 候选（I5 实现） |
| 6 | `data-or-figure` | 图片、PDF、表格、JSON、HDF5/h5ad、RDS、序列 / 比对 / 树文件、BAM/VCF/BED/GFF 等 | R；命中里程碑验收（`acceptance: true`）为 `deliverable`，否则 `intermediate` |
| 7 | `cited-markdown-candidate` | Markdown 正文（不含 frontmatter）≥ 300 字，含方法类标题（Methods / Protocol / Usage / 方法 / 流程 / 步骤 / 用法…）或结论类标题（Conclusion / Findings / 结论 / 发现 / 要点…），且至少引用 1 个来源（DOI、PMID、PMCID、arXiv、URL 或 `[[Library/…]]` 等 Vault 双链） | K **候选**（method 或 claim），须过质量门 |
| 8 | `confirmed-inquiry-record` | inquiry 账本中 `reviewStatus: reviewed` 的 finding、`status: active` 的 decision | K（claim / decision） |
| 9 | `location-fallback` | 其他：在运行目录内（路径含 `results/`、`runs/`、`run-*`，或调用方给出 `inRunDir`）→ R（intermediate），否则 E | R / E |

说明：

- 规则 1 优先于一切声明：`scratch/` 下即使写了 `type: method` 也不入库。
- 规则 4–6 优先于规则 7：`search-log.md` 即使引用了 DOI 也只是运行记录。
- Vault 目录规则只对 Vault 内的路径生效（`location: "vault"`，或路径以 `Library/`、`Projects/`、`Wiki/`、`Inbox/` 开头时自动推断）。
- K 不进入运行目录、R 不进入 `Library/` 与 `Wiki/`；R 在 Vault 中只以 `Projects/<p>/Runs/*.md` 中心笔记和 `Artifacts/` 指针笔记的形式出现
  （FTS 可检索，不向量化，不作为引用证据）。

## 3. 质量门（规范；I5 实现）

决定"直接入库（`status: verified`）"还是"进审核队列（`status: candidate`，`Inbox/Candidates/`）"。

1. **硬性要求**（不满足就拒绝，并说明原因）：有 title 与 type；paper / method / dataset / software / claim / evidence 至少 1 个可解析来源；
   paper 至少 1 个标识符（DOI、PMID、arXiv 或规范 URL）；dataset 有版本号或发行号外加 URL 或 checksum；正文长度：paper / method / software / dataset ≥ 300 字，
   claim ≥ 40 字且含主语与谓词，idea ≥ 150 字，所有类型 ≤ 24k；不得含提示注入或指令性文本。
2. **去重键**（命中即合并 / 更新，而非新建）：见第 5 节 `identityKeys`；software 为名称 + 主版本号；dataset 为名称 + 版本号；claim 为 `claimHash`；
   通用兜底为正文 `content_sha256`。
3. **可信度**（high / medium / low）：来源数量、本轮是否有读取回执、evidence gate 是否可回答、claim 关系等级（observation > interpretation > hypothesis）、
   审稿严重度、是否与已有结论冲突。
4. **路由**：新笔记 + 可信度 high + 类型属于自动允许集合（paper、software、dataset、method、来自运行摘要的 claim）且审核模式为自动、沉淀模式允许 → 直接写入；
   其余（medium / low、覆盖人工编辑过的笔记、同一标识符但内容冲突、concept / entity、规则 5 与规则 7 抽出的候选）→ 审核队列。
   `run-only` 模式只允许 R；strict 审核模式下全部 K 进队列。

`validateFrontmatter` 已实现其中与 frontmatter 相关的部分：来源可解析性、标识符合法性、"需要来源的类型没有来源"的警告。

## 4. Frontmatter 模式 `drone-note/1`

```yaml
---
schema: "drone-note/1"
id: "pi-<id>"                    # 可选；稳定 ID，首写后不变
type: "paper"                    # 知识：paper|method|software|dataset|concept|entity|idea|claim|evidence|decision|question|wiki
                                 # 运行结果：run|artifact|explainer
class: "knowledge"               # knowledge|run-result；缺省按 type 推导，矛盾即报错；ephemeral 不允许写入
project: "shared"                # shared 或规范项目 slug（小写 kebab-case，见第 6 节）
status: "verified"               # candidate|verified|stale|superseded|archived；缺省 candidate
confidence: "high"               # 可选：high|medium|low
tags: ["bio/phylogeny", "method/alignment"]
aliases: []
identity:                        # 去重用的外部标识（全部规范化）
  doi: "10.1093/molbev/msaa015"
  pmid: "32011700"
  zotero_key: "ABCD1234"
sources:                         # 可解析的证据来源；每项至少一个定位字段
  - doi: "10.1093/molbev/msaa015"
    locator: "Fig. 2"
  - vault: "Library/Papers/iqtree-2.md"
    sha256: "<64 hex>"
  - file: "results/demo/run-20261008-ab12cd34/evidence-cards.md"
created_from:                    # 溯源
  session: "<sessionId>"
  run: "run-20261008-ab12cd34"
  task: "<taskId>"
  tool: "research_summarize_run"
  turn: 4
derived_from: ["[[Projects/demo/Runs/2026-10-08-phylogeny-ab12cd34]]"]
content_sha256: "<64 hex>"       # 正文哈希（不含 frontmatter；换行与行尾空白不影响）
created: "2026-10-08T01:40:00+08:00"
updated: "2026-10-08T01:40:00+08:00"
---
```

字段规则（`validateFrontmatter`）：

- **错误**（`value` 为 null）：未知 type；class 与 type 矛盾；project 缺失或不是 `shared` / kebab-case；未知 status 或 confidence；
  identity 中无法识别的标识；无法解析的来源、越界路径（`..`、绝对路径）、非法 sha256；`created_from` 字段非法；`derived_from` 非法双链；
  `id` 不是 `pi-*`；日期不是 ISO 8601。
- **警告**（仍可写入）：旧状态值被映射（draft / pending / generated / proposed → candidate；applied / confirmed / reviewed / succeeded → verified；
  outdated → stale；deprecated / retracted → superseded）；缺 status；丢弃非法 tag；`content_sha256` 与当前正文不一致（说明被人工编辑过）；
  需要来源的知识类型没有任何来源；未知的 `schema` 值。
- paper 的 `identity` 缺项时从 `sources` 推导；其他类型不推导。
- 标签：去掉 `#`，空白变 `-`，小写，只允许字母、数字、`_`、`-`、`/`，不能是纯数字。

解析器（`parseFrontmatter`）只支持 frontmatter 需要的 YAML 子集：映射、块列表、`- key: value` 列表映射、流式 `[]` / `{}`、单双引号、注释、
`|` / `>` 块标量。拒绝：制表符缩进、锚点 / 别名 / 标签（`&`、`*`、`!`）、重复键、超过 6 层嵌套、超过 64 KiB；丢弃 `__proto__` 等危险键。
语法错误不抛异常，返回 `errors`。未加引号的 `[[note]]`（YAML 会解析成嵌套列表）在 `derived_from` 中按双链处理。

序列化（`serializeFrontmatter` / `renderNote`）：固定键顺序、字符串一律 JSON 双引号，同一输入输出逐字节相同；解析 → 校验 → 序列化可往返。

Obsidian 兼容：双链一律用 Vault 全路径、去掉 `.md`（与 `.obsidian/app.json` 的 `newLinkFormat: absolute` 一致）；正文固定区块
`## Sources`、`## 相关笔记`、`## Seen in runs`（K 反链到 Run）、`## Knowledge produced`（Run 指向 K）；托管区块与 `## Human review` 约定不变。

## 5. 标识符规范化与去重键（`ingest-identity`）

| 标识 | 规范形式 | 接受的输入 |
|---|---|---|
| DOI | 小写裸 DOI `10.xxxx/…` | `doi:` 前缀、`https://doi.org/`、`dx.doi.org`、URL 编码、句末标点 |
| PMID | 去前导零的数字串 | `PMID: 123`、PubMed 链接、YAML 数字 |
| PMCID | `PMC` + 数字 | 大小写、`PMCID:` 前缀、PMC 文章链接；裸数字不算 PMCID |
| arXiv | 去版本号：`2401.01234`、`hep-th/9901001` | `arXiv:` 前缀、`abs` / `pdf` 链接 |
| ISBN | 校验通过的 ISBN-13 | ISBN-10 自动转换，连字符 / 空格 |
| Zotero key | 8 位字母数字 | `zotero:` 前缀（在来源字符串中） |
| URL | `https://` + 去 `www.` 的小写主机 + 路径（去末尾 `/`）+ 排序后的查询参数 | 去掉片段、默认端口、`utm_*` / `fbclid` / `gclid` 等跟踪参数；拒绝非 http(s) 与带用户名密码的 URL |

- `identityKeys` 按可信度排序：`doi:` > `pmid:` > `pmcid:` > `arxiv:` > `isbn:` > `zotero:` > `url:` > `title:<type>:<规范化标题>`；
  `sameIdentity` 任一键相同即视为同一对象。
- `contentHash`：去掉 frontmatter、统一 LF、去掉行尾空白与首尾空行、NFC 规范化后取 sha256。
- `claimHash`：主语 | 谓词 | 取值 | 物种 | 组织 | 阶段 | 方法（小写、空白折叠）+ 来源哈希，取 sha256。

## 6. 项目身份与运行结果布局（I2 / I6）

- 规范项目 ID：由当前工作区目录决定（`.pi/research-workspace.json` 的 `knowledgeProjectId`，缺省为 `<目录名>-<sha10>`）。
  `research_loop`、`research_deposit_knowledge`、`research_summarize_run`、知识检索使用同一个解析器，不再回落到 `research-workbench`。
  日常空间（`~/.drone/daily`）允许按会话选择项目。旧 `Projects/research-workbench/` 笔记不移动，迁移说明见 I2 PR。
- Vault 中运行结果的落点：`Projects/<p>/Runs/<YYYY-MM-DD>-<topic>-<runid8>.md` 中心笔记（`class: run-result`，含 `## Result files`
  的相对路径、purpose、sha256，与 `## Knowledge produced`），重要交付物可有 `Projects/<p>/Artifacts/<slug>.md` 指针笔记。
- 工作区物理布局 v2（可选、向后兼容、只出迁移计划不自动移动）：`results/<project>/<topic>/run-<stamp>-<uuid8>/{logs,sources,cards,outputs,work}/`。

## 7. 实施进度

| 步骤 | 内容 | 状态 |
|---|---|---|
| I1 | 分类器、frontmatter 模式、标识符规范化（纯函数 + 测试 + 本文档） | 本 PR |
| I2 | 统一项目身份；去掉 `research-workbench` 回落；日常空间按会话选项目；迁移说明 | 单独 PR |
| I3 | 索引读取 frontmatter（schema v2：`class` / `type` / `status` 列），检索按 class 过滤 | 待 #81 合并后 |
| I4 | deposit 按 identity 去重、写完整 frontmatter、覆盖前存历史 | 待 I3 |
| I5 | 自动入库管线（触发点 T1–T8）、质量门、证据卡抽取、审核队列 UI | 待 #79 合并后 |
| I6 | 运行结果按项目呈现、Run 中心笔记增强、deliverable / intermediate 区分、可选布局 v2 | 待 #83 合并后 |
