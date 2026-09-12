import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mkdir,mkdtemp,readFile,realpath,rm,symlink,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerWorkspaceConfig } from '../../../.pi/extensions/workspace-config.mjs';
import { configureObsidian,depositKnowledge } from '../../../.pi/lib/obsidian-workbench.mjs';
import { closeKnowledgeServices } from '../../../.pi/lib/knowledge/service.mjs';
import { normalizeSourceLinks } from '../../../.pi/lib/knowledge/source-links.mjs';
import { assessManualPage,deliveryContract } from '../../../.pi/lib/source-delivery.mjs';
import { beginKnowledgeFlow,flowFor,noteKnowledgeSearch,noteKnowledgeOperation } from '../../../.pi/lib/knowledge/ui-state.mjs';
let root,cwd,vault,runDir;
beforeEach(async()=>{
 root=await realpath(await mkdtemp(join(tmpdir(),'percho-round2-')));cwd=join(root,'actual-project');vault=join(root,'Vault');
 await mkdir(cwd);vi.stubEnv('PERCHO_KNOWLEDGE_DIR',join(root,'app'));vi.stubEnv('PI_RESEARCH_DESKTOP_CONFIG',undefined);
 await configureObsidian({cwd,vault,project:'project-a'});runDir=join(cwd,'results','topic','run-fixture');await mkdir(runDir,{recursive:true});
 await writeFile(join(runDir,'metadata.json'),JSON.stringify({project:'project-a',run_id:'run-fixture',result_slug:'topic',evidence_gate:{stage:'answerable',status:'ok',answerable:true,claim_refs:['fixture']}}));
});
afterEach(async()=>{await closeKnowledgeServices();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
function tools(){const tools=new Map();registerWorkspaceConfig({registerTool:t=>tools.set(t.name,t),registerCommand:()=>{}},{cwd:join(root,'wrong-captured-workspace')});return tools;}
it('run summaries use the session workspace, never the extension/process directory',async()=>{
 const t=tools();const status=await t.get('research_workspace_status').execute('s',{},undefined,undefined,{cwd});
 expect(status.details.resultsRoot).toBe(join(cwd,'results'));
 const result=await t.get('research_summarize_run').execute('summary',{run_dir:runDir,summary_markdown:'# Findings\nFixture observations only.'},undefined,undefined,{cwd});
 expect(await readFile(result.details.run,'utf8')).toContain('Fixture observations');
 expect(await readFile(result.details.obsidian_note,'utf8')).toContain('Fixture observations');
});
it('correct workspace does not permit a run directory symlink outside results',async()=>{
 const other=join(root,'external');await mkdir(other);const link=join(cwd,'results','topic','run-outside');await symlink(other,link);
 await expect(tools().get('research_summarize_run').execute('summary',{run_dir:link,summary_markdown:'No'},undefined,undefined,{cwd})).rejects.toThrow('escapes');
});
it('sources become actual file, DOI and Vault hyperlinks without linking an unsafe path',async()=>{
 await writeFile(join(runDir,'source with spaces.txt'),'Fixture');await writeFile(join(vault,'Library/Papers/source.md'),'# Fixture');
 const result=await normalizeSourceLinks(['results/topic/run-fixture/source with spaces.txt','10.1093/example','Library/Papers/source','/etc/passwd','fixture:unresolved'],{cwd,vault,resultsRoot:join(cwd,'results'),project:'project-a'});
 expect(result.links[0]).toContain('file:///');expect(result.links[0]).toContain('source%20with%20spaces.txt');
 expect(result.links[1]).toContain('https://doi.org/10.1093/example');expect(result.links[2]).toBe('[[Library/Papers/source]]');
 expect(result.unresolved).toEqual(['/etc/passwd','fixture:unresolved']);expect(result.links[3]).not.toContain('file:');
});
it('new non-Wiki deposits contain clickable existing local sources',async()=>{
 await writeFile(join(runDir,'manual.txt'),'fixture command reference');
 const result=await depositKnowledge({cwd,project:'project-a',type:'software',title:'Fixture CLI guide',markdown:'## Commands\nExample only.',sourceLinks:['results/topic/run-fixture/manual.txt']});
 expect(await readFile(result.note,'utf8')).toContain('](<file:');expect(result.unresolvedSources).toEqual([]);
});
it('credential URLs and cross-project private note references cannot become links',async()=>{
 const options={cwd,vault,resultsRoot:join(cwd,'results'),project:'project-a'};
 await expect(normalizeSourceLinks(['https://user:password@example.invalid'],options)).rejects.toThrow('credential-free');
 await expect(normalizeSourceLinks(['Projects/other/Evidence/note'],options)).rejects.toThrow('scope');
});
it('manual TOC is identified as incomplete and points to bounded same-site reference chapters',()=>{
 const page='<h1>Manual</h1><a href="options.html">Options</a><a href="install.html">Installation</a><a href="https://evil.invalid/commands">Commands</a><a href="javascript:alert(1)">Manual</a>';
 const value=assessManualPage(Buffer.from(page),'text/html','https://example.invalid/manual/');
 expect(value.status).toBe('landing-or-overview-page');expect(value.complete).toBe(false);expect(value.candidates).toHaveLength(2);
 expect(value.candidates[0].url).toBe('https://example.invalid/manual/options.html');
});
it('even a dense reference page is never automatically declared a complete manual',()=>{
 const value=assessManualPage(Buffer.from('<p> --input --output --threads --mode --version --help </p>'),'text/html','https://example.invalid/options');
 expect(value.status).toBe('reference-page-only');expect(value.complete).toBe(false);
});
it('software and paper requests have explicit deliverables and no invented benchmarks',()=>{
 const mixed=deliveryContract('下载几篇DNA序列比对的方法的论文和软件说明书沉淀到知识库',{showMeAvailable:true});
 expect(mixed.kind).toBe('mixed');expect(mixed.guidance).toContain('version-matched');expect(mixed.guidance).toContain('not tested');expect(mixed.guidance).toContain('show-me');
 const paper=deliveryContract('介绍一下这篇论文');expect(paper.kind).toBe('research');expect(paper.guidance).toContain('main claims');expect(paper.guidance).toContain('not loaded');
 expect(deliveryContract('你好')).toBeNull();
});
it('findings and artifact events show bounded facts, never raw assistant/protocol data',()=>{
 const ctx={sessionId:'round2-visible'};beginKnowledgeFlow(ctx,{vaultId:'v',revision:1,vault});
 noteKnowledgeSearch(ctx,{query:'fixture',hits:[{path:'Library/Papers/source.md',title:'Found paper',text:'Actual source excerpt '+'x'.repeat(2000),hash:'a',startLine:1,endLine:2}],complete:true,coverage:'ready',revision:2});
 expect(flowFor(ctx.sessionId).search.previews[0].excerpt.length).toBeLessThanOrEqual(320);
 noteKnowledgeOperation(ctx,{toolName:'research_archive_source',toolCallId:'download',result:{details:{status:'downloaded',path:join(runDir,'paper.pdf'),metadata:{title:'Downloaded paper'},knowledge_status:'written',hiddenThinking:'NO_EXPOSE'}}});
 expect(flowFor(ctx.sessionId).artifacts[0].title).toBe('Downloaded paper');expect(JSON.stringify(flowFor(ctx.sessionId))).not.toContain('NO_EXPOSE');
});

it('a Vault write failure does not erase the fact that the local summary was saved',async()=>{
 // Deliberately use a traversal project identifier; no external files are touched.
 const result=await tools().get('research_summarize_run').execute('summary',{run_dir:runDir,project:'../escape',summary_markdown:'# Saved local summary'},undefined,undefined,{cwd});
 expect(result.details.summary_saved).toBe(true);expect(result.details.partial).toBe(true);
 expect(result.details.obsidian_note).toBeNull();expect(result.details.obsidian_error).toBeTruthy();
 expect(await readFile(result.details.run,'utf8')).toContain('Saved local summary');
});
