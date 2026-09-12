import { stageWikiProposal, mergeWikiProposal, previewWikiProposal, listWikiProposals, decideWikiProposal } from '../../../.pi/lib/knowledge/wiki-review.mjs';
import { registerKnowledgeInterface } from '../../../.pi/lib/knowledge/extension.mjs';
import { buildResearchWikiPage } from '../../../.pi/lib/research-wikiloop.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureObsidian } from '../../../.pi/lib/obsidian-workbench.mjs';
import { closeKnowledgeServices, getKnowledgeService } from '../../../.pi/lib/knowledge/service.mjs';

let root, cwd, vault, service, prep;
async function note(path, body) { await mkdir(join(vault,path,'..'),{recursive:true}); await writeFile(join(vault,path),body); }
beforeEach(async()=>{
 root=await realpath(await mkdtemp(join(tmpdir(),'percho-peer-memory-'))); cwd=join(root,'project'); vault=join(root,'Vault');
 await mkdir(cwd); vi.stubEnv('PERCHO_KNOWLEDGE_DIR',join(root,'app'));
 vi.stubEnv('PI_RESEARCH_DESKTOP_CONFIG',undefined);vi.stubEnv('PI_SUBAGENT_CHILD',undefined);
 await configureObsidian({cwd,vault,project:'project-a'});
 await note('Wiki/Index.md','# Topics\n[[Wiki/Autotomy]]\n');
 await note('Wiki/Autotomy.md','# Autotomy\nObserved conditions differ.\n[[Library/Papers/source]]\n');
 await note('Wiki/Unrelated.md','# Another topic\nUnrelated content.\n');
 await note('Library/Papers/source.md','# Source\nObservation under defined conditions.\n');
 service=await getKnowledgeService(); prep=await service.prepare({cwd,project:'project-a',query:'Autotomy'});
 await service.request('reconcile');
});
afterEach(async()=>{await closeKnowledgeServices();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});

describe('actual current Wiki reads, not checkbox memory',()=>{
 it('an unrelated page cannot unlock linked-Wiki evidence search',async()=>{
  await service.read(prep.ticket,cwd,{path:'Wiki/Unrelated.md'});
  await expect(service.search(prep.ticket,cwd,{query:'Source'})).rejects.toThrow('Wiki');
 });
 it('an out-of-range empty read cannot unlock evidence search',async()=>{
  await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md',startLine:999});
  await expect(service.search(prep.ticket,cwd,{query:'Source'})).rejects.toThrow('Wiki');
 });
 it('a changed Wiki requires a new read even when its navigation link did not change',async()=>{
  await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md'});
  await note('Wiki/Autotomy.md','# Autotomy\nNew contradictory evidence requires review.\n');
  await expect(service.search(prep.ticket,cwd,{query:'Source'})).rejects.toThrow('Wiki');
  await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md'});
  expect((await service.search(prep.ticket,cwd,{query:'Source'})).hits.length).toBeGreaterThan(0);
 });
 it('discovered Wiki hits must be read before moving to evidence search',async()=>{
  await note('Wiki/Index.md','# Topics\nNo explicit links yet.\n');
  prep=await service.prepare({cwd,project:'project-a',query:'Autotomy'});
  const found=await service.search(prep.ticket,cwd,{query:'Autotomy',wikiOnly:true});
  expect(found.hits.some(hit=>hit.path==='Wiki/Autotomy.md')).toBe(true);
  await expect(service.search(prep.ticket,cwd,{query:'Source'})).rejects.toThrow('Wiki');
 });
});

const input=()=>({path:'Wiki/Autotomy.md',title:'Autotomy',markdown:'New supported interpretation; limits remain explicit.',
 rationale:'Incorporate the newly read source without changing human review.',source_paths:['Library/Papers/source.md']});
