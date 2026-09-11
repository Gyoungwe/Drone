import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerAnswerPublication, projectKnowledgeEvent } from '../../../.pi/lib/knowledge/publication.mjs';
function harness(validate=async()=>({status:'ready',sources:[],scientificallyVerified:false}),evidenceOnly=false){
 const events=new Map(),called=vi.fn(validate);
 const gate=registerAnswerPublication({on:(name,handler)=>events.set(name,handler)},
  {getCurrent:()=>({service:{validateAnswer:called},ticket:'host-owned'}),evidenceOnly});
 gate.begin(true);return {gate,called,end:message=>events.get('message_end')({message},{cwd:'/fixture'})};
}
const message=(text='UNCHECKED_FIXTURE')=>({role:'assistant',content:[{type:'text',text}],timestamp:1,stopReason:'stop'});
beforeEach(()=>vi.stubEnv('PERCHO_KNOWLEDGE_DIR','/fixture/app'));
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it('validation exceptions are fail-closed without echoing arbitrary error content',async()=>{
 const h=harness(async()=>{throw new Error('ERROR_BODY_FIXTURE');}),result=await h.end(message());
 expect(result.message.knowledgePublication.status).toBe('blocked');
 expect(JSON.stringify(result)).not.toContain('FIXTURE');expect(h.called).toHaveBeenCalledOnce();
});
it('a timeout publishes a host notice and never retries',async()=>{
 vi.useFakeTimers();const h=harness(()=>new Promise(()=>{})),pending=h.end(message());
 await vi.advanceTimersByTimeAsync(5001);const result=await pending;
 expect(result.message.knowledgePublication.reason).toBe('check-timeout');expect(h.called).toHaveBeenCalledOnce();
});
it.each(['error','aborted','length','pending'])('%s never publishes a partial answer',async stopReason=>{
 const h=harness(),result=await h.end({...message(),stopReason,errorMessage:'ERROR_BODY_FIXTURE'});
 expect(result.message.knowledgePublication.reason).toBe('interrupted');expect(JSON.stringify(result)).not.toContain('FIXTURE');
 expect(h.called).not.toHaveBeenCalled();
});
it('oversized final text is refused before validation',async()=>{
 const h=harness(),result=await h.end(message('x'.repeat(128*1024+1)));
 expect(result.message.knowledgePublication.reason).toBe('answer-too-large');expect(h.called).not.toHaveBeenCalled();
});
it('child material is labeled instead of certified as a parent answer',async()=>{
 const h=harness(async()=>{throw new Error('unexpected validation');},true),result=await h.end(message('Child observation'));
 expect(result.message.knowledgePublication.status).toBe('evidence-only');
 expect(result.message.content[0].text).toContain('子智能体待核验材料');expect(h.called).not.toHaveBeenCalled();
});
it('a tampered finalized body loses its host proof',async()=>{
 const h=harness(),result=await h.end(message('Original checked body'));result.message.content[0].text='TAMPERED_BODY';
 expect(JSON.stringify(projectKnowledgeEvent({type:'message_end',message:result.message}))).not.toContain('TAMPERED_BODY');
});
it('legacy streaming is unchanged outside application mode',()=>{
 vi.stubEnv('PERCHO_KNOWLEDGE_DIR',undefined);const event={type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'legacy'}};
 expect(projectKnowledgeEvent(event)).toBe(event);
});
it('unconfigured replies do not claim a completed knowledge check',async()=>{
 const h=harness();h.gate.begin(false);const result=await h.end(message('Configure a Vault first.'));
 expect(result.message.knowledgePublication.status).toBe('unconfigured');expect(h.called).not.toHaveBeenCalled();
});
