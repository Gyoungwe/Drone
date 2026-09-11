// Human-facing host API; no model calls, no new approval tool.
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { readKnowledgeBinding, knowledgeDirectory, projectIdentity, withKnowledgeBinding } from './config.mjs';
import { getKnowledgeService } from './service.mjs';
import { flowFor, invalidateKnowledgeUi } from './ui-state.mjs';
import { runNavigationMaintenance } from './maintenance.mjs';
import { listWikiProposals, previewWikiProposal, decideWikiProposal } from './wiki-review.mjs';
import { safeNotePath } from './files.mjs';
import { inspectObsidianSetup, resolveSetupVault } from '../obsidian-setup.mjs';
import { researchSetupOptions } from '../obsidian-workbench.mjs';
const previews=new Map(),MAX_PREVIEWS=64,maintenance=new Set();
function pathCwd(cwd){if(cwd!==null&&cwd!==undefined&&(typeof cwd!=='string'||!isAbsolute(cwd)))throw new Error('Workspace must be an absolute path');return cwd?resolve(cwd):null;}
async function projectAt(cwd){
 cwd=pathCwd(cwd);if(!cwd)return {cwd:null,project:null,legacyProjectVault:null};
 let raw={};try{raw=JSON.parse(await readFile(join(cwd,'.pi/research-workspace.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')return {cwd,project:projectIdentity(cwd),legacyProjectVault:null,projectError:'Project configuration could not be read'};}
 return {cwd,project:projectIdentity(cwd,raw.knowledgeProjectId),legacyProjectVault:typeof raw.obsidianVault==='string'?raw.obsidianVault:null};
}
async function bound(revision){
 const binding=await readKnowledgeBinding({fresh:true});if(!binding)throw new Error('No application knowledge Vault is bound');
 if(revision!==undefined&&revision!==binding.revision)throw new Error('Knowledge binding changed; refresh this panel before acting');
 return {binding,service:await getKnowledgeService(binding)};
}
export async function knowledgeOverview({cwd=null,sessionId=null}={}){
 const project=await projectAt(cwd);
 if(!knowledgeDirectory())return {enabled:false,bound:false,scope:'application',...project,flow:null};
 const binding=await readKnowledgeBinding({fresh:true});
 if(!binding)return {enabled:true,bound:false,scope:'application',...project,flow:sessionId?flowFor(sessionId):null};
 let index=null,error=null;
 try{if(!(await stat(binding.vault)).isDirectory())throw new Error('Vault is not a directory');index=await (await getKnowledgeService(binding)).request('status');}catch(e){error=String(e.message).slice(0,500);}
 return {enabled:true,bound:true,scope:'application',binding,...project,index,error,flow:sessionId?flowFor(sessionId):null};
}
export async function knowledgeSetupPreview({cwd,path}){
 pathCwd(cwd);if(!cwd)throw new Error('Select a workspace before opening the setup skill');
 const vault=resolveSetupVault(path,cwd);
 const context=await inspectObsidianSetup({cwd,vault});
 const binding=await readKnowledgeBinding();
 return {path:vault,scope:'application',bindingRevision:binding?.revision||0,context,options:researchSetupOptions(),
  warning:'This only previews directories. The bound research-vault skill will ask questions and separately confirm application-wide writes.'};
}
export async function knowledgeJobs({cwd=null,offset=0,limit=20,revision}={}){
 const {service}=await bound(revision),{project}=await projectAt(cwd);
 return service.request('uiJobs',{project,offset,limit});
}
export async function knowledgeReviews({cwd,offset=0,limit=15,revision}){
 const {service}=await bound(revision),{project}=await projectAt(cwd);
 if(!project)return {items:[],problems:[],total:0,offset:0,nextOffset:null};
 if(!Number.isInteger(offset)||offset<0||offset>100||!Number.isInteger(limit)||limit<1||limit>25)throw new Error('Invalid review page');
 const all=await listWikiProposals(service,project),items=all.items.slice(offset,offset+limit);
 return {items,problems:all.problems,total:all.items.length,offset,nextOffset:offset+items.length<all.items.length?offset+items.length:null};
}
export async function knowledgePreviewReview({cwd,id,revision}){
 const {binding,service}=await bound(revision),{project}=await projectAt(cwd);
 if(!project)throw new Error('Choose the originating project to review its proposal');
 const preview=await previewWikiProposal(service,id,project),token=randomUUID();
 const expires=Date.now()+10*60*1000;
 previews.set(token,{binding,service,project,cwd:resolve(cwd),id,hash:preview.proposalHash,expires});
 while(previews.size>MAX_PREVIEWS)previews.delete(previews.keys().next().value);
 return {...preview,reviewToken:token,tokenExpiresAt:expires,vault:binding.vault,bindingRevision:binding.revision};
}
export async function knowledgeDecideReview({cwd,token,decision}){
 if(!['apply','reject'].includes(decision))throw new Error('Invalid Wiki decision');
 const entry=previews.get(token);
 if(!entry||entry.cwd!==pathCwd(cwd)||entry.expires<Date.now())throw new Error('Review expired; open the exact preview again');
 previews.delete(token); // one-shot; errors require a fresh preview
 const result=await decideWikiProposal(entry.service,entry.id,entry.project,entry.hash,decision);
 invalidateKnowledgeUi();return result;
}
export async function knowledgeReadNote({cwd=null,path,startLine=1,revision}){
 const {service}=await bound(revision),{project}=await projectAt(cwd);
 if(!Number.isSafeInteger(startLine)||startLine<1)throw new Error('Invalid start line');
 // Human reads intentionally do not grant any model read receipt.
 return service.request('read',{path,project,startLine,maxChars:6000,reviewMaxChars:1600});
}
export async function knowledgeMaintenance({cwd=null,action,revision}){
 const {binding,service}=await bound(revision),{project}=await projectAt(cwd);
 if(!['reconcile','refresh-navigation'].includes(action))throw new Error('Unknown maintenance action');
 if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Refresh the binding before maintenance');
 const key=binding.vaultId+':'+binding.revision;if(maintenance.has(key))throw new Error('Knowledge maintenance is already running');
 maintenance.add(key);
 try{const result=await withKnowledgeBinding(binding,()=>action==='reconcile'?service.request('reconcile'):runNavigationMaintenance(service,project,5));invalidateKnowledgeUi();return result;}finally{maintenance.delete(key);}
}
export async function knowledgeOpenTarget({cwd=null,path=null,revision}){
 const {binding}=await bound(revision);const {project}=await projectAt(cwd);
 if(path){
  const {canRead,validateNote}=await import('./files.mjs');
  if(!canRead(validateNote(path),project))throw new Error('Note is outside shared/current-project scope');
  return {path:await safeNotePath(binding.vault,path),kind:'note'};
 }
 if(!(await stat(binding.vault)).isDirectory())throw new Error('Vault is unavailable');
 return {path:binding.vault,kind:'vault'};
}
