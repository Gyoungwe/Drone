# 知识库网络图 UI 设计（参考 Karpathy LLM Wiki）

> 2026-10-21 · Claude 调研整理。目标：让网络图成为“维护知识库的工具”，而不只是装饰。

## 1. Karpathy 方案里和网络图有关的部分
Karpathy 的 LLM Wiki 主张：Vault 是事实来源，LLM 只是处理层；`raw/` 放原始资料，`wiki/` 放 LLM 编写的概念页和实体页，根目录下有 `index.md`（目录）和 `log.md`（只追加的操作日志）。三类操作：
- **Ingest**：一份资料会更新 10–15 个相关页面，并写入 index 和 log。
- **Query**：先读 index，再沿 `[[链接]]` 回答，有价值的回答可以沉淀成新页面。
- **Lint**：定期体检，查**孤立页**（没有入链）、**被引用但还没建的概念**、**相互矛盾**、**过时说法**。
他用 Obsidian 的图谱视图看主题簇、中心概念、孤立概念和空白。

**对 Drone 的启示**：网络图最有价值的用途是把 Lint 的结果画出来，告诉用户下一步该补什么、该复核什么。Drone 已经有对应的数据：维护任务（Wiki 需要复读、待纳入总结的证据）、孤立数、可能重复、审阅队列。

## 2. 设计方案
1. **两层结构（raw / wiki）**：Wiki 综合页和概念页作为大节点放在中间；Library 文献和来源作为小节点挂在外圈。提供“只看 Wiki / 显示来源”切换，默认只看 Wiki，这样 60 篇文献不会把图淹没。
2. **大小按被引用数**：节点大小用入链数（被多少页引用）而不是总链接数，中心概念一眼可见。
3. **颜色按主题簇**：用 Louvain 社区检测自动分簇，簇名取 `index.md` 中的分节或簇里入链最多的页面标题；类型（文献/方法/软件/想法）改用节点形状或描边区分，避免两套颜色打架。
4. **体检图层（核心）**——可以单独打开的叠加层：
   - 孤立页：灰色虚线圈，悬停时提供“交给对话处理：为它补链接”。
   - 缺失概念：被 `[[链接]]` 引用但还没有页面的，画成虚线“幽灵节点”，点击即可“创建该页”（走审阅队列）。
   - 待复核 / 过时：琥珀色描边（frontmatter `status: unverified`，或来源哈希已变化）。
   - 矛盾：两页之间画红色边（来自 lint 结果）。
   - 右侧面板列出体检清单，点一条就在图上定位。
5. **局部图（1–2 跳）**：选中节点后默认只显示它的 1–2 跳邻居，全图作为“全局”视图。对应 Obsidian 的 local graph，解决“挤成一团”的问题。
6. **时间轴（log.md）**：底部时间滑块，按 log 回放知识库的增长；和现有的“实时更新”共用增量布局（已有节点不动，新节点用绿色脉冲出现）。
7. **标签策略**：常驻标签只给每个簇里入链最多的 1–2 个节点，加上被选中节点和它的邻居；其余节点在缩放到一定程度后才显示。

## 3. 开源实现选型
| 方案 | 渲染 | 适用规模 | 评价 |
|---|---|---|---|
| **sigma.js v3 + graphology**（MIT） | WebGL | 约 10 万节点以内 | **推荐**。graphology 自带 ForceAtlas2（可放进 Web Worker）、Louvain 社区检测、最短路径；sigma 的 reducer 机制很适合做高亮、淡化、体检图层，标签渲染和碰撞处理成熟 |
| react-force-graph / force-graph（vasturiano，MIT） | Canvas / WebGL，d3-force | 几千节点 | 上手快、有 2D/3D 两种；标签和大图性能比 sigma 弱 |
| cosmos.gl（MIT，OpenJS 基金会） | GPU 力导向 | 百万节点 | 适合超大图；对 Drone 的规模（几百到几千篇笔记）属于过度设计，标签能力弱 |
| Obsidian 插件参考：obsidian-cosmograph（Three.js 3D）、Graph Insight、Fast Graph | — | — | 交互可以借鉴（按文件夹分簇、1–3 跳聚焦、搜索过滤），不建议引入 3D |

**建议路线**：把现有 SVG 渲染（`KnowledgeGraph.tsx`）换成 sigma.js + graphology：ForceAtlas2 在 Worker 里跑，替代 worker 侧的扇区布局（这是“挤成一团”的根本原因）。保留现有的增量刷新协议（`mergeIncrementalLayout`）、配色和实时更新、暂停逻辑。

## 4. 分阶段
- **G1**：sigma + graphology 替换渲染，ForceAtlas2 加 Louvain 分簇，局部图 / 全局图切换，入链大小。验收：88 篇笔记的 Vault 不重叠，簇清晰可见。
- **G2**：体检图层（孤立、缺失、待复核），以及点击后“交给对话处理 / 创建该页”。数据来自现有的 jobs、index、wiki-review。
- **G3**：raw/wiki 两层、时间轴回放。

## 参考
- Karpathy LLM Wiki 介绍与解读：MindStudio（mindstudio.ai/blog/andrej-karpathy-llm-wiki-obsidian-ai-second-brain）、Starmorph 指南（blog.starmorph.com/blog/karpathy-llm-wiki-knowledge-base-guide）、GitHub topic `karpathy-llm-wiki`
- cosmos.gl：github.com/cosmosgl/graph；obsidian-cosmograph：github.com/n1ghtmare-dev/obsidian-cosmograph
- sigma.js：sigmajs.org；graphology：graphology.github.io

## 实现状态（2026-10-20）
- G1 已实现（无新依赖，仍用 SVG）：客户端聚类力导布局取代 worker 扇区布局；按主题聚类着色（优先用 worker 的 Louvain community，没有时用确定性标签传播），类型改用形状表示（○ 来源 / □ Wiki·概念 / ◇ 主张·证据），可切回按类型着色；节点大小按被引用数（入度）；全局 / 局部（1–2 跳）切换，局部视图以选中节点为中心重新布局；每个主题簇标注一个代表节点。代码在 `graph-model.ts`，测试 7 条。
- G2 已实现：健康检查层，标出孤立笔记、未被引用的 Wiki、worker 标记的提示节点；侧栏列表点击可定位，节点详情里可以"交给对话处理"。
- G3 未做：时间轴（log.md）、sigma.js/WebGL 大图渲染。
