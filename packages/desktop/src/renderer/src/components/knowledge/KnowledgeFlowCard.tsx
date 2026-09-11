import { useEffect, useState } from "react";
import type { KnowledgeReadRecord } from "@percho/shared";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { Button } from "../ui/Button";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";
import { knowledgeZh, useKnowledgeText } from "./copy";
import { reportKnowledgeError } from "./hooks";
const phases: Record<string,keyof typeof knowledgeZh> = {
 preparing:'preparing',navigation:'navigationPhase','reading-wiki':'readingWiki',searching:'searching','reading-evidence':'readingEvidence',
 checking:'checking',released:'released','no-hits':'noHits',blocked:'blocked',unconfigured:'unconfigured','evidence-only':'evidenceOnly',interrupted:'interrupted'
};
export function KnowledgeFlowCard({sessionId}:{sessionId:string|null}){
 const t=useKnowledgeText(),cwd=useSessionsStore(s=>s.cwd);
 const flow=useKnowledgeStore(s=>sessionId?s.flows[sessionId]:undefined);
 const [open,setOpen]=useState(false),[path,setPath]=useState<string|null>(null),[resuming,setResuming]=useState(false);
 useEffect(()=>{setOpen(false);setPath(null);setResuming(false);
  if(!sessionId||isDraftSessionId(sessionId))return;let live=true;
  void getPi().getKnowledgeOverview({cwd,sessionId}).then(value=>{if(live&&value.flow)useKnowledgeStore.getState().apply({kind:'flow',flow:value.flow});}).catch(()=>{});
  return ()=>{live=false;};
 },[sessionId,cwd]);
 if(!sessionId||!flow)return null;
 const records=[...flow.navigation,...flow.reads];
 const title=t(phases[flow.phase]||'flow');
 const stages:[keyof typeof knowledgeZh,boolean][]=[['navigation',flow.navigation.some(p=>!p.missing)],['wiki',flow.reads.some(p=>p.kind==='wiki'&&!p.missing&&p.endLine>=p.startLine)],['search',!!flow.search&&!flow.search.wikiOnly],['publication',['released','no-hits'].includes(flow.publication?.status||'')]];
 function manage(tab:'overview'|'reviews'|'maintenance'='overview'){useKnowledgeStore.getState().open({cwd,sessionId,tab});}
 async function resume(){if(resuming)return;setResuming(true);try{await getPi().resumeKnowledgeCheck(sessionId!);}catch(e){reportKnowledgeError(e);}finally{setResuming(false);}}
 return <section className="mx-4 mb-2 mt-2 shrink-0 rounded-xl border border-border bg-surface text-ink" data-testid="knowledge-flow-card" aria-label={t('flow')}>
  <div className="flex items-center justify-between gap-2 px-3 py-2"><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="flex min-w-0 items-center gap-2 text-left"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${flow.phase==='blocked'?'bg-warn':flow.phase==='released'?'bg-ok':'bg-accent'}`} aria-hidden/><span className="truncate text-[11px] font-medium" role="status" aria-live="polite">{title}</span><span className="text-[10px] text-ink-faint">{open?'▴':'▾'}</span></button><Button size="sm" onClick={()=>manage()}>{t('manage')}</Button></div>
  {open&&<div className="max-h-[36vh] overflow-auto border-t border-border px-3 py-3">
   <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{stages.map(([label,done])=><div key={label} className="rounded-lg bg-hover px-2 py-1.5 text-[10px]"><span aria-hidden>{done?'✓':'○'} </span>{t(label)}</div>)}</div>
   {flow.vault&&<p className="mb-2 break-all font-mono text-[10px] text-ink-dim">{flow.vault}</p>}
   {flow.search&&<p className="mb-2 break-words text-[11px]">{t('search')}：{flow.search.query} · {t('matched')} {flow.search.hits} · {flow.search.complete?t('coverageReady'):t('coveragePartial')}</p>}
   {flow.phase==='no-hits'&&<p className="mb-2 text-[11px] text-warn">{t('noHitsHint')}</p>}
   {(flow.error||flow.publication?.reason)&&<p className="mb-2 break-words rounded-lg bg-hover p-2 text-[11px] text-warn">{flow.error||flow.publication?.reason}</p>}
   <h4 className="mb-1 text-[11px] font-semibold">{t('readScope')}</h4>
   <div className="space-y-1">{records.map((row:KnowledgeReadRecord,i)=><div key={`${row.path}:${i}`} className="flex items-center justify-between gap-2 text-[10px]"><div className="min-w-0"><span className="block truncate font-mono" title={row.path}>{row.path}</span><span className="text-ink-faint">{row.missing?t('missing'):`L${row.startLine}–${row.endLine} · ${row.hash?.slice(0,12)||'—'}`}{row.truncated?' · '+t('truncated'):''}</span></div><Button size="sm" disabled={!!row.missing||!flow.bindingRevision} onClick={()=>setPath(row.path)}>{t('openSource')}</Button></div>)}</div>
   {path&&flow.bindingRevision&&<div className="mt-3"><KnowledgeNoteViewer cwd={cwd} path={path} revision={flow.bindingRevision} onClose={()=>setPath(null)}/></div>}
   <p className="mt-3 text-[10px] text-ink-dim">{t('checksNotFacts')}</p>
   {flow.phase==='blocked'&&<div className="mt-2"><div className="flex flex-wrap gap-2"><Button size="sm" onClick={()=>manage('maintenance')}>{t('maintenance')}</Button><Button size="sm" disabled={resuming} onClick={()=>void resume()}>{t('resume')}</Button></div><p className="mt-1 text-[10px] text-ink-faint">{t('resumeHint')}</p></div>}
  </div>}
 </section>;
}
