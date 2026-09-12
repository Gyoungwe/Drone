import type { ProgressDisplay } from "./progress-display";
/** Declared assistant block position, not tool completion order. Only successful status results are attached. */
export interface PublicProgressStep { id: string; blockIndex: number; progress: ProgressDisplay }
export type PublicTimelinePart<T> =
 | {kind:"meta";key:string;thinking:string;tools:T[]}
 | {kind:"progress";key:string;progress:ProgressDisplay}
 | {kind:"text";key:string;text:string};
export function publicTimeline<T extends { id:string; blockIndex?:number }>(input:{
 text:string;thinking:string;tools:T[];steps:readonly PublicProgressStep[];textBlockIndex?:number|null;
}):PublicTimelinePart<T>[] {
 const events:Array<{pos:number;order:number;kind:"tool";tool:T}|{pos:number;order:number;kind:"progress";step:PublicProgressStep}|{pos:number;order:number;kind:"text"}>=[];
 for(const [i,tool] of input.tools.entries())events.push({pos:tool.blockIndex??i,order:1,kind:"tool",tool});
 const steps=new Map(input.steps.map(step=>[step.id,step]));
 for(const step of steps.values())events.push({pos:step.blockIndex,order:0,kind:"progress",step});
 if(input.text)events.push({pos:input.textBlockIndex??Number.MAX_SAFE_INTEGER,order:2,kind:"text"});
 events.sort((a,b)=>a.pos-b.pos||a.order-b.order);
 const parts:PublicTimelinePart<T>[]=[];let tools:T[]=[],thinking=input.thinking;
 const flush=()=>{if(tools.length||thinking)parts.push({kind:"meta",key:tools[0]?.id||"meta",tools,thinking});tools=[];thinking="";};
 for(const event of events){
  if(event.kind==="tool"){tools.push(event.tool);continue;}
  flush();
  if(event.kind==="progress")parts.push({kind:"progress",key:event.step.id,progress:event.step.progress});
  else parts.push({kind:"text",key:"text",text:input.text});
 }
 flush();return parts;
}
