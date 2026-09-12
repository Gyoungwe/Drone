import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { Button } from "../ui/Button";
import { KnowledgePanel } from "./KnowledgePanel";
import { useKnowledgeText } from "./copy";
export function KnowledgeUiRoot(){
 const t=useKnowledgeText(),dialog=useKnowledgeStore(s=>s.dialog),notice=useKnowledgeStore(s=>s.notice);
 const box=useRef<HTMLDivElement>(null),close=useKnowledgeStore(s=>s.close),dismiss=useKnowledgeStore(s=>s.dismiss);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|null=null;
  const unsubscribe=getPi().onKnowledgeEvent(event=>{
   const store=useKnowledgeStore.getState();
   if(event.kind==='invalidate'){
    if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;store.invalidate();},250);return;
   }
   if(event.kind==='open-review'){
    const sessions=useSessionsStore.getState();const source=sessions.sessions.find(s=>s.sessionId===event.sessionId);
    const cwd=source?.cwd||null;
    if(cwd)store.open({cwd,sessionId:event.sessionId,tab:'reviews',id:event.id||undefined});
    return;
   }
   store.apply(event);
  });
  return ()=>{unsubscribe();if(timer)clearTimeout(timer);};
 },[]);
 useEffect(()=>{if(!notice||notice.severity==='error')return;const timer=setTimeout(dismiss,6500);return ()=>clearTimeout(timer);},[notice,dismiss]);
 useEffect(()=>{
  if(!dialog)return;const before=document.activeElement as HTMLElement|null;
  const focus=()=>box.current?.querySelector<HTMLElement>('button')?.focus();const raf=requestAnimationFrame(focus);
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();close();return;}
   if(event.key!=='Tab'||!box.current)return;
   const list=Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex="0"]')).filter(el=>el.offsetParent!==null);
   const first=list[0],last=list.at(-1);if(!first||!last)return;
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',key);return ()=>{cancelAnimationFrame(raf);document.removeEventListener('keydown',key);before?.focus();};
 },[!!dialog,close]);
 return <>
  {dialog&&createPortal(<div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/25 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={t('title')}>
   <div ref={box} className="flex max-h-[88vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-ink shadow-dialog">
    <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3"><p className="text-xs font-medium">Obsidian · {t('title')}</p><Button size="sm" onClick={close} aria-label={t('close')}>×</Button></div>
    <div className="min-h-0 overflow-auto p-4 sm:p-5"><div>{dialog.note&&dialog.noteRevision?<KnowledgeNoteViewer cwd={dialog.cwd} path={dialog.note} revision={dialog.noteRevision} onClose={close}/>:<KnowledgePanel context={dialog}/>}</div></div>
   </div>
  </div>,document.body)}
  {notice&&createPortal(<div role={notice.severity==='error'?'alert':'status'} className="fixed bottom-5 right-4 z-[80] w-[min(420px,calc(100vw-32px))] rounded-xl border border-border bg-surface p-4 text-ink shadow-dialog" data-testid="knowledge-notice">
   <div className="flex items-start justify-between gap-2"><p className={`text-xs font-semibold ${notice.severity==='error'?'text-err':notice.severity==='warning'?'text-warn':''}`}>{t('notification')}</p><Button size="sm" onClick={dismiss} aria-label={t('close')}>×</Button></div><p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{notice.text}</p>
  </div>,document.body)}
 </>;
}
