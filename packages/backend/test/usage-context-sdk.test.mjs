import { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe,expect,it } from "vitest";
const usage=(input,output,cacheRead=0)=>({input,output,cacheRead,cacheWrite:0,reasoning:Math.floor(output/2),totalTokens:input+output+cacheRead,cost:{total:0}});
const assistant=(u,stopReason="stop")=>({role:"assistant",content:[{type:"text",text:"fixture"}],usage:u,stopReason,timestamp:1});
const entry=(id,message)=>({id,type:"message",message});
const context=(branch,messages,contextWindow=1000000)=>AgentSession.prototype.getContextUsage.call({model:{contextWindow},messages,sessionManager:{getBranch:()=>branch}});
describe("native SDK cumulative versus compaction-aware context semantics",()=>{
 it("last-response context includes cached input and output, not reasoning twice",()=>{
  const m=assistant(usage(2843,2222,97280));const result=context([entry("a",m)],[m]);
  expect(result.tokens).toBe(102345);expect(result.percent).toBeCloseTo(10.2345);expect(result.contextWindow).toBe(1000000);
 });
 it("after compaction context stays unknown until positive successful post-compaction usage",()=>{
  const before=entry("a",assistant(usage(1000,100,2000))),compact={type:"compaction",id:"c",summary:"summary",firstKeptEntryId:"a",tokensBefore:3100};
  const messages=[{role:"user",content:"summary",timestamp:2}];
  expect(context([before,compact],messages)).toEqual({tokens:null,percent:null,contextWindow:1000000});
  for(const m of [assistant(usage(500,20),"error"),assistant(usage(500,20),"aborted"),assistant(usage(0,0))])
   expect(context([before,compact,entry("after",m)],[...messages,m]).tokens).toBeNull();
  const m=assistant(usage(100,20,50));expect(context([before,compact,entry("after",m)],[...messages,m]).tokens).toBe(170);
 });
 it("cumulative stats retain historical requests and compaction usage, not just the current context",()=>{
  const first=assistant(usage(1000,100,2000)),last=assistant(usage(100,20,50));
  const entries=[entry("first",first),{id:"compact",type:"compaction",usage:usage(700,30,100)},entry("last",last)];
  const stats=AgentSession.prototype.getSessionStats.call({sessionManager:{getEntries:()=>entries},getContextUsage:()=>context(entries,[last]),sessionFile:"fixture",sessionId:"fixture"});
  expect(stats.tokens.total).toBe(4100);expect(stats.assistantMessages).toBe(2);expect(stats.contextUsage.tokens).toBe(170);
 });
 it("a missing or zero window is unavailable, not a manufactured percent",()=>{
  expect(context([],[],0)).toBeUndefined();
  expect(AgentSession.prototype.getContextUsage.call({model:undefined})).toBeUndefined();
 });
});