async function candidate(overrides={}) {
 await service.read(prep.ticket,cwd,{path:'Library/Papers/source.md'});
 await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md'});
 return stageWikiProposal(service,prep.ticket,cwd,{...input(),...overrides});
}
describe('versioned, explicitly reviewed Wiki promotion',()=>{
 it('rejects invented or unread source paths',async()=>{
  await expect(stageWikiProposal(service,prep.ticket,cwd,input())).rejects.toThrow('not read');
 });
 it('requires reading the existing target before proposing its replacement',async()=>{
  await service.read(prep.ticket,cwd,{path:'Library/Papers/source.md'});
  await expect(stageWikiProposal(service,prep.ticket,cwd,input())).rejects.toThrow('not read');
 });
 it('accumulates a second research round into the same pending candidate',async()=>{
  const staged=await candidate({markdown:'Round one synthesis.'});
  await note('Library/Papers/source-two.md','# Source two\nSecond-round evidence.\n');
  prep=await service.prepare({cwd,project:'project-a',query:'Autotomy second round'});
  await service.request('reconcile');
  await service.read(prep.ticket,cwd,{path:'Library/Papers/source-two.md'});
  const merged=await mergeWikiProposal(service,prep.ticket,cwd,staged.id,{markdown:'Round two adds another bounded observation.',rationale:'second round',source_paths:['Library/Papers/source-two.md']});
  expect(merged.id).toBe(staged.id);expect(merged.merged).toBe(true);expect(merged.sources).toHaveLength(2);
  const pending=await listWikiProposals(service,'project-a');expect(pending.items).toHaveLength(1);
  const preview=await previewWikiProposal(service,staged.id,'project-a');
  expect(preview.after).toContain('Round one synthesis.');expect(preview.after).toContain('Round two adds another bounded observation.');
  expect(preview.sources.map(s=>s.path).sort()).toEqual(['Library/Papers/source-two.md','Library/Papers/source.md'].sort());
 });
 it('refuses to merge when an earlier source changed',async()=>{
  const staged=await candidate();await note('Library/Papers/source.md','# changed after round one');
  await note('Library/Papers/source-two.md','# Source two\nSecond-round evidence.\n');
  prep=await service.prepare({cwd,project:'project-a',query:'Autotomy second round'});await service.request('reconcile');
  await service.read(prep.ticket,cwd,{path:'Library/Papers/source-two.md'});
  await expect(mergeWikiProposal(service,prep.ticket,cwd,staged.id,{markdown:'Round two.',rationale:'second round',source_paths:['Library/Papers/source-two.md']})).rejects.toThrow('Source changed');
  expect((await listWikiProposals(service,'project-a')).items).toHaveLength(1);
 });
 it('stages outside the Vault; a candidate never appears in normal search',async()=>{
  const before=await readFile(join(vault,'Wiki/Autotomy.md'),'utf8');
  const staged=await candidate({markdown:'uniqueunapprovedcandidate'});
  expect(staged.vaultWritten).toBe(false);expect(staged.scientificallyVerified).toBe(false);
  expect(await readFile(join(vault,'Wiki/Autotomy.md'),'utf8')).toBe(before);
  expect((await service.search(prep.ticket,cwd,{query:'uniqueunapprovedcandidate'})).hits).toEqual([]);
  expect((await listWikiProposals(service,'project-a')).items[0].id).toBe(staged.id);
 });
 it('applies only the exact reviewed preview and retains human text outside the managed block',async()=>{
  const original='# Autotomy\n\nUser paragraph.\n<!-- pi-agent:managed:start -->\nOld summary\n<!-- pi-agent:managed:end -->\n\n## Human review\nKeep my correction.\n';
  await note('Wiki/Autotomy.md',original);
  const staged=await candidate(),preview=await previewWikiProposal(service,staged.id,'project-a');
  expect(preview.before).toBe('Old summary');expect(preview.sources[0].hash).toMatch(/^[a-f0-9]{64}$/);
  const applied=await decideWikiProposal(service,staged.id,'project-a',preview.proposalHash,'apply');
  expect(applied.vaultWritten).toBe(true);expect(applied.indexed).toBe(true);expect(applied.scientificallyVerified).toBe(false);
  const text=await readFile(join(vault,'Wiki/Autotomy.md'),'utf8');
  expect(text).toContain('User paragraph.');expect(text).toContain('Keep my correction.');expect(text).not.toContain('Old summary');
  expect(text).toContain('[[Library/Papers/source]]');
  expect((await listWikiProposals(service,'project-a')).items).toEqual([]);
  expect((await decideWikiProposal(service,staged.id,'project-a',preview.proposalHash,'apply')).alreadyReviewed).toBe(true);
 });
 it('rejects a Wiki changed while the user was reviewing the candidate',async()=>{
  const staged=await candidate();await note('Wiki/Autotomy.md','# Autotomy\nHuman change after preview.\n');
  await expect(decideWikiProposal(service,staged.id,'project-a',staged.proposalHash,'apply')).rejects.toThrow('Wiki changed');
  expect(await readFile(join(vault,'Wiki/Autotomy.md'),'utf8')).toContain('Human change');
 });
 it('rejects a source changed after staging and does not overwrite the target',async()=>{
  const staged=await candidate(),before=await readFile(join(vault,'Wiki/Autotomy.md'),'utf8');
  await note('Library/Papers/source.md','# Source\nA corrected observation contradicts the old one.\n');
  await expect(decideWikiProposal(service,staged.id,'project-a',staged.proposalHash,'apply')).rejects.toThrow('Source changed');
  expect(await readFile(join(vault,'Wiki/Autotomy.md'),'utf8')).toBe(before);
 });
 it('rejects forged preview approvals, wrong-project access and managed marker injection',async()=>{
  const staged=await candidate();
  await expect(decideWikiProposal(service,staged.id,'project-a','invented','apply')).rejects.toThrow('candidate changed');
  await expect(previewWikiProposal(service,staged.id,'project-b')).rejects.toThrow('different project');
  await expect(candidate({markdown:'<!-- pi-agent:managed:end --> injected'})).rejects.toThrow('managed markers');
 });
 it('rejects new cross-project and navigation targets',async()=>{
  await expect(candidate({path:'Projects/project-b/Wiki/topic.md'})).rejects.toThrow('current-project');
  await expect(candidate({path:'Wiki/Index.md'})).rejects.toThrow('navigation');
 });
 it('rejecting a candidate never writes a Wiki',async()=>{
  const staged=await candidate(),before=await readFile(join(vault,'Wiki/Autotomy.md'),'utf8');
  const result=await decideWikiProposal(service,staged.id,'project-a',staged.proposalHash,'reject');
  expect(result.status).toBe('rejected');expect(result.vaultWritten).toBe(false);
  expect(await readFile(join(vault,'Wiki/Autotomy.md'),'utf8')).toBe(before);
 });
 it('shared approved Wiki is visible in another project without a duplicated file',async()=>{
  const staged=await candidate({path:'Wiki/shared-new.md',markdown:'uniquesharedapproved'});
  await decideWikiProposal(service,staged.id,'project-a',staged.proposalHash,'apply');
  const other=join(root,'other');await mkdir(other);
  const turn=await service.prepare({cwd:other,project:'project-b',query:'uniquesharedapproved'});
  expect((await service.search(turn.ticket,other,{query:'uniquesharedapproved',wikiOnly:true})).hits[0].path).toBe('Wiki/shared-new.md');
 });
 it('Vault switches invalidate pending candidates instead of redirecting their writes',async()=>{
  const staged=await candidate();await configureObsidian({cwd,vault:join(root,'Other Vault')});
  await expect(decideWikiProposal(service,staged.id,'project-a',staged.proposalHash,'apply')).rejects.toThrow('binding changed');
 });
 it('run-only blocks staged Wiki work and the older Wiki writer cannot bypass review',async()=>{
  await expect(buildResearchWikiPage({cwd})).rejects.toThrow('obsidian-review');
  await configureObsidian({cwd,vault,project:'project-a',depositMode:'run-only'});
  service=await getKnowledgeService();prep=await service.prepare({cwd,project:'project-a'});
  await expect(stageWikiProposal(service,prep.ticket,cwd,input())).rejects.toThrow('run-only');
 });
 it('bounded review rejects oversized candidates without truncating them',async()=>{
  await expect(candidate({markdown:'x'.repeat(24001)})).rejects.toThrow('24000');
 });
});

