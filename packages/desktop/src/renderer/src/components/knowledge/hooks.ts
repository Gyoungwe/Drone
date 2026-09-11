import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeOverview } from "@percho/shared";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
export function useKnowledgeOverview(cwd: string | null, sessionId: string | null = null) {
 const revision=useKnowledgeStore(s=>s.revision), epoch=useRef(0);
 const [data,setData]=useState<KnowledgeOverview|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
 const refresh=useCallback(async()=>{
  const seq=++epoch.current;setLoading(true);setError(null);
  try{const result=await getPi().getKnowledgeOverview({cwd,sessionId:isDraftSessionId(sessionId)?null:sessionId});if(seq===epoch.current)setData(result);}
  catch(e){if(seq===epoch.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(seq===epoch.current)setLoading(false);}
 },[cwd,sessionId]);
 useEffect(()=>{setData(null);void refresh();return ()=>{epoch.current++;};},[refresh]);
 useEffect(()=>{if(revision)void refresh();},[revision,refresh]);
 // Only mounted/visible panels with unfinished indexing are polled. No model call or scan.
 useEffect(()=>{
  if(document.hidden||!data?.index||!['indexing','partial'].includes(data.index.coverage)&&!data.index.pendingChanges)return;
  const id=window.setTimeout(()=>void refresh(),2000);return ()=>window.clearTimeout(id);
 },[data,refresh]);
 return {data,error,loading,refresh};
}
export async function launchKnowledgeSetup(cwd: string | null, sessionId: string | null, path?: string) {
 if(!cwd)throw new Error('Select a workspace before setup');
 let id=sessionId;
 if(!id||isDraftSessionId(id)){
  await useSessionsStore.getState().createSession(cwd,id??undefined);id=useSessionsStore.getState().activeSessionId;
 }
 if(!id||isDraftSessionId(id))throw new Error('Could not create the setup session');
 useSettingsStore.getState().setOpen(false);useKnowledgeStore.getState().close();
 await getPi().startKnowledgeSetup({sessionId:id,...(path?{path}:{})});
}
export function reportKnowledgeError(error: unknown) {
 useKnowledgeStore.getState().apply({kind:'notice',id:String(Date.now()),sessionId:null,severity:'error',text:error instanceof Error?error.message:String(error)});
}
