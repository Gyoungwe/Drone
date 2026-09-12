import type { ProgressDisplay } from "@percho/shared";
import { useI18nStore } from "../../i18n";
export function ProgressNote({progress}:{progress:ProgressDisplay}){
 const zh=useI18nStore(s=>s.language)==='zh';
 const label=progress.kind==='summary'?(zh?'阶段小结':'Stage summary'):progress.kind==='update'?(zh?'进展说明':'Progress update'):(zh?'阶段说明':'Stage plan');
 return <aside className="rounded-lg border-l-2 border-border bg-hover/50 px-3 py-2 text-xs text-ink-dim" data-testid="progress-note" data-stage-kind={progress.kind||"plan"}>
  <div className="mb-1 text-[10px] text-ink-faint">{label} · {zh?'Agent 公开摘要':'agent public summary'}</div>
  <p className="font-medium text-ink-2">{progress.text}</p>
  {progress.detail&&<p className="mt-1 leading-relaxed">{progress.detail}</p>}
  {progress.next&&<p className="mt-1">{zh?'接下来：':'Next: '}{progress.next}</p>}
 </aside>;
}