describe('human-only review surface',()=>{
 function harness(readOnly=false){
  const tools=new Map(),commands=new Map(),events=new Map();
  const pi={registerTool:t=>tools.set(t.name,t),registerCommand:(name,command)=>commands.set(name,command),
   on:(name,fn)=>events.set(name,fn),sendMessage:vi.fn()};
  return {pi,tools,commands,interface:registerKnowledgeInterface(pi,{readOnly})};
 }
 it('does not expose publication as a model tool and keeps children read-only',()=>{
  const parent=harness(),child=harness(true);
  expect(parent.tools.has('research_propose_wiki_update')).toBe(true);
  expect([...parent.tools.keys()].some(name=>/approve|apply.*wiki/.test(name))).toBe(false);
  expect(parent.commands.has('obsidian-review')).toBe(true);
  expect(child.tools.has('research_propose_wiki_update')).toBe(false);expect(child.commands.size).toBe(0);
 });
 it('cancelling native review leaves the pending proposal and target untouched',async()=>{
  const staged=await candidate(),h=harness();const before=await readFile(join(vault,'Wiki/Autotomy.md'),'utf8');
  const select=vi.fn(async()=> '取消');
  await h.commands.get('obsidian-review').handler(staged.id,{cwd,hasUI:true,ui:{select}});
  expect(select).toHaveBeenCalledOnce();expect(await readFile(join(vault,'Wiki/Autotomy.md'),'utf8')).toBe(before);
  expect((await listWikiProposals(service,'project-a')).items).toHaveLength(1);
 });
 it('native review applies only after the user choice, not a model argument',async()=>{
  const staged=await candidate(),h=harness();
  const select=vi.fn(async()=> '确认应用此候选');
  await h.commands.get('obsidian-review').handler(staged.id,{cwd,hasUI:true,ui:{select}});
  expect(select.mock.calls[0][0]).toContain('原托管区');
  expect(h.pi.sendMessage.mock.calls[0][0].content).toContain('"vaultWritten": true');
 });
});


