import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureObsidian } from '../../../.pi/lib/obsidian-workbench.mjs';
import { closeKnowledgeServices, getKnowledgeService } from '../../../.pi/lib/knowledge/service.mjs';
let root,cwd,vault,service,prep;
async function note(path,text){await mkdir(join(vault,path,'..'),{recursive:true});await writeFile(join(vault,path),text);}
beforeEach(async()=>{
 root=await realpath(await mkdtemp(join(tmpdir(),'percho-publication-')));cwd=join(root,'project');vault=join(root,'Vault');await mkdir(cwd);
 vi.stubEnv('PERCHO_KNOWLEDGE_DIR',join(root,'app'));vi.stubEnv('PI_RESEARCH_DESKTOP_CONFIG',undefined);
 vi.stubEnv('PI_SUBAGENT_CHILD',undefined);
 await configureObsidian({cwd,vault,project:'project-a'});
 await note('Wiki/Index.md','# Topics\n[[Wiki/Autotomy]]\n');
 await note('Wiki/Autotomy.md','# Autotomy\nRead the underlying evidence.\n[[Library/Papers/source]]\n');
 await note('Library/Papers/source.md','# Autotomy evidence\nObservation under specific conditions.\n');
 service=await getKnowledgeService();prep=await service.prepare({cwd,project:'project-a',query:'Autotomy'});
 await service.request('reconcile');
});
afterEach(async()=>{await closeKnowledgeServices();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
const answer='Evidence is conditional. [[Library/Papers/source]]';
async function searchAndRead(){
 await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md'});
 await service.search(prep.ticket,cwd,{query:'Autotomy'});
 await service.read(prep.ticket,cwd,{path:'Library/Papers/source.md'});
}
describe('native answer readiness, not model self-certification',()=>{
 it('rejects a direct answer after navigation alone',async()=>{
  await expect(service.validateAnswer(prep.ticket,cwd,answer)).rejects.toThrow('search');
 });
 it('rejects discovery-only search and search results that were not read',async()=>{
  await service.search(prep.ticket,cwd,{query:'Autotomy',wikiOnly:true});
  await expect(service.validateAnswer(prep.ticket,cwd,answer)).rejects.toThrow('search');
  await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md'});
  await service.search(prep.ticket,cwd,{query:'Autotomy'});
  await expect(service.validateAnswer(prep.ticket,cwd,answer)).rejects.toThrow('read');
 });
 it('accepts a current cited source only after actual search and read',async()=>{
  await searchAndRead();const proof=await service.validateAnswer(prep.ticket,cwd,answer);
  expect(proof.status).toBe('ready');expect(proof.scientificallyVerified).toBe(false);
  expect(proof.sources[0].path).toBe('Library/Papers/source.md');
 });
 it('rejects nonexistent citations and an uncited answer after hits',async()=>{
  await searchAndRead();
  await expect(service.validateAnswer(prep.ticket,cwd,'Invented [[Library/fake]]')).rejects.toThrow('read');
  await expect(service.validateAnswer(prep.ticket,cwd,'A confident claim without provenance.')).rejects.toThrow('citation');
 });
 it('rejects changed sources even when a model repeats the old claim',async()=>{
  await searchAndRead();await note('Library/Papers/source.md','# Corrected observation\n');
  await expect(service.validateAnswer(prep.ticket,cwd,answer)).rejects.toThrow(/changed|revision/);
 });
 it('rejects old search receipts after new indexed evidence arrives',async()=>{
  await searchAndRead();await note('Library/Papers/new.md','# New contradictory Autotomy evidence\n');
  await service.request('changed',{paths:['Library/Papers/new.md']});
  await expect(service.validateAnswer(prep.ticket,cwd,answer)).rejects.toThrow('revision');
 });
 it('distinguishes complete zero hits from missing/partial coverage',async()=>{
  await service.read(prep.ticket,cwd,{path:'Wiki/Autotomy.md'});
  await service.search(prep.ticket,cwd,{query:'notpresentuniquetoken'});
  expect((await service.validateAnswer(prep.ticket,cwd,'There were no hits for this query.')).status).toBe('no-hits');
  await note('Library/too-big.md','x'.repeat(1024*1024+1));await service.request('reconcile');
  await service.search(prep.ticket,cwd,{query:'notpresentuniquetoken'});
  await expect(service.validateAnswer(prep.ticket,cwd,'No evidence exists.')).rejects.toThrow(/complete|coverage/);
 });
 it('does not let a failed newer search reuse a previous success',async()=>{
  await searchAndRead();await expect(service.search(prep.ticket,cwd,{query:''})).rejects.toThrow();
  await expect(service.validateAnswer(prep.ticket,cwd,answer)).rejects.toThrow('search');
 });
 it('rejects foreign project tickets and new turn receipts do not inherit old searches',async()=>{
  await searchAndRead();
  await expect(service.validateAnswer(prep.ticket,join(root,'other'),answer)).rejects.toThrow('navigation');
  const next=await service.prepare({cwd,project:'project-a',query:'a new question'});
  await expect(service.validateAnswer(next.ticket,cwd,answer)).rejects.toThrow('search');
 });
});
