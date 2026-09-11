export interface DiffLine { kind: "same" | "add" | "remove"; text: string; oldLine?: number; newLine?: number }
/** Linear, bounded contiguous-hunk diff: preserves all text; never allocates a quadratic LCS matrix. */
export function knowledgeLineDiff(before: string, after: string): DiffLine[] {
 const a=before?before.split("\n"):[],b=after?after.split("\n"):[];
 let start=0,end=0;
 while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
 const out:DiffLine[]=[];
 for(let i=0;i<start;i++)out.push({kind:'same',text:a[i]!,oldLine:i+1,newLine:i+1});
 for(let i=start;i<a.length-end;i++)out.push({kind:'remove',text:a[i]!,oldLine:i+1});
 for(let i=start;i<b.length-end;i++)out.push({kind:'add',text:b[i]!,newLine:i+1});
 for(let i=0;i<end;i++)out.push({kind:'same',text:a[a.length-end+i]!,oldLine:a.length-end+i+1,newLine:b.length-end+i+1});
 return out;
}
