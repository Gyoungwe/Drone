import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage as reply, fauxToolCall as call } from '@earendil-works/pi-ai';
import { makeKnowledgeSpecialistBridge } from '../src/knowledge/specialist-bridge';
import { configureObsidian } from '../../../.pi/lib/obsidian-workbench.mjs';
import { closeKnowledgeServices, getKnowledgeService } from '../../../.pi/lib/knowledge/service.mjs';
import { listWikiProposals } from '../../../.pi/lib/knowledge/wiki-review.mjs';
import { flowFor } from '../../../.pi/lib/knowledge/ui-state.mjs';
let root,session;
afterEach(async()=>{session?.dispose();session=undefined;await closeKnowledgeServices();vi.restoreAllMocks();vi.unstubAllEnvs();if(root)await rm(root,{recursive:true,force:true});});
const tool=(name,args)=>reply([call(name,args)],{stopReason:'toolUse'});
it('real SDK dispatches four isolated roles by stage; parent still reads evidence and final answer is visible',async()=>{
 root=await realpath(await mkdtemp(join(tmpdir(),'percho-specialists-sdk-')));
 const cwd=join(root,'project'),vault=join(root,'Vault'),agentDir=join(root,'agent');await mkdir(cwd);await mkdir(agentDir);
 vi.stubEnv('PERCHO_KNOWLEDGE_DIR',join(root,'app'));vi.stubEnv('PI_CODING_AGENT_DIR',agentDir);vi.stubEnv('PI_RESEARCH_DESKTOP_CONFIG',undefined);vi.stubEnv('PI_SUBAGENT_CHILD',undefined);
 await configureObsidian({cwd,vault,project:'project-a'});
 const write=async(path,text)=>{await mkdir(join(vault,path,'..'),{recursive:true});await writeFile(join(vault,path),text);};
 const source='Library/Papers/a.md',second='Library/Papers/b.md';
 await write('Wiki/Index.md','# Wiki\n[[Wiki/topic]]\n');await write('Wiki/topic.md','# Topic\n[[Library/Papers/a]]\n');
 await write(source,'# Evidence A\nAuthor observation under limited experimental conditions.');await write(second,'# Evidence B\nAlternative method; not directly comparable.');
 const service=await getKnowledgeService();await service.request('reconcile');
 const run=join(cwd,'results/topic/run-fixture');await mkdir(run,{recursive:true});
 await writeFile(join(run,'metadata.json'),JSON.stringify({run_id:'run-fixture',project:'project-a',result_slug:'topic',topic_id:'topic',evidence_gate:{stage:'answerable',status:'ok',answerable:true,claim_refs:['fixture:conditional-claim']}}));
 const skill=join(root,'show-me/SKILL.md');await mkdir(join(root,'show-me'));await writeFile(skill,'---\nname: show-me\ndescription: Fixture presentation skill\n---\n# Show Me\nUse static HTML and source links; disclose uncertainty.\n');
 // These ambient files must never enter specialist requests.
 await writeFile(join(cwd,'AGENTS.md'),'AMBIENT_PROJECT_SECRET');
 const settingsManager=SettingsManager.create(cwd,agentDir,{projectTrusted:true});
 const runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:null,modelsStorePath:join(agentDir,'cache.json'),allowModelNetwork:false,refreshOnCreate:false});
 const faux=fauxProvider({provider:'specialist-fixture'});runtime.registerNativeProvider(faux.provider);vi.spyOn(runtime,'hasConfiguredAuth').mockReturnValue(true);
 const loader=new DefaultResourceLoader({cwd,agentDir,settingsManager,noExtensions:true,
  additionalExtensionPaths:[resolve('../../.pi/extensions/obsidian-workbench.mjs'),resolve('../../.pi/extensions/workspace-config.mjs')],
  additionalSkillPaths:[skill],extensionFactories:[makeKnowledgeSpecialistBridge({getRuntime:async()=>runtime,getModelPreference:async()=>undefined})]});
 await loader.reload();expect(loader.getExtensions().errors).toEqual([]);
 ({session}=await createAgentSession({cwd,agentDir,modelRuntime:runtime,model:faux.getModel(),resourceLoader:loader,settingsManager,sessionManager:SessionManager.inMemory(cwd)}));
 const errors=[];await session.bindExtensions({onError:e=>errors.push(e)});
 const counts={},childRequests=[],parentRequests=[];
 const long='The studies investigate different designs. Findings require the original sources, version checks, and explicit scope. The current notes do not establish a universal performance ordering. '.repeat(2);
 const router=async(context)=>{
  const role=context.systemPrompt?.match(/^You are knowledge-(navigator|evidence-curator|wiki-editor|explainer),/)?.[1];
  const n=counts[role||'parent']||0;counts[role||'parent']=n+1;
  if(role){
   childRequests.push(JSON.parse(JSON.stringify(context)));
   expect(JSON.stringify(context)).not.toContain('AMBIENT_PROJECT_SECRET');expect(JSON.stringify(context)).not.toContain('PARENT_HISTORY_SECRET');
   const submitted={summary:'Unverified, source-scoped handoff.',source_paths:[source,second],cautions:['Underlying original papers still require verification.']};
   if(role==='navigator')return [tool('knowledge_read',{path:'Wiki/topic.md'}),tool('knowledge_search',{query:'Evidence'}),reply([call('knowledge_read',{path:source}),call('knowledge_read',{path:second})],{stopReason:'toolUse'}),tool('knowledge_submit',submitted)][n];
   if(role==='wiki-editor')return tool('knowledge_submit',{...submitted,title:'Topic',markdown:'## Current understanding\n'+long});
   if(role==='explainer')return tool('knowledge_submit',{...submitted,title:'Evidence comparison',html:'<!doctype html><html><body><h1>Comparison</h1><details><summary>Methods</summary>Different methods; not locally tested.</details></body></html>'});
   return tool('knowledge_submit',submitted);
  }
  parentRequests.push(JSON.parse(JSON.stringify(context)));
  if(n===4){
   // File watcher debounce is real; only fixtures skip provider latency. Wait for queued writes, not a weaker publication rule.
   await new Promise(resolve=>setTimeout(resolve,220));
   await vi.waitFor(async()=>expect((await service.request("status")).pendingChanges).toBe(0));
  }
  return [tool('research_read_knowledge',{path:'Wiki/topic.md'}),tool('research_search_knowledge',{query:'Evidence'}),
   reply([call('research_read_knowledge',{path:source}),call('research_read_knowledge',{path:second})],{stopReason:'toolUse'}),
   tool('research_summarize_run',{run_dir:run,result_slug:'topic',summary_markdown:'# Evidence comparison\n\n'+long}),
   tool('research_search_knowledge',{query:'Evidence'}),reply('Checked final reply with bounded sources. [[Library/Papers/a]] [[Library/Papers/b]]')][n];
 };
 faux.setResponses(Array.from({length:20},()=>router));
 session.agent.state.messages=[{role:'user',content:[{type:'text',text:'PARENT_HISTORY_SECRET'}],timestamp:1}];
 await session.prompt('比较并介绍这两篇论文，使用 Show Me 讲解，然后保存研究摘要。',{expandPromptTemplates:false});
 expect(errors).toEqual([]);
 expect(Object.keys(counts).sort()).toEqual(['evidence-curator','explainer','navigator','parent','wiki-editor']);
 expect(counts.navigator).toBe(4);expect(counts['evidence-curator']).toBe(1);expect(counts.explainer).toBe(1);expect(counts['wiki-editor']).toBe(1);
 expect(JSON.stringify(parentRequests[0])).toContain('Unverified specialist handoff');
 expect(JSON.stringify(parentRequests[0])).not.toContain('knowledge_submit');
 expect(JSON.stringify(parentRequests)).not.toContain('<!doctype html>');
 const final=session.messages.filter(m=>m.role==='assistant').at(-1);
 expect(final.knowledgePublication.status).toBe('released');expect(JSON.stringify(final)).toContain('Checked final reply');expect(JSON.stringify(final)).toContain('待审核');
 const proposals=await listWikiProposals(service,'project-a');expect(proposals.items).toHaveLength(1);
 expect(await readFile(join(vault,'Library/Explainers/topic.md'),'utf8')).toContain('展示层');
 const rows=flowFor(session.sessionId).specialists;expect(rows).toHaveLength(4);expect(rows.every(r=>r.status==='completed')).toBe(true);
 expect(JSON.stringify(rows)).not.toContain('PARENT_HISTORY_SECRET');
},20000);
