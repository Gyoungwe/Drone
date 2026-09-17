import { useContextUsage } from "../../hooks/use-context-usage";
import { useI18nStore } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";

export function ContextRing() {
 const activeSessionId=useSessionsStore(s=>s.activeSessionId);
 const hasMessages=useTranscriptStore(s=>selectTranscript(s,activeSessionId).messages.length>0);
 const usage=useContextUsage(activeSessionId);
 const zh=useI18nStore(s=>s.language)==="zh";
 if (!usage || !hasMessages) return null;
 const known=usage.tokens!==null && usage.percent!==null && Number.isFinite(usage.percent);
 const percent=known ? usage.percent! : 0;
 const pct=Math.max(0,Math.min(100,percent));
 const color=pct<60 ? "stroke-ink-faint" : pct<85 ? "stroke-amber-500" : "stroke-red-500";
 const r=7,c=2*Math.PI*r;
 const label=known ? `${zh?"上下文估计占用":"Estimated context"} ${percent.toFixed(1)}%` : zh?"上下文用量暂未知":"Context usage unknown";
 return <div className="group relative flex h-7 items-center">
  <svg width="17" height="17" viewBox="0 0 20 20" className="-rotate-90" role="img" aria-label={label}>
   <circle cx="10" cy="10" r={r} className="fill-none stroke-border" strokeWidth="2.5"/>
   <circle cx="10" cy="10" r={r} className={`fill-none ${color} transition-colors`} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${pct/100*c} ${c}`}/>
  </svg>
  <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-[11px] whitespace-nowrap text-ink-2 opacity-0 shadow-pop transition-opacity group-hover:opacity-100">
   <div>{known ? `${zh?"上下文估计":"Estimated context"} ${formatTokens(usage.tokens!)} / ${formatTokens(usage.contextWindow)} tokens · ${percent.toFixed(1)}%` : label}</div>
   <div className="text-ink-dim">{known ? (zh?"不是会话累计消耗；包含 SDK 对新增内容的估计。":"Not cumulative usage; includes SDK estimates for newer content.") : (zh?"压缩后需等待下一次模型响应，未知不等于 0。":"After compaction, wait for the next response; unknown is not zero.")}</div>
  </div>
 </div>;
}
function formatTokens(n:number):string {return n>=1000?`${(n/1000).toFixed(1)}k`:String(n);}
