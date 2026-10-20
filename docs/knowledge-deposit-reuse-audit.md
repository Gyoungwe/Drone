# 知识沉淀与复用审计（2026-10-20）

## 沉淀：知识怎么写进库
| 入口 | 触发 | 写到哪里 | 审阅 |
|---|---|---|---|
| `research_archive_source` | 模型归档一篇文献/网页 | `Library/Papers/…` 来源笔记 | 直接写入 |
| `research_summarize_run` | 一次研究任务结束 | `Runs/…` 运行摘要 + 主题记忆（topic memory）+ 自动生成 Wiki 候选 | 新页/agent 页直接写，人工改过的页进 Wiki 审阅队列 |
| `research_propose_wiki_update` | 模型显式提议 | `Wiki/…` 托管块 | 同上 |
| `research_update_topic` / `archive_topic` | 研究主题推进 | `Projects/<项目>/…` | 直接写入 |
| `research_archive_explainer` | Show Me 讲解归档 | `Explainers/…` | 展示层，不作为证据 |
| 维护页"交给对话处理" | 用户手动 | 生成预填草稿，修改走审阅队列 | 人工确认 |

近 40 个会话的工具调用统计：read 60、search 36、prepare 18、deposit 12、archive_source 9、summarize_run 6。也就是读得多、写得少，主要的写入路径是 summarize_run。

## 复用：知识怎么被读回来
1. **轮次开始时**（`message_start` / `beforeStart`）：命中研究类关键词（研究、文献、方法、怎么用、wiki…）才会执行 `prepare()`。它读取 Home、Wiki/Index、项目 Context/Index，再按问题做一次 wikiOnly 搜索，生成导航上下文和发布门禁 ticket。
2. **模型主动调用**：任何 `research_*` 工具都会把本轮"升级"为知识轮次（`promoteKnowledgeTurn`）。
3. **对话检索**：`research_search_knowledge`（词法 + 可选语义 + 图扩展）→ `research_read_knowledge`（带哈希收据）→ 发布门禁核对引用。

## 发现的问题与处理
| # | 问题 | 处理 |
|---|---|---|
| 1 | **关键词门槛漏掉普通领域问题**：例如"LoRA 的秩怎么选""SpCas9 的 PAM 在哪侧"不含研究关键词，不会预取本地知识，只能指望模型自己想起来调工具（会话记录里确实有几次是模型补调的）。 | 已修：新增 `probeTopic`（`knowledge/src/topic-probe.ts`）。问题里**字面提到**某个 Wiki 页标题（整题或 ≥4 字符的特征词，带停用词表）时，本轮自动按知识轮次处理。600ms 超时，失败时按普通聊天处理，不会给闲聊注入隐藏上下文。测试 3 条。 |
| 2 | **"同类问题由本地回答"一直显示 —**：统计只存在进程内存里，应用每次重启就清零，且扩展和后端是两份模块副本。 | 已修：写入 `DRONE_KNOWLEDGE_DIR/answer-metrics.json`（应用状态目录，不写 Vault），原子写入，读取时取 total 较大的一份。 |
| 3 | **写进去却没人链接的知识**：孤立笔记、没被任何页面引用的 Wiki 页，检索很难命中，等于沉淀了但复用不到。 | 已在知识网络加"健康检查"层，逐条列出，可一键"交给对话处理"（生成预填草稿，不自动发送，修改走审阅队列）。 |
| 4 | 托管块重复标题（上一轮已修）：`stripManagedHeader` 防止重复写入，并清理了 6 篇存量笔记（有备份）。 | 已修 |
| 5 | 可改进，未做：summarize_run 是唯一自动写 Wiki 的路径。纯问答轮次（读了 3 篇笔记就给出答案）不会把答案沉淀回去。 | 建议后续：在已发布、有读取收据的问答轮次结尾，提示"保存为 Wiki 候选"按钮，不默认自动写入。 |
