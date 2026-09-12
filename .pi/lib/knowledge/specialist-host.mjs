import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { knowledgeDirectory, readKnowledgeBinding, withKnowledgeBinding } from './config.mjs';
import { invalidateKnowledgeUi } from './ui-state.mjs';
const key=Symbol.for('percho.knowledge.specialists.v1');
const state=globalThis[key] ||= {hosts:new Map(),active:0,queue:[],settingsQueue:Promise.resolve()};
export const SPECIALIST_LIMITS=Object.freeze({maxRunsPerTurn:4,concurrency:2,timeoutMs:120000});
export const contextSessionId=ctx=>ctx?.sessionManager?.getSessionId?.()||ctx?.sessionId||null;
export function registerKnowledgeSpecialistHost(id,run){
 if(!id||typeof run!=='function')throw new Error('A specialist host requires a session identity');
 state.hosts.set(id,run);
 return ()=>{if(state.hosts.get(id)===run)state.hosts.delete(id);};
}
export function knowledgeSpecialistHost(ctx){return state.hosts.get(contextSessionId(ctx));}
export async function specialistSettings(){
 const dir=knowledgeDirectory();if(!dir)return {mode:'off',revision:0,...SPECIALIST_LIMITS};
 let data={mode:'automatic',revision:0};
 try{data=JSON.parse(await readFile(join(dir,'specialists.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('Knowledge specialist settings cannot be read');}
 if(!['automatic','manual','off'].includes(data.mode)||!Number.isSafeInteger(data.revision)||data.revision<0)throw new Error('Invalid knowledge specialist settings');
 return {...data,...SPECIALIST_LIMITS};
}
/** Only exposed through desktop human IPC. The model has no settings mutation tool. */
export async function setSpecialistSettings({mode,revision,bindingRevision}){
 if(!['automatic','manual','off'].includes(mode)||!Number.isSafeInteger(revision))throw new Error('Invalid specialist setting request');
 const operation=state.settingsQueue.catch(()=>{}).then(async()=>{
  const binding=await readKnowledgeBinding({fresh:true});
  if(!binding||binding.revision!==bindingRevision)throw new Error('Knowledge binding changed; refresh settings');
  return withKnowledgeBinding(binding,async()=>{
   const current=await specialistSettings();if(current.revision!==revision)throw new Error('Specialist settings changed; refresh first');
   const data={mode,revision:revision+1},dir=knowledgeDirectory(),temp=join(dir,`specialists.${randomUUID()}.tmp`);
   await mkdir(dir,{recursive:true,mode:0o700});
   try{await writeFile(temp,JSON.stringify(data)+'\n',{flag:'wx',mode:0o600});await rename(temp,join(dir,'specialists.json'));}
   finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
   invalidateKnowledgeUi();return {...data,...SPECIALIST_LIMITS};
  });
 });
 state.settingsQueue=operation;return operation;
}
export async function withSpecialistSlot(signal,work){
 signal?.throwIfAborted();
 if(state.active>=SPECIALIST_LIMITS.concurrency){
  if(state.queue.length>=8)throw new Error('Knowledge specialist queue is full');
  await new Promise((resolve,reject)=>{
   const item={resolve:()=>{signal?.removeEventListener('abort',abort);resolve();}};
   const abort=()=>{const at=state.queue.indexOf(item);if(at>=0)state.queue.splice(at,1);reject(new Error('Knowledge specialist cancelled while queued'));};
   state.queue.push(item);signal?.addEventListener('abort',abort,{once:true});
  });
 }else state.active++;
 try{signal?.throwIfAborted();return await work();}
 finally{const next=state.queue.shift();if(next)next.resolve();else state.active--;}
}