describe('review lifecycle and context budget',()=>{
 it('an edited source cannot reuse a previous read receipt at proposal time',async()=>{
  await service.read(prep.ticket,cwd,{path:'Library/Papers/source.md'});
  await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md'});
  await note('Library/Papers/source.md','# Changed source\n');
  await expect(stageWikiProposal(service,prep.ticket,cwd,input())).rejects.toThrow('Source changed');
 });
 it('old unreviewed candidates expire instead of being silently applied',async()=>{
  const staged=await candidate();const now=vi.spyOn(Date,'now').mockReturnValue(Date.now()+25*60*60*1000);
  try{await expect(decideWikiProposal(service,staged.id,'project-a',staged.proposalHash,'apply')).rejects.toThrow('expired');}
  finally{now.mockRestore();}
 });
 it('an unverified Wiki cannot be the only supporting source for another Wiki',async()=>{
  await service.read(prep.ticket,cwd,{path:'Wiki/Unrelated.md'});
  await expect(candidate({source_paths:['Wiki/Unrelated.md']})).rejects.toThrow('underlying evidence');
 });
 it('navigation context excludes noisy execution counters while retaining coverage',async()=>{
  const events=new Map(),tools=new Map();
  const pi={registerTool:t=>tools.set(t.name,t),registerCommand:()=>{},on:(name,fn)=>events.set(name,fn)};
  const api=registerKnowledgeInterface(pi);
  const start=await api.beforeStart({prompt:'Autotomy'},{cwd});
  expect(start.message.content).toContain('indexAtPreparation');
  expect(start.message.content).not.toContain('bodyReads');
  expect(start.message.content).not.toContain('reconciliations');
 });
});
