import { describe, expect, it } from 'vitest';
import { toSessionMessages } from '../src/session/messages';
import { makeStatusTool } from '../src/tools/status';
import { emptyTranscript, reduceEvent, messagesToUIMessages, buildChatRows, deriveTurnUsage } from '@percho/shared';
const ev=(type,extra={})=>({type,...extra});
const call=(id,name,args={})=>({type:'toolCall',id,name,arguments:args});
const usage={input:200,output:40,cacheRead:800,cacheWrite:0,cost:{total:0}};
const assistant=(id,content)=>({role:'assistant',responseId:id,timestamp:1,stopReason:'toolUse',content,usage});
const result=(id,name,details={},isError=false)=>({role:'toolResult',toolCallId:id,toolName:name,content:[{type:'text',text:'Observed tool result'}],details,isError,timestamp:2});
const stage=(status,kind='plan')=>({status,kind,detail:'Public evidence/action summary only',phase:'reading',next:'Continue with listed actions',hiddenReasoning:'DO_NOT_SHOW'});
function describeRows(s){return buildChatRows(s,'fixture').flatMap(row=>row.kind==='metaGroup'?row.items.flatMap(i=>i.tools.map(t=>'tool:'+t.name)):
 row.kind==='message'&&row.message.kind==='assistant'?(row.message.progress?['stage:'+row.message.progress.text]:row.message.text?['text:'+row.message.text]:[]):[]);}
function ended(s,r){return reduceEvent(s,ev('tool_execution_end',{toolCallId:r.toolCallId,toolName:r.toolName,isError:r.isError,result:{content:r.content,details:r.details}}));}
function started(m){let s=reduceEvent(emptyTranscript(),ev('message_start',{message:{role:'user',content:'Question',timestamp:0}}));s=reduceEvent(s,ev('turn_start'));return reduceEvent(s,ev('message_end',{message:m}));}
const batch=()=>assistant('batch',[call('p','set_status'),call('a','research_read_knowledge'),call('u','set_status'),call('b','research_search_knowledge'),call('s','set_status')]);
const completedResults=()=>[result('p','set_status',stage('Read the Wiki')),result('a','research_read_knowledge'),result('u','set_status',stage('Search the missing evidence','update')),result('b','research_search_knowledge'),result('s','set_status',stage('Sources collected; final checks remain','summary'))];
const expected=['stage:Read the Wiki','tool:research_read_knowledge','stage:Search the missing evidence','tool:research_search_knowledge','stage:Sources collected; final checks remain'];

