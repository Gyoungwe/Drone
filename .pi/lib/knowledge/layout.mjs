import { mkdir } from 'node:fs/promises';
import { containedFile, createOnly } from '../vault-layout.mjs';
import { updateNavigation } from './maintenance.mjs';
export async function initializeSharedNavigation(vault) {
  for(const directory of ['Wiki','Inbox']) await mkdir(await containedFile(vault,directory),{recursive:true});
  await createOnly(await containedFile(vault,'Wiki/Index.md'),
    '# Research Wiki\n\n这里维护跨项目的主题地图。先阅读相关主题，再沿来源查证；不要把目录未命中当成没有知识。\n\n<!-- pi-agent:managed:start -->\n<!-- pi-agent:managed:end -->\n\n## Human review\n');
  await createOnly(await containedFile(vault,'Inbox/Index.md'),
    '# Inbox\n\n待整理、待核验的输入。这里的内容不是已确认结论。\n\n## Human review\n');
  await updateNavigation(vault,'Home.md','# Research Vault',
    '- [[Wiki/Index]] — 共享主题与阅读路线\n- [[Library/Index]] — 文献、方法与可复用知识\n- [[Projects/Index]] — 项目背景与证据链\n- [[Inbox/Index]] — 待整理资料\n\nWiki 是导航与综合认识，不代替原始证据。人工复核与冲突状态必须一起阅读。');
}
export async function initializeProjectContext(vault,project) {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project))throw new Error('Invalid project identifier');
  await createOnly(await containedFile(vault,`Projects/${project}/Context.md`),
    `---\ntype: project-context\nproject: ${JSON.stringify(project)}\n---\n\n# ${project}\n\n## 研究目标\n尚待用户确认。\n\n## 适用范围与限制\n尚待确认。\n\n## 既有决策\n参见本项目的 Decisions 与 Runs。\n\n## Human review\n`);
}
