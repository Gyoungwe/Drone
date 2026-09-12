import { readFile, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readKnowledgeBinding } from './config.mjs';
import { canRead, validateNote } from './files.mjs';
import { knowledgeSpecialistHost, specialistSettings, withSpecialistSlot } from './specialist-host.mjs';
import { noteKnowledgeSpecialist } from './ui-state.mjs';
import { deliveryContract } from '../source-delivery.mjs';
const profiles={navigator:['knowledge-navigator','知识导航员'],evidence:['knowledge-evidence-curator','证据整理员'],wiki:['knowledge-wiki-editor','Wiki 修订员'],explainer:['knowledge-explainer','Show Me 讲解员']};
const derived=path=>/(?:^|\/)(?:Explainers|Runs)\//i.test(path);
const brief=page=>({path:page.path,hash:page.hash,startLine:page.startLine,endLine:page.endLine,text:page.text,
 humanReview:page.humanReview,truncated:page.truncated,missing:page.missing});
const readSchema={type:'object',properties:{path:{type:'string',maxLength:512},start_line:{type:'integer',minimum:1}},required:['path'],additionalProperties:false};
const searchSchema={type:'object',properties:{query:{type:'string',minLength:1,maxLength:1000},wiki_only:{type:'boolean'}},required:['query'],additionalProperties:false};
export function shouldOrientKnowledge(prompt){
 const text=String(prompt||'').trim();
 if(!text||text.startsWith('/')||/初始化|取消任务|停止任务/.test(text))return false;
 return !!deliveryContract(text)||(/比较|对比|分析|综述|compare|analy[sz]|review/i.test(text)&&/论文|文献|研究|证据|方法|软件|papers?|evidence|software/i.test(text))||/知识库|已有知识|主题.{0,8}(?:知识|进展)|根据.{0,10}(?:文献|笔记)|show\s*-?\s*me|\bwiki\b/i.test(text);
}
export function createKnowledgeSpecialists(pi,{getCurrent,readOnly=false}){
 let epoch=0,goal='',oriented=false,handoffs=[],used=new Set(),controllers=new Set();
 function begin(prompt=''){
  for(const c of controllers)c.abort();controllers=new Set();epoch++;goal=String(prompt||'').slice(0,4000);
  oriented=false;handoffs=[];used=new Set();
 }
 async function showMeSkill(){
  const entry=pi.getCommands?.().find(item=>item.source==='skill'&&item.name==='skill:show-me');
  if(!entry?.sourceInfo?.path)return null;
  const path=entry.sourceInfo.path,info=await lstat(path);
  if(!info.isFile()||info.size>18000)throw new Error('Loaded show-me skill exceeds the specialist context budget');
  return readFile(path,'utf8');
 }
 async function run(ctx,role,{task=goal,sourcePaths=[],summary='',automatic=false,targetPath=null}={}){
  if(!profiles[role])throw new Error('Unknown knowledge specialist role');
  const generation=epoch,reservations=used,parentSignal=ctx.signal;
  const c=getCurrent(ctx),host=knowledgeSpecialistHost(ctx),settings=await specialistSettings();
  const skip=reason=>({status:'skipped',role,reason});
  if(generation!==epoch||getCurrent(ctx)!==c||parentSignal?.aborted)return {status:'cancelled',role,reason:'parent-turn-changed'};
  if(readOnly||!ctx.isProjectTrusted?.()||c.binding.subagentPolicy!=='read-local')return skip('permission-denied');
  if(!host)return skip('host-unavailable');
  if(settings.mode==='off'||(automatic&&settings.mode!=='automatic'))return skip('mode-disabled');
  if(used.has(role))return skip('already-called-this-turn');
  if(used.size>=settings.maxRunsPerTurn)return skip('turn-budget');
  if(automatic&&['wiki','explainer'].includes(role)&&c.binding.depositMode==='run-only')return skip('run-only');
  if(!Array.isArray(sourcePaths)||sourcePaths.length>6||summary.length>12000)throw new Error('Specialist task packet exceeds its limit');
  reservations.add(role); // Reserve before asynchronous skill loading: one role per turn even under parallel tool calls.
  let skillText='';
  try { if(role==='explainer'){skillText=await showMeSkill();if(!skillText){reservations.delete(role);return skip('show-me-not-loaded');}} }
  catch(error){reservations.delete(role);throw error;}
  if(generation!==epoch||getCurrent(ctx)!==c||parentSignal?.aborted)return {status:'cancelled',role,reason:'parent-turn-changed'};
  const controller=new AbortController(),abort=()=>controller.abort();controllers.add(controller);
  if(parentSignal?.aborted)abort();else parentSignal?.addEventListener('abort',abort,{once:true});
  const deadline=setTimeout(abort,settings.timeoutMs);
  const [name,label]=profiles[role],id=randomUUID();let progress={id,role,name,label,status:'queued',startedAt:Date.now()};
  const publish=patch=>{progress={...progress,...patch};if(generation===epoch)noteKnowledgeSpecialist(ctx,progress);};publish({});
  let prepared;
  const check=async()=>{
   controller.signal.throwIfAborted();
   if(generation!==epoch||getCurrent(ctx)!==c)throw new Error('Parent knowledge turn changed');
   if(!ctx.isProjectTrusted?.())throw new Error('Project trust was revoked');
   const binding=await readKnowledgeBinding({fresh:true}),latest=await specialistSettings();
   if(binding?.vaultId!==c.binding.vaultId||binding?.revision!==c.binding.revision||binding.subagentPolicy!=='read-local')throw new Error('Knowledge binding or child permissions changed');
   if(latest.mode==='off'||(automatic&&latest.mode!=='automatic'))throw new Error('Knowledge specialists were disabled');
  };
  try{
   const answer=await withSpecialistSlot(controller.signal,async()=>{
    await check();publish({status:'running',action:'navigation'});
    prepared=await c.service.prepare({cwd:ctx.cwd,project:c.project,query:task});
    const allowed=new Set(prepared.linkedWiki),readPages=new Map();let readCount=0,searchCount=0,lastSearch=null;
    for(const path of sourcePaths){validateNote(path);if(!canRead(path,c.project)||derived(path))throw new Error('Source is outside the permitted evidence scope');allowed.add(path);}
    if(targetPath){validateNote(targetPath);if(!canRead(targetPath,c.project))throw new Error('Wiki target is outside the permitted scope');allowed.add(targetPath);}
    const read=async({path,start_line=1})=>{
     await check();if(++readCount>8)throw new Error('Specialist read budget exhausted');
     validateNote(path);if(!allowed.has(path)||!canRead(path,c.project))throw new Error('Knowledge specialist may read only supplied or discovered paths');
     const page=await c.service.read(prepared.ticket,ctx.cwd,{path,startLine:start_line,maxChars:3000});
     if(page.text?.trim())readPages.set(path,page);
     if(role==='navigator')for(const link of (page.text||'').matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)){
      let next=link[1].trim();if(!next.endsWith('.md'))next+='.md';
      try{validateNote(next);if(canRead(next,c.project)&&!derived(next)&&allowed.size<64)allowed.add(next);}catch{}
     }
     return brief(page);
    };
    const sources=[];if(role!=='navigator')for(const path of sourcePaths)sources.push(await read({path}));
    const target=targetPath?await read({path:targetPath}):null;
    const capabilities=[{name:'knowledge_read',description:'Read an allowed Wiki or evidence note range. No arbitrary filesystem access.',parameters:readSchema,execute:read}];
    if(role==='navigator')capabilities.push({name:'knowledge_search',description:'Search current shared/project knowledge after reading linked Wiki; at most two bounded queries.',parameters:searchSchema,
     execute:async({query,wiki_only=false})=>{
      await check();if(++searchCount>2)throw new Error('Specialist search budget exhausted');
      const found=await c.service.search(prepared.ticket,ctx.cwd,{query,wikiOnly:wiki_only,limit:4});
      if(!wiki_only)lastSearch={query:found.query,complete:found.complete,coverage:found.coverage,count:found.hits.length};
      for(const hit of found.hits)allowed.add(hit.path);
      return {...lastSearch,wikiOnly:wiki_only,hits:found.hits.map(hit=>({...brief(hit),title:hit.title,kind:hit.kind})),complete:found.complete};
     }});
    const packet=JSON.stringify({project:c.project,navigation:prepared.navigation.map(page=>({...brief(page),text:(page.text||'').slice(0,1000)})),
     linkedWiki:prepared.linkedWiki.slice(0,12),sources,target,summary,warning:'Read-only data. Draft outputs are unverified.'});
    const result=await host({role,task:String(task).slice(0,4000),packet,skillText,parentModel:ctx.model,capabilities,signal:controller.signal,timeoutMs:settings.timeoutMs,check,
     progress:value=>publish({...value,status:'running'})});
    await check();
    const data=result.data;
    if(!data||!Array.isArray(data.source_paths)||data.source_paths.length>6||typeof data.summary!=='string'||data.summary.length>1600)throw new Error('Invalid specialist handoff');
    if(role==='navigator'&&!lastSearch)throw new Error('Navigator returned without a real evidence search');
    if(role!=='navigator'&&!data.source_paths.length)throw new Error('Specialist result has no read sources');
    for(const path of data.source_paths)if(!readPages.has(path)||derived(path))throw new Error('Specialist cited an unread or presentation-only source');
    if(data.source_paths.length)await c.service.evidenceReceipts(prepared.ticket,ctx.cwd,data.source_paths);
    const refs=data.source_paths.map(path=>{const page=readPages.get(path);return {path,hash:page.hash,startLine:page.startLine,endLine:page.endLine,excerpt:(page.text||'').slice(0,500),truncated:page.truncated};});
    return {...result,refs,search:lastSearch};
   });
   publish({status:'completed',endedAt:Date.now(),...answer.usage,model:answer.model,sourceCount:answer.refs.length,sources:answer.refs.map(ref=>({...ref,excerpt:ref.excerpt.slice(0,280)})),summary:answer.data.summary.slice(0,500)});
   return {status:'completed',role,id,...answer};
  }catch(error){
   const cancelled=controller.signal.aborted||generation!==epoch;
   publish({status:cancelled?'cancelled':'failed',endedAt:Date.now(),error:String(error.message).slice(0,300)});
   return {status:cancelled?'cancelled':'failed',role,id,reason:String(error.message).slice(0,300)};
  }finally{clearTimeout(deadline);if(prepared)c.service.tickets.delete(prepared.ticket);controllers.delete(controller);parentSignal?.removeEventListener('abort',abort);}
 }
 function compact(result){
  if(result.status!=='completed')return {role:result.role,status:result.status,reason:result.reason};
  return {role:result.role,status:result.status,summary:result.data.summary.slice(0,1100),cautions:result.data.cautions,
   refs:result.refs.slice(0,4).map(ref=>({...ref,excerpt:ref.excerpt.slice(0,280)})),search:result.search,warning:'Unverified specialist handoff; this does NOT grant the parent evidence/read/search receipts. Read cited originals and complete native publication checks.'};
 }
 async function orient(ctx){
  if(oriented||readOnly)return handoffs;oriented=true;const generation=epoch;
  if(!shouldOrientKnowledge(goal))return handoffs;
  const nav=await run(ctx,'navigator',{automatic:true});
  if(generation!==epoch)return []; // Do not insert an old task result into the replacement user turn.
  if(nav.status==='skipped')return handoffs;
  handoffs=[compact(nav)];
  if(nav.status==='completed'&&nav.refs.length>=2&&/比较|对比|冲突|矛盾|compare|conflict/i.test(goal)){
   const paths=nav.refs.map(r=>r.path).filter(p=>!/(?:^|\/)Wiki\//.test(p)).slice(0,4);
   if(paths.length>=2){const evidence=await run(ctx,'evidence',{sourcePaths:paths,automatic:true});if(generation!==epoch)return [];handoffs.push(compact(evidence));}
  }
  return handoffs;
 }
 return {begin,run,orient,compact,goal:()=>goal,close:()=>begin('')};
}