describe('public summary → tools → next summary timeline',()=>{
 it('shows the completed stage before its tools during live execution, not only at run end',()=>{
  let s=started(batch());s=ended(s,completedResults()[0]);
  expect(describeRows(s).slice(0,2)).toEqual(expected.slice(0,2));
 });
 it('keeps all summaries in one provider batch instead of overwriting with the last one',()=>{
  let s=started(batch());for(const r of completedResults())s=ended(s,r);
  s=reduceEvent(s,ev('turn_end',{message:batch(),toolResults:completedResults()}));
  expect(describeRows(s)).toEqual(expected);expect(JSON.stringify(s.messages)).not.toContain('DO_NOT_SHOW');
  expect(deriveTurnUsage(s.messages)[0].requests).toBe(1);
 });
 it('uses declared call order despite out-of-order parallel result completion and duplicate events',()=>{
  let s=started(batch());const results=completedResults();for(const i of [4,3,2,1,0,2])s=ended(s,results[i]);
  expect(describeRows(s)).toEqual(expected);
  s=reduceEvent(s,ev('turn_end',{message:batch(),toolResults:results}));expect(describeRows(s)).toEqual(expected);
 });
 it('history replay uses the same order as live execution',()=>{
  const rows=toSessionMessages([{role:'user',content:'Question',timestamp:0},batch(),...completedResults().reverse()]);
  expect(describeRows({...emptyTranscript(),messages:messagesToUIMessages(rows)})).toEqual(expected);
 });
 it('separates successive tool-only responses even if an old model omitted public summaries',()=>{
  const raw=[{role:'user',content:'Question'},assistant('one',[call('a','read')]),result('a','read'),assistant('two',[call('b','grep')]),result('b','grep')];
  const rows=buildChatRows({...emptyTranscript(),messages:messagesToUIMessages(toSessionMessages(raw))},'fixture');
  expect(rows.filter(r=>r.kind==='metaGroup')).toHaveLength(2);
  expect(rows.some(r=>r.kind==='message'&&r.message.progress)).toBe(false);
 });
 it('places final prose after completed summaries with usage attached only once per response',()=>{
  const end=assistant('end',[{type:'text',text:'Final checked response'}]);
  const messages=messagesToUIMessages(toSessionMessages([{role:'user',content:'Question'},batch(),...completedResults(),end]));
  expect(describeRows({...emptyTranscript(),messages})).toEqual([...expected,'text:Final checked response']);
  expect(deriveTurnUsage(messages)[0].requests).toBe(2);
 });
 it('does not mint a public summary from failed or unexecuted status calls',()=>{
  const raw=[batch(),result('p','set_status',stage('Must not appear'),true),result('a','research_read_knowledge')];
  const rows=toSessionMessages(raw);expect(JSON.stringify(rows)).not.toContain('Must not appear');
  expect(describeRows({...emptyTranscript(),messages:messagesToUIMessages(rows)})).toEqual(['tool:research_read_knowledge','tool:research_search_knowledge']);
 });
 it('preserves the public summary kind in the real status tool result',async()=>{
  const tool=makeStatusTool(),r=await tool.execute('s',{text:'Evidence gap remains',kind:'summary',detail:'The queried source did not resolve the parameter version.'});
  expect(r.details.kind).toBe('summary');
 });
});


it('interruption preserves completed progress/tool order but does not invent the missing next summary',()=>{
 let s=started(batch());for(const r of completedResults().slice(0,2))s=ended(s,r);
 s=reduceEvent(s,ev('agent_settled'));
 expect(describeRows(s)).toEqual(['stage:Read the Wiki','tool:research_read_knowledge','tool:research_search_knowledge']);
 expect(deriveTurnUsage(s.messages)[0].requests).toBe(1);
});
it('text in between a progress stage and later tools keeps its original position',()=>{
 const message=assistant('mixed',[call('before','set_status'),call('read','read'),{type:'text',text:'Visible text boundary'},call('after','set_status'),call('grep','grep')]);
 const results=[result('before','set_status',stage('Before')),result('after','set_status',stage('After','summary'))];
 let live=started(message);for(const r of results)live=ended(live,r);
 const expected=['stage:Before','tool:read','text:Visible text boundary','stage:After','tool:grep'];
 expect(describeRows(live)).toEqual(expected);
 live=reduceEvent(live,ev('turn_end',{message,toolResults:results}));expect(describeRows(live)).toEqual(expected);
 expect(describeRows({...emptyTranscript(),messages:messagesToUIMessages(toSessionMessages([message,...results]))})).toEqual(expected);
});
it('late status completion cannot add the old stage to a different provider response',()=>{
 let s=started(assistant('new',[call('new-read','read')]));
 s=ended(s,result('old-status','set_status',stage('OLD_STAGE_MUST_NOT_APPEAR')));
 expect(JSON.stringify(s)).not.toContain('OLD_STAGE_MUST_NOT_APPEAR');
});
it('stable history rows reuse their messages and tool items between unrelated live updates',()=>{
 const messages=messagesToUIMessages(toSessionMessages([batch(),...completedResults(),assistant('final',[{type:'text',text:'Stable body'}])]));
 const a=buildChatRows({...emptyTranscript(),messages},'fixture'),b=buildChatRows({...emptyTranscript(),messages},'fixture');
 for(let i=0;i<a.length;i++){
  expect(a[i].key).toBe(b[i].key);
  if(a[i].kind==='message')expect(a[i].message).toBe(b[i].message);
  if(a[i].kind==='metaGroup')expect(a[i].items[0]).toBe(b[i].items[0]);
 }
});
