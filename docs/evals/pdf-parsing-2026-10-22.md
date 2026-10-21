# PDF 解析质量评估（2026-10-22）

本次评估使用 fixtures/pdf-hard/manifest.json 中的 10 篇开放获取论文，覆盖双栏、公式密集、跨页表格和扫描版派生样本。可重跑命令：node scripts/eval-pdf-parsing.mjs。

- 当前默认的 pdf.js 成功解析 10/10 篇，正文字符召回均值 80.0%。表格、公式和参考文献指标见同目录 JSON。
- MinerU: 10/10 unavailable; GROBID: 10/10 unavailable。本轮未安装、未集成、未把 MinerU 或 GROBID 作为默认后端。
- 扫描版样本的 pdf.js 文本召回用于暴露 OCR 缺口；OCR 质量和表格结构仍需人工抽样复核，不能把启发式分数当作论文事实。

## 下一轮决策

只有在补充人工逐页参考文本、固定 MinerU/GROBID 版本和受控资源预算后，才适合决定是否引入可选后端。若引入，优先保持本地可选服务或明确的 API 适配层，避免把大型模型/Java 服务塞进默认安装包；本轮不改变安装包和默认流程。
