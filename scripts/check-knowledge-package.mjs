// Offline resource/runtime smoke; run with Node or ELECTRON_RUN_AS_NODE=1 Electron.
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
const root=await realpath(await mkdtemp(join(tmpdir(),'percho-knowledge-package-')));
let serviceModule;
try {
  const config=parse(await readFile('packages/desktop/electron-builder.yml','utf8'));
  for(const item of config.extraResources.filter(item=>item.to.startsWith('research-workbench/'))){
    await cp(resolve('packages/desktop',item.from),join(root,item.to),{recursive:true});
  }
  const resources=join(root,'research-workbench'),a=join(root,'A'),b=join(root,'B'),agentDir=join(root,'agent');
  await Promise.all([mkdir(a),mkdir(b),mkdir(agentDir)]);
  process.env.PERCHO_KNOWLEDGE_DIR=join(root,'app');process.env.PERCHO_RESEARCH_WORKBENCH_ROOT=resources;
  delete process.env.PI_RESEARCH_DESKTOP_CONFIG;
  const workbench=await import(pathToFileURL(join(resources,'lib/obsidian-workbench.mjs')));
  serviceModule=await import(pathToFileURL(join(resources,'lib/knowledge/service.mjs')));
  const binding=await workbench.configureObsidian({cwd:a,vault:join(root,'Vault')});
  await writeFile(join(binding.vault,'Library/Papers/fixture.md'),'# Fixture\npackagedmarker 自切\n');
  const loader=new DefaultResourceLoader({cwd:b,agentDir,settingsManager:SettingsManager.create(b,agentDir),
    additionalExtensionPaths:[join(resources,'extensions/obsidian-workbench.mjs')],
    additionalSkillPaths:[join(resources,'skills/research-vault/SKILL.md')]});
  await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);
  assert(loader.getExtensions().extensions.some(extension=>extension.commands.has('obsidian-setup')));
  assert.equal(loader.getSkills().skills.filter(skill=>skill.name==='research-vault').length,1);
  const child=await import(pathToFileURL(join(resources,'extensions/subagent-mcp-readonly.mjs')));
  const tools=[];await child.makeSubagentReadonlyMcp(b)({registerTool:tool=>tools.push(tool.name),on:()=>{}});
  assert(tools.includes('research_search_knowledge'));assert(!tools.includes('research_maintain_knowledge'));
  const service=await serviceModule.getKnowledgeService();
  const prepared=await service.prepare({cwd:b,project:'project-b',query:'packagedmarker'});
  await service.request('reconcile');
  const result=await service.search(prepared.ticket,b,{query:'packagedmarker'});
  assert(result.hits.some(hit=>hit.path==='Library/Papers/fixture.md'));assert.equal(result.complete,true);
  console.log(JSON.stringify({passed:true,node:process.version,electron:process.versions.electron||null,
    packagedResources:true,unrelatedProject:true,sqliteWorker:true,readonlyChild:true,rawMcpConnected:false}));
} finally {await serviceModule?.closeKnowledgeServices();await rm(root,{recursive:true,force:true});}
