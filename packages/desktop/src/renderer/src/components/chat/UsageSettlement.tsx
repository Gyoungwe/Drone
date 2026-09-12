import { useEffect, useState } from "react";
import { type SessionStats, type UsageDisplayTotal } from "@percho/shared";
import { getPi } from "../../api";
import { useI18nStore } from "../../i18n";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
const compact=(n:number)=>n>=1e6?`${(n/1e6).toFixed(2)}M`:n>=1000?`${(n/1000).toFixed(1)}k`:Math.round(n).toLocaleString();
export function UsageSettlement({usage,total=false,pending=false,error=false}:{usage?:UsageDisplayTotal;total?:boolean;pending?:boolean;error?:boolean}){
 const zh=useI18nStore(s=>s.language)==='zh';
 const heading=total?(zh?'会话累计':'Session total'):(zh?'本轮用量':'Turn usage');
 const rate=usage?.cacheRate==null?'—':`${(usage.cacheRate*100).toFixed(1)}%`;
 return <details className={`rounded-lg border border-border bg-surface/60 text-[11px] text-ink-dim ${total?'px-2.5 py-1.5':'mt-2 px-2.5 py-1.5'}`} data-testid={total?'session-usage':'turn-usage'}>
  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
   <span className="font-medium text-ink-2">{heading}</span>
   <span title={usage?.total.toLocaleString()}>{usage?compact(usage.total):'—'} tokens</span>
   <span>{zh?'缓存命中':'Cache hits'} {rate}</span>
   {pending&&<span>{zh?'更新中…':'Updating…'}</span>}
   {error&&<span className="text-warn">{zh?'暂未取得统计':'Stats unavailable'}</span>}
   <span className="ml-auto text-ink-faint">{zh?'明细':'Details'} ▾</span>
  </summary>
  <div className="mt-2 space-y-1 border-t border-border pt-2" aria-label={zh?'SDK 用量明细':'SDK usage details'}>
   {usage&&<div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
    <span>{zh?'未缓存输入':'Uncached input'} {usage.input.toLocaleString()}</span><span>{zh?'输出（含推理）':'Output (incl. reasoning)'} {usage.output.toLocaleString()}</span>
    <span>{zh?'缓存读取':'Cache read'} {usage.cacheRead.toLocaleString()}</span><span>{zh?'缓存写入':'Cache write'} {usage.cacheWrite.toLocaleString()}</span>
    <span>{zh?'模型响应':'Model responses'} {usage.requests}</span><span>{usage.cost&&usage.cost>0?`$${usage.cost.toFixed(4)}`:(zh?'未提供有效计价':'No priced cost reported')}</span>
   </div>}
   {usage&&!usage.cacheComplete&&<p className="text-warn">{zh?'缓存字段不完整，合计仅包含已上报的值。':'Cache fields are incomplete; totals contain reported values only.'}</p>}
   <p>{zh?'缓存命中率 = 缓存读取 ÷（未缓存输入 + 缓存读取 + 缓存写入）；按 token 加权，不平均每次百分比。':'Cache rate = cache read ÷ (uncached input + cache read + cache write), weighted by tokens, not request percentages.'}</p>
   <p>{zh?'复用原生 SDK 已上报的 usage，不估算 tokenizer 或重新计费；缺失缓存数据时显示 —，零费用不代表免费。':'Uses SDK-reported usage; no tokenizer estimates or independent billing. Missing cache data shows —; zero cost does not imply free usage.'}</p>
   <p>{total?(zh?'范围：SDK 当前会话全部记录，可能包含历史分支和压缩。独立子智能体或外部工具仅在 SDK 上报 usage 时计入；其他费用不在这里估算。':'Scope: all SDK session entries, possibly including old branches and compaction. Independent agents/tools are included only when their usage is reported to the SDK.'): (zh?'范围：当前显示分支中这一用户轮次的已上报响应，含失败或被门控拦截的请求；推理 token 已包含在输出中，不重复相加。':'Scope: reported responses in this visible user turn, including failed or blocked requests. Reasoning is already part of output and is not added again.')}</p>
  </div>
 </details>;
}
function sdkTotal(stats:SessionStats):UsageDisplayTotal {
 const input=stats.inputTokens,output=stats.outputTokens,cacheRead=stats.cacheReadTokens??0,cacheWrite=stats.cacheWriteTokens??0;
 const complete=stats.cacheReadTokens!==undefined&&stats.cacheWriteTokens!==undefined,denominator=input+cacheRead+cacheWrite;
 return {input,output,cacheRead,cacheWrite,total:stats.totalTokens??denominator+output,cacheRate:complete&&denominator>0?cacheRead/denominator:null,
  cacheComplete:complete,cost:stats.cost,requests:stats.requests??0};
}
/** Query the existing SDK stats IPC at completed-response/settled boundaries, never for token deltas. */
export function SessionUsageFooter({sessionId}:{sessionId:string|null}){
 const transcript=useTranscriptStore(s=>selectTranscript(s,sessionId));
 const count=transcript.messages.length,ended=transcript.runEndedAt;
 const [data,setData]=useState<{id:string;usage:UsageDisplayTotal}|null>(null),[error,setError]=useState(false),[pending,setPending]=useState(false);
 useEffect(()=>{
  if(!sessionId||sessionId.startsWith('draft:'))return;let live=true;
  const timer=setTimeout(()=>{setPending(true);void getPi().getStats(sessionId).then(stats=>{if(live){setData({id:sessionId,usage:sdkTotal(stats)});setError(false);}},()=>{if(live)setError(true);}).finally(()=>{if(live)setPending(false);});},150);
  return ()=>{live=false;clearTimeout(timer);};
 },[sessionId,count,ended]);
 if(!sessionId||!count)return null;
 return <div className="mt-2"><UsageSettlement usage={data?.id===sessionId?data.usage:undefined} total pending={pending} error={error}/></div>;
}
