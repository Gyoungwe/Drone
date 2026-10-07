# 知识项目身份（I2）与迁移说明

## 规则

同一个工作区只有一个知识项目身份。`research_loop`（开始运行）、`research_deposit_knowledge`、`research_summarize_run`、
来源归档、讲解归档、Wiki 提议、知识检索范围与 WikiSkill 都通过同一个解析器
`@drone/knowledge/project-identity` 得到项目 slug：

1. **日常空间**（`~/.drone/daily`）：本会话用 `/project <名称>`（别名 `/项目`）选择的项目。选择记录在会话里
   （会话条目 `drone-session-project-v1`），只影响这个会话；`/project clear` 恢复默认。日常空间目录本身不写任何配置文件
   （保持"无 `.pi/` 即自动信任"）。
2. 工作区 `.pi/research-workspace.json` 的 `knowledgeProjectId`。
3. 由工作区目录派生的稳定 ID：`<目录名>-<sha10>`（算法未变）。

不再有任何 `research-workbench` 或 `default` 回落值。模型在工具参数里传入的 `project` 只是"请求"：与解析结果不同则被忽略，
工具结果里的 `project` / `project_resolution` 字段会说明实际使用的项目和原因。`/project`（不带参数）显示当前项目及其来源；
在普通工作区里 `/project <名称>` 不会改项目，只提示去 `.pi/research-workspace.json` 设置 `knowledgeProjectId`。

运行级操作（运行总结、来源归档、WikiSkill 经验记录）优先使用运行开始时写进 `metadata.json` 的 `project`；
旧版本缺省写入的 `research-workbench`、缺失或非法值视为"未指定"，改用当前解析结果。

## 对已有数据的影响

**不移动、不改写任何已有文件。**

- 旧版本里模型没有显式传 `project` 时，研究运行与沉淀会写到 Vault 的 `Projects/research-workbench/`。
  但知识检索的范围一直是 `shared` + 当前工作区项目（`<目录名>-<sha10>` 或 `knowledgeProjectId`），
  所以这些项目级笔记在旧版本里本来就检索不到；本次修改不会让任何原本可见的笔记变得不可见。
- `Library/`、`Wiki/` 等共享笔记不受影响。
- 旧运行（`metadata.project = "research-workbench"`）再次总结时，Run 笔记会写到当前项目下；旧的 Run 笔记保留在原处。
- WikiSkill 的演化记录位于 `<results>/.wikiskill/<project>/`；旧记录在 `.wikiskill/research-workbench/`，不会被移动。

## 可选：继续使用 `research-workbench`

如果某个工作区希望继续把 `Projects/research-workbench/` 当作自己的项目（让旧笔记重新进入检索范围、新内容也写到那里），
在该工作区的 `.pi/research-workspace.json` 中设置：

```json
{ "knowledgeProjectId": "research-workbench" }
```

日常空间可以在会话里执行 `/project research-workbench` 达到同样效果（只影响该会话）。

## 可选：手动合并到新项目

如果希望把旧笔记归入当前工作区的项目，在 Obsidian 中把 `Projects/research-workbench/<类型>/` 下需要的笔记移到
`Projects/<当前项目>/<类型>/`（Obsidian 会自动更新双链）。Drone 不会自动做这一步；索引会在下次扫描时跟上。
用 `/project` 可以查看当前项目的 slug。
