import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { containedFile } from '../vault-layout.mjs';
import { inspectNote, readNoteFile } from './files.mjs';
const START='<!-- pi-agent:managed:start -->', END='<!-- pi-agent:managed:end -->';
const hash = text => createHash('sha256').update(text).digest('hex');
export async function updateNavigation(vault,path,heading,body) {
  if (!['Home.md','Wiki/Index.md','Library/Index.md'].includes(path) && !/^Projects\/[a-z0-9-]+\/Index\.md$/.test(path)) throw new Error('Not an allowed navigation target');
  const full=await containedFile(vault,path);
  let original=null;
  try { original=(await readNoteFile(vault,path)).text; } catch(error) {if(error.code!=='ENOENT')throw error;}
  const base=original ?? `${heading}\n\n## Human review\n`;
  const start=base.indexOf(START),end=base.indexOf(END),block=`${START}\n${body.trim()}\n${END}`;
  if((start<0)!==(end<0) || end<start || (start>=0 && (base.indexOf(START,start+1)>=0 || base.indexOf(END,end+1)>=0))) throw new Error('Invalid navigation managed markers');
  const updated=start>=0 ? base.slice(0,start)+block+base.slice(end+END.length) : `${base.trimEnd()}\n\n${block}\n`;
  if(updated===original)return {path,changed:false};
  // Optimistic check protects observed edits. This is not an OS-wide editing lock.
  if(original!==null && (await readNoteFile(vault,path)).hash!==hash(original))throw new Error('Human navigation changed; update was not applied');
  await mkdir(dirname(full),{recursive:true});
  if(original===null) {await writeFile(full,updated,{flag:'wx'});return {path,changed:true};}
  const temporary=`${full}.${randomUUID()}.tmp`;
  await writeFile(temporary,updated,{flag:'wx'});await rename(temporary,full);
  return {path,changed:true};
}
export async function runNavigationMaintenance(service,project,limit=3) {
  const jobs=await service.request('jobs',{project,kind:'navigation'}),out=[];
  for(const item of jobs.items.filter(job=>job.kind==='navigation').slice(0,Math.min(10,limit))) {
    const rows=await service.request('navigation',{project:item.scope==='shared'?null:item.scope,targetPath:item.path});
    const links=rows.slice(0,60).filter(row=>!/[\[\]|#\r\n]/.test(row.path)).map(row=>`- [[${row.path.slice(0,-3)}]]`);
    const body=[...links,rows.length>60?'\n更多条目请使用知识检索；本页只保留短导航。':''].join('\n');
    try {
      const result=await updateNavigation(service.binding.vault,item.path,`# ${item.scope==='shared'?'Shared knowledge':item.scope}`,body);
      if(result.changed)await service.request('changed',{paths:[item.path]});
      await service.request('completeJob',{key:item.key,revision:item.revision});out.push(result);
    }catch(error){out.push({path:item.path,error:error.message});}
  }
  return {navigation:out,semanticWikiRewritten:false,remaining:await service.request('jobs',{project})};
}
