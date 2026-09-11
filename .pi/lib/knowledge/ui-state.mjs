import { randomUUID } from 'node:crypto';
const key=Symbol.for('percho.knowledge.ui.v1');
const state=globalThis[key] ||= {listeners:new Set(),flows:new Map(),seq:0};
const MAX_SESSIONS=64,MAX_RECORDS=40;
const sessionId=ctx=>ctx?.sessionManager?.getSessionId?.()||ctx?.sessionId||null;
export function subscribeKnowledgeUi(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener);}
export function emitKnowledgeUi(event){
 const value={...event,sequence:++state.seq};
 for(const fn of state.listeners){try{fn(structuredClone(value));}catch{/* a closed UI must not fail a read/write */}}
 return value;
}
export function flowFor(id){const flow=state.flows.get(id);return flow?structuredClone(flow):null;}
export function beginKnowledgeFlow(ctx,binding){
 const id=sessionId(ctx);if(!id)return;
 const flow={sessionId:id,turnId:randomUUID(),vaultId:binding?.vaultId||null,bindingRevision:binding?.revision||null,
  vault:binding?.vault||null,project:null,phase:binding?'preparing':'unconfigured',updatedAt:Date.now(),
  navigation:[],reads:[],search:null,publication:null};
 state.flows.delete(id);state.flows.set(id,flow);
 while(state.flows.size>MAX_SESSIONS)state.flows.delete(state.flows.keys().next().value);
 updateKnowledgeFlow(ctx,{});
}
export function updateKnowledgeFlow(ctx,patch){
 const id=sessionId(ctx),old=state.flows.get(id);if(!old)return;
 const next={...old,...patch,updatedAt:Date.now()};
 state.flows.set(id,next);emitKnowledgeUi({kind:'flow',flow:next});
}
export function noteKnowledgeRead(ctx,page){
 const id=sessionId(ctx),old=state.flows.get(id);if(!old)return;
 const row={path:page.path,hash:page.hash||null,startLine:page.startLine||0,endLine:page.endLine||0,
  missing:!!page.missing,truncated:!!page.truncated,kind:/(?:^|\/)Wiki\//.test(page.path)?'wiki':'evidence'};
 const reads=[...old.reads.filter(x=>x.path!==row.path),row].slice(-MAX_RECORDS);
 updateKnowledgeFlow(ctx,{reads,phase:row.kind==='wiki'?'reading-wiki':'reading-evidence'});
}
export function publicationKnowledgeFlow(ctx,proof){
 const id=sessionId(ctx);if(!state.flows.has(id))return;
 const phase=proof.status==='released'?'released':proof.status==='no-hits'?'no-hits':proof.status==='blocked'?'blocked':proof.status==='evidence-only'?'evidence-only':proof.status==='unconfigured'?'unconfigured':'checking';
 updateKnowledgeFlow(ctx,{phase,publication:{status:proof.status,reason:proof.reason||null,scientificallyVerified:false}});
}
export function requestWikiReviewUi(ctx,id=''){
 if(!state.listeners.size||!sessionId(ctx))return false;
 emitKnowledgeUi({kind:'open-review',sessionId:sessionId(ctx),id});return true;
}
export function notifyKnowledgeUi(text,severity='info',id=null){
 if(typeof text!=='string'||!text.trim())return;
 emitKnowledgeUi({kind:'notice',id:randomUUID(),sessionId:id,severity:['info','warning','error'].includes(severity)?severity:'info',text:text.slice(0,2000)});
}
export function invalidateKnowledgeUi(){emitKnowledgeUi({kind:'invalidate'});}
export function clearKnowledgeFlow(id){state.flows.delete(id);}
