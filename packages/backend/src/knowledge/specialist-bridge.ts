import { withNativeSubagentSlot } from "../tools/subagent/slots";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runKnowledgeSpecialist, type SpecialistRequest, type SpecialistRunnerDeps } from "./specialist-runner";
/** Registered per parent session, not as a globally invokable model tool. */
export function makeKnowledgeSpecialistBridge(deps: SpecialistRunnerDeps) {
 return (pi: ExtensionAPI) => {
  let unregister: (()=>void)|undefined;
  const active=new Set<AbortController>();
  async function connect(_event:unknown,ctx:ExtensionContext){
   if(!process.env.PERCHO_KNOWLEDGE_DIR)return;
   const root=process.env.PERCHO_RESEARCH_WORKBENCH_ROOT??fileURLToPath(new URL('../../../../.pi',import.meta.url));
   const module=await import(/* @vite-ignore */ pathToFileURL(join(root,'lib/knowledge/specialist-host.mjs')).href);
   unregister?.();
   unregister=module.registerKnowledgeSpecialistHost(ctx.sessionManager.getSessionId(),async(input:SpecialistRequest)=>{
    const controller=new AbortController(),abort=()=>controller.abort();
    active.add(controller);
    if(input.signal?.aborted)abort();else input.signal?.addEventListener('abort',abort,{once:true});
    try{return await withNativeSubagentSlot(ctx.cwd,controller.signal,()=>runKnowledgeSpecialist(deps,{...input,signal:controller.signal}));}
    finally{active.delete(controller);input.signal?.removeEventListener('abort',abort);}
   });
  }
  pi.on('session_start',connect);
  pi.on('session_shutdown',async()=>{unregister?.();unregister=undefined;for(const c of active)c.abort();active.clear();});
 };
}
